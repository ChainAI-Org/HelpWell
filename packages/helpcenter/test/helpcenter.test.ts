import type { Article } from '@helpwell/core/content';
import { type Db, schema } from '@helpwell/core/db';
import { indexArticles, indexCollections } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHelpCenter, type HelpCenterHandler, helpCenterStyles } from '../src/index.js';
import { freshDb } from './helpers/db.js';

let db: Db;
let help: HelpCenterHandler;

const ORIGIN = 'https://acme.test';

function article(
  partial: Pick<Article, 'slug' | 'collection' | 'title' | 'body'> & Partial<Article>,
): Article {
  return {
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 2,
    path: `${partial.slug}.md`,
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    contentHash: `hash-${partial.slug}`,
    ...partial,
  };
}

async function get(path: string): Promise<Response> {
  return help(new Request(`${ORIGIN}${path}`));
}

async function body(path: string): Promise<string> {
  return (await get(path)).text();
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;

  help = createHelpCenter({
    db,
    basePath: '/help',
    origin: ORIGIN,
    apiPath: '/api/helpwell',
    editUrlTemplate: 'https://github.com/acme/app/edit/main/docs/{path}',
  });

  await new SettingsStore(db).update({ product: { name: 'Acme', appUrl: 'https://acme.test' } });

  await indexArticles(db, [
    article({
      slug: 'billing/invoices',
      collection: 'billing',
      title: 'Exporting invoices',
      description: 'Download a PDF of any invoice.',
      body: '## Where to look\n\nOpen **Billing**, then Invoices.\n\n## Formats\n\nPDF and CSV.',
    }),
    article({
      slug: 'billing/refunds',
      collection: 'billing',
      title: 'Issuing a refund',
      description: 'Refund a charge in two clicks.',
      // Opens with its own H1, the way an article written for GitHub does.
      body: '# Issuing a refund\n\nOpen the charge and press Refund.',
      order: 1,
    }),
    article({
      slug: 'setup/install',
      collection: 'setup',
      title: 'Installing Acme',
      description: 'One script tag.',
      body: 'Paste the loader before </body>.',
    }),
    article({
      slug: 'setup/secret',
      collection: 'setup',
      title: 'Unpublished thing',
      body: 'Not ready.',
      status: 'draft',
    }),
  ]);

  // `billing` wrote a _meta.json; `setup` did not. Both have to render.
  await indexCollections(db, [
    {
      id: 'billing',
      title: 'Billing and plans',
      description: 'Invoices, receipts and refunds.',
      icon: 'credit-card',
      tint: 'peach',
      order: 1,
      askAgent: true,
      visibility: 'public',
      articles: [],
    },
  ]);
});

describe('home', () => {
  it('lists the collections with counts', async () => {
    const page = await body('/help');
    expect(page).toContain('Browse by topic');
    expect(page).toContain('2 articles');
    // The draft must not be counted.
    expect(page).toContain('1 article<');
  });

  it('gives a collection the title, description and tint its _meta.json chose', async () => {
    const page = await body('/help');
    expect(page).toContain('Billing and plans');
    expect(page).toContain('Invoices, receipts and refunds.');
    expect(page).toContain('data-tint="peach"');
  });

  it('titles a collection from its folder name when it has no _meta.json', async () => {
    const page = await body('/help');
    // Not `setup`, which is what the card showed before _meta.json was stored.
    expect(page).toContain('<h2>Setup</h2>');
    expect(page).toContain('data-tint="lavender"');
  });

  it('carries the title, canonical and description', async () => {
    const page = await body('/help');
    expect(page).toContain('<title>Acme help center</title>');
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}/help/">`);
    expect(page).toContain('Help and documentation for Acme.');
  });

  it('answers with HTML and a shared cache header', async () => {
    const response = await get('/help');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toContain('s-maxage');
  });

  it('404s outside the base path', async () => {
    expect((await get('/elsewhere')).status).toBe(404);
  });
});

describe('articles', () => {
  it('keeps numbered steps in one list when screenshots sit between them', async () => {
    await indexArticles(db, [
      article({
        slug: 'billing/status',
        collection: 'billing',
        title: 'Setting a status',
        body: '1. Click on your Profile\n\n![](https://cdn.example/a.jpg)\n\n2. Click on **Add Status**:\n\n![](https://cdn.example/b.jpg)\n\n3. Type in your status',
      }),
    ]);
    const page = await body('/help/billing/status');
    expect(page.match(/<ol/g)).toHaveLength(1);
    expect(page.match(/<li>/g)).toHaveLength(3);
    expect(page).toContain('<li>Click on your Profile<p><img src="https://cdn.example/a.jpg"');
  });

  it('keeps the start number of a list that begins part way', async () => {
    await indexArticles(db, [
      article({
        slug: 'billing/part',
        collection: 'billing',
        title: 'Part way',
        body: '3. Third\n4. Fourth',
      }),
    ]);
    expect(await body('/help/billing/part')).toContain(
      '<ol start="3"><li>Third</li><li>Fourth</li></ol>',
    );
  });

  it('renders the body, headings and a table of contents', async () => {
    const page = await body('/help/billing/invoices');
    expect(page).toContain('<h1>Exporting invoices</h1>');
    expect(page).toContain('<strong>Billing</strong>');
    expect(page).toContain('id="where-to-look"');
    expect(page).toContain('On this page');
    expect(page).toContain('href="#formats"');
  });

  it('says the title once when the body opens by repeating it', async () => {
    const page = await body('/help/billing/refunds');
    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(page).not.toContain('id="issuing-a-refund"');
    expect(page).toContain('Open the charge and press Refund.');
  });

  it('shows the breadcrumb and an edit link into the repo', async () => {
    const page = await body('/help/billing/invoices');
    expect(page).toContain('href="/help/c/billing"');
    expect(page).toContain('https://github.com/acme/app/edit/main/docs/billing/invoices.md');
  });

  it('names the collection in the breadcrumb, rather than its folder', async () => {
    const page = await body('/help/billing/invoices');
    expect(page).toContain('/c/billing">Billing and plans</a>');
  });

  it('emits JSON-LD for the article', async () => {
    const page = await body('/help/billing/invoices');
    expect(page).toContain('application/ld+json');
    expect(page).toContain('"@type":"TechArticle"');
    expect(page).toContain('"headline":"Exporting invoices"');
  });

  it('offers a rating, wired to the API', async () => {
    const page = await body('/help/billing/invoices');
    expect(page).toContain('Was this article helpful?');
    expect(page).toContain('/api/helpwell/articles/billing/invoices/rating');
  });

  it('suggests related reading from the same collection', async () => {
    const page = await body('/help/billing/invoices');
    expect(page).toContain('Related');
    expect(page).toContain('Issuing a refund');
  });

  it('404s a draft and an unknown slug', async () => {
    expect((await get('/help/setup/secret')).status).toBe(404);
    expect((await get('/help/nope/nope')).status).toBe(404);
  });

  it('renders a helpful 404 rather than a bare one', async () => {
    const page = await body('/help/nope');
    expect(page).toContain('We could not find that page');
    expect(page).toContain('noindex');
  });
});

describe('collections', () => {
  it('lists the articles in order', async () => {
    const page = await body('/help/c/billing');
    const first = page.indexOf('Exporting invoices');
    const second = page.indexOf('Issuing a refund');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('heads the page with the collection title and description', async () => {
    const page = await body('/help/c/billing');
    expect(page).toContain('<title>Billing and plans · Acme</title>');
    expect(page).toContain('Invoices, receipts and refunds.');
  });

  it('falls back to the folder name for a collection with no metadata', async () => {
    const page = await body('/help/c/setup');
    expect(page).toContain('<title>Setup · Acme</title>');
  });

  it('404s a collection with nothing published in it', async () => {
    expect((await get('/help/c/nothing')).status).toBe(404);
  });
});

describe('search', () => {
  it('finds an article and keeps the highlight', async () => {
    const page = await body('/help/search?q=invoice');
    expect(page).toContain('Exporting invoices');
    expect(page).toContain('<mark>');
  });

  it('says so when nothing matched', async () => {
    const page = await body('/help/search?q=zzzznothing');
    expect(page).toContain('Nothing matched');
  });

  it('is a real form that works without JavaScript', async () => {
    const page = await body('/help');
    expect(page).toContain('<form class="hc-search" action="/help/search" method="get"');
  });

  it('is never indexed, and never cached', async () => {
    const response = await get('/help/search?q=invoice');
    expect(await response.text()).toContain('name="robots" content="noindex"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('records the search so it shows up in reports', async () => {
    await get('/help/search?q=invoice');
    const rows = await db.select().from(schema.searches);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.query).toBe('invoice');
    expect(rows[0]?.source).toBe('help_center');
  });
});

describe('changelog', () => {
  beforeEach(async () => {
    await db.insert(schema.changelogEntries).values([
      {
        id: 'chg_1',
        version: '1.0.0',
        title: 'First release',
        summary: 'It begins.',
        body: '## Highlights\n\n- It works',
        tags: ['New'],
        status: 'published',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'chg_draft',
        title: 'Not yet',
        body: 'Draft.',
        status: 'draft',
      },
    ]);
  });

  it('lists published entries only', async () => {
    const page = await body('/help/changelog');
    expect(page).toContain('First release');
    expect(page).not.toContain('Not yet');
  });

  it('opens an entry by version', async () => {
    const page = await body('/help/changelog/1.0.0');
    expect(page).toContain('<h1>First release</h1>');
    expect(page).toContain('Highlights');
  });

  it('serves an RSS feed and links to it', async () => {
    const response = await get('/help/changelog/rss.xml');
    expect(response.headers.get('content-type')).toContain('application/xml');

    const feed = await response.text();
    expect(feed).toContain('<title>Acme changelog</title>');
    expect(feed).toContain(`${ORIGIN}/help/changelog/1.0.0`);

    expect(await body('/help/changelog')).toContain('Subscribe by RSS');
  });

  it('is hidden entirely when the public page is switched off', async () => {
    await new SettingsStore(db).update({ changelog: { publicPage: false } });
    expect((await get('/help/changelog')).status).toBe(404);
    expect(await body('/help')).not.toContain('>Changelog<');
  });
});

describe('roadmap', () => {
  beforeEach(async () => {
    await db.insert(schema.roadmapItems).values([
      { id: 'rmp_1', title: 'Dark mode', status: 'planned', votesCount: 7 },
      { id: 'rmp_2', title: 'Bulk export', status: 'in_progress', votesCount: 3 },
    ]);
  });

  it('shows the lanes with vote counts', async () => {
    const page = await body('/help/roadmap');
    expect(page).toContain('In progress');
    expect(page).toContain('Bulk export');
    expect(page).toContain('Planned');
    expect(page).toContain('Dark mode');
    expect(page).toContain('7');
  });

  it('404s when the roadmap is switched off', async () => {
    await new SettingsStore(db).update({ changelog: { roadmap: { enabled: false } } });
    expect((await get('/help/roadmap')).status).toBe(404);
  });
});

describe('machine-readable files', () => {
  it('serves a sitemap of published articles only', async () => {
    const map = await body('/help/sitemap.xml');
    expect(map).toContain(`${ORIGIN}/help/billing/invoices`);
    expect(map).toContain(`${ORIGIN}/help/setup/install`);
    expect(map).not.toContain('setup/secret');
  });

  it('serves llms.txt grouped by collection', async () => {
    const text = await body('/help/llms.txt');
    expect(text).toContain('# Acme');
    // The collection's own name, not the folder it lives in.
    expect(text).toContain('## Billing and plans');
    expect(text).toContain('## Setup');
    expect(text).toContain(`[Exporting invoices](${ORIGIN}/help/billing/invoices)`);
    expect(text).not.toContain('Unpublished thing');
  });

  it('can be switched off', async () => {
    await new SettingsStore(db).update({ helpCenter: { llmsTxt: false } });
    expect((await get('/help/llms.txt')).status).toBe(404);
  });
});

describe('the support email', () => {
  /** A help centre told outright whether a support extension answers people. */
  const mount = (humanSupport: boolean) =>
    createHelpCenter({ db, basePath: '/help', origin: ORIGIN, humanSupport });
  const page = async (handler: HelpCenterHandler, path: string) =>
    (await handler(new Request(`${ORIGIN}${path}`))).text();

  it('is "Contact support" in the footer and after a No vote, as a mailto link', async () => {
    await new SettingsStore(db).update({ product: { supportEmail: 'support@acme.test' } });
    const help = mount(false);

    expect(await page(help, '/help')).toContain(
      '<a class="hc-footer__contact" href="mailto:support@acme.test">Contact support</a>',
    );
    const article = await page(help, '/help/billing/invoices');
    // Hidden until the reader says No; the subject names the article.
    expect(article).toMatch(/<p class="hc-rate__contact" data-hc-rate-contact hidden>/);
    expect(article).toContain(
      `href="mailto:support@acme.test?subject=${encodeURIComponent('Question about "Exporting invoices"')}"`,
    );
    expect(article).toContain("contact.hidden = value !== 'down'");
  });

  it('is not shown when none is set, or it is not a plain address', async () => {
    expect(await page(mount(false), '/help/billing/invoices')).not.toContain('Contact support');
    await new SettingsStore(db).update({
      product: { supportEmail: 'help@acme.test?bcc=everyone@acme.test' },
    });
    expect(await page(mount(false), '/help')).not.toContain('Contact support');
  });

  it('is never shown when a support extension answers people', async () => {
    await new SettingsStore(db).update({ product: { supportEmail: 'support@acme.test' } });
    const help = mount(true);
    expect(await page(help, '/help')).not.toContain('support@acme.test');
    expect(await page(help, '/help/billing/invoices')).not.toContain('Contact support');
  });
});

describe('branding', () => {
  it('draws the credit line as the wordmark, never a GitHub logo', async () => {
    const page = await body('/help');
    expect(page).toContain('Powered by');
    expect(page).toContain('viewBox="24 24 776 171"');
    expect(page.toLowerCase()).not.toContain('github logo');
    // The click keeps its referrer, so helpwell.ai can see which help center it came from.
    expect(page).toContain(
      'href="https://helpwell.ai/?utm_source=helpwell-help-center&amp;utm_medium=powered-by" target="_blank" rel="noopener"',
    );
  });

  it('drops the credit line when the customer turns it off', async () => {
    await new SettingsStore(db).update({ helpCenter: { poweredBy: false } });
    expect(await body('/help')).not.toContain('Powered by');
  });

  it('uses the accent from settings', async () => {
    await new SettingsStore(db).update({ helpCenter: { theme: { accent: '#0EA5E9' } } });
    expect(await body('/help')).toContain('--hw-accent: #0EA5E9');
  });
});

describe('safety', () => {
  it('never emits HTML that was written into an article body', async () => {
    await indexArticles(db, [
      article({
        slug: 'danger/xss',
        collection: 'danger',
        title: 'Test',
        body: '<script>alert(1)</script>\n\n[click](javascript:alert(1))',
      }),
    ]);
    const page = await body('/help/danger/xss');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;');
    expect(page).not.toContain('javascript:alert');
  });

  it('escapes a product name that contains markup', async () => {
    await new SettingsStore(db).update({ product: { name: '<img src=x onerror=alert(1)>' } });
    const page = await body('/help');
    expect(page).not.toMatch(/<img src=x onerror/);
    expect(page).toContain('&lt;img');
  });

  it('escapes HTML that reaches a search snippet', async () => {
    // Relies on the search layer escaping the snippet before it adds <mark>;
    // the page trusts the snippet as markup, so this is where it would show.
    await indexArticles(db, [
      article({
        slug: 'danger/snippet',
        collection: 'danger',
        title: 'Zorblat notes',
        body: 'The zorblat <img src=x onerror=alert(1)> is a zorblat with many zorblat words.',
      }),
    ]);
    const page = await body('/help/search?q=zorblat');
    expect(page).toContain('Zorblat notes');
    expect(page).toContain('&lt;img');
    expect(page).not.toContain('<img src=x');
  });

  it('shows a search snippet as plain text, with code that looks like a tag kept', async () => {
    await indexArticles(db, [
      article({
        slug: 'setup/qixotl-install',
        collection: 'setup',
        title: 'Installing the qixotl widget',
        body: '## Install\n\nPaste the **qixotl** snippet in the `<head>` of every page.',
      }),
    ]);
    const page = await body('/help/search?q=qixotl');
    const snippet = /<p class="hc-list__sub">([\s\S]*?)<\/p>/.exec(page)?.[1] ?? '';
    expect(snippet).toContain('<mark>qixotl</mark>');
    expect(snippet).toContain('in the &lt;head&gt; of every page.');
    expect(snippet).not.toContain('**');
    expect(snippet).not.toContain('##');
    expect(snippet).not.toContain('`');
  });

  it('shows inline and fenced code that looks like a tag in an article', async () => {
    await indexArticles(db, [
      article({
        slug: 'setup/head-tag',
        collection: 'setup',
        title: 'The head tag',
        body: 'Put it in the `<head>` of every page.\n\n```html\n<script src="w.js"></script>\n```',
      }),
    ]);
    const page = await body('/help/setup/head-tag');
    expect(page).toContain('Put it in the <code>&lt;head&gt;</code> of every page.');
    expect(page).toContain('&lt;script src=&quot;w.js&quot;&gt;&lt;/script&gt;');
  });

  it('encodes a slug from front matter in the edit link and the canonical', async () => {
    const slug = 'danger/x" onmouseover="alert(1)';
    await indexArticles(db, [
      article({ slug, collection: 'danger', title: 'Odd slug', body: 'Body.' }),
    ]);
    const response = await get(`/help/danger/${encodeURIComponent('x" onmouseover="alert(1)')}`);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('docs/danger/x%22%20onmouseover%3D%22alert(1).md');
    expect(page).not.toContain('onmouseover="alert');
  });

  it('falls back to the default accent and strips a font that carries markup', () => {
    const css = helpCenterStyles({
      accent: '#fff; } body { background: red',
      font: 'Inter</style><script>alert(1)</script>',
      headlineFont: '"Bricolage Grotesque"',
      background: 'url(x)',
      radius: 24,
    });
    expect(css).toContain('--hw-accent: #7A3BEB');
    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script>');
    expect(css).toContain('--hc-font: "Inter/stylescriptalert1/script"');
    expect(css).toContain('--hc-headline-font: "Bricolage Grotesque"');
    expect(css).not.toContain('--hw-ground: url');
  });

  it('applies a hex background to the light scheme only', () => {
    const css = helpCenterStyles({
      accent: '#7A3BEB',
      font: 'Inter',
      background: '#FAFAF7',
      radius: 24,
    });
    expect(css).toContain(
      "@media (prefers-color-scheme: light) {\n  :root:not([data-hw-theme='dark']) { --hw-ground: #FAFAF7; }",
    );
    expect(css).toContain("[data-hw-theme='light'] { --hw-ground: #FAFAF7; }");
  });
});

describe('hardening', () => {
  it('does not serve the RSS feed when the changelog page is off', async () => {
    await new SettingsStore(db).update({ changelog: { publicPage: false } });
    expect((await get('/help/changelog/rss.xml')).status).toBe(404);
  });

  it('serves no sitemap when it is switched off', async () => {
    await new SettingsStore(db).update({ helpCenter: { sitemap: false } });
    expect((await get('/help/sitemap.xml')).status).toBe(404);
    expect((await get('/help/llms.txt')).status).toBe(200);
  });

  it('404s a path that cannot be decoded rather than crashing', async () => {
    const response = await get('/help/%zz');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('We could not find that page');
  });

  it('ignores a changelog cursor that is not a date', async () => {
    await db.insert(schema.changelogEntries).values({
      id: 'chg_c',
      title: 'Cursor test',
      body: 'x',
      status: 'published',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const response = await get('/help/changelog?cursor=nope');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Cursor test');
    expect((await get('/help/changelog?cursor=2026-02-01T00:00:00.000Z')).status).toBe(200);
  });

  it('links to the root when mounted at the root', async () => {
    const root = createHelpCenter({ db, basePath: '/', origin: ORIGIN });
    const page = await (await root(new Request(`${ORIGIN}/`))).text();
    expect(page).toContain('<a class="hc-brand" href="/">');
    expect(page).toContain('href="/changelog"');
    expect(page).toContain('action="/search"');
    expect(page).not.toContain('href=""');
    expect((await root(new Request(`${ORIGIN}/billing/invoices`))).status).toBe(200);
  });

  it('falls back to the request origin when none is configured', async () => {
    const bare = createHelpCenter({ db, basePath: '/help' });
    const request = (path: string) => bare(new Request(`${ORIGIN}${path}`));
    expect(await (await request('/help')).text()).toContain(
      `<link rel="canonical" href="${ORIGIN}/help/">`,
    );
    expect(await (await request('/help/sitemap.xml')).text()).toContain(
      `<loc>${ORIGIN}/help/billing/invoices</loc>`,
    );
    expect(await (await request('/help/changelog/rss.xml')).text()).toContain(
      `<link>${ORIGIN}/help/changelog</link>`,
    );
    expect(await (await request('/help/billing/invoices')).text()).toContain(
      `"mainEntityOfPage":"${ORIGIN}/help/billing/invoices"`,
    );
  });

  it('renders a heading with an ampersand once in the table of contents', async () => {
    await indexArticles(db, [
      article({
        slug: 'billing/tips',
        collection: 'billing',
        title: 'Tips',
        body: "## Tips & tricks\n\nOne.\n\n## What's new\n\nTwo.",
      }),
    ]);
    const page = await body('/help/billing/tips');
    expect(page).toContain('<a href="#tips-tricks">Tips &amp; tricks</a>');
    expect(page).toContain('<a href="#what-s-new">What&#39;s new</a>');
    expect(page).not.toContain('&amp;amp;');
    expect(page).toContain('id="what-s-new"');
  });

  it('omits the sidebar when there is nothing to list', async () => {
    const page = await body('/help/billing/refunds');
    expect(page).not.toContain('<aside></aside>');
    expect(page).not.toContain('On this page');
  });

  it('hides ratings and reading time when they are switched off', async () => {
    await new SettingsStore(db).update({ helpCenter: { ratings: false, readingTime: false } });
    const page = await body('/help/billing/invoices');
    expect(page).not.toContain('Was this article helpful?');
    expect(page).not.toContain('min read');
    expect(await body('/help/c/billing')).not.toContain(' min<');
    // Search is a separate setting and stays on.
    expect(await body('/help')).toContain('class="hc-search"');
  });

  it('sets the page language from the product locale', async () => {
    await new SettingsStore(db).update({ product: { locale: 'fr-FR' } });
    expect(await body('/help')).toContain('<html lang="fr-FR">');
  });

  it('falls back to "en" when the locale is not a language tag', async () => {
    await new SettingsStore(db).update({ product: { locale: 'not a tag' } });
    expect(await body('/help')).toContain('<html lang="en">');
  });
});

describe('reserved collections', () => {
  const asVisitor = (path: string, contactId: string) =>
    help(new Request(`${ORIGIN}${path}`, { headers: { cookie: `hw_visitor=${contactId}` } }));

  beforeEach(async () => {
    await indexArticles(db, [
      article({
        slug: 'internal/runbook',
        collection: 'internal',
        title: 'Internal runbook',
        description: 'Exporting invoices for customers only.',
        body: 'Secret zorblat procedure for invoices.',
      }),
    ]);
    await indexCollections(db, [
      {
        id: 'internal',
        title: 'Internal',
        description: 'For customers only.',
        icon: 'shield',
        tint: 'mint',
        order: 9,
        askAgent: true,
        visibility: 'identified',
        articles: [],
      },
    ]);
    await db.insert(schema.contacts).values([
      { id: 'con_known', identified: true },
      { id: 'con_anon', identified: false },
    ]);
  });

  it('does not exist for an anonymous visitor, by URL or anywhere else', async () => {
    expect((await get('/help/internal/runbook')).status).toBe(404);
    expect((await get('/help/c/internal')).status).toBe(404);
    expect(await body('/help')).not.toContain('href="/help/c/internal"');
    expect(await body('/help/search?q=zorblat')).toContain('Nothing matched');
    expect(await body('/help/sitemap.xml')).not.toContain('internal/runbook');
    expect(await body('/help/llms.txt')).not.toContain('Internal runbook');
    // Related reading on a public article cannot reach into it either.
    expect(await body('/help/billing/invoices')).not.toContain('Internal runbook');
  });

  it('stays hidden behind an anonymous or invented visitor cookie', async () => {
    expect((await asVisitor('/help/internal/runbook', 'con_anon')).status).toBe(404);
    expect((await asVisitor('/help/internal/runbook', 'con_nope')).status).toBe(404);
    expect((await asVisitor('/help/internal/runbook', "x' OR 1=1 --")).status).toBe(404);
  });

  it('opens for a visitor the host app has identified', async () => {
    const response = await asVisitor('/help/internal/runbook', 'con_known');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<h1>Internal runbook</h1>');
    expect(await (await asVisitor('/help/c/internal', 'con_known')).text()).toContain(
      'Internal runbook',
    );
    expect(await (await asVisitor('/help/search?q=zorblat', 'con_known')).text()).toContain(
      'Internal runbook',
    );
    expect(await (await asVisitor('/help', 'con_known')).text()).toContain(
      'href="/help/c/internal"',
    );
    expect(await (await asVisitor('/help/sitemap.xml', 'con_known')).text()).toContain(
      'internal/runbook',
    );
  });
});
