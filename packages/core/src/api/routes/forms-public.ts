/**
 * Forms over HTTP, for the widget and for a page that only embeds forms.
 *
 *   GET  /forms/display                what a trigger could pop up on this page view
 *   POST /forms/:id/render             draw one: the form, its variant, a signed render token
 *   POST /forms/:id/submit             a submission (forms/submit.ts)
 *   POST /forms/:id/dismiss            the visitor closed a popup: it stays closed for them
 *   POST /forms/:id/giveaway/action    a self-reported bonus entry, with the entrant's key
 *   GET  /forms/:id/download/:sub      a signed, expiring lead-magnet link
 *
 * Every call is public, so none trusts the page: targeting, frequency and
 * the global cap are checked on the server when a form is drawn, and a
 * submission needs the token that drawing it issued. The targeting rules,
 * the anti-abuse settings, the coupon code and the download address are
 * never sent to the page.
 */

import { sql } from 'drizzle-orm';
import { rateLimit } from '../../agent/guards.js';
import { resolveMediaDirs } from '../../content/media.js';
import { rowsOf } from '../../db/rows.js';
import type { UtmKey } from '../../engage/rules.js';
import { UTM_KEYS } from '../../engage/rules.js';
import { visitFromQuery } from '../../engage/targeting.js';
import { HelpWellError } from '../../errors.js';
import { recordView } from '../../forms/analytics.js';
import type { VisitDetails } from '../../forms/answers.js';
import {
  claimForm,
  formsForVisit,
  recordFormOutcome,
  submittedForms,
} from '../../forms/display.js';
import { FORM_FILE_REF, readFormFile } from '../../forms/files.js';
import { claimBonusAction, entryState, findEntry, getEntry } from '../../forms/giveaway.js';
import {
  FORM_PLACEMENTS,
  type Form,
  isTriggered,
  publicForm,
  withVariant,
} from '../../forms/schema.js';
import { getSubmission } from '../../forms/submissions.js';
import { submitForm } from '../../forms/submit.js';
import { signRenderToken, verifyDownload, verifyEntryKey } from '../../forms/tokens.js';
import { assignVariant } from '../../forms/variants.js';
import { keyedHash } from '../../ip-hash.js';
import { isIdentified } from '../../repos/contacts.js';
import { getForm, getFormVersion, listForms } from '../../repos/forms.js';
import { webhookOptionsFor } from '../../webhook-guard.js';
import type { RequestContext } from '../context.js';
import { requireHuman } from '../human-check.js';
import { cookieHeader, VISITOR_COOKIE } from '../identity.js';
import { absoluteBlockMedia, publicBaseFor } from '../public-urls.js';
import { json, noContent, oneOf, type Router, readJson } from '../router.js';

export function formsPublicRoutes(router: Router<RequestContext>): Router<RequestContext> {
  router.get('/forms/display', async ({ query, context }) => {
    await enforce(context, `forms-display:${context.visitorKey()}`, 120, 60);
    const contactId = context.peekContactId();
    const visit = visitFromQuery(
      query,
      { contactId, identified: await isIdentified(context.db, contactId) },
      now(context),
    );
    const live = (await listForms(context.db)).filter((f) => f.enabled);
    const forms = await formsForVisit(context.db, live, visit);
    const visitor = visitorOf(context, query.get('visitor'));
    return json({
      items: forms.map((form) => {
        const variant = assignVariant(form.definition, form.id, visitor);
        return {
          form: publicFormFor(context, form, variant),
          variant,
          placement: form.definition.placements.display,
        };
      }),
    });
  });

  router.post('/forms/:id/render', async ({ params, context }) => {
    const body = await readJson<{
      placement?: unknown;
      page?: unknown;
      visitor?: unknown;
      session?: unknown;
      manual?: unknown;
      entryKey?: unknown;
    }>(context.request);
    const placement = oneOf(body.placement ?? 'inline', FORM_PLACEMENTS, 'placement');
    await enforce(context, `forms-render:${context.visitorKey()}`, 120, 60);
    const form = await liveForm(context, params.id!);
    const page = pageFrom(body.page);
    const triggered = isTriggered(placement) && body.manual !== true;

    // A trigger's claim is counted per contact (frequency, the cap), so it
    // needs one; an embed does not, and does not make one.
    const contactId = triggered ? await context.contactId() : context.peekContactId();
    const query = new URLSearchParams({ path: page.path ?? '/' });
    if (page.referrer) query.set('referrer', page.referrer);
    for (const key of UTM_KEYS) if (page.utm[key]) query.set(`utm_${key}`, page.utm[key]!);
    if (typeof body.page === 'object' && body.page) {
      const extra = body.page as { device?: unknown; lang?: unknown };
      if (typeof extra.device === 'string') query.set('device', extra.device);
      if (typeof extra.lang === 'string') query.set('lang', extra.lang);
    }
    const visit = visitFromQuery(
      query,
      { contactId, identified: await isIdentified(context.db, contactId) },
      now(context),
    );
    const claim = await claimForm(context.db, form, placement, visit, {
      engage: context.settings.engage,
      sessionId: shortText(body.session, 80),
      url: page.path,
      manual: body.manual === true,
    });
    if (contactId && triggered) setVisitorCookie(context, contactId);
    if (!claim.shown) return json({ shown: false, reason: claim.reason });

    const visitor = visitorOf(context, body.visitor);
    const variant = assignVariant(form.definition, form.id, visitor);
    // An embed of a two-step form draws its button, not the form: the form
    // (and its view, and its token) comes when the button is pressed.
    const placements = form.definition.placements;
    if (placement === 'inline' && placements.twoStep.enabled) {
      return json({
        shown: false,
        reason: 'two_step',
        form: publicFormFor(context, form, variant),
      });
    }
    if (placement === 'inline' && !placements.inline) {
      return json({ shown: false, reason: 'unavailable' });
    }
    await recordView(context.db, {
      formId: form.id,
      variant,
      placement,
      page: page.path ?? '/',
      // Keyed, like every stored IP hash: the visitor can be an address.
      visitor: await keyedHash(context.db, `${form.id}:${visitor}`),
      now: visit.now,
    });
    const token = await signRenderToken(context.db, {
      formId: form.id,
      version: form.version,
      variant,
      placement,
      page: page.path ?? '/',
      issuedAt: visit.now.getTime(),
    });
    return json({
      shown: true,
      form: publicFormFor(context, form, variant),
      variant,
      placement,
      token,
      state: await visitorState(context, form, contactId, body.entryKey),
    });
  });

  router.post('/forms/:id/submit', async ({ params, context }) => {
    const body = await readJson<{
      token?: unknown;
      answers?: unknown;
      honeypot?: unknown;
      website?: unknown;
      turnstileToken?: unknown;
      page?: unknown;
      ref?: unknown;
    }>(context.request);
    // A hard ceiling per browser across every form; each form has its own, softer, limits.
    await enforce(context, `forms-submit:${context.visitorKey()}`, 30, 60);
    const form = await liveForm(context, params.id!);
    // The bot check, when it is on: before anything is stored.
    const turnstilePassed = await requireHuman(body.turnstileToken, context);
    const outcome = await submitForm(
      {
        db: context.db,
        settings: context.settings,
        support: context.config.support,
        contactId: context.peekContactId(),
        ip: context.clientIp(),
        turnstilePassed,
        resolveMx: context.config.forms?.resolveMx,
        now: now(context),
        onError: (error) => console.warn('helpwell: a form hook could not be queued.', error),
        webhooks: webhookOptionsFor(context.config),
      },
      form,
      {
        token: body.token,
        answers: body.answers,
        honeypot: body.honeypot ?? body.website,
        page: pageFrom(body.page),
        ref: typeof body.ref === 'string' ? body.ref.trim().slice(0, 20) : null,
      },
    );
    if (outcome.cookieContactId) setVisitorCookie(context, outcome.cookieContactId);
    return json(outcome.response, { status: 201 });
  });

  router.post('/forms/:id/dismiss', async ({ params, context }) => {
    const body = await readJson<{ url?: unknown }>(context.request);
    await enforce(context, `forms-dismiss:${context.visitorKey()}`, 60, 60);
    const contactId = context.peekContactId();
    const form = await getForm(context.db, params.id!);
    if (!form) throw new HelpWellError('not_found', `No form ${params.id}`);
    if (contactId) {
      await recordFormOutcome(context.db, {
        formId: form.id,
        contactId,
        state: 'dismissed',
        url: shortText(body.url, 2000),
      });
    }
    return noContent();
  });

  router.post('/forms/:id/giveaway/action', async ({ params, context }) => {
    const body = await readJson<{ entryKey?: unknown; actionId?: unknown }>(context.request);
    await enforce(context, `forms-action:${context.visitorKey()}`, 30, 60);
    const form = await liveForm(context, params.id!);
    const entryId = await verifyEntryKey(context.db, body.entryKey);
    if (!entryId) {
      throw new HelpWellError('forbidden', 'Giveaway action without a valid entry key', {
        publicMessage: 'Enter the giveaway first.',
      });
    }
    const entry = await claimBonusAction(context.db, form, entryId, String(body.actionId ?? ''));
    return json({ giveaway: await entryState(context.db, form, entry) });
  });

  router.get('/forms/:id/download/:submission', async ({ params, query, context }) => {
    await enforce(context, `forms-download:${context.visitorKey()}`, 60, 60);
    const form = await getForm(context.db, params.id!);
    if (!form) throw new HelpWellError('not_found', `No form ${params.id}`);
    const check = await verifyDownload(
      context.db,
      {
        formId: form.id,
        submissionId: params.submission!,
        exp: query.get('exp'),
        sig: query.get('sig'),
      },
      now(context).getTime(),
    );
    if (check !== 'ok') {
      throw new HelpWellError(
        check === 'expired' ? 'forbidden' : 'not_found',
        `Download link ${check}`,
        {
          publicMessage:
            check === 'expired'
              ? 'This download link has expired. Fill in the form again for a fresh one.'
              : 'That download link is not valid.',
        },
      );
    }
    const submission = await getSubmission(context.db, params.submission!);
    if (!submission || submission.formId !== form.id || submission.status === 'rejected') {
      throw new HelpWellError('not_found', 'No such submission');
    }
    const drawn = await getFormVersion(context.db, form.id, submission.formVersion);
    const definition = drawn?.definition ?? form.definition;
    // An uploaded file is handed over here, and only here: it has no address of its own.
    if (FORM_FILE_REF.test(definition.success.download.url)) {
      return uploadedFile(context, definition.success.download);
    }
    const target = downloadTarget(definition, context.request.url);
    if (!target) throw new HelpWellError('not_found', 'This form has no download');
    return new Response(null, {
      status: 302,
      headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  });

  return router;
}

/**
 * Whether any live form is shown by a trigger. `/config` carries it, so the
 * widget on a site with none never asks `/forms/display` on each page.
 * Never throws: before this install's forms table exists, it is just false.
 */
export async function hasTriggeredForms(db: RequestContext['db']): Promise<boolean> {
  try {
    const rows = rowsOf<{ id: string }>(
      await db.execute(sql`
        SELECT id FROM helpwell.forms
        WHERE enabled AND archived_at IS NULL
          AND coalesce(definition->'placements'->>'display', 'none') <> 'none'
        LIMIT 1
      `),
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- helpers */

/**
 * The form as the page draws it, in the variant this visitor sees, with its
 * picture as an absolute URL: an embed on the customer's site loads it from
 * this API, not from the customer's page.
 */
function publicFormFor(context: RequestContext, form: Form, variant: string) {
  return absoluteBlockMedia(
    publicForm(form, withVariant(form.definition, variant)),
    publicBaseFor(context),
  );
}

function now(context: RequestContext): Date {
  return context.config.now?.() ?? new Date();
}

async function liveForm(context: RequestContext, id: string): Promise<Form> {
  const form = await getForm(context.db, id);
  if (!form?.enabled || form.archivedAt) {
    throw new HelpWellError('not_found', `No live form ${id}`, {
      publicMessage: 'This form is not available.',
    });
  }
  return form;
}

/**
 * Who this browser is, for splitting traffic between variants and counting
 * unique views: the widget's own random id first (it outlives a visitor
 * cookie being issued mid-visit), then the cookie, then the address.
 */
function visitorOf(context: RequestContext, sent: unknown): string {
  if (typeof sent === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(sent)) return `b:${sent}`;
  const contactId = context.peekContactId();
  if (contactId) return `c:${contactId}`;
  return `ip:${context.clientIp() ?? 'unknown'}`;
}

/** What the page says about where it is. Nothing here is trusted beyond being short. */
function pageFrom(value: unknown): VisitDetails {
  const page = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const url = shortText(page.url, 2000);
  let path = shortText(page.path, 2000);
  if (!path && url) {
    try {
      path = new URL(url).pathname;
    } catch {
      path = null;
    }
  }
  const utm: Partial<Record<UtmKey, string>> = {};
  const raw = page.utm && typeof page.utm === 'object' ? (page.utm as Record<string, unknown>) : {};
  for (const key of UTM_KEYS) {
    const value = shortText(raw[key], 200);
    if (value) utm[key] = value;
  }
  return {
    url,
    path: path ? (path.startsWith('/') ? path : `/${path}`) : null,
    referrer: shortText(page.referrer, 2000),
    utm,
  };
}

/** Whether this visitor already submitted, and their giveaway entry, for an embed to show. */
async function visitorState(
  context: RequestContext,
  form: Form,
  contactId: string | null,
  entryKey: unknown,
) {
  const submitted = (await submittedForms(context.db, contactId)).has(form.id);
  let entry =
    form.definition.type === 'giveaway' && contactId
      ? await findEntry(context.db, form.id, { contactId })
      : null;
  if (!entry && form.definition.type === 'giveaway') {
    const id = await verifyEntryKey(context.db, entryKey);
    const found = id ? await getEntry(context.db, id) : null;
    entry = found && found.formId === form.id ? found : null;
  }
  return {
    submitted: submitted || entry !== null,
    giveaway: entry ? await entryState(context.db, form, entry) : null,
  };
}

/** An uploaded lead magnet, as an attachment named after the link's words. */
async function uploadedFile(
  context: RequestContext,
  download: Form['definition']['success']['download'],
): Promise<Response> {
  const config = context.config;
  const file = await readFormFile(download.url, {
    content: config.media === false ? null : (config.content ?? null),
    docsDir: resolveMediaDirs(config.media).docs,
  });
  if (!file) {
    throw new HelpWellError('not_found', 'The uploaded file is missing', {
      publicMessage: 'This file is not available any more.',
    });
  }
  const base =
    (download.label || 'download')
      .replace(/[^\w .-]+/g, '')
      .trim()
      .slice(0, 60) || 'download';
  const filename = `${base}.${file.name.split('.').pop()}`;
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      'content-type': file.type,
      'content-length': String(file.bytes.length),
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

/** The file a download link leads to, as it was when they submitted. */
function downloadTarget(definition: Form['definition'], requestUrl: string): string | null {
  const url = definition.success.download.url;
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) {
    try {
      return new URL(url, requestUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

async function enforce(
  context: RequestContext,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await rateLimit(context.db, bucket, limit, windowSeconds * 1000);
  if (!result.allowed) {
    throw new HelpWellError('rate_limited', `Rate limit hit on ${bucket}`, {
      publicMessage: 'That is a bit too fast. Try again shortly.',
      details: { resetAt: result.resetAt.toISOString() },
    });
  }
}

function setVisitorCookie(context: RequestContext, contactId: string): void {
  const kept = context.cookies.filter((c) => !c.startsWith(`${VISITOR_COOKIE}=`));
  context.cookies.length = 0;
  let secure = true;
  try {
    secure = new URL(context.request.url).protocol === 'https:';
  } catch {
    // An unparseable URL is treated as https: the safer cookie.
  }
  context.cookies.push(
    ...kept,
    cookieHeader(VISITOR_COOKIE, contactId, { secure: context.config.secureCookies ?? secure }),
  );
}
