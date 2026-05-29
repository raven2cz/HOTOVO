import { badRequest } from './http.js';

export const TASK_STATUSES = ['pending', 'completed'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/**
 * Validate that `value` is one of `allowed`. Returns the value unchanged when
 * `value` is undefined (i.e. "not being updated"), otherwise throws 400.
 */
export function assertEnum(value, allowed, fieldName) {
  if (value === undefined) return value;
  if (!allowed.includes(value)) {
    throw badRequest(`Neplatná hodnota pole "${fieldName}": ${value}`);
  }
  return value;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A timezone (Z or ±HH:MM) is REQUIRED so the instant is unambiguous regardless
// of server timezone before it is sent to Google Calendar.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Accept a strict calendar date ("YYYY-MM-DD") or a full ISO date-time.
 * Loose inputs that Date.parse() would silently coerce (e.g. "2026-02-31" or
 * "05/06/2026") are rejected. `null`/`undefined` pass through.
 */
export function assertDueDate(value, fieldName = 'due_date') {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') {
    throw badRequest(`Pole "${fieldName}" musí být datum ve formátu ISO.`);
  }

  // Reject calendar rollovers like 2026-02-31 (would silently become March).
  const isRealCalendarDate = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };

  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    if (!isRealCalendarDate(y, m, d)) {
      throw badRequest(`Pole "${fieldName}" není platné kalendářní datum: ${value}`);
    }
    return value;
  }

  if (ISO_DATETIME.test(value)) {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    if (isRealCalendarDate(y, m, d) && !Number.isNaN(Date.parse(value))) {
      return value;
    }
  }

  throw badRequest(
    `Pole "${fieldName}" musí být YYYY-MM-DD nebo ISO 8601 s časovou zónou (Z/±HH:MM): ${value}`
  );
}

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`Pole "${fieldName}" je povinné.`);
  }
  return value;
}
