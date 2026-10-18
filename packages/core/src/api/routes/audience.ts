/**
 * Admin routes for who your contacts are and what they did: server-side
 * contact updates, the field registry, tracked events, segments, and the
 * webhook delivery log.
 *
 * Registered from `adminRoutes`, so every route here sits behind the same
 * `requireAdmin` check (admin session or bearer token, same-origin writes).
 * Contact ids in paths accept either HelpWell's own id or the host app's user
 * id, because the host's server only knows the latter.
 */

import type { ConditionGroup } from '../../conditions/types.js';
import { HelpWellError } from '../../errors.js';
import { FIELD_TYPES, listFields, updateField } from '../../fields/index.js';
import {
  CONSENT_STATES,
  type ContactPatch,
  contactsCsv,
  getContact,
  type ListContactsOptions,
  resolveContactId,
  updateContact,
} from '../../repos/contacts.js';
import { eventCounts, eventName, listEvents, recordEvent } from '../../repos/events.js';
import {
  countSegment,
  createSegment,
  deleteSegment,
  getSegment,
  listSegments,
  segmentMembers,
  updateSegment,
  validateRules,
} from '../../segments/index.js';
import { webhookOptionsFor } from '../../webhook-guard.js';
import { listDeliveries, retryWebhooks, sendTestWebhook } from '../../webhooks.js';
import type { RequestContext } from '../context.js';
import { requireAdmin } from '../context.js';
import { dateParam, intParam, json, noContent, oneOf, type Router, readJson } from '../router.js';

const DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'retrying'] as const;

/**
 * The segment or ad-hoc conditions a contact list query asks for:
 * `?segment=seg_…` or `?conditions=<JSON>`. Used by `GET /admin/contacts` and
 * the CSV export so both filter the same way.
 */
export async function conditionsFromQuery(
  context: RequestContext,
  query: URLSearchParams,
): Promise<ConditionGroup | undefined> {
  const segmentId = query.get('segment');
  if (segmentId) {
    const segment = await getSegment(context.db, segmentId);
    if (!segment) throw new HelpWellError('not_found', 'No such segment');
    return segment.rules;
  }
  const raw = query.get('conditions');
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HelpWellError('bad_request', 'conditions must be JSON');
  }
  return validateRules(context.db, parsed);
}

/** The filters `GET /admin/contacts` and its CSV twin share. */
export async function contactListOptions(
  context: RequestContext,
  query: URLSearchParams,
): Promise<ListContactsOptions> {
  const identified = query.get('identified');
  return {
    search: query.get('q') ?? undefined,
    tag: query.get('tag') ?? undefined,
    identified: identified === null || identified === '' ? undefined : identified === 'true',
    conditions: await conditionsFromQuery(context, query),
  };
}

async function contactIdOr404(context: RequestContext, idOrExternalId: string): Promise<string> {
  const id = await resolveContactId(context.db, idOrExternalId);
  if (!id) throw new HelpWellError('not_found', 'No such contact');
  return id;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new HelpWellError('bad_request', `${name} must be an array of strings`);
  }
  return value.slice(0, 100);
}

/** `tags` as `["a", "b"]` (add these) or `{ add: [...], remove: [...] }`. */
function tagPatch(value: unknown): ContactPatch['tags'] {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return { add: stringList(value, 'tags') };
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      add: stringList(record.add, 'tags.add'),
      remove: stringList(record.remove, 'tags.remove'),
    };
  }
  throw new HelpWellError('bad_request', 'tags must be a list, or { add, remove }');
}

export function audienceRoutes(router: Router<RequestContext>): Router<RequestContext> {
  /* ------------------------------------------------------------ contacts */

  /**
   * Merge attributes, add or remove tags, record consent. An id HelpWell has
   * never seen is created as a contact from the host's user id (`upsert`
   * defaults to true; send `false` to get a 404 instead).
   */
  router.patch('/admin/contacts/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{
      attributes?: unknown;
      tags?: unknown;
      consent?: unknown;
      upsert?: unknown;
    }>(context.request);
    if (
      body.attributes !== undefined &&
      (typeof body.attributes !== 'object' ||
        body.attributes === null ||
        Array.isArray(body.attributes))
    ) {
      throw new HelpWellError('bad_request', 'attributes must be an object');
    }
    const result = await updateContact(
      context.db,
      params.id!,
      {
        attributes: body.attributes as Record<string, unknown> | undefined,
        tags: tagPatch(body.tags),
        consent:
          body.consent === undefined ? undefined : oneOf(body.consent, CONSENT_STATES, 'consent'),
      },
      { source: 'api', upsert: body.upsert !== false, now: context.config.now?.() },
    );
    if (!result) throw new HelpWellError('not_found', 'No such contact');
    return json(await getContact(context.db, result.contactId), {
      status: result.created ? 201 : 200,
    });
  });

  /** Every contact a list would show, as CSV with the source and consent labels (CT-09). */
  router.get('/admin/contacts.csv', async ({ query, context }) => {
    requireAdmin(context);
    const csv = await contactsCsv(context.db, await contactListOptions(context, query));
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="helpwell-contacts.csv"',
        'cache-control': 'no-store',
      },
    });
  });

  router.get('/admin/contacts/:id/events', async ({ params, query, context }) => {
    requireAdmin(context);
    const contactId = await contactIdOr404(context, params.id!);
    return json(
      await listEvents(context.db, {
        contactId,
        name: query.get('name') ?? undefined,
        cursor: query.get('cursor') ?? undefined,
        limit: intParam(query, 'limit', { default: 50, max: 200 }),
      }),
    );
  });

  /* -------------------------------------------------------------- fields */

  router.get('/admin/fields', async ({ query, context }) => {
    requireAdmin(context);
    return json({
      items: await listFields(context.db, { includeHidden: query.get('hidden') !== 'false' }),
    });
  });

  router.patch('/admin/fields/:key', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{
      label?: unknown;
      type?: unknown;
      hidden?: unknown;
      locked?: unknown;
    }>(context.request);
    if (body.label !== undefined && typeof body.label !== 'string') {
      throw new HelpWellError('bad_request', 'label must be text');
    }
    if (body.hidden !== undefined && typeof body.hidden !== 'boolean') {
      throw new HelpWellError('bad_request', 'hidden must be true or false');
    }
    if (body.locked !== undefined && body.locked !== false) {
      throw new HelpWellError('bad_request', 'locked can only be set to false (to unlock)');
    }
    const field = await updateField(context.db, params.key!, {
      label: body.label as string | undefined,
      type: body.type === undefined ? undefined : oneOf(body.type, FIELD_TYPES, 'type'),
      hidden: body.hidden as boolean | undefined,
      locked: body.locked as false | undefined,
    });
    if (!field) throw new HelpWellError('not_found', 'No such field');
    return json(field);
  });

  /* -------------------------------------------------------------- events */

  router.get('/admin/events', async ({ query, context }) => {
    requireAdmin(context);
    const contact = query.get('contactId');
    return json(
      await listEvents(context.db, {
        contactId: contact ? await contactIdOr404(context, contact) : undefined,
        name: query.get('name') ?? undefined,
        cursor: query.get('cursor') ?? undefined,
        limit: intParam(query, 'limit', { default: 50, max: 200 }),
      }),
    );
  });

  /** Each event name with how often it happened and to how many people. */
  router.get('/admin/events/counts', async ({ query, context }) => {
    requireAdmin(context);
    const contact = query.get('contactId');
    const days = query.get('days') ? intParam(query, 'days', { default: 30, max: 3650 }) : null;
    return json({
      items: await eventCounts(context.db, {
        contactId: contact ? await contactIdOr404(context, contact) : undefined,
        since: days
          ? new Date(Date.now() - days * 86_400_000)
          : (dateParam(query, 'since') ?? null),
      }),
    });
  });

  /**
   * Server-side `track`: the host app's backend reports something a person
   * did. `contact` is HelpWell's id or the host's user id; an unknown user id
   * becomes a contact, the same as `PATCH /admin/contacts/:id`.
   */
  router.post('/admin/events', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{
      contact?: unknown;
      contactId?: unknown;
      name?: unknown;
      props?: unknown;
      url?: unknown;
      at?: unknown;
    }>(context.request);
    const who = typeof body.contact === 'string' ? body.contact : body.contactId;
    if (typeof who !== 'string' || !who.trim()) {
      throw new HelpWellError('bad_request', 'An event needs a contact: an id or your user id');
    }
    const name = eventName(body.name);
    if (
      body.props !== undefined &&
      (typeof body.props !== 'object' || body.props === null || Array.isArray(body.props))
    ) {
      throw new HelpWellError('bad_request', 'props must be an object');
    }
    let at: Date | undefined;
    if (body.at !== undefined) {
      at = new Date(String(body.at));
      if (Number.isNaN(at.getTime()))
        throw new HelpWellError('bad_request', 'at must be an ISO 8601 date');
    }
    const contact = await updateContact(context.db, who, {}, { source: 'api', upsert: true });
    if (!contact) throw new HelpWellError('not_found', 'No such contact');
    const id = await recordEvent(context.db, {
      contactId: contact.contactId,
      name,
      props: body.props as Record<string, unknown> | undefined,
      url: typeof body.url === 'string' ? body.url : null,
      at,
    });
    return json({ id, contactId: contact.contactId }, { status: 201 });
  });

  /* ------------------------------------------------------------ segments */

  router.get('/admin/segments', async ({ context }) => {
    requireAdmin(context);
    return json({ items: await listSegments(context.db, { now: context.config.now?.() }) });
  });

  router.post('/admin/segments', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{ name?: unknown; description?: unknown; rules?: unknown }>(
      context.request,
    );
    const segment = await createSegment(context.db, {
      name: body.name as string,
      description: typeof body.description === 'string' ? body.description : null,
      rules: body.rules,
    });
    const count = await countSegment(context.db, segment.rules, { now: context.config.now?.() });
    return json({ ...segment, count }, { status: 201 });
  });

  /** How many contacts some rules would match, before anyone saves them. */
  router.post('/admin/segments/preview', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{ rules?: unknown }>(context.request);
    const rules = await validateRules(context.db, body.rules);
    return json({ count: await countSegment(context.db, rules, { now: context.config.now?.() }) });
  });

  router.get('/admin/segments/:id', async ({ params, context }) => {
    requireAdmin(context);
    const segment = await getSegment(context.db, params.id!);
    if (!segment) throw new HelpWellError('not_found', 'No such segment');
    const count = await countSegment(context.db, segment.rules, { now: context.config.now?.() });
    return json({ ...segment, count });
  });

  router.patch('/admin/segments/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ name?: unknown; description?: unknown; rules?: unknown }>(
      context.request,
    );
    const segment = await updateSegment(context.db, params.id!, {
      name: body.name === undefined ? undefined : (body.name as string),
      description: body.description === undefined ? undefined : (body.description as string | null),
      rules: body.rules,
    });
    if (!segment) throw new HelpWellError('not_found', 'No such segment');
    const count = await countSegment(context.db, segment.rules, { now: context.config.now?.() });
    return json({ ...segment, count });
  });

  router.delete('/admin/segments/:id', async ({ params, context }) => {
    requireAdmin(context);
    if (!(await deleteSegment(context.db, params.id!))) {
      throw new HelpWellError('not_found', 'No such segment');
    }
    return noContent();
  });

  router.get('/admin/segments/:id/count', async ({ params, context }) => {
    requireAdmin(context);
    const segment = await getSegment(context.db, params.id!);
    if (!segment) throw new HelpWellError('not_found', 'No such segment');
    return json({
      count: await countSegment(context.db, segment.rules, { now: context.config.now?.() }),
    });
  });

  router.get('/admin/segments/:id/members', async ({ params, query, context }) => {
    requireAdmin(context);
    const segment = await getSegment(context.db, params.id!);
    if (!segment) throw new HelpWellError('not_found', 'No such segment');
    return json(
      await segmentMembers(context.db, segment.rules, {
        cursor: query.get('cursor') ?? undefined,
        limit: intParam(query, 'limit', { default: 25, max: 100 }),
        now: context.config.now?.(),
      }),
    );
  });

  /* ------------------------------------------------------------ webhooks */

  router.get('/admin/webhooks/deliveries', async ({ query, context }) => {
    requireAdmin(context);
    const status = query.get('status');
    return json({
      items: await listDeliveries(context.db, {
        status: status ? oneOf(status, DELIVERY_STATUSES, 'status') : undefined,
        limit: intParam(query, 'limit', { default: 50, max: 200 }),
      }),
    });
  });

  /** Retry failed deliveries that are due, or every one with tries left when `force` is set. */
  router.post('/admin/webhooks/retry', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{ force?: unknown; limit?: unknown }>(context.request);
    return json(
      await retryWebhooks(context.db, context.settings, {
        ...webhookOptionsFor(context.config),
        force: body.force === true,
        limit: typeof body.limit === 'number' ? body.limit : undefined,
      }),
    );
  });

  /** A `webhook.test` event to every active webhook, or the one at `url`. */
  router.post('/admin/webhooks/test', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{ url?: unknown }>(context.request);
    const items = await sendTestWebhook(context.db, context.settings, {
      ...webhookOptionsFor(context.config),
      url: typeof body.url === 'string' ? body.url : undefined,
    });
    if (items.length === 0) {
      throw new HelpWellError('not_found', 'No active webhook to test', {
        publicMessage: 'Add a webhook first, then send a test.',
      });
    }
    return json({ items });
  });

  return router;
}
