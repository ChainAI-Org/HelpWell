/**
 * Proactive items over HTTP: what the widget pulls, and what it reports back.
 *
 *   GET  /proactive?path=&anon=     what a support extension wants this visitor to see now
 *   POST /proactive/:id/events      seen, clicked or dismissed
 *   POST /proactive/:id/show        claim an engagement item under the global engage cap
 *
 * Only with an extension that implements `proactive`; without one, the list
 * is always empty and the widget never asks (`/config` says so). The list is
 * cached per visitor and page for a few seconds, so a page that reloads in a
 * loop does not become a request to the extension each time.
 *
 * The widget sends what `GET /engage` is sent about the visit (referrer,
 * UTM, device and language), and the extension is told it, so it can aim as
 * Settings engagements do. The answer carries `fields`: the values of the
 * `{{field}}` placeholders its items use, for a visitor the host app
 * identified (engage/personalize.ts).
 *
 * A visitor with no contact yet gets one the first time there is something
 * to show them, because what was shown has to be recorded against someone.
 * Every event and claim is checked against that record: an id this visitor
 * was never shown is a 404, so nobody can report clicks on someone else's
 * messages. Engagement items can also be claimed and reported through the
 * engage routes, under their `proactive:<id>` name, which is how the widget's
 * one engage controller does it (routes/engage.ts).
 */

import { rateLimit } from '../../agent/guards.js';
import { personalFields, placeholderKeys } from '../../engage/personalize.js';
import { visitFromQuery } from '../../engage/targeting.js';
import { HelpWellError } from '../../errors.js';
import { isIdentified } from '../../repos/contacts.js';
import type { RequestContext } from '../context.js';
import { cookieHeader, VISITOR_COOKIE } from '../identity.js';
import {
  ANONYMOUS_ID,
  type CleanProactiveItem,
  claimProactiveEngagement,
  cleanProactiveItems,
  finishedItems,
  markDelivery,
  PROACTIVE_ID,
  publicProactiveItem,
  recordDeliveries,
} from '../proactive.js';
import { json, noContent, oneOf, type Router, readJson } from '../router.js';
import type { ProactiveContext, ProactiveEvent } from '../support-extension.js';

const EVENTS = ['seen', 'clicked', 'dismissed'] as const;
/** How long one visitor's list for one page is reused. */
const CACHE_MS = 15_000;
const CACHE_ENTRIES = 2_000;

export function proactiveRoutes(router: Router<RequestContext>): Router<RequestContext> {
  // One cache per handler, never shared between two installs in one process.
  const cache = new Map<string, { at: number; items: CleanProactiveItem[] }>();

  router.get('/proactive', async ({ query, context }) => {
    const support = context.config.support;
    if (!support?.proactive) return json({ items: [] });

    await enforce(context, `proactive:${context.visitorKey()}`, 60, 60);
    const contactId = context.peekContactId();
    const identified = await isIdentified(context.db, contactId);
    const visit = visitFromQuery(query, { contactId, identified }, now(context));
    const asked: ProactiveContext = {
      contactId,
      anonymousId: anonymousIdFrom(query.get('anon'), contactId),
      path: pathFrom(query.get('path')),
      identified,
      device: visit.device,
      referrer: visit.referrer,
      utm: {
        ...(visit.utm.source ? { source: visit.utm.source } : {}),
        ...(visit.utm.medium ? { medium: visit.utm.medium } : {}),
        ...(visit.utm.campaign ? { campaign: visit.utm.campaign } : {}),
      },
      locale: visit.language,
    };

    const key = JSON.stringify([
      contactId,
      asked.anonymousId,
      identified,
      asked.path,
      asked.device,
      asked.referrer,
      asked.utm,
      asked.locale,
    ]);
    const at = Date.now();
    let items = cache.get(key);
    if (!items || at - items.at > CACHE_MS) {
      const raw = await support.proactive(asked);
      const engage = context.settings.engage;
      items = {
        at,
        items: cleanProactiveItems(raw, {
          engage: engage.enabled,
          tours: new Set(engage.engagements.filter((e) => e.kind === 'tour').map((e) => e.id)),
        }),
      };
      cache.delete(key);
      cache.set(key, items);
      if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    }

    let shown = items.items;
    if (shown.length > 0 && contactId) {
      const finished = await finishedItems(
        context.db,
        contactId,
        shown.map((item) => item.id),
      );
      shown = shown.filter((item) => !finished.has(item.id));
    }
    if (shown.length === 0)
      return json({ items: [] }, { headers: { 'cache-control': 'no-store' } });

    // What is shown is recorded against a contact, so an anonymous visitor
    // gets one now. If that is refused (too many new visitors from one
    // address), there is simply nothing to show.
    let owner = contactId;
    if (!owner) {
      try {
        owner = await context.contactId();
      } catch {
        return json({ items: [] }, { headers: { 'cache-control': 'no-store' } });
      }
      setVisitorCookie(context, owner);
    }
    await recordDeliveries(context.db, owner, shown, now(context));

    const visible = shown.map(publicProactiveItem);
    const fields = await personalFields(context.db, owner, placeholderKeys(visible));
    return json(
      { items: visible, ...(Object.keys(fields).length > 0 ? { fields } : {}) },
      { headers: { 'cache-control': 'no-store' } },
    );
  });

  router.post('/proactive/:id/events', async ({ params, context }) => {
    const body = await readJson<{ event?: unknown; anon?: unknown }>(context.request);
    const event = oneOf(body.event, EVENTS, 'event');
    const id = itemId(params.id);
    await enforce(context, `proactive-event:${context.visitorKey()}`, 120, 60);

    const contactId = context.peekContactId();
    if (!contactId) throw notShown(id);
    const found = await reportProactiveEvent(context, contactId, id, event, body.anon);
    if (!found) throw notShown(id);
    return noContent();
  });

  router.post('/proactive/:id/show', async ({ params, context }) => {
    const body = await readJson<{
      session?: unknown;
      url?: unknown;
      step?: unknown;
      anon?: unknown;
    }>(context.request);
    const id = itemId(params.id);
    await enforce(context, `engage-show:${context.visitorKey()}`, 120, 60);

    const contactId = context.peekContactId();
    if (!contactId) throw notShown(id);
    const result = await showProactiveEngagement(context, contactId, id, body);
    if (!result) throw notShown(id);
    return json(result);
  });

  return router;
}

/* ---------------------------------------------------------------- shared */

/**
 * Claim an engagement item, and tell the extension it was seen the first
 * time it is. Null when this visitor was never sent it. Used by
 * `POST /proactive/:id/show` and by `POST /engage/proactive:<id>/show`.
 */
export async function showProactiveEngagement(
  context: RequestContext,
  contactId: string,
  id: string,
  body: { session?: unknown; url?: unknown; step?: unknown; anon?: unknown },
): Promise<{ shown: true } | { shown: false; reason: string } | null> {
  const step = typeof body.step === 'number' && Number.isInteger(body.step) ? body.step : 1;
  const result = await claimProactiveEngagement(context.db, context.settings.engage, {
    contactId,
    itemId: id,
    step,
    sessionId: typeof body.session === 'string' ? body.session.slice(0, 80) : null,
    url: typeof body.url === 'string' ? body.url.slice(0, 2000) : null,
    now: now(context),
  });
  if (!result) return null;
  if (!result.shown) return result;
  if (result.first) {
    await context.config.support?.proactiveEvent?.(id, 'seen', {
      contactId,
      anonymousId: anonymousIdFrom(body.anon, contactId),
    });
  }
  return { shown: true };
}

/**
 * Record what the visitor did with an item and, the first time, pass it on
 * to the extension. False when this visitor was never sent that item.
 */
export async function reportProactiveEvent(
  context: RequestContext,
  contactId: string,
  id: string,
  event: ProactiveEvent,
  anon: unknown,
): Promise<boolean> {
  const marked = await markDelivery(context.db, contactId, id, event, now(context));
  if (!marked.found) return false;
  if (marked.first) {
    await context.config.support?.proactiveEvent?.(id, event, {
      contactId,
      anonymousId: anonymousIdFrom(anon, contactId),
    });
  }
  return true;
}

/* ---------------------------------------------------------------- helpers */

function itemId(raw: string | undefined): string {
  const id = raw ?? '';
  if (!PROACTIVE_ID.test(id)) throw new HelpWellError('bad_request', 'Not a proactive item id');
  return id;
}

function notShown(id: string): HelpWellError {
  return new HelpWellError('not_found', `Proactive item ${id} was not shown to this visitor`);
}

/**
 * The widget's browser id when it sent a well-formed one; otherwise the
 * contact id, or a fresh random id for a visitor with neither.
 */
function anonymousIdFrom(raw: unknown, contactId: string | null): string {
  if (typeof raw === 'string' && ANONYMOUS_ID.test(raw)) return raw;
  return contactId ?? `anon_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** A path on the host's site, with its query; `/` when it is anything else. */
function pathFrom(raw: string | null): string {
  const value = (raw ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 1000);
}

function now(context: RequestContext): Date {
  return context.config.now?.() ?? new Date();
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
