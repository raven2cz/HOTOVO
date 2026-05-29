import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, badRequest, notFound } from '../util/http.js';
import {
  assertEnum,
  assertDueDate,
  assertNonEmptyString,
  TASK_STATUSES,
  TASK_PRIORITIES
} from '../util/validate.js';
import { syncTaskToGoogle, deleteGoogleEvent } from '../services/gcal.js';

const router = express.Router();

router.use(requireAuth);

/** Throw 400 unless the referenced list exists. */
async function assertListExists(db, listId) {
  const list = await db.get('SELECT id FROM lists WHERE id = ?', [listId]);
  if (!list) throw badRequest('Projekt/List neexistuje.');
}

/**
 * Validate a candidate parent for `taskId`. Ensures the parent exists and that
 * assigning it would not create a cycle (parent === self, or parent is a
 * descendant of the task). A cyclic tree would hang the recursive cascade.
 */
async function assertValidParent(db, parentId, taskId) {
  if (parentId === null || parentId === undefined) return;
  if (parentId === taskId) throw badRequest('Úkol nemůže být svým vlastním rodičem.');

  const parent = await db.get('SELECT id FROM tasks WHERE id = ?', [parentId]);
  if (!parent) throw badRequest('Rodičovský úkol neexistuje.');

  if (taskId) {
    const cycle = await db.get(
      `WITH RECURSIVE descendants(id) AS (
         SELECT ?
         UNION ALL
         SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
       )
       SELECT 1 AS hit FROM descendants WHERE id = ? LIMIT 1`,
      [taskId, parentId]
    );
    if (cycle) throw badRequest('Nelze nastavit potomka jako rodiče (vznikl by cyklus).');
  }
}

/**
 * Propagate a status change through the task tree inside an open transaction.
 * Downward: all descendants inherit the new status. Upward: each ancestor is
 * recomputed as completed iff all its direct children are completed. The walk
 * always advances to parent.parent_id and is bounded by a visited set, so it
 * can never loop regardless of the status value.
 */
async function propagateStatus(db, taskId, newStatus, parentId) {
  await db.run(
    `WITH RECURSIVE descendants(id) AS (
       SELECT ?
       UNION ALL
       SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
     )
     UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id IN descendants`,
    [taskId, newStatus]
  );

  const visited = new Set([taskId]);
  let currentParentId = parentId;
  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = await db.get('SELECT parent_id FROM tasks WHERE id = ?', [currentParentId]);
    if (!parent) break;

    const incomplete = await db.get(
      "SELECT COUNT(*) AS count FROM tasks WHERE parent_id = ? AND status != 'completed'",
      [currentParentId]
    );
    const rolledUpStatus = incomplete.count === 0 ? 'completed' : 'pending';
    await db.run(
      "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [rolledUpStatus, currentParentId]
    );

    currentParentId = parent.parent_id;
  }
}

// List tasks (optionally filtered by list_id / status / priority / due_date).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { list_id, status, priority, due_date } = req.query;
    assertEnum(status, TASK_STATUSES, 'status');
    assertEnum(priority, TASK_PRIORITIES, 'priority');

    const db = await getDb();
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (list_id) { query += ' AND list_id = ?'; params.push(list_id); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (priority) { query += ' AND priority = ?'; params.push(priority); }
    if (due_date) { query += ' AND date(due_date) = date(?)'; params.push(due_date); }

    query += ' ORDER BY created_at ASC';
    res.json(await db.all(query, params));
  })
);

// Create a task (or subtask when parent_id is provided).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title, description, list_id, parent_id, priority, due_date } = req.body;

    assertNonEmptyString(title, 'title');
    assertNonEmptyString(list_id, 'list_id');
    assertEnum(priority, TASK_PRIORITIES, 'priority');
    assertDueDate(due_date);

    const db = await getDb();
    await assertListExists(db, list_id);
    await assertValidParent(db, parent_id ?? null, null);

    const id = uuidv4();
    await db.run(
      `INSERT INTO tasks (id, list_id, parent_id, title, description, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, list_id, parent_id || null, title, description || '', priority || 'medium', due_date || null]
    );

    if (due_date) {
      const created = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
      await safeSync(created);
    }

    res.status(201).json(await db.get('SELECT * FROM tasks WHERE id = ?', [id]));
  })
);

// Update a task.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, description, status, priority, due_date, list_id, parent_id, gcal_event_id } = req.body;

    assertEnum(status, TASK_STATUSES, 'status');
    assertEnum(priority, TASK_PRIORITIES, 'priority');
    if (due_date !== undefined) assertDueDate(due_date);

    const db = await getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!task) throw notFound('Úkol nebyl nalezen.');

    if (list_id !== undefined) await assertListExists(db, list_id);
    if (parent_id !== undefined) await assertValidParent(db, parent_id, id);

    // Treat an empty-string due_date the same as null ("remove the date").
    const dueDateProvided = due_date !== undefined;
    const normalizedDueDate = due_date === '' ? null : due_date;
    const removingDueDate = dueDateProvided && normalizedDueDate === null;

    if (removingDueDate && task.gcal_event_id) {
      await safeDeleteEvent(task.gcal_event_id);
    }

    const sets = ["updated_at = datetime('now')"];
    const params = [];
    const setField = (column, value) => { sets.push(`${column} = ?`); params.push(value); };

    if (title !== undefined) { assertNonEmptyString(title, 'title'); setField('title', title); }
    if (description !== undefined) setField('description', description);
    if (status !== undefined) setField('status', status);
    if (priority !== undefined) setField('priority', priority);
    if (dueDateProvided) setField('due_date', normalizedDueDate);
    if (list_id !== undefined) setField('list_id', list_id);
    if (parent_id !== undefined) setField('parent_id', parent_id);
    if (gcal_event_id !== undefined) setField('gcal_event_id', gcal_event_id);
    if (removingDueDate) sets.push('gcal_event_id = NULL', 'gcal_updated_at = NULL');

    const statusChanged = status !== undefined && status !== task.status;

    // Apply the primary update and any status propagation atomically.
    await db.run('BEGIN');
    try {
      await db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
      if (statusChanged) {
        const effectiveParentId = parent_id !== undefined ? parent_id : task.parent_id;
        await propagateStatus(db, id, status, effectiveParentId);
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (updated.due_date) await safeSync(updated);

    res.json(await db.get('SELECT * FROM tasks WHERE id = ?', [id]));
  })
);

// Delete a task and (via ON DELETE CASCADE) its whole subtree.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    const task = await db.get('SELECT id FROM tasks WHERE id = ?', [id]);
    if (!task) throw notFound('Úkol nebyl nalezen.');

    // Collect the whole subtree so we can clean up calendar events and report
    // exactly how many tasks the cascade will remove.
    const subtree = await db.all(
      `WITH RECURSIVE descendants(id) AS (
         SELECT ?
         UNION ALL
         SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
       )
       SELECT t.id, t.gcal_event_id FROM tasks t JOIN descendants d ON t.id = d.id`,
      [id]
    );

    for (const node of subtree) {
      if (node.gcal_event_id) await safeDeleteEvent(node.gcal_event_id);
    }

    await db.run('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ success: true, deleted_id: id, deleted_count: subtree.length });
  })
);

/** Calendar sync is best-effort: failures are logged but never break the request. */
async function safeSync(task) {
  try {
    await syncTaskToGoogle(task);
  } catch (err) {
    console.warn(`[gcal] sync failed for task ${task.id}: ${err.message}`);
  }
}

async function safeDeleteEvent(eventId) {
  try {
    await deleteGoogleEvent(eventId);
  } catch (err) {
    console.warn(`[gcal] event delete failed (${eventId}): ${err.message}`);
  }
}

export default router;
