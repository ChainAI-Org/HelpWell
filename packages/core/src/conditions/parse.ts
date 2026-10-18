/**
 * Turning untrusted JSON into a condition, or a 400 that says what is wrong.
 *
 * Conditions arrive from the dashboard's builder, from the admin API and from
 * config files a coding agent wrote, so every one is checked here before it is
 * stored or compiled: known operators only, the value each operator needs, and
 * limits on depth and size so a pasted rule cannot become a query that runs
 * for a minute.
 */

import { z } from 'zod';
import { HelpWellError } from '../errors.js';
import type { FieldType } from '../fields/types.js';
import { resolveFieldRef } from '../fields/types.js';
import {
  type Condition,
  type ConditionGroup,
  childrenOf,
  EVENT_OPERATORS,
  type EventCondition,
  FIELD_OPERATORS,
  type FieldCondition,
  type FieldOperator,
  isEventCondition,
  isGroup,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
} from './types.js';
import { readTime } from './values.js';

/** Nesting deeper than this is a mistake, not a segment. */
export const MAX_DEPTH = 6;
/** More comparisons than this in one rule set is refused. */
export const MAX_CONDITIONS = 100;
const MAX_DAYS = 36_500;

const TEXT_VALUE_OPS = new Set<FieldOperator>([
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
]);
const NUMBER_VALUE_OPS = new Set<FieldOperator>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const DATE_VALUE_OPS = new Set<FieldOperator>(['before', 'after', 'on']);
const DAYS_VALUE_OPS = new Set<FieldOperator>([
  'within_last_days',
  'within_next_days',
  'more_than_days_ago',
]);
const LIST_VALUE_OPS = new Set<FieldOperator>(['includes_any', 'includes_all', 'excludes']);

const finiteNumber = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

const fieldLeaf = z
  .object({
    field: z.string().trim().min(1).max(120),
    op: z.enum(FIELD_OPERATORS as [FieldOperator, ...FieldOperator[]]),
    value: z.unknown().optional(),
  })
  .strict()
  .transform((leaf, ctx): FieldCondition => {
    const value = leafValue(leaf.op, leaf.value);
    if (value instanceof Error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${leaf.field}: ${value.message}` });
      return z.NEVER;
    }
    return value === undefined
      ? { field: leaf.field, op: leaf.op }
      : { field: leaf.field, op: leaf.op, value };
  });

const eventLeaf = z
  .object({
    event: z.string().trim().min(1).max(120),
    op: z.enum(EVENT_OPERATORS),
    count: z.number().int().min(1).max(100_000).optional(),
    withinDays: z.number().int().min(1).max(MAX_DAYS).optional(),
  })
  .strict()
  .transform((leaf): EventCondition => {
    const out: EventCondition = { event: leaf.event, op: leaf.op };
    if (leaf.op === 'at_least') out.count = leaf.count ?? 1;
    if (leaf.withinDays !== undefined) out.withinDays = leaf.withinDays;
    return out;
  });

type Parsed = z.infer<typeof fieldLeaf> | z.infer<typeof eventLeaf> | ConditionGroup;

const condition: z.ZodType<Parsed, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(condition) }).strict(),
    z.object({ any: z.array(condition) }).strict(),
    fieldLeaf,
    eventLeaf,
  ]),
) as z.ZodType<Parsed, z.ZodTypeDef, unknown>;

function leafValue(op: FieldOperator, raw: unknown): FieldCondition['value'] | Error | undefined {
  if (TEXT_VALUE_OPS.has(op)) {
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) {
      return new Error(`"${OPERATOR_LABELS[op]}" needs some text (up to 500 characters)`);
    }
    return raw;
  }
  if (NUMBER_VALUE_OPS.has(op)) {
    const parsed = finiteNumber.safeParse(raw);
    return parsed.success ? parsed.data : new Error(`"${OPERATOR_LABELS[op]}" needs a number`);
  }
  if (op === 'between') {
    const pair = z.tuple([finiteNumber, finiteNumber]).safeParse(raw);
    if (!pair.success) return new Error('"is between" needs two numbers, as [low, high]');
    const [a, b] = pair.data;
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (DATE_VALUE_OPS.has(op)) {
    if (typeof raw !== 'string' || readTime(raw) === null) {
      return new Error(`"${OPERATOR_LABELS[op]}" needs an ISO date such as 2026-01-31`);
    }
    return raw.trim();
  }
  if (DAYS_VALUE_OPS.has(op)) {
    const parsed = finiteNumber.safeParse(raw);
    if (!parsed.success || !Number.isInteger(parsed.data) || parsed.data < 0) {
      return new Error(`"${OPERATOR_LABELS[op]}" needs a whole number of days`);
    }
    return Math.min(parsed.data, MAX_DAYS);
  }
  if (LIST_VALUE_OPS.has(op)) {
    const items = typeof raw === 'string' ? [raw] : raw;
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 100 ||
      !items.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 200)
    ) {
      return new Error(`"${OPERATOR_LABELS[op]}" needs a list of up to 100 values`);
    }
    return items as string[];
  }
  // is_empty, is_not_empty, is_true, is_false: nothing to compare against.
  return undefined;
}

/**
 * Validate a condition group. A bare leaf is wrapped in `{ all: [leaf] }`, and
 * null or undefined is the empty group, which matches everyone.
 *
 * Throws a `bad_request` HelpWellError whose message names the problem.
 */
export function parseConditions(input: unknown): ConditionGroup {
  if (input === null || input === undefined) return { all: [] };
  const parsed = condition.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    throw new HelpWellError('bad_request', `Conditions are not valid${where}: ${describe(issue)}`, {
      publicMessage: `Those conditions are not valid: ${describe(issue)}`,
    });
  }
  const value = parsed.data as Condition;
  const group: ConditionGroup = isGroup(value) ? value : { all: [value] };

  const { depth, leaves } = measure(group);
  if (depth > MAX_DEPTH) {
    throw new HelpWellError('bad_request', `Conditions nest deeper than ${MAX_DEPTH} levels`);
  }
  if (leaves > MAX_CONDITIONS) {
    throw new HelpWellError('bad_request', `More than ${MAX_CONDITIONS} conditions in one rule`);
  }
  return group;
}

function describe(issue: z.ZodIssue | undefined): string {
  if (!issue) return 'unrecognised shape';
  if (issue.code === 'invalid_union') {
    return 'each condition needs "all", "any", "field" and "op", or "event" and "op"';
  }
  return issue.message;
}

function measure(condition: Condition, depth = 1): { depth: number; leaves: number } {
  if (!isGroup(condition)) return { depth, leaves: 1 };
  let deepest = depth;
  let leaves = 0;
  for (const child of childrenOf(condition)) {
    const m = measure(child, depth + 1);
    deepest = Math.max(deepest, m.depth);
    leaves += m.leaves;
  }
  return { depth: deepest, leaves };
}

/**
 * Check a parsed group against the field registry: an operator has to suit
 * the type the field was registered with. Fields nobody has registered yet
 * pass, because a rule may be written before the first identify call sends
 * the attribute. Returns the problems, empty when there are none.
 */
export function checkFieldTypes(
  group: ConditionGroup,
  typeOf: (field: string) => FieldType | undefined,
): string[] {
  const problems: string[] = [];
  const visit = (node: Condition) => {
    if (isGroup(node)) {
      for (const child of childrenOf(node)) visit(child);
      return;
    }
    if (isEventCondition(node)) return;
    const ref = resolveFieldRef(node.field);
    const type = typeOf(ref.kind === 'builtin' ? ref.key : node.field);
    if (type && !OPERATORS_BY_TYPE[type].includes(node.op)) {
      problems.push(
        `"${node.field}" is a ${type} field, so "${OPERATOR_LABELS[node.op]}" does not apply to it`,
      );
    }
  };
  visit(group);
  return problems;
}

/** Every event name a group mentions, for loading only those. */
export function referencedEvents(group: ConditionGroup): EventCondition[] {
  const out: EventCondition[] = [];
  const visit = (node: Condition) => {
    if (isGroup(node)) for (const child of childrenOf(node)) visit(child);
    else if (isEventCondition(node)) out.push(node);
  };
  visit(group);
  return out;
}
