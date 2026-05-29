import 'dotenv/config';
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
 * Strict test/prod separation. In the test environment the production DB_PATH
 * override is IGNORED entirely — the test DB is always a dedicated, test-named
 * file (TEST_DB_PATH if provided, otherwise repo-local todo-test.db). This is
 * the hard guard against the failure mode that previously wiped real data:
 * tests can never be pointed at (and therefore never unlink) a production DB,
 * regardless of DB_PATH / .env.
 */
function resolveDbPath() {
  if (IS_TEST) {
    const testPath = path.resolve(repoRoot, process.env.TEST_DB_PATH || 'todo-test.db');
    const base = path.basename(testPath);
    if (!/test/i.test(base)) {
      throw new Error(
        `[config] Test database path must contain "test" (got "${base}"). ` +
          'Refusing to run tests against a possibly-production database.'
      );
    }
    return testPath;
  }

  return path.resolve(repoRoot, process.env.DB_PATH || 'todo.db');
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

/**
 * Hostnames that the loopback auth bypass will trust. Anything else (e.g. a
 * DNS-rebinding domain pointing at 127.0.0.1) is rejected, even from loopback.
 * Operators exposing the app can add their hostname via TRUSTED_HOSTS.
 */
export const TRUSTED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  ...(process.env.TRUSTED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
]);
