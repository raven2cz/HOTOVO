import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Normalised runtime environment.
 * Anything that is not explicitly "test" or "production" is treated as
 * "development". DB selection (see resolveDbPath) is the security-critical
 * consumer of this value, so it is derived in exactly one place.
 */
export const APP_ENV =
  process.env.NODE_ENV === 'test'
    ? 'test'
    : process.env.NODE_ENV === 'production'
      ? 'production'
      : 'development';

export const IS_TEST = APP_ENV === 'test';
export const IS_PRODUCTION = APP_ENV === 'production';

/**
 * Resolve the SQLite file path.
 *
 * The production/dev database and the test database are strictly separated.
 * A dedicated DB_PATH override is honoured (used by the test runner to point
 * at a throwaway temp file), otherwise we fall back to repo-local files.
 *
 * Hard guard: when running under the test environment the resolved path must
 * never be the production database. This is the last line of defence against
 * the failure mode that previously wiped real data (tests writing to todo.db).
 */
function resolveDbPath() {
  const prodPath = path.resolve(repoRoot, process.env.DB_PATH || 'todo.db');
  const testPath = path.resolve(
    repoRoot,
    process.env.DB_PATH || 'todo-test.db'
  );

  if (IS_TEST) {
    const resolved = testPath;
    if (path.basename(resolved) === 'todo.db') {
      throw new Error(
        '[config] Refusing to open the production database (todo.db) while NODE_ENV=test. ' +
          'Set DB_PATH to a dedicated test database.'
      );
    }
    return resolved;
  }

  return prodPath;
}

export const DB_PATH = resolveDbPath();

export const PORT = Number(process.env.PORT) || 3000;

/**
 * Host binding. Defaults to loopback so the app is NOT exposed to the local
 * network unless the operator opts in by setting HOST=0.0.0.0 (and ideally
 * configuring real tokens + CORS first).
 */
export const HOST = process.env.HOST || '127.0.0.1';

/**
 * Allowed CORS origins (comma separated). Empty means same-origin only, which
 * is the correct default for a single-origin SPA served by this same server.
 */
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
