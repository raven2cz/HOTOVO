import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';

import { APP_ENV, DB_PATH } from './config.js';
import { generateToken, hashToken } from './auth.js';
import { encryptSecret, isEncrypted } from './util/secrets.js';

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

  // Restrict the DB (and WAL/SHM sidecars) to the owner — it holds task data
  // plus token/secret material. Best-effort: ignore on platforms without chmod.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.chmodSync(DB_PATH + suffix, 0o600);
    } catch {
      /* file may not exist yet or FS has no POSIX perms */
    }
  }

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
  await migrateSecrets(db);
  await seedDefaults(db);

  return db;
}

/**
 * Re-encrypt any sensitive settings that were stored as plaintext by an older
 * version, so an upgraded database does not keep OAuth secrets readable at rest.
 */
async function migrateSecrets(db) {
  const secretKeys = ['gcal_client_secret', 'gcal_refresh_token', 'gcal_access_token'];
  for (const key of secretKeys) {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (row?.value && !isEncrypted(row.value)) {
      await db.run('UPDATE settings SET value = ? WHERE key = ?', [encryptSecret(row.value), key]);
      console.log(`[db] Re-encrypted legacy plaintext secret at rest: ${key}`);
    }
  }
}

// The original well-known seeded token. Compromised by definition (it shipped
// in the source), so it is intentionally NOT carried across the migration.
const LEGACY_DEFAULT_TOKEN = 'agent-secret-42-pineapple-token';

/**
 * The original schema stored API tokens in plaintext (`token` column). We now
 * store only SHA-256 hashes. When the legacy table is detected we migrate each
 * user-created token to its hash (preserving id/name/created_at) and drop only
 * the compromised default. The migration runs in a transaction.
 */
async function migrateApiTokens(db) {
  const columns = await db.all('PRAGMA table_info(api_tokens)');
  const hasLegacyPlaintext = columns.some((c) => c.name === 'token');

  if (hasLegacyPlaintext) {
    console.log('[db] Migrating api_tokens to hashed storage (preserving user tokens).');
    const legacyRows = await db.all('SELECT id, token, name, created_at FROM api_tokens');
    await db.exec('BEGIN');
    try {
      await db.exec('ALTER TABLE api_tokens RENAME TO api_tokens_legacy');
      await createApiTokensTable(db);
      for (const row of legacyRows) {
        if (row.token === LEGACY_DEFAULT_TOKEN) continue; // drop the compromised default
        await db.run(
          'INSERT INTO api_tokens (id, token_hash, name, created_at) VALUES (?, ?, ?, ?)',
          [row.id, hashToken(row.token), row.name, row.created_at]
        );
      }
      await db.exec('DROP TABLE api_tokens_legacy');
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
    return;
  }

  await createApiTokensTable(db);
}

function createApiTokensTable(db) {
  return db.exec(`
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

  // On first run, mint one random token. Only its hash is stored, so we write
  // the raw value to a 0600 provisioning file (NOT to stdout/journald, which
  // may be world-readable) and log only the path.
  const tokenCount = await db.get('SELECT COUNT(*) AS count FROM api_tokens');
  if (tokenCount.count === 0) {
    const rawToken = generateToken();
    await db.run('INSERT INTO api_tokens (id, token_hash, name) VALUES (?, ?, ?)', [
      uuidv4(),
      hashToken(rawToken),
      'Výchozí AI Agent Token'
    ]);
    const tokenFile = path.join(path.dirname(DB_PATH), 'INITIAL_TOKEN.txt');
    fs.writeFileSync(tokenFile, `${rawToken}\n`, { mode: 0o600 });
    console.log(
      `[db] Vygenerován výchozí AI agent token. Uložen do: ${tokenFile} (práva 0600).\n` +
        '     Po zkopírování soubor smažte. Další tokeny vytvoříte v Nastavení.'
    );
  }
}
