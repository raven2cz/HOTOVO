import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getDb, withTransaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, badRequest, notFound } from '../util/http.js';
import {
  assertEnum,
  assertDueDate,
  assertNonEmptyString,
  assertRecurrence,
  assertTags,
  TASK_STATUSES,
  TASK_PRIORITIES
} from '../util/validate.js';
import { isSyncConfigured } from '../services/gcal.js';
import { enqueueUpsert, enqueueDelete, flushOutbox } from '../services/gcalOutbox.js';

const router = express.Router();

router.use(requireAuth);

/** Collect a task's ancestor ids (parent chain), bounded against cycles. */
async function ancestorIds(db, startParentId) {
  const ids = [];
  const seen = new Set();
  let pid = startParentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    ids.push(pid);
    const a = await db.get('SELECT parent_id FROM tasks WHERE id = ?', [pid]);
    if (!a) break;
    pid = a.parent_id;
  }
  return ids;
}

/** Collect a task's descendant ids (excluding itself). */
async function descendantIds(db, id) {
  const rows = await db.all(
    `WITH RECURSIVE d(id) AS (
       SELECT ?
       UNION ALL
       SELECT t.id FROM tasks t JOIN d ON t.parent_id = d.id
     )
     SELECT id FROM d WHERE id != ?`,
    [id, id]
  );
  return rows.map((r) => r.id);
}

/**
 * Enqueue Google Calendar work on the given (transaction) connection, so the
 * queue entries commit atomically with the DB change that triggered them.
 * Upserts for tasks without a due date are dropped later by the drainer.
 */
async function enqueueSyncTargets(tx, { upsertIds = [], deleteEventIds = [] }) {
  for (const taskId of new Set(upsertIds)) await enqueueUpsert(taskId, tx);
  for (const eventId of new Set(deleteEventIds)) await enqueueDelete(eventId, tx);
}

/** Parse the stored `tags` JSON string into an array for API responses. */
function serializeTask(row) {
  if (!row) return row;
  let tags = [];
  if (row.tags) {
    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed)) tags = parsed;
    } catch {
      /* legacy/garbage value → empty */
    }
  }
  return { ...row, tags };
}

/** Advance a due date by one recurrence step. Returns null if not applicable. */
function nextDueDate(due, recurrence) {
  if (!due || !recurrence) return null;
  const isDateOnly = typeof due === 'string' && due.length === 10;
  const base = new Date(isDateOnly ? `${due}T00:00:00Z` : due);
  if (Number.isNaN(base.getTime())) return null;
  if (recurrence === 'daily') {
    base.setUTCDate(base.getUTCDate() + 1);
  } else if (recurrence === 'weekly') {
    base.setUTCDate(base.getUTCDate() + 7);
  } else if (recurrence === 'monthly') {
    // Advance one month, clamping the day so 2026-01-31 -> 2026-02-28 (not March).
    const day = base.getUTCDate();
    base.setUTCDate(1);
    base.setUTCMonth(base.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(day, lastDay));
  } else {
    return null;
  }
  return isDateOnly ? base.toISOString().slice(0, 10) : base.toISOString();
}

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
    const { list_id, status, priority, due_date, search, tag, due } = req.query;
    assertEnum(status, TASK_STATUSES, 'status');
    assertEnum(priority, TASK_PRIORITIES, 'priority');

    const db = await getDb();
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (list_id) { query += ' AND list_id = ?'; params.push(list_id); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (priority) { query += ' AND priority = ?'; params.push(priority); }
    if (due_date) { query += ' AND date(due_date) = date(?)'; params.push(due_date); }

    // Full-text-ish substring search across title + description. Escape LIKE
    // wildcards so the query keeps literal-substring semantics.
    if (search) {
      const like = `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
      query += " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
      params.push(like, like);
    }

    // Tag membership (tags stored as a JSON array of strings). Escape LIKE
    // wildcards so a tag like "%" can't match everything.
    if (tag) {
      const needle = JSON.stringify(String(tag)).replace(/[\\%_]/g, '\\$&');
      query += " AND tags LIKE ? ESCAPE '\\'";
      params.push(`%${needle}%`);
    }

    // Relative due-date windows (server-local day boundaries).
    if (due === 'overdue') {
      query += " AND due_date IS NOT NULL AND date(due_date) < date('now','localtime') AND status != 'completed'";
    } else if (due === 'today') {
      query += " AND date(due_date) = date('now','localtime')";
    } else if (due === 'week') {
      query += " AND date(due_date) >= date('now','localtime') AND date(due_date) < date('now','localtime','+7 days')";
    }

    query += ' ORDER BY created_at ASC';
    const rows = await db.all(query, params);
    res.json(rows.map(serializeTask));
  })
);

// Create a task (or subtask when parent_id is provided).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title, description, list_id, parent_id, priority, due_date, recurrence, tags } = req.body;

    assertNonEmptyString(title, 'title');
    assertNonEmptyString(list_id, 'list_id');
    assertEnum(priority, TASK_PRIORITIES, 'priority');
    assertDueDate(due_date);
    // Recurrence applies to top-level tasks only — never store it on a subtask.
    const normalizedRecurrence = parent_id ? null : assertRecurrence(recurrence) ?? null;
    const normalizedTags = assertTags(tags);
    const tagsJson = normalizedTags && normalizedTags.length ? JSON.stringify(normalizedTags) : null;

    const db = await getDb();
    const id = uuidv4();
    const configured = await isSyncConfigured();

    // Validate references AND insert in the same transaction so a concurrent
    // change can't invalidate the checks between validation and write.
    await withTransaction(async (tx) => {
      await assertListExists(tx, list_id);
      await assertValidParent(tx, parent_id ?? null, null, list_id);
      await tx.run(
        `INSERT INTO tasks (id, list_id, parent_id, title, description, priority, due_date, recurrence, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, list_id, parent_id || null, title, description || '', priority || 'medium', due_date || null, normalizedRecurrence, tagsJson]
      );

      // A new pending child can flip a previously-completed parent back to pending.
      const upsertIds = [id];
      if (parent_id) {
        await rollupAncestors(tx, parent_id);
        upsertIds.push(...(await ancestorIds(tx, parent_id)));
      }
      if (configured) await enqueueSyncTargets(tx, { upsertIds });
    });

    if (configured) await flushOutbox();
    res.status(201).json(serializeTask(await db.get('SELECT * FROM tasks WHERE id = ?', [id])));
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
    const { title, description, status, priority, due_date, list_id, parent_id, recurrence, tags } = req.body;

    assertEnum(status, TASK_STATUSES, 'status');
    assertEnum(priority, TASK_PRIORITIES, 'priority');
    // Normalize "" (clear the date) to null BEFORE validating, so clearing a
    // date isn't rejected as an invalid date.
    const dueDateProvided = due_date !== undefined;
    const normalizedDueDate = due_date === '' ? null : due_date;
    if (dueDateProvided) assertDueDate(normalizedDueDate);
    const recurrenceProvided = recurrence !== undefined;
    const normalizedRecurrence = assertRecurrence(recurrence);
    const tagsProvided = tags !== undefined;
    const normalizedTags = assertTags(tags);
    const tagsJson = normalizedTags && normalizedTags.length ? JSON.stringify(normalizedTags) : null;

    const db = await getDb();
    const configured = await isSyncConfigured();

    // Read the task, validate references, and write — all inside one
    // transaction. Doing the existence/cycle checks against the SAME connection
    // immediately before the write closes the TOCTOU window where two concurrent
    // re-parents could validate against the old tree and then form a cycle.
    await withTransaction(async (tx) => {
      const task = await tx.get('SELECT * FROM tasks WHERE id = ?', [id]);
      if (!task) throw notFound('Úkol nebyl nalezen.');

      const effectiveListId = list_id !== undefined ? list_id : task.list_id;
      if (list_id !== undefined) await assertListExists(tx, list_id);
      const effectiveParentId = parent_id !== undefined ? parent_id : task.parent_id;
      if (parent_id !== undefined || list_id !== undefined) {
        await assertValidParent(tx, effectiveParentId, id, effectiveListId);
      }

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
      if (recurrenceProvided) setField('recurrence', normalizedRecurrence);
      if (tagsProvided) setField('tags', tagsJson);
      if (removingDueDate) sets.push('gcal_event_id = NULL', 'gcal_updated_at = NULL');

      const statusChanged = status !== undefined && status !== task.status;
      const parentChanged = parent_id !== undefined && parent_id !== task.parent_id;
      const listChanged = list_id !== undefined && list_id !== task.list_id;

      await tx.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

      // Moving a task to another project moves its whole subtree, keeping the
      // tree consistent (descendants share their ancestor's list).
      if (listChanged) {
        await tx.run(
          `WITH RECURSIVE descendants(id) AS (
             SELECT ?
             UNION ALL
             SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
           )
           UPDATE tasks SET list_id = ?, updated_at = datetime('now') WHERE id IN descendants`,
          [id, list_id]
        );
      }

      if (statusChanged) await cascadeStatusDown(tx, id, status);

      // Recompute every ancestor chain affected by this change.
      const parentsToRollup = new Set();
      if (statusChanged) parentsToRollup.add(parent_id !== undefined ? parent_id : task.parent_id);
      if (parentChanged) { parentsToRollup.add(task.parent_id); parentsToRollup.add(parent_id); }
      for (const p of parentsToRollup) if (p) await rollupAncestors(tx, p);

      // Ticking a recurring task doesn't "finish" it — it rolls forward: advance
      // its due date to the next occurrence and reopen it (resetting its subtask
      // checklist) instead of completing. This is a single-row update, so there
      // are no duplicate occurrences and no tree corruption. Recurrence applies to
      // TOP-LEVEL tasks only (a recurring subtask would muddle its parent).
      if (statusChanged && status === 'completed' && !task.parent_id) {
        const cur = await tx.get('SELECT recurrence, due_date FROM tasks WHERE id = ?', [id]);
        const next = nextDueDate(cur.due_date, cur.recurrence);
        if (next) {
          await tx.run(
            "UPDATE tasks SET status = 'pending', due_date = ?, updated_at = datetime('now') WHERE id = ?",
            [next, id]
          );
          await cascadeStatusDown(tx, id, 'pending'); // reset the checklist for next time
        }
      }

      // Queue calendar sync for every task whose status may have changed (self +
      // descendants + affected ancestor chains), plus a delete for the event
      // detached when a due date is removed. Atomic with the update above.
      if (configured) {
        const upsertIds = new Set();
        // The edited task is re-synced unless it just lost its due date.
        if (!removingDueDate) upsertIds.add(id);
        if (statusChanged) {
          for (const d of await descendantIds(tx, id)) upsertIds.add(d);
          for (const a of await ancestorIds(tx, task.parent_id)) upsertIds.add(a);
        }
        if (parentChanged) {
          for (const a of await ancestorIds(tx, task.parent_id)) upsertIds.add(a);
          if (parent_id) for (const a of await ancestorIds(tx, parent_id)) upsertIds.add(a);
        }
        await enqueueSyncTargets(tx, { upsertIds: [...upsertIds] });
        // Tie this delete to the task so re-adding a due date before it drains
        // cancels it (avoids deleting a freshly re-linked event).
        if (removingDueDate && task.gcal_event_id) {
          await enqueueDelete(task.gcal_event_id, tx, id);
        }
      }
    });

    if (configured) await flushOutbox();
    res.json(serializeTask(await db.get('SELECT * FROM tasks WHERE id = ?', [id])));
  })
);

// Delete a task and (via ON DELETE CASCADE) its whole subtree.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    const confirmed = req.query.confirm === 'true';
    const configured = await isSyncConfigured();

    // Enumerate the subtree, confirm, delete, roll up, and queue remote cleanup
    // ALL inside one transaction. Enumerating inside the same transaction as the
    // delete closes the window where a concurrent request could add a child
    // after the count/confirm but before the cascade removes it.
    const deletedCount = await withTransaction(async (tx) => {
      const task = await tx.get('SELECT id, parent_id FROM tasks WHERE id = ?', [id]);
      if (!task) throw notFound('Úkol nebyl nalezen.');

      const subtree = await tx.all(
        `WITH RECURSIVE descendants(id) AS (
           SELECT ?
           UNION ALL
           SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
         )
         SELECT t.id, t.gcal_event_id FROM tasks t JOIN descendants d ON t.id = d.id`,
        [id]
      );

      // Deleting a parent cascades to its subtasks — require explicit confirmation.
      if (subtree.length > 1 && !confirmed) {
        throw badRequest(
          `Úkol má ${subtree.length - 1} podúkolů, které budou také smazány. ` +
            'Zopakujte požadavek s parametrem ?confirm=true.'
        );
      }

      const deleteEventIds = subtree.filter((n) => n.gcal_event_id).map((n) => n.gcal_event_id);

      await tx.run('DELETE FROM tasks WHERE id = ?', [id]);

      const upsertIds = [];
      if (task.parent_id) {
        await rollupAncestors(tx, task.parent_id);
        upsertIds.push(...(await ancestorIds(tx, task.parent_id)));
      }
      if (configured) await enqueueSyncTargets(tx, { upsertIds, deleteEventIds });

      return subtree.length;
    });

    if (configured) await flushOutbox();
    res.json({ success: true, deleted_id: id, deleted_count: deletedCount });
  })
);

export default router;
