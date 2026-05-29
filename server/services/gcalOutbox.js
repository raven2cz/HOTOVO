import { v4 as uuidv4 } from 'uuid';

import { getDb } from '../db.js';
import { syncTaskToGoogle, deleteGoogleEvent, isSyncConfigured } from './gcal.js';

/**
 * Durable Google Calendar sync queue.
 *
 * Route handlers never call Google directly; they enqueue 'upsert' (by task id)
 * or 'delete' (by event id) operations. A single, process-wide serialized
 * drainer applies them. This guarantees:
 *   - no duplicate event inserts (only one serialized writer, which re-reads the
 *     task's current gcal_event_id immediately before inserting/patching);
 *   - durable, retryable remote deletes (the event id lives in the queue, so it
 *     survives the local gcal_event_id being cleared and transient API failures).
 */

const MAX_ATTEMPTS = 12;
const BATCH_SIZE = 100;
let draining = false;

/**
 * Enqueue an upsert for a task (deduped — one pending upsert per task).
 * Pass `conn` to enqueue inside an existing transaction (atomic with the
 * triggering DB change).
 */
export async function enqueueUpsert(taskId, conn) {
  if (!taskId) return;
  const db = conn || (await getDb());
  // Cancel any pending delete tied to this task: if the task is being (re)synced
  // it must exist, so a queued delete of its event is now stale (e.g. due date
  // cleared then re-added before the delete drained).
  await db.run("DELETE FROM gcal_outbox WHERE op = 'delete' AND task_id = ?", [taskId]);
  await db.run(
    `INSERT INTO gcal_outbox (id, op, task_id)
     SELECT ?, 'upsert', ?
     WHERE NOT EXISTS (SELECT 1 FROM gcal_outbox WHERE op = 'upsert' AND task_id = ?)`,
    [uuidv4(), taskId, taskId]
  );
}

/**
 * Enqueue a delete for a remote event (deduped per event id). Pass `taskId`
 * when the event still belongs to a live task (e.g. due-date removal) so a
 * later re-sync of that task can cancel this delete if it becomes stale.
 */
export async function enqueueDelete(eventId, conn, taskId = null) {
  if (!eventId) return;
  const db = conn || (await getDb());
  await db.run(
    `INSERT INTO gcal_outbox (id, op, event_id, task_id)
     SELECT ?, 'delete', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM gcal_outbox WHERE op = 'delete' AND event_id = ?)`,
    [uuidv4(), eventId, taskId, eventId]
  );
}

/**
 * Process due queue entries. Serialized via the `draining` flag so Google is
 * only ever written by one path at a time. No-ops (returns early) when sync is
 * not configured, leaving entries queued until the user connects.
 */
export async function drainOutbox() {
  // Claim the drain slot synchronously (before any await) so two callers can
  // never both proceed and double-insert Google events.
  if (draining) return { skipped: 'busy' };
  draining = true;
  try {
    if (!(await isSyncConfigured())) return { skipped: 'not_connected' };
    const db = await getDb();
    const rows = await db.all(
      `SELECT * FROM gcal_outbox
       WHERE dead = 0 AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
       ORDER BY created_at ASC
       LIMIT ?`,
      [BATCH_SIZE]
    );

    let success = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (row.op === 'upsert') {
          const task = await db.get('SELECT * FROM tasks WHERE id = ?', [row.task_id]);
          // Task gone or no longer dated → nothing to mirror; drop the entry.
          if (task && task.due_date) await syncTaskToGoogle(task);
        } else if (row.op === 'delete') {
          await deleteGoogleEvent(row.event_id);
        }
        await db.run('DELETE FROM gcal_outbox WHERE id = ?', [row.id]);
        success++;
      } catch (err) {
        failed++;
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Dead-letter: keep the row (marked dead) so the divergence stays
          // visible/retryable instead of silently vanishing.
          console.error(
            `[gcal] dead-lettering outbox ${row.op} after ${attempts} attempts: ${err.message}`
          );
          await db.run(
            'UPDATE gcal_outbox SET attempts = ?, last_error = ?, dead = 1 WHERE id = ?',
            [attempts, String(err.message).slice(0, 500), row.id]
          );
        } else {
          // Exponential backoff capped at 60 minutes.
          const backoffMin = Math.min(2 ** attempts, 60);
          await db.run(
            `UPDATE gcal_outbox
             SET attempts = ?, last_error = ?, next_attempt_at = datetime('now', ?)
             WHERE id = ?`,
            [attempts, String(err.message).slice(0, 500), `+${backoffMin} minutes`, row.id]
          );
        }
      }
    }
    return { success, failed, processed: rows.length };
  } finally {
    draining = false;
  }
}

/**
 * Drain now (best-effort) — used right after a mutation so sync feels immediate,
 * while failures stay queued for retry. Never throws.
 */
export async function flushOutbox() {
  try {
    return await drainOutbox();
  } catch (err) {
    console.warn('[gcal] outbox drain error:', err.message);
    return { error: err.message };
  }
}

let timer = null;

/** Periodically retry queued operations (for backed-off / previously-failed entries). */
export function startOutboxProcessor(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    flushOutbox();
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopOutboxProcessor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
