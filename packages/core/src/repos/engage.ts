/**
 * Engage at runtime: which engagements a page view qualifies for, whether one
 * may be shown right now, and what the visitor did with it (EN-01..EN-14).
 *
 * The definitions live in settings (engage/schema.ts), so they are version
 * controlled. Targeting is the shared engine in engage/targeting.ts; this
 * module adds what is specific to engagements: the impressions table as the
 * memory behind frequency rules, the global cap, and tours resuming.
 *
 * The widget asks twice. `GET /engage` lists what this page could show, and
 * each one arms its trigger in the browser. When a trigger fires, the widget
 * claims it (`claimEngagement`) and only draws it if the server agrees; that
 * is where frequency and the cap are enforced, so two tabs or a cleared
 * localStorage cannot replay a tour or break the cap.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { engageImpressions } from '../db/schema.js';
import {
  countdownOver,
  countsTowardsLimits,
  type EngageLimits,
  type Engagement,
  type EngageSettings,
} from '../engage/schema.js';
import {
  AudienceCache,
  allowedByFrequency,
  inSchedule,
  matchesAudience,
  type Seen,
  selectTargeted,
  type VisitContext,
} from '../engage/targeting.js';
import { idPrefix, newId } from '../ids.js';

export { type EngagementStats, engagementStats } from '../engage/stats.js';
export {
  type NpsSummary,
  npsSummary,
  recordSurveyResponse,
  type SurveyAnswer,
} from '../engage/surveys.js';
export { matchesPaths, pathMatches } from '../engage/targeting.js';

export type ImpressionState = 'seen' | 'clicked' | 'dismissed' | 'completed';

/** @deprecated The settings type; kept so older imports still compile. */
export type EngagementDefinition = Engagement;
/** @deprecated `VisitContext`, which also carries referrer, UTM, device and language. */
export type MatchContext = Pick<VisitContext, 'path' | 'identified' | 'contactId'> &
  Partial<VisitContext>;

/** Fill what an older caller leaves out: no referrer, UTM, device or language. */
function fullVisit(visit: MatchContext): VisitContext {
  return {
    referrer: '',
    utm: {},
    device: null,
    language: '',
    now: new Date(),
    ...visit,
  };
}

/** A session is this long without a new impression when the widget sends no session id. */
const IMPLICIT_SESSION_MS = 30 * 60 * 1000;

/** What one contact has done with each engagement: the memory behind frequency. */
export async function impressionHistory(
  db: Db,
  contactId: string | null,
): Promise<Map<string, Seen>> {
  const history = new Map<string, Seen>();
  if (!contactId) return history;
  const result = await db.execute(sql`
    SELECT engagement_id, state, max(created_at) AS created_at
    FROM helpwell.engage_impressions
    WHERE contact_id = ${contactId}
    GROUP BY engagement_id, state
  `);
  for (const row of rowsOf<{ engagement_id: string; state: string; created_at: string | Date }>(
    result,
  )) {
    const entry = history.get(row.engagement_id) ?? { states: new Set<string>(), last: 0 };
    entry.states.add(row.state);
    if (row.state === 'seen') {
      entry.last = Math.max(entry.last, new Date(row.created_at).getTime());
    }
    history.set(row.engagement_id, entry);
  }
  return history;
}

/**
 * Which engagements this page view could show, highest priority first.
 *
 * `resume` names tours the browser has in progress. They come back whatever
 * the page, trigger or frequency rules say, as long as they are still
 * enabled, in schedule, for this person, and not finished.
 */
export async function selectEngagements(
  db: Db,
  engagements: readonly Engagement[],
  visit: MatchContext,
  options: { resume?: readonly string[] } = {},
): Promise<Engagement[]> {
  const full = fullVisit(visit);
  const cache = new AudienceCache();
  const history = await impressionHistory(db, full.contactId);
  const resume = new Set(options.resume ?? []);

  const placed = await selectTargeted(db, engagements, full, { cache });
  const chosen = new Set<Engagement>(
    placed.filter(
      (e) =>
        allowedByFrequency(e.frequency, history.get(e.id), full.now) && !countdownOver(e, full.now),
    ),
  );

  for (const engagement of engagements) {
    if (engagement.kind !== 'tour' || !resume.has(engagement.id) || chosen.has(engagement)) {
      continue;
    }
    const seen = history.get(engagement.id);
    if (seen?.states.has('completed') || seen?.states.has('dismissed')) continue;
    const [eligible] = await selectTargeted(db, [engagement], full, { cache, ignorePlace: true });
    if (eligible) chosen.add(eligible);
  }

  return [...chosen].sort((a, b) => b.priority - a.priority);
}

/**
 * One engagement the page asked for by id (`helpwell.engage.show(id)`).
 * Enabled, in schedule and for this person; which page it is and the trigger
 * do not matter, because the page asked.
 */
export async function engagementForVisit(
  db: Db,
  engagements: readonly Engagement[],
  id: string,
  visit: MatchContext,
): Promise<Engagement | null> {
  const engagement = engagements.find((e) => e.id === id);
  if (!engagement) return null;
  const [eligible] = await selectTargeted(db, [engagement], fullVisit(visit), {
    ignorePlace: true,
  });
  return eligible ?? null;
}

export type ClaimRefusal = 'not_found' | 'unavailable' | 'frequency' | 'limit';

export type ClaimResult = { shown: true } | { shown: false; reason: ClaimRefusal };

/**
 * May this engagement go on screen now? If so it is recorded as seen, in the
 * same transaction as the checks, and the widget draws it.
 *
 * Checked again here, not trusted from the list: still enabled and in
 * schedule, still for this person, the frequency rule, and the global cap,
 * which counts what a support extension showed too (`withinLimits`).
 * `manual` is the page asking by id, which the frequency rule and the cap do
 * not apply to. A per-contact advisory lock makes two tabs take turns, so
 * both cannot slip under a cap of one.
 */
export async function claimEngagement(
  db: Db,
  engage: Pick<EngageSettings, 'engagements' | 'limits'>,
  id: string,
  visit: MatchContext,
  options: {
    contactId: string;
    sessionId?: string | null;
    url?: string | null;
    manual?: boolean;
    /** Tours: the step about to be drawn, when the first could not be. */
    step?: number;
  },
): Promise<ClaimResult> {
  const full = fullVisit({ ...visit, contactId: options.contactId });
  const engagement = engage.engagements.find((e) => e.id === id);
  if (!engagement) return { shown: false, reason: 'not_found' };
  if (!engagement.enabled || !inSchedule(engagement.schedule, full.now)) {
    return { shown: false, reason: 'unavailable' };
  }
  if (!(await matchesAudience(db, engagement.targeting, full))) {
    return { shown: false, reason: 'unavailable' };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${options.contactId}))`);

    if (!options.manual) {
      const history = await impressionHistory(tx as unknown as Db, options.contactId);
      if (!allowedByFrequency(engagement.frequency, history.get(engagement.id), full.now)) {
        return { shown: false, reason: 'frequency' } as const;
      }
      if (countsTowardsLimits(engagement.kind)) {
        const counted = engage.engagements
          .filter((e) => countsTowardsLimits(e.kind))
          .map((e) => e.id);
        const within = await withinLimits(tx as unknown as Db, engage.limits, {
          contactId: options.contactId,
          sessionId: options.sessionId ?? null,
          engagementIds: counted,
          now: full.now,
        });
        if (!within) return { shown: false, reason: 'limit' } as const;
      }
    }

    await tx.insert(engageImpressions).values({
      id: newId(idPrefix.impression),
      engagementId: engagement.id,
      contactId: options.contactId,
      state: 'seen',
      step: engagement.kind === 'tour' ? (options.step ?? 1) : null,
      url: options.url?.slice(0, 2000) ?? null,
      sessionId: options.sessionId?.slice(0, 80) ?? null,
      createdAt: full.now,
    });
    return { shown: true } as const;
  });
}

/**
 * How a form's popup, slide-in, bar or welcome mat is named in the
 * impressions table (forms/display.ts). Forms record there only for the
 * placements a trigger shows, so every one of those rows is an interruption.
 */
export const FORM_IMPRESSION_PREFIX = 'form:';

/**
 * How a support extension's engagement is named in the impressions table
 * (api/proactive.ts), apart from Settings' own.
 */
export const PROACTIVE_IMPRESSION_PREFIX = 'proactive:';

/**
 * Whether one more interruption fits under the global cap. Counts what this
 * contact was shown: this session (by the widget's session id, or else the
 * last half hour), the last day, and how long since the last one. Forms that
 * popped up count too, and so do the engagements a support extension sent
 * (every kind but a hotspot, as for Settings ones), whichever caller is
 * asking, so the cap is one cap in every direction.
 */
export async function withinLimits(
  db: Db,
  limits: EngageLimits,
  input: { contactId: string; sessionId: string | null; engagementIds: string[]; now: Date },
): Promise<boolean> {
  if (!limits.perSession && !limits.perDay && !limits.minMinutesBetween) return true;

  const now = input.now.getTime();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sessionStart = new Date(now - IMPLICIT_SESSION_MS).toISOString();
  const listed =
    input.engagementIds.length > 0
      ? sql`i.engagement_id IN (${sql.join(
          input.engagementIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`FALSE`;
  const proactive = sql`(i.engagement_id LIKE ${`${PROACTIVE_IMPRESSION_PREFIX}%`} AND EXISTS (
      SELECT 1 FROM helpwell.proactive_deliveries d
      WHERE d.contact_id = i.contact_id
        AND d.kind = 'engagement'
        AND d.item_id = substr(i.engagement_id, ${PROACTIVE_IMPRESSION_PREFIX.length + 1}::int)
        AND coalesce(d.payload->'engagement'->>'kind', '') <> 'hotspot'))`;
  const ids = sql`${listed} OR i.engagement_id LIKE ${`${FORM_IMPRESSION_PREFIX}%`} OR ${proactive}`;
  const sessionFilter = input.sessionId
    ? sql`i.session_id = ${input.sessionId}`
    : sql`i.created_at >= ${sessionStart}::timestamptz`;

  const result = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE i.created_at >= ${dayAgo}::timestamptz) AS day,
      count(*) FILTER (WHERE ${sessionFilter}) AS session,
      max(i.created_at) AS last
    FROM helpwell.engage_impressions i
    WHERE i.contact_id = ${input.contactId}
      AND i.state = 'seen'
      AND (i.step IS NULL OR i.step <= 1)
      AND (${ids})
  `);
  const row = rowsOf<{ day: number | string; session: number | string; last: string | null }>(
    result,
  )[0];
  const day = Number(row?.day ?? 0);
  const session = Number(row?.session ?? 0);
  if (limits.perDay && day >= limits.perDay) return false;
  if (limits.perSession && session >= limits.perSession) return false;
  if (limits.minMinutesBetween && row?.last) {
    const gap = now - new Date(row.last).getTime();
    if (gap < limits.minMinutesBetween * 60 * 1000) return false;
  }
  return true;
}

export async function recordImpression(
  db: Db,
  input: {
    engagementId: string;
    contactId: string | null;
    state: ImpressionState;
    step?: number;
    url?: string;
    sessionId?: string | null;
  },
): Promise<void> {
  await db.insert(engageImpressions).values({
    id: newId(idPrefix.impression),
    engagementId: input.engagementId,
    contactId: input.contactId,
    state: input.state,
    step: input.step ?? null,
    url: input.url ?? null,
    sessionId: input.sessionId?.slice(0, 80) ?? null,
  });
}

/**
 * The public view of an engagement: what the widget needs to draw it and
 * arm its trigger. Targeting and schedule stay on the server, because they
 * say who the product owner is aiming at, and the name is internal.
 */
export function publicEngagement(engagement: Engagement): Record<string, unknown> {
  const {
    targeting: _targeting,
    schedule: _schedule,
    frequency: _frequency,
    name: _name,
    ...visible
  } = engagement;
  return visible;
}
