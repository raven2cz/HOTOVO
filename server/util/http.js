/**
 * Shared HTTP helpers: a typed application error plus an async route wrapper
 * that funnels everything into a single express error handler. This keeps
 * internal details (SQLite messages, stack traces) out of client responses.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const badRequest = (msg) => new ApiError(400, msg);
export const notFound = (msg) => new ApiError(404, msg);
export const unauthorized = (msg) => new ApiError(401, msg);

/**
 * Wrap an async route handler so thrown errors reach the central error
 * handler instead of producing an unhandled promise rejection.
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Central express error handler. Known ApiErrors surface their message;
 * everything else is logged server-side and returned as a generic 500 so we
 * never leak internal details to callers.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }

  // SQLite constraint violations are caused by bad client input, not server bugs.
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: 'Požadavek porušuje datová pravidla (constraint).' });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Interní chyba serveru.' });
}
