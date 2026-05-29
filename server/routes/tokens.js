import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getDb, withTransaction } from '../db.js';
import { requireAuth, requireLocalUi, generateToken, hashToken } from '../auth.js';
import { asyncHandler, badRequest, notFound } from '../util/http.js';
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

    // Serialise the count-then-delete so two concurrent deletes can't both pass
    // the "keep at least one" check and wipe every token.
    await withTransaction(async (tx) => {
      const tokenCount = await tx.get('SELECT COUNT(*) AS count FROM api_tokens');
      if (tokenCount.count <= 1) {
        throw badRequest('Nelze smazat poslední token. Vždy musí existovat alespoň jeden.');
      }
      const result = await tx.run('DELETE FROM api_tokens WHERE id = ?', [id]);
      if (result.changes === 0) {
        throw notFound('Token nebyl nalezen.');
      }
    });

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
    .replace(/[\r\n]+/g, ' ') // collapse newlines so text can't forge headings/list items
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`[\]()!])/g, '\\$1');
}

/** Format a due date for display, parsing date-only values as LOCAL (no UTC day shift). */
function formatDueDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return d.toLocaleDateString('cs-CZ');
}

/** Neutralise spreadsheet formula injection in exported CSV cells. */
function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Prefix a quote if the cell is (after optional leading whitespace) a formula,
  // or starts with tab/CR/LF that a parser might strip to expose one.
  if (/^[\s]*[=+\-@]/.test(str) || /^[\t\r\n]/.test(str)) str = `'${str}`;
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
        const dueDate = task.due_date ? ` 📅 *${formatDueDate(task.due_date)}*` : '';
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
