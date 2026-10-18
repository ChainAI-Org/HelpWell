/**
 * Roadmap.
 *
 * Four columns, one vote per contact per item, and public submissions that land
 * in "under review" rather than straight onto the board (RM-01..RM-07).
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { type RoadmapStatus, roadmapItems, roadmapVotes } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';

export const ROADMAP_STATUSES: RoadmapStatus[] = [
  'under_review',
  'planned',
  'in_progress',
  'shipped',
];

export interface RoadmapCard {
  id: string;
  title: string;
  body: string | null;
  status: RoadmapStatus;
  votesCount: number;
  voted: boolean;
  changelogEntryId: string | null;
  createdAt: Date;
}

export interface RoadmapBoard {
  under_review: RoadmapCard[];
  planned: RoadmapCard[];
  in_progress: RoadmapCard[];
  shipped: RoadmapCard[];
}

type CardRow = {
  id: string;
  title: string;
  body: string | null;
  status: RoadmapStatus;
  votes_count: number;
  voted: boolean | null;
  changelog_entry_id: string | null;
  created_at: string | Date;
};

export async function getRoadmap(
  db: Db,
  options: { contactId?: string | null; limitPerColumn?: number } = {},
): Promise<RoadmapBoard> {
  const perColumn = Math.min(options.limitPerColumn ?? 50, 200);
  const voted = options.contactId
    ? sql`EXISTS (SELECT 1 FROM helpwell.roadmap_votes v
          WHERE v.item_id = i.id AND v.contact_id = ${options.contactId})`
    : sql`FALSE`;

  const result = await db.execute<CardRow & { rank: number }>(sql`
    SELECT * FROM (
      SELECT
        i.id, i.title, i.body, i.status, i.votes_count, i.changelog_entry_id, i.created_at,
        ${voted} AS voted,
        row_number() OVER (PARTITION BY i.status ORDER BY i.votes_count DESC, i.created_at DESC)
          AS rank
      FROM helpwell.roadmap_items i
    ) ranked
    WHERE rank <= ${perColumn}
    ORDER BY votes_count DESC, created_at DESC
  `);

  const board: RoadmapBoard = {
    under_review: [],
    planned: [],
    in_progress: [],
    shipped: [],
  };

  for (const row of rowsOf<CardRow>(result)) {
    board[row.status]?.push({
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      votesCount: row.votes_count,
      voted: Boolean(row.voted),
      changelogEntryId: row.changelog_entry_id,
      createdAt: new Date(row.created_at),
    });
  }
  return board;
}

/**
 * Toggle a vote. Returns the new count so the button can animate without a
 * second round trip. The count lives on the row and is recomputed from the
 * votes table, so a double-click cannot drift it.
 */
export async function toggleVote(
  db: Db,
  itemId: string,
  contactId: string,
): Promise<{ voted: boolean; votesCount: number }> {
  const existing = await db
    .select({ itemId: roadmapVotes.itemId })
    .from(roadmapVotes)
    .where(sql`item_id = ${itemId} AND contact_id = ${contactId}`)
    .limit(1);

  if (existing.length > 0) {
    await db.delete(roadmapVotes).where(sql`item_id = ${itemId} AND contact_id = ${contactId}`);
  } else {
    const item = await db
      .select({ id: roadmapItems.id })
      .from(roadmapItems)
      .where(sql`id = ${itemId}`)
      .limit(1);
    if (item.length === 0) {
      throw new HelpWellError('not_found', `No roadmap item ${itemId}`, {
        publicMessage: 'That item no longer exists.',
      });
    }
    await db.insert(roadmapVotes).values({ itemId, contactId }).onConflictDoNothing();
  }

  const result = await db.execute<{ n: number | string }>(sql`
    UPDATE helpwell.roadmap_items
    SET votes_count = (
          SELECT count(*) FROM helpwell.roadmap_votes v
          WHERE v.item_id = helpwell.roadmap_items.id
        ),
        updated_at = now()
    WHERE helpwell.roadmap_items.id = ${itemId}
    RETURNING votes_count AS n
  `);

  return {
    voted: existing.length === 0,
    votesCount: Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0),
  };
}

export interface SubmitIdeaInput {
  title: string;
  body?: string;
  contactId?: string | null;
}

/** A public submission (RM-06). Lands unvoted in "under review". */
export async function submitIdea(db: Db, input: SubmitIdeaInput): Promise<string> {
  const title = input.title?.trim();
  if (!title) {
    throw new HelpWellError('bad_request', 'An idea needs a title.', {
      publicMessage: 'Give your idea a title.',
    });
  }
  if (title.length > 140) {
    throw new HelpWellError('bad_request', 'Idea title too long', {
      publicMessage: 'Keep the title under 140 characters.',
    });
  }

  const id = newId(idPrefix.roadmap);
  await db.insert(roadmapItems).values({
    id,
    title,
    body: input.body?.trim() || null,
    status: 'under_review',
    createdBy: input.contactId ?? null,
  });

  // The submitter's own vote, so an idea never shows zero support.
  if (input.contactId) {
    await toggleVote(db, id, input.contactId);
  }
  return id;
}

export async function setRoadmapStatus(
  db: Db,
  id: string,
  status: RoadmapStatus,
  options: { changelogEntryId?: string | null } = {},
): Promise<boolean> {
  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (options.changelogEntryId !== undefined) {
    patch.changelogEntryId = options.changelogEntryId;
  }
  const rows = await db
    .update(roadmapItems)
    .set(patch)
    .where(sql`id = ${id}`)
    .returning({ id: roadmapItems.id });
  return rows.length > 0;
}

export async function updateRoadmapItem(
  db: Db,
  id: string,
  input: { title?: string; body?: string | null },
): Promise<boolean> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.body !== undefined) patch.body = input.body;
  const rows = await db
    .update(roadmapItems)
    .set(patch)
    .where(sql`id = ${id}`)
    .returning({ id: roadmapItems.id });
  return rows.length > 0;
}

export async function deleteRoadmapItem(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(roadmapItems)
    .where(sql`id = ${id}`)
    .returning({ id: roadmapItems.id });
  return rows.length > 0;
}
