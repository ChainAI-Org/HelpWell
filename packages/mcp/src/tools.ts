/**
 * What the coding agent can actually do, with no MCP types in sight.
 *
 * Everything here is a plain function over a `Db`, which is what makes the
 * package testable: the stdio wiring in server.ts is a thin adapter, and the
 * interesting behaviour — argument validation, what counts as visible, what a
 * gap resolution means — is exercised directly against a real database.
 *
 * These talk to Postgres rather than to the HTTP API on purpose. The server
 * runs on a developer's machine beside the repo, so there is no base URL and
 * no admin token to arrange, and a half-installed HelpWell with no running web
 * process is exactly the case where the assistant is most useful.
 */

import { HelpWellError } from '@helpwell/core';
import { listGaps, setGapStatus } from '@helpwell/core/agent';
import type { Db } from '@helpwell/core/db';
import { rowsOf } from '@helpwell/core/db';
import {
  type CollectionSummary as CoreCollectionSummary,
  headline,
  listCollections,
  listConversations,
  rangeFor,
  topTopics,
} from '@helpwell/core/repos';
import { plainSnippet, searchArticles } from '@helpwell/core/search';
import { sql } from 'drizzle-orm';
import { type McpEnvironment, resolveEnvironment } from './project.js';
import {
  captureScreenshotsTool,
  countSegmentTool,
  createArticleTool,
  generateChangelogTool,
  importDocsTool,
  listSegmentsTool,
  readConversationTool,
  runEvalsTool,
  updateArticleTool,
  updateSettingTool,
} from './write-tools.js';

export type ToolArgs = Record<string, unknown> | undefined;

export const GAP_STATUSES = ['new', 'drafted', 'dismissed'] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export const CONVERSATION_STATUSES = ['resolved', 'unresolved'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const REPORT_RANGES = ['today', '7d', '30d', '90d', 'all'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

/* ------------------------------------------------------- search_articles */

export interface ArticleHit {
  slug: string;
  title: string;
  collection: string;
  description: string | null;
  snippet: string;
  matchedBy: ('text' | 'semantic')[];
}

/**
 * Published articles only, and no embedding model is passed, so this is the
 * full-text pass alone. Both are deliberate: the agent is asking "what can a
 * customer already find?", and the answer must not depend on whether the
 * developer has an OpenRouter key in their shell. `identified` is on because
 * this is the developer's own view: collections reserved for signed-in
 * customers are still theirs to see. Snippets arrive as HTML with `<mark>`
 * around the match; a coding agent wants the words, not the markup.
 */
export async function searchArticlesTool(db: Db, args: ToolArgs): Promise<ArticleHit[]> {
  const query = requireString(args, 'query');
  const limit = clampInteger(optionalNumber(args, 'limit') ?? 8, 1, 50);
  const hits = await searchArticles(db, query, { limit, identified: true });
  return hits.map((hit) => ({
    slug: hit.slug,
    title: hit.title,
    collection: hit.collection,
    description: hit.description,
    snippet: plainSnippet(hit.snippet),
    matchedBy: hit.matchedBy,
  }));
}

/* ---------------------------------------------------------- read_article */

export interface ArticleBody {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  body: string;
  readingMinutes: number;
  appliesTo: string | null;
  updatedAt: string;
}

export async function readArticleTool(db: Db, args: ToolArgs): Promise<ArticleBody> {
  const slug = requireString(args, 'slug');
  const result = await db.execute(sql`
    SELECT slug, title, description, collection, body, reading_minutes, applies_to, updated_at
    FROM helpwell.article_index
    WHERE slug = ${slug} AND status = 'published'
    LIMIT 1
  `);
  const row = rowsOf<{
    slug: string;
    title: string;
    description: string | null;
    collection: string;
    body: string;
    reading_minutes: number;
    applies_to: string | null;
    updated_at: string | Date;
  }>(result)[0];

  if (!row) {
    throw new HelpWellError(
      'not_found',
      `No published article at "${slug}". Use search_articles to find the right slug.`,
    );
  }

  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    collection: row.collection,
    body: row.body,
    readingMinutes: row.reading_minutes,
    appliesTo: row.applies_to,
    updatedAt: asIsoString(row.updated_at),
  };
}

/* ------------------------------------------------------- list_collections */

export type CollectionSummary = CoreCollectionSummary;

export async function listCollectionsTool(db: Db): Promise<CollectionSummary[]> {
  // A coding agent reading this is about to write an article into one of these
  // folders, so it needs every collection, `identified` ones included.
  return listCollections(db, { includeIdentified: true });
}

/* ------------------------------------------------------------- list_gaps */

export interface GapSummary {
  id: string;
  question: string;
  /** Other phrasings of the same question, which help when naming the article. */
  variants: string[];
  asks: number;
  status: GapStatus;
  suggestedTitle: string | null;
  suggestedCollection: string | null;
  lastAskedAt: string;
}

/**
 * Defaults to the open ones. An agent asking "what should I document?" wants
 * the backlog, not the pile it already wrote, and a dismissed gap is a
 * decision someone made on purpose.
 */
export async function listGapsTool(db: Db, args: ToolArgs): Promise<GapSummary[]> {
  const status = optionalEnum(args, 'status', GAP_STATUSES) ?? 'new';
  const gaps = await listGaps(db, { status });
  return gaps.map((gap) => ({
    id: gap.id,
    question: gap.question,
    variants: gap.variants,
    asks: gap.asks,
    status: gap.status,
    suggestedTitle: gap.suggestedTitle,
    suggestedCollection: gap.suggestedCollection,
    lastAskedAt: asIsoString(gap.lastAskedAt),
  }));
}

/* ----------------------------------------------------------- resolve_gap */

export interface ResolvedGap {
  id: string;
  question: string;
  status: GapStatus;
  articleSlug: string;
}

/**
 * The gap and the article are both checked first. `setGapStatus` is an UPDATE
 * that matches nothing when the id is wrong, so without this the agent would
 * be told it succeeded; and pointing a gap at a slug that does not exist is
 * how the help centre ends up with a dead reference nobody notices.
 *
 * The gap is fetched by id, not found in the list: `listGaps` is capped, and
 * a backlog long enough to need this tool is exactly the one where the gap
 * being resolved sits past the cap.
 */
export async function resolveGapTool(db: Db, args: ToolArgs): Promise<ResolvedGap> {
  const id = requireString(args, 'id');
  const articleSlug = requireString(args, 'articleSlug');

  const found = await db.execute(sql`
    SELECT id, question FROM helpwell.gaps WHERE id = ${id} LIMIT 1
  `);
  const gap = rowsOf<{ id: string; question: string }>(found)[0];
  if (!gap) {
    throw new HelpWellError(
      'not_found',
      `No gap with id "${id}". Use list_gaps to see the open ones.`,
    );
  }

  const article = await db.execute(sql`
    SELECT 1 FROM helpwell.article_index WHERE slug = ${articleSlug} LIMIT 1
  `);
  if (rowsOf(article).length === 0) {
    throw new HelpWellError(
      'not_found',
      `No article indexed at "${articleSlug}". Write the article and run the indexer before resolving the gap.`,
    );
  }

  await setGapStatus(db, id, 'drafted', articleSlug);
  return { id, question: gap.question, status: 'drafted', articleSlug };
}

/* --------------------------------------------------- recent_conversations */

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  topic: string | null;
  tags: string[];
  messageCount: number;
  rating: string | null;
  /** The customer's last message, verbatim except that email addresses read "[email]". */
  snippet: string;
  lastMessageAt: string;
}

/**
 * A review log, so the assistant can see what people are struggling with.
 *
 * The contact block that `listConversations` returns is dropped here. This
 * output goes straight into a coding agent's context and on to whichever model
 * is behind it, and a customer's name and email are not needed to decide which
 * doc to write. The snippet is the customer's own words, though, and people
 * type their email into a support box all the time, so any address in it is
 * blanked before it leaves.
 */
export async function recentConversationsTool(
  db: Db,
  args: ToolArgs,
): Promise<ConversationSummary[]> {
  const limit = clampInteger(optionalNumber(args, 'limit') ?? 20, 1, 100);
  const status = optionalEnum(args, 'status', CONVERSATION_STATUSES);
  const page = await listConversations(db, { limit, status });
  return page.items.map((item) => ({
    id: item.id,
    status: item.status,
    topic: item.topic,
    tags: item.tags,
    messageCount: item.messageCount,
    rating: item.rating,
    snippet: redactEmails(item.snippet),
    lastMessageAt: asIsoString(item.lastMessageAt),
  }));
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Replaces every email address in a piece of text with "[email]". */
export function redactEmails(text: string): string {
  return text.replace(EMAIL, '[email]');
}

/* -------------------------------------------------------- report_summary */

export interface ReportSummary {
  range: { preset: ReportRange; from: string; to: string };
  conversations: number;
  resolved: number;
  unresolved: number;
  /** resolved / conversations, or null when nobody asked anything. */
  resolutionRate: number | null;
  helpfulVotes: number;
  unhelpfulVotes: number;
  costUsd: number;
  topTopics: { topic: string; count: number; resolvedRate: number | null }[];
}

export async function reportSummaryTool(db: Db, args: ToolArgs): Promise<ReportSummary> {
  const preset = optionalEnum(args, 'range', REPORT_RANGES) ?? '30d';
  const range = rangeFor(preset);
  // Topics ride along with the headline: "how are we doing" and "what about"
  // are the same question for someone deciding what to write next.
  const [head, topics] = await Promise.all([headline(db, range), topTopics(db, range, 5)]);

  return {
    range: { preset, from: range.from.toISOString(), to: range.to.toISOString() },
    conversations: head.conversations,
    resolved: head.resolved,
    unresolved: head.unresolved,
    resolutionRate: head.resolutionRate,
    helpfulVotes: head.helpfulVotes,
    unhelpfulVotes: head.unhelpfulVotes,
    costUsd: head.costUsd,
    topTopics: topics,
  };
}

/* ------------------------------------------------------------- dispatch */

export const TOOL_NAMES = [
  'search_articles',
  'read_article',
  'list_collections',
  'list_gaps',
  'resolve_gap',
  'recent_conversations',
  'read_conversation',
  'report_summary',
  'create_article',
  'update_article',
  'generate_changelog',
  'capture_screenshots',
  'import_docs',
  'update_setting',
  'list_segments',
  'count_segment',
  'run_evals',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

type Handler = (db: Db, args: ToolArgs, env: McpEnvironment) => Promise<unknown>;

const HANDLERS: Record<ToolName, Handler> = {
  search_articles: searchArticlesTool,
  read_article: readArticleTool,
  list_collections: (db) => listCollectionsTool(db),
  list_gaps: listGapsTool,
  resolve_gap: resolveGapTool,
  recent_conversations: recentConversationsTool,
  read_conversation: readConversationTool,
  report_summary: reportSummaryTool,
  create_article: createArticleTool,
  update_article: updateArticleTool,
  generate_changelog: (_db, args, env) => generateChangelogTool(args, env),
  capture_screenshots: (_db, args, env) => captureScreenshotsTool(args, env),
  import_docs: (_db, args, env) => importDocsTool(args, env),
  update_setting: updateSettingTool,
  list_segments: (db) => listSegmentsTool(db),
  count_segment: countSegmentTool,
  run_evals: runEvalsTool,
};

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Runs one tool by name. Throws; turning that into an MCP result is
 * server.ts's job. `env` says where the repo is, for the tools that write
 * files or run the CLI; it is found from the working directory when omitted.
 */
export async function runTool(
  db: Db,
  name: string,
  args: ToolArgs,
  env: McpEnvironment = resolveEnvironment(),
): Promise<unknown> {
  if (!isToolName(name)) {
    throw new HelpWellError(
      'not_found',
      `Unknown tool "${name}". Available: ${TOOL_NAMES.join(', ')}.`,
    );
  }
  return HANDLERS[name](db, args, env);
}

/* --------------------------------------------------------------- reading */

function requireString(args: ToolArgs, key: string): string {
  const value = args?.[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HelpWellError('bad_request', `"${key}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

function optionalNumber(args: ToolArgs, key: string): number | undefined {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  // Hosts vary on whether a JSON Schema "integer" arrives as a number or a
  // string, and rejecting "10" would be pedantic to no one's benefit.
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new HelpWellError('bad_request', `"${key}" must be a number.`);
  }
  return parsed;
}

function optionalEnum<T extends string>(
  args: ToolArgs,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = args?.[key];
  if (value === undefined || value === null || value === '') return undefined;
  const match = allowed.find((option) => option === value);
  if (!match) {
    throw new HelpWellError('bad_request', `"${key}" must be one of: ${allowed.join(', ')}.`);
  }
  return match;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/** Drivers hand timestamps back as either a Date or a string depending on the column. */
function asIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
