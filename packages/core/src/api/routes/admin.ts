/**
 * Admin routes: the dashboard.
 *
 * Every route here calls requireAdmin first, which also refuses state changes
 * from another site. HelpWell ships no login screen — the host app decides
 * who is an admin (DX-08) — so the whole surface is one `isAdmin` callback
 * away from being locked.
 */

import { sql } from 'drizzle-orm';
import { listGaps, setGapStatus } from '../../agent/gaps.js';
import { pruneRateCounters, spendStatus } from '../../agent/guards.js';
import { rowsOf } from '../../db/rows.js';
import { blockedAttempts, contacts, evalRuns } from '../../db/schema.js';
import { HelpWellError } from '../../errors.js';
import type { ChangelogInput } from '../../repos/changelog.js';
import {
  CHANGELOG_STATUSES,
  createChangelogEntry,
  deleteChangelogEntry,
  getChangelogEntry,
  listChangelog,
  updateChangelogEntry,
} from '../../repos/changelog.js';
import {
  addContactTag,
  deleteContact,
  exportContact,
  getContact,
  listContacts,
  removeContactTag,
  resolveContactId,
} from '../../repos/contacts.js';
import {
  addTag,
  conversationOwner,
  getConversation,
  listConversations,
  markReviewed,
  pruneConversations,
  removeTag,
  setConversationStatus,
  setTopic,
} from '../../repos/conversations.js';
import { engagementStats, npsSummary } from '../../repos/engage.js';
import type { DateRange } from '../../repos/reports.js';
import { dailySeries, rangeFor, reportBundle, seriesToCsv } from '../../repos/reports.js';
import {
  deleteRoadmapItem,
  getRoadmap,
  ROADMAP_STATUSES,
  setRoadmapStatus,
  updateRoadmapItem,
} from '../../repos/roadmap.js';
import { searchArticles } from '../../search/search.js';
import { webhookOptionsFor } from '../../webhook-guard.js';
import type { RequestContext } from '../context.js';
import { requireAdmin } from '../context.js';
import { dateParam, intParam, json, noContent, oneOf, type Router, readJson } from '../router.js';
import { agentQualityRoutes } from './agent-quality.js';
import { audienceRoutes, contactListOptions } from './audience.js';
import { formsAdminRoutes } from './forms-admin.js';
import { modelRoutes } from './models.js';

const CONVERSATION_STATUSES = ['resolved', 'unresolved'] as const;
const GAP_STATUSES = ['new', 'drafted', 'dismissed'] as const;
const RANGE_PRESETS = ['7d', '30d', '90d', 'today', 'all'] as const;

export function adminRoutes(router: Router<RequestContext>): Router<RequestContext> {
  /* -------------------------------------------------------- conversations */

  router.get('/admin/conversations', async ({ query, context }) => {
    requireAdmin(context);
    const status = query.get('status');
    return json(
      await listConversations(context.db, {
        status: status ? oneOf(status, CONVERSATION_STATUSES, 'status') : undefined,
        topic: query.get('topic') ?? undefined,
        search: query.get('q') ?? undefined,
        contactId: query.get('contactId') ?? undefined,
        cursor: query.get('cursor') ?? undefined,
        limit: intParam(query, 'limit', { default: 25, max: 100 }),
      }),
    );
  });

  router.get('/admin/conversations/:id', async ({ params, context }) => {
    requireAdmin(context);
    const conversation = await getConversation(context.db, params.id!);
    if (!conversation) throw new HelpWellError('not_found', 'No such conversation');
    return json(conversation);
  });

  router.patch('/admin/conversations/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ status?: unknown; topic?: string | null; reviewed?: unknown }>(
      context.request,
    );
    if (!(await conversationOwner(context.db, params.id!))) {
      throw new HelpWellError('not_found', 'No such conversation');
    }

    if (body.status !== undefined) {
      await setConversationStatus(
        context.db,
        params.id!,
        oneOf(body.status, CONVERSATION_STATUSES, 'status'),
      );
    }
    if (body.topic !== undefined) {
      await setTopic(
        context.db,
        params.id!,
        body.topic === null ? null : String(body.topic).slice(0, 80),
      );
    }
    if (body.reviewed !== undefined) {
      await markReviewed(context.db, params.id!, Boolean(body.reviewed));
    }

    return json(await getConversation(context.db, params.id!));
  });

  router.post('/admin/conversations/:id/tags', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ tag?: string }>(context.request);
    if (!body.tag?.trim()) throw new HelpWellError('bad_request', 'A tag needs a value');
    if (!(await conversationOwner(context.db, params.id!))) {
      throw new HelpWellError('not_found', 'No such conversation');
    }
    await addTag(context.db, params.id!, body.tag.slice(0, 60), 'human');
    return noContent();
  });

  router.delete('/admin/conversations/:id/tags/:tag', async ({ params, context }) => {
    requireAdmin(context);
    await removeTag(context.db, params.id!, params.tag!);
    return noContent();
  });

  /* --------------------------------------------------------------- gaps */

  router.get('/admin/gaps', async ({ query, context }) => {
    requireAdmin(context);
    const status = query.get('status');
    return json({
      items: await listGaps(context.db, {
        status: status ? oneOf(status, GAP_STATUSES, 'status') : undefined,
        limit: intParam(query, 'limit', { default: 50, max: 200 }),
      }),
    });
  });

  router.patch('/admin/gaps/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ status?: unknown; articleSlug?: string }>(context.request);
    const status = oneOf(body.status, GAP_STATUSES, 'status');
    await setGapStatus(context.db, params.id!, status, body.articleSlug);
    return noContent();
  });

  /* ------------------------------------------------------------ contacts */

  router.get('/admin/contacts', async ({ query, context }) => {
    requireAdmin(context);
    // `segment` and `conditions` filter too; see routes/audience.ts.
    return json(
      await listContacts(context.db, {
        ...(await contactListOptions(context, query)),
        cursor: query.get('cursor') ?? undefined,
        limit: intParam(query, 'limit', { default: 25, max: 100 }),
      }),
    );
  });

  router.get('/admin/contacts/:id', async ({ params, context }) => {
    requireAdmin(context);
    // Your own user id works as well as HelpWell's.
    const id = (await resolveContactId(context.db, params.id!)) ?? params.id!;
    const contact = await getContact(context.db, id);
    if (!contact) throw new HelpWellError('not_found', 'No such contact');
    return json(contact);
  });

  router.post('/admin/contacts/:id/tags', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ tag?: string }>(context.request);
    if (!body.tag?.trim()) throw new HelpWellError('bad_request', 'A tag needs a value');
    await assertContact(context, params.id!);
    await addContactTag(context.db, params.id!, body.tag.slice(0, 60));
    return noContent();
  });

  router.delete('/admin/contacts/:id/tags/:tag', async ({ params, context }) => {
    requireAdmin(context);
    await removeContactTag(context.db, params.id!, params.tag!);
    return noContent();
  });

  router.get('/admin/contacts/:id/export', async ({ params, context }) => {
    requireAdmin(context);
    const data = await exportContact(context.db, params.id!);
    if (!data) throw new HelpWellError('not_found', 'No such contact');
    return json(data, {
      headers: { 'content-disposition': `attachment; filename="${params.id}.json"` },
    });
  });

  router.delete('/admin/contacts/:id', async ({ params, context }) => {
    requireAdmin(context);
    const deleted = await deleteContact(context.db, params.id!);
    if (!deleted) throw new HelpWellError('not_found', 'No such contact');
    return noContent();
  });

  /* ------------------------------------------------------------- articles */

  /** The dashboard's article list includes drafts; the public one never does. */
  router.get('/admin/articles', async ({ query, context }) => {
    requireAdmin(context);
    const q = query.get('q')?.trim();
    if (q) {
      return json({
        items: await searchArticles(context.db, q, { includeDrafts: true, limit: 50 }),
      });
    }
    const result = await context.db.execute(sql`
      SELECT slug, title, description, collection, status, reading_minutes, updated_at,
             (embedding IS NOT NULL) AS embedded
      FROM helpwell.article_index
      ORDER BY collection, order_index, title
    `);
    return json({ items: rowsOf(result) });
  });

  /* ------------------------------------------------------------ changelog */

  router.get('/admin/changelog', async ({ query, context }) => {
    requireAdmin(context);
    const cursor = dateParam(query, 'cursor');
    return json(
      await listChangelog(context.db, {
        includeUnpublished: true,
        limit: intParam(query, 'limit', { default: 25, max: 50 }),
        cursor: cursor?.toISOString(),
      }),
    );
  });

  router.get('/admin/changelog/:id', async ({ params, context }) => {
    requireAdmin(context);
    const entry = await getChangelogEntry(context.db, params.id!, { includeUnpublished: true });
    if (!entry) throw new HelpWellError('not_found', 'No such entry');
    return json(entry);
  });

  router.post('/admin/changelog', async ({ context }) => {
    requireAdmin(context);
    const body = changelogInput(await readJson<Record<string, unknown>>(context.request));
    if (!body.title) throw new HelpWellError('bad_request', 'A changelog entry needs a title');
    const id = await createChangelogEntry(context.db, body as ChangelogInput, {
      webhooks: webhookOptionsFor(context.config),
    });
    return json({ id }, { status: 201 });
  });

  router.patch('/admin/changelog/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = changelogInput(await readJson<Record<string, unknown>>(context.request));
    const ok = await updateChangelogEntry(context.db, params.id!, body, {
      webhooks: webhookOptionsFor(context.config),
    });
    if (!ok) throw new HelpWellError('not_found', 'No such entry');
    return json(await getChangelogEntry(context.db, params.id!, { includeUnpublished: true }));
  });

  router.delete('/admin/changelog/:id', async ({ params, context }) => {
    requireAdmin(context);
    const ok = await deleteChangelogEntry(context.db, params.id!);
    if (!ok) throw new HelpWellError('not_found', 'No such entry');
    return noContent();
  });

  /* -------------------------------------------------------------- roadmap */

  router.get('/admin/roadmap', async ({ context }) => {
    requireAdmin(context);
    return json(await getRoadmap(context.db, { limitPerColumn: 200 }));
  });

  router.patch('/admin/roadmap/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{
      status?: unknown;
      title?: string;
      body?: string | null;
      changelogEntryId?: string | null;
    }>(context.request);

    let found = false;
    if (body.title !== undefined || body.body !== undefined) {
      if (body.title !== undefined && !body.title.trim()) {
        throw new HelpWellError('bad_request', 'A roadmap item needs a title');
      }
      found = await updateRoadmapItem(context.db, params.id!, {
        title: body.title?.slice(0, 140),
        body: body.body,
      });
    }
    if (body.status !== undefined) {
      found =
        (await setRoadmapStatus(
          context.db,
          params.id!,
          oneOf(body.status, ROADMAP_STATUSES, 'status'),
          {
            changelogEntryId: body.changelogEntryId,
          },
        )) || found;
    }
    if (!found) throw new HelpWellError('not_found', 'No such item');
    return noContent();
  });

  router.delete('/admin/roadmap/:id', async ({ params, context }) => {
    requireAdmin(context);
    const ok = await deleteRoadmapItem(context.db, params.id!);
    if (!ok) throw new HelpWellError('not_found', 'No such item');
    return noContent();
  });

  /* -------------------------------------------------------------- reports */

  router.get('/admin/reports', async ({ query, context }) => {
    requireAdmin(context);
    return json(await reportBundle(context.db, rangeFromQuery(query)));
  });

  router.get('/admin/reports/export', async ({ query, context }) => {
    requireAdmin(context);
    const csv = seriesToCsv(await dailySeries(context.db, rangeFromQuery(query)));
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="helpwell-report.csv"',
        'cache-control': 'no-store',
      },
    });
  });

  router.get('/admin/reports/engage', async ({ query, context }) => {
    requireAdmin(context);
    const range = rangeFromQuery(query);
    const surveyId = query.get('surveyId');
    return json({
      engagements: await engagementStats(context.db, range.from),
      nps: surveyId ? await npsSummary(context.db, surveyId, range.from) : null,
    });
  });

  /* ---------------------------------------------------------------- spend */

  router.get('/admin/spend', async ({ context }) => {
    requireAdmin(context);
    return json(await spendStatus(context.db, context.settings.agent.spend));
  });

  router.get('/admin/blocked', async ({ context }) => {
    requireAdmin(context);
    const rows = await context.db
      .select()
      .from(blockedAttempts)
      .orderBy(sql`created_at DESC`)
      .limit(100);
    return json({ items: rows });
  });

  /* -------------------------------------------------------------- settings */

  router.get('/admin/settings', async ({ context }) => {
    requireAdmin(context);
    return json(context.settings);
  });

  router.patch('/admin/settings', async ({ context }) => {
    requireAdmin(context);
    const patch = await readJson<unknown>(context.request);
    try {
      return json(await context.settingsStore.update(patch));
    } catch (cause) {
      throw new HelpWellError('bad_request', 'Settings did not validate', {
        publicMessage: 'Those settings are not valid.',
        details: { cause: String(cause) },
        cause,
      });
    }
  });

  /* ----------------------------------------------------------------- evals */

  router.get('/admin/evals', async ({ context }) => {
    requireAdmin(context);
    const rows = await context.db.select().from(evalRuns).orderBy(sql`created_at DESC`).limit(20);
    return json({ items: rows });
  });

  router.get('/admin/evals/:id', async ({ params, context }) => {
    requireAdmin(context);
    const [row] = await context.db.select().from(evalRuns).where(sql`id = ${params.id}`).limit(1);
    if (!row) throw new HelpWellError('not_found', 'No such eval run');
    return json(row);
  });

  /* ----------------------------------------------------------- maintenance */

  /** Retention sweep and counter housekeeping (CT-10). Safe to call daily. */
  router.post('/admin/maintenance', async ({ context }) => {
    requireAdmin(context);
    const [conversationsPruned, countersPruned] = await Promise.all([
      pruneConversations(context.db, context.settings.data.retentionMonths),
      pruneRateCounters(context.db),
    ]);
    return json({ conversationsPruned, countersPruned });
  });

  // POST /admin/evals/run and POST /admin/gaps/:id/draft.
  agentQualityRoutes(router);
  // Contact updates, fields, events, segments and the webhook log.
  audienceRoutes(router);
  // Forms, versions, analytics, submissions and giveaways: routes/forms-admin.ts.
  formsAdminRoutes(router);
  // OpenRouter's live model list, for the model picker: routes/models.ts.
  modelRoutes(router);

  return router;
}

/* ---------------------------------------------------------------- helpers */

async function assertContact(context: RequestContext, id: string): Promise<void> {
  const rows = await context.db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`id = ${id} AND deleted_at IS NULL`)
    .limit(1);
  if (rows.length === 0) throw new HelpWellError('not_found', 'No such contact');
}

/**
 * A changelog body as JSON can only carry `publishedAt` as a string; the repo
 * wants a Date. Everything else is checked here so a typo is a 400 rather
 * than a constraint violation.
 */
function changelogInput(body: Record<string, unknown>): Partial<ChangelogInput> {
  const out: Partial<ChangelogInput> = {};
  if (body.version !== undefined)
    out.version = body.version === null ? null : String(body.version).slice(0, 40);
  if (body.title !== undefined) out.title = String(body.title).trim().slice(0, 200);
  if (body.summary !== undefined)
    out.summary = body.summary === null ? null : String(body.summary).slice(0, 500);
  if (body.body !== undefined) out.body = String(body.body);
  if (body.coverUrl !== undefined)
    out.coverUrl = body.coverUrl === null ? null : String(body.coverUrl).slice(0, 2000);
  if (body.sourceRef !== undefined)
    out.sourceRef = body.sourceRef === null ? null : String(body.sourceRef).slice(0, 200);
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
      throw new HelpWellError('bad_request', 'tags must be an array of strings');
    }
    out.tags = body.tags.map((t) => t.slice(0, 40));
  }
  if (body.status !== undefined) out.status = oneOf(body.status, CHANGELOG_STATUSES, 'status');
  if (body.publishedAt !== undefined) {
    if (body.publishedAt === null) {
      out.publishedAt = null;
    } else {
      const date = new Date(String(body.publishedAt));
      if (Number.isNaN(date.getTime())) {
        throw new HelpWellError('bad_request', 'publishedAt must be an ISO 8601 date');
      }
      out.publishedAt = date;
    }
  }
  return out;
}

function rangeFromQuery(query: URLSearchParams): DateRange {
  const from = dateParam(query, 'from');
  const to = dateParam(query, 'to');
  if (from && to) {
    if (from > to) throw new HelpWellError('bad_request', 'from must be before to');
    return { from, to };
  }
  const preset = query.get('range');
  return rangeFor(preset ? oneOf(preset, RANGE_PRESETS, 'range') : '30d');
}
