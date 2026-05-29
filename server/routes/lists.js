import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getDb, withTransaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, badRequest, notFound } from '../util/http.js';
import { assertNonEmptyString } from '../util/validate.js';
import { isSyncConfigured } from '../services/gcal.js';
import { enqueueDelete, flushOutbox } from '../services/gcalOutbox.js';

const router = express.Router();

router.use(requireAuth);

// List all projects.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    res.json(await db.all('SELECT * FROM lists ORDER BY name ASC'));
  })
);

// Create a project.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, color } = req.body;
    assertNonEmptyString(name, 'name');

    const db = await getDb();
    const id = uuidv4();
    await db.run('INSERT INTO lists (id, name, color) VALUES (?, ?, ?)', [
      id,
      name,
      color || '#6366f1'
    ]);
    res.status(201).json(await db.get('SELECT * FROM lists WHERE id = ?', [id]));
  })
);

// Update a project.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, color } = req.body;

    const db = await getDb();
    const list = await db.get('SELECT * FROM lists WHERE id = ?', [id]);
    if (!list) throw notFound('List nebyl nalezen.');
    if (name !== undefined) assertNonEmptyString(name, 'name');

    await db.run('UPDATE lists SET name = ?, color = ? WHERE id = ?', [
      name ?? list.name,
      color !== undefined ? color : list.color,
      id
    ]);
    res.json(await db.get('SELECT * FROM lists WHERE id = ?', [id]));
  })
);

// Delete a project and all its tasks (cascade). Requires explicit confirmation
// to avoid accidental destructive calls from agents; the count of affected
// tasks is returned so the caller knows the blast radius.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const confirmed = req.query.confirm === 'true';
    const configured = await isSyncConfigured();

    // Existence check, task count + confirmation, synced-event capture, delete,
    // and outbox enqueue ALL run in one transaction so a concurrent insert into
    // the list can't slip a task past the count/confirmation or remote cleanup.
    const { taskCount, queued } = await withTransaction(async (tx) => {
      const list = await tx.get('SELECT id FROM lists WHERE id = ?', [id]);
      if (!list) throw notFound('List nebyl nalezen.');

      const count = (await tx.get('SELECT COUNT(*) AS count FROM tasks WHERE list_id = ?', [id])).count;
      if (count > 0 && !confirmed) {
        throw badRequest(
          `Projekt obsahuje ${count} úkolů, které budou smazány. ` +
            'Zopakujte požadavek s parametrem ?confirm=true.'
        );
      }

      const synced = await tx.all(
        'SELECT gcal_event_id FROM tasks WHERE list_id = ? AND gcal_event_id IS NOT NULL',
        [id]
      );

      // Delete the project's tasks EXPLICITLY first (robust even if a legacy DB
      // lacks the ON DELETE CASCADE), then the project itself.
      await tx.run('DELETE FROM tasks WHERE list_id = ?', [id]);
      await tx.run('DELETE FROM lists WHERE id = ?', [id]);

      if (configured) {
        for (const { gcal_event_id } of synced) await enqueueDelete(gcal_event_id, tx);
      }
      return { taskCount: count, queued: synced.length };
    });

    if (configured && queued) await flushOutbox();
    res.json({ success: true, deleted_id: id, deleted_task_count: taskCount });
  })
);

export default router;
