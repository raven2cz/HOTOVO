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

/**
 * Run `fn` inside a transaction on a DEDICATED connection.
 *
 * Using a separate connection (not the shared read connection) isolates the
 * transaction: statements issued on the shared connection by other requests
 * can never accidentally become part of this transaction. SQLite's file-level
 * locking + busy_timeout serializes the actual writes. A promise-chain mutex
 * additionally serializes our own transactions so they don't contend with each
 * other (avoiding SQLITE_BUSY between transactions we control). `fn` receives
 * the transaction's connection handle.
 */
let txMutex = Promise.resolve();

async function openConnection() {
  const conn = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await conn.run('PRAGMA foreign_keys = ON');
  await conn.run('PRAGMA busy_timeout = 5000');
  return conn;
}

export function withTransaction(fn) {
  const run = async () => {
    const conn = await openConnection();
    try {
      await conn.run('BEGIN IMMEDIATE');
      try {
        const result = await fn(conn);
        await conn.run('COMMIT');
        return result;
      } catch (err) {
        try {
          await conn.run('ROLLBACK');
        } catch {
          /* rollback may fail if the tx already aborted */
        }
        throw err;
      }
    } finally {
      await conn.close();
    }
  };
  // Chain onto the previous transaction regardless of how it settled.
  const result = txMutex.then(run, run);
  txMutex = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function initialise() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // WAL improves durability and concurrent read/write behaviour. busy_timeout
  // lets the shared connection wait (instead of erroring) when a transaction
  // connection briefly holds the write lock.
  await db.exec('PRAGMA journal_mode = WAL');
  await db.run('PRAGMA foreign_keys = ON');
  await db.run('PRAGMA busy_timeout = 5000');

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

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Durable queue of pending Google Calendar operations (upsert/delete) with
    -- retry/backoff. A single serialized drainer is the only writer to Google,
    -- which prevents duplicate event inserts and makes remote deletes retryable.
    CREATE TABLE IF NOT EXISTS gcal_outbox (
      id TEXT PRIMARY KEY,
      op TEXT NOT NULL,
      task_id TEXT,
      event_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT,
      dead INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
  `);

  await migrateTasks(db);
  await migrateApiTokens(db);
  await migrateSecrets(db);
  await migrateOutbox(db);
  await seedDefaults(db);

  return db;
}

/**
 * Add any `tasks` columns missing from a database created by an older version,
 * so routes that read/write them don't fail. Defaults must be constant for
 * SQLite's ALTER TABLE ADD COLUMN (timestamps are added nullable).
 */
async function migrateTasks(db) {
  const expected = {
    parent_id: 'TEXT',
    description: 'TEXT',
    status: "TEXT DEFAULT 'pending'",
    priority: "TEXT DEFAULT 'medium'",
    due_date: 'TEXT',
    gcal_event_id: 'TEXT',
    gcal_updated_at: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT'
  };
  const existing = new Set((await db.all('PRAGMA table_info(tasks)')).map((c) => c.name));
  for (const [name, decl] of Object.entries(expected)) {
    if (!existing.has(name)) {
      await db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${decl}`);
      console.log(`[db] Added missing tasks column: ${name}`);
    }
  }
}

/** Add the `dead` column to gcal_outbox for databases created before it existed. */
async function migrateOutbox(db) {
  const columns = await db.all('PRAGMA table_info(gcal_outbox)');
  if (!columns.some((c) => c.name === 'dead')) {
    await db.exec('ALTER TABLE gcal_outbox ADD COLUMN dead INTEGER NOT NULL DEFAULT 0');
  }
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
  // Seed default projects ONCE ever (tracked by a flag), not whenever `lists`
  // happens to be empty — otherwise deleting all projects would resurrect them
  // on the next restart.
  const seeded = await db.get("SELECT value FROM settings WHERE key = 'seeded_defaults'");
  if (!seeded) {
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
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_defaults', '1')");
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
    // writeFileSync only applies mode on creation; enforce 0600 even if the
    // file already existed with weaker permissions.
    try {
      fs.chmodSync(tokenFile, 0o600);
    } catch {
      /* non-POSIX FS */
    }
    console.log(
      `[db] Vygenerován výchozí AI agent token. Uložen do: ${tokenFile} (práva 0600).\n` +
        '     Po zkopírování soubor smažte. Další tokeny vytvoříte v Nastavení.'
    );
  }
}
