import express from 'express';
import crypto from 'crypto';

import { getDb, withTransaction } from '../db.js';
import { requireAuth, requireLocalUi } from '../auth.js';
import { asyncHandler } from '../util/http.js';
import { encryptSecret } from '../util/secrets.js';
import { PUBLIC_BASE_URL } from '../config.js';
import { getAuthUrl, handleCallback, deleteGoogleEvent } from '../services/gcal.js';
import { enqueueUpsert, drainOutbox, runExclusive } from '../services/gcalOutbox.js';

const router = express.Router();

const DEFAULT_REDIRECT_URI = `${PUBLIC_BASE_URL}/api/sync/callback`;

// Retrieve sync settings (never returns the secret itself, only a boolean).
router.get(
  '/config',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const get = async (key) => (await db.get('SELECT value FROM settings WHERE key = ?', [key]))?.value;

    res.json({
      gcal_client_id: (await get('gcal_client_id')) || '',
      has_client_secret: !!(await get('gcal_client_secret')),
      gcal_redirect_uri: (await get('gcal_redirect_uri')) || DEFAULT_REDIRECT_URI,
      is_connected: !!(await get('gcal_refresh_token'))
    });
  })
);

// Update Google Calendar credentials (local UI only — agents must not be able
// to rewrite OAuth client config or the redirect URI).
router.post(
  '/config',
  requireAuth,
  requireLocalUi,
  asyncHandler(async (req, res) => {
    const { gcal_client_id, gcal_client_secret, gcal_redirect_uri } = req.body;
    const db = await getDb();
    const set = (key, value) =>
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);

    if (gcal_client_id !== undefined) await set('gcal_client_id', gcal_client_id);
    // Only overwrite the secret when a non-empty value is supplied, so saving
    // other settings (with the secret field left blank) keeps the stored one.
    if (gcal_client_secret) await set('gcal_client_secret', encryptSecret(gcal_client_secret));
    if (gcal_redirect_uri !== undefined) await set('gcal_redirect_uri', gcal_redirect_uri);

    res.json({ success: true, message: 'Google Calendar credentials uloženy.' });
  })
);

// Build the consent-screen URL and persist a one-time CSRF state token.
// POST (not GET) so a cross-site request can't silently invalidate an
// in-progress OAuth flow — mutating loopback routes require a same-origin call.
router.post(
  '/auth-url',
  requireAuth,
  requireLocalUi,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const state = crypto.randomBytes(16).toString('hex');
    // Store each state as its own short-lived nonce so concurrent connect
    // attempts don't invalidate one another. Prune expired ones opportunistically.
    await db.run('INSERT INTO oauth_states (state) VALUES (?)', [state]);
    await db.run("DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')");
    res.json({ url: await getAuthUrl(state) });
  })
);

// OAuth callback (reached via Google's browser redirect, so no Bearer token).
// CSRF is prevented by validating the `state` against the value we stored.
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Chybí autorizační kód Google API.');

    const db = await getDb();
    // Consume the state atomically: a single DELETE that both validates and
    // removes it, so two concurrent callbacks can't both pass the check.
    const consumed = state
      ? await db.run(
          "DELETE FROM oauth_states WHERE state = ? AND created_at >= datetime('now', '-10 minutes')",
          [state]
        )
      : { changes: 0 };
    if (consumed.changes !== 1) {
      return res.status(400).send('Neplatný, prošlý nebo chybějící state parametr (možný CSRF).');
    }

    try {
      await handleCallback(code);
    } catch (err) {
      // Log only sanitized fields — the raw error can carry the auth code and
      // OAuth client details, which must not land in logs/journald.
      console.error('[gcal] OAuth callback failed:', err.message, err.code ?? '', err.response?.status ?? '');
      return res.status(500).send('Dokončení autentizace selhalo. Zkuste to prosím znovu.');
    }

    res.send(`<!doctype html>
      <html lang="cs">
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #0f172a; color: #f8fafc;">
          <h2>Připojení k Google Kalendáři bylo úspěšné!</h2>
          <p>Toto okno můžete zavřít. Aplikace se automaticky aktualizuje.</p>
          <script>
            if (window.opener) window.opener.postMessage('gcal_auth_success', window.location.origin);
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
      </html>`);
  })
);

// Trigger a full calendar sync: queue every due-dated task and drain the outbox.
router.post(
  '/run',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const dated = await db.all('SELECT id FROM tasks WHERE due_date IS NOT NULL');
    for (const t of dated) await enqueueUpsert(t.id);
    const stats = await drainOutbox();
    res.json({ success: true, stats });
  })
);

// Disconnect Google Calendar (local UI only — it deletes mirrored events and
// stored tokens).
router.post(
  '/disconnect',
  requireAuth,
  requireLocalUi,
  asyncHandler(async (req, res) => {
    const db = await getDb();

    // Hold the outbox drain lock for the whole disconnect, so a concurrent drain
    // can't create a new event after we snapshot but before credentials are
    // cleared (which would orphan it).
    const orphaned = await runExclusive(async () => {
      // While credentials are still present, remove the remote events we created.
      // Track any that fail so the user is told which to clean up manually.
      const synced = await db.all('SELECT gcal_event_id FROM tasks WHERE gcal_event_id IS NOT NULL');
      const failed = [];
      for (const { gcal_event_id } of synced) {
        try {
          await deleteGoogleEvent(gcal_event_id);
        } catch (err) {
          console.warn(`[gcal] event delete on disconnect failed (${gcal_event_id}): ${err.message}`);
          failed.push(gcal_event_id);
        }
      }

      // Fully forget the Google connection (tokens AND client credentials) and
      // clear all derived sync state in one transaction.
      await withTransaction(async (tx) => {
        await tx.run(
          `DELETE FROM settings WHERE key IN (
             'gcal_refresh_token', 'gcal_access_token', 'gcal_token_expiry',
             'gcal_client_id', 'gcal_client_secret', 'gcal_redirect_uri'
           )`
        );
        await tx.run('DELETE FROM oauth_states');
        // Drop any queued sync work — credentials are gone, so it can't be applied.
        await tx.run('DELETE FROM gcal_outbox');
        await tx.run('UPDATE tasks SET gcal_event_id = NULL, gcal_updated_at = NULL');
      });

      return failed;
    });

    res.json({
      success: true,
      message:
        orphaned.length === 0
          ? 'Google Kalendář byl odpojen.'
          : `Google Kalendář byl odpojen, ale ${orphaned.length} událostí se nepodařilo smazat – odstraňte je ručně.`,
      orphaned_events: orphaned
    });
  })
);

export default router;
