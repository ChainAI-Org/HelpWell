/**
 * Forms in the dashboard: the list, the template gallery, the builder with
 * its live preview, results, submissions, the giveaway, and versions.
 *
 * Its own module, registered by the server with one line for reads and one
 * for writes. Forms live in the database (core's repos/forms.ts), so saving
 * here writes a new version there; Export JSON and Import take one to and
 * from a repo.
 *
 *   GET  /forms                          the list (?q, ?range, ?archived)
 *   GET  /forms/new                      the gallery
 *   GET  /forms/_preview                 the page inside the preview frame
 *   GET  /forms/:id                      the builder
 *   GET  /forms/:id/results              analytics (?range)
 *   GET  /forms/:id/submissions[.csv]    submissions (?status, ?q, ?cursor)
 *   GET  /forms/:id/submissions/:sub     one submission and its verdict
 *   GET  /forms/:id/giveaway[/…csv]      entrants, winners and the draw
 *   GET  /forms/:id/versions             the history
 *   GET  /forms/:id/export               the JSON
 *   POST /forms/new                      create one from a template, switched off
 *   POST /forms/import                   import an export
 *   POST /forms/_draft                   the builder as a preview draft (JSON)
 *   POST /forms/_upload                  an image or video for a block, or (?for=download)
 *                                        a lead magnet; through the content source when
 *                                        the host gives one that can be written (JSON)
 *   POST /forms/_write                   "Write with AI" for the composer (JSON)
 *   POST /forms/:id                      save, a structural edit (op=…), or an action
 *   POST /forms/:id/giveaway             draw, redraw, disqualify
 */

import { isHelpWellError } from '@helpwell/core';
import {
  type Condition,
  countMatchingContacts,
  createForm,
  deleteForm,
  drawWinners,
  duplicateForm,
  entrantsCsv,
  eventCounts,
  exportForm,
  type Form,
  FormInvalidError,
  formAnalytics,
  formsOverview,
  getForm,
  getSubmission,
  giveawayStats,
  importForm,
  listEntries,
  listFields,
  listForms,
  listFormVersions,
  listSegments,
  listSubmissions,
  listWinners,
  redrawWinner,
  restoreFormVersion,
  saveForm,
  segmentRules,
  setDisqualified,
  storeFile,
  storeFormFile,
  submissionsCsv,
  updateFormMeta,
  winnersCsv,
  withVariant,
} from '@helpwell/core/repos';
import type { SettingsStore } from '@helpwell/core/settings';
import { html, type RawHtml } from '@helpwell/ui';
import { button, empty, notice } from '../components.js';
import { editorKitScript } from '../editor-kit/index.js';
import { MAX_UPLOAD_BYTES, sniffMedia, storeUpload, UPLOAD_FOLDER } from '../engage/assets.js';
import { engageScript } from '../engage/script.js';
import { engageStyles } from '../engage/styles.js';
import { capText } from '../engage/who.js';
import { writeWithModel } from '../engage/write.js';
import {
  applyFormOp,
  draftFromRaw,
  type FormDraft,
  previewDefinition,
  readFormDraft,
} from '../forms/draft.js';
import { builderActions, builderPage, builderTopbar } from '../forms/editor.js';
import { galleryPage, type ListQuery, listPage, rangeFrom, sinceFor } from '../forms/list.js';
import { formsPreviewPage } from '../forms/preview-page.js';
import {
  formHeader,
  giveawayPage,
  resultsPage,
  submissionDetail,
  submissionsPage,
  versionsPage,
} from '../forms/results.js';
import { formsScript } from '../forms/script.js';
import { formsStyles } from '../forms/styles.js';
import { formSummaries } from '../forms/summaries.js';
import { type DashboardContext, type PageHeader, renderDashboard } from '../layout.js';
import type { DashboardConfig } from '../server.js';

type Config = Pick<
  DashboardConfig,
  'db' | 'docsDir' | 'content' | 'model' | 'openRouterKey' | 'modelFactory' | 'env'
>;
type Settings = Awaited<ReturnType<SettingsStore['get']>>;

const SUBMISSION_STATUSES = ['accepted', 'rejected', 'duplicate', 'trusted', 'untrusted'] as const;

/** GET `/forms/...`. `rest` is what follows `forms`, decoded. */
export async function formsScreen(
  config: Config,
  store: SettingsStore,
  context: DashboardContext,
  rest: string[],
  url: URL,
): Promise<Response> {
  const [first, second, third] = rest;
  const base = `${context.basePath}/forms`;

  if (!first) {
    const query: ListQuery = {
      q: (url.searchParams.get('q') ?? '').trim().slice(0, 100),
      range: rangeFrom(url.searchParams.get('range')),
      archived: url.searchParams.get('archived') === '1',
    };
    const [forms, stats] = await Promise.all([
      listForms(config.db, { includeArchived: query.archived }),
      formsOverview(config.db, sinceFor(query.range)),
    ]);
    return page(
      context,
      {
        title: 'Forms',
        subtitle:
          'Email capture, embedded or popping up, with giveaways and results. Every sign-up is checked for bots.',
        actions: button('New form', { href: `${base}/new`, glyph: 'plus', tone: 'primary' }),
      },
      html`${listPage(context, forms, stats, query, listFlash(url))}${engageStyles()}${formsStyles()}${engageScript(context)}`,
    );
  }

  if (first === 'new' && !second) {
    return page(
      context,
      {
        title: 'New form',
        subtitle:
          'Start from a template. It is saved switched off, so nothing shows until you say.',
      },
      html`${galleryPage(context)}${engageStyles()}${formsStyles()}`,
    );
  }

  if (first === '_preview' && !second) {
    return new Response(formsPreviewPage(context), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'SAMEORIGIN',
      },
    });
  }

  const form = await getForm(config.db, first);
  if (!form) return notFound(context);
  const header = (subtitle?: string): PageHeader => ({
    ...formHeader(form),
    ...(subtitle ? { subtitle } : {}),
    actions: button('All forms', { href: base, glyph: 'back' }),
  });

  if (!second) {
    const settings = await store.get();
    const saved = url.searchParams.get('saved');
    return builder(config, context, settings, form, {
      draft: {
        definition: form.definition,
        name: form.name,
        errors: new Map(),
        typed: new Map(),
        raw: {},
      },
      enabled: form.enabled,
      saved: saved === '1' || saved === 'paused' || saved === 'live' ? saved : null,
      flash:
        saved === '1' && !form.enabled
          ? notice(
              'info',
              'Saved. It is switched off, so it shows nowhere: Go live puts it on your site.',
            )
          : saved === 'copy'
            ? notice(
                'info',
                'This is a copy, switched off. Change what you need, then switch it on.',
              )
            : saved === 'home'
              ? notice('good', 'Added to the widget’s Home tab.')
              : saved === 'created'
                ? notice(
                    'info',
                    'Created from the template, switched off. Make it yours, then Go live.',
                  )
                : null,
    });
  }

  if (second === 'results' && !third) {
    const range = rangeFrom(url.searchParams.get('range'));
    const analytics = await formAnalytics(config.db, form, { from: sinceFor(range) });
    return page(
      context,
      header(),
      html`${resultsPage(context, form, analytics, range)}${formsStyles()}`,
    );
  }

  if (second === 'submissions.csv' && !third) {
    return csv(
      await submissionsCsv(config.db, form, { status: statusFrom(url) }),
      `${form.id}-submissions.csv`,
    );
  }

  if (second === 'submissions') {
    if (third) {
      const submission = await getSubmission(config.db, third);
      if (!submission || submission.formId !== form.id) return notFound(context);
      return page(context, header(), submissionDetail(context, form, submission));
    }
    const listed = await listSubmissions(config.db, form.id, {
      status: statusFrom(url),
      q: url.searchParams.get('q') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: 50,
    });
    return page(
      context,
      header(),
      submissionsPage(context, form, listed, {
        status: statusFrom(url) ?? '',
        q: (url.searchParams.get('q') ?? '').slice(0, 200),
      }),
    );
  }

  if (second === 'giveaway' && form.definition.type === 'giveaway') {
    if (third === 'entrants.csv')
      return csv(await entrantsCsv(config.db, form.id), `${form.id}-entrants.csv`);
    if (third === 'winners.csv')
      return csv(await winnersCsv(config.db, form.id), `${form.id}-winners.csv`);
    if (third) return notFound(context);
    return giveawayScreen(config, context, form, header(), giveawayFlash(url));
  }

  if (second === 'versions' && !third) {
    return page(
      context,
      header(),
      versionsPage(context, form, await listFormVersions(config.db, form.id), null),
    );
  }

  if (second === 'export' && !third) {
    const exported = await exportForm(config.db, form.id);
    return new Response(`${JSON.stringify(exported, null, 2)}\n`, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="form-${form.id}.json"`,
        'cache-control': 'no-store',
      },
    });
  }

  return notFound(context);
}

/** POST `/forms/...`. The server has already checked it came from this site. */
export async function formsPost(
  config: Config,
  store: SettingsStore,
  context: DashboardContext,
  rest: string[],
  request: Request,
): Promise<Response> {
  const [first, second] = rest;
  const base = `${context.basePath}/forms`;
  const settings = await store.get();
  const tours = settings.engage.engagements.filter((e) => e.kind === 'tour').map((e) => e.id);

  if (first === '_upload' && !second) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Send the file as a form upload.' }, 400);
    }
    return upload(config, context, form.get('file'), new URL(request.url).searchParams.get('for'));
  }

  if (first === '_write' && !second) {
    // "Write with AI" in the composer: engage's writer, with the host's
    // writing model (`modelFactory('docs')`) when it gives one.
    const form = await request.formData();
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const result = await writeWithModel(config, settings, {
      markdown: text('markdown'),
      instruction: text('instruction'),
      context: text('context'),
    });
    return result.ok
      ? json({ markdown: result.markdown })
      : json({ error: result.error }, result.status);
  }

  const form = await request.formData();
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };

  if (first === 'new' && !second) {
    const created = await createForm(
      config.db,
      { template: text('template') || 'custom', enabled: false },
      { skipChecks: true },
    ).catch((error: unknown) => error);
    if (created instanceof Error) {
      return page(
        context,
        { title: 'New form' },
        notice('bad', `That did not work: ${created.message}`),
        400,
      );
    }
    return redirect(`${base}/${encodeURIComponent((created as Form).id)}?saved=created`);
  }

  if (first === 'import' && !second) {
    try {
      const imported = await importForm(config.db, text('json'), {
        overwrite: text('overwrite') === 'true',
        skipChecks: true,
      });
      return redirect(`${base}/${encodeURIComponent(imported.form.id)}?saved=1`);
    } catch (error) {
      const message = isHelpWellError(error) ? error.publicMessage : 'That is not a form export.';
      return redirect(`${base}?import=${encodeURIComponent(message.slice(0, 200))}`);
    }
  }

  if (first === '_draft' && !second) {
    const existing = await getForm(config.db, text('id'));
    if (!existing) return json({ error: 'No such form.' }, 404);
    const raw = readFormDraft(form, { timeZone: context.timeZone });
    const draft = draftFromRaw(raw, { id: existing.id, name: existing.name, mode: 'save', tours });
    const preview = (raw.preview ?? {}) as { placement?: string; state?: string; variant?: string };
    const segmentId = draft.definition.targeting.segmentId;
    const segment = segmentId
      ? (await listSegments(config.db)).find((s) => s.id === segmentId)
      : undefined;
    return json({
      definition: previewDefinition(
        existing,
        withVariant(draft.definition, preview.variant ?? ''),
        preview,
      ),
      // A form always has its email field, so there is always something to draw.
      empty: false,
      problems: draft.errors.size,
      summaries: formSummaries(draft.definition, {
        segmentName: segment?.name ?? null,
        locale: context.locale,
        timeZone: context.timeZone,
      }),
    });
  }

  const existing = first ? await getForm(config.db, first) : null;
  if (!existing) return notFound(context);
  const here = `${base}/${encodeURIComponent(existing.id)}`;

  if (second === 'giveaway') {
    return giveawayPost(config, context, existing, form, here);
  }
  if (second) return notFound(context);

  const action = text('action');
  switch (action) {
    case 'toggle':
      await updateFormMeta(config.db, existing.id, { enabled: text('enabled') === 'true' });
      return redirect(base);
    case 'duplicate': {
      const copy = await duplicateForm(config.db, existing.id);
      return redirect(`${base}/${encodeURIComponent(copy!.id)}?saved=copy`);
    }
    case 'delete': {
      const result = await deleteForm(config.db, existing.id);
      return redirect(
        `${base}?${result === 'archived' ? 'archived=1&flash=archived' : 'flash=deleted'}`,
      );
    }
    case 'unarchive':
      await updateFormMeta(config.db, existing.id, { archived: false });
      return redirect(`${here}?saved=1`);
    case 'restore': {
      const restored = await restoreFormVersion(config.db, existing.id, Number(text('version')));
      return redirect(restored ? `${here}?saved=1` : `${here}/versions`);
    }
    case 'add-home': {
      const blocks = settings.widget.home.blocks;
      if (!blocks.some((b) => b.type === 'form' && b.formId === existing.id)) {
        await store.update({
          widget: { home: { blocks: [...blocks, { type: 'form', formId: existing.id }] } },
        });
      }
      return redirect(`${here}?saved=home`);
    }
    default:
      break;
  }

  // The builder: a structural edit, or a save. Switch off and Go live save
  // it too, with the live switch set: the last value posted wins.
  const raw = readFormDraft(form, { timeZone: context.timeZone });
  const op = text('op');
  const switched = action === 'pause' ? false : action === 'resume' ? true : null;
  const posted = form.getAll('enabled:bool');
  const enabled = switched ?? posted[posted.length - 1] === 'true';
  if (op) {
    // `refresh|<where>` re-draws after a choice that changes which fields
    // exist, and comes back to where it was made.
    const focus = op.startsWith('refresh')
      ? (op.split('|')[1] ?? null) || null
      : applyFormOp(raw, op);
    const draft = draftFromRaw(raw, { id: existing.id, name: existing.name, mode: 'edit', tours });
    return builder(config, context, settings, existing, { draft, enabled, focus, unsaved: true });
  }

  const draft = draftFromRaw(raw, { id: existing.id, name: existing.name, mode: 'save', tours });
  if (draft.errors.size > 0) {
    return builder(config, context, settings, existing, {
      draft,
      enabled,
      status: 400,
      unsaved: true,
    });
  }
  const expected = Number(text('expectedVersion:num'));
  try {
    await saveForm(
      config.db,
      existing.id,
      {
        definition: draft.definition,
        name: draft.name,
        expectedVersion: Number.isInteger(expected) && expected > 0 ? expected : undefined,
      },
      { tours, note: 'Saved in the dashboard' },
    );
    await updateFormMeta(config.db, existing.id, { enabled, name: draft.name });
  } catch (error) {
    const message =
      error instanceof FormInvalidError
        ? error.publicMessage
        : isHelpWellError(error)
          ? error.publicMessage
          : error instanceof Error
            ? error.message
            : String(error);
    return builder(config, context, settings, existing, {
      draft,
      enabled,
      status: isHelpWellError(error) && error.code === 'conflict' ? 409 : 400,
      flash: notice('bad', `That did not save: ${message}`),
      unsaved: true,
    });
  }
  return redirect(
    `${here}?saved=${switched === false ? 'paused' : switched === true ? 'live' : '1'}`,
  );
}

/* -------------------------------------------------------------- plumbing */

async function builder(
  config: Config,
  context: DashboardContext,
  settings: Settings,
  form: Form,
  options: {
    draft: FormDraft;
    enabled: boolean;
    flash?: RawHtml | null;
    focus?: string | null;
    status?: number;
    /** The form on the page differs from the saved one. */
    unsaved?: boolean;
    /** Just saved: `1`, or `paused` / `live` from the header's buttons. */
    saved?: '1' | 'paused' | 'live' | null;
  },
): Promise<Response> {
  const d = options.draft.definition;
  const [segments, contactFields, events, others, audience, stats] = await Promise.all([
    listSegments(config.db),
    listFields(config.db, { includeHidden: false }),
    eventCounts(config.db, { limit: 100 }),
    listForms(config.db),
    audienceCount(config, d.targeting),
    formsOverview(config.db, sinceFor('30d')),
  ]);
  const segmentName = segments.find((s) => s.id === d.targeting.segmentId)?.name ?? null;
  const raw = options.draft.raw as { preview?: { placement?: string; state?: string } };
  const status = options.status ?? 200;
  const name = options.draft.name || form.name;
  return page(
    context,
    {
      title: name || form.id,
      lead: builderTopbar(context, form, {
        name,
        enabled: form.enabled,
        unsaved: options.unsaved === true,
        saved: options.saved ?? null,
      }),
      actions: builderActions(form, form.enabled),
    },
    html`${engageStyles()}${formsStyles()}${builderPage(context, {
      form,
      definition: d,
      name: options.draft.name,
      enabled: options.enabled,
      unsaved: options.unsaved,
      fields: { errors: options.draft.errors, typed: options.draft.typed },
      segments,
      contactFields,
      events: events.map((e) => e.name),
      otherForms: others.filter((f) => f.id !== form.id).map((f) => ({ id: f.id, name: f.name })),
      tours: settings.engage.engagements
        .filter((e) => e.kind === 'tour')
        .map((e) => ({ id: e.id, name: e.name })),
      onHome: settings.widget.home.blocks.some((b) => b.type === 'form' && b.formId === form.id),
      audienceCount: audience,
      stats: stats.get(form.id) ?? null,
      summaries: formSummaries(d, {
        segmentName,
        locale: context.locale,
        timeZone: context.timeZone,
      }),
      limitsText: capText(settings.engage.limits),
      flash: options.flash ?? null,
      focus: options.focus ?? null,
      preview: {
        placement:
          raw.preview?.placement ??
          (d.placements.display !== 'none' ? d.placements.display : 'inline'),
        state: raw.preview?.state === 'done' ? 'done' : 'form',
      },
      siteHost: hostOf(settings.product.appUrl),
    })}${editorKitScript(context)}${engageScript(context)}${formsScript(context)}`,
    status,
  );
}

async function giveawayScreen(
  config: Config,
  context: DashboardContext,
  form: Form,
  header: PageHeader,
  flash: RawHtml | null,
  status = 200,
): Promise<Response> {
  const [stats, entries, winners] = await Promise.all([
    giveawayStats(config.db, form.id),
    listEntries(config.db, form.id, { limit: 500 }),
    listWinners(config.db, form.id),
  ]);
  return page(
    context,
    header,
    html`${giveawayPage(context, form, { stats, entries, winners, flash })}${formsStyles()}`,
    status,
  );
}

async function giveawayPost(
  config: Config,
  context: DashboardContext,
  form: Form,
  body: FormData,
  here: string,
): Promise<Response> {
  const text = (name: string) => {
    const value = body.get(name);
    return typeof value === 'string' ? value : '';
  };
  try {
    switch (text('action')) {
      case 'draw':
        await drawWinners(config.db, form, {
          count: Number(text('count')) || 1,
          seed: text('seed') || undefined,
        });
        return redirect(`${here}/giveaway?done=draw`);
      case 'redraw':
        await redrawWinner(config.db, form, text('winner'), text('reason'));
        return redirect(`${here}/giveaway?done=redraw`);
      case 'disqualify':
        await setDisqualified(config.db, form.id, text('entry'), text('disqualified') === 'true');
        return redirect(`${here}/giveaway`);
      default:
        return notFound(context);
    }
  } catch (error) {
    const message = isHelpWellError(error) ? error.publicMessage : String(error);
    return giveawayScreen(
      config,
      context,
      form,
      {
        ...formHeader(form),
        actions: button('All forms', { href: `${context.basePath}/forms`, glyph: 'back' }),
      },
      notice('bad', message),
      400,
    );
  }
}

/** How many contacts the audience rules match now; null for everyone, or when counting fails. */
async function audienceCount(
  config: Config,
  t: Form['definition']['targeting'],
): Promise<number | null> {
  const all: Condition[] = [];
  if (t.audience === 'identified') all.push({ field: 'identified', op: 'is_true' });
  if (t.audience === 'anonymous') all.push({ field: 'identified', op: 'is_false' });
  if (t.conditions) all.push(t.conditions);
  try {
    if (t.segmentId) {
      const rules = await segmentRules(config.db, t.segmentId);
      if (!rules) return 0;
      all.push(rules);
    }
    return all.length > 0 ? await countMatchingContacts(config.db, { all }) : null;
  } catch {
    return null;
  }
}

/**
 * An upload from the builder. A lead magnet is kept out of sight and named by
 * reference (core's forms/files.ts): only a signed download link hands it
 * out. Block media is served at `<api>/media/`, like the engage editor's.
 * Both go through the host's content source when it has one that can be
 * written (a hosted install has no docs folder of its own), and into the
 * docs folder on this server's disk otherwise.
 */
async function upload(
  config: Config,
  context: DashboardContext,
  file: FormDataEntryValue | null,
  purpose: string | null,
): Promise<Response> {
  const store = { content: config.content ?? null, docsDir: config.docsDir ?? 'docs' };
  if (purpose === 'download') {
    const stored = await storeFormFile(file, store);
    return stored.ok
      ? json({ url: stored.ref, type: stored.type })
      : json({ error: stored.error }, stored.status);
  }
  if (!config.content) {
    const result = await storeUpload(file, { docsDir: store.docsDir, apiPath: context.apiPath });
    return result.ok
      ? json({ url: result.url, type: result.type })
      : json({ error: result.error }, result.status);
  }
  if (!(file instanceof Blob) || file.size === 0)
    return json({ error: 'Choose a file to upload.' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'That file is over 25 MB.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffMedia(bytes);
  if (!format) return json({ error: 'Upload a PNG, JPEG, GIF, WebP, MP4 or WebM file.' }, 415);
  const stored = await storeFile(bytes, format.ext, UPLOAD_FOLDER, store);
  if (!stored.ok) return json({ error: stored.error }, stored.status);
  const api = context.apiPath.replace(/\/+$/, '');
  return json({ url: `${api}/media/${stored.path}`, type: format.type });
}

/** The host part of the product's address, for the preview's address bar. */
function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function statusFrom(url: URL): (typeof SUBMISSION_STATUSES)[number] | undefined {
  const value = url.searchParams.get('status');
  return SUBMISSION_STATUSES.find((s) => s === value);
}

function listFlash(url: URL): RawHtml | null {
  const flash = url.searchParams.get('flash');
  if (flash === 'deleted') return notice('good', 'Deleted.');
  if (flash === 'archived')
    return notice('good', 'Archived: it had submissions, so they are kept. It shows nowhere.');
  const problem = url.searchParams.get('import');
  if (problem) return notice('bad', `That did not import: ${problem}`);
  return null;
}

function giveawayFlash(url: URL): RawHtml | null {
  const done = url.searchParams.get('done');
  if (done === 'draw')
    return notice(
      'good',
      'Drawn. The seed and the hash of the entries are recorded with each winner.',
    );
  if (done === 'redraw')
    return notice('good', 'Redrawn. The first winner stays in the record, with your reason.');
  return null;
}

function page(
  context: DashboardContext,
  header: PageHeader,
  body: RawHtml,
  status = 200,
): Response {
  return new Response(renderDashboard(context, 'forms', header, body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function notFound(context: DashboardContext): Response {
  return page(
    context,
    { title: 'Not found' },
    empty(
      'alert',
      'That form is not here',
      'It may have been deleted.',
      button('All forms', { href: `${context.basePath}/forms`, glyph: 'back' }),
    ),
    404,
  );
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
