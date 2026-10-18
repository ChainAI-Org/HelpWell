/**
 * Content gaps (KB-25).
 *
 * Every question the agent could not answer lands here. The hard part is not
 * recording them, it is not producing forty rows that are the same question
 * asked forty ways, so a new question is matched against existing ones by word
 * overlap before a new row is created.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { gapConversations, gaps } from '../db/schema.js';
import { idPrefix, newId } from '../ids.js';
import type { Settings } from '../settings/schema.js';
import { emitWebhooks, type WebhookOptions } from '../webhooks.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'do',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'i',
  'we',
  'you',
  'my',
  'our',
  'your',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'and',
  'or',
  'how',
  'what',
  'when',
  'where',
  'why',
  'it',
  'this',
  'that',
  'there',
  'be',
  'have',
  'has',
  'get',
  'got',
  'any',
]);

/** English endings dropped so "cancel", "cancelled" and "cancellation" are one word. */
const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ed', 'es', 's'];

/**
 * A light English stem: the common ending, then a final "e" and a doubled
 * consonant. Only plain Latin words longer than four letters are touched, and
 * a stem keeps at least four letters, so other languages and short words pass
 * through unchanged. It only has to be consistent, not a real word.
 */
export function stem(word: string): string {
  if (word.length <= 4 || !/^[a-z]+$/.test(word)) return word;
  let out = word;
  for (const suffix of SUFFIXES)
    if (out.endsWith(suffix) && out.length - suffix.length >= 4) {
      out = out.slice(0, -suffix.length);
      break;
    }
  if (out.length > 4 && out.endsWith('e')) out = out.slice(0, -1);
  if (/([^aeiou])\1$/.test(out)) out = out.slice(0, -1);
  return out;
}

/**
 * The words that carry a question's meaning, in any script. Letters and
 * digits from every alphabet count; punctuation does not. NFKC first, so a
 * full-width digit or a ligature compares equal to its plain form. English
 * words are stemmed, so "charged" and "charges" match.
 */
export function keywords(question: string): Set<string> {
  return new Set(
    question
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .map(stem),
  );
}

/** Jaccard overlap of the meaningful words in two questions. */
export function similarity(a: string, b: string): number {
  const ka = keywords(a);
  const kb = keywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  let shared = 0;
  for (const word of ka) if (kb.has(word)) shared++;
  return shared / (ka.size + kb.size - shared);
}

/** Above this, two phrasings are treated as the same question. */
export const SAME_QUESTION = 0.5;

/**
 * How many open gaps a new question is compared against. Matching happens in
 * JavaScript, so the candidates have to be loaded; the most recently asked
 * ones are the ones a repeat is likely to repeat, and a backlog older than
 * that is a list nobody is reading anyway.
 */
const DEDUPE_WINDOW = 200;

/** Longest title `suggestTitle` writes. Help-centre titles longer than this wrap badly. */
const MAX_TITLE = 80;

/** Openers that turn into "How to ...": "how do I export" is an article called "How to export". */
const HOW_TO = [
  /^how (?:do|can|should|would|could) (?:i|we|you|one)\s+/i,
  /^(?:is|are) there (?:a|an|any) (?:way|option) (?:to|for me to|i can|we can)\s+/i,
  /^what(?:'s| is) the (?:best |easiest |right )?way to\s+/i,
  /^how to\s+/i,
  /^(?:i|we) (?:want|need|would like|'d like) to\s+/i,
  /^(?:i'm|i am|we're|we are) trying to\s+/i,
];

/** Greetings and filler a question often opens with. Stripped repeatedly: "Hi, quick question: ...". */
const PREAMBLE =
  /^(?:hi there|hello there|hey there|hiya|hi|hello|hey|good (?:morning|afternoon|evening)|quick question|please|pls|so|okay|ok|um)\b[\s,:;!.\-–—]*/i;

/**
 * A working title for the article that would answer a question, from the
 * question alone. No model call: gaps are recorded while a customer waits,
 * and a title only has to be a good first draft for a person to edit.
 *
 * Greetings go, the first sentence that asks something is kept, "how do I"
 * becomes "How to" (with "my" as "your"), and anything long is cut at a word.
 * A yes/no question stays a question: "Can I pay by invoice?" is already how
 * a help centre would title it.
 */
export function suggestTitle(question: string): string | null {
  let text = question.normalize('NFKC').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4 && PREAMBLE.test(text); i++) text = text.replace(PREAMBLE, '');

  // The sentence that asks, unless it is too short to stand alone ("My export
  // is broken. What now?"), in which case the one that says what it is about.
  const sentences = text.split(/(?<=[?!.])\s+/).filter(Boolean);
  const asking = sentences.find((sentence) => sentence.includes('?'));
  const asked =
    asking && (asking.split(' ').length >= 5 || asking === sentences[0])
      ? asking
      : (sentences[0] ?? '');
  let title = asked.replace(/[\s?!.,;:]+$/, '').trim();
  if (!title) return null;

  const howTo = HOW_TO.find((pattern) => pattern.test(title));
  if (howTo) {
    const rest = title.replace(howTo, '').replace(/\b(?:my|our)\b/gi, 'your');
    title = rest ? `How to ${rest}` : title;
  } else if (asked.trim().endsWith('?')) {
    title = `${title}?`;
  }

  if (title.length > MAX_TITLE) {
    const cut = title.slice(0, MAX_TITLE);
    const space = cut.lastIndexOf(' ');
    title = (space > MAX_TITLE / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:\-–—]+$/, '');
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export interface RecordGapParams {
  question: string;
  conversationId?: string | null;
  /**
   * What the article should be called. Left out (or null), a working title is
   * made from the question by `suggestTitle`.
   */
  suggestedTitle?: string | null;
  suggestedCollection?: string | null;
}

export interface RecordGapResult {
  gapId: string;
  created: boolean;
  asks: number;
}

/**
 * Record a question the docs did not answer.
 *
 * With `settings`, a brand new gap (not another phrasing of an existing one)
 * is announced to any webhook subscribed to `gap.created`.
 */
export async function recordGap(
  db: Db,
  params: RecordGapParams,
  settings?: Settings,
  /** How `gap.created` is sent; the install's own fetch when it has one. */
  webhooks?: WebhookOptions,
): Promise<RecordGapResult> {
  const question = params.question.trim().slice(0, 500);
  if (!question) throw new Error('recordGap needs a question');

  // Only open gaps are candidates: a dismissed question should not quietly
  // come back to life, and a drafted one is already being handled.
  const open = await db
    .select({ id: gaps.id, question: gaps.question, variants: gaps.variants, asks: gaps.asks })
    .from(gaps)
    .where(sql`status = 'new'`)
    .orderBy(sql`last_asked_at DESC`)
    .limit(DEDUPE_WINDOW);

  const match = open.find(
    (row) =>
      similarity(row.question, question) >= SAME_QUESTION ||
      row.variants.some((v) => similarity(v, question) >= SAME_QUESTION),
  );

  if (match) {
    const variants = match.variants.includes(question)
      ? match.variants
      : [...match.variants, question].slice(0, 25);
    const [updated] = await db
      .update(gaps)
      .set({ asks: match.asks + 1, variants, lastAskedAt: new Date() })
      .where(sql`id = ${match.id}`)
      .returning({ asks: gaps.asks });
    if (params.conversationId)
      await linkConversation(db, match.id, params.conversationId, question);
    return { gapId: match.id, created: false, asks: updated?.asks ?? match.asks + 1 };
  }

  const id = newId(idPrefix.gap);
  await db.insert(gaps).values({
    id,
    question,
    variants: [],
    asks: 1,
    suggestedTitle: params.suggestedTitle ?? suggestTitle(question),
    suggestedCollection: params.suggestedCollection ?? null,
  });
  if (params.conversationId) await linkConversation(db, id, params.conversationId, question);
  if (settings) {
    await emitWebhooks(
      db,
      settings,
      'gap.created',
      { id, question, conversationId: params.conversationId ?? null },
      webhooks,
    );
  }
  return { gapId: id, created: true, asks: 1 };
}

async function linkConversation(
  db: Db,
  gapId: string,
  conversationId: string,
  askedAs: string,
): Promise<void> {
  await db
    .insert(gapConversations)
    .values({ gapId, conversationId, askedAs })
    .onConflictDoNothing();
}

export interface GapListItem {
  id: string;
  question: string;
  variants: string[];
  asks: number;
  status: 'new' | 'drafted' | 'dismissed';
  lastAskedAt: Date;
  firstAskedAt: Date;
  suggestedTitle: string | null;
  suggestedCollection: string | null;
}

export async function listGaps(
  db: Db,
  options: { status?: 'new' | 'drafted' | 'dismissed'; limit?: number } = {},
): Promise<GapListItem[]> {
  const rows = await db
    .select()
    .from(gaps)
    .where(options.status ? sql`status = ${options.status}` : sql`1 = 1`)
    .orderBy(sql`asks DESC, last_asked_at DESC`)
    .limit(options.limit ?? 50);
  return rows.map(toItem);
}

function toItem(row: typeof gaps.$inferSelect): GapListItem {
  return {
    id: row.id,
    question: row.question,
    variants: row.variants,
    asks: row.asks,
    status: row.status,
    lastAskedAt: row.lastAskedAt,
    firstAskedAt: row.firstAskedAt,
    suggestedTitle: row.suggestedTitle,
    suggestedCollection: row.suggestedCollection,
  };
}

/**
 * Change a gap's status. The article it was answered by is only touched when
 * one is given: a string sets it, `null` clears it, and leaving it out keeps
 * whatever was there, so dismissing a drafted gap does not forget its article.
 */
export async function setGapStatus(
  db: Db,
  gapId: string,
  status: 'new' | 'drafted' | 'dismissed',
  articleSlug?: string | null,
): Promise<void> {
  await db
    .update(gaps)
    .set({ status, ...(articleSlug !== undefined ? { articleSlug } : {}) })
    .where(sql`id = ${gapId}`);
}

/** One gap by id, or null. */
export async function getGap(db: Db, id: string): Promise<GapListItem | null> {
  const [row] = await db.select().from(gaps).where(sql`id = ${id}`).limit(1);
  return row ? toItem(row) : null;
}

/** How many gaps have each status, for the tab counts on the gaps list. */
export async function countGaps(db: Db): Promise<Record<GapListItem['status'], number>> {
  const rows = await db
    .select({ status: gaps.status, count: sql<number>`count(*)::int` })
    .from(gaps)
    .groupBy(gaps.status);
  const counts = { new: 0, drafted: 0, dismissed: 0 };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}
