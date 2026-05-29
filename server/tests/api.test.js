import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import cors from 'cors';
import { getDb } from '../db.js';
import tasksRouter from '../routes/tasks.js';
import listsRouter from '../routes/lists.js';
import tokensRouter from '../routes/tokens.js';
import docsRouter from '../routes/api-docs.js';

// Setup temporary Express instance on random port for testing
async function setupTestServer() {
  const app = express();
  app.use(express.json());
  
  app.use('/api/tasks', tasksRouter);
  app.use('/api/lists', listsRouter);
  app.use('/api/tokens', tokensRouter);
  app.use('/api/docs', docsRouter);

  // Initialize DB
  await getDb();

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

test('Backend API Integration Tests Suite', async (t) => {
  const { baseUrl, close } = await setupTestServer();
  const defaultToken = 'agent-secret-42-pineapple-token';

  await t.test('GET /api/lists - should retrieve default seeded lists', async () => {
    const res = await fetch(`${baseUrl}/api/lists`, {
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });
    
    assert.strictEqual(res.status, 200);
    const lists = await res.json();
    assert.ok(Array.isArray(lists));
    assert.ok(lists.length >= 4); // default lists
  });

  await t.test('POST /api/lists - should create a new list', async () => {
    const res = await fetch(`${baseUrl}/api/lists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Testovací Projekt', color: '#ff0000' })
    });

    assert.strictEqual(res.status, 201);
    const newList = await res.json();
    assert.strictEqual(newList.name, 'Testovací Projekt');
    assert.strictEqual(newList.color, '#ff0000');
    assert.ok(newList.id);

    // Save for subsequent tests
    t.context = { ...t.context, testListId: newList.id };
  });

  await t.test('POST /api/tasks - should create a task in the list', async () => {
    const listId = t.context.testListId;
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Hlavní úkol testu',
        description: 'Detailní popis úkolu',
        list_id: listId,
        priority: 'high'
      })
    });

    assert.strictEqual(res.status, 201);
    const task = await res.json();
    assert.strictEqual(task.title, 'Hlavní úkol testu');
    assert.strictEqual(task.priority, 'high');
    assert.strictEqual(task.list_id, listId);
    
    t.context.testTaskId = task.id;
  });

  await t.test('POST /api/tasks - should create a subtask referencing parent task', async () => {
    const listId = t.context.testListId;
    const parentId = t.context.testTaskId;
    
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Podúkol testu',
        list_id: listId,
        parent_id: parentId
      })
    });

    assert.strictEqual(res.status, 201);
    const subtask = await res.json();
    assert.strictEqual(subtask.title, 'Podúkol testu');
    assert.strictEqual(subtask.parent_id, parentId);
  });

  await t.test('PUT /api/tasks/:id - should update status and priority', async () => {
    const taskId = t.context.testTaskId;
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'completed',
        priority: 'urgent'
      })
    });

    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.status, 'completed');
    assert.strictEqual(updated.priority, 'urgent');
  });

  await t.test('PUT /api/tasks/:id - status cascading and rollup rules', async () => {
    const listId = t.context.testListId;
    
    // 1. Create a parent task
    const parentRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Hierarchicky Rodic', list_id: listId })
    });
    const parentTask = await parentRes.json();

    // 2. Create subtask A
    const subARes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Podukol A', list_id: listId, parent_id: parentTask.id })
    });
    const subA = await subARes.json();

    // 3. Create subtask B
    const subBRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Podukol B', list_id: listId, parent_id: parentTask.id })
    });
    const subB = await subBRes.json();

    // Verify initially all are pending
    assert.strictEqual(parentTask.status, 'pending');
    assert.strictEqual(subA.status, 'pending');
    assert.strictEqual(subB.status, 'pending');

    // Rule 1: Completing the parent task completes all descendants (downward cascade)
    const completeParentRes = await fetch(`${baseUrl}/api/tasks/${parentTask.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'completed' })
    });
    assert.strictEqual(completeParentRes.status, 200);

    // Fetch all current tasks to check statuses
    const getAllRes = await fetch(`${baseUrl}/api/tasks?list_id=${listId}`, {
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });
    const tasks = await getAllRes.json();
    const updatedParent = tasks.find(x => x.id === parentTask.id);
    const updatedSubA = tasks.find(x => x.id === subA.id);
    const updatedSubB = tasks.find(x => x.id === subB.id);

    assert.strictEqual(updatedParent.status, 'completed');
    assert.strictEqual(updatedSubA.status, 'completed');
    assert.strictEqual(updatedSubB.status, 'completed');

    // Rule 2: Uncompleting one subtask should mark parent task as pending (upward rollup)
    const uncompleteSubARes = await fetch(`${baseUrl}/api/tasks/${subA.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'pending' })
    });
    assert.strictEqual(uncompleteSubARes.status, 200);

    const getAllRes2 = await fetch(`${baseUrl}/api/tasks?list_id=${listId}`, {
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });
    const tasks2 = await getAllRes2.json();
    const updatedParent2 = tasks2.find(x => x.id === parentTask.id);
    const updatedSubA2 = tasks2.find(x => x.id === subA.id);
    const updatedSubB2 = tasks2.find(x => x.id === subB.id);

    assert.strictEqual(updatedParent2.status, 'pending');
    assert.strictEqual(updatedSubA2.status, 'pending');
    assert.strictEqual(updatedSubB2.status, 'completed');

    // Rule 3: Completing the remaining subtask should mark parent task as completed (upward rollup completeness)
    const completeSubARes = await fetch(`${baseUrl}/api/tasks/${subA.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${defaultToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'completed' })
    });
    assert.strictEqual(completeSubARes.status, 200);

    const getAllRes3 = await fetch(`${baseUrl}/api/tasks?list_id=${listId}`, {
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });
    const tasks3 = await getAllRes3.json();
    const updatedParent3 = tasks3.find(x => x.id === parentTask.id);
    const updatedSubA3 = tasks3.find(x => x.id === subA.id);
    const updatedSubB3 = tasks3.find(x => x.id === subB.id);

    assert.strictEqual(updatedParent3.status, 'completed');
    assert.strictEqual(updatedSubA3.status, 'completed');
    assert.strictEqual(updatedSubB3.status, 'completed');
  });

  await t.test('GET /api/tokens/export-data - should export data in markdown format', async () => {
    const res = await fetch(`${baseUrl}/api/tokens/export-data?format=markdown`, {
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
    const mdText = await res.text();
    assert.ok(mdText.includes('# Export Todo Listů'));
    assert.ok(mdText.includes('Testovací Projekt'));
  });

  await t.test('DELETE /api/tasks/:id - should delete task and subtasks cascadingly', async () => {
    const taskId = t.context.testTaskId;
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    // Verify task is deleted
    const checkRes = await fetch(`${baseUrl}/api/tasks`, {
      headers: { 'Authorization': `Bearer ${defaultToken}` }
    });
    const tasks = await checkRes.json();
    const found = tasks.some(t => t.id === taskId);
    assert.strictEqual(found, false);
  });

  // Clean up server after all tests are finished
  await close();
});
