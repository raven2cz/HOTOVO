import { google } from 'googleapis';
import { getDb } from '../db.js';

// Retrieve Google OAuth client with saved settings
export async function getOAuthClient() {
  const db = await getDb();
  const clientIdRow = await db.get("SELECT value FROM settings WHERE key = 'gcal_client_id'");
  const clientSecretRow = await db.get("SELECT value FROM settings WHERE key = 'gcal_client_secret'");
  const redirectUriRow = await db.get("SELECT value FROM settings WHERE key = 'gcal_redirect_uri'");

  if (!clientIdRow?.value || !clientSecretRow?.value) {
    throw new Error('Google Calendar credentials (Client ID / Secret) are not set in settings.');
  }

  const redirectUri = redirectUriRow?.value || 'http://localhost:3000/api/sync/callback';

  return new google.auth.OAuth2(
    clientIdRow.value,
    clientSecretRow.value,
    redirectUri
  );
}

// Generate consent page URL
export async function getAuthUrl() {
  const oauth2Client = await getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent' // Forces refresh token to be returned
  });
}

// Save authentication code and exchange for refresh token
export async function handleCallback(code) {
  const db = await getDb();
  const oauth2Client = await getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  
  if (tokens.refresh_token) {
    await db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_refresh_token', ?)",
      [tokens.refresh_token]
    );
  }

  // Also save access token in DB (or just refresh it dynamically when needed)
  if (tokens.access_token) {
    await db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_access_token', ?)",
      [tokens.access_token]
    );
    await db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_token_expiry', ?)",
      [String(tokens.expiry_date)]
    );
  }

  return tokens;
}

// Load credentials and return configured google calendar client
export async function getCalendarClient() {
  const db = await getDb();
  const oauth2Client = await getOAuthClient();
  const refreshTokenRow = await db.get("SELECT value FROM settings WHERE key = 'gcal_refresh_token'");

  if (!refreshTokenRow?.value) {
    throw new Error('Google Calendar Sync is not authorized. Please connect your Google account in Settings.');
  }

  oauth2Client.setCredentials({
    refresh_token: refreshTokenRow.value
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Create or update Google Calendar event for a task
export async function syncTaskToGoogle(task) {
  if (!task.due_date) return null;

  try {
    const calendar = await getCalendarClient();
    const db = await getDb();

    const title = task.status === 'completed' ? `✅ ${task.title}` : task.title;
    const description = `${task.description || ''}\n\nSyncováno z Todo Listu.\nPriorita: ${task.priority}\nOdkaz: http://localhost:3000/`;

    // Google Calendar expects ISO string. Let's make sure it has start/end times.
    // Tasks might just have a date (e.g. 2026-05-28) or date-time.
    let startDateTime = task.due_date;
    let endDateTime = task.due_date;

    // Check if it's date only (10 chars, e.g. "2026-05-28") or date-time
    const isDateOnly = task.due_date.length === 10;

    const event = {
      summary: title,
      description: description,
      start: isDateOnly ? { date: startDateTime } : { dateTime: startDateTime },
      end: isDateOnly ? { date: endDateTime } : { dateTime: new Date(new Date(endDateTime).getTime() + 60 * 60 * 1000).toISOString() }, // 1 hour duration default
    };

    if (task.gcal_event_id) {
      try {
        const response = await calendar.events.patch({
          calendarId: 'primary',
          eventId: task.gcal_event_id,
          requestBody: event,
        });

        await db.run(
          "UPDATE tasks SET gcal_updated_at = datetime('now') WHERE id = ?",
          [task.id]
        );
        return response.data.id;
      } catch (err) {
        // If event was deleted in calendar (404 / 410), treat as new event creation
        if (err.code === 404 || err.code === 410) {
          console.log(`Event ${task.gcal_event_id} was deleted on Google Calendar. Creating a new one.`);
        } else {
          throw err;
        }
      }
    }

    // Create a new event
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    const newEventId = response.data.id;
    await db.run(
      "UPDATE tasks SET gcal_event_id = ?, gcal_updated_at = datetime('now') WHERE id = ?",
      [newEventId, task.id]
    );

    return newEventId;
  } catch (error) {
    console.error('Google Calendar sync error for task:', task.title, error.message);
    throw error;
  }
}

// Delete an event from Google Calendar
export async function deleteGoogleEvent(eventId) {
  if (!eventId) return;
  try {
    const calendar = await getCalendarClient();
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
  } catch (error) {
    // If already deleted, we can ignore the error
    if (error.code !== 404 && error.code !== 410) {
      console.error('Error deleting Google Calendar event:', eventId, error.message);
    }
  }
}

// Full Sync: Sync all tasks that have due dates
export async function fullSync() {
  const db = await getDb();
  // Sync tasks that have due dates
  const tasks = await db.all("SELECT * FROM tasks WHERE due_date IS NOT NULL");
  let successCount = 0;
  let errorCount = 0;

  for (const task of tasks) {
    try {
      await syncTaskToGoogle(task);
      successCount++;
    } catch (err) {
      errorCount++;
    }
  }

  return { successCount, errorCount };
}
