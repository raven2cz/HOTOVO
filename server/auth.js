import crypto from 'crypto';
import { getDb } from './db.js';
import { unauthorized } from './util/http.js';

/** Hash a raw API token for storage / lookup. Tokens are never stored in plaintext. */
export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

/** Generate a fresh, cryptographically random API token. */
export function generateToken() {
  return `agent_${crypto.randomBytes(24).toString('hex')}`;
}

function isLoopback(req) {
  const ip = (req.ip || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/**
 * Same-origin check for the loopback bypass. A request is considered safe when
 * it carries no Origin header (curl, native fetch, top-level navigation) or an
 * Origin whose host matches the request Host. This blocks cross-site (CSRF /
 * DNS-rebinding) requests from reaching the loopback bypass.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Authentication middleware (fail-closed).
 *
 * 1. A Bearer token is required for any non-local caller (AI agents, remote
 *    access). The token is matched against its stored hash; an invalid token
 *    is rejected outright (never falls through to the bypass).
 * 2. As a local convenience, same-origin requests originating from loopback
 *    (the UI served on the device itself, or curl on the box) are allowed
 *    without a token. Everything else is denied.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (token) {
      const db = await getDb();
      const record = await db.get(
        'SELECT id, name, created_at FROM api_tokens WHERE token_hash = ?',
        [hashToken(token)]
      );
      if (!record) {
        throw unauthorized('Neplatný API token.');
      }
      req.agent = record;
      return next();
    }

    if (isLoopback(req) && isSameOrigin(req)) {
      req.agent = { id: 'local-ui', name: 'Local UI' };
      return next();
    }

    throw unauthorized('Chybí API token. Přidejte hlavičku Authorization: Bearer <token>.');
  } catch (err) {
    next(err);
  }
}
