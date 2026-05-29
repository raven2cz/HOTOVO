import express from 'express';
import { getDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from './tasks.js';

const router = express.Router();

// Get API tokens (for frontend settings page)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const tokens = await db.all('SELECT id, name, token, created_at FROM api_tokens ORDER BY created_at DESC');
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new API token
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nazev tokenu je povinny' });
    }

    const db = await getDb();
    const id = uuidv4();
    // Generate a secure looking token
    const token = 'agent-' + uuidv4().replace(/-/g, '').substring(0, 24);

    await db.run(
      'INSERT INTO api_tokens (id, token, name) VALUES (?, ?, ?)',
      [id, token, name]
    );

    const newToken = await db.get('SELECT * FROM api_tokens WHERE id = ?', [id]);
    res.status(201).json(newToken);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete (revoke) an API token
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    // Check count to prevent deleting last token if they need it (optional)
    const tokenCount = await db.get('SELECT COUNT(*) as count FROM api_tokens');
    if (tokenCount.count <= 1) {
      return res.status(400).json({ error: 'Nelze smazat posledni token. Vzdy musi existovat alespon jeden token pro AI agenty.' });
    }

    await db.run('DELETE FROM api_tokens WHERE id = ?', [id]);
    res.json({ success: true, message: 'Token byl zneplatnen', deleted_id: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export all lists and tasks in JSON or Markdown format
router.get('/export-data', authenticateToken, async (req, res) => {
  try {
    const { format } = req.query; // 'json' or 'markdown' or 'csv'
    const db = await getDb();

    const lists = await db.all('SELECT * FROM lists');
    const tasks = await db.all('SELECT * FROM tasks');

    if (format === 'markdown') {
      let md = '# Export Todo Listů (' + new Date().toLocaleDateString('cs-CZ') + ')\n\n';

      for (const list of lists) {
        md += `## 📁 ${list.name}\n\n`;
        const listTasks = tasks.filter(t => t.list_id === list.id && !t.parent_id);
        
        if (listTasks.length === 0) {
          md += '*Žádné úkoly*\n\n';
          continue;
        }

        const buildTaskTree = (task, depth = 0) => {
          const indent = '  '.repeat(depth);
          const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
          const priorityMap = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' };
          const priority = priorityMap[task.priority] || '';
          const dueDate = task.due_date ? ` 📅 *${new Date(task.due_date).toLocaleDateString('cs-CZ')}*` : '';
          
          let taskLine = `${indent}- ${checkbox} ${priority} **${task.title}**${dueDate}\n`;
          if (task.description) {
            taskLine += `${indent}  *${task.description}*\n`;
          }

          // Fetch child tasks
          const children = tasks.filter(t => t.parent_id === task.id);
          for (const child of children) {
            taskLine += buildTaskTree(child, depth + 1);
          }
          return taskLine;
        };

        for (const task of listTasks) {
          md += buildTaskTree(task, 0);
        }
        md += '\n';
      }

      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', 'attachment; filename=todo_export.md');
      return res.send(md);
    }

    if (format === 'csv') {
      let csv = 'ID;Projekt;Nadřazený úkol;Název;Popis;Stav;Priorita;Termín;Vytvořeno\n';
      for (const task of tasks) {
        const list = lists.find(l => l.id === task.list_id);
        const parent = tasks.find(t => t.id === task.parent_id);
        
        const listName = list ? list.name : '';
        const parentTitle = parent ? parent.title : '';
        
        const cleanVal = (val) => val ? String(val).replace(/"/g, '""').replace(/;/g, ',').replace(/\n/g, ' ') : '';
        
        csv += `"${cleanVal(task.id)}";"${cleanVal(listName)}";"${cleanVal(parentTitle)}";"${cleanVal(task.title)}";"${cleanVal(task.description)}";"${cleanVal(task.status)}";"${cleanVal(task.priority)}";"${cleanVal(task.due_date)}";"${cleanVal(task.created_at)}"\n`;
      }
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=todo_export.csv');
      return res.send(csv);
    }

    // Default JSON export
    const data = lists.map(list => {
      const buildTree = (parentId = null) => {
        return tasks
          .filter(t => t.list_id === list.id && t.parent_id === parentId)
          .map(t => ({
            ...t,
            subtasks: buildTree(t.id)
          }));
      };
      return {
        id: list.id,
        name: list.name,
        color: list.color,
        tasks: buildTree(null)
      };
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
