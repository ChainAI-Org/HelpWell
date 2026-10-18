/**
 * Reading collections.
 *
 * There is one query here and every surface uses it — help centre, dashboard,
 * widget and the public API — because a collection that is called "Getting
 * started" in one place and `getting-started` in another is the kind of drift
 * that nobody notices until a customer screenshots it.
 *
 * The article index is the driving table rather than `collection_index`, so a
 * folder that has articles but no metadata row still appears. That happens on
 * any install that indexed before this table existed, and on a docs folder
 * with no _meta.json at all.
 */

import { type SQL, sql } from 'drizzle-orm';
import { titleCase } from '../content/naming.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { UNORDERED } from '../db/schema.js';

export type CollectionSummary = {
  /** The folder name, and the first segment of every slug inside it. */
  id: string;
  title: string;
  description: string | null;
  icon: string;
  tint: string;
  /** Published articles in it. Never zero: empty collections are not returned. */
  articles: number;
};

export interface ListCollectionsOptions {
  /**
   * Show `identified` collections whoever is asking. For admin surfaces, which
   * are already behind the host app's own auth.
   */
  includeIdentified?: boolean;
  /**
   * The visitor asking. A contact the host app has identified sees
   * `identified` collections; an anonymous one is not told they exist.
   */
  contactId?: string | null;
}

type CollectionRow = {
  id: string;
  title: string | null;
  description: string | null;
  icon: string | null;
  tint: string | null;
  articles: number | string;
};

/**
 * A contact the host app has vouched for through an identify call. An email
 * the visitor typed into the widget is not that: `identified` is only ever set
 * by a signed token, so it is the one flag a visibility rule may trust.
 */
function identifiedContact(contactId: string): SQL {
  return sql`EXISTS (
      SELECT 1 FROM helpwell.contacts ct
      WHERE ct.id = ${contactId} AND ct.identified = true AND ct.deleted_at IS NULL
    )`;
}

/**
 * The visibility clause.
 *
 * Resolving "is this visitor identified" inside the query rather than ahead of
 * it keeps listing collections to a single round trip, which matters because
 * the widget asks every time its Help tab opens.
 */
function visibleTo(options: ListCollectionsOptions): SQL {
  if (options.includeIdentified) return sql``;
  const isPublic = sql`COALESCE(c.visibility, 'public') = 'public'`;
  if (options.contactId) {
    return sql` AND (${isPublic} OR ${identifiedContact(options.contactId)})`;
  }
  return sql` AND ${isPublic}`;
}

/**
 * The same rule for a query driven by `article_index` alone, aliased `a`, so
 * that reading an article by its slug obeys its collection's visibility the
 * way listing the collection does. Every public surface that selects from the
 * index appends this; the admin surfaces pass `includeIdentified`.
 */
export function visibleArticles(options: ListCollectionsOptions = {}): SQL {
  if (options.includeIdentified) return sql``;
  const reserved = sql`EXISTS (
      SELECT 1 FROM helpwell.collection_index ci
      WHERE ci.id = a.collection AND ci.visibility = 'identified'
    )`;
  if (options.contactId) {
    return sql` AND (NOT ${reserved} OR ${identifiedContact(options.contactId)})`;
  }
  return sql` AND NOT ${reserved}`;
}

/** The one query. `only` narrows it to a single collection. */
async function query(
  db: Db,
  options: ListCollectionsOptions,
  only?: string,
): Promise<CollectionSummary[]> {
  const narrow = only === undefined ? sql`` : sql` AND a.collection = ${only}`;
  const result = await db.execute(sql`
    SELECT a.collection  AS id,
           c.title       AS title,
           c.description AS description,
           c.icon        AS icon,
           c.tint        AS tint,
           count(*)      AS articles
    FROM helpwell.article_index a
    LEFT JOIN helpwell.collection_index c ON c.id = a.collection
    WHERE a.status = 'published'${narrow}${visibleTo(options)}
    GROUP BY a.collection, c.title, c.description, c.icon, c.tint, c.order_index
    ORDER BY COALESCE(c.order_index, ${UNORDERED}), COALESCE(c.title, a.collection)
  `);
  return rowsOf<CollectionRow>(result).map(toSummary);
}

export function listCollections(
  db: Db,
  options: ListCollectionsOptions = {},
): Promise<CollectionSummary[]> {
  return query(db, options);
}

/** One collection, for the page that lists what is in it. */
export async function getCollection(
  db: Db,
  id: string,
  options: ListCollectionsOptions = {},
): Promise<CollectionSummary | null> {
  return (await query(db, options, id))[0] ?? null;
}

function toSummary(row: CollectionRow): CollectionSummary {
  return {
    id: row.id,
    // Every fallback is the value a fresh _meta.json would have been given, so
    // a folder gains nothing but a better title by adding one.
    title: row.title ?? titleCase(row.id),
    description: row.description,
    icon: row.icon ?? 'book-open',
    tint: row.tint ?? 'lavender',
    // count(*) is a bigint, which the driver hands over as a string.
    articles: Number(row.articles),
  };
}
