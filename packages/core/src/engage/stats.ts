/**
 * How engagements are doing, read from the impressions table.
 *
 * One row is written per thing a visitor did: `seen` when it went on screen
 * (and for each later step of a tour, with its step number), `clicked` for a
 * call to action, `dismissed`, `completed`. Counting those per engagement
 * gives the dashboard's list; counting distinct people per tour step gives
 * the drop-off funnel.
 *
 * What counts as converting depends on the kind: a modal, banner or hotspot
 * converts when its call to action is clicked, a tour or survey when it is
 * finished.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { Engagement, EngagementKind, SurveyEngagement } from './schema.js';
import { type SurveyResults, surveyResults } from './surveys.js';

export interface EngagementStats {
  engagementId: string;
  /** Times it went on screen. A tour counts once, however many steps were seen. */
  seen: number;
  clicked: number;
  dismissed: number;
  completed: number;
  /** completed / seen, or null when nothing has been seen yet. */
  completionRate: number | null;
  /** Distinct people it was shown to. */
  people: number;
  /** Clicks for a modal, banner or hotspot; completions for a tour or survey. */
  conversions: number;
  /** conversions / seen, or null when nothing has been seen yet. */
  conversionRate: number | null;
}

/** Whether finishing, rather than clicking, is what a kind is for. */
export function convertsOnCompletion(kind: EngagementKind): boolean {
  return kind === 'tour' || kind === 'survey';
}

function window(since: Date | undefined) {
  return since ? sql`AND created_at >= ${since.toISOString()}::timestamptz` : sql``;
}

/**
 * Counts for every engagement with any impressions in the window, most seen
 * first. Pass the definitions so conversions follow each one's kind; without
 * them a conversion is a click.
 */
export async function engagementStats(
  db: Db,
  since?: Date,
  definitions: readonly Pick<Engagement, 'id' | 'kind'>[] = [],
): Promise<EngagementStats[]> {
  const kinds = new Map(definitions.map((d) => [d.id, d.kind]));
  const result = await db.execute(sql`
    SELECT engagement_id,
      count(*) FILTER (WHERE state = 'seen' AND (step IS NULL OR step <= 1)) AS seen,
      count(*) FILTER (WHERE state = 'clicked')   AS clicked,
      count(*) FILTER (WHERE state = 'dismissed') AS dismissed,
      count(*) FILTER (WHERE state = 'completed') AS completed,
      count(DISTINCT coalesce(contact_id, id)) FILTER (WHERE state = 'seen') AS people
    FROM helpwell.engage_impressions
    WHERE TRUE ${window(since)}
    GROUP BY engagement_id
    ORDER BY seen DESC, engagement_id
  `);

  return rowsOf<{
    engagement_id: string;
    seen: number | string;
    clicked: number | string;
    dismissed: number | string;
    completed: number | string;
    people: number | string;
  }>(result).map((row) => {
    const seen = Number(row.seen);
    const clicked = Number(row.clicked);
    const completed = Number(row.completed);
    const kind = kinds.get(row.engagement_id);
    const conversions = kind && convertsOnCompletion(kind) ? completed : clicked;
    return {
      engagementId: row.engagement_id,
      seen,
      clicked,
      dismissed: Number(row.dismissed),
      completed,
      completionRate: seen > 0 ? completed / seen : null,
      people: Number(row.people),
      conversions,
      conversionRate: seen > 0 ? Math.min(conversions / seen, 1) : null,
    };
  });
}

/** One engagement's counts, zeros included when nothing has happened yet. */
export async function statsFor(
  db: Db,
  engagement: Pick<Engagement, 'id' | 'kind'>,
  since?: Date,
): Promise<EngagementStats> {
  const all = await engagementStats(db, since, [engagement]);
  return (
    all.find((s) => s.engagementId === engagement.id) ?? {
      engagementId: engagement.id,
      seen: 0,
      clicked: 0,
      dismissed: 0,
      completed: 0,
      completionRate: null,
      people: 0,
      conversions: 0,
      conversionRate: null,
    }
  );
}

export interface TourStepStat {
  /** 1-based, as recorded. */
  step: number;
  /** Distinct people who saw this step. */
  people: number;
  /** Their share of the people who saw the first step. */
  reached: number | null;
  /** The share lost since the step before. */
  dropOff: number | null;
}

/** How far people get through a tour: distinct people per step, with drop-off. */
export async function tourFunnel(
  db: Db,
  tourId: string,
  steps: number,
  since?: Date,
): Promise<TourStepStat[]> {
  const result = await db.execute(sql`
    SELECT step, count(DISTINCT coalesce(contact_id, id)) AS people
    FROM helpwell.engage_impressions
    WHERE engagement_id = ${tourId} AND state = 'seen' AND step IS NOT NULL ${window(since)}
    GROUP BY step
  `);
  const byStep = new Map(
    rowsOf<{ step: number; people: number | string }>(result).map((r) => [
      Number(r.step),
      Number(r.people),
    ]),
  );
  const first = byStep.get(1) ?? 0;
  const out: TourStepStat[] = [];
  for (let step = 1; step <= steps; step++) {
    const people = byStep.get(step) ?? 0;
    const previous = step === 1 ? null : (out[step - 2]?.people ?? 0);
    out.push({
      step,
      people,
      reached: first > 0 ? people / first : null,
      dropOff: previous ? Math.max(0, (previous - people) / previous) : null,
    });
  }
  return out;
}

export interface EngagementResults {
  stats: EngagementStats;
  /** Tours only. */
  funnel: TourStepStat[] | null;
  /** Surveys only. */
  survey: SurveyResults | null;
}

/** Everything the results tab shows for one engagement. */
export async function engagementResults(
  db: Db,
  engagement: Engagement,
  since?: Date,
): Promise<EngagementResults> {
  const [stats, funnel, survey] = await Promise.all([
    statsFor(db, engagement, since),
    engagement.kind === 'tour'
      ? tourFunnel(db, engagement.id, engagement.tour.steps.length, since)
      : Promise.resolve(null),
    engagement.kind === 'survey'
      ? surveyResults(db, engagement as SurveyEngagement, since)
      : Promise.resolve(null),
  ]);
  return { stats, funnel, survey };
}
