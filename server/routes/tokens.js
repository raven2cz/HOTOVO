import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getDb } from '../db.js';
import { requireAuth, requireLocalUi, generateToken, hashToken } from '../auth.js';
import { asyncHandler, badRequest } from '../util/http.js';
import { assertNonEmptyString } from '../util/validate.js';

const router = express.Router();

router.use(requireAuth);

// Token management (list/create/revoke) is restricted to the local UI so a
// leaked agent token cannot enumerate, mint, or revoke tokens.
// List tokens. Only non-sensitive metadata is returned — never the raw token
// or its hash.
router.get(
  '/',
  requireLocalUi,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    res.json(
      await db.all('SELECT id, name, created_at FROM api_tokens ORDER BY created_at DESC')
    );
  })
);

// Create a token. The raw value is returned exactly once; only its hash is
// persisted, so it cannot be recovered later.
router.post(
  '/',
  requireLocalUi,
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    assertNonEmptyString(name, 'name');

    const db = await getDb();
    const id = uuidv4();
    const rawToken = generateToken();
    await db.run('INSERT INTO api_tokens (id, token_hash, name) VALUES (?, ?, ?)', [
      id,
      hashToken(rawToken),
      name
    ]);

    res.status(201).json({ id, name, token: rawToken, created_at: new Date().toISOString() });
  })
);

// Revoke a token. At least one token must always remain.
router.delete(
  '/:id',
  requireLocalUi,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    // Serialise the count-then-delete so two concurrent deletes can't both pass
    // the "keep at least one" check and wipe every token.
    await db.run('BEGIN IMMEDIATE');
    try {
      const tokenCount = await db.get('SELECT COUNT(*) AS count FROM api_tokens');
      if (tokenCount.count <= 1) {
        throw badRequest('Nelze smazat poslední token. Vždy musí existovat alespoň jeden.');
      }
      await db.run('DELETE FROM api_tokens WHERE id = ?', [id]);
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ success: true, deleted_id: id });
  })
);

/**
 * Escape user text for Markdown export: HTML metacharacters (for HTML-enabled
 * renderers) plus Markdown link/image/code syntax, so a title like
 * `[x](javascript:...)` or `` `code` `` cannot become an active link/markup.
 */
function mdEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`[\]()!])/g, '\\$1');
}

/** Neutralise spreadsheet formula injection in exported CSV cells. */
function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

// Export all lists and tasks as JSON, Markdown or CSV.
router.get(
  '/export-data',
  asyncHandler(async (req, res) => {
    const { format } = req.query;
    const db = await getDb();

    const lists = await db.all('SELECT * FROM lists');
    const tasks = await db.all('SELECT * FROM tasks');
    const childrenOf = (parentId) => tasks.filter((t) => t.parent_id === parentId);

    if (format === 'markdown') {
      let md = `# Export Todo Listů (${new Date().toLocaleDateString('cs-CZ')})\n\n`;
      const priorityMap = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' };

      const renderTask = (task, depth, seen) => {
        if (seen.has(task.id)) return '';
        seen.add(task.id);
        const indent = '  '.repeat(depth);
        const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
        const priority = priorityMap[task.priority] || '';
        const dueDate = task.due_date
          ? ` 📅 *${new Date(task.due_date).toLocaleDateString('cs-CZ')}*`
          : '';
        let line = `${indent}- ${checkbox} ${priority} **${mdEscape(task.title)}**${dueDate}\n`;
        if (task.description) line += `${indent}  *${mdEscape(task.description)}*\n`;
        for (const child of childrenOf(task.id)) line += renderTask(child, depth + 1, seen);
        return line;
      };

      const seen = new Set();
      for (const list of lists) {
        md += `## 📁 ${mdEscape(list.name)}\n\n`;
        const roots = tasks.filter((t) => t.list_id === list.id && !t.parent_id);
        if (roots.length === 0) { md += '*Žádné úkoly*\n\n'; continue; }
        for (const task of roots) md += renderTask(task, 0, seen);
        md += '\n';
      }

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=todo_export.md');
      return res.send(md);
    }

    if (format === 'csv') {
      const header = ['ID', 'Projekt', 'Nadřazený úkol', 'Název', 'Popis', 'Stav', 'Priorita', 'Termín', 'Vytvořeno'];
      const rows = [header.map(csvCell).join(';')];
      for (const task of tasks) {
        const list = lists.find((l) => l.id === task.list_id);
        const parent = tasks.find((t) => t.id === task.parent_id);
        rows.push(
          [
            task.id,
            list ? list.name : '',
            parent ? parent.title : '',
            task.title,
            task.description,
            task.status,
            task.priority,
            task.due_date,
            task.created_at
          ]
            .map(csvCell)
            .join(';')
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=todo_export.csv');
      return res.send(`${rows.join('\n')}\n`);
    }

    // Default: JSON. Build a per-list tree, guarding against cyclic parents.
    const data = lists.map((list) => {
      const buildTree = (parentId, seen) =>
        tasks
          .filter((t) => t.list_id === list.id && t.parent_id === parentId && !seen.has(t.id))
          .map((t) => {
            seen.add(t.id);
            return { ...t, subtasks: buildTree(t.id, seen) };
          });
      return {
        id: list.id,
        name: list.name,
        color: list.color,
        tasks: buildTree(null, new Set())
      };
    });

    res.json(data);
  })
);

export default router;
