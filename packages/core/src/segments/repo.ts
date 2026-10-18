/**
 * Segments: saved conditions with a name (CT-07).
 *
 * A segment is nothing but a rule set someone decided to keep. Membership is
 * never stored: it is computed when asked, from the contacts as they are now,
 * so a segment cannot go stale and there is no job to keep it fresh. Engage
 * targeting, surveys and (in v3) email reuse the same rules through
 * `segmentRules` and `contactInSegment`.
 */

import { sql } from 'drizzle-orm';
import { checkFieldTypes, parseConditions } from '../conditions/parse.js';
import { countMatchingContacts, type MatchStrategy } from '../conditions/scan.js';
import { contactMatches } from '../conditions/snapshot.js';
import type { ConditionGroup } from '../conditions/types.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import { fieldTypes } from '../fields/registry.js';
import { idPrefix, newId } from '../ids.js';
import { type ContactPage, listContacts } from '../repos/contacts.js';

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  rules: ConditionGroup;
  createdAt: Date;
  updatedAt: Date;
}

export interface SegmentSummary extends Segment {
  /** How many contacts match right now. */
  count: number;
}

export interface SegmentInput {
  name: string;
  description?: string | null;
  rules: unknown;
}

type SegmentRow = {
  id: string;
  name: string;
  description: string | null;
  rules: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

function toSegment(row: SegmentRow): Segment {
  let rules: ConditionGroup;
  try {
    rules = parseConditions(row.rules);
  } catch {
    // A stored rule this version cannot read matches nobody rather than everybody.
    rules = { any: [] };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rules,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Parse rules and check each operator against the field registry, so a
 * segment cannot be saved with "seats contains 4" when seats is a number.
 */
export async function validateRules(db: Db, input: unknown): Promise<ConditionGroup> {
  const rules = parseConditions(input);
  const types = await fieldTypes(db);
  const problems = checkFieldTypes(rules, (field) => types.get(field));
  if (problems.length > 0) {
    throw new HelpWellError('bad_request', problems[0]!, { details: { problems } });
  }
  return rules;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > 80) {
    throw new HelpWellError('bad_request', 'A segment needs a name of 1 to 80 characters');
  }
  return name;
}

async function assertNameFree(db: Db, name: string, except: string | null): Promise<void> {
  const clash = rowsOf(
    await db.execute(sql`
      SELECT 1 FROM helpwell.segments
      WHERE lower(name) = ${name.toLowerCase()} ${except ? sql`AND id <> ${except}` : sql``}
    `),
  );
  if (clash.length > 0) {
    throw new HelpWellError('conflict', `There is already a segment called "${name}"`);
  }
}

export async function listSegments(
  db: Db,
  options: { now?: Date } = {},
): Promise<SegmentSummary[]> {
  const rows = rowsOf<SegmentRow>(
    await db.execute(sql`
      SELECT id, name, description, rules, created_at, updated_at
      FROM helpwell.segments ORDER BY lower(name)
    `),
  );
  const out: SegmentSummary[] = [];
  for (const row of rows) {
    const segment = toSegment(row);
    out.push({ ...segment, count: await countMatchingContacts(db, segment.rules, options) });
  }
  return out;
}

export async function getSegment(db: Db, id: string): Promise<Segment | null> {
  const row = rowsOf<SegmentRow>(
    await db.execute(sql`
      SELECT id, name, description, rules, created_at, updated_at
      FROM helpwell.segments WHERE id = ${id}
    `),
  )[0];
  return row ? toSegment(row) : null;
}

export async function createSegment(db: Db, input: SegmentInput): Promise<Segment> {
  const name = cleanName(input.name);
  const rules = await validateRules(db, input.rules);
  await assertNameFree(db, name, null);
  const id = newId(idPrefix.segment);
  await db.execute(sql`
    INSERT INTO helpwell.segments (id, name, description, rules)
    VALUES (${id}, ${name}, ${input.description?.toString().slice(0, 500) || null},
            ${JSON.stringify(rules)}::jsonb)
  `);
  return (await getSegment(db, id))!;
}

export async function updateSegment(
  db: Db,
  id: string,
  patch: Partial<SegmentInput>,
): Promise<Segment | null> {
  const current = await getSegment(db, id);
  if (!current) return null;
  const name = patch.name === undefined ? current.name : cleanName(patch.name);
  if (name.toLowerCase() !== current.name.toLowerCase()) await assertNameFree(db, name, id);
  const rules = patch.rules === undefined ? current.rules : await validateRules(db, patch.rules);
  const description =
    patch.description === undefined
      ? current.description
      : patch.description === null
        ? null
        : String(patch.description).slice(0, 500) || null;
  await db.execute(sql`
    UPDATE helpwell.segments
    SET name = ${name}, description = ${description}, rules = ${JSON.stringify(rules)}::jsonb,
        updated_at = now()
    WHERE id = ${id}
  `);
  return getSegment(db, id);
}

export async function deleteSegment(db: Db, id: string): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`DELETE FROM helpwell.segments WHERE id = ${id} RETURNING id`),
  );
  return rows.length > 0;
}

/** A segment's rules by id, for engage and forms. Null when it does not exist. */
export async function segmentRules(db: Db, id: string): Promise<ConditionGroup | null> {
  return (await getSegment(db, id))?.rules ?? null;
}

/** How many contacts a segment (or an unsaved rule set) matches. */
export async function countSegment(
  db: Db,
  rules: ConditionGroup,
  options: { now?: Date; strategy?: MatchStrategy } = {},
): Promise<number> {
  return countMatchingContacts(db, rules, options);
}

/** A page of a segment's members, newest first, in the contact list's shape. */
export async function segmentMembers(
  db: Db,
  rules: ConditionGroup,
  options: { cursor?: string; limit?: number; now?: Date } = {},
): Promise<ContactPage> {
  return listContacts(db, { conditions: rules, ...options });
}

/**
 * Is this person in the segment? For request-time targeting. An unknown
 * segment matches nobody, so deleting a segment switches off what used it
 * rather than showing it to everyone.
 */
export async function contactInSegment(
  db: Db,
  contactId: string | null,
  segmentId: string,
  options: { now?: Date } = {},
): Promise<boolean> {
  const rules = await segmentRules(db, segmentId);
  if (!rules) return false;
  return contactMatches(db, contactId, rules, options);
}
