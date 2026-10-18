/**
 * Engage in the dashboard: the list, the template gallery, the editor with
 * its live preview, and each engagement's results.
 *
 * Its own module, registered by the server with one line for reads and one
 * for writes. Engagements live in settings, so saving here writes settings
 * through the same store (and the same validation) as `PATCH
 * /admin/settings`; with the config file in the repo, `helpwell settings
 * pull` brings the change home.
 *
 *   GET  /engage                     the list (?kind, ?q, ?range)
 *   GET  /engage/new                 the gallery; ?template= opens the editor on one
 *   GET  /engage/:id                 the editor
 *   GET  /engage/:id/results         counts, tour drop-off, survey results (?range)
 *   GET  /engage/:id/responses.csv   a survey's responses
 *   GET  /engage/_preview            the page inside the preview frame
 *   POST /engage/new, /engage/:id    save, or a structural edit (op=...), or
 *                                    toggle, duplicate, delete from the list
 *   POST /engage/_draft              the form as a definition, for the preview (JSON)
 *   POST /engage/_upload             an image or video, stored with the docs (JSON)
 *   POST /engage/_write              "Write with AI": text rewritten by the install's model (JSON)
 *
 * The editor's Save, Pause and Go live buttons sit in the page header and
 * post the editor's form (`action=save|pause|resume`); Pause and Go live save
 * it with the live switch set.
 */

import {
  type Condition,
  countMatchingContacts,
  ENGAGEMENT_KINDS,
  type EngageLimits,
  type Engagement,
  type EngagementKind,
  engagementResults,
  engagementStats,
  eventCounts,
  listFields,
  listSegments,
  publicEngagement,
  segmentRules,
  statsFor,
  surveySessions,
  surveySessionsCsv,
} from '@helpwell/core/repos';
import type { SettingsStore } from '@helpwell/core/settings';
import { html, type RawHtml, raw } from '@helpwell/ui';
import { button, empty, notice } from '../components.js';
import { editorKitScript, editorTopbar, kitButton, kitIcon, popover } from '../editor-kit/index.js';
import { storeUpload } from '../engage/assets.js';
import { applyOp, type Draft, draftFromForm, draftFromRaw, isEmptyDraft } from '../engage/draft.js';
import { editorPage } from '../engage/editor.js';
import { galleryPage, type ListQuery, listPage } from '../engage/list.js';
import { previewPage } from '../engage/preview-page.js';
import { rangeFrom, resultsHeader, resultsPage, sinceFor } from '../engage/results.js';
import { engageScript } from '../engage/script.js';
import { engageStyles } from '../engage/styles.js';
import { summaries } from '../engage/summaries.js';
import { KIND_LABELS, startingPoint } from '../engage/templates.js';
import { writeWithModel } from '../engage/write.js';
import { type DashboardContext, type PageHeader, renderDashboard } from '../layout.js';
import type { DashboardConfig } from '../server.js';

type Config = Pick<
  DashboardConfig,
  'db' | 'docsDir' | 'content' | 'model' | 'openRouterKey' | 'modelFactory' | 'env'
>;

/** GET `/engage/...`. `rest` is what follows `engage`, decoded. */
export async function engageScreen(
  config: Config,
  store: SettingsStore,
  context: DashboardContext,
  rest: string[],
  url: URL,
): Promise<Response> {
  const settings = await store.get();
  const engagements = settings.engage.engagements;
  const limits = settings.engage.limits;
  const [first, second] = rest;

  if (!first) {
    const query: ListQuery = {
      kind: kindFrom(url.searchParams.get('kind')),
      q: (url.searchParams.get('q') ?? '').trim().slice(0, 100),
      range: rangeFrom(url.searchParams.get('range')),
    };
    const stats = await engagementStats(config.db, sinceFor(query.range), engagements);
    return page(
      context,
      {
        title: 'Engage',
        subtitle:
          'Modals, banners, hotspots, tours and surveys, for the right people at the right moment.',
        actions: button('New engagement', {
          href: `${context.basePath}/engage/new`,
          glyph: 'plus',
          tone: 'primary',
        }),
      },
      html`${listPage(context, settings.engage, stats, query, listFlash(url))}${engageStyles()}${engageScript(context)}`,
    );
  }

  if (first === '_preview' && !second) {
    return new Response(previewPage(context), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // Only this dashboard may frame it.
        'x-frame-options': 'SAMEORIGIN',
      },
    });
  }

  if (first === 'new' && !second) {
    const template = url.searchParams.get('template');
    const start = template ? startingPoint(template) : null;
    if (!start) {
      return page(
        context,
        { title: 'New engagement', subtitle: 'Start from a template, or from nothing.' },
        html`${galleryPage(context)}${engageStyles()}`,
      );
    }
    const draft = draftFromRaw(start, { others: engagements, mode: 'edit' });
    return editor(config, context, draft, {
      isNew: true,
      others: engagements,
      limits,
      siteHost: hostOf(settings.product.appUrl),
    });
  }

  const engagement = engagements.find((e) => e.id === first);
  if (!engagement) return notFound(context);

  if (!second) {
    const saved = url.searchParams.get('saved');
    return editor(
      config,
      context,
      { engagement, errors: new Map(), typed: new Map() },
      {
        isNew: false,
        others: engagements.filter((e) => e.id !== engagement.id),
        limits,
        siteHost: hostOf(settings.product.appUrl),
        saved: saved === '1' || saved === 'paused' || saved === 'live' ? saved : null,
        flash:
          saved === 'copy'
            ? notice(
                'info',
                'This is a copy, switched off. Change what you need, then switch it on.',
              )
            : null,
      },
    );
  }

  if (second === 'results' && rest.length === 2) {
    const range = rangeFrom(url.searchParams.get('range'));
    const since = sinceFor(range);
    const [results, sessions] = await Promise.all([
      engagementResults(config.db, engagement, since),
      engagement.kind === 'survey'
        ? surveySessions(config.db, engagement.id, { from: since, limit: 50 })
        : Promise.resolve([]),
    ]);
    return page(
      context,
      {
        ...resultsHeader(engagement),
        actions: button('All engagements', { href: `${context.basePath}/engage`, glyph: 'back' }),
      },
      html`${resultsPage(context, engagement, results, sessions, range)}${engageStyles()}`,
    );
  }

  if (second === 'responses.csv' && rest.length === 2 && engagement.kind === 'survey') {
    const range = rangeFrom(url.searchParams.get('range'));
    const sessions = await surveySessions(config.db, engagement.id, {
      from: sinceFor(range),
      limit: 5000,
    });
    return new Response(surveySessionsCsv(engagement, sessions), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${engagement.id.replace(/[^\w.-]/g, '_')}-responses.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  return notFound(context);
}

/** POST `/engage/...`. The server has already checked it came from this site. */
export async function engagePost(
  config: Config,
  store: SettingsStore,
  context: DashboardContext,
  rest: string[],
  request: Request,
): Promise<Response> {
  const [first, second] = rest;
  if (second) return notFound(context);
  const settings = await store.get();
  const engagements = settings.engage.engagements;
  const limits = settings.engage.limits;
  const base = `${context.basePath}/engage`;

  if (first === '_upload') {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Send the file as a form upload.' }, 400);
    }
    const result = await storeUpload(form.get('file'), {
      docsDir: config.docsDir ?? 'docs',
      apiPath: context.apiPath,
      content: config.content,
    });
    return result.ok
      ? json({ url: result.url, type: result.type })
      : json({ error: result.error }, result.status);
  }

  const form = await request.formData();
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };

  if (first === '_write') {
    const result = await writeWithModel(config, settings, {
      markdown: text('markdown'),
      instruction: text('instruction'),
      context: text('context'),
    });
    return result.ok
      ? json({ markdown: result.markdown })
      : json({ error: result.error }, result.status);
  }

  if (first === '_draft') {
    const kind = kindFrom(text('kind'));
    if (!kind) return json({ error: 'kind is required.' }, 400);
    const id = text('id').trim();
    const draft = draftFromForm(form, {
      kind,
      id,
      timeZone: context.timeZone,
      others: engagements.filter((e) => e.id !== id),
      mode: 'save',
    });
    const segmentId = draft.engagement.targeting.segmentId;
    const segment = segmentId
      ? (await listSegments(config.db)).find((s) => s.id === segmentId)
      : undefined;
    return json({
      definition: publicEngagement(draft.engagement),
      problems: draft.errors.size,
      // Nothing to draw yet: the preview shows its empty state instead.
      empty: isEmptyDraft(draft.engagement),
      // The "who sees it, and when" sentences, so they follow the controls.
      summaries: summaries(draft.engagement, {
        segmentName: segment?.name ?? null,
        locale: context.locale,
        timeZone: context.timeZone,
      }),
    });
  }

  const isNew = first === 'new';
  const existing = isNew ? null : engagements.find((e) => e.id === first);
  if (!isNew && !existing) return notFound(context);
  const action = text('action');

  // From the list: flip the live switch, duplicate, delete.
  if (existing && action === 'toggle') {
    const enabled = text('enabled') === 'true';
    await save(store, replace(engagements, existing.id, { ...existing, enabled }));
    return redirect(base);
  }
  if (existing && action === 'duplicate') {
    const id = uniqueId(`${existing.id}-copy`, engagements);
    const copy = {
      ...structuredClone(existing),
      id,
      name: `Copy of ${existing.name || existing.id}`,
      enabled: false,
    };
    await save(store, [...engagements, copy]);
    return redirect(`${base}/${encodeURIComponent(id)}?saved=copy`);
  }
  if (existing && action === 'delete') {
    await save(
      store,
      engagements.filter((e) => e.id !== existing.id),
    );
    return redirect(`${base}?deleted=1`);
  }

  // The editor: a structural edit, or a save.
  const kind = existing?.kind ?? kindFrom(text('kind'));
  if (!kind) return notFound(context);
  const id = existing?.id ?? text('id').trim();
  const others = engagements.filter((e) => e.id !== (existing?.id ?? ''));
  const op = text('op');
  // Pause and Go live save the form with the live switch set.
  if (action === 'pause' || action === 'resume') {
    form.append('enabled:bool', action === 'resume' ? 'true' : 'false');
  }

  const read = draftFromForm(form, {
    kind,
    id,
    timeZone: context.timeZone,
    others,
    mode: op ? 'edit' : 'save',
  });

  const siteHost = hostOf(settings.product.appUrl);
  if (op) {
    // `refresh|<where>` re-draws after a choice that changes which fields
    // exist, and comes back to where it was made.
    const focus = op.startsWith('refresh') ? op.split('|')[1] || null : applyOp(read.raw, op);
    const draft = draftFromRaw(read.raw, { others, mode: 'edit' });
    return editor(config, context, draft, {
      isNew,
      others,
      limits,
      focus,
      siteHost,
      unsaved: true,
    });
  }

  if (read.errors.size > 0) {
    return editor(config, context, read, {
      isNew,
      others,
      limits,
      siteHost,
      unsaved: true,
      status: 400,
    });
  }

  try {
    await save(
      store,
      existing
        ? replace(engagements, existing.id, read.engagement)
        : [...engagements, read.engagement],
    );
  } catch (error) {
    return editor(config, context, read, {
      isNew,
      others,
      limits,
      siteHost,
      unsaved: true,
      status: 400,
      flash: notice(
        'bad',
        `That did not save: ${error instanceof Error ? error.message : String(error)}`,
      ),
    });
  }
  const saved = action === 'pause' ? 'paused' : action === 'resume' ? 'live' : '1';
  return redirect(`${base}/${encodeURIComponent(read.engagement.id)}?saved=${saved}`);
}

/* -------------------------------------------------------------- plumbing */

async function editor(
  config: Config,
  context: DashboardContext,
  draft: Draft,
  options: {
    isNew: boolean;
    others: readonly Engagement[];
    limits: EngageLimits;
    flash?: RawHtml | null;
    focus?: string | null;
    status?: number;
    siteHost?: string;
    /** The form holds changes that are not saved: after a structural edit or a refused save. */
    unsaved?: boolean;
    /** Just saved: `1`, or `paused` / `live` from the header's buttons. */
    saved?: '1' | 'paused' | 'live' | null;
  },
): Promise<Response> {
  const e = draft.engagement;
  const [segments, contactFields, events, audience, stats] = await Promise.all([
    listSegments(config.db),
    listFields(config.db, { includeHidden: false }),
    eventCounts(config.db, { limit: 100 }),
    audienceCount(config, e),
    options.isNew ? Promise.resolve(null) : statsFor(config.db, e, sinceFor('30d')),
  ]);
  const base = `${context.basePath}/engage`;
  const name = e.name || (options.isNew ? `New ${KIND_LABELS[e.kind].toLowerCase()}` : e.id);
  const note =
    options.unsaved || options.isNew
      ? { text: 'Not saved yet.', tone: 'warn' as const }
      : {
          text:
            options.saved === 'paused'
              ? 'Paused. It will not show until it is live again.'
              : options.saved === 'live'
                ? 'Live for new page views now.'
                : options.saved
                  ? 'Saved just now'
                  : 'All changes saved',
          tone: 'good' as const,
          dirty: 'Unsaved changes',
        };
  return page(
    context,
    {
      title: name,
      lead: editorTopbar({
        back: { href: base, label: 'All engagements' },
        crumbs: [{ label: 'Engage', href: base }],
        title: name,
        state: options.isNew
          ? { label: 'New', tone: 'info' }
          : e.enabled
            ? { label: 'Live', tone: 'good' }
            : { label: 'Paused', tone: 'neutral' },
        note,
      }),
      actions: headerActions(e, options.isNew),
    },
    html`${engageStyles()}${editorPage(context, {
      engagement: e,
      isNew: options.isNew,
      unsaved: options.unsaved,
      fields: { errors: draft.errors, typed: draft.typed },
      others: options.others,
      segments,
      contactFields,
      events: events.map((event) => event.name),
      // A docs source that cannot be written takes no uploads: links only.
      canUpload: !config.content || Boolean(config.content.write),
      audienceCount: audience,
      limits: options.limits,
      stats,
      flash: options.flash ?? null,
      focus: options.focus ?? null,
      siteHost: options.siteHost,
    })}${editorKitScript(context)}${engageScript(context)}`,
    options.status ?? 200,
  );
}

/**
 * The editor's buttons, in the header and outside the form they submit:
 * how to test it on the site, Pause or Go live, and Save.
 */
function headerActions(e: Engagement, isNew: boolean): RawHtml {
  const code = `window.helpwell?.engage?.show('${e.id}')`;
  const test = isNew
    ? null
    : popover({
        trigger: html`${raw(kitIcon('external', 14))}<span>Test on my site</span>`,
        triggerClass: 'ek-btn ek-btn--secondary',
        align: 'end',
        body: html`<p class="ek-pop__title">See it on your site</p>
          <p class="ek-pop__text">Open your site in another tab, as someone it is for, and run this in the browser console. It shows straight away, whatever its trigger.</p>
          <pre class="ek-pop__code" id="en-test-code">${code}</pre>
          <div class="ek-pop__row"><button type="button" class="ek-mini" data-copy="en-test-code">${raw(kitIcon('copy', 12, 2))}<span>Copy</span></button></div>
          <p class="ek-pop__text">It has to be saved and live, and its dates and who it is for still apply.</p>`,
      });
  return html`${test}${
    isNew
      ? null
      : kitButton({
          label: e.enabled ? 'Pause' : 'Go live',
          icon: e.enabled ? 'pause' : 'play',
          look: 'secondary',
          form: 'en-editor',
          name: 'action',
          value: e.enabled ? 'pause' : 'resume',
        })
  }${kitButton({
    label: isNew ? 'Save' : 'Save changes',
    look: 'primary',
    form: 'en-editor',
    name: 'action',
    value: 'save',
  })}`;
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

/**
 * How many contacts the audience rules match now: signed in or not, the
 * conditions, and the segment, together. Null when there are no such rules
 * (every visitor), or when counting fails: the editor then says nothing
 * rather than something wrong.
 */
async function audienceCount(config: Config, e: Engagement): Promise<number | null> {
  const t = e.targeting;
  const all: Condition[] = [];
  if (t.audience === 'identified') all.push({ field: 'identified', op: 'is_true' });
  if (t.audience === 'anonymous') all.push({ field: 'identified', op: 'is_false' });
  if (t.conditions) all.push(t.conditions);
  try {
    if (t.segmentId) {
      const rules = await segmentRules(config.db, t.segmentId);
      // A deleted segment matches nobody, as it does when the page asks.
      if (!rules) return 0;
      all.push(rules);
    }
    return all.length > 0 ? await countMatchingContacts(config.db, { all }) : null;
  } catch {
    return null;
  }
}

async function save(store: SettingsStore, engagements: Engagement[]): Promise<void> {
  await store.update({ engage: { engagements } });
}

function replace(list: readonly Engagement[], id: string, next: Engagement): Engagement[] {
  return list.map((e) => (e.id === id ? next : e));
}

function uniqueId(base: string, list: readonly Engagement[]): string {
  const taken = new Set(list.map((e) => e.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function kindFrom(value: string | null): EngagementKind | null {
  return (ENGAGEMENT_KINDS as readonly string[]).includes(value ?? '')
    ? (value as EngagementKind)
    : null;
}

function listFlash(url: URL): RawHtml | null {
  if (url.searchParams.get('deleted') === '1') return notice('good', 'Deleted.');
  return null;
}

function page(
  context: DashboardContext,
  header: PageHeader,
  body: RawHtml,
  status = 200,
): Response {
  return new Response(renderDashboard(context, 'engage', header, body), {
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
      'That engagement is not here',
      'It may have been deleted or renamed.',
      button('All engagements', { href: `${context.basePath}/engage`, glyph: 'back' }),
    ),
    404,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location: string): Response {
  // 303 so the browser follows with GET: a refresh must never re-submit.
  return new Response(null, { status: 303, headers: { location } });
}
