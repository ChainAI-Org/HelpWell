/**
 * Compiling a condition into a SQL predicate over `helpwell.contacts`.
 *
 * This is the path for many people at once: counting a segment, listing its
 * members a page at a time, exporting it. The predicate is a plain boolean
 * expression, so it drops into any WHERE clause that has the contacts table
 * in scope under the alias you name, and it never loads a contact into
 * memory.
 *
 * Every value a condition carries is a bound parameter; the only thing
 * interpolated as SQL is the table alias, which is checked. Each leaf is
 * wrapped so it is never NULL, which keeps AND, OR and the negated operators
 * behaving exactly as the in-memory evaluator does.
 */

import { type SQL, sql } from 'drizzle-orm';
import { resolveFieldRef } from '../fields/types.js';
import {
  type Condition,
  childrenOf,
  type EventCondition,
  type FieldCondition,
  isEventCondition,
  isGroup,
} from './types.js';
import { days, readTime, utcDay } from './values.js';

export interface CompileOptions {
  /** The alias the contacts table has in the surrounding query. Default `c`. */
  alias?: string;
  /** "Now" for every relative date and event window. Defaults to the current time. */
  now?: Date;
}

/**
 * A SQL boolean for "this contact matches". Every condition the parser
 * accepts compiles; `null` is reserved for a leaf this compiler does not know
 * (a condition from a newer version), which callers answer by paging through
 * contacts and evaluating in memory instead.
 */
export function compileConditions(condition: Condition, options: CompileOptions = {}): SQL | null {
  const alias = options.alias ?? 'c';
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Unsafe table alias: ${alias}`);
  const now = options.now ?? new Date();
  return compile(condition, sql.raw(alias), now);
}

function compile(condition: Condition, c: SQL, now: Date): SQL | null {
  if (isGroup(condition)) {
    const all = 'all' in condition;
    const parts: SQL[] = [];
    for (const child of childrenOf(condition)) {
      const part = compile(child, c, now);
      if (part === null) return null;
      parts.push(part);
    }
    if (parts.length === 0) return all ? sql`TRUE` : sql`FALSE`;
    return sql`(${sql.join(parts, all ? sql` AND ` : sql` OR `)})`;
  }
  if (isEventCondition(condition)) return compileEvent(condition, c, now);
  if ('field' in condition) return compileField(condition, c, now);
  return null;
}

/** The value behind a field as jsonb, so built-ins and attributes share the hw_* readers. */
function operand(field: string, c: SQL): SQL | null {
  const ref = resolveFieldRef(field);
  if (ref.kind === 'attribute') return sql`(${c}.attributes -> ${ref.key})`;
  switch (ref.key) {
    case 'email':
      return sql`to_jsonb(${c}.email)`;
    case 'name':
      return sql`to_jsonb(${c}.name)`;
    case 'signed_up':
      return sql`to_jsonb(coalesce(${c}.signed_up_at, ${c}.first_seen_at))`;
    case 'last_seen':
      return sql`to_jsonb(${c}.last_seen_at)`;
    case 'identified':
      return sql`to_jsonb(${c}.identified)`;
    case 'tags':
      return sql`(SELECT coalesce(jsonb_agg(hw_tag.tag), '[]'::jsonb)
        FROM helpwell.contact_tags hw_tag WHERE hw_tag.contact_id = ${c}.id)`;
    case 'source':
      return sql`to_jsonb(${c}.source)`;
    case 'consent':
      return sql`to_jsonb(${c}.consent)`;
    default:
      return null;
  }
}

/** A JS string array as a SQL text[] parameter, the same way on both drivers. */
export function textArray(values: string[]): SQL {
  return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
}

function never(value: SQL): SQL {
  return sql`coalesce(${value}, false)`;
}

function compileField(condition: FieldCondition, c: SQL, now: Date): SQL | null {
  const v = operand(condition.field, c);
  if (v === null) return null;
  const { op, value } = condition;
  const text = sql`lower(helpwell.hw_text(${v}))`;
  const want = () => String(value).toLowerCase();
  const num = sql`helpwell.hw_num(${v})`;
  const time = sql`helpwell.hw_time(${v})`;
  const at = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`;

  switch (op) {
    case 'is':
      return never(sql`${text} = ${want()}`);
    case 'is_not':
      return sql`NOT ${never(sql`${text} = ${want()}`)}`;
    case 'contains':
      return never(sql`strpos(${text}, ${want()}) > 0`);
    case 'not_contains':
      return sql`NOT ${never(sql`strpos(${text}, ${want()}) > 0`)}`;
    case 'starts_with':
      return never(sql`left(${text}, ${want().length}) = ${want()}`);
    case 'ends_with':
      return never(sql`right(${text}, ${want().length}) = ${want()}`);
    case 'is_empty':
      return never(sql`helpwell.hw_empty(${v})`);
    case 'is_not_empty':
      return sql`NOT ${never(sql`helpwell.hw_empty(${v})`)}`;

    case 'eq':
      return never(sql`${num} = ${Number(value)}`);
    case 'neq':
      return sql`NOT ${never(sql`${num} = ${Number(value)}`)}`;
    case 'gt':
      return never(sql`${num} > ${Number(value)}`);
    case 'gte':
      return never(sql`${num} >= ${Number(value)}`);
    case 'lt':
      return never(sql`${num} < ${Number(value)}`);
    case 'lte':
      return never(sql`${num} <= ${Number(value)}`);
    case 'between': {
      const [low, high] = value as [number, number];
      return never(sql`${num} BETWEEN ${low} AND ${high}`);
    }

    case 'before':
    case 'after':
    case 'on': {
      const target = readTime(value);
      if (target === null) return sql`FALSE`;
      if (op === 'before') return never(sql`${time} < ${at(target)}`);
      if (op === 'after') return never(sql`${time} > ${at(target)}`);
      const [start, end] = utcDay(target);
      return never(sql`(${time} >= ${at(start)} AND ${time} < ${at(end)})`);
    }
    case 'within_last_days': {
      const n = now.getTime();
      return never(sql`(${time} >= ${at(n - days(Number(value)))} AND ${time} <= ${at(n)})`);
    }
    case 'within_next_days': {
      const n = now.getTime();
      return never(sql`(${time} >= ${at(n)} AND ${time} <= ${at(n + days(Number(value)))})`);
    }
    case 'more_than_days_ago':
      return never(sql`${time} < ${at(now.getTime() - days(Number(value)))}`);

    case 'is_true':
      return never(sql`helpwell.hw_bool(${v})`);
    case 'is_false':
      return sql`NOT ${never(sql`helpwell.hw_bool(${v})`)}`;

    case 'includes_any':
    case 'excludes': {
      const wanted = [...new Set((value as string[]).map((item) => item.toLowerCase()))];
      const hit = sql`EXISTS (SELECT 1 FROM unnest(helpwell.hw_list(${v})) AS hw_item
        WHERE lower(hw_item) = ANY(${textArray(wanted)}))`;
      return op === 'includes_any' ? hit : sql`NOT ${hit}`;
    }
    case 'includes_all': {
      const wanted = [...new Set((value as string[]).map((item) => item.toLowerCase()))];
      return sql`((SELECT count(DISTINCT lower(hw_item)) FROM unnest(helpwell.hw_list(${v})) AS hw_item
        WHERE lower(hw_item) = ANY(${textArray(wanted)})) = ${wanted.length})`;
    }
    default:
      return null;
  }
}

function compileEvent(condition: EventCondition, c: SQL, now: Date): SQL {
  const window = condition.withinDays
    ? sql` AND hw_event.created_at >= ${new Date(now.getTime() - days(condition.withinDays)).toISOString()}::timestamptz`
    : sql``;
  const matching = sql`FROM helpwell.events hw_event
    WHERE hw_event.contact_id = ${c}.id AND hw_event.name = ${condition.event}
      AND hw_event.created_at <= ${now.toISOString()}::timestamptz${window}`;

  if (condition.op === 'happened') return sql`EXISTS (SELECT 1 ${matching})`;
  if (condition.op === 'not_happened') return sql`NOT EXISTS (SELECT 1 ${matching})`;
  const count = condition.count ?? 1;
  // Counting stops at `count`: "at least 3" never scans the other ten thousand.
  return sql`((SELECT count(*) FROM (SELECT 1 ${matching} LIMIT ${count}) AS hw_hits) >= ${count})`;
}
