import { google } from 'googleapis';
import { getDb } from '../db.js';
import { encryptSecret, decryptSecret } from '../util/secrets.js';
import { PUBLIC_BASE_URL } from '../config.js';

const DEFAULT_REDIRECT_URI = `${PUBLIC_BASE_URL}/api/sync/callback`;
const DAY_MS = 24 * 60 * 60 * 1000;

async function getSetting(db, key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value;
}

// Build an OAuth client from saved (decrypted) credentials.
export async function getOAuthClient() {
  const db = await getDb();
  const clientId = await getSetting(db, 'gcal_client_id');
  const clientSecret = decryptSecret(await getSetting(db, 'gcal_client_secret'));

  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar credentials (Client ID / Secret) are not set in settings.');
  }

  const redirectUri = (await getSetting(db, 'gcal_redirect_uri')) || DEFAULT_REDIRECT_URI;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Generate the consent-screen URL. `state` is a CSRF token validated on callback.
export async function getAuthUrl(state) {
  const oauth2Client = await getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    // Narrowest scope that supports event insert/patch/delete on the calendar.
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent', // force a refresh_token to be returned on re-auth
    state
  });
}

// Exchange the authorization code for tokens and persist them (encrypted).
export async function handleCallback(code) {
  const db = await getDb();
  const oauth2Client = await getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  const set = (key, value) =>
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);

  if (tokens.refresh_token) {
    await set('gcal_refresh_token', encryptSecret(tokens.refresh_token));
  } else {
    console.warn('[gcal] No refresh_token returned; previous one (if any) is kept.');
  }
  if (tokens.access_token) {
    await set('gcal_access_token', encryptSecret(tokens.access_token));
    await set('gcal_token_expiry', String(tokens.expiry_date ?? ''));
  }

  return tokens;
}

// Return an authorised Calendar client.
export async function getCalendarClient() {
  const db = await getDb();
  const oauth2Client = await getOAuthClient();
  const refreshToken = decryptSecret(await getSetting(db, 'gcal_refresh_token'));

  if (!refreshToken) {
    throw new Error('Google Calendar Sync is not authorized. Connect your account in Settings.');
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Build the Google event payload for a task.
 * Date-only tasks become all-day events: Google treats `end.date` as exclusive,
 * so it must be the day AFTER `start.date`. Date-time tasks get a 1h duration.
 */
function buildEventPayload(task) {
  const title = task.status === 'completed' ? `✅ ${task.title}` : task.title;
  const description = `${task.description || ''}\n\nSyncováno z Todo Listu.\nPriorita: ${task.priority}`;
  const isDateOnly = typeof task.due_date === 'string' && task.due_date.length === 10;

  if (isDateOnly) {
    const endDate = new Date(`${task.due_date}T00:00:00Z`).getTime() + DAY_MS;
    return {
      summary: title,
      description,
      start: { date: task.due_date },
      end: { date: new Date(endDate).toISOString().slice(0, 10) }
    };
  }

  const start = new Date(task.due_date);
  return {
    summary: title,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString() }
  };
}

// Create or update the Google Calendar event mirroring a task.
export async function syncTaskToGoogle(task) {
  if (!task.due_date) return null;

  const calendar = await getCalendarClient();
  const db = await getDb();
  const event = buildEventPayload(task);

  if (task.gcal_event_id) {
    try {
      const response = await calendar.events.patch({
        calendarId: 'primary',
        eventId: task.gcal_event_id,
        requestBody: event
      });
      await db.run("UPDATE tasks SET gcal_updated_at = datetime('now') WHERE id = ?", [task.id]);
      return response.data.id;
    } catch (err) {
      // If the event vanished from the calendar, fall through and create a new one.
      if (err.code !== 404 && err.code !== 410) throw err;
      console.log(`[gcal] Event ${task.gcal_event_id} missing on Google; creating a new one.`);
    }
  }

  const response = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
  const newEventId = response.data.id;
  await db.run(
    "UPDATE tasks SET gcal_event_id = ?, gcal_updated_at = datetime('now') WHERE id = ?",
    [newEventId, task.id]
  );
  return newEventId;
}

// Delete a Google Calendar event (ignoring already-deleted events).
export async function deleteGoogleEvent(eventId) {
  if (!eventId) return;
  try {
    const calendar = await getCalendarClient();
    await calendar.events.delete({ calendarId: 'primary', eventId });
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}

// Sync every task that has a due date. Per-task errors are collected, not hidden.
export async function fullSync() {
  const db = await getDb();
  const tasks = await db.all('SELECT * FROM tasks WHERE due_date IS NOT NULL');

  let successCount = 0;
  const errors = [];
  for (const task of tasks) {
    try {
      await syncTaskToGoogle(task);
      successCount++;
    } catch (err) {
      errors.push({ taskId: task.id, title: task.title, message: err.message });
    }
  }

  return { successCount, errorCount: errors.length, errors };
}
