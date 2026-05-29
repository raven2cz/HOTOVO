import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, badRequest, notFound } from '../util/http.js';
import { assertNonEmptyString } from '../util/validate.js';
import { deleteGoogleEvent } from '../services/gcal.js';

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
    const db = await getDb();

    const list = await db.get('SELECT * FROM lists WHERE id = ?', [id]);
    if (!list) throw notFound('List nebyl nalezen.');

    const taskCount = await db.get('SELECT COUNT(*) AS count FROM tasks WHERE list_id = ?', [id]);

    if (taskCount.count > 0 && req.query.confirm !== 'true') {
      throw badRequest(
        `Projekt obsahuje ${taskCount.count} úkolů, které budou smazány. ` +
          'Zopakujte požadavek s parametrem ?confirm=true.'
      );
    }

    // Clean up Google Calendar events for the project's tasks before the DB
    // cascade removes them (best-effort; failures must not block deletion).
    const synced = await db.all(
      'SELECT gcal_event_id FROM tasks WHERE list_id = ? AND gcal_event_id IS NOT NULL',
      [id]
    );
    for (const { gcal_event_id } of synced) {
      try {
        await deleteGoogleEvent(gcal_event_id);
      } catch (err) {
        console.warn(`[gcal] event delete failed (${gcal_event_id}): ${err.message}`);
      }
    }

    await db.run('DELETE FROM lists WHERE id = ?', [id]);
    res.json({ success: true, deleted_id: id, deleted_task_count: taskCount.count });
  })
);

export default router;
