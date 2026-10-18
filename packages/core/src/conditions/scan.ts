/**
 * Finding every contact a condition matches, a page at a time.
 *
 * The compiled SQL is always the first choice. When a condition cannot be
 * compiled (a rule written by a newer version, or a caller asking for the
 * in-memory path on purpose), contacts are read in pages of a few hundred by
 * id and evaluated in memory, so the process never holds the whole contacts
 * table at once. Both paths page by id, newest first, so a cursor from one is
 * a cursor for the other.
 */

import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { compileConditions } from './compile.js';
import { evaluateConditions } from './evaluate.js';
import { loadSnapshots } from './snapshot.js';
import type { Condition } from './types.js';

export type MatchStrategy = 'auto' | 'sql' | 'memory';

export interface ScanOptions {
  /** Only contacts with an id below this one: the cursor from the previous page. */
  after?: string | null;
  limit?: number;
  /** Extra filters over `helpwell.contacts c`, ANDed in (search, tag, identified...). */
  where?: SQL;
  now?: Date;
  /** `auto` compiles when it can. `memory` forces the paged in-memory path. */
  strategy?: MatchStrategy;
}

/** How many contacts the in-memory path reads per round trip. */
const PAGE = 250;

/** Matching contact ids, newest first, and the cursor for the next page. */
export async function matchingContactIds(
  db: Db,
  condition: Condition,
  options: ScanOptions = {},
): Promise<{ ids: string[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 1000));
  const now = options.now ?? new Date();
  const compiled = options.strategy === 'memory' ? null : compileConditions(condition, { now });

  if (compiled) {
    const rows = rowsOf<{ id: string }>(
      await db.execute(sql`
        SELECT c.id FROM helpwell.contacts c
        WHERE c.deleted_at IS NULL
          ${options.after ? sql`AND c.id < ${options.after}` : sql``}
          ${options.where ? sql`AND ${options.where}` : sql``}
          AND ${compiled}
        ORDER BY c.id DESC
        LIMIT ${limit + 1}
      `),
    );
    const page = rows.slice(0, limit).map((r) => r.id);
    return { ids: page, nextCursor: rows.length > limit ? (page.at(-1) ?? null) : null };
  }
  if (options.strategy === 'sql') {
    throw new Error('This condition cannot be compiled to SQL');
  }

  const ids: string[] = [];
  let after = options.after ?? null;
  for (;;) {
    const candidates = rowsOf<{ id: string }>(
      await db.execute(sql`
        SELECT c.id FROM helpwell.contacts c
        WHERE c.deleted_at IS NULL
          ${after ? sql`AND c.id < ${after}` : sql``}
          ${options.where ? sql`AND ${options.where}` : sql``}
        ORDER BY c.id DESC
        LIMIT ${PAGE}
      `),
    ).map((r) => r.id);
    if (candidates.length === 0) return { ids, nextCursor: null };

    const snapshots = await loadSnapshots(db, candidates, condition, { now });
    for (const id of candidates) {
      const snapshot = snapshots.get(id);
      if (!snapshot || !evaluateConditions(condition, snapshot, { now })) continue;
      if (ids.length === limit) return { ids, nextCursor: ids.at(-1) ?? null };
      ids.push(id);
    }
    if (candidates.length < PAGE) return { ids, nextCursor: null };
    after = candidates.at(-1) ?? null;
  }
}

/** How many contacts match, by SQL when possible and page by page when not. */
export async function countMatchingContacts(
  db: Db,
  condition: Condition,
  options: Omit<ScanOptions, 'after' | 'limit'> = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const compiled = options.strategy === 'memory' ? null : compileConditions(condition, { now });

  if (compiled) {
    const rows = rowsOf<{ n: number | string }>(
      await db.execute(sql`
        SELECT count(*) AS n FROM helpwell.contacts c
        WHERE c.deleted_at IS NULL
          ${options.where ? sql`AND ${options.where}` : sql``}
          AND ${compiled}
      `),
    );
    return Number(rows[0]?.n ?? 0);
  }

  let count = 0;
  let after: string | null = null;
  for (;;) {
    const page = await matchingContactIds(db, condition, {
      ...options,
      strategy: 'memory',
      after,
      limit: 1000,
    });
    count += page.ids.length;
    if (!page.nextCursor) return count;
    after = page.nextCursor;
  }
}
