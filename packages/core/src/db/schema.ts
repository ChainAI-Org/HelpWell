/**
 * Drizzle mirror of migrations/0001_init.sql.
 *
 * The SQL file is the source of truth — it is what runs against a customer's
 * database — and this file exists so queries are typed. `test/schema.test.ts`
 * checks the two never drift apart.
 */

import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const hw = pgSchema('helpwell');

/**
 * The sort key a collection gets when its _meta.json did not pick one.
 *
 * Ordered collections come first in the order they asked for; everything else
 * lands here and falls back to sorting by title, so adding a folder can never
 * renumber its neighbours.
 */
export const UNORDERED = 1000;

export const settings = hw.table('settings', {
  id: text('id').primaryKey().default('default'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** How a contact first reached HelpWell (CT-09). Set once, never overwritten. */
export type ContactSource = 'widget' | 'identify' | 'import' | 'form' | 'api';
export type ConsentState = 'unknown' | 'granted' | 'denied';

export const contacts = hw.table(
  'contacts',
  {
    id: text('id').primaryKey(),
    externalId: text('external_id'),
    email: text('email'),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    identified: boolean('identified').notNull().default(false),
    source: text('source').$type<ContactSource>().notNull().default('widget'),
    consent: text('consent').$type<ConsentState>().notNull().default('unknown'),
    /** Migration 0005 (CT-09): where the consent state came from, and when. */
    consentSource: text('consent_source'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    /** Migration 0005: the host app's own signup date, from identify `createdAt`. */
    signedUpAt: timestamp('signed_up_at', { withTimezone: true }),
    locale: text('locale'),
    timezone: text('timezone'),
    country: text('country'),
    city: text('city'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('contacts_last_seen_idx').on(t.lastSeenAt)],
);

export const contactTags = hw.table(
  'contact_tags',
  {
    contactId: text('contact_id').notNull(),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tag] })],
);

export const conversations = hw.table(
  'conversations',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id'),
    status: text('status').$type<'resolved' | 'unresolved'>().notNull().default('unresolved'),
    topic: text('topic'),
    pageUrl: text('page_url'),
    rating: text('rating').$type<'sad' | 'indifferent' | 'happy' | 'love' | null>(),
    ratingComment: text('rating_comment'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Migration 0007: when the visitor passed the bot check, once per conversation. */
    botVerifiedAt: timestamp('bot_verified_at', { withTimezone: true }),
  },
  (t) => [
    index('conversations_contact_idx').on(t.contactId),
    index('conversations_last_message_idx').on(t.lastMessageAt),
    index('conversations_status_idx').on(t.status),
  ],
);

export const conversationTags = hw.table(
  'conversation_tags',
  {
    conversationId: text('conversation_id').notNull(),
    tag: text('tag').notNull(),
    source: text('source').notNull().default('agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.tag] })],
);

export interface Citation {
  slug: string;
  title: string;
  collection: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  ms?: number;
}

/**
 * Migration 0010: one passage an agent reply was shown, for the conversation
 * review. Never sent to the visitor; `citations` is what they see.
 */
export interface MessageSource {
  /** The number the prompt (or a search_docs result) gave it. */
  ref: number;
  slug: string;
  title: string;
  /** How search found it: matching words, matching meaning, or both. */
  matchedBy: ('text' | 'semantic')[];
  /** Cosine similarity to the question, when the semantic pass ran; null otherwise. */
  similarity: number | null;
  /** The answer cited it by number, attached it, or plainly followed it. */
  cited: boolean;
  /** Cited only because the answer follows its wording, not by number. */
  inferred?: boolean;
}

export const messages = hw.table(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    role: text('role').$type<'customer' | 'agent' | 'event'>().notNull(),
    body: text('body').notNull().default(''),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    toolCalls: jsonb('tool_calls').$type<ToolCall[]>().notNull().default([]),
    feedback: text('feedback').$type<'helpful' | 'not_helpful' | null>(),
    feedbackComment: text('feedback_comment'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    latencyMs: integer('latency_ms'),
    /** 0-1, agent rows only (migration 0004). See agent/confidence.ts. */
    confidence: real('confidence'),
    confidenceReason: text('confidence_reason'),
    certainty: text('certainty').$type<'answered' | 'partial' | 'not_covered' | null>(),
    /** 0010: the passages the reply was shown, with similarity. Admin-only. */
    sources: jsonb('sources').$type<MessageSource[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const events = hw.table(
  'events',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id'),
    name: text('name').notNull(),
    props: jsonb('props').$type<Record<string, unknown>>().notNull().default({}),
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('events_contact_idx').on(t.contactId, t.createdAt),
    index('events_name_idx').on(t.name, t.createdAt),
  ],
);

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export const articleIndex = hw.table(
  'article_index',
  {
    slug: text('slug').primaryKey(),
    collection: text('collection').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    body: text('body').notNull().default(''),
    headings: jsonb('headings').$type<Heading[]>().notNull().default([]),
    status: text('status')
      .$type<'draft' | 'published' | 'archived'>()
      .notNull()
      .default('published'),
    appliesTo: text('applies_to'),
    orderIndex: integer('order_index').notNull().default(0),
    readingMinutes: integer('reading_minutes').notNull().default(1),
    embedding: jsonb('embedding').$type<number[] | null>(),
    contentHash: text('content_hash'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** 0006: the file relative to the docs folder, and the file as written. */
    path: text('path'),
    source: text('source'),
  },
  (t) => [index('article_index_collection_idx').on(t.collection, t.orderIndex)],
);

/** 0006: one row each time the index saw an article change (KB-16). */
export const articleVersions = hw.table(
  'article_versions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    slug: text('slug').notNull(),
    path: text('path'),
    contentHash: text('content_hash').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('published'),
    body: text('body').notNull().default(''),
    source: text('source'),
    /** sync | dashboard | api */
    origin: text('origin').$type<'sync' | 'dashboard' | 'api'>().notNull().default('sync'),
    /** 0014: the version a restore brought back, when this version is one. */
    restoredFrom: bigint('restored_from', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('article_versions_slug_idx').on(t.slug, t.id)],
);

/** One row per docs folder, written from its _meta.json by `helpwell sync`. */
export const collectionIndex = hw.table(
  'collection_index',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    icon: text('icon').notNull().default('book-open'),
    tint: text('tint').notNull().default('lavender'),
    orderIndex: integer('order_index').notNull().default(UNORDERED),
    askAgent: boolean('ask_agent').notNull().default(true),
    visibility: text('visibility').$type<'public' | 'identified'>().notNull().default('public'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('collection_index_order_idx').on(t.orderIndex, t.title)],
);

export const articleRatings = hw.table(
  'article_ratings',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    contactId: text('contact_id'),
    value: text('value').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('article_ratings_slug_idx').on(t.slug, t.createdAt)],
);

export const searches = hw.table(
  'searches',
  {
    id: text('id').primaryKey(),
    query: text('query').notNull(),
    resultsCount: integer('results_count').notNull().default(0),
    source: text('source').$type<'help_center' | 'widget'>().notNull().default('help_center'),
    contactId: text('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('searches_created_idx').on(t.createdAt)],
);

export const gaps = hw.table(
  'gaps',
  {
    id: text('id').primaryKey(),
    question: text('question').notNull(),
    variants: jsonb('variants').$type<string[]>().notNull().default([]),
    asks: integer('asks').notNull().default(1),
    status: text('status').$type<'new' | 'drafted' | 'dismissed'>().notNull().default('new'),
    articleSlug: text('article_slug'),
    suggestedCollection: text('suggested_collection'),
    suggestedTitle: text('suggested_title'),
    firstAskedAt: timestamp('first_asked_at', { withTimezone: true }).defaultNow().notNull(),
    lastAskedAt: timestamp('last_asked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('gaps_rank_idx').on(t.status, t.asks, t.lastAskedAt)],
);

export const gapConversations = hw.table(
  'gap_conversations',
  {
    gapId: text('gap_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    askedAs: text('asked_as'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.gapId, t.conversationId] })],
);

export const changelogEntries = hw.table(
  'changelog_entries',
  {
    id: text('id').primaryKey(),
    version: text('version'),
    title: text('title').notNull(),
    summary: text('summary'),
    body: text('body').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    status: text('status').$type<'draft' | 'published' | 'archived'>().notNull().default('draft'),
    coverUrl: text('cover_url'),
    sourceRef: text('source_ref'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('changelog_published_idx').on(t.publishedAt)],
);

export const changelogReads = hw.table(
  'changelog_reads',
  {
    entryId: text('entry_id').notNull(),
    contactId: text('contact_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.contactId] })],
);

export type RoadmapStatus = 'under_review' | 'planned' | 'in_progress' | 'shipped';

export const roadmapItems = hw.table(
  'roadmap_items',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body'),
    status: text('status').$type<RoadmapStatus>().notNull().default('under_review'),
    changelogEntryId: text('changelog_entry_id'),
    votesCount: integer('votes_count').notNull().default(0),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('roadmap_rank_idx').on(t.status, t.votesCount)],
);

export const roadmapVotes = hw.table(
  'roadmap_votes',
  {
    itemId: text('item_id').notNull(),
    contactId: text('contact_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.contactId] })],
);

export const engageImpressions = hw.table(
  'engage_impressions',
  {
    id: text('id').primaryKey(),
    engagementId: text('engagement_id').notNull(),
    contactId: text('contact_id'),
    state: text('state').$type<'seen' | 'clicked' | 'dismissed' | 'completed'>().notNull(),
    step: integer('step'),
    url: text('url'),
    /** Migration 0008: the widget's session, for the per-session cap. */
    sessionId: text('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('engage_impressions_idx').on(t.engagementId, t.state, t.createdAt),
    index('engage_impressions_contact_idx').on(t.contactId, t.engagementId),
  ],
);

export const surveyResponses = hw.table(
  'survey_responses',
  {
    id: text('id').primaryKey(),
    surveyId: text('survey_id').notNull(),
    kind: text('kind')
      .$type<'nps' | 'csat' | 'stars' | 'single' | 'multi' | 'text'>()
      .notNull()
      .default('nps'),
    score: integer('score'),
    choice: text('choice'),
    comment: text('comment'),
    contactId: text('contact_id'),
    /** Migration 0008: one visitor's pass through the survey, and the question answered. */
    sessionId: text('session_id'),
    questionId: text('question_id'),
    choices: jsonb('choices').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('survey_responses_idx').on(t.surveyId, t.createdAt)],
);

export const webhookDeliveries = hw.table(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    event: text('event').notNull(),
    url: text('url').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<'pending' | 'delivered' | 'failed'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseCode: integer('response_code'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /** Migration 0005: the exact bytes sent, and when to try again (null: done). */
    body: text('body'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  },
  (t) => [index('webhook_pending_idx').on(t.status, t.createdAt)],
);

/** Migration 0005: every attribute key seen, typed, plus HelpWell's own fields. */
export const contactFields = hw.table('contact_fields', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  type: text('type')
    .$type<'text' | 'number' | 'boolean' | 'date' | 'list' | 'url' | 'money'>()
    .notNull()
    .default('text'),
  source: text('source')
    .$type<'app' | 'helpwell' | 'import' | 'form' | 'api'>()
    .notNull()
    .default('app'),
  locked: boolean('locked').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  sample: jsonb('sample').$type<unknown>(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Migration 0005 (CT-07): a saved filter; `rules` is a condition group. */
export const segments = hw.table('segments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({ all: [] }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One eval case as written in `helpwell/evals.json`. Stored with each result
 * so a run can be repeated from the dashboard, which cannot read the repo.
 * `core/src/evals/cases.ts` documents every field.
 */
export interface EvalCaseSpec {
  id: string;
  question: string;
  /** A slug that should be cited; null when the docs should not cover it; absent to not check. */
  expect?: string | null;
  must?: string[];
  mustNot?: string[];
  expectUnresolved?: boolean;
  grade?: 'model';
  rubric?: string;
  note?: string;
}

/** One rule a case was judged on. The case's verdict is the worst of these. */
export interface EvalCheck {
  kind: 'citation' | 'unresolved' | 'must' | 'must_not' | 'grade';
  verdict: 'pass' | 'weak' | 'fail';
  detail?: string;
}

export interface EvalCaseResult {
  id: string;
  question: string;
  verdict: 'pass' | 'weak' | 'fail';
  answer: string;
  cited: string | null;
  expected: string | null;
  ms: number;
  reason?: string;
  /* Everything below is written from migration 0004 on; older runs lack it. */
  /** Every slug the answer cited, in order. `cited` is the first of them. */
  citedAll?: string[];
  unresolved?: boolean;
  confidence?: number | null;
  checks?: EvalCheck[];
  /** Checks that could not run, e.g. a model grade in a run without a model. */
  skipped?: EvalCheck['kind'][];
  spec?: EvalCaseSpec;
}

export const evalRuns = hw.table(
  'eval_runs',
  {
    id: text('id').primaryKey(),
    ref: text('ref'),
    score: integer('score').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    weak: integer('weak').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    medianMs: integer('median_ms'),
    cases: jsonb('cases').$type<EvalCaseResult[]>().notNull().default([]),
    /** full | retrieval; null for runs recorded before migration 0004. */
    mode: text('mode').$type<'full' | 'retrieval' | null>(),
    /** The chat model that answered; null for a retrieval-only run. */
    model: text('model'),
    /** Every case the run was given, skipped ones included, so it can be repeated. */
    suite: jsonb('suite').$type<EvalCaseSpec[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('eval_runs_created_idx').on(t.createdAt)],
);

export const spendLedger = hw.table(
  'spend_ledger',
  {
    id: text('id').primaryKey(),
    day: date('day').notNull(),
    kind: text('kind').$type<'chat' | 'docs' | 'embedding' | 'eval' | 'image'>().notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('spend_day_idx').on(t.day, t.kind)],
);

export const blockedAttempts = hw.table(
  'blocked_attempts',
  {
    id: text('id').primaryKey(),
    reason: text('reason').notNull(),
    ipHash: text('ip_hash'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('blocked_day_idx').on(t.createdAt)],
);

export const rateCounters = hw.table(
  'rate_counters',
  {
    bucket: text('bucket').notNull(),
    windowAt: timestamp('window_at', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowAt] })],
);

/** Migration 0010: facts about this install that are not settings (repos/install-state.ts). */
export const installState = hw.table('install_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Migration 0011: support extension calls waiting to be retried (api/support-retries.ts). */
export const supportRetries = hw.table(
  'support_retries',
  {
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.key] }),
    index('support_retries_due_idx').on(t.nextAttemptAt),
  ],
);

/** Migration 0011: what a support extension asked to show each visitor (api/proactive.ts). */
export const proactiveDeliveries = hw.table(
  'proactive_deliveries',
  {
    contactId: text('contact_id').notNull(),
    itemId: text('item_id').notNull(),
    kind: text('kind').$type<'chat' | 'engagement'>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).defaultNow().notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    conversationId: text('conversation_id'),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.itemId] }),
    index('proactive_deliveries_delivered_idx').on(t.deliveredAt),
  ],
);

/* ------------------------------------------------------------------ forms */

/** Migration 0009: form definitions, versioned (forms/, repos/forms.ts). */
export const forms = hw.table('forms', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  type: text('type').notNull().default('custom'),
  enabled: boolean('enabled').notNull().default(false),
  version: integer('version').notNull().default(1),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const formVersions = hw.table(
  'form_versions',
  {
    formId: text('form_id').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.formId, t.version] })],
);

/** Views per day, form, variant, placement and page. */
export const formViews = hw.table(
  'form_views',
  {
    formId: text('form_id').notNull(),
    day: date('day').notNull(),
    variant: text('variant').notNull().default(''),
    placement: text('placement').notNull().default(''),
    page: text('page').notNull().default(''),
    views: integer('views').notNull().default(0),
    uniques: integer('uniques').notNull().default(0),
    blocked: integer('blocked').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.formId, t.day, t.variant, t.placement, t.page] })],
);

/** Who was counted today, for unique views. */
export const formViewers = hw.table(
  'form_viewers',
  {
    formId: text('form_id').notNull(),
    day: date('day').notNull(),
    visitor: text('visitor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.formId, t.day, t.visitor] })],
);

export const formSubmissions = hw.table(
  'form_submissions',
  {
    id: text('id').primaryKey(),
    formId: text('form_id').notNull(),
    formVersion: integer('form_version').notNull().default(1),
    variant: text('variant').notNull().default(''),
    placement: text('placement').notNull().default(''),
    status: text('status').$type<'accepted' | 'rejected' | 'duplicate'>().notNull(),
    trusted: boolean('trusted').notNull().default(false),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    verdict: jsonb('verdict').$type<Record<string, unknown>>().notNull().default({}),
    contactId: text('contact_id'),
    email: text('email'),
    name: text('name'),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    consent: text('consent').$type<'granted' | 'denied' | 'none'>().notNull().default('none'),
    consentText: text('consent_text'),
    pageUrl: text('page_url'),
    pagePath: text('page_path'),
    referrer: text('referrer'),
    utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
    ipHash: text('ip_hash'),
    tokenNonce: text('token_nonce'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('form_submissions_form_idx').on(t.formId, t.createdAt)],
);

export const giveawayEntries = hw.table('giveaway_entries', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull(),
  submissionId: text('submission_id').notNull(),
  contactId: text('contact_id'),
  email: text('email').notNull(),
  referralCode: text('referral_code').notNull(),
  referredBy: text('referred_by'),
  trusted: boolean('trusted').notNull().default(false),
  disqualified: boolean('disqualified').notNull().default(false),
  bonusReferrals: integer('bonus_referrals').notNull().default(0),
  bonusActions: integer('bonus_actions').notNull().default(0),
  entries: integer('entries').notNull().default(1),
  actions: jsonb('actions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const giveawayReferrals = hw.table('giveaway_referrals', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull(),
  referrerEntryId: text('referrer_entry_id').notNull(),
  referredEntryId: text('referred_entry_id').notNull(),
  credited: boolean('credited').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const giveawayWinners = hw.table('giveaway_winners', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull(),
  drawId: text('draw_id').notNull(),
  entryId: text('entry_id').notNull(),
  position: integer('position').notNull(),
  seed: text('seed').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  snapshotSize: integer('snapshot_size').notNull(),
  totalWeight: integer('total_weight').notNull(),
  status: text('status').$type<'selected' | 'redrawn'>().notNull().default('selected'),
  reason: text('reason'),
  replacedBy: text('replaced_by'),
  replaces: text('replaces'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  redrawnAt: timestamp('redrawn_at', { withTimezone: true }),
});

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ArticleRow = typeof articleIndex.$inferSelect;
export type ArticleVersionRow = typeof articleVersions.$inferSelect;
export type Gap = typeof gaps.$inferSelect;
export type ChangelogEntry = typeof changelogEntries.$inferSelect;
export type RoadmapItem = typeof roadmapItems.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;
