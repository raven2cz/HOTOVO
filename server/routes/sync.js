import express from 'express';
import { getDb } from '../db.js';
import { getAuthUrl, handleCallback, fullSync } from '../services/gcal.js';
import { authenticateToken } from './tasks.js';

const router = express.Router();

// Retrieve sync settings
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const clientId = await db.get("SELECT value FROM settings WHERE key = 'gcal_client_id'");
    const clientSecret = await db.get("SELECT value FROM settings WHERE key = 'gcal_client_secret'");
    const redirectUri = await db.get("SELECT value FROM settings WHERE key = 'gcal_redirect_uri'");
    const refreshToken = await db.get("SELECT value FROM settings WHERE key = 'gcal_refresh_token'");

    res.json({
      gcal_client_id: clientId?.value || '',
      has_client_secret: !!clientSecret?.value,
      gcal_redirect_uri: redirectUri?.value || 'http://localhost:3000/api/sync/callback',
      is_connected: !!refreshToken?.value
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update sync credentials settings
router.post('/config', authenticateToken, async (req, res) => {
  try {
    const { gcal_client_id, gcal_client_secret, gcal_redirect_uri } = req.body;
    const db = await getDb();

    if (gcal_client_id !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_client_id', ?)", [gcal_client_id]);
    }
    if (gcal_client_secret !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_client_secret', ?)", [gcal_client_secret]);
    }
    if (gcal_redirect_uri !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_redirect_uri', ?)", [gcal_redirect_uri]);
    }

    res.json({ success: true, message: 'Google Calendar credentials uloženy.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Google Consent Screen URL for OAuth Authentication
router.get('/auth-url', authenticateToken, async (req, res) => {
  try {
    const url = await getAuthUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Nebylo možné vygenerovat URL. Zkontrolujte, zda máte nastavené Client ID a Client Secret v Nastavení.' });
  }
});

// OAuth Callback from Google redirect
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Chybí autorizační kód Google API.');
    }

    await handleCallback(code);
    
    // Redirect back to frontend settings section
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #0f172a; color: #f8fafc;">
          <h2>Připojení k Google Kalendáři bylo úspěšné!</h2>
          <p>Toto okno můžete zavřít. Aplikace se automaticky aktualizuje.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
            if (window.opener) {
              window.opener.postMessage('gcal_auth_success', '*');
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Chyba při dokončování autentizace: ${error.message}`);
  }
});

// Trigger full calendar sync manually
router.post('/run', authenticateToken, async (req, res) => {
  try {
    const stats = await fullSync();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Disconnect Google Calendar connection
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    
    // Remove Google Calendar Tokens
    await db.run("DELETE FROM settings WHERE key = 'gcal_refresh_token'");
    await db.run("DELETE FROM settings WHERE key = 'gcal_access_token'");
    await db.run("DELETE FROM settings WHERE key = 'gcal_token_expiry'");

    // Optional: Clear gcal metadata from tasks
    await db.run("UPDATE tasks SET gcal_event_id = NULL, gcal_updated_at = NULL");

    res.json({ success: true, message: 'Google Kalendář byl odpojen.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
