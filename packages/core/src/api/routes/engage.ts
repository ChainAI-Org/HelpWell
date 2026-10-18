/**
 * Engage over HTTP: what the widget asks for, and what the dashboard reads.
 *
 * Public, for the widget (and the SDK):
 *   GET  /engage                    what this page view could show, highest priority first
 *   GET  /engage/:id                one engagement the page asked for by id
 *   POST /engage/:id/show           claim it: frequency and the global cap, then recorded as seen
 *   POST /engage/:id/impression     clicked, dismissed, completed, or a later tour step seen
 *   POST /surveys/:id/response      one answer to one question
 *
 * Admin:
 *   GET  /admin/engage/stats                 counts per engagement for a range
 *   GET  /admin/engage/:id/results           counts, tour drop-off, survey results
 *   GET  /admin/engage/:id/responses         survey sessions, newest first
 *   GET  /admin/engage/:id/responses.csv     the same as CSV
 *
 * Public calls are rate limited per visitor and never trust the browser with
 * the rules: targeting and schedule are checked here and are not in what the
 * widget is sent. An anonymous visitor gets engagements too; the first one it
 * is shown gives it a visitor cookie, which is what frequency rules count on.
 *
 * What the widget is sent carries `fields`: the values of the `{{field}}`
 * placeholders the engagements use, for a visitor the host app identified
 * (engage/personalize.ts). A support extension's engagements go through the
 * same show and impression routes under their `proactive:<id>` names, so the
 * widget's one engage controller draws both (api/proactive.ts), and a tour
 * one started resumes after a reload through `resume` like any other.
 */

import { rateLimit } from '../../agent/guards.js';
import { personalFields, placeholderKeys } from '../../engage/personalize.js';
import { QUESTION_KINDS, type SurveyEngagement } from '../../engage/schema.js';
import { engagementResults, engagementStats } from '../../engage/stats.js';
import { surveySessions, surveySessionsCsv } from '../../engage/surveys.js';
import { visitFromQuery } from '../../engage/targeting.js';
import { HelpWellError } from '../../errors.js';
import { isIdentified } from '../../repos/contacts.js';
import {
  claimEngagement,
  engagementForVisit,
  publicEngagement,
  recordImpression,
  recordSurveyResponse,
  selectEngagements,
} from '../../repos/engage.js';
import { webhookOptionsFor } from '../../webhook-guard.js';
import { emitWebhooks } from '../../webhooks.js';
import { type RequestContext, requireAdmin } from '../context.js';
import { cookieHeader, VISITOR_COOKIE } from '../identity.js';
import {
  PROACTIVE_ENGAGEMENT_PREFIX,
  PROACTIVE_ID,
  resumableProactiveTours,
} from '../proactive.js';
import { absoluteBlockMedia, publicBaseFor } from '../public-urls.js';
import { intParam, json, noContent, oneOf, type Router, readJson } from '../router.js';
import { reportProactiveEvent, showProactiveEngagement } from './proactive.js';

const IMPRESSIONS = ['seen', 'clicked', 'dismissed', 'completed'] as const;
const RANGES = ['7d', '30d', '90d', 'all'] as const;
const DAYS: Record<(typeof RANGES)[number], number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

export function engageRoutes(router: Router<RequestContext>): Router<RequestContext> {
  /* --------------------------------------------------------------- public */

  router.get('/engage', async ({ query, context }) => {
    if (!context.settings.engage.enabled) return json({ items: [] });
    const contactId = context.peekContactId();
    const visit = visitFromQuery(
      query,
      { contactId, identified: await isIdentified(context.db, contactId) },
      now(context),
    );
    const resume = (query.get('resume') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 10);
    const items = await selectEngagements(context.db, context.settings.engage.engagements, visit, {
      resume,
    });
    // A support extension's tours this browser was part way through.
    const theirs = await resumableProactiveTours(context.db, contactId, resume);
    // Pictures load from this API on the customer's site: absolute URLs.
    const base = publicBaseFor(context);
    const visible = [...items, ...theirs].map((one) =>
      absoluteBlockMedia(publicEngagement(one), base),
    );
    return json({ items: visible, ...(await fieldsFor(context, contactId, visible)) });
  });

  router.get('/engage/:id', async ({ params, context }) => {
    const contactId = context.peekContactId();
    const item = context.settings.engage.enabled
      ? await engagementForVisit(context.db, context.settings.engage.engagements, params.id!, {
          path: '/',
          contactId,
          identified: await isIdentified(context.db, contactId),
          now: now(context),
        })
      : null;
    if (!item) throw new HelpWellError('not_found', `No engagement ${params.id} for this visitor`);
    const visible = absoluteBlockMedia(publicEngagement(item), publicBaseFor(context));
    return json({ item: visible, ...(await fieldsFor(context, contactId, visible)) });
  });

  router.post('/engage/:id/show', async ({ params, context }) => {
    const body = await readJson<{
      session?: unknown;
      url?: unknown;
      manual?: unknown;
      step?: unknown;
    }>(context.request);
    if (!context.settings.engage.enabled) return json({ shown: false, reason: 'unavailable' });

    await enforce(context, `engage-show:${context.visitorKey()}`, 120, 60);
    const theirs = proactiveItemId(params.id!);
    if (theirs) {
      // One a support extension sent: only the visitor it was sent to can claim it.
      const owner = context.peekContactId();
      const result = owner ? await showProactiveEngagement(context, owner, theirs, body) : null;
      if (!result) throw new HelpWellError('not_found', `No engagement ${params.id}`);
      return json(result);
    }
    const contactId = await context.contactId();
    const result = await claimEngagement(
      context.db,
      context.settings.engage,
      params.id!,
      {
        path: '/',
        contactId,
        identified: await isIdentified(context.db, contactId),
        now: now(context),
      },
      {
        contactId,
        sessionId: shortText(body.session, 80),
        url: shortText(body.url, 2000),
        manual: body.manual === true,
        step: wholeNumber(body.step) ?? undefined,
      },
    );
    setVisitorCookie(context, contactId);
    if (!result.shown && result.reason === 'not_found') {
      throw new HelpWellError('not_found', `No engagement ${params.id}`);
    }
    return json(result);
  });

  router.post('/engage/:id/impression', async ({ params, context }) => {
    const body = await readJson<{
      state?: unknown;
      step?: unknown;
      url?: unknown;
      session?: unknown;
      anon?: unknown;
    }>(context.request);
    const state = oneOf(body.state, IMPRESSIONS, 'state');
    const step = body.step === undefined || body.step === null ? undefined : wholeNumber(body.step);
    if (step === null) throw new HelpWellError('bad_request', 'step must be a whole number');

    await enforce(context, `impression:${context.visitorKey()}`, 120, 60);
    const contactId = await context.contactId();
    await recordImpression(context.db, {
      engagementId: params.id!,
      contactId,
      state,
      step,
      url: shortText(body.url, 2000) ?? undefined,
      sessionId: shortText(body.session, 80),
    });
    // A support extension's engagement: it hears a click or a close, once.
    const theirs = proactiveItemId(params.id!);
    if (theirs && (state === 'clicked' || state === 'dismissed')) {
      await reportProactiveEvent(context, contactId, theirs, state, body.anon);
    }
    setVisitorCookie(context, contactId);
    return noContent();
  });

  router.post('/surveys/:id/response', async ({ params, context }) => {
    const body = await readJson<{
      kind?: unknown;
      score?: unknown;
      choice?: unknown;
      choices?: unknown;
      comment?: unknown;
      text?: unknown;
      session?: unknown;
      questionId?: unknown;
    }>(context.request);

    // A survey defined in settings is checked question by question. An id it
    // does not know is still accepted, as before, for surveys a host app
    // runs itself and reports through the SDK.
    const survey = context.settings.engage.engagements.find(
      (e): e is SurveyEngagement => e.id === params.id && e.kind === 'survey',
    );
    const questionId = shortText(body.questionId, 40);
    const question = survey
      ? (survey.survey.questions.find(
          (q) => q.id === (questionId ?? survey.survey.questions[0]?.id),
        ) ?? null)
      : null;
    if (survey && !question) {
      throw new HelpWellError('bad_request', `No question ${questionId} in ${params.id}`, {
        publicMessage: 'That question is not part of this survey.',
      });
    }
    const kind =
      body.kind === undefined
        ? (question?.kind ?? 'nps')
        : oneOf(body.kind, QUESTION_KINDS, 'kind');

    await enforce(context, `survey:${context.visitorKey()}:${params.id}`, 60, 86_400);
    const contactId = await context.contactId();
    const answer = {
      surveyId: params.id!,
      kind,
      sessionId: shortText(body.session, 80),
      questionId: question?.id ?? questionId,
      score: typeof body.score === 'number' ? body.score : null,
      choice: typeof body.choice === 'string' ? body.choice : null,
      choices: Array.isArray(body.choices) ? body.choices.map(String) : null,
      comment:
        typeof body.comment === 'string'
          ? body.comment
          : typeof body.text === 'string'
            ? body.text
            : null,
      contactId,
    };
    const id = await recordSurveyResponse(context.db, answer, question);
    await emitWebhooks(
      context.db,
      context.settings,
      'survey.response',
      {
        id,
        surveyId: params.id,
        sessionId: answer.sessionId,
        questionId: answer.questionId,
        kind,
        score: answer.score,
        choice: answer.choices ? answer.choices.join(', ') : answer.choice,
        choices: answer.choices,
        comment: answer.comment?.slice(0, 2000) ?? null,
        contactId,
      },
      webhookOptionsFor(context.config),
    );
    setVisitorCookie(context, contactId);
    return json({ id }, { status: 201 });
  });

  /* ---------------------------------------------------------------- admin */

  router.get('/admin/engage/stats', async ({ query, context }) => {
    requireAdmin(context);
    return json({
      items: await engagementStats(
        context.db,
        since(query, context),
        context.settings.engage.engagements,
      ),
    });
  });

  router.get('/admin/engage/:id/results', async ({ params, query, context }) => {
    requireAdmin(context);
    const engagement = find(context, params.id!);
    return json(await engagementResults(context.db, engagement, since(query, context)));
  });

  router.get('/admin/engage/:id/responses', async ({ params, query, context }) => {
    requireAdmin(context);
    find(context, params.id!);
    return json({
      items: await surveySessions(context.db, params.id!, {
        from: since(query, context),
        limit: intParam(query, 'limit', { default: 100, max: 1000 }),
      }),
    });
  });

  router.get('/admin/engage/:id/responses.csv', async ({ params, query, context }) => {
    requireAdmin(context);
    const engagement = find(context, params.id!);
    if (engagement.kind !== 'survey') {
      throw new HelpWellError('bad_request', `${params.id} is not a survey`);
    }
    const sessions = await surveySessions(context.db, engagement.id, {
      from: since(query, context),
      limit: 5000,
    });
    return new Response(surveySessionsCsv(engagement, sessions), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${engagement.id.replace(/[^\w.-]/g, '_')}-responses.csv"`,
        'cache-control': 'no-store',
      },
    });
  });

  return router;
}

/* ---------------------------------------------------------------- helpers */

function now(context: RequestContext): Date {
  return context.config.now?.() ?? new Date();
}

/** The values the placeholders in what is about to be sent need, when there are any. */
async function fieldsFor(
  context: RequestContext,
  contactId: string | null,
  visible: unknown,
): Promise<{ fields?: Record<string, string> }> {
  const fields = await personalFields(context.db, contactId, placeholderKeys(visible));
  return Object.keys(fields).length > 0 ? { fields } : {};
}

/** The extension's own id, for an engagement named `proactive:<id>`; else null. */
function proactiveItemId(id: string): string | null {
  if (!id.startsWith(PROACTIVE_ENGAGEMENT_PREFIX)) return null;
  const item = id.slice(PROACTIVE_ENGAGEMENT_PREFIX.length);
  return PROACTIVE_ID.test(item) ? item : null;
}

function find(context: RequestContext, id: string) {
  const engagement = context.settings.engage.engagements.find((e) => e.id === id);
  if (!engagement) throw new HelpWellError('not_found', `No engagement ${id}`);
  return engagement;
}

/** `?range=7d|30d|90d|all`, 30 days by default, as the start of the window. */
function since(query: URLSearchParams, context: RequestContext): Date | undefined {
  const range = oneOf(query.get('range') ?? '30d', RANGES, 'range');
  const days = DAYS[range];
  return days === null ? undefined : new Date(now(context).getTime() - days * 86_400_000);
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** A whole number from 0 up, or null. */
function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

// The two below mirror public.ts. They are small, and keeping engage in its
// own module was worth more than sharing them.

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
