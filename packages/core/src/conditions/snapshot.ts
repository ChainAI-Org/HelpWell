/**
 * Building the in-memory picture of a contact that `evaluateConditions` reads.
 *
 * Only what the conditions need is loaded: the contact row and its tags, plus,
 * for each event condition, at most the most recent `count` matching events in
 * its window. Newest first means the union across several conditions on the
 * same event still holds every event each one needs to count.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { textArray } from './compile.js';
import { anonymousSnapshot, evaluateConditions } from './evaluate.js';
import { referencedEvents } from './parse.js';
import type { Condition, ConditionGroup, ContactSnapshot, EvaluateOptions } from './types.js';
import { isGroup } from './types.js';
import { days } from './values.js';

type ContactRow = {
  id: string;
  email: string | null;
  name: string | null;
  identified: boolean;
  signed_up_at: string | Date | null;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
  source: string;
  consent: string;
  attributes: Record<string, unknown> | null;
};

/**
 * Snapshots for many contacts at once: one query for the rows, one for their
 * tags, one per event condition. Contacts that do not exist (or were erased)
 * are absent from the map.
 */
export async function loadSnapshots(
  db: Db,
  contactIds: string[],
  condition: Condition | null = null,
  options: EvaluateOptions = {},
): Promise<Map<string, ContactSnapshot>> {
  const out = new Map<string, ContactSnapshot>();
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return out;

  const rows = rowsOf<ContactRow>(
    await db.execute(sql`
      SELECT id, email, name, identified, signed_up_at, first_seen_at, last_seen_at,
             source, consent, attributes
      FROM helpwell.contacts
      WHERE id = ANY(${textArray(ids)}) AND deleted_at IS NULL
    `),
  );
  for (const row of rows) {
    out.set(row.id, {
      id: row.id,
      email: row.email,
      name: row.name,
      identified: Boolean(row.identified),
      signedUpAt: new Date(row.signed_up_at ?? row.first_seen_at),
      lastSeenAt: new Date(row.last_seen_at),
      tags: [],
      source: row.source,
      consent: row.consent,
      attributes: row.attributes ?? {},
      events: [],
    });
  }
  if (out.size === 0) return out;
  const present = [...out.keys()];

  const tags = rowsOf<{ contact_id: string; tag: string }>(
    await db.execute(sql`
      SELECT contact_id, tag FROM helpwell.contact_tags
      WHERE contact_id = ANY(${textArray(present)})
      ORDER BY tag
    `),
  );
  for (const row of tags) out.get(row.contact_id)?.tags.push(row.tag);

  const group: ConditionGroup | null = condition
    ? isGroup(condition)
      ? condition
      : { all: [condition] }
    : null;
  const now = options.now ?? new Date();
  for (const leaf of group ? referencedEvents(group) : []) {
    const limit = leaf.op === 'at_least' ? (leaf.count ?? 1) : 1;
    const since = leaf.withinDays ? new Date(now.getTime() - days(leaf.withinDays)) : null;
    const events = rowsOf<{ contact_id: string; created_at: string | Date }>(
      await db.execute(sql`
        SELECT contact_id, created_at FROM (
          SELECT contact_id, created_at,
                 row_number() OVER (PARTITION BY contact_id ORDER BY created_at DESC) AS rank
          FROM helpwell.events
          WHERE contact_id = ANY(${textArray(present)}) AND name = ${leaf.event}
            AND created_at <= ${now.toISOString()}::timestamptz
            ${since ? sql`AND created_at >= ${since.toISOString()}::timestamptz` : sql``}
        ) AS recent
        WHERE rank <= ${limit}
      `),
    );
    for (const row of events) {
      out.get(row.contact_id)?.events.push({ name: leaf.event, at: new Date(row.created_at) });
    }
  }

  return out;
}

/** One contact's snapshot, or null when there is no such (live) contact. */
export async function loadSnapshot(
  db: Db,
  contactId: string,
  condition: Condition | null = null,
  options: EvaluateOptions = {},
): Promise<ContactSnapshot | null> {
  return (await loadSnapshots(db, [contactId], condition, options)).get(contactId) ?? null;
}

/**
 * Does this contact match? The convenience for request-time targeting: a
 * visitor with no contact yet (or an erased one) is evaluated as anonymous,
 * so "identified is false" still matches a first-time visitor.
 */
export async function contactMatches(
  db: Db,
  contactId: string | null,
  condition: Condition,
  options: EvaluateOptions = {},
): Promise<boolean> {
  const snapshot = contactId ? await loadSnapshot(db, contactId, condition, options) : null;
  return evaluateConditions(condition, snapshot ?? anonymousSnapshot(), options);
}
