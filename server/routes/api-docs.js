import express from 'express';
import { requireAuth } from '../auth.js';

const router = express.Router();

// Docs describe the API surface; gate them like the rest of /api. The local UI
// (same-origin loopback) still reaches them without a token.
router.use(requireAuth);

const errorResponse = {
  description: 'Chyba',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' }
    }
  }
};

const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'HOTOVO API',
    version: '1.0.0',
    description:
      'REST API aplikace HOTOVO pro AI agenty. Spravuje projekty, úkoly a podúkoly, ' +
      'volitelně synchronizuje s Google Kalendářem. Pro rychlý start agenta použijte ' +
      '`GET /api/agent/guide` (stručný návod) a `GET /api/agent/state` (snapshot stavu).'
  },
  // Relative server URL: clients resolve it against the host they fetched the
  // spec from, so a remote agent never gets pointed at its own localhost.
  servers: [{ url: '/', description: 'Tento HOTOVO server' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'API token vygenerovaný v Nastavení → AI Agenti. Lokální UI na stejném ' +
          'zařízení (loopback, stejný origin) token nepotřebuje.'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Pole "title" je povinné.' } }
      },
      List: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Práce' },
          color: { type: 'string', example: '#6366f1' },
          created_at: { type: 'string' }
        }
      },
      Task: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          list_id: { type: 'string', format: 'uuid' },
          parent_id: { type: ['string', 'null'], format: 'uuid', description: 'ID rodiče (podúkol).' },
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['pending', 'completed'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          due_date: {
            type: ['string', 'null'],
            description: 'YYYY-MM-DD (celý den) nebo plné ISO 8601 s časovou zónou.'
          },
          recurrence: {
            type: ['string', 'null'],
            enum: ['daily', 'weekly', 'monthly', null],
            description: 'Opakování; dokončení vytvoří další výskyt (vyžaduje due_date).'
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Štítky napříč projekty.' },
          gcal_event_id: { type: ['string', 'null'], description: 'Spravuje server; nezasílat.' },
          created_at: { type: 'string' },
          updated_at: { type: 'string' }
        }
      },
      StateSnapshot: {
        type: 'object',
        properties: {
          generated_at: { type: 'string' },
          counts: { type: 'object' },
          lists: { type: 'array', items: { $ref: '#/components/schemas/List' } },
          tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } }
        }
      }
    }
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/api/agent/state': {
      get: {
        summary: 'Snapshot celého stavu (projekty + úkoly) jedním voláním',
        responses: {
          200: {
            description: 'Aktuální stav',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StateSnapshot' } } }
          }
        }
      }
    },
    '/api/agent/guide': {
      get: {
        summary: 'Stručný návod pro agenta (Markdown, vhodné do system promptu)',
        responses: { 200: { description: 'Markdown návod', content: { 'text/markdown': {} } } }
      }
    },
    '/api/tasks': {
      get: {
        summary: 'Seznam úkolů (volitelné filtry)',
        parameters: [
          { name: 'list_id', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'completed'] } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] } },
          { name: 'due_date', in: 'query', schema: { type: 'string' }, description: 'Den YYYY-MM-DD' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Hledání v názvu/popisu' },
          { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Filtrovat podle štítku' },
          { name: 'due', in: 'query', schema: { type: 'string', enum: ['today', 'week', 'overdue'] }, description: 'Relativní časové okno' }
        ],
        responses: {
          200: { description: 'Úkoly', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } } },
          400: errorResponse
        }
      },
      post: {
        summary: 'Vytvořit úkol nebo podúkol',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'list_id'],
                properties: {
                  title: { type: 'string' },
                  list_id: { type: 'string', format: 'uuid' },
                  parent_id: { type: 'string', format: 'uuid', description: 'Pro podúkol; musí být ve stejném projektu.' },
                  description: { type: 'string' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
                  due_date: { type: 'string', description: 'YYYY-MM-DD nebo ISO 8601 s časovou zónou' },
                  recurrence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'none'] },
                  tags: { type: 'array', items: { type: 'string' } }
                }
              },
              example: { title: 'Zaplatit nájem', list_id: '<uuid>', priority: 'high', due_date: '2026-06-01', recurrence: 'monthly', tags: ['finance'] }
            }
          }
        },
        responses: {
          201: { description: 'Vytvořeno', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } },
          400: errorResponse
        }
      }
    },
    '/api/tasks/{id}': {
      put: {
        summary: 'Upravit úkol (dokončit, přejmenovat, změnit termín/prioritu, přesunout)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'completed'] },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                  due_date: { type: ['string', 'null'], description: 'null/"" odebere termín' },
                  recurrence: { type: ['string', 'null'], enum: ['daily', 'weekly', 'monthly', 'none', null] },
                  tags: { type: ['array', 'null'], items: { type: 'string' } },
                  list_id: { type: 'string' },
                  parent_id: { type: ['string', 'null'] }
                }
              },
              example: { status: 'completed' }
            }
          }
        },
        responses: {
          200: { description: 'Upraveno', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } },
          400: errorResponse,
          404: errorResponse
        }
      },
      delete: {
        summary: 'Smazat úkol (a jeho podúkoly)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirm', in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'Povinné (=true), pokud má úkol podúkoly.' }
        ],
        responses: {
          200: { description: 'Smazáno', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, deleted_id: { type: 'string' }, deleted_count: { type: 'integer' } } } } } },
          400: errorResponse,
          404: errorResponse
        }
      }
    },
    '/api/lists': {
      get: {
        summary: 'Seznam projektů',
        responses: { 200: { description: 'Projekty', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/List' } } } } } }
      },
      post: {
        summary: 'Vytvořit projekt',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, color: { type: 'string', example: '#6366f1' } } } } }
        },
        responses: { 201: { description: 'Vytvořeno', content: { 'application/json': { schema: { $ref: '#/components/schemas/List' } } } }, 400: errorResponse }
      }
    },
    '/api/lists/{id}': {
      put: {
        summary: 'Upravit projekt',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, color: { type: 'string' } } } } } },
        responses: { 200: { description: 'Upraveno' }, 404: errorResponse }
      },
      delete: {
        summary: 'Smazat projekt včetně jeho úkolů',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirm', in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'Povinné (=true), pokud projekt obsahuje úkoly.' }
        ],
        responses: { 200: { description: 'Smazáno' }, 400: errorResponse, 404: errorResponse }
      }
    },
    '/api/tokens/export-data': {
      get: {
        summary: 'Export všech dat (JSON / Markdown / CSV)',
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'markdown', 'csv'] } }],
        responses: { 200: { description: 'Exportovaný soubor' } }
      }
    },
    '/api/sync/run': {
      post: { summary: 'Spustit synchronizaci s Google Kalendářem', responses: { 200: { description: 'Statistika synchronizace' } } }
    },
    '/api/health': {
      get: { summary: 'Health check', responses: { 200: { description: 'OK' } } }
    }
  }
};

// Machine-readable OpenAPI spec.
router.get('/openapi.json', (req, res) => res.json(openApiSpec));

// Human-/agent-readable landing page.
router.get('/', (req, res) => {
  res.send(`<!doctype html>
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <title>HOTOVO - API pro agenty</title>
        <style>
          body { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0a0b12; color:#cbd5e1; line-height:1.65; padding:2.5rem 1.5rem; max-width:820px; margin:0 auto; }
          h1 { color:#f8fafc; font-weight:800; letter-spacing:.04em; display:flex; align-items:center; gap:.6rem; }
          h2 { color:#f1f5f9; margin-top:2.2rem; font-weight:700; }
          a { color:#a5b4fc; }
          code { background:#12141d; color:#c4b5fd; padding:.15rem .4rem; border-radius:.3rem; font-size:.9em; }
          pre { background:#12141d; padding:1rem; border-radius:.6rem; overflow-x:auto; border:1px solid #222533; }
          .ep { background:#12141d; border-left:3px solid #6366f1; padding:.6rem .9rem; margin:.5rem 0; border-radius:0 .5rem .5rem 0; }
          .m { font-weight:700; color:#818cf8; margin-right:.5rem; }
          .logo { width:30px; height:30px; }
        </style>
      </head>
      <body>
        <h1>
          <svg class="logo" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="9" fill="url(#g)"/><path d="M9.5 16.5 L14 21 L22.5 11" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          HOTOVO - API pro AI agenty
        </h1>
        <p>Plnohodnotné REST API pro řízení úkolů agenty (custom GPTs, Gemini/Gemma agenti, vlastní skripty).</p>

        <h2>Nejrychlejší start pro agenta</h2>
        <div class="ep"><span class="m">GET</span> <code>/api/agent/guide</code> - stručný návod (Markdown) přímo do system promptu</div>
        <div class="ep"><span class="m">GET</span> <code>/api/agent/state</code> - snapshot všech projektů a úkolů jedním voláním</div>

        <h2>Autentizace</h2>
        <p>Nelokální klienti posílají hlavičku:</p>
        <pre>Authorization: Bearer &lt;váš_token&gt;</pre>
        <p>Token vytvoříte v <strong>Nastavení → AI Agenti (API)</strong>. Lokální UI na zařízení token nepotřebuje.</p>

        <h2>Hlavní endpointy</h2>
        <div class="ep"><span class="m">GET</span> <code>/api/tasks</code> - výpis (filtry: list_id, status, priority, due_date)</div>
        <div class="ep"><span class="m">POST</span> <code>/api/tasks</code> - vytvořit úkol/podúkol</div>
        <div class="ep"><span class="m">PUT</span> <code>/api/tasks/:id</code> - upravit / dokončit</div>
        <div class="ep"><span class="m">DELETE</span> <code>/api/tasks/:id</code> - smazat (s podúkoly: <code>?confirm=true</code>)</div>
        <div class="ep"><span class="m">GET</span> <code>/api/lists</code> - projekty</div>

        <h2>Strojová specifikace</h2>
        <p>OpenAPI 3.1: <a href="/api/docs/openapi.json">/api/docs/openapi.json</a></p>
      </body>
    </html>`);
});

export default router;
