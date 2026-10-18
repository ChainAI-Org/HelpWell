/**
 * Tracked events: what a contact did, as the host app reported it.
 *
 * `track()` in the widget and the SDK, and `POST /admin/events` from the host
 * app's own server, all land here. For a long time only the activity feed
 * read them back; now they are listable by contact and by name, counted, and
 * usable in conditions ("exported a CSV at least three times this week").
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';

export interface EventInput {
  contactId: string;
  name: string;
  props?: Record<string, unknown>;
  url?: string | null;
  /** When it happened, for a backfill. Defaults to now; the future is refused. */
  at?: Date;
}

export interface TrackedEvent {
  id: string;
  contactId: string | null;
  name: string;
  props: Record<string, unknown>;
  url: string | null;
  createdAt: Date;
}

export interface EventPage {
  items: TrackedEvent[];
  nextCursor: string | null;
}

export interface EventCount {
  name: string;
  count: number;
  /** How many different contacts did it. */
  contacts: number;
  lastAt: Date;
}

/** Event names are identifiers, not prose: trimmed, 1 to 120 characters. */
export function eventName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > 120) {
    throw new HelpWellError('bad_request', 'An event needs a name of 1 to 120 characters');
  }
  return name;
}

export async function recordEvent(db: Db, input: EventInput): Promise<string> {
  const id = newId(idPrefix.event);
  const now = new Date();
  const at = input.at && input.at.getTime() <= now.getTime() ? input.at : now;
  const props = JSON.stringify(input.props ?? {});
  if (props.length > 8000) {
    throw new HelpWellError('bad_request', 'Event props are limited to 8 KB of JSON');
  }
  await db.execute(sql`
    INSERT INTO helpwell.events (id, contact_id, name, props, url, created_at)
    VALUES (${id}, ${input.contactId}, ${eventName(input.name)}, ${props}::jsonb,
            ${input.url?.slice(0, 2000) ?? null}, ${at.toISOString()}::timestamptz)
  `);
  return id;
}

type EventRow = {
  id: string;
  contact_id: string | null;
  name: string;
  props: Record<string, unknown> | null;
  url: string | null;
  created_at: string | Date;
  /** created_at to the microsecond, so a cursor never falls between two rows. */
  cursor_at: string;
};

/**
 * Newest first, filtered by contact and/or name. The cursor carries the last
 * row's time and id together, because a backfilled event's id is newer than
 * its time.
 */
export async function listEvents(
  db: Db,
  options: { contactId?: string; name?: string; cursor?: string; limit?: number } = {},
): Promise<EventPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const filters = [sql`TRUE`];
  if (options.contactId) filters.push(sql`contact_id = ${options.contactId}`);
  if (options.name) filters.push(sql`name = ${options.name}`);
  const cursor = parseCursor(options.cursor);
  if (cursor) {
    filters.push(sql`(created_at, id) < (${cursor.at}::timestamptz, ${cursor.id})`);
  }

  const rows = rowsOf<EventRow>(
    await db.execute(sql`
      SELECT id, contact_id, name, props, url, created_at,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM helpwell.events
      WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `),
  );
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      contactId: row.contact_id,
      name: row.name,
      props: row.props ?? {},
      url: row.url,
      createdAt: new Date(row.created_at),
    })),
    nextCursor:
      rows.length > limit && page.length > 0
        ? `${page.at(-1)!.cursor_at}~${page.at(-1)!.id}`
        : null,
  };
}

function parseCursor(raw: string | undefined): { at: string; id: string } | null {
  if (!raw) return null;
  const [at, id] = raw.split('~');
  if (!at || !id || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at)) {
    throw new HelpWellError('bad_request', 'cursor is not one this server issued');
  }
  return { at, id };
}

/** Each event name with how often it happened and to how many people, most frequent first. */
export async function eventCounts(
  db: Db,
  options: { contactId?: string; since?: Date | null; limit?: number } = {},
): Promise<EventCount[]> {
  const filters = [sql`TRUE`];
  if (options.contactId) filters.push(sql`contact_id = ${options.contactId}`);
  if (options.since) filters.push(sql`created_at >= ${options.since.toISOString()}::timestamptz`);
  const rows = rowsOf<{
    name: string;
    count: number | string;
    contacts: number | string;
    last_at: string | Date;
  }>(
    await db.execute(sql`
      SELECT name, count(*) AS count, count(DISTINCT contact_id) AS contacts,
             max(created_at) AS last_at
      FROM helpwell.events
      WHERE ${sql.join(filters, sql` AND `)}
      GROUP BY name
      ORDER BY count(*) DESC, name
      LIMIT ${Math.max(1, Math.min(options.limit ?? 100, 500))}
    `),
  );
  return rows.map((row) => ({
    name: row.name,
    count: Number(row.count),
    contacts: Number(row.contacts),
    lastAt: new Date(row.last_at),
  }));
}
