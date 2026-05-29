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
 * Validate a candidate parent for `taskId`. Ensures the parent exists, lives in
 * the same list as the child (no cross-project nesting), and that assigning it
 * would not create a cycle (parent === self, or parent is a descendant of the
 * task). A cyclic tree would hang the recursive cascade.
 */
async function assertValidParent(db, parentId, taskId, expectedListId) {
  if (parentId === null || parentId === undefined) return;
  if (parentId === taskId) throw badRequest('Úkol nemůže být svým vlastním rodičem.');

  const parent = await db.get('SELECT id, list_id FROM tasks WHERE id = ?', [parentId]);
  if (!parent) throw badRequest('Rodičovský úkol neexistuje.');
  if (expectedListId !== undefined && parent.list_id !== expectedListId) {
    throw badRequest('Rodičovský úkol musí být ve stejném projektu jako podúkol.');
  }

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

/** Set the status of a task and all of its descendants. */
async function cascadeStatusDown(db, taskId, newStatus) {
  await db.run(
    `WITH RECURSIVE descendants(id) AS (
       SELECT ?
       UNION ALL
       SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
     )
     UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id IN descendants`,
    [taskId, newStatus]
  );
}

/**
 * Walk up the ancestor chain starting at `startParentId`, recomputing each
 * ancestor as completed iff all of its direct children are completed. The walk
 * always advances to parent.parent_id and is bounded by a visited set, so it
 * can never loop. Safe to call after any structural change (create / delete /
 * re-parent), not only explicit status updates.
 */
async function rollupAncestors(db, startParentId) {
  const visited = new Set();
  let currentParentId = startParentId;
  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = await db.get('SELECT parent_id FROM tasks WHERE id = ?', [currentParentId]);
    if (!parent) break;

    const counts = await db.get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) AS incomplete
       FROM tasks WHERE parent_id = ?`,
      [currentParentId]
    );
    // A childless task keeps its own status; otherwise it follows its children.
    if (counts.total > 0) {
      const rolledUpStatus = counts.incomplete === 0 ? 'completed' : 'pending';
      await db.run(
        "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
        [rolledUpStatus, currentParentId]
      );
    }

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
    await assertValidParent(db, parent_id ?? null, null, list_id);

    const id = uuidv4();
    await db.run(
      `INSERT INTO tasks (id, list_id, parent_id, title, description, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, list_id, parent_id || null, title, description || '', priority || 'medium', due_date || null]
    );

    // A new pending child can flip a previously-completed parent back to pending.
    if (parent_id) {
      await rollupAncestors(db, parent_id);
      await syncAncestorChain(db, parent_id);
    }

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
    // gcal_event_id is intentionally NOT accepted from clients — only the
    // calendar service may set it. Otherwise a caller could bind a task to an
    // arbitrary Google event and have us patch/delete events they don't own.
    const { title, description, status, priority, due_date, list_id, parent_id } = req.body;

    assertEnum(status, TASK_STATUSES, 'status');
    assertEnum(priority, TASK_PRIORITIES, 'priority');
    if (due_date !== undefined) assertDueDate(due_date);

    const db = await getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!task) throw notFound('Úkol nebyl nalezen.');

    const effectiveListId = list_id !== undefined ? list_id : task.list_id;
    if (list_id !== undefined) await assertListExists(db, list_id);
    // Validate the effective parent whenever parent or list changes, so a task
    // can never end up nested under a parent in a different project.
    const effectiveParentId = parent_id !== undefined ? parent_id : task.parent_id;
    if (parent_id !== undefined || list_id !== undefined) {
      await assertValidParent(db, effectiveParentId, id, effectiveListId);
    }

    // Treat an empty-string due_date the same as null ("remove the date").
    const dueDateProvided = due_date !== undefined;
    const normalizedDueDate = due_date === '' ? null : due_date;
    const removingDueDate = dueDateProvided && normalizedDueDate === null;

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
    if (removingDueDate) sets.push('gcal_event_id = NULL', 'gcal_updated_at = NULL');

    const statusChanged = status !== undefined && status !== task.status;
    const parentChanged = parent_id !== undefined && parent_id !== task.parent_id;
    const listChanged = list_id !== undefined && list_id !== task.list_id;

    // Apply the primary update plus any status/structure propagation atomically.
    await db.run('BEGIN');
    try {
      await db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

      // Moving a task to another project moves its whole subtree, keeping the
      // tree consistent (descendants share their ancestor's list).
      if (listChanged) {
        await db.run(
          `WITH RECURSIVE descendants(id) AS (
             SELECT ?
             UNION ALL
             SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
           )
           UPDATE tasks SET list_id = ?, updated_at = datetime('now') WHERE id IN descendants`,
          [id, list_id]
        );
      }

      if (statusChanged) await cascadeStatusDown(db, id, status);

      // Recompute every ancestor chain affected by this change.
      const parentsToRollup = new Set();
      if (statusChanged) parentsToRollup.add(parent_id !== undefined ? parent_id : task.parent_id);
      if (parentChanged) { parentsToRollup.add(task.parent_id); parentsToRollup.add(parent_id); }
      for (const p of parentsToRollup) if (p) await rollupAncestors(db, p);

      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    // Sync every due-dated task whose status the cascade/rollup may have
    // changed (the task itself, its descendants, and its ancestor chain), so
    // their calendar events don't go stale — not just the edited task.
    const toSync = new Map();
    const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (updated.due_date) toSync.set(updated.id, updated);

    if (statusChanged) {
      const descendants = await db.all(
        `WITH RECURSIVE d(id) AS (
           SELECT ?
           UNION ALL
           SELECT t.id FROM tasks t JOIN d ON t.parent_id = d.id
         )
         SELECT t.* FROM tasks t JOIN d ON t.id = d.id WHERE t.due_date IS NOT NULL`,
        [id]
      );
      for (const t of descendants) toSync.set(t.id, t);

      const seen = new Set();
      let pid = task.parent_id;
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        const ancestor = await db.get('SELECT * FROM tasks WHERE id = ?', [pid]);
        if (!ancestor) break;
        if (ancestor.due_date) toSync.set(ancestor.id, ancestor);
        pid = ancestor.parent_id;
      }
    }

    // Remote delete only after the local change is committed (clears gcal_event_id).
    if (removingDueDate && task.gcal_event_id) await safeDeleteEvent(task.gcal_event_id);

    for (const t of toSync.values()) await safeSync(t);

    // Re-parenting changes the rolled-up status of both the old and new parent
    // chains; keep their due-dated events in sync too.
    if (parentChanged) {
      await syncAncestorChain(db, task.parent_id);
      if (parent_id) await syncAncestorChain(db, parent_id);
    }

    res.json(await db.get('SELECT * FROM tasks WHERE id = ?', [id]));
  })
);

// Delete a task and (via ON DELETE CASCADE) its whole subtree.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    const task = await db.get('SELECT id, parent_id FROM tasks WHERE id = ?', [id]);
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

    // Deleting a parent cascades to its subtasks — require explicit confirmation
    // so one call can't silently wipe a whole subtree.
    if (subtree.length > 1 && req.query.confirm !== 'true') {
      throw badRequest(
        `Úkol má ${subtree.length - 1} podúkolů, které budou také smazány. ` +
          'Zopakujte požadavek s parametrem ?confirm=true.'
      );
    }

    await db.run('DELETE FROM tasks WHERE id = ?', [id]);

    // Removing a child can complete a parent (all remaining children done).
    if (task.parent_id) {
      await rollupAncestors(db, task.parent_id);
      await syncAncestorChain(db, task.parent_id);
    }

    // Remote cleanup only AFTER the local delete succeeded, so a failure here
    // leaves (loggable) orphan events rather than tasks pointing at gone events.
    for (const node of subtree) {
      if (node.gcal_event_id) await safeDeleteEvent(node.gcal_event_id);
    }

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

/** Re-sync every due-dated ancestor whose rolled-up status may have changed. */
async function syncAncestorChain(db, startParentId) {
  const seen = new Set();
  let pid = startParentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const ancestor = await db.get('SELECT * FROM tasks WHERE id = ?', [pid]);
    if (!ancestor) break;
    if (ancestor.due_date) await safeSync(ancestor);
    pid = ancestor.parent_id;
  }
}

export default router;
