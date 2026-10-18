/**
 * The help centre reads the settings it used to ignore: the public domain,
 * the theme (hero, under cards, tints, default scheme, favicon), the agent's
 * name and avatar, the changelog's grouping and whether the widget shows at
 * all. Plus the self-hosted fonts and the security headers on every answer.
 */

import type { Article } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { createChangelogEntry } from '@helpwell/core/repos';
import { indexArticles, indexCollections } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHelpCenter, domainBase, type HelpCenterHandler } from '../src/index.js';
import { paletteTints, updatedAgo } from '../src/pages/home.js';
import { freshDb } from './helpers/db.js';

let db: Db;
let help: HelpCenterHandler;
let store: SettingsStore;

function article(partial: Pick<Article, 'slug' | 'collection' | 'title'> & Partial<Article>) {
  return {
    description: null,
    headings: [],
    status: 'published' as const,
    appliesTo: null,
    order: 0,
    readingMinutes: 2,
    path: `${partial.slug}.md`,
    updatedAt: new Date(Date.now() - 2 * 86_400_000),
    contentHash: `hash-${partial.slug}`,
    body: 'Body text.',
    ...partial,
  };
}

/**
 * Save settings, then start a fresh handler: each handler caches settings for
 * a few seconds, and a test should not wait them out.
 */
async function set(patch: Parameters<SettingsStore['update']>[0]): Promise<void> {
  await store.update(patch);
  help = createHelpCenter({ db, basePath: '/help', apiPath: '/api/helpwell' });
}

const page = async (path: string, origin = 'https://arrived.test') =>
  (await help(new Request(`${origin}${path}`))).text();

beforeEach(async () => {
  db = (await freshDb()).db;
  store = new SettingsStore(db);
  await store.update({ product: { name: 'Acme' } });
  help = createHelpCenter({ db, basePath: '/help', apiPath: '/api/helpwell' });
  await indexArticles(db, [
    article({ slug: 'billing/invoices', collection: 'billing', title: 'Invoices' }),
    article({ slug: 'setup/install', collection: 'setup', title: 'Install' }),
  ]);
  await indexCollections(db, [
    {
      id: 'billing',
      title: 'Billing',
      description: null,
      icon: 'folder',
      tint: 'peach',
      order: 1,
      askAgent: true,
      visibility: 'public',
      articles: [],
    },
  ]);
});

describe('helpCenter.domain', () => {
  it('is the public URL of every absolute link, read on each request', async () => {
    const before = await page('/help/billing/invoices');
    expect(before).toContain(
      '<link rel="canonical" href="https://arrived.test/help/billing/invoices">',
    );

    await set({ helpCenter: { domain: 'help.acme.com' } });
    const after = await page('/help/billing/invoices');
    expect(after).toContain('<link rel="canonical" href="https://help.acme.com/billing/invoices">');
    expect(after).toContain(
      '<meta property="og:url" content="https://help.acme.com/billing/invoices">',
    );
    expect(await page('/help/sitemap.xml')).toContain(
      '<loc>https://help.acme.com/billing/invoices</loc>',
    );
    expect(await page('/help/llms.txt')).toContain('(https://help.acme.com/billing/invoices)');
  });

  it('takes a full URL as written, and ignores one that is not an address', () => {
    expect(domainBase('https://acme.com/docs/')).toBe('https://acme.com/docs');
    expect(domainBase('help.acme.com')).toBe('https://help.acme.com');
    expect(domainBase('')).toBeUndefined();
    expect(domainBase('not a domain')).toBeUndefined();
    expect(domainBase('javascript:alert(1)')).toBeUndefined();
    expect(domainBase('localhost')).toBeUndefined();
  });

  it('gives way to a publicUrl passed in code', async () => {
    await store.update({ helpCenter: { domain: 'help.acme.com' } });
    help = createHelpCenter({ db, basePath: '/help', publicUrl: 'https://docs.acme.io' });
    expect(await page('/help/billing/invoices')).toContain(
      'href="https://docs.acme.io/billing/invoices"',
    );
  });
});

describe('theme', () => {
  it('draws the hero Settings pick', async () => {
    expect(await page('/help')).toContain('class="hc-hero hc-hero--glow"');
    await set({ helpCenter: { theme: { hero: 'brand' } } });
    expect(await page('/help')).toContain('class="hc-hero hc-hero--brand"');
    await set({ helpCenter: { theme: { hero: 'flat' } } });
    expect(await page('/help')).toContain('class="hc-hero hc-hero--flat"');
  });

  it('puts collections on under cards with count and freshness, or plain cards', async () => {
    const under = await page('/help');
    expect(under).toMatch(/<a class="hc-ucard" data-tint="peach" href="\/help\/c\/billing">/);
    expect(under).toMatch(
      /<span class="hc-umeta">1 article<span aria-hidden="true">·<\/span>updated 2 days ago<\/span>/,
    );

    await set({ helpCenter: { theme: { underCards: false } } });
    const plain = await page('/help');
    expect(plain).not.toContain('class="hc-ucard"');
    expect(plain).toContain('<a class="hc-card" data-tint="peach"');
    expect(plain).toContain('<span class="hc-card__count">1 article</span>');
  });

  it('keeps collection tints inside the palette Settings allow', async () => {
    await set({ helpCenter: { theme: { tints: ['mint'] } } });
    const html = await page('/help');
    expect(html).not.toContain('data-tint="peach"');
    expect(html.match(/data-tint="mint"/g)?.length).toBe(2);

    const tinted = paletteTints(
      [{ tint: 'lavender' }, { tint: 'lavender' }, { tint: 'mint' }, { tint: 'butter' }],
      ['peach', 'mint'],
    ).map((c) => c.tint);
    expect(tinted).toEqual(['peach', 'mint', 'mint', 'peach']);
    // An unknown name in the palette is ignored, and an empty palette is all four.
    expect(paletteTints([{ tint: 'peach' }], ['neon']).map((c) => c.tint)).toEqual(['peach']);
  });

  it('starts readers in the default scheme, and lets them switch', async () => {
    const system = await page('/help');
    expect(system).toMatch(/<html lang="en">/);
    expect(system).toContain('data-hc-theme');
    expect(system).toContain('localStorage.getItem("hw-help-theme")');

    await set({ helpCenter: { theme: { defaultTheme: 'dark' } } });
    expect(await page('/help')).toMatch(/<html lang="en" data-hw-theme="dark">/);
  });

  it('shows the dark-mode logo in the dark scheme, and the one logo in both without it', async () => {
    await set({ helpCenter: { theme: { logoUrl: 'https://acme.com/logo.png' } } });
    const single = await page('/help');
    expect(single).toContain('<img src="https://acme.com/logo.png" alt="Acme">');
    expect(single).not.toContain('class="hc-logo--dark"');
    await set({ helpCenter: { theme: { logoDarkUrl: 'https://acme.com/logo-white.png' } } });
    const both = await page('/help');
    expect(both).toContain('class="hc-logo--light" src="https://acme.com/logo.png"');
    expect(both).toContain('class="hc-logo--dark" src="https://acme.com/logo-white.png"');
    expect(both).toContain(
      ":root[data-hw-theme='dark'] .hc-brand .hc-logo--dark { display: block; }",
    );
    await set({ helpCenter: { theme: { logoDarkUrl: 'javascript:alert(1)' } } });
    expect(await page('/help')).not.toContain('javascript:');
  });

  it('sets the favicon, and never a script URL as one', async () => {
    await set({ helpCenter: { theme: { faviconUrl: 'https://acme.com/favicon.png' } } });
    expect(await page('/help')).toContain('<link rel="icon" href="https://acme.com/favicon.png">');
    await set({ helpCenter: { theme: { faviconUrl: 'javascript:alert(1)' } } });
    expect(await page('/help')).not.toContain('rel="icon"');
  });
});

describe('the agent', () => {
  it('offers to ask the agent by name, with the bare mark by default', async () => {
    const html = await page('/help');
    expect(html).toContain('/api/helpwell/assets/loader.js');
    expect(html).toContain('or ask Fern, our AI assistant.');
    expect(html).toMatch(/<button type="button" class="hc-ask" data-hc-ask hidden>/);
    expect(html).toContain('<span class="hc-avatar hc-avatar--mark"');
    expect(html).toContain('<span>Ask Fern</span>');
    // The mark is decoration here: the button says who it is.
    expect(html).not.toContain('aria-label="Open support"');
    expect(await page('/help/billing/invoices')).toContain('Still stuck?');
  });

  it("uses the agent's avatar and name from Settings", async () => {
    await set({
      agent: { name: 'Ivy', avatarUrl: 'https://acme.com/ivy.png' },
    });
    const html = await page('/help');
    expect(html).toContain('<img class="hc-avatar" src="https://acme.com/ivy.png" alt=""');
    expect(html).toContain('<span>Ask Ivy</span>');
  });

  it("uses the host's agent name over the one in Settings", async () => {
    await store.update({ agent: { name: 'Ivy' } });
    help = createHelpCenter({
      db,
      basePath: '/help',
      apiPath: '/api/helpwell',
      agentOverrides: async () => ({ name: ' Juniper\n' }),
    });
    const html = await page('/help');
    expect(html).toContain('<span>Ask Juniper</span>');
    expect(html).toContain('or ask Juniper, our AI assistant.');
    expect(html).not.toContain('Ivy');
  });

  it('keeps the name in Settings when the host names no one or fails', async () => {
    help = createHelpCenter({
      db,
      basePath: '/help',
      apiPath: '/api/helpwell',
      agentOverrides: async () => ({ instructions: 'Be brief.' }),
    });
    expect(await page('/help')).toContain('<span>Ask Fern</span>');
    help = createHelpCenter({
      db,
      basePath: '/help',
      apiPath: '/api/helpwell',
      agentOverrides: async () => {
        throw new Error('down');
      },
    });
    expect(await page('/help')).toContain('<span>Ask Fern</span>');
  });

  it('leaves the widget and every ask button off when Settings say so', async () => {
    await set({ helpCenter: { askAgent: false } });
    const html = await page('/help');
    expect(html).not.toContain('loader.js');
    expect(html).not.toContain('data-hc-ask');
    expect(html).not.toContain('ask Fern');
    expect(await page('/help/billing/invoices')).not.toContain('Still stuck?');
  });
});

describe('changelog.groupBy', () => {
  beforeEach(async () => {
    await createChangelogEntry(db, {
      version: '2.1.0',
      title: 'September thing',
      status: 'published',
      publishedAt: new Date('2026-09-10T12:00:00Z'),
    });
    await createChangelogEntry(db, {
      version: '2.0.0',
      title: 'August thing',
      status: 'published',
      publishedAt: new Date('2026-08-20T12:00:00Z'),
    });
  });

  it('leads each entry with its version by default', async () => {
    const html = await page('/help/changelog');
    expect(html).not.toContain('<h2 class="hc-month"');
    expect(html.indexOf('<span class="hc-tag">2.1.0</span>')).toBeLessThan(
      html.indexOf('<span class="hc-entry__date">'),
    );
  });

  it('groups under month headings when grouped by date', async () => {
    await set({ changelog: { groupBy: 'date' } });
    const html = await page('/help/changelog');
    expect(html).toContain('<h2 class="hc-month">September 2026</h2>');
    expect(html).toContain('<h2 class="hc-month">August 2026</h2>');
    expect(html.indexOf('September 2026</h2>')).toBeLessThan(html.indexOf('September thing'));
    expect(html.indexOf('August 2026</h2>')).toBeGreaterThan(html.indexOf('September thing'));
    // The date leads, the version follows.
    expect(html.indexOf('<span class="hc-entry__date">')).toBeLessThan(
      html.indexOf('<span class="hc-tag">2.1.0</span>'),
    );
  });
});

describe('fonts', () => {
  it('declares the self-hosted faces and serves them from its own path', async () => {
    const html = await page('/help');
    expect(html).toContain('src: url("/help/_fonts/plus-jakarta-sans-latin.woff2")');
    expect(html).toContain('font-display: swap');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);

    const font = await help(
      new Request('https://arrived.test/help/_fonts/bricolage-grotesque-latin.woff2'),
    );
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect(font.headers.get('x-content-type-options')).toBe('nosniff');

    const missing = await help(new Request('https://arrived.test/help/_fonts/nope.woff2'));
    expect(missing.status).toBe(404);
  });
});

describe('security headers', () => {
  it('sends nosniff and a referrer policy on pages, errors and files, and allows Wistia frames', async () => {
    for (const path of ['/help', '/help/nope', '/help/sitemap.xml']) {
      const response = await help(new Request(`https://arrived.test${path}`));
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
    }
    const home = await help(new Request('https://arrived.test/help'));
    expect(home.headers.get('content-security-policy')).toContain('https://fast.wistia.net');
  });

  it('lets the host replace, drop or switch off the headers', async () => {
    help = createHelpCenter({
      db,
      basePath: '/help',
      securityHeaders: { 'referrer-policy': 'no-referrer', 'x-content-type-options': null },
    });
    const custom = await help(new Request('https://arrived.test/help'));
    expect(custom.headers.get('referrer-policy')).toBe('no-referrer');
    expect(custom.headers.get('x-content-type-options')).toBeNull();

    help = createHelpCenter({ db, basePath: '/help', securityHeaders: false });
    const none = await help(new Request('https://arrived.test/help'));
    expect(none.headers.get('referrer-policy')).toBeNull();
  });
});

describe('updatedAgo', () => {
  it('says how long ago, in the product locale', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    expect(updatedAgo('2026-09-23T08:00:00Z', 'en', now)).toBe('today');
    expect(updatedAgo('2026-09-22T08:00:00Z', 'en', now)).toBe('yesterday');
    expect(updatedAgo('2026-09-10T08:00:00Z', 'en', now)).toBe('last week');
    expect(updatedAgo('2026-06-10T08:00:00Z', 'en', now)).toBe('3 months ago');
    expect(updatedAgo('2026-09-21T08:00:00Z', 'not a locale!', now)).toBe('2 days ago');
    expect(updatedAgo('garbage', 'en', now)).toBe('');
  });
});
