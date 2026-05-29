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
 * Strict test/prod separation. In the test environment the database is HARD-
 * CODED to a single repo-local file (todo-test.db). DB_PATH / TEST_DB_PATH /
 * .env are all ignored, so tests can never be pointed at — and therefore never
 * unlink — a production database, regardless of how the environment is shaped.
 * This is the definitive guard against the prior data-loss incident.
 */
const TEST_DB_FILE = 'todo-test.db';

function resolveDbPath() {
  if (IS_TEST) {
    return path.join(repoRoot, TEST_DB_FILE);
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
 * FIXED set of loopback hostnames the local-UI auth bypass will trust. This is
 * intentionally NOT operator-extendable: a reverse proxy forwards the public
 * Host (e.g. todo.example.com), which is not in this set, so proxied/exposed
 * requests fall through to token auth instead of being treated as local UI.
 */
export const TRUSTED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]' // URL.hostname keeps brackets for IPv6 literals
]);

/**
 * Master switch for the local-UI (loopback same-origin) auth bypass. Set
 * LOCAL_UI_BYPASS=false for proxied/exposed deployments (or any setup where the
 * proxy rewrites Host to localhost) to require a token for every /api request.
 */
export const LOCAL_UI_BYPASS = (process.env.LOCAL_UI_BYPASS ?? 'true') !== 'false';
