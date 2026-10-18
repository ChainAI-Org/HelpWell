/**
 * Reading a stored value as one type, in JavaScript.
 *
 * These are the twins of the `helpwell.hw_*` SQL functions in migration 0005,
 * rule for rule, so a condition evaluated against one contact in memory gives
 * the same answer as the same condition compiled into a segment count. Change
 * one side and change the other; test/conditions.test.ts runs every operator
 * both ways and compares.
 *
 * Every reader answers null (or false, or an empty list) for a value that is
 * not of its type rather than throwing: the host app's attributes are
 * whatever JSON it sent, and one odd value must not fail a whole segment.
 */

const NUMBER_TEXT = /^\s*[$€£]?\s*-?[0-9][0-9,]*(\.[0-9]+)?\s*$/;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(Z|z|[+-]\d{2}(:?\d{2})?)$/;
const TRUTHY = new Set(['true', 'yes', '1']);

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** `helpwell.hw_text`: strings, numbers and booleans as text; anything else null. */
export function readText(value: unknown): string | null {
  return isScalar(value) ? String(value) : null;
}

/** `helpwell.hw_num`: a number, or a string that plainly is one ("1,200", "$4.50"). */
export function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !NUMBER_TEXT.test(value)) return null;
  const parsed = Number(value.replace(/[\s$€£,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `helpwell.hw_time`, as epoch milliseconds: a Date, epoch seconds or
 * milliseconds, or an ISO 8601 string. A zone-less string is UTC.
 */
export function readTime(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (!ISO_DATE_PREFIX.test(raw)) return null;
  if (ISO_DATE_ONLY.test(raw)) raw = `${raw}T00:00:00Z`;
  else if (!HAS_ZONE.test(raw)) raw = `${raw}Z`;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : time;
}

/** `helpwell.hw_bool`: true, "true", "yes" and 1 are true; everything else is not. */
export function readBoolean(value: unknown): boolean {
  return isScalar(value) && TRUTHY.has(String(value).trim().toLowerCase());
}

/** `helpwell.hw_list`: an array's scalar items as text; a lone scalar is a list of one. */
export function readList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isScalar).map(String);
  return isScalar(value) ? [String(value)] : [];
}

/** `helpwell.hw_empty`: missing, null, blank text, an empty list or an empty object. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return /^\s*$/.test(value);
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

const DAY_MS = 86_400_000;

/** The UTC day a date falls on, as [start, end) in epoch milliseconds. */
export function utcDay(time: number): [number, number] {
  const start = Math.floor(time / DAY_MS) * DAY_MS;
  return [start, start + DAY_MS];
}

export function days(n: number): number {
  return n * DAY_MS;
}
