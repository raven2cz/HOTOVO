import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import express from 'express';

import { APP_ENV, DB_PATH } from '../config.js';
import { getDb } from '../db.js';
import { enqueueUpsert, enqueueDelete, drainOutbox } from '../services/gcalOutbox.js';
import { errorHandler } from '../util/http.js';
import tasksRouter from '../routes/tasks.js';
import listsRouter from '../routes/lists.js';
import tokensRouter from '../routes/tokens.js';
import docsRouter from '../routes/api-docs.js';

// Start from a clean, hermetic test database every run.
// Refuse to unlink ANYTHING unless we are provably in the test environment AND
// the target is exactly the dedicated test database file.
function wipeTestDb() {
  if (APP_ENV !== 'test' || path.basename(DB_PATH) !== 'todo-test.db') {
    throw new Error(`Refusing to wipe DB: APP_ENV=${APP_ENV}, DB_PATH=${DB_PATH}`);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_PATH + suffix);
    } catch {
      /* not present — fine */
    }
  }
}

async function setupTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', tasksRouter);
  app.use('/api/lists', listsRouter);
  app.use('/api/tokens', tokensRouter);
  app.use('/api/docs', docsRouter);
  app.use(errorHandler);
  await getDb();

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

const json = (extra = {}) => ({ 'Content-Type': 'application/json', ...extra });

test('Backend API Integration Tests Suite', async (t) => {
  assert.ok(!DB_PATH.endsWith('todo.db'), 'tests must never run against the production DB');
  wipeTestDb();
  const { baseUrl, close } = await setupTestServer();

  // Loopback requests with no Origin (native fetch) are the local-UI path.
  await t.test('GET /api/lists - loopback access allowed without token', async () => {
    const res = await fetch(`${baseUrl}/api/lists`);
    assert.strictEqual(res.status, 200);
    const lists = await res.json();
    assert.ok(Array.isArray(lists) && lists.length >= 4);
  });

  await t.test('auth - cross-origin request without token is rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/api/lists`, {
      headers: { Origin: 'http://evil.example' }
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('auth - invalid Bearer token is rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/api/lists`, {
      headers: { Authorization: 'Bearer not-a-real-token' }
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('tokens - create returns raw token once and it authenticates', async () => {
    const createRes = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ name: 'Test Agent' })
    });
    assert.strictEqual(createRes.status, 201);
    const { token } = await createRes.json();
    assert.ok(token && token.startsWith('agent_'));

    // Listing tokens must never leak the raw value or hash.
    const listRes = await fetch(`${baseUrl}/api/tokens`);
    const tokens = await listRes.json();
    assert.ok(tokens.every((tk) => !('token' in tk) && !('token_hash' in tk)));

    // The raw token works even cross-origin (agent use case).
    const authed = await fetch(`${baseUrl}/api/lists`, {
      headers: { Origin: 'http://evil.example', Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(authed.status, 200);
  });

  let listId;
  await t.test('POST /api/lists - create a list', async () => {
    const res = await fetch(`${baseUrl}/api/lists`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ name: 'Testovací Projekt', color: '#ff0000' })
    });
    assert.strictEqual(res.status, 201);
    const list = await res.json();
    assert.strictEqual(list.name, 'Testovací Projekt');
    listId = list.id;
  });

  await t.test('POST /api/tasks - validation rejects invalid status/priority', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ title: 'X', list_id: listId, priority: 'bogus' })
    });
    assert.strictEqual(res.status, 400);
  });

  let parentId;
  await t.test('POST /api/tasks - create a task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ title: 'Hlavní úkol', list_id: listId, priority: 'high' })
    });
    assert.strictEqual(res.status, 201);
    parentId = (await res.json()).id;
  });

  await t.test('PUT /api/tasks/:id - invalid status returns 400 (no infinite loop)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${parentId}`, {
      method: 'PUT',
      headers: json(),
      body: JSON.stringify({ status: 'in_progress' })
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('status cascade and rollup rules', async () => {
    const mk = async (title, parent) =>
      (
        await (
          await fetch(`${baseUrl}/api/tasks`, {
            method: 'POST',
            headers: json(),
            body: JSON.stringify({ title, list_id: listId, parent_id: parent })
          })
        ).json()
      );

    const root = await mk('Rodic');
    const a = await mk('Podukol A', root.id);
    const b = await mk('Podukol B', root.id);

    const put = (id, body) =>
      fetch(`${baseUrl}/api/tasks/${id}`, { method: 'PUT', headers: json(), body: JSON.stringify(body) });

    // Completing the parent cascades down.
    await put(root.id, { status: 'completed' });
    let tasks = await (await fetch(`${baseUrl}/api/tasks?list_id=${listId}`)).json();
    assert.strictEqual(tasks.find((x) => x.id === a.id).status, 'completed');
    assert.strictEqual(tasks.find((x) => x.id === b.id).status, 'completed');

    // Reopening one child rolls the parent back to pending.
    await put(a.id, { status: 'pending' });
    tasks = await (await fetch(`${baseUrl}/api/tasks?list_id=${listId}`)).json();
    assert.strictEqual(tasks.find((x) => x.id === root.id).status, 'pending');
    assert.strictEqual(tasks.find((x) => x.id === b.id).status, 'completed');

    // Completing the last open child completes the parent again.
    await put(a.id, { status: 'completed' });
    tasks = await (await fetch(`${baseUrl}/api/tasks?list_id=${listId}`)).json();
    assert.strictEqual(tasks.find((x) => x.id === root.id).status, 'completed');
  });

  await t.test('PUT - rejects cyclic parent assignment', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${parentId}`, {
      method: 'PUT',
      headers: json(),
      body: JSON.stringify({ parent_id: parentId })
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('CSV export neutralises formula injection', async () => {
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ title: '=SUM(A1:A2)', list_id: listId })
    });
    const res = await fetch(`${baseUrl}/api/tokens/export-data?format=csv`);
    const csv = await res.text();
    assert.ok(csv.includes(`"'=SUM(A1:A2)"`), 'leading = must be escaped with a quote');
  });

  await t.test('tags + search + due filters', async () => {
    const mk = (body) =>
      fetch(`${baseUrl}/api/tasks`, { method: 'POST', headers: json(), body: JSON.stringify({ list_id: listId, ...body }) }).then((r) => r.json());

    const tagged = await mk({ title: 'Najdime tohle', tags: ['práce', 'urgent', 'práce'] });
    assert.deepStrictEqual(tagged.tags, ['práce', 'urgent'], 'tags returned as deduped array');

    const search = await (await fetch(`${baseUrl}/api/tasks?search=najdime`)).json();
    assert.ok(search.some((x) => x.id === tagged.id), 'search matches title');

    const byTag = await (await fetch(`${baseUrl}/api/tasks?tag=${encodeURIComponent('práce')}`)).json();
    assert.ok(byTag.some((x) => x.id === tagged.id), 'tag filter matches');

    const today = new Date().toISOString().slice(0, 10);
    await mk({ title: 'Dnešní úkol', due_date: today });
    const dueToday = await (await fetch(`${baseUrl}/api/tasks?due=today`)).json();
    assert.ok(dueToday.some((x) => x.title === 'Dnešní úkol'), 'due=today filter works');
  });

  await t.test('completing a recurring task rolls it forward (no duplicate)', async () => {
    const create = await (
      await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: json(),
        body: JSON.stringify({ title: 'Opakovaný', list_id: listId, due_date: '2026-06-01', recurrence: 'daily' })
      })
    ).json();
    assert.strictEqual(create.recurrence, 'daily');

    const done = await (
      await fetch(`${baseUrl}/api/tasks/${create.id}`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify({ status: 'completed' })
      })
    ).json();

    // Same task, still pending, due date advanced by one day — no second task.
    assert.strictEqual(done.id, create.id);
    assert.strictEqual(done.status, 'pending');
    assert.strictEqual(done.due_date, '2026-06-02');

    const all = await (await fetch(`${baseUrl}/api/tasks?list_id=${listId}`)).json();
    assert.strictEqual(all.filter((x) => x.title === 'Opakovaný').length, 1, 'no duplicate occurrence created');
  });

  await t.test('DELETE /api/lists/:id - requires confirm when it has tasks', async () => {
    const res = await fetch(`${baseUrl}/api/lists/${listId}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 400);

    const confirmed = await fetch(`${baseUrl}/api/lists/${listId}?confirm=true`, { method: 'DELETE' });
    assert.strictEqual(confirmed.status, 200);
    const body = await confirmed.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.deleted_task_count >= 1);
  });

  await t.test('gcal outbox - dedupes entries and skips when sync is not connected', async () => {
    const db = await getDb();
    await db.run('DELETE FROM gcal_outbox');

    await enqueueUpsert('task-xyz');
    await enqueueUpsert('task-xyz'); // duplicate — should be collapsed
    await enqueueDelete('event-abc');
    await enqueueDelete('event-abc'); // duplicate — should be collapsed

    const upserts = await db.get(
      "SELECT COUNT(*) AS c FROM gcal_outbox WHERE op = 'upsert' AND task_id = 'task-xyz'"
    );
    const deletes = await db.get(
      "SELECT COUNT(*) AS c FROM gcal_outbox WHERE op = 'delete' AND event_id = 'event-abc'"
    );
    assert.strictEqual(upserts.c, 1);
    assert.strictEqual(deletes.c, 1);

    // No Google credentials configured in tests → drain is a no-op, entries stay.
    const result = await drainOutbox();
    assert.strictEqual(result.skipped, 'not_connected');
    const remaining = await db.get('SELECT COUNT(*) AS c FROM gcal_outbox');
    assert.strictEqual(remaining.c, 2);

    await db.run('DELETE FROM gcal_outbox');
  });

  await close();
});
