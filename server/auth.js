import crypto from 'crypto';
import { getDb } from './db.js';
import { TRUSTED_HOSTS, LOCAL_UI_BYPASS } from './config.js';
import { unauthorized, ApiError } from './util/http.js';

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

/** The Host header's hostname must be an explicitly trusted local host. */
function isTrustedHost(req) {
  const host = req.headers.host;
  if (!host) return false;
  try {
    // URL parsing strips the port and normalises IPv6 brackets.
    return TRUSTED_HOSTS.has(new URL(`http://${host}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Same-origin check for the loopback bypass. A request is considered safe when
 * it carries no Origin header (curl, native fetch, top-level navigation) or an
 * Origin whose host matches the request Host. This blocks cross-site (CSRF)
 * requests from reaching the loopback bypass.
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
    // Locality is determined independently of the token: a same-origin loopback
    // request from a trusted host is the local UI even if it also carries a
    // stored token. (Defeats DNS rebinding via the trusted-host allow-list.)
    req.isLocalUi =
      LOCAL_UI_BYPASS && isLoopback(req) && isTrustedHost(req) && isSameOrigin(req);

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (token) {
      // A presented token is always validated; an invalid one is rejected even
      // from loopback (someone is probing).
      const db = await getDb();
      const record = await db.get(
        'SELECT id, name, created_at FROM api_tokens WHERE token_hash = ?',
        [hashToken(token)]
      );
      if (!record) throw unauthorized('Neplatný API token.');
      req.agent = record;
      return next();
    }

    if (req.isLocalUi) {
      req.agent = { id: 'local-ui', name: 'Local UI' };
      return next();
    }

    throw unauthorized('Chybí API token. Přidejte hlavičku Authorization: Bearer <token>.');
  } catch (err) {
    next(err);
  }
}

/**
 * Restrict a route to the local UI (same-origin loopback). Remote agents are
 * rejected even with a valid token — this prevents a leaked agent token from
 * minting backdoor tokens, revoking tokens, or rewriting OAuth config. Locality
 * is decided by origin, not by whether a token was sent. Must run after requireAuth.
 */
export function requireLocalUi(req, res, next) {
  if (req.isLocalUi) return next();
  next(new ApiError(403, 'Tato akce je dostupná pouze z lokálního UI.'));
}
