/**
 * Conversations: a review log, not a work queue (IN-01).
 *
 * Everything here is read-mostly. The only writes are the ones a human makes
 * while reviewing: a tag, "mark reviewed", a topic correction.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { Citation, MessageSource, ToolCall } from '../db/schema.js';
import { conversations, conversationTags, messages } from '../db/schema.js';

export interface ConversationListItem {
  id: string;
  status: 'resolved' | 'unresolved';
  topic: string | null;
  tags: string[];
  lastMessageAt: Date;
  startedAt: Date;
  messageCount: number;
  reviewedAt: Date | null;
  rating: string | null;
  contact: {
    id: string | null;
    name: string | null;
    email: string | null;
    identified: boolean;
  };
  /** The customer's last message, for the list row. */
  snippet: string;
}

export interface ListConversationsOptions {
  /** Fetch exactly one conversation. Used by the thread view. */
  id?: string;
  status?: 'resolved' | 'unresolved';
  topic?: string;
  search?: string;
  contactId?: string;
  limit?: number;
  /** Conversation id to start after, newest-first. */
  cursor?: string;
}

export interface ConversationPage {
  items: ConversationListItem[];
  nextCursor: string | null;
}

type ListRow = {
  id: string;
  status: 'resolved' | 'unresolved';
  topic: string | null;
  last_message_at: string | Date;
  started_at: string | Date;
  message_count: number;
  reviewed_at: string | Date | null;
  rating: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  identified: boolean | null;
  snippet: string | null;
  tags: string[] | null;
};

export async function listConversations(
  db: Db,
  options: ListConversationsOptions = {},
): Promise<ConversationPage> {
  const limit = Math.min(options.limit ?? 25, 100);

  const filters = [sql`c.deleted_at IS NULL`];
  if (options.id) filters.push(sql`c.id = ${options.id}`);
  if (options.status) filters.push(sql`c.status = ${options.status}`);
  if (options.topic) filters.push(sql`c.topic = ${options.topic}`);
  if (options.contactId) filters.push(sql`c.contact_id = ${options.contactId}`);
  if (options.cursor) filters.push(sql`c.id < ${options.cursor}`);
  if (options.search) {
    const like = `%${options.search.toLowerCase()}%`;
    filters.push(sql`(
      lower(coalesce(ct.name, '')) LIKE ${like}
      OR lower(coalesce(ct.email, '')) LIKE ${like}
      OR EXISTS (
        SELECT 1 FROM helpwell.messages m
        WHERE m.conversation_id = c.id AND lower(m.body) LIKE ${like}
      )
    )`);
  }

  const where = filters.reduce((acc, clause, i) => (i === 0 ? clause : sql`${acc} AND ${clause}`));

  const result = await db.execute<ListRow>(sql`
    SELECT
      c.id, c.status, c.topic, c.last_message_at, c.started_at, c.message_count,
      c.reviewed_at, c.rating,
      ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
      ct.identified,
      (
        SELECT m.body FROM helpwell.messages m
        WHERE m.conversation_id = c.id AND m.role = 'customer'
        ORDER BY m.created_at DESC LIMIT 1
      ) AS snippet,
      COALESCE(
        (SELECT array_agg(t.tag ORDER BY t.tag) FROM helpwell.conversation_tags t
         WHERE t.conversation_id = c.id),
        ARRAY[]::text[]
      ) AS tags
    FROM helpwell.conversations c
    LEFT JOIN helpwell.contacts ct ON ct.id = c.contact_id
    WHERE ${where}
    ORDER BY c.id DESC
    LIMIT ${limit + 1}
  `);

  const rows = rowsOf<ListRow>(result);
  const page = rows.slice(0, limit);

  return {
    items: page.map((row) => ({
      id: row.id,
      status: row.status,
      topic: row.topic,
      tags: row.tags ?? [],
      lastMessageAt: new Date(row.last_message_at),
      startedAt: new Date(row.started_at),
      messageCount: row.message_count,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
      rating: row.rating,
      contact: {
        id: row.contact_id,
        name: row.contact_name,
        email: row.contact_email,
        identified: Boolean(row.identified),
      },
      snippet: row.snippet ?? '',
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export interface ThreadMessage {
  id: string;
  role: 'customer' | 'agent' | 'event';
  body: string;
  citations: Citation[];
  toolCalls: ToolCall[];
  feedback: 'helpful' | 'not_helpful' | null;
  createdAt: Date;
  model: string | null;
  latencyMs: number | null;
  /** 0-1 on agent messages (agent/confidence.ts); null on the rest and on older rows. Read-only. */
  confidence: number | null;
  confidenceReason: string | null;
  /** What the model said about its own answer: answered, partial or not_covered. */
  certainty: 'answered' | 'partial' | 'not_covered' | null;
  /** What this one reply cost, in US dollars, and its tokens. Null on customer turns. */
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** The passages the reply was shown, with similarity (migration 0010). Admin-only. */
  sources: MessageSource[];
}

export interface ConversationThread extends ConversationListItem {
  messages: ThreadMessage[];
  pageUrl: string | null;
  costUsd: number;
}

export async function getConversation(db: Db, id: string): Promise<ConversationThread | null> {
  const page = await listConversations(db, { id, limit: 1 });
  const item = page.items[0];
  if (!item) return null;

  const [details] = await db
    .select({
      pageUrl: conversations.pageUrl,
      costUsd: conversations.costUsd,
    })
    .from(conversations)
    .where(sql`id = ${id}`);

  const rows = await db
    .select()
    .from(messages)
    .where(sql`conversation_id = ${id}`)
    .orderBy(sql`created_at ASC`);

  return {
    ...item,
    pageUrl: details?.pageUrl ?? null,
    costUsd: Number(details?.costUsd ?? 0),
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      body: row.body,
      citations: row.citations,
      toolCalls: row.toolCalls,
      feedback: row.feedback ?? null,
      createdAt: row.createdAt,
      model: row.model,
      latencyMs: row.latencyMs,
      confidence: row.confidence,
      confidenceReason: row.confidenceReason,
      certainty: row.certainty ?? null,
      costUsd: row.costUsd === null ? null : Number(row.costUsd),
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      sources: row.sources ?? [],
    })),
  };
}

export async function setConversationStatus(
  db: Db,
  id: string,
  status: 'resolved' | 'unresolved',
): Promise<void> {
  await db.update(conversations).set({ status }).where(sql`id = ${id}`);
}

export async function markReviewed(db: Db, id: string, reviewed = true): Promise<void> {
  await db
    .update(conversations)
    .set({ reviewedAt: reviewed ? new Date() : null })
    .where(sql`id = ${id}`);
}

export async function setTopic(db: Db, id: string, topic: string | null): Promise<void> {
  await db.update(conversations).set({ topic }).where(sql`id = ${id}`);
}

export async function addTag(
  db: Db,
  id: string,
  tag: string,
  source: 'agent' | 'human' = 'human',
): Promise<void> {
  await db
    .insert(conversationTags)
    .values({ conversationId: id, tag: tag.trim().toLowerCase(), source })
    .onConflictDoNothing();
}

export async function removeTag(db: Db, id: string, tag: string): Promise<void> {
  await db
    .delete(conversationTags)
    .where(sql`conversation_id = ${id} AND tag = ${tag.trim().toLowerCase()}`);
}

/**
 * Who a conversation belongs to, or null when there is no such conversation.
 * The public routes use this before letting a visitor write to a thread: an
 * id is guessable enough that ownership, not existence, is the test.
 */
export async function conversationOwner(
  db: Db,
  id: string,
): Promise<{ contactId: string | null } | null> {
  const [row] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(sql`id = ${id} AND deleted_at IS NULL`)
    .limit(1);
  return row ?? null;
}

/** The conversation a message belongs to, and who owns it. */
export async function messageOwner(
  db: Db,
  messageId: string,
): Promise<{ conversationId: string; contactId: string | null } | null> {
  const [row] = await db
    .select({ conversationId: messages.conversationId, contactId: conversations.contactId })
    .from(messages)
    .innerJoin(conversations, sql`${conversations.id} = ${messages.conversationId}`)
    .where(sql`${messages.id} = ${messageId} AND ${conversations.deletedAt} IS NULL`)
    .limit(1);
  return row ?? null;
}

/** Comments are capped so a rating cannot be used to store a novel. */
const COMMENT_LIMIT = 2000;

export async function rateConversation(
  db: Db,
  id: string,
  rating: 'sad' | 'indifferent' | 'happy' | 'love',
  comment?: string,
): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ rating, ratingComment: comment?.slice(0, COMMENT_LIMIT) ?? null })
    .where(sql`id = ${id}`)
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function setMessageFeedback(
  db: Db,
  messageId: string,
  feedback: 'helpful' | 'not_helpful' | null,
  comment?: string,
): Promise<boolean> {
  const rows = await db
    .update(messages)
    .set({ feedback, feedbackComment: comment?.slice(0, COMMENT_LIMIT) ?? null })
    .where(sql`id = ${messageId}`)
    .returning({ id: messages.id });
  return rows.length > 0;
}

/** Retention (CT-10): delete conversations older than N months, keep contacts. */
export async function pruneConversations(db: Db, retentionMonths: number): Promise<number> {
  if (retentionMonths <= 0) return 0;
  // make_interval keeps the month count a bound parameter rather than string
  // concatenation, which both drivers plan the same way.
  const rows = await db
    .delete(conversations)
    .where(sql`last_message_at < now() - make_interval(months => ${retentionMonths})`)
    .returning({ id: conversations.id });
  return rows.length;
}
