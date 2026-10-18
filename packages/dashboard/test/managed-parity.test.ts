/**
 * What an install with managed content (a hosted one, embedded in the
 * host's own shell) can do that it could not before: upload images in the
 * article editor, restore an article's old version, keep redirects, import
 * from another help centre, read its reports and run its webhooks. Each is
 * tried the way a host mounts the dashboard (embedded, a pages allow-list,
 * `contentMode: 'managed'`, a content source), and where it matters, the
 * way a repo install has it too.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HelpWellError } from '@helpwell/core';
import { FakeModel } from '@helpwell/core/agent';
import {
  type AssetStore,
  CONTENT_REDIRECTS_PATH,
  createMemoryContentSource,
  readContentRedirects,
  writeContentRedirects,
} from '@helpwell/core/content';
import { type Db, rowsOf, schema } from '@helpwell/core/db';
import { listArticleVersions } from '@helpwell/core/repos';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipOf } from '../../core/test/helpers/zip.js';
import { clientScriptFile } from '../src/client/index.js';
import {
  createDashboard,
  type DashboardConfig,
  type ImportJobContext,
  type ImportJobRequest,
  type ImportJobs,
  type NavKey,
  runImportJob,
} from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/app/p/1';
const API = '/p/1/api';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 2]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

/** Every page a host could embed. */
const ALL: NavKey[] = ['knowledge', 'reports', 'settings', 'webhooks'];

let db: Db;

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function file(title: string, body: string): string {
  return `---\ntitle: ${title}\n---\n\n${body}\n`;
}

/** A dashboard mounted the way a host mounts it for one hosted install. */
async function hosted(extra: Partial<DashboardConfig> = {}) {
  const content = createMemoryContentSource({
    'billing/refunds.md': file('Refunds', 'Within 30 days.'),
  });
  await syncContent(db, content, { media: { apiPath: API } });
  const dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: API,
    isAdmin: () => true,
    env: {},
    embedded: true,
    contentMode: 'managed',
    pages: ALL,
    content,
    ...extra,
  });
  const request = (path: string, init?: RequestInit) =>
    dashboard(new Request(`${ORIGIN}${BASE}${path}`, init));
  return {
    content,
    request,
    get: (path: string) => request(path),
    text: async (path: string) => (await request(path)).text(),
    post: (path: string, fields: Record<string, string | string[]>) => {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(fields)) {
        for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
      }
      return request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
        body,
      });
    },
    postForm: (path: string, form: FormData, headers: Record<string, string> = {}) =>
      request(path, { method: 'POST', headers: { origin: ORIGIN, ...headers }, body: form }),
  };
}

function imageForm(bytes: Uint8Array<ArrayBuffer>, name: string): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type: 'image/png' }));
  form.append('path', 'billing/refunds.md');
  return form;
}

/* ---------------------------------------------------------------- images */

describe('images in the article editor', () => {
  it('uploads through the content source and answers with the Markdown to insert', async () => {
    const app = await hosted();
    const editor = await app.text('/knowledge/billing/refunds?edit=1');
    expect(editor).toContain(`data-upload="${BASE}/knowledge/_upload"`);
    expect(editor).toContain('data-image-picker');
    expect(editor).toContain(`${BASE}/_assets/${clientScriptFile('article-images')}`);
    expect(editor).toContain('Paste, drop or pick an image');

    const response = await app.postForm('/knowledge/_upload', imageForm(PNG, 'billing page.png'));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string>;
    expect(body.markdown).toMatch(/^!\[billing page\]\(\.\.\/_media\/[0-9a-f]{24}\.png\)$/);
    expect(body.src).toBe(`${API}/media/${body.path}`);
    expect(await app.content.read(body.path!)).toEqual(PNG);

    // Saved into the article, the image is indexed at the API's media URL.
    const saved = await app.post('/knowledge/billing/refunds', {
      title: 'Refunds',
      description: '',
      status: 'published',
      body: `Within 30 days.\n\n${body.markdown}`,
      action: 'save',
    });
    expect(saved.status).toBe(303);
    const [row] = rowsOf<{ body: string }>(
      await db.execute(sql`SELECT body FROM helpwell.article_index WHERE slug = 'billing/refunds'`),
    );
    expect(row?.body).toContain(`](${API}/media/${body.path})`);
  });

  it('refuses SVG, anything that is not an image, and one over the limit, saying why', async () => {
    const app = await hosted();
    const svg = await app.postForm('/knowledge/_upload', imageForm(SVG, 'logo.svg'));
    expect(svg.status).toBe(415);
    expect(((await svg.json()) as { error: string }).error).toContain('SVG');
    const text = await app.postForm(
      '/knowledge/_upload',
      imageForm(new TextEncoder().encode('hi'), 'a.png'),
    );
    expect(text.status).toBe(415);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    const large = await app.postForm('/knowledge/_upload', imageForm(big, 'big.png'));
    expect(large.status).toBe(413);
    expect(app.content.files.size).toBe(1);
  });

  it('uses the URL a host’s own asset store answers with', async () => {
    const cdn: AssetStore = {
      put: async (asset) => ({ url: `https://cdn.example.com/acme/${asset.path}` }),
    };
    const app = await hosted({ assetStore: cdn });
    const response = await app.postForm('/knowledge/_upload', imageForm(PNG, 'shot.png'));
    const body = (await response.json()) as Record<string, string>;
    expect(body.markdown).toMatch(
      /^!\[shot\]\(https:\/\/cdn\.example\.com\/acme\/_media\/[0-9a-f]{24}\.png\)$/,
    );
    expect(body.src).toBe(body.url);
  });

  it('says why when the host’s store refuses, and never what a failure said inside', async () => {
    const full: AssetStore = {
      put: async () => {
        throw new HelpWellError('forbidden', 'quota', {
          publicMessage: 'This product has used its 1 GB of images.',
        });
      },
    };
    const refused = await (await hosted({ assetStore: full })).postForm(
      '/knowledge/_upload',
      imageForm(PNG, 'a.png'),
    );
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe(
      'This product has used its 1 GB of images.',
    );
    const broken: AssetStore = {
      put: async () => {
        throw new Error('ECONNRESET s3.internal:9000 secret-bucket');
      },
    };
    const failed = await (await hosted({ assetStore: broken })).postForm(
      '/knowledge/_upload',
      imageForm(PNG, 'a.png'),
    );
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('secret-bucket');
  });

  it('offers no upload where images cannot be kept', async () => {
    const readOnly = { ...createMemoryContentSource(), write: undefined, remove: undefined };
    const app = await hosted({ content: readOnly, writeArticle: undefined });
    const editor = await app.text('/knowledge/new');
    expect(editor).not.toContain('data-upload=');
    expect(editor).not.toContain(clientScriptFile('article-images'));
    expect((await app.postForm('/knowledge/_upload', imageForm(PNG, 'a.png'))).status).toBe(501);
    const off = await hosted({ assetStore: false });
    expect(await off.text('/knowledge/new')).not.toContain('data-upload=');
  });

  it('keeps an upload in the docs folder of a repo install, where the screenshots are', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'helpwell-editor-images-'));
    try {
      const dashboard = createDashboard({
        db,
        basePath: '/admin/helpwell',
        isAdmin: () => true,
        env: {},
        docsDir: join(dir, 'docs'),
        writeArticle: () => {},
      });
      const form = imageForm(PNG, 'shot.png');
      const response = await dashboard(
        new Request(`${ORIGIN}/admin/helpwell/knowledge/_upload`, {
          method: 'POST',
          headers: { origin: ORIGIN },
          body: form,
        }),
      );
      expect(response.status).toBe(201);
      const { path } = (await response.json()) as { path: string };
      expect(new Uint8Array(readFileSync(join(dir, 'docs', ...path.split('/'))))).toEqual(PNG);
      // The screenshot card, capture prompts and all, is still there.
      const editor = await (
        await dashboard(new Request(`${ORIGIN}/admin/helpwell/knowledge/new`))
      ).text();
      expect(editor).toContain('helpwell capture');
      expect(editor).toContain('under _media');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* --------------------------------------------------------------- restore */

describe('restoring a version', () => {
  it('offers Restore on an older version, and saves it as the newest', async () => {
    const app = await hosted();
    await app.post('/knowledge/billing/refunds', {
      title: 'Refunds',
      description: '',
      status: 'published',
      body: 'Within 60 days.',
      action: 'save',
    });
    const versions = await listArticleVersions(db, 'billing/refunds');
    expect(versions).toHaveLength(2);
    const [newest, oldest] = versions as [(typeof versions)[0], (typeof versions)[0]];

    expect(await app.text(`/knowledge/billing/refunds?compare=${newest.id}`)).not.toContain(
      'Restore this version',
    );
    const page = await app.text(`/knowledge/billing/refunds?compare=${oldest.id}`);
    expect(page).toContain('Restore this version');
    expect(page).toContain(`name="version" value="${oldest.id}"`);

    const restored = await app.post('/knowledge/billing/refunds', {
      action: 'restore',
      version: String(oldest.id),
    });
    expect(restored.status).toBe(303);
    expect(restored.headers.get('location')).toBe(
      `${BASE}/knowledge/billing/refunds?restored=${oldest.id}`,
    );
    expect(await app.content.readText('billing/refunds.md')).toContain('Within 30 days.');
    const after = await app.text(restored.headers.get('location')!.slice(BASE.length));
    expect(after).toContain('Restored the version from');
    expect(after).toContain('Restored from');
    expect(await listArticleVersions(db, 'billing/refunds')).toHaveLength(3);

    // Restoring what it already says changes nothing, and says so.
    const same = await app.post('/knowledge/billing/refunds', {
      action: 'restore',
      version: String(oldest.id),
    });
    expect(same.headers.get('location')).toContain('restored=same');
    expect(await app.text('/knowledge/billing/refunds?restored=same')).toContain(
      'That version is what the article says now',
    );
  });

  it('says why when a version cannot be restored, without putting the reason in a URL', async () => {
    const app = await hosted();
    const response = await app.post('/knowledge/billing/refunds', {
      action: 'restore',
      version: '9999',
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Nothing was restored.');
  });

  it('offers no Restore where the article cannot be saved', async () => {
    const readOnly = { ...createMemoryContentSource(), write: undefined, remove: undefined };
    const app = await hosted({ content: readOnly });
    const versions = await listArticleVersions(db, 'billing/refunds');
    expect(await app.text(`/knowledge/billing/refunds?compare=${versions[0]!.id}`)).not.toContain(
      'Restore this version',
    );
  });
});

/* ------------------------------------------------------------- redirects */

describe('the Redirects screen', () => {
  it('adds, lists and removes a redirect to an article, which the map then holds', async () => {
    const app = await hosted();
    expect(await app.text('/knowledge')).toContain(`href="${BASE}/knowledge/_redirects"`);
    expect(await app.text('/knowledge/_redirects')).toContain('No redirects yet');

    const added = await app.post('/knowledge/_redirects', {
      action: 'add',
      from: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
      slug: 'billing/refunds',
    });
    expect(added.status).toBe(303);
    expect(await readContentRedirects(app.content)).toEqual([
      {
        from: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
        to: '/help/billing/refunds',
      },
    ]);
    const page = await app.text('/knowledge/_redirects?done=added');
    expect(page).toContain('Added.');
    expect(page).toContain(`<a href="${BASE}/knowledge/billing/refunds">Refunds</a>`);

    await app.post('/knowledge/_redirects', {
      action: 'remove',
      from: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
    });
    expect(await readContentRedirects(app.content)).toEqual([]);
  });

  it('refuses an address that is not one, and a target that is not an article here', async () => {
    const app = await hosted();
    const bad = await app.post('/knowledge/_redirects', {
      action: 'add',
      from: 'javascript:alert(1)',
      slug: 'https://evil.test',
    });
    expect(bad.status).toBe(400);
    const page = await bad.text();
    expect(page).toContain('Give the old address as a full URL');
    expect(page).toContain('Pick the article it should go to.');
    const own = await app.post('/knowledge/_redirects', {
      action: 'add',
      from: '/help/billing/refunds',
      slug: 'billing/refunds',
    });
    expect(await own.text()).toContain('an address in this help center already');
    expect(await app.content.readText(CONTENT_REDIRECTS_PATH)).toBeNull();
  });

  it('brings in the file an importer writes, leaving out targets that could leave the site', async () => {
    const app = await hosted();
    await writeContentRedirects(app.content, [{ from: '/old/a', to: '/help/billing/refunds' }]);
    const form = new FormData();
    form.append('action', 'import');
    form.append(
      'file',
      new File(
        [
          JSON.stringify({
            redirects: [
              { from: '/old/b', to: '/help/billing/refunds' },
              { from: '/old/c', to: 'https://evil.test/' },
              { from: '/old/d', to: '//evil.test' },
              { from: 'javascript:x', to: '/help/billing/refunds' },
            ],
          }),
        ],
        'redirects.json',
        { type: 'application/json' },
      ),
    );
    const response = await app.postForm('/knowledge/_redirects', form);
    expect(response.headers.get('location')).toBe(`${BASE}/knowledge/_redirects?done=imported-1-3`);
    expect((await readContentRedirects(app.content)).map((rule) => rule.from)).toEqual([
      '/old/a',
      '/old/b',
    ]);
    expect(await app.text('/knowledge/_redirects?done=imported-1-3')).toContain('3 were left out');

    const junk = new FormData();
    junk.append('action', 'import');
    junk.append('json', 'not json');
    expect(await (await app.postForm('/knowledge/_redirects', junk)).text()).toContain(
      'That is not a redirects file.',
    );
  });

  it('says where redirects live in a repo, and changes nothing there', async () => {
    const app = await hosted({ contentMode: 'repo' });
    const page = await app.text('/knowledge/_redirects');
    expect(page).toContain('helpwell/redirects.json');
    expect(page).not.toContain('Add a redirect');
    expect(await app.text('/knowledge')).not.toContain('/knowledge/_redirects');
    const refused = await app.post('/knowledge/_redirects', {
      action: 'add',
      from: '/old',
      slug: 'billing/refunds',
    });
    expect(refused.status).toBe(400);
    expect(await app.content.readText(CONTENT_REDIRECTS_PATH)).toBeNull();
  });
});

/* ---------------------------------------------------------------- import */

describe('importing from another help center', () => {
  const zip = () =>
    zipOf({
      'export/getting-started/welcome.md': '# Welcome\n\nHello there.\n\n![Home](img/home.png)',
      'export/getting-started/img/home.png': PNG,
      'export/billing/refunds.md': '# Refunds\n\nImported words.',
    });

  function importForm(fields: {
    file?: Uint8Array<ArrayBuffer>;
    url?: string;
    draft?: boolean;
    force?: boolean;
  }) {
    const form = new FormData();
    if (fields.file)
      form.append('file', new File([fields.file], 'export.zip', { type: 'application/zip' }));
    form.append('url', fields.url ?? '');
    if (fields.draft) form.append('draft', '1');
    if (fields.force) form.append('force', '1');
    return form;
  }

  it('takes an uploaded export: articles, images and the index, with a summary', async () => {
    const app = await hosted();
    const page = await app.text('/knowledge/_import');
    expect(page).toContain('A Notion export');
    expect(page).toContain('A Zendesk help center');
    // The product says "help center", on every screen.
    expect(page).not.toMatch(/help centre/i);
    expect(await app.text('/knowledge/_redirects')).not.toMatch(/help centre/i);
    expect(page).toContain(clientScriptFile('knowledge-import'));

    const response = await app.postForm('/knowledge/_import', importForm({ file: zip() }));
    expect(response.status).toBe(200);
    const summary = await response.text();
    expect(summary).toContain('Imported 1 article, and indexed');
    expect(summary).toContain('1 article, left as they were');
    expect(summary).toContain('1 brought over');

    const welcome = (await app.content.readText('getting-started/welcome.md')) ?? '';
    expect(welcome).toMatch(/!\[Home\]\(\.\.\/_media\/[0-9a-f]{24}\.png\)/);
    // The article already here is left alone.
    expect(await app.content.readText('billing/refunds.md')).toContain('Within 30 days.');
    const [row] = rowsOf<{ status: string }>(
      await db.execute(
        sql`SELECT status FROM helpwell.article_index WHERE slug = 'getting-started/welcome'`,
      ),
    );
    expect(row?.status).toBe('published');
  });

  it('streams its progress to the page, and ends with the summary to show', async () => {
    const app = await hosted();
    const response = await app.postForm(
      '/knowledge/_import',
      importForm({ file: zip(), draft: true, force: true }),
      {
        accept: 'application/x-ndjson',
      },
    );
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; text?: string; html?: string });
    expect(lines.filter((line) => line.type === 'progress').map((line) => line.text)).toEqual(
      expect.arrayContaining(['Reading the export…', 'Indexing the knowledge base…']),
    );
    const done = lines.at(-1)!;
    expect(done.type).toBe('done');
    expect(done.html).toContain('Imported 2 articles');
    // Replaced, as asked, and as drafts.
    expect(await app.content.readText('billing/refunds.md')).toContain('Imported words.');
    expect(await app.content.readText('billing/refunds.md')).toContain('status: draft');
  });

  describe('run as the host’s own jobs', () => {
    /** Lines of an ndjson stream. */
    const lines = async (response: Response) =>
      (await response.text())
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as { type: string; text?: string; html?: string; message?: string },
        );

    it('hands the checked form to start, and streams what watch says to the same page', async () => {
      const started: { request: ImportJobRequest; context: ImportJobContext }[] = [];
      const importJobs: ImportJobs = {
        async start(request, context) {
          started.push({ request, context });
          return { id: 'job_1' };
        },
        async *watch(id) {
          expect(id).toBe('job_1');
          yield { type: 'progress', text: 'Queued on a worker' };
          yield { type: 'progress', text: 'Writing 1 of 2: Welcome', done: 0, total: 2 };
          yield {
            type: 'done',
            summary: {
              source: 'markdown',
              found: 2,
              written: {
                written: ['getting-started/welcome.md', 'billing/refunds.md'],
                skipped: [],
                collections: ['getting-started', 'billing'],
                redirects: 0,
                images: { saved: 1, failed: 0 },
              },
              indexed: { articles: 2, embeddingError: null },
              warnings: [],
            },
          };
          throw new Error('never read past done');
        },
      };
      const app = await hosted({ importJobs });
      const response = await app.postForm(
        '/knowledge/_import',
        importForm({ file: zip(), draft: true }),
        { accept: 'application/x-ndjson' },
      );
      const events = await lines(response);
      expect(events.filter((e) => e.type === 'progress').map((e) => e.text)).toEqual([
        'Queued on a worker',
        'Writing 1 of 2: Welcome',
      ]);
      expect(events.at(-1)?.type).toBe('done');
      expect(events.at(-1)?.html).toContain('Imported 2 articles, and indexed');

      // The request as the form asked, checked; the dashboard wrote nothing itself.
      expect(started).toHaveLength(1);
      expect(started[0]?.request).toMatchObject({
        address: null,
        draft: true,
        force: false,
        upload: { name: 'export.zip' },
      });
      expect(started[0]?.request.upload?.bytes.length).toBeGreaterThan(0);
      expect(started[0]?.context).toMatchObject({ basePath: BASE, apiPath: API });
      expect(started[0]?.context.request).toBeInstanceOf(Request);
      expect(await app.content.readText('getting-started/welcome.md')).toBeNull();
    });

    it('lets a worker run the import the dashboard would have, with runImportJob', async () => {
      let config: DashboardConfig | null = null;
      const pending = new Map<string, ImportJobRequest>();
      const importJobs: ImportJobs = {
        async start(request) {
          pending.set('job_2', request);
          return { id: 'job_2' };
        },
        async *watch(id, context) {
          const steps: string[] = [];
          const summary = await runImportJob(config!, pending.get(id)!, {
            apiPath: context.apiPath,
            onProgress: (progress) => steps.push(progress.text),
          });
          for (const text of steps) yield { type: 'progress', text };
          yield { type: 'done', summary };
        },
      };
      const app = await hosted({ importJobs });
      config = { db, apiPath: API, content: app.content, env: {} };
      const page = await (
        await app.postForm('/knowledge/_import', importForm({ file: zip() }))
      ).text();
      expect(page).toContain('Imported 1 article, and indexed');
      expect(await app.content.readText('getting-started/welcome.md')).toContain('Hello there.');
    });

    it('shows a job’s own error, and says so when a job ends without a result', async () => {
      const failing: ImportJobs = {
        start: async () => ({ id: 'job_3' }),
        async *watch() {
          yield { type: 'progress', text: 'Reading the export…' };
          yield { type: 'error', message: 'The worker ran out of time. Try a smaller export.' };
        },
      };
      const app = await hosted({ importJobs: failing });
      const streamed = await lines(
        await app.postForm('/knowledge/_import', importForm({ file: zip() }), {
          accept: 'application/x-ndjson',
        }),
      );
      expect(streamed.at(-1)).toEqual({
        type: 'error',
        message: 'The worker ran out of time. Try a smaller export.',
      });

      const silent = await hosted({
        importJobs: { start: async () => ({ id: 'job_4' }), async *watch() {} },
      });
      const page = await silent.postForm('/knowledge/_import', importForm({ file: zip() }));
      expect(page.status).toBe(400);
      expect(await page.text()).toContain('The import stopped part way');

      const refused = await hosted({
        importJobs: {
          start: async () => {
            throw new HelpWellError('rate_limited', 'too many', {
              publicMessage: 'One import at a time. Wait for the last one to finish.',
            });
          },
          async *watch() {},
        },
      });
      const busy = await refused.postForm('/knowledge/_import', importForm({ file: zip() }));
      expect(await busy.text()).toContain('One import at a time.');
    });

    it('offers the form when the host runs imports, even with no writable content here', async () => {
      const readOnly = createMemoryContentSource({});
      const app = await hosted({
        content: { ...readOnly, write: undefined, remove: undefined },
        importJobs: { start: async () => ({ id: 'x' }), async *watch() {} },
      });
      const page = await app.text('/knowledge/_import');
      expect(page).toContain('data-import');
      const without = await hosted({
        content: { ...readOnly, write: undefined, remove: undefined },
      });
      expect(await without.text('/knowledge/_import')).not.toContain('data-import');
    });
  });

  it('reads a public Zendesk help centre through the host’s fetch, redirects and all', async () => {
    const base = 'https://acme.zendesk.com/api/v2/help_center/en-us';
    const asked: string[] = [];
    const importFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      const reply = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (url === `${base}/sections.json?per_page=100`) {
        return reply({ sections: [{ id: 1, name: 'Account' }], next_page: null });
      }
      if (url === `${base}/articles.json?per_page=100`) {
        return reply({
          articles: [
            {
              title: 'Changing your email',
              body: '<p>Open Settings.</p><img src="https://cdn.test/s.png" alt="Settings">',
              html_url: 'https://acme.zendesk.com/hc/en-us/articles/7-Changing-your-email',
              section_id: 1,
              draft: false,
            },
          ],
          next_page: null,
        });
      }
      if (url === 'https://cdn.test/s.png') {
        return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const global = vi.fn(async () => new Response('no'));
    vi.stubGlobal('fetch', global);

    const app = await hosted({ importFetch });
    const response = await app.postForm(
      '/knowledge/_import',
      importForm({ url: 'https://acme.zendesk.com/hc/en-us' }),
    );
    const summary = await response.text();
    expect(summary).toContain('Imported 1 article');
    expect(summary).toContain('1 old address sent on');
    expect(asked).toContain('https://cdn.test/s.png');
    expect(global).not.toHaveBeenCalled();
    expect(await readContentRedirects(app.content)).toEqual([
      {
        from: 'https://acme.zendesk.com/hc/en-us/articles/7-Changing-your-email',
        to: '/help/account/changing-your-email',
      },
    ]);
  });

  it('says what is wrong with an upload it cannot read', async () => {
    const app = await hosted();
    const nothing = await app.postForm('/knowledge/_import', importForm({}));
    expect(await nothing.text()).toContain('Choose an export to upload');
    const junk = await app.postForm(
      '/knowledge/_import',
      importForm({ file: new TextEncoder().encode('not a zip') }),
    );
    expect(junk.status).toBe(400);
    expect(await junk.text()).toContain('not a ZIP archive');
  });

  it('points a repo install at the CLI, and imports nothing there', async () => {
    const app = await hosted({ contentMode: 'repo' });
    expect(await app.text('/knowledge/_import')).toContain('npx helpwell import');
    const refused = await app.postForm('/knowledge/_import', importForm({ file: zip() }));
    expect(refused.status).toBe(400);
    expect(await app.content.readText('getting-started/welcome.md')).toBeNull();
  });
});

/* --------------------------------------------------------------- reports */

describe('Reports, embedded for a managed install', () => {
  /** A conversation whose answer cited the article, so the report has a row for it. */
  async function cited() {
    await db
      .insert(schema.conversations)
      .values({ id: 'cnv_1', status: 'resolved', messageCount: 2 });
    await db.insert(schema.messages).values([
      { id: 'msg_1', conversationId: 'cnv_1', role: 'customer', body: 'Refunds?' },
      {
        id: 'msg_2',
        conversationId: 'cnv_1',
        role: 'agent',
        body: 'Within 30 days.',
        citations: [{ slug: 'billing/refunds', title: 'Refunds', collection: 'billing' }],
        feedback: 'helpful',
      },
    ]);
  }

  it('renders with only the pages the host allows, and exports its CSV itself', async () => {
    const chat = new FakeModel();
    const app = await hosted({
      pages: ['reports', 'settings'],
      modelFactory: (purpose) => (purpose === 'chat' ? chat : null),
    });
    await cited();
    const response = await app.get('/reports');
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('<body class="db-embedded" data-page="reports">');
    expect(page).toContain(`href="${BASE}/reports/export?range=30d"`);
    // Models come from the host here, not a key of the install's own.
    expect(page).not.toContain('OpenRouter');
    expect(page).not.toContain(`href="${API}/admin/reports/export`);
    // The article is named; the knowledge base is not a page here, so it is not a link.
    expect(page).toContain('<td>Refunds</td>');
    expect(page).not.toContain(`href="${BASE}/knowledge/`);

    const csv = await app.get('/reports/export?range=90d');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect((await csv.text()).startsWith('day,conversations,resolved,cost_usd')).toBe(true);
  });

  it('links an article when the knowledge base is one of the pages, and says Settings only then', async () => {
    const app = await hosted({ pages: ['reports', 'knowledge'] });
    await cited();
    await new SettingsStore(db).update({ agent: { spend: { dailyCapUsd: 0.001 } } });
    await db.insert(schema.spendLedger).values({
      id: 'spn_1',
      day: new Date().toISOString().slice(0, 10),
      kind: 'chat',
      model: 'm',
      costUsd: '1.00',
    });
    const page = await app.text('/reports');
    expect(page).toContain(`<a href="${BASE}/knowledge/billing/refunds">Refunds</a>`);
    expect(page).toContain('The daily spend cap');
    expect(page).not.toContain('raise the cap in Settings');
    // A repo install with its own key is told where the key and the cap are.
    const own = await hosted({ embedded: false, pages: undefined, contentMode: 'repo' });
    const full = await own.text('/reports');
    expect(full).toContain('from your own OpenRouter key');
    expect(full).toContain('raise the cap in Settings');
  });
});

/* -------------------------------------------------------------- webhooks */

describe('Webhooks, embedded for a managed install', () => {
  it('adds one with a secret shown once, sends a test through webhookFetch, pauses and removes it', async () => {
    const sent: { url: string; event: string; signature: string | null }[] = [];
    const webhookFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(input),
        event: (JSON.parse(String(init?.body)) as { event: string }).event,
        signature: new Headers(init?.headers).get('x-helpwell-signature'),
      });
      return new Response('ok');
    }) as typeof fetch;
    const global = vi.fn(async () => new Response('no'));
    vi.stubGlobal('fetch', global);
    const app = await hosted({ webhookFetch });

    const empty = await app.text('/webhooks');
    expect(empty).toContain('<body class="db-embedded" data-page="webhooks">');
    expect(empty).toContain('Add a webhook');
    expect(empty).not.toContain('data-config-only="webhooks"');
    // The prompt for building a receiver says where a managed install adds one.
    expect(empty).toContain('Tell me to add the endpoint on the Webhooks page');
    expect(empty).not.toContain('helpwell/helpwell.config.json');

    const added = await app.post('/webhooks', {
      action: 'webhook-add',
      url: 'https://hooks.example.com/in',
      events: ['gap.created', 'article.published', 'not.an.event'],
    });
    // The secret is drawn on this page, never carried in a redirect.
    expect(added.status).toBe(200);
    const shown = await added.text();
    const secret = /id="db-webhook-secret"[^>]*>(whsec_[A-Za-z0-9_-]+)</.exec(shown)?.[1];
    expect(secret).toBeTruthy();
    const settings = await new SettingsStore(db).get();
    expect(settings.webhooks).toEqual([
      {
        url: 'https://hooks.example.com/in',
        events: ['gap.created', 'article.published'],
        secret,
        active: true,
      },
    ]);
    const later = await app.text('/webhooks');
    expect(later).not.toContain(secret!);
    expect(later).toContain('hooks.example.com');

    const test = await app.post('/webhooks', { action: 'webhook-test' });
    expect(test.status).toBe(303);
    expect(sent.map((s) => s.event)).toEqual(['webhook.test']);
    expect(global).not.toHaveBeenCalled();
    expect(await app.text(test.headers.get('location')!.slice(BASE.length))).toContain(
      '1 delivered, 0 failed',
    );

    const identify = { index: '0', url: 'https://hooks.example.com/in' };
    await app.post('/webhooks', { action: 'webhook-toggle', ...identify });
    expect((await new SettingsStore(db).get()).webhooks[0]?.active).toBe(false);
    const rekeyed = await (
      await app.post('/webhooks', { action: 'webhook-secret', ...identify })
    ).text();
    const fresh = /id="db-webhook-secret"[^>]*>(whsec_[A-Za-z0-9_-]+)</.exec(rekeyed)?.[1];
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(secret);
    // An action on a list that has changed since the page was drawn does nothing.
    const stale = await app.post('/webhooks', {
      action: 'webhook-remove',
      index: '0',
      url: 'https://other.example.com',
    });
    expect(stale.headers.get('location')).toContain('done=stale');
    await app.post('/webhooks', { action: 'webhook-remove', ...identify });
    expect((await new SettingsStore(db).get()).webhooks).toEqual([]);
  });

  it('holds a new webhook to the guard: https, a public address, and one per address', async () => {
    const app = await hosted();
    for (const [url, words] of [
      ['http://hooks.example.com/in', 'only sent over https'],
      ['https://localhost:4000/in', 'not a public address'],
      ['https://10.0.0.8/in', 'not a public address'],
      ['not a url', 'not a web address'],
    ] as const) {
      const response = await app.post('/webhooks', { action: 'webhook-add', url });
      expect(response.status, url).toBe(400);
      expect(await response.text(), url).toContain(words);
    }
    expect((await new SettingsStore(db).get()).webhooks).toEqual([]);
    await app.post('/webhooks', { action: 'webhook-add', url: 'https://hooks.example.com/in' });
    const again = await app.post('/webhooks', {
      action: 'webhook-add',
      url: 'https://hooks.example.com/in',
    });
    expect(await again.text()).toContain('There is a webhook for that address already.');

    // With the guard off for local development, a local address is fine.
    const local = await hosted({ webhookFetch: false });
    expect(
      (await local.post('/webhooks', { action: 'webhook-add', url: 'http://localhost:4000/in' }))
        .status,
    ).toBe(200);
  });

  it('lists a repo install’s webhooks, says they are config-only, and edits nothing', async () => {
    await new SettingsStore(db).update({
      webhooks: [{ url: 'https://hooks.example.com/in', events: [], secret: 's', active: true }],
    });
    const app = await hosted({ contentMode: 'repo' });
    const page = await app.text('/webhooks');
    expect(page).toContain('data-config-only="webhooks"');
    expect(page).toContain('helpwell.config.json');
    expect(page).not.toContain('value="webhook-add"');
    expect(page).not.toContain('value="webhook-remove"');
    const refused = await app.post('/webhooks', {
      action: 'webhook-remove',
      index: '0',
      url: 'https://hooks.example.com/in',
    });
    expect(refused.status).toBe(303);
    expect((await new SettingsStore(db).get()).webhooks).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------- CSP */

describe('the new screens', () => {
  it('carry no inline script, so the dashboard’s script-src self still holds', async () => {
    const app = await hosted();
    for (const path of [
      '/knowledge',
      '/knowledge/billing/refunds?edit=1',
      '/knowledge/_redirects',
      '/knowledge/_import',
      '/reports',
      '/webhooks',
    ]) {
      const response = await app.get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-security-policy'), path).toContain("script-src 'self'");
      const page = await response.text();
      for (const tag of page.match(/<script\b[^>]*>/g) ?? []) {
        expect(tag, path).toMatch(/ src="\/app\/p\/1\/_assets\/[a-z-]+\.[0-9a-f]{12}\.js"/);
      }
      expect(page, path).not.toMatch(/\son[a-z]+="/);
    }
  });
});
