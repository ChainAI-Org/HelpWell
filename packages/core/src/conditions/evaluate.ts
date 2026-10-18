/**
 * Evaluating a condition against one contact, in memory.
 *
 * This is the path for a single person at request time: should this visitor
 * see this banner, does this form apply to them. It needs no database once
 * the snapshot is built (see snapshot.ts), and it answers exactly what the
 * compiled SQL in compile.ts answers for the same contact.
 */

import { resolveFieldRef } from '../fields/types.js';
import {
  type Condition,
  type ContactSnapshot,
  childrenOf,
  type EvaluateOptions,
  type EventCondition,
  type FieldCondition,
  isEventCondition,
  isGroup,
} from './types.js';
import {
  days,
  isEmptyValue,
  readBoolean,
  readList,
  readNumber,
  readText,
  readTime,
  utcDay,
} from './values.js';

/** Does this contact match? Groups short-circuit the way SQL's AND and OR do. */
export function evaluateConditions(
  condition: Condition,
  snapshot: ContactSnapshot,
  options: EvaluateOptions = {},
): boolean {
  const now = (options.now ?? new Date()).getTime();
  return evaluate(condition, snapshot, now);
}

function evaluate(condition: Condition, snapshot: ContactSnapshot, now: number): boolean {
  if (isGroup(condition)) {
    const children = childrenOf(condition);
    return 'all' in condition
      ? children.every((child) => evaluate(child, snapshot, now))
      : children.some((child) => evaluate(child, snapshot, now));
  }
  if (isEventCondition(condition)) return evaluateEvent(condition, snapshot, now);
  return evaluateField(condition, fieldValue(condition.field, snapshot), now);
}

/** The raw value behind a condition's `field`, in the shape an attribute would have. */
export function fieldValue(field: string, snapshot: ContactSnapshot): unknown {
  const ref = resolveFieldRef(field);
  if (ref.kind === 'attribute') return snapshot.attributes?.[ref.key];
  switch (ref.key) {
    case 'email':
      return snapshot.email;
    case 'name':
      return snapshot.name;
    case 'signed_up':
      return snapshot.signedUpAt;
    case 'last_seen':
      return snapshot.lastSeenAt;
    case 'identified':
      return snapshot.identified;
    case 'tags':
      return snapshot.tags;
    case 'source':
      return snapshot.source;
    case 'consent':
      return snapshot.consent;
    default:
      return undefined;
  }
}

function lower(value: string): string {
  return value.toLowerCase();
}

function evaluateField(condition: FieldCondition, raw: unknown, now: number): boolean {
  const { op, value } = condition;
  const text = () => readText(raw);
  const textIs = (fn: (have: string, want: string) => boolean) => {
    const have = text();
    return have !== null && fn(lower(have), lower(String(value)));
  };

  switch (op) {
    case 'is':
      return textIs((have, want) => have === want);
    case 'is_not':
      return !textIs((have, want) => have === want);
    case 'contains':
      return textIs((have, want) => have.includes(want));
    case 'not_contains':
      return !textIs((have, want) => have.includes(want));
    case 'starts_with':
      return textIs((have, want) => have.startsWith(want));
    case 'ends_with':
      return textIs((have, want) => have.endsWith(want));
    case 'is_empty':
      return isEmptyValue(raw);
    case 'is_not_empty':
      return !isEmptyValue(raw);

    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const have = readNumber(raw);
      const want = Number(value);
      const hit =
        have !== null &&
        (op === 'eq' || op === 'neq'
          ? have === want
          : op === 'gt'
            ? have > want
            : op === 'gte'
              ? have >= want
              : op === 'lt'
                ? have < want
                : have <= want);
      return op === 'neq' ? !hit : hit;
    }
    case 'between': {
      const have = readNumber(raw);
      const [low, high] = value as [number, number];
      return have !== null && have >= low && have <= high;
    }

    case 'before':
    case 'after':
    case 'on': {
      const have = readTime(raw);
      const want = readTime(value);
      if (have === null || want === null) return false;
      if (op === 'before') return have < want;
      if (op === 'after') return have > want;
      const [start, end] = utcDay(want);
      return have >= start && have < end;
    }
    case 'within_last_days': {
      const have = readTime(raw);
      return have !== null && have >= now - days(Number(value)) && have <= now;
    }
    case 'within_next_days': {
      const have = readTime(raw);
      return have !== null && have >= now && have <= now + days(Number(value));
    }
    case 'more_than_days_ago': {
      const have = readTime(raw);
      return have !== null && have < now - days(Number(value));
    }

    case 'is_true':
      return readBoolean(raw);
    case 'is_false':
      return !readBoolean(raw);

    case 'includes_any':
    case 'includes_all':
    case 'excludes': {
      const have = new Set(readList(raw).map(lower));
      const want = [...new Set((value as string[]).map(lower))];
      if (op === 'includes_all') return want.every((item) => have.has(item));
      const any = want.some((item) => have.has(item));
      return op === 'includes_any' ? any : !any;
    }
  }
}

function evaluateEvent(condition: EventCondition, snapshot: ContactSnapshot, now: number): boolean {
  const since = condition.withinDays ? now - days(condition.withinDays) : Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const event of snapshot.events ?? []) {
    if (event.name !== condition.event) continue;
    const at = readTime(event.at);
    if (at === null || at < since || at > now) continue;
    count++;
  }
  if (condition.op === 'happened') return count > 0;
  if (condition.op === 'not_happened') return count === 0;
  return count >= (condition.count ?? 1);
}

/** A visitor HelpWell has no row for yet: anonymous, untagged, with no history. */
export function anonymousSnapshot(): ContactSnapshot {
  return {
    id: null,
    email: null,
    name: null,
    identified: false,
    signedUpAt: null,
    lastSeenAt: null,
    tags: [],
    source: null,
    consent: null,
    attributes: {},
    events: [],
  };
}
