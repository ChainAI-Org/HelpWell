/**
 * How forms are doing: views, submissions, conversion, and where from.
 *
 * Views are counted as they happen into `form_views`, one row per day, form,
 * variant, placement and page, with unique views counted once per visitor
 * per day (`form_viewers` remembers who, as a hash, for as long as the day
 * lasts). Submissions are read from `form_submissions` itself. The
 * conversion rate is trusted submissions over unique views: of the people
 * who saw it, how many became a lead worth having.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { REJECT_REASON_LABELS, type RejectReason } from './abuse.js';
import type { Form, FormPlacement } from './schema.js';
import { compareVariants, type VariantResult, type VariantVerdict } from './variants.js';

const day = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Count one view. `visitor` is whatever identifies the browser (a contact id,
 * the widget's own random id, else the address), hashed before it is kept.
 */
export async function recordView(
  db: Db,
  input: {
    formId: string;
    variant: string;
    placement: FormPlacement;
    page: string;
    /** Already hashed. */
    visitor: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const today = day(now);
  const page = normalisePage(input.page);
  const fresh = rowsOf<{ visitor: string }>(
    await db.execute(sql`
      INSERT INTO helpwell.form_viewers (form_id, day, visitor)
      VALUES (${input.formId}, ${today}::date, ${input.visitor})
      ON CONFLICT DO NOTHING
      RETURNING visitor
    `),
  ).length;
  await db.execute(sql`
    INSERT INTO helpwell.form_views (form_id, day, variant, placement, page, views, uniques)
    VALUES (${input.formId}, ${today}::date, ${input.variant}, ${input.placement}, ${page}, 1, ${fresh})
    ON CONFLICT (form_id, day, variant, placement, page) DO UPDATE SET
      views = helpwell.form_views.views + 1,
      uniques = helpwell.form_views.uniques + EXCLUDED.uniques
  `);
  // Yesterday's visitors are only needed until today is counted; now and
  // then, the older ones go.
  if (Math.random() < 0.02) {
    await db.execute(sql`
      DELETE FROM helpwell.form_viewers WHERE day < ${today}::date - 1
    `);
  }
}

/** A submission refused before it was stored: no valid token, or a flood. */
export async function recordBlocked(db: Db, formId: string, now: Date = new Date()): Promise<void> {
  await db.execute(sql`
    INSERT INTO helpwell.form_views (form_id, day, variant, placement, page, blocked)
    VALUES (${formId}, ${day(now)}::date, '', '', '', 1)
    ON CONFLICT (form_id, day, variant, placement, page) DO UPDATE SET
      blocked = helpwell.form_views.blocked + 1
  `);
}

/** Paths only, and short: a query string would split one page into many rows. */
export function normalisePage(page: string): string {
  const path = (page || '/').split(/[?#]/)[0] ?? '/';
  return (path.startsWith('/') ? path : `/${path}`).slice(0, 300);
}

export interface FormTotals {
  views: number;
  uniques: number;
  /** Every stored submission. */
  submissions: number;
  accepted: number;
  trusted: number;
  rejected: number;
  duplicates: number;
  /** Refused before they were stored. */
  blocked: number;
  /** Trusted over unique views. */
  conversionRate: number | null;
}

export interface FormAnalytics {
  from: string;
  to: string;
  totals: FormTotals;
  daily: { day: string; views: number; uniques: number; submissions: number; trusted: number }[];
  variants: VariantResult[];
  verdict: VariantVerdict | null;
  placements: {
    placement: string;
    views: number;
    uniques: number;
    trusted: number;
    conversionRate: number | null;
  }[];
  pages: {
    page: string;
    views: number;
    uniques: number;
    trusted: number;
    conversionRate: number | null;
  }[];
  referrers: { referrer: string; submissions: number; trusted: number }[];
  rejections: { reason: RejectReason | 'no_token'; label: string; count: number }[];
  giveaway: GiveawayStats | null;
}

export interface GiveawayStats {
  entrants: number;
  trustedEntrants: number;
  /** Every entry, bonuses included, of trusted entrants: what a draw weighs. */
  totalEntries: number;
  referrals: number;
  creditedReferrals: number;
  /** Credited referrals per trusted entrant: above 1, each entrant brings in more than one more. */
  viralCoefficient: number | null;
}

const rate = (hits: number, of: number) => (of > 0 ? Math.min(hits / of, 1) : null);

/** Everything the results page shows, for one form and a date range. */
export async function formAnalytics(
  db: Db,
  form: Form,
  range: { from: Date; to?: Date },
): Promise<FormAnalytics> {
  const to = range.to ?? new Date();
  const from = range.from;
  const fromDay = day(from);
  const toDay = day(to);
  const subsWindow = sql`form_id = ${form.id} AND created_at >= ${from.toISOString()}::timestamptz AND created_at <= ${to.toISOString()}::timestamptz`;
  const viewsWindow = sql`form_id = ${form.id} AND day >= ${fromDay}::date AND day <= ${toDay}::date`;

  const [viewTotals] = rowsOf<{ views: string; uniques: string; blocked: string }>(
    await db.execute(sql`
      SELECT coalesce(sum(views), 0) AS views, coalesce(sum(uniques), 0) AS uniques,
             coalesce(sum(blocked), 0) AS blocked
      FROM helpwell.form_views WHERE ${viewsWindow}
    `),
  );
  const [subTotals] = rowsOf<Record<string, string>>(
    await db.execute(sql`
      SELECT count(*) AS submissions,
        count(*) FILTER (WHERE status = 'accepted') AS accepted,
        count(*) FILTER (WHERE status = 'accepted' AND trusted) AS trusted,
        count(*) FILTER (WHERE status = 'rejected') AS rejected,
        count(*) FILTER (WHERE status = 'duplicate') AS duplicates
      FROM helpwell.form_submissions WHERE ${subsWindow}
    `),
  );
  const uniques = Number(viewTotals?.uniques ?? 0);
  const trusted = Number(subTotals?.trusted ?? 0);
  const totals: FormTotals = {
    views: Number(viewTotals?.views ?? 0),
    uniques,
    submissions: Number(subTotals?.submissions ?? 0),
    accepted: Number(subTotals?.accepted ?? 0),
    trusted,
    rejected: Number(subTotals?.rejected ?? 0),
    duplicates: Number(subTotals?.duplicates ?? 0),
    blocked: Number(viewTotals?.blocked ?? 0),
    conversionRate: rate(trusted, uniques),
  };

  // Per day, per variant, per placement and per page: views and trusted
  // submissions joined on the same key.
  const grouped = async (key: 'variant' | 'placement' | 'page' | 'day') => {
    const viewKey = key === 'day' ? sql`to_char(day, 'YYYY-MM-DD')` : sql.raw(key);
    const subKey =
      key === 'day'
        ? sql`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
        : key === 'page'
          ? sql`coalesce(page_path, '')`
          : sql.raw(key);
    const views = rowsOf<{ k: string; views: string; uniques: string }>(
      await db.execute(sql`
        SELECT ${viewKey} AS k, sum(views) AS views, sum(uniques) AS uniques
        FROM helpwell.form_views WHERE ${viewsWindow} AND (views > 0 OR uniques > 0)
        GROUP BY 1
      `),
    );
    const subs = rowsOf<{ k: string; submissions: string; trusted: string }>(
      await db.execute(sql`
        SELECT ${subKey} AS k, count(*) AS submissions,
          count(*) FILTER (WHERE status = 'accepted' AND trusted) AS trusted
        FROM helpwell.form_submissions WHERE ${subsWindow}
        GROUP BY 1
      `),
    );
    const out = new Map<
      string,
      { views: number; uniques: number; submissions: number; trusted: number }
    >();
    const at = (k: string) => {
      let entry = out.get(k);
      if (!entry) {
        entry = { views: 0, uniques: 0, submissions: 0, trusted: 0 };
        out.set(k, entry);
      }
      return entry;
    };
    for (const row of views) {
      const entry = at(row.k);
      entry.views += Number(row.views);
      entry.uniques += Number(row.uniques);
    }
    for (const row of subs) {
      const entry = at(row.k);
      entry.submissions += Number(row.submissions);
      entry.trusted += Number(row.trusted);
    }
    return out;
  };

  const [byDay, byVariant, byPlacement, byPage] = await Promise.all([
    grouped('day'),
    grouped('variant'),
    grouped('placement'),
    grouped('page'),
  ]);

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      day: k,
      views: v.views,
      uniques: v.uniques,
      submissions: v.submissions,
      trusted: v.trusted,
    }));

  const names = new Map(form.definition.variants.map((v) => [v.id, v.name]));
  const variantKeys = new Set([
    ...(form.definition.variants.length > 0 ? names.keys() : ['a']),
    ...byVariant.keys(),
  ]);
  variantKeys.delete('');
  const variants: VariantResult[] = [...variantKeys].map((id) => {
    const v = byVariant.get(id) ?? { views: 0, uniques: 0, submissions: 0, trusted: 0 };
    return {
      variant: id,
      name: names.get(id) ?? '',
      views: v.views,
      uniques: v.uniques,
      submissions: v.trusted,
      conversionRate: rate(v.trusted, v.uniques),
    };
  });

  const placements = [...byPlacement.entries()]
    .filter(([k]) => k !== '')
    .map(([placement, v]) => ({
      placement,
      views: v.views,
      uniques: v.uniques,
      trusted: v.trusted,
      conversionRate: rate(v.trusted, v.uniques),
    }))
    .sort((a, b) => b.views - a.views);

  const pages = [...byPage.entries()]
    .filter(([k]) => k !== '')
    .map(([page, v]) => ({
      page,
      views: v.views,
      uniques: v.uniques,
      trusted: v.trusted,
      conversionRate: rate(v.trusted, v.uniques),
    }))
    .sort((a, b) => b.views - a.views || b.trusted - a.trusted)
    .slice(0, 20);

  const referrers = rowsOf<{ referrer: string; submissions: string; trusted: string }>(
    await db.execute(sql`
      SELECT coalesce(nullif(substring(referrer from '^[a-z]+://([^/?#]+)'), ''), 'Direct') AS referrer,
        count(*) AS submissions,
        count(*) FILTER (WHERE status = 'accepted' AND trusted) AS trusted
      FROM helpwell.form_submissions WHERE ${subsWindow}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10
    `),
  ).map((row) => ({
    referrer: row.referrer,
    submissions: Number(row.submissions),
    trusted: Number(row.trusted),
  }));

  const rejections: FormAnalytics['rejections'] = rowsOf<{ reason: string; n: string }>(
    await db.execute(sql`
      SELECT reason, count(*) AS n
      FROM helpwell.form_submissions, jsonb_array_elements_text(reasons) AS reason
      WHERE ${subsWindow} AND status = 'rejected'
      GROUP BY reason ORDER BY n DESC
    `),
  ).map((row) => ({
    reason: row.reason as RejectReason,
    label: REJECT_REASON_LABELS[row.reason as RejectReason] ?? row.reason,
    count: Number(row.n),
  }));
  if (totals.blocked > 0) {
    rejections.push({
      reason: 'no_token',
      label: REJECT_REASON_LABELS.no_token,
      count: totals.blocked,
    });
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totals,
    daily,
    variants,
    verdict: variants.length > 1 ? compareVariants(variants) : null,
    placements,
    pages,
    referrers,
    rejections,
    giveaway: form.definition.type === 'giveaway' ? await giveawayStats(db, form.id) : null,
  };
}

export async function giveawayStats(db: Db, formId: string): Promise<GiveawayStats> {
  const [row] = rowsOf<Record<string, string>>(
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM helpwell.giveaway_entries WHERE form_id = ${formId}) AS entrants,
        (SELECT count(*) FROM helpwell.giveaway_entries WHERE form_id = ${formId} AND trusted) AS trusted_entrants,
        (SELECT coalesce(sum(entries), 0) FROM helpwell.giveaway_entries
          WHERE form_id = ${formId} AND trusted AND NOT disqualified) AS total_entries,
        (SELECT count(*) FROM helpwell.giveaway_referrals WHERE form_id = ${formId}) AS referrals,
        (SELECT count(*) FROM helpwell.giveaway_referrals WHERE form_id = ${formId} AND credited) AS credited
    `),
  );
  const trustedEntrants = Number(row?.trusted_entrants ?? 0);
  const credited = Number(row?.credited ?? 0);
  return {
    entrants: Number(row?.entrants ?? 0),
    trustedEntrants,
    totalEntries: Number(row?.total_entries ?? 0),
    referrals: Number(row?.referrals ?? 0),
    creditedReferrals: credited,
    viralCoefficient: trustedEntrants > 0 ? credited / trustedEntrants : null,
  };
}

export interface FormSummaryStats {
  views: number;
  uniques: number;
  trusted: number;
  conversionRate: number | null;
}

/** Per-form headline numbers since a date, for the forms list. */
export async function formsOverview(db: Db, since: Date): Promise<Map<string, FormSummaryStats>> {
  const views = rowsOf<{ form_id: string; views: string; uniques: string }>(
    await db.execute(sql`
      SELECT form_id, sum(views) AS views, sum(uniques) AS uniques FROM helpwell.form_views
      WHERE day >= ${day(since)}::date GROUP BY form_id
    `),
  );
  const subs = rowsOf<{ form_id: string; trusted: string }>(
    await db.execute(sql`
      SELECT form_id, count(*) AS trusted FROM helpwell.form_submissions
      WHERE created_at >= ${since.toISOString()}::timestamptz AND status = 'accepted' AND trusted
      GROUP BY form_id
    `),
  );
  const out = new Map<string, FormSummaryStats>();
  for (const row of views) {
    out.set(row.form_id, {
      views: Number(row.views),
      uniques: Number(row.uniques),
      trusted: 0,
      conversionRate: null,
    });
  }
  for (const row of subs) {
    const entry = out.get(row.form_id) ?? {
      views: 0,
      uniques: 0,
      trusted: 0,
      conversionRate: null,
    };
    entry.trusted = Number(row.trusted);
    out.set(row.form_id, entry);
  }
  for (const entry of out.values()) entry.conversionRate = rate(entry.trusted, entry.uniques);
  return out;
}
