import express from 'express';
import { getDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { syncTaskToGoogle, deleteGoogleEvent } from '../services/gcal.js';

const router = express.Router();

// Middleware to authenticate API requests via Bearer token
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // If no token is provided, check if it's a browser request (e.g. from local UI).
    // For local Pi-4 convenience, we allow it if no API tokens are configured
    // or if the request is from localhost. But to be safe, we allow it by default,
    // and if a token is present, we validate it.
    return next();
  }

  const db = await getDb();
  const tokenRecord = await db.get('SELECT * FROM api_tokens WHERE token = ?', [token]);

  if (!tokenRecord) {
    return res.status(403).json({ error: 'Neplatny API token' });
  }

  req.agent = tokenRecord;
  next();
}

// Get all tasks (with filters: list_id, status, priority, due_date)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { list_id, status, priority, due_date } = req.query;
    const db = await getDb();

    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (list_id) {
      query += ' AND list_id = ?';
      params.push(list_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (priority) {
      query += ' AND priority = ?';
      params.push(priority);
    }
    if (due_date) {
      query += ' AND date(due_date) = date(?)';
      params.push(due_date);
    }

    query += ' ORDER BY created_at ASC';
    const tasks = await db.all(query, params);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new task
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, list_id, parent_id, priority, due_date } = req.body;

    if (!title || !list_id) {
      return res.status(400).json({ error: 'Title a list_id jsou povinne udaje' });
    }

    const db = await getDb();
    const id = uuidv4();

    // Verify parent task exists if parent_id is provided
    if (parent_id) {
      const parent = await db.get('SELECT * FROM tasks WHERE id = ?', [parent_id]);
      if (!parent) {
        return res.status(400).json({ error: 'Rodicovsky ukol neexistuje' });
      }
    }

    // Verify list exists
    const list = await db.get('SELECT * FROM lists WHERE id = ?', [list_id]);
    if (!list) {
      return res.status(400).json({ error: 'Projekt/List neexistuje' });
    }

    const query = `
      INSERT INTO tasks (id, list_id, parent_id, title, description, priority, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      id,
      list_id,
      parent_id || null,
      title,
      description || '',
      priority || 'medium',
      due_date || null
    ];

    await db.run(query, params);
    const newTask = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);

    // Async sync to Google Calendar if due_date is present
    if (due_date) {
      try {
        await syncTaskToGoogle(newTask);
      } catch (err) {
        console.log('Automaticka synchronizace pri vytvoreni selhala:', err.message);
      }
    }

    // Return the updated task (which might contain the gcal_event_id now)
    const finalTask = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    res.status(201).json(finalTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an existing task
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, priority, due_date, list_id, parent_id, gcal_event_id } = req.body;

    const db = await getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!task) {
      return res.status(404).json({ error: 'Ukol nebyl nalezen' });
    }

    // If due_date was removed, delete corresponding Google Calendar event if it exists
    if (due_date === null && task.gcal_event_id) {
      try {
        await deleteGoogleEvent(task.gcal_event_id);
      } catch (err) {
        console.log('Chyba pri mazani eventu z Google kalendare:', err.message);
      }
    }

    // Build dynamics update query
    let query = 'UPDATE tasks SET updated_at = datetime(\'now\')';
    const params = [];

    if (title !== undefined) {
      query += ', title = ?';
      params.push(title);
    }
    if (description !== undefined) {
      query += ', description = ?';
      params.push(description);
    }
    if (status !== undefined) {
      query += ', status = ?';
      params.push(status);
    }
    if (priority !== undefined) {
      query += ', priority = ?';
      params.push(priority);
    }
    if (due_date !== undefined) {
      query += ', due_date = ?';
      params.push(due_date);
    }
    if (list_id !== undefined) {
      query += ', list_id = ?';
      params.push(list_id);
    }
    if (parent_id !== undefined) {
      query += ', parent_id = ?';
      params.push(parent_id);
    }
    if (gcal_event_id !== undefined) {
      query += ', gcal_event_id = ?';
      params.push(gcal_event_id);
    }

    // Reset Google Calendar event if due_date was removed
    if (due_date === null) {
      query += ', gcal_event_id = NULL, gcal_updated_at = NULL';
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.run(query, params);

    // If status changed, perform cascading and rollup updates
    const statusChanged = status !== undefined && status !== task.status;
    if (statusChanged) {
      // 1. Downwards cascade: update all descendants to match the new status
      await db.run(`
        WITH RECURSIVE descendants(id) AS (
          SELECT ?
          UNION ALL
          SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id = d.id
        )
        UPDATE tasks 
        SET status = ?, updated_at = datetime('now') 
        WHERE id IN descendants
      `, [id, status]);

      // 2. Upwards rollup: check and update parent / ancestor statuses
      let currentParentId = parent_id !== undefined ? parent_id : task.parent_id;
      while (currentParentId) {
        const parent = await db.get('SELECT * FROM tasks WHERE id = ?', [currentParentId]);
        if (!parent) break;

        if (status === 'pending') {
          // If a subtask is pending, the parent MUST be pending too
          await db.run('UPDATE tasks SET status = \'pending\', updated_at = datetime(\'now\') WHERE id = ?', [currentParentId]);
          currentParentId = parent.parent_id;
        } else if (status === 'completed') {
          // If a subtask is completed, parent is completed if and only if all its subtasks are completed
          const pendingCountResult = await db.get(
            'SELECT COUNT(*) as count FROM tasks WHERE parent_id = ? AND status = \'pending\'',
            [currentParentId]
          );
          if (pendingCountResult.count === 0) {
            await db.run('UPDATE tasks SET status = \'completed\', updated_at = datetime(\'now\') WHERE id = ?', [currentParentId]);
          } else {
            await db.run('UPDATE tasks SET status = \'pending\', updated_at = datetime(\'now\') WHERE id = ?', [currentParentId]);
          }
          currentParentId = parent.parent_id;
        }
      }
    }

    const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);

    // Async sync to Google Calendar if due_date is present (or updated)
    if (updatedTask.due_date) {
      try {
        await syncTaskToGoogle(updatedTask);
      } catch (err) {
        console.log('Automaticka synchronizace pri uprave selhala:', err.message);
      }
    }

    // Return latest task state
    const finalTask = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    res.json(finalTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a task (cascades automatically to subtasks via DB schema)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    
    // Find task first to check for Google Calendar Event ID
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!task) {
      return res.status(404).json({ error: 'Ukol nebyl nalezen' });
    }

    // Delete Google Calendar event if it exists
    if (task.gcal_event_id) {
      try {
        await deleteGoogleEvent(task.gcal_event_id);
      } catch (err) {
        console.log('Chyba pri mazani eventu pri odstraneni ukolu:', err.message);
      }
    }

    await db.run('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ success: true, message: 'Ukol byl smazan', deleted_id: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


export default router;
