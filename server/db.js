import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';

import { APP_ENV, DB_PATH } from './config.js';
import { generateToken, hashToken } from './auth.js';

// Announce which database this process uses. Confusing test/prod databases was
// the root cause of the data loss incident, so make it impossible to miss.
console.log(`[db] env=${APP_ENV} → database: ${DB_PATH}`);

// Cache the in-flight promise (not the resolved handle) so concurrent first
// callers share a single connection and a single initialisation pass.
let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = initialise().catch((err) => {
      // Reset so a later call can retry instead of caching a rejected promise.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function initialise() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // WAL improves durability and concurrent read/write behaviour.
  await db.exec('PRAGMA journal_mode = WAL');
  await db.run('PRAGMA foreign_keys = ON');

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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
  `);

  await migrateApiTokens(db);
  await seedDefaults(db);

  return db;
}

/**
 * The original schema stored API tokens in plaintext (`token` column) and
 * seeded a well-known default token. We now store only SHA-256 hashes. If the
 * legacy table is detected we drop it — the only value it can hold is the
 * compromised default, so there is nothing worth preserving — and recreate it.
 */
async function migrateApiTokens(db) {
  const columns = await db.all('PRAGMA table_info(api_tokens)');
  const hasLegacyPlaintext = columns.some((c) => c.name === 'token');

  if (hasLegacyPlaintext) {
    console.log('[db] Migrating api_tokens to hashed storage (dropping legacy plaintext tokens).');
    await db.exec('DROP TABLE api_tokens');
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function seedDefaults(db) {
  const listCount = await db.get('SELECT COUNT(*) AS count FROM lists');
  if (listCount.count === 0) {
    const defaultLists = [
      { name: 'Nakup a prodej domu', color: '#f59e0b' },
      { name: 'Prace', color: '#6366f1' },
      { name: 'Open-Source', color: '#10b981' },
      { name: 'Osobni', color: '#ec4899' }
    ];
    for (const list of defaultLists) {
      await db.run('INSERT INTO lists (id, name, color) VALUES (?, ?, ?)', [
        uuidv4(),
        list.name,
        list.color
      ]);
    }
  }

  // On first run, mint one random token and print it ONCE. Only the hash is
  // stored, so this is the only opportunity to capture it for agent setup.
  const tokenCount = await db.get('SELECT COUNT(*) AS count FROM api_tokens');
  if (tokenCount.count === 0) {
    const rawToken = generateToken();
    await db.run('INSERT INTO api_tokens (id, token_hash, name) VALUES (?, ?, ?)', [
      uuidv4(),
      hashToken(rawToken),
      'Výchozí AI Agent Token'
    ]);
    console.log(
      '\n================ AI AGENT API TOKEN (zobrazí se pouze jednou) ================\n' +
        `  ${rawToken}\n` +
        '  Uložte si jej do konfigurace agenta. Další tokeny lze vytvořit v Nastavení.\n' +
        '==============================================================================\n'
    );
  }
}
