/**
 * The shape of a condition, as JSON a person, a coding agent or the dashboard
 * can write.
 *
 *   { "all": [
 *       { "field": "plan", "op": "is", "value": "pro" },
 *       { "field": "signed_up", "op": "more_than_days_ago", "value": 30 },
 *       { "any": [
 *           { "field": "tags", "op": "includes_any", "value": ["beta"] },
 *           { "event": "exported_csv", "op": "at_least", "count": 3, "withinDays": 7 }
 *       ] }
 *   ] }
 *
 * Operators are named for what they mean rather than overloaded by type, so
 * `is` is always a text comparison and `eq` always a numeric one. That keeps a
 * condition self-describing: it evaluates the same way whether or not the
 * field has been registered yet.
 */

import type { FieldType } from '../fields/types.js';

export const TEXT_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;

/** Numbers and money: `between` takes `[low, high]`, inclusive. */
export const NUMBER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_empty',
  'is_not_empty',
] as const;

/**
 * Dates. `before`, `after` and `on` take an ISO date; the `_days` operators
 * take a whole number of days counted back or forward from now. `on` compares
 * UTC calendar days.
 */
export const DATE_OPERATORS = [
  'before',
  'after',
  'on',
  'within_last_days',
  'within_next_days',
  'more_than_days_ago',
  'is_empty',
  'is_not_empty',
] as const;

/** `is_false` is "not true": a missing value counts as false. */
export const BOOLEAN_OPERATORS = ['is_true', 'is_false'] as const;

/** Lists take an array of strings, compared case-insensitively. */
export const LIST_OPERATORS = [
  'includes_any',
  'includes_all',
  'excludes',
  'is_empty',
  'is_not_empty',
] as const;

export const EVENT_OPERATORS = ['happened', 'not_happened', 'at_least'] as const;

export type TextOperator = (typeof TEXT_OPERATORS)[number];
export type NumberOperator = (typeof NUMBER_OPERATORS)[number];
export type DateOperator = (typeof DATE_OPERATORS)[number];
export type BooleanOperator = (typeof BOOLEAN_OPERATORS)[number];
export type ListOperator = (typeof LIST_OPERATORS)[number];
export type FieldOperator =
  | TextOperator
  | NumberOperator
  | DateOperator
  | BooleanOperator
  | ListOperator;
export type EventOperator = (typeof EVENT_OPERATORS)[number];

export const FIELD_OPERATORS: readonly FieldOperator[] = [
  ...new Set<FieldOperator>([
    ...TEXT_OPERATORS,
    ...NUMBER_OPERATORS,
    ...DATE_OPERATORS,
    ...BOOLEAN_OPERATORS,
    ...LIST_OPERATORS,
  ]),
];

/** Which operators make sense for a field of each type. */
export const OPERATORS_BY_TYPE: Readonly<Record<FieldType, readonly FieldOperator[]>> = {
  text: TEXT_OPERATORS,
  url: TEXT_OPERATORS,
  number: NUMBER_OPERATORS,
  money: NUMBER_OPERATORS,
  date: DATE_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  list: LIST_OPERATORS,
};

/** Plain-language names, for the dashboard's builder and for error messages. */
export const OPERATOR_LABELS: Readonly<Record<FieldOperator | EventOperator, string>> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  on: 'is on',
  within_last_days: 'is within the last N days',
  within_next_days: 'is within the next N days',
  more_than_days_ago: 'is more than N days ago',
  is_true: 'is true',
  is_false: 'is false',
  includes_any: 'includes any of',
  includes_all: 'includes all of',
  excludes: 'excludes',
  happened: 'happened',
  not_happened: 'did not happen',
  at_least: 'happened at least N times',
};

/** A comparison against one field: a built-in one or an identify attribute. */
export interface FieldCondition {
  /** A built-in key (`email`, `tags`, `signed_up`...), an attribute name, or `attributes.<name>`. */
  field: string;
  op: FieldOperator;
  /**
   * Text operators take a string; number operators a number (`between` a
   * pair); `before`/`after`/`on` an ISO date; the `_days` operators a whole
   * number of days; list operators an array of strings. The empty and boolean
   * operators take nothing.
   */
  value?: ConditionValue;
}

/** Something the contact did, from `track()` or `POST /admin/events`. */
export interface EventCondition {
  event: string;
  op: EventOperator;
  /** `at_least` only. Defaults to 1. */
  count?: number;
  /** Only count events from the last N days. Absent: all time. */
  withinDays?: number;
}

export type ConditionValue = string | number | [number, number] | string[];

export interface AllGroup {
  all: Condition[];
}

export interface AnyGroup {
  any: Condition[];
}

/** `all` matches when every child does (and when there are none); `any` when one does. */
export type ConditionGroup = AllGroup | AnyGroup;

export type Condition = ConditionGroup | FieldCondition | EventCondition;

export function isGroup(condition: Condition): condition is ConditionGroup {
  return 'all' in condition || 'any' in condition;
}

export function isEventCondition(condition: Condition): condition is EventCondition {
  return 'event' in condition;
}

export function isFieldCondition(condition: Condition): condition is FieldCondition {
  return 'field' in condition;
}

export function childrenOf(group: ConditionGroup): Condition[] {
  return 'all' in group ? group.all : group.any;
}

/**
 * Everything the evaluator needs to know about one contact.
 *
 * `events` only has to hold the events the conditions mention, and only the
 * most recent `count` of each in its window; `loadSnapshot` fetches exactly
 * that. Dates may be `Date`s or ISO strings.
 */
export interface ContactSnapshot {
  id: string | null;
  email: string | null;
  name: string | null;
  identified: boolean;
  /** The host app's signup date, else when HelpWell first saw them. */
  signedUpAt: Date | string | null;
  lastSeenAt: Date | string | null;
  tags: string[];
  source: string | null;
  consent: string | null;
  attributes: Record<string, unknown>;
  events: { name: string; at: Date | string }[];
}

export interface EvaluateOptions {
  /** "Now" for every relative date. Defaults to the current time. */
  now?: Date;
}
