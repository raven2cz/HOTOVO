import express from 'express';

import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util/http.js';

const router = express.Router();

router.use(requireAuth);

/**
 * One-call snapshot of everything an agent needs: all projects and all tasks
 * (flat, with parent_id so the agent can reconstruct the tree). Cheap context
 * for a single LLM turn — avoids N calls to assemble state.
 */
router.get(
  '/state',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const [lists, taskRows] = await Promise.all([
      db.all('SELECT id, name, color FROM lists ORDER BY name ASC'),
      db.all(
        `SELECT id, list_id, parent_id, title, description, status, priority, due_date, recurrence, tags
         FROM tasks ORDER BY created_at ASC`
      )
    ]);
    // Parse the JSON tags column into an array for agents.
    const tasks = taskRows.map((t) => {
      let tags = [];
      try {
        if (t.tags) tags = JSON.parse(t.tags) || [];
      } catch {
        tags = [];
      }
      return { ...t, tags };
    });
    res.json({
      generated_at: new Date().toISOString(),
      counts: {
        lists: lists.length,
        tasks: tasks.length,
        pending: tasks.filter((t) => t.status === 'pending').length,
        completed: tasks.filter((t) => t.status === 'completed').length
      },
      lists,
      tasks
    });
  })
);

/**
 * A compact, copy-pasteable operating guide for an LLM agent. Designed to drop
 * straight into a system prompt for small/local models (e.g. Gemma): short,
 * explicit, example-driven, with the few rules that trip agents up.
 */
function buildGuide() {
  return `# HOTOVO — průvodce pro AI agenty

Jsi napojen na HOTOVO, aplikaci na správu úkolů. Pracuješ přes REST API.

## Připojení
- Základní URL: stejný původ (origin), ze kterého jsi načetl tento návod.
  Všechny cesty níže jsou relativní a začínají \`/api/…\`.
- Autentizace (nelokální klient): hlavička \`Authorization: Bearer <TOKEN>\`
- Vždy posílej \`Content-Type: application/json\` u POST/PUT.

## Než začneš: načti stav jedním voláním
\`GET /api/agent/state\` → \`{ lists, tasks, counts }\`. Úkoly jsou ploché; strom
sestavíš podle \`parent_id\`. Použij to na začátku, ať víš, co existuje.

## Pojmy
- **Projekt (list)**: skupina úkolů. Má \`id\`, \`name\`, \`color\`.
- **Úkol (task)**: \`id\`, \`list_id\`, \`parent_id\` (podúkol), \`title\`,
  \`description\`, \`status\`, \`priority\`, \`due_date\`.
- \`status\`: \`pending\` | \`completed\`
- \`priority\`: \`low\` | \`medium\` | \`high\` | \`urgent\`
- \`due_date\`: \`YYYY-MM-DD\` (celý den) NEBO plné ISO 8601 s časovou zónou
  (např. \`2026-06-01T09:00:00Z\`). Jiné formáty server odmítne.
- \`recurrence\`: \`daily\` | \`weekly\` | \`monthly\` | \`none\`. Dokončením
  opakovaného úkolu (musí mít \`due_date\`) se automaticky vytvoří další výskyt.
- \`tags\`: pole řetězců (štítky napříč projekty), např. \`["práce","urgent"]\`.

## Operace (to hlavní, co budeš dělat)
1) Vytvořit úkol:
   \`POST /api/tasks\` \`{ "title": "...", "list_id": "<id>", "priority": "medium", "due_date": "2026-06-01" }\`
   - Podúkol: přidej \`"parent_id": "<id_rodiče>"\`. Rodič musí být ve STEJNÉM projektu.
2) Upravit / dokončit úkol:
   \`PUT /api/tasks/<id>\` \`{ "status": "completed" }\` (nebo title/priority/due_date/...)
   - Dokončení rodiče dokončí i podúkoly; dokončení všech podúkolů dokončí rodiče.
3) Smazat úkol:
   \`DELETE /api/tasks/<id>\` — má-li podúkoly, přidej \`?confirm=true\` (jinak 400).
4) Vypsat/filtrovat úkoly:
   \`GET /api/tasks?list_id=<id>&status=pending&priority=high&due_date=2026-06-01\`
   - Hledání: \`?search=text\` (v názvu i popisu). Štítek: \`?tag=práce\`.
   - Časové okno: \`?due=today\` | \`?due=week\` | \`?due=overdue\` (po termínu).
5) Projekty: \`GET /api/lists\`, \`POST /api/lists\` \`{ "name": "...", "color": "#6366f1" }\`,
   \`DELETE /api/lists/<id>?confirm=true\` (smaže i úkoly v projektu).

## Pravidla, na která dej pozor
- Neposílej \`gcal_event_id\` — spravuje ho server.
- Mazání, které kaskáduje (úkol s podúkoly, projekt s úkoly), vyžaduje \`?confirm=true\`.
- Chybové odpovědi mají tvar \`{ "error": "popis česky" }\` a HTTP kód 400/401/403/404.
  Při 400 si přečti \`error\`, oprav vstup a zkus znovu.
- Po zápisu si stav klidně znovu načti přes \`GET /api/agent/state\`.

## Strojová specifikace
OpenAPI 3.1: \`GET /api/docs/openapi.json\`
`;
}

router.get('/guide', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(buildGuide());
});

export default router;
