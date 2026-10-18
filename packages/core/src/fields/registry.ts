/**
 * The contact field registry: every attribute key anyone has sent, typed.
 *
 * Attributes arrive as untyped JSON from identify calls, the admin API, forms
 * and imports. The registry is what lets a condition builder offer "seats" as
 * a number and "trial_ends_at" as a date without asking, and what stops the
 * meaning of a field drifting: the type is inferred once, the first time a
 * key is seen, and after that only a person changes it. Changing it locks it.
 *
 * Recording is cheap on purpose (one statement per identify, and a key seen
 * in the last five minutes is not rewritten), because it runs on the hot path
 * of every sign-in.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import {
  FIELD_TYPES,
  type FieldSource,
  type FieldType,
  fieldKeyForAttribute,
  labelForKey,
} from './types.js';

/** A registry stops learning new keys at this many, so a host bug cannot flood it. */
export const MAX_FIELDS = 500;

export interface ContactField {
  key: string;
  label: string;
  type: FieldType;
  source: FieldSource;
  /** A person chose this type, or HelpWell owns the field; inference never touches it. */
  locked: boolean;
  /** Left out of the contact page and the condition builder. Still stored and filterable. */
  hidden: boolean;
  /** One of HelpWell's own fields rather than an attribute. */
  builtin: boolean;
  /** The most recent value seen, trimmed. */
  sample: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const URL_VALUE = /^https?:\/\/\S+$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;
const MONEY_TEXT = /^\s*[$€£]\s*-?[0-9][0-9,]*(\.[0-9]+)?\s*$/;
const DATE_KEY = /(_at|At|_date|Date|_on|_time|Time)$/;
const MONEY_KEY =
  /^(mrr|arr|ltv|revenue|price|amount|spend|spent|balance|budget)$|(_usd|_mrr|_price|_amount)$/i;

/**
 * The type a value suggests, the first time its key is seen. The key's name
 * breaks ties a value cannot: `1718000000` under `trial_ends_at` is a date,
 * and `49` under `mrr` is money.
 */
export function inferFieldType(key: string, value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') {
    if (DATE_KEY.test(key) && Math.abs(value) > 100_000_000) return 'date';
    if (MONEY_KEY.test(key)) return 'money';
    return 'number';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (URL_VALUE.test(trimmed)) return 'url';
    if (ISO_DATE.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return 'date';
    if (MONEY_TEXT.test(trimmed)) return 'money';
    return 'text';
  }
  return 'text';
}

/** What the registry keeps as an example: short, and never a whole object. */
function sampleOf(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 200);
  if (Array.isArray(value)) {
    return value
      .slice(0, 10)
      .map((item) => (typeof item === 'string' ? item.slice(0, 100) : item))
      .filter((item) => item === null || typeof item !== 'object');
  }
  if (value !== null && typeof value === 'object') return null;
  return value;
}

/**
 * Note the keys in a set of attributes. New keys get an inferred type; known
 * ones get their last-seen time and sample refreshed. Null values are skipped
 * (they unset an attribute rather than describe one). Never throws: a failure
 * to describe a field must not fail the identify call that carried it.
 */
export async function recordFields(
  db: Db,
  attributes: Record<string, unknown>,
  source: FieldSource,
  now: Date = new Date(),
): Promise<void> {
  const rows = Object.entries(attributes)
    .filter(([key, value]) => value !== null && value !== undefined && key.length <= 120)
    .map(([key, value]) => {
      const fieldKey = fieldKeyForAttribute(key);
      return {
        key: fieldKey,
        label: labelForKey(key),
        type: inferFieldType(key, value),
        sample: sampleOf(value),
      };
    });
  if (rows.length === 0) return;

  try {
    await db.execute(sql`
      INSERT INTO helpwell.contact_fields AS f
        (key, label, type, source, sample, first_seen_at, last_seen_at)
      SELECT x.key, x.label, x.type, ${source}, x.sample,
             ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x(key text, label text, type text, sample jsonb)
      WHERE EXISTS (SELECT 1 FROM helpwell.contact_fields k WHERE k.key = x.key)
         OR (SELECT count(*) FROM helpwell.contact_fields) < ${MAX_FIELDS}
      ON CONFLICT (key) DO UPDATE
        SET last_seen_at = EXCLUDED.last_seen_at, sample = EXCLUDED.sample
        WHERE f.source <> 'helpwell'
          AND f.last_seen_at < EXCLUDED.last_seen_at - interval '5 minutes'
    `);
  } catch {
    // Describing the attributes is a convenience; storing them already happened.
  }
}

type FieldRow = {
  key: string;
  label: string;
  type: FieldType;
  source: FieldSource;
  locked: boolean;
  hidden: boolean;
  sample: unknown;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
};

function toField(row: FieldRow): ContactField {
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    source: row.source,
    locked: Boolean(row.locked),
    hidden: Boolean(row.hidden),
    builtin: row.source === 'helpwell',
    sample: row.sample ?? null,
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

/** Built-in fields first, in their fixed order, then attributes by label. */
export async function listFields(
  db: Db,
  options: { includeHidden?: boolean } = {},
): Promise<ContactField[]> {
  const result = await db.execute(sql`
    SELECT key, label, type, source, locked, hidden, sample, first_seen_at, last_seen_at
    FROM helpwell.contact_fields
    ${options.includeHidden === false ? sql`WHERE hidden = false` : sql``}
    ORDER BY (source = 'helpwell') DESC,
      CASE key WHEN 'email' THEN 1 WHEN 'name' THEN 2 WHEN 'signed_up' THEN 3
        WHEN 'last_seen' THEN 4 WHEN 'identified' THEN 5 WHEN 'tags' THEN 6
        WHEN 'source' THEN 7 WHEN 'consent' THEN 8 ELSE 9 END,
      lower(label), key
  `);
  return rowsOf<FieldRow>(result).map(toField);
}

export async function getField(db: Db, key: string): Promise<ContactField | null> {
  const result = await db.execute(sql`
    SELECT key, label, type, source, locked, hidden, sample, first_seen_at, last_seen_at
    FROM helpwell.contact_fields WHERE key = ${key}
  `);
  const row = rowsOf<FieldRow>(result)[0];
  return row ? toField(row) : null;
}

/** Field key to type, for checking a condition's operators against the registry. */
export async function fieldTypes(db: Db): Promise<Map<string, FieldType>> {
  const result = await db.execute(sql`SELECT key, type FROM helpwell.contact_fields`);
  return new Map(rowsOf<{ key: string; type: FieldType }>(result).map((r) => [r.key, r.type]));
}

export interface FieldPatch {
  label?: string;
  /** Only while the field is unlocked; setting it locks the field. */
  type?: FieldType;
  hidden?: boolean;
  /** `false` unlocks an attribute so its type can be changed again. Built-ins stay locked. */
  locked?: boolean;
}

/**
 * Change how a field is labelled, typed or shown. A type change on a locked
 * field is a 409, and a built-in field's type and lock never change.
 */
export async function updateField(
  db: Db,
  key: string,
  patch: FieldPatch,
): Promise<ContactField | null> {
  const current = await getField(db, key);
  if (!current) return null;

  const label = patch.label?.trim();
  if (patch.label !== undefined && (!label || label.length > 80)) {
    throw new HelpWellError('bad_request', 'A field label needs 1 to 80 characters');
  }
  if (patch.type !== undefined && !(FIELD_TYPES as readonly string[]).includes(patch.type)) {
    throw new HelpWellError('bad_request', `type must be one of: ${FIELD_TYPES.join(', ')}`);
  }
  if (current.builtin && (patch.type !== undefined || patch.locked !== undefined)) {
    if (patch.type !== undefined && patch.type !== current.type) {
      throw new HelpWellError('conflict', `"${key}" is a built-in field; its type is fixed`);
    }
  }

  let locked = current.locked;
  if (!current.builtin && patch.locked === false) locked = false;
  let type = current.type;
  if (patch.type !== undefined && patch.type !== current.type) {
    if (locked) {
      throw new HelpWellError(
        'conflict',
        `"${key}" is locked as ${current.type}. Unlock it first to change its type.`,
      );
    }
    type = patch.type;
    locked = true;
  } else if (patch.type !== undefined && !current.builtin) {
    // Confirming the inferred type is a choice too, and locks it the same way.
    locked = true;
  }

  await db.execute(sql`
    UPDATE helpwell.contact_fields
    SET label = ${label ?? current.label}, type = ${type}, locked = ${locked},
        hidden = ${patch.hidden ?? current.hidden}
    WHERE key = ${key}
  `);
  return getField(db, key);
}
