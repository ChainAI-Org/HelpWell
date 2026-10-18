/**
 * Changelog.
 *
 * The public feed is cursor-paginated and never returns article bodies in a
 * list. A product with three years of releases would otherwise ship a megabyte
 * of HTML to open the widget (CL-03).
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { changelogEntries, changelogReads } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';
import { emitStoredWebhooks, type WebhookOptions } from '../webhooks.js';

export const CHANGELOG_STATUSES = ['draft', 'published', 'archived'] as const;
export type ChangelogStatus = (typeof CHANGELOG_STATUSES)[number];

export interface ChangelogSummary {
  id: string;
  version: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  coverUrl: string | null;
  /** Always `published` on the public feed; the dashboard lists every state. */
  status: ChangelogStatus;
  publishedAt: Date | null;
  read?: boolean;
}

export interface ChangelogDetail extends ChangelogSummary {
  body: string;
  sourceRef: string | null;
}

export interface ListChangelogOptions {
  /** Admin listing includes drafts; the public feed never does. */
  includeUnpublished?: boolean;
  tag?: string;
  limit?: number;
  /** ISO timestamp of the last entry on the previous page. */
  cursor?: string;
  /** When set, each entry carries whether this contact has read it. */
  contactId?: string | null;
}

export interface ChangelogPage {
  items: ChangelogSummary[];
  nextCursor: string | null;
}

type EntryRow = {
  id: string;
  version: string | null;
  title: string;
  summary: string | null;
  tags: string[] | null;
  cover_url: string | null;
  status: ChangelogStatus;
  published_at: string | Date | null;
  created_at: string | Date;
  read: boolean | null;
};

export async function listChangelog(
  db: Db,
  options: ListChangelogOptions = {},
): Promise<ChangelogPage> {
  const limit = Math.min(options.limit ?? 10, 50);

  // Sorting key: published entries by publish date, drafts by when they were
  // written. Repeated rather than aliased so it can be used in WHERE too.
  const sortAt = sql`COALESCE(e.published_at, e.created_at)`;

  const filters = options.includeUnpublished
    ? [sql`TRUE`]
    : [sql`e.status = 'published' AND e.published_at IS NOT NULL AND e.published_at <= now()`];

  // jsonb_array_elements_text rather than the `?` operator: `?` is a parameter
  // placeholder in some drivers and would be rewritten out from under us.
  if (options.tag) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.tags) tg WHERE tg = ${options.tag})`,
    );
  }
  if (options.cursor) {
    const cursor = new Date(options.cursor);
    if (Number.isNaN(cursor.getTime())) {
      throw new HelpWellError('bad_request', 'cursor must be an ISO 8601 date');
    }
    filters.push(sql`${sortAt} < ${cursor}`);
  }
  const where = filters.reduce((acc, clause, i) => (i === 0 ? clause : sql`${acc} AND ${clause}`));

  const readFlag = options.contactId
    ? sql`EXISTS (SELECT 1 FROM helpwell.changelog_reads r
          WHERE r.entry_id = e.id AND r.contact_id = ${options.contactId})`
    : sql`NULL::boolean`;

  const result = await db.execute<EntryRow>(sql`
    SELECT
      e.id, e.version, e.title, e.summary, e.tags, e.cover_url, e.status,
      e.published_at, e.created_at,
      ${sortAt} AS sort_at,
      ${readFlag} AS read
    FROM helpwell.changelog_entries e
    WHERE ${where}
    ORDER BY ${sortAt} DESC
    LIMIT ${limit + 1}
  `);

  const rows = rowsOf<EntryRow & { sort_at: string | Date }>(result);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      tags: row.tags ?? [],
      coverUrl: row.cover_url,
      status: row.status,
      publishedAt: row.published_at ? new Date(row.published_at) : null,
      ...(options.contactId ? { read: Boolean(row.read) } : {}),
    })),
    nextCursor: rows.length > limit && last ? new Date(last.sort_at).toISOString() : null,
  };
}

export async function getChangelogEntry(
  db: Db,
  idOrVersion: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<ChangelogDetail | null> {
  const visible = options.includeUnpublished
    ? sql`TRUE`
    : sql`status = 'published' AND published_at IS NOT NULL AND published_at <= now()`;

  const [row] = await db
    .select()
    .from(changelogEntries)
    .where(sql`(id = ${idOrVersion} OR version = ${idOrVersion}) AND ${visible}`)
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    tags: row.tags,
    coverUrl: row.coverUrl,
    publishedAt: row.publishedAt,
    body: row.body,
    status: row.status,
    sourceRef: row.sourceRef,
  };
}

/** Drives the unread dot on the widget's changelog tab (CL-06). */
export async function unreadCount(db: Db, contactId: string | null): Promise<number> {
  if (!contactId) return 0;
  const result = await db.execute<{ n: number | string }>(sql`
    SELECT count(*) AS n
    FROM helpwell.changelog_entries e
    WHERE e.status = 'published'
      AND e.published_at IS NOT NULL
      AND e.published_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM helpwell.changelog_reads r
        WHERE r.entry_id = e.id AND r.contact_id = ${contactId}
      )
  `);
  return Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);
}

export async function markChangelogRead(db: Db, entryId: string, contactId: string): Promise<void> {
  await db.insert(changelogReads).values({ entryId, contactId }).onConflictDoNothing();
}

export async function markAllChangelogRead(db: Db, contactId: string): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO helpwell.changelog_reads (entry_id, contact_id)
    SELECT e.id, ${contactId}
    FROM helpwell.changelog_entries e
    WHERE e.status = 'published' AND e.published_at IS NOT NULL AND e.published_at <= now()
    ON CONFLICT DO NOTHING
    RETURNING entry_id AS id
  `);
  return rowsOf(result).length;
}

/* -------------------------------------------------------------- authoring */

export interface ChangelogInput {
  version?: string | null;
  title: string;
  summary?: string | null;
  body?: string;
  tags?: string[];
  coverUrl?: string | null;
  sourceRef?: string | null;
  status?: ChangelogStatus;
  /** A Date from code; the admin route turns a JSON string into one. */
  publishedAt?: Date | null;
}

/** How an entry's `changelog.published` is sent: the install's own webhook fetch, when it has one. */
export interface ChangelogWriteOptions {
  webhooks?: WebhookOptions;
}

export async function createChangelogEntry(
  db: Db,
  input: ChangelogInput,
  options: ChangelogWriteOptions = {},
): Promise<string> {
  if (!input.title?.trim()) {
    throw new HelpWellError('bad_request', 'A changelog entry needs a title.');
  }
  const id = newId(idPrefix.changelog);
  await db.insert(changelogEntries).values({
    id,
    version: input.version ?? null,
    title: input.title.trim(),
    summary: input.summary ?? null,
    body: input.body ?? '',
    tags: input.tags ?? [],
    coverUrl: input.coverUrl ?? null,
    sourceRef: input.sourceRef ?? null,
    status: input.status ?? 'draft',
    publishedAt: input.status === 'published' ? (input.publishedAt ?? new Date()) : null,
  });
  if (input.status === 'published') await announcePublished(db, id, options.webhooks);
  return id;
}

/** `changelog.published`, once per entry: only the draft-to-published move raises it. */
async function announcePublished(db: Db, id: string, webhooks?: WebhookOptions): Promise<void> {
  const entry = await getChangelogEntry(db, id, { includeUnpublished: true });
  if (!entry) return;
  await emitStoredWebhooks(
    db,
    'changelog.published',
    {
      id: entry.id,
      version: entry.version,
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      publishedAt: entry.publishedAt,
    },
    webhooks,
  );
}

export async function updateChangelogEntry(
  db: Db,
  id: string,
  input: Partial<ChangelogInput>,
  options: ChangelogWriteOptions = {},
): Promise<boolean> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.version !== undefined) patch.version = input.version;
  if (input.title !== undefined) patch.title = input.title;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.body !== undefined) patch.body = input.body;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.coverUrl !== undefined) patch.coverUrl = input.coverUrl;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === 'published') {
      // Publishing stamps a date once. Re-saving a published entry must not
      // bump it back to the top of the feed.
      patch.publishedAt = input.publishedAt ?? sql`coalesce(published_at, now())`;
    }
  }

  const before =
    input.status === 'published'
      ? await db
          .select({ status: changelogEntries.status })
          .from(changelogEntries)
          .where(sql`id = ${id}`)
      : [];
  const rows = await db
    .update(changelogEntries)
    .set(patch)
    .where(sql`id = ${id}`)
    .returning({ id: changelogEntries.id });
  if (rows.length > 0 && before[0] && before[0].status !== 'published') {
    await announcePublished(db, id, options.webhooks);
  }
  return rows.length > 0;
}

export async function deleteChangelogEntry(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(changelogEntries)
    .where(sql`id = ${id}`)
    .returning({ id: changelogEntries.id });
  return rows.length > 0;
}

/** True when an entry already exists for this git ref, so `hw changelog` is idempotent. */
export async function changelogExistsForRef(db: Db, ref: string): Promise<boolean> {
  const rows = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(sql`source_ref = ${ref}`)
    .limit(1);
  return rows.length > 0;
}
