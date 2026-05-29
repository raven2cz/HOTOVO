import express from 'express';
import { getDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from './tasks.js';

const router = express.Router();

// Get all lists
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const lists = await db.all('SELECT * FROM lists ORDER BY name ASC');
    res.json(lists);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new list
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nazev listu je povinny' });
    }

    const db = await getDb();
    const id = uuidv4();
    await db.run(
      'INSERT INTO lists (id, name, color) VALUES (?, ?, ?)',
      [id, name, color || '#6366f1']
    );

    const newList = await db.get('SELECT * FROM lists WHERE id = ?', [id]);
    res.status(201).json(newList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a list
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const db = await getDb();
    const list = await db.get('SELECT * FROM lists WHERE id = ?', [id]);

    if (!list) {
      return res.status(404).json({ error: 'List nebyl nalezen' });
    }

    let query = 'UPDATE lists SET name = ?';
    const params = [name || list.name];

    if (color !== undefined) {
      query += ', color = ?';
      params.push(color);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.run(query, params);
    const updatedList = await db.get('SELECT * FROM lists WHERE id = ?', [id]);
    res.json(updatedList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a list
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const list = await db.get('SELECT * FROM lists WHERE id = ?', [id]);

    if (!list) {
      return res.status(404).json({ error: 'List nebyl nalezen' });
    }

    await db.run('DELETE FROM lists WHERE id = ?', [id]);
    res.json({ success: true, message: 'List byl smazan a pridruzene ukoly taky', deleted_id: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
