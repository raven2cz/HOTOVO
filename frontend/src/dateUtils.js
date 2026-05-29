// Date helpers.
//
// Due dates may be stored as date-only ("YYYY-MM-DD") or full ISO date-times.
// `new Date("YYYY-MM-DD")` parses as UTC midnight, which renders/compares as
// the previous day in western (negative-offset) timezones. These helpers parse
// date-only values as LOCAL dates so a task always lands on the intended day.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseLocalDate(value) {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d); // local midnight
  }
  return new Date(value);
}

export function formatLocalDate(value, locale = 'cs-CZ') {
  return parseLocalDate(value).toLocaleDateString(locale);
}
