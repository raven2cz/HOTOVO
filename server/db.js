import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isTest = process.env.NODE_ENV === 'test';
const dbFilename = isTest ? '../todo-test.db' : '../todo.db';
const dbPath = path.resolve(__dirname, dbFilename);

// Hlasitě oznámíme, KTEROU databázi server používá. Záměna test/produkce
// (testy zapisující do produkční DB) byla příčinou ztráty dat – tohle to zviditelní.
console.log(`[db] NODE_ENV=${process.env.NODE_ENV || '(unset → PRODUKCE)'} → používám databázi: ${dbPath}`);

let db = null;

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Initialize schema
  await db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      due_date TEXT,
      gcal_event_id TEXT,
      gcal_updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Insert default lists if they don't exist
  const listCount = await db.get('SELECT COUNT(*) as count FROM lists');
  if (listCount.count === 0) {
    const defaultLists = [
      { id: uuidv4(), name: 'Nakup a prodej domu', color: '#f59e0b' }, // Amber
      { id: uuidv4(), name: 'Prace', color: '#6366f1' },              // Indigo
      { id: uuidv4(), name: 'Open-Source', color: '#10b981' },         // Emerald
      { id: uuidv4(), name: 'Osobni', color: '#ec4899' }              // Pink
    ];

    for (const list of defaultLists) {
      await db.run(
        'INSERT INTO lists (id, name, color) VALUES (?, ?, ?)',
        [list.id, list.name, list.color]
      );
    }
  }

  // Insert default agent token if none exist
  const tokenCount = await db.get('SELECT COUNT(*) as count FROM api_tokens');
  if (tokenCount.count === 0) {
    // Generate a default demo token
    const defaultToken = 'agent-secret-42-pineapple-token';
    await db.run(
      'INSERT INTO api_tokens (id, token, name) VALUES (?, ?, ?)',
      [uuidv4(), defaultToken, 'Vychozi AI Agent Token']
    );
  }

  return db;
}
