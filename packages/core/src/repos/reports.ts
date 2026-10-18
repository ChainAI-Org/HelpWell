/**
 * Reports (RP-01..RP-12).
 *
 * Every number here answers a question the design boards ask out loud:
 * is the agent actually resolving things, what are people asking, what is this
 * costing, and which articles are carrying the load.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * The date-range control on the reports screen (RP-02).
 *
 * Days are UTC days everywhere in reports: the spend ledger writes the UTC
 * date, the daily series buckets by it, and "today" starts at UTC midnight.
 * One clock, so a conversation at 23:30 lands in the same day on the chart,
 * in the CSV and in the cap.
 */
export function rangeFor(
  preset: '7d' | '30d' | '90d' | 'today' | 'all',
  now = new Date(),
): DateRange {
  const to = now;
  const from = new Date(now);
  switch (preset) {
    case 'today':
      from.setUTCHours(0, 0, 0, 0);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    case '90d':
      from.setDate(from.getDate() - 90);
      break;
    case 'all':
      from.setFullYear(2000, 0, 1);
      break;
  }
  return { from, to };
}

/**
 * A range bound as a query parameter. postgres.js (production) rejects a raw Date inside
 * drizzle's sql template; PGlite (tests) accepts one, so only real servers broke.
 */
function at(date: Date): string {
  return date.toISOString();
}

export interface Headline {
  conversations: number;
  resolved: number;
  /** resolved / conversations, or null when there were none. */
  resolutionRate: number | null;
  unresolved: number;
  medianLatencyMs: number | null;
  costUsd: number;
  helpfulVotes: number;
  unhelpfulVotes: number;
  articleViewsFromAgent: number;
}

export async function headline(db: Db, range: DateRange): Promise<Headline> {
  const result = await db.execute<Record<string, number | string | null>>(sql`
    SELECT
      count(*)                                              AS conversations,
      count(*) FILTER (WHERE status = 'resolved')           AS resolved,
      count(*) FILTER (WHERE status = 'unresolved')         AS unresolved,
      COALESCE(sum(cost_usd), 0)                            AS cost_usd
    FROM helpwell.conversations
    WHERE deleted_at IS NULL AND started_at >= ${at(range.from)} AND started_at <= ${at(range.to)}
  `);
  const row = rowsOf<Record<string, number | string | null>>(result)[0] ?? {};

  const latency = await db.execute<{ p50: number | string | null }>(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50
    FROM helpwell.messages
    WHERE role = 'agent' AND latency_ms IS NOT NULL
      AND created_at >= ${at(range.from)} AND created_at <= ${at(range.to)}
  `);

  const votes = await db.execute<{ helpful: number | string; unhelpful: number | string }>(sql`
    SELECT
      count(*) FILTER (WHERE feedback = 'helpful')     AS helpful,
      count(*) FILTER (WHERE feedback = 'not_helpful') AS unhelpful
    FROM helpwell.messages
    WHERE created_at >= ${at(range.from)} AND created_at <= ${at(range.to)}
  `);

  const cited = await db.execute<{ n: number | string }>(sql`
    SELECT COALESCE(sum(jsonb_array_length(citations)), 0) AS n
    FROM helpwell.messages
    WHERE role = 'agent' AND created_at >= ${at(range.from)} AND created_at <= ${at(range.to)}
  `);

  const conversations = Number(row.conversations ?? 0);
  const resolved = Number(row.resolved ?? 0);
  const p50 = rowsOf<{ p50: number | string | null }>(latency)[0]?.p50;
  const voteRow = rowsOf<{ helpful: number | string; unhelpful: number | string }>(votes)[0];

  return {
    conversations,
    resolved,
    resolutionRate: conversations > 0 ? resolved / conversations : null,
    unresolved: Number(row.unresolved ?? 0),
    medianLatencyMs: p50 == null ? null : Math.round(Number(p50)),
    costUsd: Number(row.cost_usd ?? 0),
    helpfulVotes: Number(voteRow?.helpful ?? 0),
    unhelpfulVotes: Number(voteRow?.unhelpful ?? 0),
    articleViewsFromAgent: Number(rowsOf<{ n: number | string }>(cited)[0]?.n ?? 0),
  };
}

export interface SeriesPoint {
  day: string;
  conversations: number;
  resolved: number;
  costUsd: number;
}

/** Daily series with zero-filled gaps so the chart has no holes (RP-04). */
export async function dailySeries(db: Db, range: DateRange): Promise<SeriesPoint[]> {
  const result = await db.execute<{
    day: string | Date;
    conversations: number | string;
    resolved: number | string;
    cost_usd: number | string;
  }>(sql`
    SELECT
      d::date AS day,
      count(c.id)                                        AS conversations,
      count(c.id) FILTER (WHERE c.status = 'resolved')   AS resolved,
      COALESCE(sum(c.cost_usd), 0)                       AS cost_usd
    FROM generate_series(
      (${at(range.from)}::timestamptz AT TIME ZONE 'UTC')::date,
      (${at(range.to)}::timestamptz AT TIME ZONE 'UTC')::date,
      interval '1 day'
    ) d
    LEFT JOIN helpwell.conversations c
      ON (c.started_at AT TIME ZONE 'UTC')::date = d::date AND c.deleted_at IS NULL
    GROUP BY d
    ORDER BY d ASC
  `);

  return rowsOf<{
    day: string | Date;
    conversations: number | string;
    resolved: number | string;
    cost_usd: number | string;
  }>(result).map((row) => ({
    day: typeof row.day === 'string' ? row.day.slice(0, 10) : row.day.toISOString().slice(0, 10),
    conversations: Number(row.conversations),
    resolved: Number(row.resolved),
    costUsd: Number(row.cost_usd),
  }));
}

export interface TopicCount {
  topic: string;
  count: number;
  resolvedRate: number | null;
}

export async function topTopics(db: Db, range: DateRange, limit = 10): Promise<TopicCount[]> {
  const result = await db.execute<{
    topic: string;
    n: number | string;
    resolved: number | string;
  }>(sql`
    SELECT topic, count(*) AS n, count(*) FILTER (WHERE status = 'resolved') AS resolved
    FROM helpwell.conversations
    WHERE topic IS NOT NULL AND deleted_at IS NULL
      AND started_at >= ${at(range.from)} AND started_at <= ${at(range.to)}
    GROUP BY topic
    ORDER BY n DESC
    LIMIT ${limit}
  `);

  return rowsOf<{ topic: string; n: number | string; resolved: number | string }>(result).map(
    (row) => {
      const n = Number(row.n);
      return {
        topic: row.topic,
        count: n,
        resolvedRate: n > 0 ? Number(row.resolved) / n : null,
      };
    },
  );
}

export interface SearchRow {
  query: string;
  count: number;
  zeroResults: boolean;
}

/** What people typed, and which of those found nothing (RP-07). */
export async function topSearches(db: Db, range: DateRange, limit = 20): Promise<SearchRow[]> {
  const result = await db.execute<{
    query: string;
    n: number | string;
    max_results: number | string;
  }>(sql`
    SELECT lower(query) AS query, count(*) AS n, max(results_count) AS max_results
    FROM helpwell.searches
    WHERE created_at >= ${at(range.from)} AND created_at <= ${at(range.to)}
    GROUP BY lower(query)
    ORDER BY n DESC
    LIMIT ${limit}
  `);

  return rowsOf<{ query: string; n: number | string; max_results: number | string }>(result).map(
    (row) => ({
      query: row.query,
      count: Number(row.n),
      zeroResults: Number(row.max_results) === 0,
    }),
  );
}

export interface ArticleStat {
  slug: string;
  title: string;
  collection: string;
  citations: number;
  helpful: number;
  unhelpful: number;
}

/** Which articles the agent leans on, and whether they land (RP-08). */
export async function articlePerformance(
  db: Db,
  range: DateRange,
  limit = 20,
): Promise<ArticleStat[]> {
  const result = await db.execute<{
    slug: string;
    title: string;
    collection: string;
    citations: number | string;
    helpful: number | string;
    unhelpful: number | string;
  }>(sql`
    WITH cited AS (
      SELECT c->>'slug' AS slug, m.feedback
      FROM helpwell.messages m
      CROSS JOIN LATERAL jsonb_array_elements(m.citations) AS c
      WHERE m.role = 'agent' AND m.created_at >= ${at(range.from)} AND m.created_at <= ${at(range.to)}
    )
    SELECT
      a.slug, a.title, a.collection,
      count(cited.slug)                                       AS citations,
      count(*) FILTER (WHERE cited.feedback = 'helpful')       AS helpful,
      count(*) FILTER (WHERE cited.feedback = 'not_helpful')   AS unhelpful
    FROM cited
    JOIN helpwell.article_index a ON a.slug = cited.slug
    GROUP BY a.slug, a.title, a.collection
    ORDER BY citations DESC
    LIMIT ${limit}
  `);

  return rowsOf<{
    slug: string;
    title: string;
    collection: string;
    citations: number | string;
    helpful: number | string;
    unhelpful: number | string;
  }>(result).map((row) => ({
    slug: row.slug,
    title: row.title,
    collection: row.collection,
    citations: Number(row.citations),
    helpful: Number(row.helpful),
    unhelpful: Number(row.unhelpful),
  }));
}

export interface SpendRow {
  day: string;
  kind: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export async function spendBreakdown(db: Db, range: DateRange): Promise<SpendRow[]> {
  const result = await db.execute<{
    day: string | Date;
    kind: string;
    model: string;
    tokens_in: number | string;
    tokens_out: number | string;
    cost_usd: number | string;
  }>(sql`
    SELECT day, kind, model,
      sum(tokens_in) AS tokens_in, sum(tokens_out) AS tokens_out, sum(cost_usd) AS cost_usd
    FROM helpwell.spend_ledger
    WHERE day >= (${at(range.from)}::timestamptz AT TIME ZONE 'UTC')::date
      AND day <= (${at(range.to)}::timestamptz AT TIME ZONE 'UTC')::date
    GROUP BY day, kind, model
    ORDER BY day DESC, cost_usd DESC
  `);

  return rowsOf<{
    day: string | Date;
    kind: string;
    model: string;
    tokens_in: number | string;
    tokens_out: number | string;
    cost_usd: number | string;
  }>(result).map((row) => ({
    day: typeof row.day === 'string' ? row.day.slice(0, 10) : row.day.toISOString().slice(0, 10),
    kind: row.kind,
    model: row.model,
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    costUsd: Number(row.cost_usd),
  }));
}

export interface ReportBundle {
  range: { from: string; to: string };
  headline: Headline;
  series: SeriesPoint[];
  topics: TopicCount[];
  searches: SearchRow[];
  articles: ArticleStat[];
  spend: SpendRow[];
}

/** One call for the whole reports screen, so it paints in a single request. */
export async function reportBundle(db: Db, range: DateRange): Promise<ReportBundle> {
  const [head, series, topics, searches, articles, spend] = await Promise.all([
    headline(db, range),
    dailySeries(db, range),
    topTopics(db, range),
    topSearches(db, range),
    articlePerformance(db, range),
    spendBreakdown(db, range),
  ]);

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    headline: head,
    series,
    topics,
    searches,
    articles,
    spend,
  };
}

/** CSV export of the daily series (RP-11). */
export function seriesToCsv(series: SeriesPoint[]): string {
  const header = 'day,conversations,resolved,cost_usd';
  const lines = series.map(
    (p) => `${p.day},${p.conversations},${p.resolved},${p.costUsd.toFixed(6)}`,
  );
  return [header, ...lines].join('\n');
}
