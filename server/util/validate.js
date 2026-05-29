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

/**
 * Accept ISO date ("YYYY-MM-DD") or full ISO date-time. `null`/`undefined`
 * pass through (used to clear or skip the field).
 */
export function assertDueDate(value, fieldName = 'due_date') {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || !value.length) {
    throw badRequest(`Pole "${fieldName}" musí být datum ve formátu ISO.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw badRequest(`Pole "${fieldName}" není platné datum: ${value}`);
  }
  return value;
}

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`Pole "${fieldName}" je povinné.`);
  }
  return value;
}
