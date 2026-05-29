import express from 'express';
import crypto from 'crypto';

import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util/http.js';
import { encryptSecret } from '../util/secrets.js';
import { getAuthUrl, handleCallback, fullSync } from '../services/gcal.js';

const router = express.Router();

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
      gcal_redirect_uri: (await get('gcal_redirect_uri')) || 'http://localhost:3000/api/sync/callback',
      is_connected: !!(await get('gcal_refresh_token'))
    });
  })
);

// Update Google Calendar credentials.
router.post(
  '/config',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { gcal_client_id, gcal_client_secret, gcal_redirect_uri } = req.body;
    const db = await getDb();
    const set = (key, value) =>
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);

    if (gcal_client_id !== undefined) await set('gcal_client_id', gcal_client_id);
    if (gcal_client_secret !== undefined) await set('gcal_client_secret', encryptSecret(gcal_client_secret));
    if (gcal_redirect_uri !== undefined) await set('gcal_redirect_uri', gcal_redirect_uri);

    res.json({ success: true, message: 'Google Calendar credentials uloženy.' });
  })
);

// Build the consent-screen URL and persist a one-time CSRF state token.
router.get(
  '/auth-url',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const state = crypto.randomBytes(16).toString('hex');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_oauth_state', ?)", [state]);
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
    const expected = (await db.get("SELECT value FROM settings WHERE key = 'gcal_oauth_state'"))?.value;
    if (!state || !expected || state !== expected) {
      return res.status(400).send('Neplatný nebo chybějící state parametr (možný CSRF).');
    }
    await db.run("DELETE FROM settings WHERE key = 'gcal_oauth_state'");

    try {
      await handleCallback(code);
    } catch (err) {
      console.error('[gcal] OAuth callback failed:', err);
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

// Trigger a full calendar sync.
router.post(
  '/run',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ success: true, stats: await fullSync() });
  })
);

// Disconnect Google Calendar.
router.post(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    await db.run(
      "DELETE FROM settings WHERE key IN ('gcal_refresh_token', 'gcal_access_token', 'gcal_token_expiry', 'gcal_oauth_state')"
    );
    await db.run('UPDATE tasks SET gcal_event_id = NULL, gcal_updated_at = NULL');
    res.json({ success: true, message: 'Google Kalendář byl odpojen.' });
  })
);

export default router;
