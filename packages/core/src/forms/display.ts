/**
 * Which forms a page view shows, and whether one may go on screen now.
 *
 * Forms are a consumer of the engage targeting engine, not a copy of it:
 * `selectTargeted` decides who and where, `allowedByFrequency` how often,
 * and `withinLimits` the global cap, against the same impressions table
 * engagements use (a form's rows are named `form:<id>`). So a popup form and
 * a modal share one cap on how often anyone is interrupted.
 *
 * Only the placements a trigger shows (popup, slide-in, bar, welcome mat)
 * are interruptions. They check the page rules, the frequency and the cap,
 * and are claimed like an engagement. An embed, the widget's Home tab and a
 * two-step button are where the page or the visitor asked for the form, so
 * they only check that it is live, in its dates and for this person.
 */

import { sql } from 'drizzle-orm';
import { PROACTIVE_ENGAGEMENT_PREFIX } from '../api/proactive.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { engageImpressions } from '../db/schema.js';
import type { EngageSettings } from '../engage/schema.js';
import { countsTowardsLimits } from '../engage/schema.js';
import {
  AudienceCache,
  allowedByFrequency,
  type Seen,
  selectTargeted,
  type Targetable,
  type VisitContext,
} from '../engage/targeting.js';
import { idPrefix, newId } from '../ids.js';
import { FORM_IMPRESSION_PREFIX, impressionHistory, withinLimits } from '../repos/engage.js';
import { type Form, type FormPlacement, isTriggered } from './schema.js';

/** A form as the targeting engine sees it. */
interface TargetableForm extends Targetable {
  form: Form;
}

function targetable(form: Form): TargetableForm {
  return {
    id: form.id,
    enabled: form.enabled && !form.archivedAt,
    targeting: form.definition.targeting,
    schedule: form.definition.schedule,
    form,
  };
}

/** The impression id a form's interruptions are recorded under. */
export function formImpressionId(formId: string): string {
  return `${FORM_IMPRESSION_PREFIX}${formId}`;
}

/** The forms this contact has already submitted and been accepted on. */
export async function submittedForms(db: Db, contactId: string | null): Promise<Set<string>> {
  if (!contactId) return new Set();
  const rows = rowsOf<{ form_id: string }>(
    await db.execute(sql`
      SELECT DISTINCT form_id FROM helpwell.form_submissions
      WHERE contact_id = ${contactId} AND status IN ('accepted', 'duplicate')
    `),
  );
  return new Set(rows.map((row) => row.form_id));
}

/** What a form has done with this contact, by form id: the memory behind frequency. */
async function formHistory(db: Db, contactId: string | null): Promise<Map<string, Seen>> {
  const all = await impressionHistory(db, contactId);
  const out = new Map<string, Seen>();
  for (const [id, seen] of all) {
    if (id.startsWith(FORM_IMPRESSION_PREFIX))
      out.set(id.slice(FORM_IMPRESSION_PREFIX.length), seen);
  }
  return out;
}

/**
 * The forms a trigger could show on this page view, highest priority first:
 * live, in their dates, for this person and page, allowed by their
 * frequency, and not already submitted when the form suppresses that.
 */
export async function formsForVisit(
  db: Db,
  forms: readonly Form[],
  visit: VisitContext,
): Promise<Form[]> {
  const candidates = forms.filter((f) => f.definition.placements.display !== 'none');
  if (candidates.length === 0) return [];
  const cache = new AudienceCache();
  const eligible = await selectTargeted(db, candidates.map(targetable), visit, { cache });
  const [history, submitted] = await Promise.all([
    formHistory(db, visit.contactId),
    submittedForms(db, visit.contactId),
  ]);
  return eligible
    .filter((t) => allowedByFrequency(t.form.definition.frequency, history.get(t.id), visit.now))
    .filter((t) => !(t.form.definition.suppressSubscribed && submitted.has(t.id)))
    .map((t) => t.form)
    .sort((a, b) => b.definition.priority - a.definition.priority);
}

export type FormClaimRefusal = 'unavailable' | 'frequency' | 'limit' | 'subscribed';

export type FormClaim = { shown: true } | { shown: false; reason: FormClaimRefusal };

/**
 * May this form be drawn now, in this placement? Checked on the server
 * every time, never trusted from the list: the form is live and in its dates
 * and for this person, and for a triggered placement the page rules, the
 * frequency and the global cap, under a per-contact lock so two tabs take
 * turns. A triggered placement that is allowed is recorded as seen.
 *
 * `manual` is the page asking by id (`helpwell.forms.show(id)`, a two-step
 * button), which the page rules, the frequency and the cap do not apply to.
 */
export async function claimForm(
  db: Db,
  form: Form,
  placement: FormPlacement,
  visit: VisitContext,
  options: {
    engage: Pick<EngageSettings, 'engagements' | 'limits'>;
    sessionId?: string | null;
    url?: string | null;
    manual?: boolean;
  },
): Promise<FormClaim> {
  const interruption = isTriggered(placement) && !options.manual;
  const [eligible] = await selectTargeted(db, [targetable(form)], visit, {
    ignorePlace: !interruption,
  });
  if (!eligible) return { shown: false, reason: 'unavailable' };

  if (interruption && form.definition.suppressSubscribed) {
    if ((await submittedForms(db, visit.contactId)).has(form.id)) {
      return { shown: false, reason: 'subscribed' };
    }
  }
  if (!interruption) return { shown: true };
  const contactId = visit.contactId;
  if (!contactId) return { shown: false, reason: 'unavailable' };

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${contactId}))`);
    const history = await formHistory(txDb, contactId);
    if (!allowedByFrequency(form.definition.frequency, history.get(form.id), visit.now)) {
      return { shown: false, reason: 'frequency' } as const;
    }
    // Every interruption counts: Settings engagements, the ones a support
    // extension asked for (proactive), and other forms (withinLimits).
    const proactive = rowsOf<{ id: string }>(
      await tx.execute(sql`
        SELECT DISTINCT engagement_id AS id FROM helpwell.engage_impressions
        WHERE contact_id = ${contactId}
          AND engagement_id LIKE ${`${PROACTIVE_ENGAGEMENT_PREFIX}%`}
      `),
    ).map((row) => row.id);
    const counted = [
      ...options.engage.engagements.filter((e) => countsTowardsLimits(e.kind)).map((e) => e.id),
      ...proactive,
    ];
    const within = await withinLimits(txDb, options.engage.limits, {
      contactId,
      sessionId: options.sessionId ?? null,
      engagementIds: counted,
      now: visit.now,
    });
    if (!within) return { shown: false, reason: 'limit' } as const;
    await tx.insert(engageImpressions).values({
      id: newId(idPrefix.impression),
      engagementId: formImpressionId(form.id),
      contactId,
      state: 'seen',
      url: options.url?.slice(0, 2000) ?? null,
      sessionId: options.sessionId?.slice(0, 80) ?? null,
      createdAt: visit.now,
    });
    return { shown: true } as const;
  });
}

/**
 * Remember that this contact closed the form, or submitted it: either one
 * ends a triggered form for them, the way dismissing an engagement does.
 */
export async function recordFormOutcome(
  db: Db,
  input: {
    formId: string;
    contactId: string;
    state: 'dismissed' | 'completed';
    url?: string | null;
  },
): Promise<void> {
  await db.insert(engageImpressions).values({
    id: newId(idPrefix.impression),
    engagementId: formImpressionId(input.formId),
    contactId: input.contactId,
    state: input.state,
    url: input.url?.slice(0, 2000) ?? null,
  });
}
