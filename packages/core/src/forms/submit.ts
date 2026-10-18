/**
 * One form submission, start to finish.
 *
 *   1. The render token proves the form was drawn by HelpWell: no token, a
 *      forged one or an expired one is refused, and counted as blocked.
 *      A token already used returns the first submission's answer.
 *   2. The answers are checked against the fields (a 400 names each problem).
 *   3. The verdict (abuse.ts): honeypot, fill time, rate limits, blocked
 *      and throwaway domains, the MX record, and whether it is a repeat.
 *   4. It is stored, whatever the verdict. A rejected one touches nothing
 *      else. An accepted one (or a repeat) updates the contact: its email and
 *      name, its answers as custom fields, consent when it was given, tags.
 *   5. A giveaway entry, crediting whoever referred them when it is trusted.
 *   6. Webhooks (`form.submitted`, `giveaway.entered`) for a new accepted
 *      submission, and the extension hook for a trusted one, in the
 *      background.
 *
 * Whose contact the answers land on is careful. The person at this browser
 * (the visitor cookie) is updated with what they typed. Someone new gets a
 * new contact. But an address that already belongs to a contact, typed by a
 * browser that is not theirs, only links the submission to them: a stranger
 * typing your email must not rewrite your fields, record your consent, or be
 * handed your visitor cookie.
 */

import { sql } from 'drizzle-orm';
import { hashIp } from '../agent/guards.js';
import type { SupportExtension } from '../api/support-extension.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';
import { createContact, setConsent, updateContact } from '../repos/contacts.js';
import { getFormVersion } from '../repos/forms.js';
import type { Settings } from '../settings/schema.js';
import { emitWebhooks, type WebhookOptions } from '../webhooks.js';
import {
  type FormVerdict,
  judgeSubmission,
  type RejectReason,
  rejectionMessage,
  SILENT_REASONS,
} from './abuse.js';
import { recordBlocked } from './analytics.js';
import { checkAnswers, type VisitDetails } from './answers.js';
import { recordFormOutcome } from './display.js';
import {
  type EntryState,
  enterGiveaway,
  entryState,
  findEntry,
  type GiveawayEntry,
  giveawayOpen,
} from './giveaway.js';
import { type FormSubmissionEvent, notifyFormSubmitted } from './hook.js';
import type { MxResolver } from './mx.js';
import { type Form, type FormPlacement, withVariant } from './schema.js';
import { type RenderClaims, signedDownloadPath, verifyRenderToken } from './tokens.js';

export interface SubmitContext {
  db: Db;
  settings: Settings;
  support?: SupportExtension;
  /** The visitor cookie's contact, when the browser presented a valid one. */
  contactId: string | null;
  ip: string | null;
  /** The bot check ran and passed (it is checked by the route, before this). */
  turnstilePassed: boolean;
  resolveMx?: MxResolver | null;
  now: Date;
  /** Where background failures (the hook, a webhook) are reported. */
  onError?: (error: unknown) => void;
  /** How `form.submitted` and `giveaway.entered` are sent: the install's own fetch. */
  webhooks?: WebhookOptions;
}

export interface SubmitInput {
  token: unknown;
  answers: unknown;
  honeypot?: unknown;
  page: VisitDetails;
  /** A giveaway referral code from the page's `?ref=`. */
  ref?: string | null;
}

/** What the page is sent back to show. */
export interface SubmitResponse {
  ok: true;
  submissionId: string;
  /** `received` for a submission rejected without saying so. */
  status: 'accepted' | 'duplicate' | 'received';
  success: {
    action: Form['definition']['success']['action'];
    blocks: Form['definition']['success']['blocks'];
    redirectUrl?: string;
    coupon?: { code: string; label: string };
    /** A path under the API, signed, and good until `expiresAt`. */
    download?: { path: string; label: string; expiresAt: string };
    formId?: string;
  };
  giveaway?: EntryState;
}

export interface SubmitOutcome {
  response: SubmitResponse;
  /** The contact the browser should carry a cookie for, when it should get one. */
  cookieContactId: string | null;
}

export async function submitForm(
  context: SubmitContext,
  form: Form,
  input: SubmitInput,
): Promise<SubmitOutcome> {
  const { db, now } = context;
  if (!form.enabled || form.archivedAt) {
    throw new HelpWellError('not_found', `Form ${form.id} is not live`, {
      publicMessage: 'This form is closed.',
    });
  }

  /* ---------------------------------------------------------------- token */

  const checked = await verifyRenderToken(db, input.token, { formId: form.id, now: now.getTime() });
  if (!checked.ok) {
    await recordBlocked(db, form.id, now);
    throw new HelpWellError(
      'forbidden',
      `Form submission without a valid render token (${checked.problem})`,
      {
        publicMessage:
          checked.problem === 'expired'
            ? 'This form has been open a long time. Reload the page and try again.'
            : 'That did not go through. Reload the page and try again.',
        details: { formToken: checked.problem },
      },
    );
  }
  const claims = checked.claims;
  const earlier = await byNonce(db, form.id, claims.nonce);
  if (earlier) return replay(context, form, earlier);

  /* -------------------------------------------------------------- answers */

  // The version the visitor saw may be older than the current one; its
  // fields are what they filled in.
  const drawn = withVariant(await versionDefinition(db, form, claims.version), claims.variant);
  const answers = checkAnswers(drawn, input.answers, input.page);
  if (Object.keys(answers.errors).length > 0) {
    const [first] = Object.values(answers.errors);
    throw new HelpWellError('bad_request', 'Some answers need fixing', {
      publicMessage: first ?? 'Check the form and try again.',
      details: { fields: answers.errors },
    });
  }
  if (drawn.type === 'giveaway') {
    const open = giveawayOpen(drawn.giveaway, now);
    if (open !== 'open') {
      throw new HelpWellError('bad_request', `Giveaway ${form.id} is ${open}`, {
        publicMessage:
          open === 'ended' ? 'This giveaway has ended.' : 'This giveaway has not started yet.',
      });
    }
  }

  /* -------------------------------------------------------------- verdict */

  const judged = await judgeSubmission(db, {
    formId: form.id,
    definition: drawn,
    settings: context.settings,
    email: answers.email,
    honeypot: input.honeypot,
    issuedAt: claims.issuedAt,
    now: now.getTime(),
    ip: context.ip,
    turnstilePassed: context.turnstilePassed,
    resolveMx: context.resolveMx,
  });
  if (judged.refused) {
    await recordBlocked(db, form.id, now);
    throw new HelpWellError('rate_limited', `Form ${form.id} flooded`, {
      publicMessage: 'That is a bit too fast. Try again shortly.',
    });
  }
  const { verdict, status } = judged;

  /* ----------------------------------------------------------------- store */

  let contactId = context.contactId;
  let cookieContactId: string | null = null;
  if (status !== 'rejected') {
    const resolved = await landOnContact(context, drawn, answers);
    contactId = resolved.contactId;
    if (resolved.cookie) cookieContactId = resolved.contactId;
  }
  const submissionId = newId(idPrefix.submission, now.getTime());
  const stored = await insertSubmission(db, {
    id: submissionId,
    form,
    claims,
    status,
    verdict,
    contactId,
    email: answers.email,
    name: answers.name,
    fields: answers.values,
    consent: answers.consent,
    page: input.page,
    ip: context.ip,
    now,
  });
  // Two submits with one token at the same moment: the first one stored wins.
  if (!stored) {
    const first = await byNonce(db, form.id, claims.nonce);
    if (first) return replay(context, form, first);
  }

  if (status === 'rejected') {
    const reason = verdict.reasons[0] as RejectReason;
    if (!verdict.reasons.every((r) => SILENT_REASONS.has(r))) {
      const visible = verdict.reasons.find((r) => !SILENT_REASONS.has(r)) ?? reason;
      throw new HelpWellError(
        'bad_request',
        `Form submission rejected: ${verdict.reasons.join(', ')}`,
        {
          publicMessage: rejectionMessage(visible),
          details: { fields: { email: rejectionMessage(visible) } },
        },
      );
    }
    // A script is told what a person would be, minus anything worth taking.
    return {
      cookieContactId: null,
      response: {
        ok: true,
        submissionId,
        status: 'received',
        success: { action: 'message', blocks: drawn.success.blocks },
      },
    };
  }

  if (contactId) {
    await recordFormOutcome(db, {
      formId: form.id,
      contactId,
      state: 'completed',
      url: input.page.path,
    });
  }

  /* -------------------------------------------------------------- giveaway */

  let entry: GiveawayEntry | null = null;
  let newEntry = false;
  if (drawn.type === 'giveaway') {
    if (status === 'accepted') {
      const entered = await enterGiveaway(db, form, {
        submissionId,
        contactId,
        email: answers.email,
        trusted: verdict.trusted,
        ref: input.ref ?? null,
        now,
      });
      entry = entered.entry;
      newEntry = entered.entry.submissionId === submissionId;
    } else {
      entry = await findEntry(db, form.id, { email: answers.email });
    }
  }

  /* ------------------------------------------------------ tell the others */

  if (status === 'accepted') {
    const event = submissionEvent({
      id: submissionId,
      form,
      claims,
      contactId: contactId ?? '',
      answers,
      verdict,
      page: input.page,
      entry,
      now,
    });
    await emitWebhooks(
      db,
      context.settings,
      'form.submitted',
      { ...event, trusted: verdict.trusted },
      context.webhooks,
    );
    if (entry && newEntry) {
      await emitWebhooks(
        db,
        context.settings,
        'giveaway.entered',
        {
          entryId: entry.id,
          formId: form.id,
          submissionId,
          contactId,
          email: entry.email,
          entries: entry.entries,
          referralCode: entry.referralCode,
          referredBy: entry.referredBy,
          trusted: entry.trusted,
        },
        context.webhooks,
      );
    }
    if (verdict.trusted && contactId) {
      await notifyFormSubmitted(db, context.support, event, context.onError, now);
    }
  }

  return {
    cookieContactId,
    response: await successResponse(db, form, drawn, {
      submissionId,
      status,
      entry,
      now,
    }),
  };
}

/* ----------------------------------------------------------------- contact */

async function landOnContact(
  context: SubmitContext,
  definition: Form['definition'],
  answers: ReturnType<typeof checkAnswers>,
): Promise<{ contactId: string; cookie: boolean }> {
  const { db, now } = context;
  const tags = definition.tags;
  const write = async (id: string) => {
    if (Object.keys(answers.attributes).length > 0 || tags.length > 0) {
      await updateContact(
        db,
        id,
        { attributes: answers.attributes, tags: { add: tags } },
        { source: 'form', now },
      );
    }
    if (answers.consent.state === 'granted') await setConsent(db, id, 'granted', 'form', now);
  };

  // The person at this browser.
  if (context.contactId) {
    const [own] = rowsOf<{ identified: boolean }>(
      await db.execute(sql`
        SELECT identified FROM helpwell.contacts WHERE id = ${context.contactId} AND deleted_at IS NULL
      `),
    );
    if (own) {
      // A signed-in person's email is the host app's to set; an anonymous
      // visitor's is whatever they just typed.
      await db.execute(sql`
        UPDATE helpwell.contacts SET
          email = CASE WHEN identified THEN coalesce(email, ${answers.email}) ELSE ${answers.email} END,
          name = CASE WHEN identified THEN coalesce(name, ${answers.name}) ELSE coalesce(${answers.name}, name) END,
          last_seen_at = ${now.toISOString()}::timestamptz,
          updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${context.contactId}
      `);
      await write(context.contactId);
      return { contactId: context.contactId, cookie: true };
    }
  }

  // Someone HelpWell already knows by this address, from another browser.
  const [known] = rowsOf<{ id: string; identified: boolean }>(
    await db.execute(sql`
      SELECT id, identified FROM helpwell.contacts
      WHERE lower(email) = ${answers.email} AND deleted_at IS NULL
      ORDER BY identified DESC, last_seen_at DESC LIMIT 1
    `),
  );
  if (known) {
    // Only an anonymous record that came in the same way takes the answers.
    if (!known.identified) await write(known.id);
    return { contactId: known.id, cookie: false };
  }

  const id = await createContact(db, {
    source: 'form',
    email: answers.email,
    name: answers.name,
    attributes: answers.attributes,
    tags,
  });
  if (answers.consent.state === 'granted') await setConsent(db, id, 'granted', 'form', now);
  return { contactId: id, cookie: true };
}

/* ------------------------------------------------------------------- store */

async function insertSubmission(
  db: Db,
  input: {
    id: string;
    form: Form;
    claims: RenderClaims;
    status: 'accepted' | 'rejected' | 'duplicate';
    verdict: FormVerdict;
    contactId: string | null;
    email: string;
    name: string | null;
    fields: Record<string, unknown>;
    consent: { state: 'granted' | 'denied' | 'none'; text: string | null };
    page: VisitDetails;
    ip: string | null;
    now: Date;
  },
): Promise<boolean> {
  const ipHash = input.ip ? await hashIp(db, input.ip) : null;
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`
      INSERT INTO helpwell.form_submissions
        (id, form_id, form_version, variant, placement, status, trusted, reasons, verdict,
         contact_id, email, name, fields, consent, consent_text, page_url, page_path, referrer,
         utm, ip_hash, token_nonce, created_at)
      VALUES (${input.id}, ${input.form.id}, ${input.claims.version}, ${input.claims.variant},
              ${input.claims.placement}, ${input.status}, ${input.verdict.trusted},
              ${JSON.stringify(input.verdict.reasons)}::jsonb, ${JSON.stringify(input.verdict)}::jsonb,
              ${input.contactId}, ${input.email}, ${input.name},
              ${JSON.stringify(input.fields)}::jsonb, ${input.consent.state}, ${input.consent.text},
              ${input.page.url?.slice(0, 2000) ?? null}, ${input.page.path?.slice(0, 300) ?? null},
              ${input.page.referrer?.slice(0, 2000) ?? null}, ${JSON.stringify(input.page.utm)}::jsonb,
              ${ipHash}, ${input.claims.nonce},
              ${input.now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING id
    `),
  );
  return rows.length > 0;
}

interface StoredSubmission {
  id: string;
  status: 'accepted' | 'rejected' | 'duplicate';
  reasons: RejectReason[];
  email: string;
  formVersion: number;
  variant: string;
  createdAt: Date;
}

async function byNonce(db: Db, formId: string, nonce: string): Promise<StoredSubmission | null> {
  const [row] = rowsOf<{
    id: string;
    status: StoredSubmission['status'];
    reasons: unknown;
    email: string | null;
    form_version: number | string;
    variant: string;
    created_at: string | Date;
  }>(
    await db.execute(sql`
      SELECT id, status, reasons, email, form_version, variant, created_at
      FROM helpwell.form_submissions WHERE form_id = ${formId} AND token_nonce = ${nonce}
    `),
  );
  if (!row) return null;
  const reasons = typeof row.reasons === 'string' ? JSON.parse(row.reasons) : row.reasons;
  return {
    id: row.id,
    status: row.status,
    reasons: Array.isArray(reasons) ? reasons : [],
    email: row.email ?? '',
    formVersion: Number(row.form_version),
    variant: row.variant,
    createdAt: new Date(row.created_at),
  };
}

/** The answer a repeated token gets: the same as the first time, without doing anything again. */
async function replay(
  context: SubmitContext,
  form: Form,
  earlier: StoredSubmission,
): Promise<SubmitOutcome> {
  const drawn = withVariant(
    await versionDefinition(context.db, form, earlier.formVersion),
    earlier.variant,
  );
  if (earlier.status === 'rejected') {
    const visible = earlier.reasons.find((r) => !SILENT_REASONS.has(r));
    if (visible) {
      throw new HelpWellError('bad_request', 'Form submission rejected', {
        publicMessage: rejectionMessage(visible),
        details: { fields: { email: rejectionMessage(visible) } },
      });
    }
    return {
      cookieContactId: null,
      response: {
        ok: true,
        submissionId: earlier.id,
        status: 'received',
        success: { action: 'message', blocks: drawn.success.blocks },
      },
    };
  }
  const entry =
    drawn.type === 'giveaway'
      ? await findEntry(context.db, form.id, { email: earlier.email })
      : null;
  return {
    cookieContactId: null,
    response: await successResponse(context.db, form, drawn, {
      submissionId: earlier.id,
      status: earlier.status,
      entry,
      now: context.now,
    }),
  };
}

async function versionDefinition(db: Db, form: Form, version: number): Promise<Form['definition']> {
  if (version === form.version) return form.definition;
  return (await getFormVersion(db, form.id, version))?.definition ?? form.definition;
}

/* ---------------------------------------------------------------- success */

async function successResponse(
  db: Db,
  form: Form,
  definition: Form['definition'],
  input: {
    submissionId: string;
    status: 'accepted' | 'duplicate';
    entry: GiveawayEntry | null;
    now: Date;
  },
): Promise<SubmitResponse> {
  const s = definition.success;
  const success: SubmitResponse['success'] = { action: s.action, blocks: s.blocks };
  switch (s.action) {
    case 'redirect':
      success.redirectUrl = s.redirectUrl;
      break;
    case 'coupon':
      success.coupon = { code: s.coupon.code, label: s.coupon.label };
      break;
    case 'download': {
      const expiresAt = input.now.getTime() + s.download.expiresHours * 3_600_000;
      success.download = {
        path: await signedDownloadPath(db, {
          formId: form.id,
          submissionId: input.submissionId,
          expiresAt,
        }),
        label: s.download.label,
        expiresAt: new Date(expiresAt).toISOString(),
      };
      break;
    }
    case 'form':
      success.formId = s.formId;
      break;
    default:
      break;
  }
  return {
    ok: true,
    submissionId: input.submissionId,
    status: input.status,
    success,
    ...(input.entry ? { giveaway: await entryState(db, form, input.entry) } : {}),
  };
}

/* ------------------------------------------------------------------- event */

function submissionEvent(input: {
  id: string;
  form: Form;
  claims: RenderClaims;
  contactId: string;
  answers: ReturnType<typeof checkAnswers>;
  verdict: FormVerdict;
  page: VisitDetails;
  entry: GiveawayEntry | null;
  now: Date;
}): FormSubmissionEvent {
  return {
    id: input.id,
    formId: input.form.id,
    formName: input.form.name,
    formType: input.form.definition.type,
    formVersion: input.claims.version,
    variant: input.claims.variant,
    placement: input.claims.placement as FormPlacement,
    submittedAt: input.now.toISOString(),
    contactId: input.contactId,
    email: input.answers.email,
    name: input.answers.name,
    fields: input.answers.values,
    attributes: input.answers.attributes,
    consent: input.answers.consent,
    verdict: input.verdict,
    page: { url: input.page.url, path: input.page.path },
    referrer: input.page.referrer,
    utm: input.page.utm,
    giveaway: input.entry
      ? {
          entryId: input.entry.id,
          entries: input.entry.entries,
          referralCode: input.entry.referralCode,
          referredBy: input.entry.referredBy,
        }
      : null,
  };
}
