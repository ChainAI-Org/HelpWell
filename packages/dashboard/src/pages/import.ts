/**
 * "Import from another help center", for an install with no repo.
 *
 * In a repo, `helpwell import` brings a help centre over as files to review
 * and commit. An install whose content is managed for it has no terminal to
 * run that in, so the same importers run here (`@helpwell/core/import`):
 * an uploaded export, or a public help centre read from its address. The
 * articles are written through the install's content source, their images
 * through its asset store, and their old URLs into its redirect map; then the
 * knowledge base is indexed, so what was imported is live when it finishes.
 *
 * It can take a while (a crawl reads a page at a time, and every image is
 * downloaded), so the page posts with a script that reads a progress stream
 * and swaps in the summary at the end. Without the script the form posts as
 * usual and the summary comes back when the import is done. A host that runs
 * imports on its own workers passes `importJobs` (import-jobs.ts): the form
 * and the stream stay the same, and the host's job does the work.
 *
 * Everything this reads from the web goes through a guarded fetch (public
 * https addresses only, checked on the connection, a size and time limit),
 * or the host's own `importFetch`: the addresses come from an upload or a
 * form, and the server must not be made to read its own network.
 */

import { HelpWellError, isHelpWellError, webhookOptionsFor } from '@helpwell/core';
import {
  contentImportTarget,
  IMPORT_UPLOAD_FORMATS,
  IMPORT_URL_SOURCES,
  MAX_IMPORT_UPLOAD_BYTES,
  publicFetch,
  readImportUrl,
  readUploadedExport,
  writeImportPlan,
} from '@helpwell/core/import';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { html, join, mountPath, type RawHtml } from '@helpwell/ui';
import { dashboardAssetStore } from '../article-assets.js';
import { clientScript } from '../client/index.js';
import { button, card, field, notice, textInput } from '../components.js';
import { managedContent } from '../content-mode.js';
import type {
  ImportJobContext,
  ImportJobRequest,
  ImportJobs,
  ImportProgress,
  ImportSummary,
} from '../import-jobs.js';
import { type DashboardContext, renderDashboard } from '../layout.js';
import { dashboardModel } from '../model.js';
import type { DashboardConfig } from '../server.js';

/** A multipart body a little over the upload limit still has room for the form's fields. */
const MULTIPART_SLACK = 256 * 1024;

/** One fetch per process for installs that did not pass their own: it holds no state. */
let sharedFetch: typeof fetch | null = null;

function guardedFetch(): typeof fetch {
  if (!sharedFetch) sharedFetch = publicFetch();
  return sharedFetch;
}

/** GET `/knowledge/_import`. */
export async function importScreen(
  config: DashboardConfig,
  context: DashboardContext,
  _url: URL,
): Promise<Response> {
  return render(context, screen(config, context));
}

/** POST `/knowledge/_import`: run it, streamed when the page's script asks. */
export async function importPost(
  config: DashboardConfig,
  context: DashboardContext,
  request: Request,
): Promise<Response> {
  const stream = (request.headers.get('accept') ?? '').includes('application/x-ndjson');
  const fail = (message: string, status = 400) =>
    stream
      ? ndjson([{ type: 'error', message }])
      : render(context, screen(config, context, message), status);

  if (!importable(config, context)) return fail('This install cannot import articles here.');
  if (
    Number(request.headers.get('content-length') ?? 0) >
    MAX_IMPORT_UPLOAD_BYTES + MULTIPART_SLACK
  ) {
    return fail(
      `That file is over ${MAX_IMPORT_UPLOAD_BYTES / (1024 * 1024)} MB. Split the export into smaller archives.`,
      413,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('That did not arrive as a form. Try again.');
  }
  const file = form.get('file');
  const address = typeof form.get('url') === 'string' ? String(form.get('url')).trim() : '';
  const upload = file instanceof Blob && file.size > 0 ? file : null;
  if (!upload && !address)
    return fail('Choose an export to upload, or give the address of a help center.');
  if (upload && upload.size > MAX_IMPORT_UPLOAD_BYTES) {
    return fail(
      `That file is over ${MAX_IMPORT_UPLOAD_BYTES / (1024 * 1024)} MB. Split the export into smaller archives.`,
      413,
    );
  }

  const input: ImportJobRequest = {
    upload: upload
      ? {
          bytes: new Uint8Array(await upload.arrayBuffer()),
          name: 'name' in upload && typeof upload.name === 'string' ? upload.name : 'export.zip',
        }
      : null,
    address: upload ? null : address,
    draft: form.get('draft') !== null,
    force: form.get('force') !== null,
  };
  const job: ImportJobContext = { request, basePath: context.basePath, apiPath: context.apiPath };
  // Here, in this request, unless the host runs imports as jobs of its own.
  const run = (report: (progress: ImportProgress) => void) =>
    config.importJobs
      ? hostedImport(config.importJobs, input, job, report)
      : runImportJob(config, input, { apiPath: context.apiPath, onProgress: report });

  if (!stream) {
    try {
      const outcome = await run(() => {});
      return render(context, summary(context, outcome));
    } catch (error) {
      return fail(
        isHelpWellError(error) ? error.publicMessage : STOPPED,
        isHelpWellError(error) ? 400 : 500,
      );
    }
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        const outcome = await run((progress) => send({ type: 'progress', ...progress }));
        send({ type: 'done', html: summary(context, outcome).value });
      } catch (error) {
        // Said plainly, and never what a failure said inside.
        send({
          type: 'error',
          message: isHelpWellError(error) ? error.publicMessage : STOPPED,
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/* ------------------------------------------------------------------ run */

/**
 * Whether this install takes an import here: its content is managed for it,
 * and either the host runs imports itself or the content can be written.
 */
function importable(config: DashboardConfig, context: DashboardContext): boolean {
  if (!managedContent(context)) return false;
  return Boolean(config.importJobs || config.content?.write);
}

/**
 * An import run by the host's `importJobs`: started, then watched until it
 * says it is done. Its progress goes to the page as the in-request import's
 * does, and an `error` it reports is shown in its own words.
 */
async function hostedImport(
  jobs: ImportJobs,
  input: ImportJobRequest,
  job: ImportJobContext,
  report: (progress: ImportProgress) => void,
): Promise<ImportSummary> {
  const { id } = await jobs.start(input, job);
  for await (const event of jobs.watch(id, job)) {
    if (event.type === 'progress') {
      report({ text: event.text, done: event.done, total: event.total });
    } else if (event.type === 'done') {
      return event.summary;
    } else if (event.type === 'error') {
      throw new HelpWellError('upstream_failed', event.message, { publicMessage: event.message });
    }
  }
  throw new HelpWellError('upstream_failed', `Import job ${id} ended without a result.`, {
    publicMessage: STOPPED,
  });
}

const STOPPED =
  'The import stopped part way. Anything already written is kept; run it again to finish.';

export interface RunImportJobOptions {
  /** Where the API is mounted: imported images are indexed as served under it. */
  apiPath: string;
  /** Each step, as the page's progress bar shows it. */
  onProgress?: (progress: ImportProgress) => void;
}

/**
 * The import the dashboard runs: read the export or the address, write the
 * articles, images and redirects through `config.content` and its asset
 * store, then index. The default in-request import calls this, and so can a
 * host's worker running `importJobs`, with the same config the dashboard has.
 */
export async function runImportJob(
  config: DashboardConfig,
  input: ImportJobRequest,
  options: RunImportJobOptions,
): Promise<ImportSummary> {
  const content = config.content?.write ? config.content : null;
  if (!content) {
    throw new HelpWellError('not_configured', 'An import needs a writable content source.', {
      publicMessage: 'This install cannot import articles here.',
    });
  }
  const report = options.onProgress ?? (() => {});
  const doFetch = config.importFetch ?? guardedFetch();
  report({ text: input.upload ? 'Reading the export…' : 'Reading the help center…' });
  const plan = input.upload
    ? readUploadedExport(input.upload.bytes, input.upload.name)
    : await readImportUrl(input.address ?? '', {
        fetch: doFetch,
        onProgress: (text) => report({ text: `Reading the help center: ${text}…` }),
      });

  const settings = await new SettingsStore(config.db).get();
  const written = await writeImportPlan(
    plan,
    contentImportTarget({ content, assets: dashboardAssetStore(config) }),
    {
      helpPath: mountPath(settings.helpCenter.subpath || '/help'),
      draft: input.draft,
      force: input.force,
      fetch: doFetch,
      onProgress: ({ done, total, title }) =>
        report({ text: `Writing ${done + 1} of ${total}: ${title}`, done, total }),
    },
  );

  const outcome = { source: plan.source, found: plan.articles.length, warnings: plan.warnings };
  if (written.written.length === 0) return { ...outcome, written, indexed: null };
  report({ text: 'Indexing the knowledge base…' });
  const model = dashboardModel(config, settings, 'embeddings');
  const sync = await syncContent(config.db, content, {
    media: { apiPath: options.apiPath, screenshots: content.screenshots },
    ...(model && settings.agent.models.embeddings
      ? { model, embeddingModel: settings.agent.models.embeddings }
      : {}),
    origin: 'dashboard',
    webhooks: webhookOptionsFor(config),
    onProgress: (done, total) => report({ text: `Indexing ${done} of ${total}…`, done, total }),
  });
  return {
    ...outcome,
    written,
    indexed: { articles: sync.articles, embeddingError: sync.embeddingError },
  };
}

/* --------------------------------------------------------------- render */

function render(context: DashboardContext, body: RawHtml, status = 200): Response {
  const header = {
    title: 'Import from another help center',
    subtitle: 'Bring articles, images and old addresses over, and keep the old links working.',
    actions: button('All articles', { href: `${context.basePath}/knowledge`, glyph: 'back' }),
  };
  return new Response(renderDashboard(context, 'knowledge', header, body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function screen(config: DashboardConfig, context: DashboardContext, problem?: string): RawHtml {
  if (!managedContent(context)) {
    return notice(
      'info',
      html`Imports write Markdown files into your repo, to review before they go live. Run
      <code>npx helpwell import</code> with the folder, the export or the platform, then
      <code>helpwell sync</code>.`,
    );
  }
  if (!importable(config, context)) {
    return notice(
      'info',
      'This install’s content cannot be written from here, so nothing can be imported into it here.',
    );
  }
  const action = `${context.basePath}/knowledge/_import`;
  return html`
<div id="db-import">
${problem ? notice('bad', problem) : null}
<form method="post" action="${action}" enctype="multipart/form-data" data-import>
${card(
  'Upload an export',
  'A ZIP of the export, or a single Markdown or HTML file, up to 100 MB. What it is is worked out from what is in it.',
  html`<ul style="margin:0 0 12px;padding-inline-start:18px;font-size:13.5px">${join(
    IMPORT_UPLOAD_FORMATS.map((format) => html`<li>${format.label}</li>`),
  )}</ul>`,
  field(
    'Export',
    html`<input class="db-input" type="file" name="file" accept=".zip,.md,.mdx,.markdown,.html,.htm,application/zip">`,
  ),
)}
${card(
  'Or read a public help center',
  null,
  html`<ul style="margin:0 0 12px;padding-inline-start:18px;font-size:13.5px">${join(
    IMPORT_URL_SOURCES.map((source) => html`<li>${source.label}</li>`),
  )}</ul>`,
  field(
    'Address',
    textInput('url', '', { placeholder: 'https://acme.zendesk.com/hc/en-us' }),
    'Leave it empty when you upload an export.',
  ),
)}
${card(
  'Then',
  null,
  html`${checkbox('draft', 'Import every article as a draft', 'Publish each one once it has been checked.')}
  ${checkbox('force', 'Replace articles already here', 'An imported article with the same name takes the place of the one here.')}
  <p class="db-field__hint" style="margin:10px 0 12px">Published articles go live in the help center and the agent as soon as the import finishes. Images are brought over, and every old address is sent on to its new article.</p>
  ${button('Import', { glyph: 'download', tone: 'primary', type: 'submit' })}
  <div class="db-evalprogress" hidden aria-live="polite">
    <progress max="1"></progress>
    <span class="db-evalprogress__text">Starting…</span>
  </div>`,
)}
</form>
</div>
${clientScript(context, 'knowledge-import')}`;
}

function checkbox(name: string, title: string, hint: string): RawHtml {
  return html`<label class="db-switch">
    <input type="checkbox" name="${name}" value="1">
    <span class="db-switch__text">
      <span class="db-switch__title">${title}</span>
      <span class="db-switch__hint" style="display:block">${hint}</span>
    </span>
  </label>`;
}

/** A reader's warning in this page's words: the crawl's mentions a CLI flag. */
function warningText(warning: string): string {
  return warning.replace(/;s*pass --max to read more./, '.');
}

function summary(context: DashboardContext, outcome: ImportSummary): RawHtml {
  const { written, found, source, warnings, indexed } = outcome;
  const count = written.written.length;
  const already = written.skipped.filter((skip) => skip.reason.startsWith('already exists')).length;
  const other = written.skipped.filter((skip) => !skip.reason.startsWith('already exists'));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return html`
${
  count > 0
    ? notice(
        'good',
        indexed
          ? `Imported ${plural(count, 'article', 'articles')}, and indexed: published ones are live now.`
          : `Imported ${plural(count, 'article', 'articles')}.`,
      )
    : notice(
        'warn',
        found === 0
          ? source === 'crawl'
            ? 'Nothing to import was found there. Only public https:// addresses are read, and a page needs a few paragraphs to count as an article.'
            : 'Nothing to import was found there.'
          : 'Nothing new was imported: every article is already here.',
      )
}
${card(
  'What happened',
  null,
  html`<dl class="db-kv">
    <dt>Found</dt><dd>${plural(found, 'article', 'articles')}</dd>
    <dt>Imported</dt><dd>${plural(count, 'article', 'articles')}${
      written.collections.length > 0 ? ` in ${written.collections.join(', ')}` : ''
    }</dd>
    <dt>Already here</dt><dd>${already > 0 ? `${plural(already, 'article', 'articles')}, left as they were` : 'none'}</dd>
    <dt>Images</dt><dd>${written.images.saved} brought over${
      written.images.failed > 0 ? `, ${written.images.failed} left at their old address` : ''
    }</dd>
    <dt>Redirects</dt><dd>${
      written.redirects > 0
        ? html`${plural(written.redirects, 'old address', 'old addresses')} sent on. <a href="${context.basePath}/knowledge/_redirects">See them</a>`
        : 'none'
    }</dd>
  </dl>
  ${
    indexed?.embeddingError
      ? html`<p class="db-field__hint">Indexed for text search. Semantic search could not be updated just now; it catches up the next time the articles are indexed.</p>`
      : null
  }`,
)}
${
  other.length > 0 || warnings.length > 0
    ? card(
        'Worth a look',
        null,
        html`<ul style="margin:0;padding-inline-start:18px;font-size:13.5px">${join([
          ...other
            .slice(0, 20)
            .map((skip) => html`<li><code>${skip.path}</code>: ${skip.reason}</li>`),
          ...warnings.slice(0, 20).map((warning) => html`<li>${warningText(warning)}</li>`),
        ])}</ul>`,
      )
    : null
}
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
  ${button('See the articles', { href: `${context.basePath}/knowledge`, glyph: 'article', tone: 'primary' })}
  ${button('Import something else', { href: `${context.basePath}/knowledge/_import`, glyph: 'download' })}
</div>`;
}

function ndjson(lines: Record<string, unknown>[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
