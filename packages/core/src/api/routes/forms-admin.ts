/**
 * Forms for the dashboard, the SDK and anything else holding the admin token.
 *
 *   GET    /admin/forms                               every form, with headline stats (?range, ?archived)
 *   POST   /admin/forms                               create one: { template?, id?, name?, definition?, enabled? }
 *   GET    /admin/forms/templates                     the starting points
 *   POST   /admin/forms/import                        an export, back in ({ ..., overwrite? })
 *   GET    /admin/forms/:id                           one form
 *   PATCH  /admin/forms/:id                           save a new version, rename, switch on or off, archive
 *   DELETE /admin/forms/:id                           delete it, or archive it when it has submissions
 *   POST   /admin/forms/:id/duplicate                 a copy, switched off
 *   GET    /admin/forms/:id/versions[/:version]       the history
 *   POST   /admin/forms/:id/versions/:version/restore bring one back, as a new version
 *   GET    /admin/forms/:id/export                    the JSON to keep in a repo
 *   GET    /admin/forms/:id/analytics                 views, conversion, variants, pages, rejections (?range | ?from&to)
 *   GET    /admin/forms/:id/submissions[.csv]         filterable (?status, ?q, ?variant, ?placement, ?from, ?to)
 *   GET    /admin/forms/:id/submissions/:submission   one in full, with its verdict
 *   GET    /admin/forms/:id/giveaway                  entries, stats and winners
 *   GET    /admin/forms/:id/giveaway/entrants.csv, winners.csv
 *   POST   /admin/forms/:id/giveaway/draw             { count, seed? }
 *   POST   /admin/forms/:id/giveaway/winners/:w/redraw { reason }
 *   PATCH  /admin/forms/:id/giveaway/entries/:entry   { disqualified }
 *   GET    /admin/forms/:id/prompts                   the embed and popup-button prompts, formatted
 */

import { HelpWellError } from '../../errors.js';
import { formAnalytics, formsOverview, giveawayStats } from '../../forms/analytics.js';
import {
  drawWinners,
  listEntries,
  listWinners,
  redrawWinner,
  setDisqualified,
} from '../../forms/giveaway.js';
import { FORM_TYPES, type Form } from '../../forms/schema.js';
import {
  FORM_EMBED_PLATFORMS,
  formEmbedPromptSpec,
  formPopupButtonPromptSpec,
} from '../../forms/setup-prompts.js';
import {
  entrantsCsv,
  getSubmission,
  listSubmissions,
  type SubmissionFilters,
  submissionsCsv,
  winnersCsv,
} from '../../forms/submissions.js';
import { FORM_TEMPLATES } from '../../forms/templates.js';
import {
  createForm,
  deleteForm,
  duplicateForm,
  exportForm,
  getForm,
  getFormVersion,
  importForm,
  listForms,
  listFormVersions,
  restoreFormVersion,
  saveForm,
  updateFormMeta,
} from '../../repos/forms.js';
import { formatSetupPrompt } from '../../setup-prompt.js';
import { type RequestContext, requireAdmin } from '../context.js';
import { dateParam, intParam, json, oneOf, type Router, readJson } from '../router.js';

const RANGES = ['7d', '30d', '90d'] as const;
const DAYS: Record<(typeof RANGES)[number], number> = { '7d': 7, '30d': 30, '90d': 90 };
const STATUSES = ['accepted', 'rejected', 'duplicate', 'trusted', 'untrusted'] as const;

export function formsAdminRoutes(router: Router<RequestContext>): Router<RequestContext> {
  router.get('/admin/forms', async ({ query, context }) => {
    requireAdmin(context);
    const { from } = range(query, context);
    const [forms, stats] = await Promise.all([
      listForms(context.db, {
        includeArchived: query.get('archived') === '1',
        type: query.get('type') ? oneOf(query.get('type'), FORM_TYPES, 'type') : undefined,
      }),
      formsOverview(context.db, from),
    ]);
    return json({
      items: forms.map((form) => ({
        ...summary(form),
        stats: stats.get(form.id) ?? { views: 0, uniques: 0, trusted: 0, conversionRate: null },
      })),
    });
  });

  router.get('/admin/forms/templates', async ({ context }) => {
    requireAdmin(context);
    return json({
      items: FORM_TEMPLATES.map((t) => ({
        key: t.key,
        title: t.title,
        description: t.description,
        name: t.name,
        id: t.id,
      })),
    });
  });

  router.post('/admin/forms/import', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<Record<string, unknown> & { overwrite?: unknown }>(context.request);
    const { overwrite, ...exported } = body;
    const result = await importForm(context.db, exported, {
      overwrite: overwrite === true,
      tours: tours(context),
    });
    return json(result, { status: result.created ? 201 : 200 });
  });

  router.post('/admin/forms', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{
      template?: unknown;
      id?: unknown;
      name?: unknown;
      definition?: unknown;
      enabled?: unknown;
    }>(context.request);
    const form = await createForm(
      context.db,
      {
        template: typeof body.template === 'string' ? body.template : undefined,
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        definition: body.definition,
        enabled: body.enabled === true,
      },
      { tours: tours(context) },
    );
    return json(form, { status: 201 });
  });

  router.get('/admin/forms/:id', async ({ params, context }) => {
    requireAdmin(context);
    return json(await found(context, params.id!));
  });

  router.patch('/admin/forms/:id', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{
      definition?: unknown;
      name?: unknown;
      enabled?: unknown;
      archived?: unknown;
      expectedVersion?: unknown;
      note?: unknown;
    }>(context.request);
    let form = await found(context, params.id!);
    if (body.definition !== undefined) {
      const saved = await saveForm(
        context.db,
        form.id,
        {
          definition: body.definition,
          name: typeof body.name === 'string' ? body.name : undefined,
          expectedVersion:
            typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
        },
        {
          tours: tours(context),
          note: typeof body.note === 'string' ? body.note.slice(0, 200) : null,
        },
      );
      form = saved.form;
    }
    if (
      body.enabled !== undefined ||
      body.archived !== undefined ||
      (body.name && !body.definition)
    ) {
      form =
        (await updateFormMeta(context.db, form.id, {
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          archived: typeof body.archived === 'boolean' ? body.archived : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
        })) ?? form;
    }
    return json(form);
  });

  router.delete('/admin/forms/:id', async ({ params, context }) => {
    requireAdmin(context);
    const result = await deleteForm(context.db, params.id!);
    if (!result) throw new HelpWellError('not_found', `No form ${params.id}`);
    return json({ result });
  });

  router.post('/admin/forms/:id/duplicate', async ({ params, context }) => {
    requireAdmin(context);
    const copy = await duplicateForm(context.db, params.id!);
    if (!copy) throw new HelpWellError('not_found', `No form ${params.id}`);
    return json(copy, { status: 201 });
  });

  router.get('/admin/forms/:id/versions', async ({ params, context }) => {
    requireAdmin(context);
    await found(context, params.id!);
    return json({ items: await listFormVersions(context.db, params.id!) });
  });

  router.get('/admin/forms/:id/versions/:version', async ({ params, context }) => {
    requireAdmin(context);
    const version = await getFormVersion(context.db, params.id!, versionParam(params.version));
    if (!version)
      throw new HelpWellError('not_found', `No version ${params.version} of ${params.id}`);
    return json(version);
  });

  router.post('/admin/forms/:id/versions/:version/restore', async ({ params, context }) => {
    requireAdmin(context);
    const restored = await restoreFormVersion(context.db, params.id!, versionParam(params.version));
    if (!restored)
      throw new HelpWellError('not_found', `No version ${params.version} of ${params.id}`);
    return json(restored.form);
  });

  router.get('/admin/forms/:id/export', async ({ params, context }) => {
    requireAdmin(context);
    const exported = await exportForm(context.db, params.id!);
    if (!exported) throw new HelpWellError('not_found', `No form ${params.id}`);
    return json(exported, {
      headers: { 'content-disposition': `attachment; filename="form-${exported.id}.json"` },
    });
  });

  router.get('/admin/forms/:id/analytics', async ({ params, query, context }) => {
    requireAdmin(context);
    const form = await found(context, params.id!);
    return json(await formAnalytics(context.db, form, range(query, context)));
  });

  router.get('/admin/forms/:id/submissions.csv', async ({ params, query, context }) => {
    requireAdmin(context);
    const form = await found(context, params.id!);
    return csv(
      await submissionsCsv(context.db, form, submissionFilters(query)),
      `${form.id}-submissions.csv`,
    );
  });

  router.get('/admin/forms/:id/submissions', async ({ params, query, context }) => {
    requireAdmin(context);
    await found(context, params.id!);
    return json(
      await listSubmissions(context.db, params.id!, {
        ...submissionFilters(query),
        cursor: query.get('cursor') ?? undefined,
        limit: intParam(query, 'limit', { default: 50, max: 500 }),
      }),
    );
  });

  router.get('/admin/forms/:id/submissions/:submission', async ({ params, context }) => {
    requireAdmin(context);
    const submission = await getSubmission(context.db, params.submission!);
    if (!submission || submission.formId !== params.id) {
      throw new HelpWellError('not_found', `No submission ${params.submission}`);
    }
    return json(submission);
  });

  router.get('/admin/forms/:id/giveaway', async ({ params, query, context }) => {
    requireAdmin(context);
    const form = await giveaway(context, params.id!);
    const [stats, entries, winners] = await Promise.all([
      giveawayStats(context.db, form.id),
      listEntries(context.db, form.id, {
        limit: intParam(query, 'limit', { default: 200, max: 5000 }),
      }),
      listWinners(context.db, form.id),
    ]);
    return json({ stats, entries, winners });
  });

  router.get('/admin/forms/:id/giveaway/entrants.csv', async ({ params, context }) => {
    requireAdmin(context);
    const form = await giveaway(context, params.id!);
    return csv(await entrantsCsv(context.db, form.id), `${form.id}-entrants.csv`);
  });

  router.get('/admin/forms/:id/giveaway/winners.csv', async ({ params, context }) => {
    requireAdmin(context);
    const form = await giveaway(context, params.id!);
    return csv(await winnersCsv(context.db, form.id), `${form.id}-winners.csv`);
  });

  router.post('/admin/forms/:id/giveaway/draw', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ count?: unknown; seed?: unknown }>(context.request);
    const form = await giveaway(context, params.id!);
    const draw = await drawWinners(context.db, form, {
      count: typeof body.count === 'number' ? body.count : 1,
      seed: typeof body.seed === 'string' ? body.seed : undefined,
      now: context.config.now?.(),
    });
    return json(draw, { status: 201 });
  });

  router.post('/admin/forms/:id/giveaway/winners/:winner/redraw', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ reason?: unknown }>(context.request);
    const form = await giveaway(context, params.id!);
    return json(
      await redrawWinner(
        context.db,
        form,
        params.winner!,
        typeof body.reason === 'string' ? body.reason : '',
        context.config.now?.(),
      ),
    );
  });

  router.patch('/admin/forms/:id/giveaway/entries/:entry', async ({ params, context }) => {
    requireAdmin(context);
    const body = await readJson<{ disqualified?: unknown }>(context.request);
    const form = await giveaway(context, params.id!);
    if (typeof body.disqualified !== 'boolean') {
      throw new HelpWellError('bad_request', 'disqualified must be true or false');
    }
    const entry = await setDisqualified(context.db, form.id, params.entry!, body.disqualified);
    if (!entry) throw new HelpWellError('not_found', `No entry ${params.entry}`);
    return json(entry);
  });

  router.get('/admin/forms/:id/prompts', async ({ params, query, context }) => {
    requireAdmin(context);
    const form = await found(context, params.id!);
    const base = {
      formId: form.id,
      formName: form.name,
      productName: context.settings.product.name,
      apiPath: apiPathOf(context),
      origin: originOf(context),
    };
    const platform = query.get('platform');
    const platforms = platform
      ? [oneOf(platform, FORM_EMBED_PLATFORMS, 'platform')]
      : FORM_EMBED_PLATFORMS;
    return json({
      embed: Object.fromEntries(
        platforms.map((p) => [p, formatSetupPrompt(formEmbedPromptSpec({ ...base, platform: p }))]),
      ),
      button: formatSetupPrompt(formPopupButtonPromptSpec(base)),
    });
  });

  return router;
}

/* ---------------------------------------------------------------- helpers */

async function found(context: RequestContext, id: string): Promise<Form> {
  const form = await getForm(context.db, id);
  if (!form) throw new HelpWellError('not_found', `No form ${id}`);
  return form;
}

async function giveaway(context: RequestContext, id: string): Promise<Form> {
  const form = await found(context, id);
  if (form.definition.type !== 'giveaway') {
    throw new HelpWellError('bad_request', `${id} is not a giveaway`);
  }
  return form;
}

/** The list's view of a form: enough to draw a row. */
function summary(form: Form) {
  return {
    id: form.id,
    name: form.name,
    type: form.type,
    enabled: form.enabled,
    version: form.version,
    placements: form.definition.placements,
    variants: form.definition.variants.length,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    archivedAt: form.archivedAt,
  };
}

/** Tours a form's buttons may start. */
function tours(context: RequestContext): string[] {
  return context.settings.engage.engagements.filter((e) => e.kind === 'tour').map((e) => e.id);
}

/** `?range=7d|30d|90d` (30 days by default), or `?from` and `?to`. */
function range(query: URLSearchParams, context: RequestContext): { from: Date; to: Date } {
  const to = dateParam(query, 'to') ?? context.config.now?.() ?? new Date();
  const from = dateParam(query, 'from');
  if (from) return { from, to };
  const preset = oneOf(query.get('range') ?? '30d', RANGES, 'range');
  return { from: new Date(to.getTime() - DAYS[preset] * 86_400_000), to };
}

function submissionFilters(query: URLSearchParams): SubmissionFilters {
  const status = query.get('status');
  return {
    status: status ? oneOf(status, STATUSES, 'status') : undefined,
    q: query.get('q') ?? undefined,
    variant: query.get('variant') ?? undefined,
    placement: query.get('placement') ?? undefined,
    from: dateParam(query, 'from') ?? undefined,
    to: dateParam(query, 'to') ?? undefined,
  };
}

function versionParam(value: string | undefined): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new HelpWellError('bad_request', 'version must be a whole number from 1');
  }
  return version;
}

function csv(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
    },
  });
}

/** Where this API is mounted, from the request: everything before `/admin/forms`. */
function apiPathOf(context: RequestContext): string {
  try {
    const path = new URL(context.request.url).pathname;
    const at = path.indexOf('/admin/forms');
    return at > 0 ? path.slice(0, at) : '/api/helpwell';
  } catch {
    return '/api/helpwell';
  }
}

function originOf(context: RequestContext): string | null {
  try {
    return new URL(context.request.url).origin;
  } catch {
    return null;
  }
}
