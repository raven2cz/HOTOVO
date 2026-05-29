#!/usr/bin/env node
/**
 * HOTOVO MCP server (Model Context Protocol, stdio transport).
 *
 * A dependency-free, newline-delimited JSON-RPC 2.0 server that exposes HOTOVO
 * as MCP tools. It is a thin adapter: each tool call is proxied to the local
 * HTTP API, so all validation, transactions and calendar sync are reused.
 *
 * Run the HOTOVO server first, then point your MCP-capable agent (e.g. a local
 * Gemma via an MCP client) at:  node server/mcp.js
 *
 * Config (env):
 *   PORT             HOTOVO server port (default 3000)
 *   HOTOVO_API_TOKEN Bearer token. Optional when this process runs on the same
 *                    host as the server (loopback bypass covers task/list CRUD).
 */

import readline from 'node:readline';

// Validate PORT strictly so it can't redirect fetch (and the bearer token) to
// an attacker-controlled host via a crafted env value.
const rawPort = Number(process.env.PORT);
const PORT = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.HOTOVO_API_TOKEN || '';

/** Encode an id for safe use as a single URL path segment (defeats path traversal). */
const seg = (id) => encodeURIComponent(String(id));

const PROTOCOL_VERSION = '2024-11-05';

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function callApi(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') sp.append(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

// Tool definitions (name → schema + handler). Descriptions are written for an
// LLM: short, explicit, with the rules that matter.
const TOOLS = [
  {
    name: 'get_state',
    description: 'Vrátí snapshot všech projektů a úkolů (ploše, s parent_id). Zavolej na začátku.',
    inputSchema: { type: 'object', properties: {} },
    run: () => callApi('GET', '/api/agent/state')
  },
  {
    name: 'list_projects',
    description: 'Vypíše projekty (lists).',
    inputSchema: { type: 'object', properties: {} },
    run: () => callApi('GET', '/api/lists')
  },
  {
    name: 'create_project',
    description: 'Vytvoří projekt. Args: name (povinné), color (hex, volitelné).',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, color: { type: 'string' } }
    },
    run: (a) => callApi('POST', '/api/lists', { name: a.name, color: a.color })
  },
  {
    name: 'list_tasks',
    description: 'Vypíše úkoly. Volitelné filtry: list_id, status (pending|completed), priority, due_date (YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'completed'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_date: { type: 'string' }
      }
    },
    run: (a) => callApi('GET', `/api/tasks${qs(a)}`)
  },
  {
    name: 'create_task',
    description:
      'Vytvoří úkol nebo podúkol. Args: title*, list_id*, parent_id (podúkol — stejný projekt), ' +
      'description, priority (low|medium|high|urgent), due_date (YYYY-MM-DD nebo ISO 8601 s TZ).',
    inputSchema: {
      type: 'object',
      required: ['title', 'list_id'],
      properties: {
        title: { type: 'string' },
        list_id: { type: 'string' },
        parent_id: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_date: { type: 'string' }
      }
    },
    run: (a) => callApi('POST', '/api/tasks', a)
  },
  {
    name: 'update_task',
    description: 'Upraví úkol. Args: id*, a libovolné z: title, description, status, priority, due_date, list_id, parent_id.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'completed'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_date: { type: ['string', 'null'] },
        list_id: { type: 'string' },
        parent_id: { type: ['string', 'null'] }
      }
    },
    run: ({ id, ...patch }) => callApi('PUT', `/api/tasks/${seg(id)}`, patch)
  },
  {
    name: 'complete_task',
    description: 'Označí úkol jako splněný (status=completed). Args: id*.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    run: (a) => callApi('PUT', `/api/tasks/${seg(a.id)}`, { status: 'completed' })
  },
  {
    name: 'delete_task',
    description: 'Smaže úkol. Má-li podúkoly, předej confirm=true. Args: id*, confirm (bool).',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } }
    },
    run: (a) => callApi('DELETE', `/api/tasks/${seg(a.id)}${a.confirm ? '?confirm=true' : ''}`)
  }
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) require no response.
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'hotovo', version: '1.0.0' }
    });
  }

  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    });
  }

  if (method === 'tools/call') {
    const tool = TOOL_MAP.get(params?.name);
    if (!tool) return replyError(id, -32602, `Neznámý nástroj: ${params?.name}`);
    try {
      const result = await tool.run(params.arguments || {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      // Surface API errors to the model as tool errors so it can correct itself.
      return reply(id, { content: [{ type: 'text', text: `Chyba: ${err.message}` }], isError: true });
    }
  }

  return replyError(id, -32601, `Nepodporovaná metoda: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // ignore non-JSON lines
  }
  handle(msg).catch((err) => {
    if (msg && msg.id != null) replyError(msg.id, -32603, err.message);
  });
});

process.stderr.write(`[mcp] HOTOVO MCP server ready (proxying to ${BASE})\n`);
