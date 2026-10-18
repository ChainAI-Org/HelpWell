/**
 * The article editor, its live preview, and article history in the
 * dashboard: saving through the host's `writeArticle` hook and re-indexing,
 * handing the file back when there is no hook, and the diff between versions.
 */

import { FakeModel } from '@helpwell/core/agent';
import { EMPTY_ARTICLE_MESSAGE, parseArticle } from '@helpwell/core/content';
import { type Db, schema } from '@helpwell/core/db';
import { indexArticles, indexCollections } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';

const INVOICES = `---
title: Exporting invoices
description: Download a PDF.
order: 3
appliesTo: Pro
status: published
---

Refunds are issued within 14 days.

> [!TIP]
> Export before you close the month.

![Billing](../_screenshots/billing.png)
`;

let db: Db;
let written: Map<string, string>;
let dashboard: DashboardHandler;
let bare: DashboardHandler;

function mount(writeArticle?: (path: string, markdown: string) => void): DashboardHandler {
  return createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    repoUrlTemplate: 'https://github.com/acme/app/blob/main/docs/{path}',
    docsDir: 'docs',
    writeArticle,
    // No key, whatever this machine has set: a save with one embeds.
    env: {},
  });
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });

  written = new Map();
  dashboard = mount((path, markdown) => {
    written.set(path, markdown);
  });
  bare = mount();

  await indexArticles(db, [parseArticle(INVOICES, { collection: 'billing', file: 'invoices.md' })]);
  await indexCollections(db, [
    {
      id: 'billing',
      title: 'Billing',
      description: null,
      icon: 'book-open',
      tint: 'lavender',
      order: 1,
      askAgent: true,
      visibility: 'public',
      articles: [],
    },
  ]);
});

function get(path: string, handler = dashboard, admin = true): Promise<Response> {
  return handler(
    new Request(`${ORIGIN}${BASE}${path}`, { headers: admin ? { 'x-admin': 'yes' } : {} }),
  );
}

function post(
  path: string,
  fields: Record<string, string>,
  handler = dashboard,
  headers: Record<string, string> = {},
): Promise<Response> {
  return handler(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: {
        'x-admin': 'yes',
        'content-type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(fields),
    }),
  );
}

function previewRequest(body: unknown, headers: Record<string, string> = {}, handler = dashboard) {
  return handler(
    new Request(`${ORIGIN}${BASE}/knowledge/_preview`, {
      method: 'POST',
      headers: { 'x-admin': 'yes', 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

const edit = {
  title: 'Exporting invoices',
  description: 'Download a PDF.',
  status: 'published',
  body: 'Refunds are issued within 30 days.\n\n![Billing](../_screenshots/billing.png)',
  action: 'save',
};

describe('the article page', () => {
  it('renders the article as the help centre would, with its history and an edit button', async () => {
    const page = await (await get('/knowledge/billing/invoices')).text();
    expect(page).toContain('class="hc-callout hc-callout--tip" role="note"');
    expect(page).toContain('<img src="/api/helpwell/screenshots/billing.png"');
    expect(page).toContain('History');
    expect(page).toContain('First version');
    expect(page).toContain(`href="${BASE}/knowledge/billing/invoices?edit=1"`);
    expect(page).toContain('https://github.com/acme/app/blob/main/docs/billing/invoices.md');
  });
});

describe('editing an article', () => {
  it('opens the file as written: fields from the front matter, the body with its relative paths', async () => {
    const page = await (await get('/knowledge/billing/invoices?edit=1')).text();
    expect(page).toContain('value="Exporting invoices"');
    expect(page).toContain('value="Download a PDF."');
    expect(page).toContain('<option value="published" selected>');
    expect(page).toContain('![Billing](../_screenshots/billing.png)');
    expect(page).not.toContain('appliesTo: Pro');
    expect(page).toContain('docs/billing/invoices.md');
    // The preview is rendered on the server, and resolves the screenshot.
    expect(page).toContain('id="db-preview"');
    expect(page).toContain('<img src="/api/helpwell/screenshots/billing.png"');
    expect(page).toContain(`data-preview="${BASE}/knowledge/_preview"`);
  });

  it('saves through the hook, keeping front matter it does not show, then re-indexes', async () => {
    const response = await post('/knowledge/billing/invoices', edit);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/knowledge/billing/invoices?saved=1`);

    const file = written.get('billing/invoices.md') ?? '';
    expect(file).toContain('order: 3');
    expect(file).toContain('appliesTo: Pro');
    expect(file).toContain('Refunds are issued within 30 days.');
    expect(file).toContain('![Billing](../_screenshots/billing.png)');

    const page = await (await get('/knowledge/billing/invoices?saved=1')).text();
    expect(page).toContain('Saved to the repo and re-indexed');
    expect(page).toContain('within 30 days');
    expect(page).toContain('Dashboard');
  });

  it('shows a readable diff between versions, down to the words', async () => {
    await post('/knowledge/billing/invoices', edit);
    const page = await (await get('/knowledge/billing/invoices')).text();
    const ids = [...page.matchAll(/\?compare=(\d+)/g)].map((m) => Number(m[1]));
    expect(ids).toHaveLength(2);
    const latest = Math.max(...ids);

    const diff = await (await get(`/knowledge/billing/invoices?compare=${latest}`)).text();
    expect(diff).toContain('What changed');
    expect(diff).toContain('<del class="db-diff__word">14</del>');
    expect(diff).toContain('<ins class="db-diff__word">30</ins>');
    expect(diff).toContain('db-diff__line--remove');
    expect(diff).toContain('aria-current="true"');
  });

  it('says what the save did for search, never promising what will not happen', async () => {
    const saved = async (handler: DashboardHandler, body: string) => {
      const response = await post('/knowledge/billing/invoices', { ...edit, body }, handler);
      expect(response.headers.get('location')).toContain('saved=1');
      return (await get('/knowledge/billing/invoices?saved=1', handler)).text();
    };
    const embedder = new FakeModel();
    const broken = new FakeModel();
    broken.embed = async () => {
      throw new Error('provider down');
    };
    const hosted = (embeddings: FakeModel | null) =>
      createDashboard({
        db,
        basePath: BASE,
        apiPath: '/api/helpwell',
        isAdmin: (request) => request.headers.get('x-admin') === 'yes',
        writeArticle: (path, markdown) => {
          written.set(path, markdown);
        },
        env: {},
        modelFactory: (purpose) => (purpose === 'embeddings' ? embeddings : null),
      });

    // Self-hosted with no key: text now, and the next sync with a key embeds it.
    const keyless = await saved(dashboard, 'Refunds take 30 days.');
    expect(keyless).toContain('re-indexed for text search.');
    expect(keyless).toContain('picks it up on the next helpwell sync with the model key set');

    // Self-hosted with its own key: embedded on save, as a host's factory does.
    // A stand-in for OpenRouter answers, so nothing leaves the process.
    const embeddings: string[] = [];
    let up = true;
    vi.stubGlobal('fetch', (async (url: string) => {
      embeddings.push(String(url));
      return up
        ? Response.json({ data: [{ embedding: [0.6, 0.8] }], usage: { prompt_tokens: 9 } })
        : new Response('upstream down', { status: 503 });
    }) as typeof fetch);
    try {
      const ownKey = createDashboard({
        db,
        basePath: BASE,
        apiPath: '/api/helpwell',
        isAdmin: (request) => request.headers.get('x-admin') === 'yes',
        writeArticle: (path, markdown) => {
          written.set(path, markdown);
        },
        env: {},
        openRouterKey: 'sk-or-test-not-a-real-key',
      });
      const own = await saved(ownKey, 'Refunds take 29 days.');
      expect(embeddings.filter((url) => url.endsWith('/embeddings'))).toHaveLength(1);
      expect(own).toContain('re-indexed for text and semantic search.');

      up = false;
      const down = await saved(ownKey, 'Refunds take 28 days.');
      expect(written.get('billing/invoices.md')).toContain('28 days');
      expect(down).toContain('could not be embedded just now');
    } finally {
      vi.unstubAllGlobals();
    }

    // A host's factory embeds on save, so there is nothing left to catch up.
    const embedded = await saved(hosted(embedder), 'Refunds take 31 days.');
    expect(embedder.embedRequests).toHaveLength(1);
    expect(embedded).toContain('re-indexed for text and semantic search.');
    expect(embedded).not.toContain('picks it up');

    const failed = await saved(hosted(broken), 'Refunds take 32 days.');
    expect(failed).toContain('could not be embedded just now');

    // No embeddings model at all: no promise of semantic search.
    const none = await saved(hosted(null), 'Refunds take 33 days.');
    expect(none).toContain('re-indexed for text search.');
    expect(none).not.toContain('semantic search');

    await new SettingsStore(db).update({ agent: { models: { embeddings: '' } } });
    const off = await saved(hosted(embedder), 'Refunds take 34 days.');
    expect(off).toContain('Semantic search is switched off.');
  });

  it('says so when a save changed nothing', async () => {
    const response = await post('/knowledge/billing/invoices', {
      ...edit,
      body: INVOICES.split('---\n\n')[1] ?? '',
    });
    expect(response.headers.get('location')).toContain('saved=0');
  });

  it('refreshes the preview without saving when asked', async () => {
    const response = await post('/knowledge/billing/invoices', {
      ...edit,
      body: '> [!WARNING]\n> Careful.',
      action: 'preview',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hc-callout--warning');
    expect(written.size).toBe(0);
  });

  it('keeps what was typed and says what is wrong', async () => {
    const response = await post('/knowledge/billing/invoices', { ...edit, title: '  ' });
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('An article needs a title.');
    expect(page).toContain('within 30 days');
    expect(written.size).toBe(0);
  });

  it('shows a hook failure and leaves the index alone', async () => {
    const failing = mount(() => {
      throw new Error('the repo is read-only here');
    });
    const response = await post('/knowledge/billing/invoices', edit, failing);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      'The file could not be saved: the repo is read-only here',
    );
    const page = await (await get('/knowledge/billing/invoices')).text();
    expect(page).toContain('within 14 days');
  });
});

describe('a new article', () => {
  it('offers the collections that exist and writes the new file into one', async () => {
    const form = await (await get('/knowledge/new')).text();
    expect(form).toContain(
      '<datalist id="db-collections"><option value="billing">Billing</option>',
    );

    const response = await post('/knowledge/new', {
      ...edit,
      title: 'Changing your plan',
      collection: 'Billing',
      status: 'draft',
      body: 'Open **Plans**.',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${BASE}/knowledge/billing/changing-your-plan?saved=1`,
    );
    const file = written.get('billing/changing-your-plan.md') ?? '';
    expect(file).toBe(
      '---\ntitle: Changing your plan\ndescription: Download a PDF.\nstatus: draft\n---\n\nOpen **Plans**.\n',
    );
    expect((await get('/knowledge/billing/changing-your-plan')).status).toBe(200);
    const savedPage = await (await get('/knowledge/billing/changing-your-plan?saved=1')).text();
    expect(savedPage).toContain(
      'Draft saved. It stays hidden from visitors and the agent until you publish it.',
    );
    expect(savedPage).not.toContain('live for text');
  });

  it('offers a collection with no articles yet, and writes into its folder', async () => {
    // A folder with only a _meta.json, as the last sync indexed it.
    await indexCollections(db, [
      {
        id: 'billing',
        title: 'Billing',
        description: null,
        icon: 'book-open',
        tint: 'lavender',
        order: 1,
        askAgent: true,
        visibility: 'public',
        articles: [],
      },
      {
        id: 'pricing',
        title: 'Plans and pricing',
        description: null,
        icon: 'tag',
        tint: 'mint',
        order: 2,
        askAgent: true,
        visibility: 'public',
        articles: [],
      },
    ]);
    const form = await (await get('/knowledge/new')).text();
    expect(form).toContain('<option value="pricing">Plans and pricing</option>');

    await post('/knowledge/new', {
      ...edit,
      title: 'Annual plans',
      collection: 'Plans and pricing',
    });
    expect([...written.keys()]).toEqual(['pricing/annual-plans.md']);
  });

  it('makes a folder for a collection that does not exist yet', async () => {
    await post('/knowledge/new', { ...edit, title: 'Roles', collection: 'Team & roles' });
    expect([...written.keys()]).toEqual(['team-roles/roles.md']);
  });

  it('never overwrites an article that is already there', async () => {
    const response = await post('/knowledge/new', {
      ...edit,
      title: 'Invoices',
      collection: 'billing',
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('There is already an article at billing/invoices.md');
    expect(written.size).toBe(0);
  });

  it('starts from a gap: its question as the title, its suggested collection', async () => {
    await db.insert(schema.gaps).values({
      id: 'gap_1',
      question: 'Can I pay by invoice?',
      asks: 4,
      suggestedCollection: 'billing',
    });
    const gaps = await (await get('/gaps')).text();
    const href = /href="([^"]*\/knowledge\/new\?[^"]+)"/.exec(gaps)?.[1]?.replace(/&amp;/g, '&');
    expect(href).toBe(
      `${BASE}/knowledge/new?title=Can+I+pay+by+invoice%3F&collection=billing&gap=gap_1`,
    );

    const form = await (await get(href?.slice(BASE.length) ?? '')).text();
    expect(form).toContain('value="Can I pay by invoice?"');
    expect(form).toContain('name="collection" list="db-collections" value="billing"');
    // The gap rides along, so saving marks it drafted.
    expect(form).toContain('What customers asked');
    expect(form).toContain('name="gap" value="gap_1"');
  });

  it('needs a collection', async () => {
    const response = await post('/knowledge/new', { ...edit, title: 'Orphan', collection: '' });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Pick a collection');
  });

  it('will not publish an empty body, as after an AI draft that failed, but saves a draft', async () => {
    for (const body of ['', '  \r\n\r\n ', '# Refund windows']) {
      const response = await post('/knowledge/new', {
        ...edit,
        title: 'Refund windows',
        collection: 'billing',
        status: 'published',
        body,
      });
      expect(response.status).toBe(400);
      const page = await response.text();
      expect(page).toContain(EMPTY_ARTICLE_MESSAGE);
      // Everything else typed is kept, so nothing has to be entered again.
      expect(page).toContain('value="Refund windows"');
    }
    expect(written.size).toBe(0);

    const draft = await post('/knowledge/new', {
      ...edit,
      title: 'Refund windows',
      collection: 'billing',
      status: 'draft',
      body: '',
    });
    expect(draft.status).toBe(303);
    expect(written.get('billing/refund-windows.md')).toContain('status: draft');
  });

  it('will not empty a published article on edit either', async () => {
    const response = await post('/knowledge/billing/invoices', { ...edit, body: '' });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(EMPTY_ARTICLE_MESSAGE);
    expect(written.size).toBe(0);
    const page = await (await get('/knowledge/billing/invoices')).text();
    expect(page).toContain('within 14 days');
  });

  it('still previews an empty body without complaint', async () => {
    const response = await post('/knowledge/new', {
      ...edit,
      title: 'Refund windows',
      collection: 'billing',
      body: '',
      action: 'preview',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(EMPTY_ARTICLE_MESSAGE);
  });
});

describe('without a writeArticle hook', () => {
  it('hands back the file and the exact path to save it at, and writes nothing', async () => {
    const page = await (await get('/knowledge/billing/invoices?edit=1', bare)).text();
    expect(page).toContain('cannot save to the repo from here yet');
    expect(page).toContain('Set this up with an AI assistant');
    expect(page).toContain('writeArticle');

    const response = await post('/knowledge/billing/invoices', edit, bare);
    expect(response.status).toBe(200);
    const result = await response.text();
    expect(result).toContain('Save this file in your repo');
    expect(result).toContain('<code id="db-save-path">docs/billing/invoices.md</code>');
    expect(result).toContain('data-copy="db-save-file"');
    expect(result).toContain('download="invoices.md"');
    expect(result).toContain('href="data:text/markdown;charset=utf-8,');
    expect(result).toContain('Refunds are issued within 30 days.');

    const article = await (await get('/knowledge/billing/invoices', bare)).text();
    expect(article).toContain('within 14 days');
  });
});

describe('the live preview', () => {
  it('renders Markdown with the help centre renderer, screenshots resolved', async () => {
    const response = await previewRequest({
      markdown: '> [!NOTE]\n> Hi.\n\n![x](../_screenshots/a.png)\n\n<script>alert(1)</script>',
      path: 'billing/invoices.md',
    });
    expect(response.status).toBe(200);
    const { html } = (await response.json()) as { html: string };
    expect(html).toContain('hc-callout--note');
    expect(html).toContain('<img src="/api/helpwell/screenshots/a.png"');
    expect(html).not.toContain('<script>');
  });

  it('shows inline and fenced code that looks like a tag as its text', async () => {
    const response = await previewRequest({
      markdown:
        'Put it in the `<head>` of every page.\n\n```html\n<script src="w.js"></script>\n```',
      path: 'setup/install.md',
    });
    const { html } = (await response.json()) as { html: string };
    expect(html).toContain('<p>Put it in the <code>&lt;head&gt;</code> of every page.</p>');
    expect(html).toContain(
      '<pre><code class="language-html">&lt;script src=&quot;w.js&quot;&gt;&lt;/script&gt;</code></pre>',
    );
  });

  it('works out where a new article will live from its collection and title', async () => {
    const response = await previewRequest({
      markdown: '![x](./diagram.png)',
      collection: 'Team',
      title: 'Roles',
    });
    const { html } = (await response.json()) as { html: string };
    expect(html).toContain('/api/helpwell/media/team/diagram.png');
  });

  it('takes JSON only, from this site only, from an admin only', async () => {
    const form = await post('/knowledge/_preview', { markdown: 'x' });
    expect(form.status).toBe(415);
    const crossSite = await previewRequest({ markdown: 'x' }, { origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
    const anonymous = await dashboard(
      new Request(`${ORIGIN}${BASE}/knowledge/_preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: 'x' }),
      }),
    );
    expect(anonymous.status).toBe(401);
    expect((await previewRequest('{nope')).status).toBe(400);
  });
});

describe('the editor’s help', () => {
  it('shows the block syntax and the screenshot setup prompts, with no secrets in them', async () => {
    const page = await (await get('/knowledge/new')).text();
    expect(page).toContain('Blocks');
    expect(page).toContain(':::steps');
    expect(page).toContain('HELPWELL_CAPTURE_PASSWORD');
    expect(page).toContain('Never ask me to paste a password');
  });
});
