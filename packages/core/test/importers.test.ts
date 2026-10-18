/**
 * The importers, as the dashboard runs them for an install with no repo:
 * an uploaded export read from a ZIP (Markdown, HTML, GitBook, Notion) or a
 * single file, a public help centre read from its address, and the plan
 * written through a content source, with images through the asset store and
 * old URLs into the source's redirect map. Also the redirect map itself, and
 * the guarded fetch a server reads the web with while importing.
 *
 * Nothing here reaches the network: every fetch is a fake.
 */

import { describe, expect, it } from 'vitest';
import { contentAssetStore } from '../src/content/assets.js';
import {
  CONTENT_REDIRECTS_PATH,
  isRedirectTarget,
  mergeRedirects,
  parseRedirects,
  readContentRedirects,
  redirectSourcePath,
  writeContentRedirects,
} from '../src/content/redirects.js';
import { createMemoryContentSource } from '../src/content/source.js';
import {
  contentImportTarget,
  importUrlSource,
  memoryImportFiles,
  publicFetch,
  readFolder,
  readImportUrl,
  readUploadedExport,
  writeImportPlan,
  zipImportFiles,
} from '../src/import.js';
import { zipOf } from './helpers/zip.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const NOTION_ID = '0123456789abcdef0123456789abcdef';

/** A fake fetch answering from a table of URL -> response. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const route = routes[url];
    return route ? route() : new Response('not found', { status: 404 });
  }) as typeof fetch & { urls: string[] };
  impl.urls = urls;
  return impl;
}

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('the redirect map', () => {
  it('reads either shape, keeps only string rules, and writes the importer’s shape', () => {
    expect(parseRedirects('[{"from":"/a","to":"/help/x"},{"from":1}]')).toEqual([
      { from: '/a', to: '/help/x' },
    ]);
    expect(parseRedirects('{"redirects":[{"from":"/b","to":"/help/y","extra":true}]}')).toEqual([
      { from: '/b', to: '/help/y' },
    ]);
    expect(parseRedirects('not json')).toBeNull();
    expect(parseRedirects('{"nope":[]}')).toBeNull();
  });

  it('matches an old URL by its path, and keeps one rule per path, the newest', () => {
    expect(redirectSourcePath('https://old.example.com/hc/en-us/articles/1-Refunds/')).toBe(
      '/hc/en-us/articles/1-Refunds',
    );
    expect(redirectSourcePath('/articles/2')).toBe('/articles/2');
    expect(redirectSourcePath('javascript:alert(1)')).toBeNull();
    expect(redirectSourcePath('https://old.example.com/')).toBeNull();
    expect(
      mergeRedirects(
        [
          { from: 'https://old.example.com/a', to: '/help/one' },
          { from: '/b', to: '/help/two' },
        ],
        [{ from: '/a/', to: '/help/three' }],
      ),
    ).toEqual([
      { from: '/a/', to: '/help/three' },
      { from: '/b', to: '/help/two' },
    ]);
  });

  it('only keeps targets that are plain paths on this site', () => {
    expect(isRedirectTarget('/help/billing/refunds')).toBe(true);
    for (const bad of [
      'https://evil.test/',
      '//evil.test/x',
      '/\\evil.test',
      '/help/x?next=//evil.test',
      '/help/\tx',
      'help/x',
      'javascript:alert(1)',
    ]) {
      expect(isRedirectTarget(bad), bad).toBe(false);
    }
  });

  it('lives in a content source as _redirects.json', async () => {
    const content = createMemoryContentSource();
    expect(await readContentRedirects(content)).toEqual([]);
    await writeContentRedirects(content, [{ from: '/a', to: '/help/x' }]);
    expect(JSON.parse((await content.readText(CONTENT_REDIRECTS_PATH)) ?? '')).toEqual({
      redirects: [{ from: '/a', to: '/help/x' }],
    });
    expect(await readContentRedirects(content)).toEqual([{ from: '/a', to: '/help/x' }]);
  });
});

describe('an uploaded archive', () => {
  it('reads a ZIP, unwraps the one folder most exports sit in, and leaves out clutter', () => {
    const files = zipImportFiles(
      zipOf({
        'export/billing/refunds.md': '# Refunds',
        'export/billing/shot.png': PNG,
        'export/__MACOSX/billing/._refunds.md': 'junk',
        'export/.DS_Store': 'junk',
        'export/../escape.md': '# Out',
        '/etc/passwd.md': '# Root',
      }),
    );
    expect(files.name).toBe('export');
    expect(files.paths()).toEqual(['billing/refunds.md', 'billing/shot.png']);
    expect(new TextDecoder().decode(files.read('billing/refunds.md')!)).toBe('# Refunds');
    expect(files.read('billing/../billing/shot.png')).toEqual(PNG);
    expect(files.read('../escape.md')).toBeNull();
  });

  it('reads a stored ZIP as well as a deflated one', () => {
    const files = zipImportFiles(zipOf({ 'a/b.md': '# B', 'c.md': '# C' }, { store: true }));
    expect(new TextDecoder().decode(files.read('a/b.md')!)).toBe('# B');
  });

  it('refuses what is not a ZIP, and one that unpacks past its limits', () => {
    expect(() => zipImportFiles(new TextEncoder().encode('not a zip at all, sorry'))).toThrow(
      /not a ZIP/,
    );
    expect(() =>
      zipImportFiles(zipOf({ 'a.md': 'x', 'b.md': 'y', 'c.md': 'z' }), { maxEntries: 2 }),
    ).toThrow(/more than 2 files/);
    expect(() =>
      zipImportFiles(zipOf({ 'a.md': 'x'.repeat(2000) }), { maxFileBytes: 1000 }),
    ).toThrow(/over/);
    expect(() =>
      zipImportFiles(zipOf({ 'a.md': 'x'.repeat(800), 'b.md': 'y'.repeat(800) }), {
        maxTotalBytes: 1000,
      }),
    ).toThrow(/unpacks to more than/);
    // An archive that claims a small file and unpacks a large one stops at the limit.
    const liar = zipImportFiles(zipOf({ 'a.md': 'x'.repeat(5000) }, { claim: { 'a.md': 10 } }), {
      maxFileBytes: 1000,
    });
    expect(liar.read('a.md')).toBeNull();
  });

  it('works out a Markdown folder, with the collections its folders make', () => {
    const plan = readUploadedExport(
      zipOf({
        'docs/billing/refunds.md':
          '---\ntitle: Refunds\n---\n\nWithin 30 days.\n\n![Form](form.png)',
        'docs/billing/form.png': PNG,
        'docs/intro.md': '# Welcome\n\nHello.',
        'docs/README.md': 'not an article',
      }),
      'docs.zip',
    );
    expect(plan.source).toBe('markdown');
    expect(plan.articles.map((a) => [a.collection.title, a.title, a.assetDir])).toEqual([
      ['Billing', 'Refunds', 'billing'],
      ['Docs', 'Welcome', ''],
    ]);
    expect(plan.files?.read('billing/form.png')).toEqual(PNG);
  });

  it('works out an HTML export, a GitBook repository and a Notion export', () => {
    const html = readUploadedExport(
      zipOf({
        'help/billing/refunds.html':
          '<html><head><title>Refunds</title></head><body><main><h1>Refunds</h1><p>Within 30 days.</p></main></body></html>',
      }),
      'help.zip',
    );
    expect(html.source).toBe('html');
    expect(html.articles[0]).toMatchObject({ title: 'Refunds', collection: { title: 'Billing' } });

    const gitbook = readUploadedExport(
      zipOf({
        'book/SUMMARY.md': '# Summary\n\n## Getting started\n\n* [Install](start/install.md)\n',
        'book/start/install.md': 'Run the installer.',
      }),
      'book.zip',
    );
    expect(gitbook.source).toBe('gitbook');
    expect(gitbook.articles.map((a) => [a.collection.title, a.title])).toEqual([
      ['Getting started', 'Install'],
    ]);

    // Notion hands its export over as a ZIP inside a ZIP.
    const inner = zipOf({
      [`Billing ${NOTION_ID}/Refunds ${NOTION_ID}.md`]: '# Refunds\n\nWithin 30 days.',
      [`Billing ${NOTION_ID}.md`]: '# Billing\n\nOverview.',
    });
    const notion = readUploadedExport(zipOf({ 'Export-1234.zip': inner }), 'Export.zip');
    expect(notion.source).toBe('notion');
    expect(notion.articles.map((a) => [a.collection.title, a.title, a.slug])).toEqual(
      expect.arrayContaining([['Billing', 'Refunds', 'Refunds']]),
    );
  });

  it('takes a single Markdown or HTML file, and refuses anything else', () => {
    const one = readUploadedExport(
      new TextEncoder().encode('# Refunds\n\nWithin 30 days.'),
      'refunds.md',
    );
    expect(one.articles.map((a) => a.title)).toEqual(['Refunds']);
    expect(() => readUploadedExport(PNG, 'shot.png')).toThrow(/ZIP of the export/);
    expect(() => readUploadedExport(zipOf({ 'a/shot.png': PNG }), 'x.zip')).toThrow(
      /no Markdown or HTML/,
    );
  });

  it('reads a folder from memory the same way', () => {
    const plan = readFolder(memoryImportFiles({ 'guides/start.md': '# Start\n\nGo.' }, 'kb'));
    expect(plan.articles[0]).toMatchObject({ title: 'Start', collection: { title: 'Guides' } });
  });
});

describe('a public address', () => {
  it('reads a zendesk.com help centre through its API, and anything else by crawling', () => {
    expect(importUrlSource('https://acme.zendesk.com/hc/en-gb')).toEqual({
      source: 'zendesk',
      subdomain: 'acme',
      locale: 'en-gb',
    });
    expect(importUrlSource('acme.zendesk.com')).toEqual({ source: 'zendesk', subdomain: 'acme' });
    expect(importUrlSource('http://help.acme.com/docs')).toEqual({
      source: 'crawl',
      url: 'https://help.acme.com/docs',
    });
    expect(() => importUrlSource('ftp://x')).toThrow(/not a web address/);
  });

  it('reads Zendesk without a key, whatever the environment holds', async () => {
    const base = 'https://acme.zendesk.com/api/v2/help_center/en-us';
    const doFetch = fakeFetch({
      [`${base}/sections.json?per_page=100`]: json({
        sections: [{ id: 1, name: 'Billing' }],
        next_page: null,
      }),
      [`${base}/articles.json?per_page=100`]: json({
        articles: [
          {
            title: 'Refunds',
            body: '<p>Within 30 days.</p>',
            html_url: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
            section_id: 1,
            draft: false,
          },
        ],
        next_page: null,
      }),
    });
    const plan = await readImportUrl('https://acme.zendesk.com', { fetch: doFetch });
    expect(plan.articles.map((a) => a.title)).toEqual(['Refunds']);
  });
});

describe('writing a plan through a content source', () => {
  it('writes articles and folders, keeps images through the asset store, and maps old URLs', async () => {
    const content = createMemoryContentSource({
      'billing/tax.md': '---\ntitle: Tax\n---\n\nVAT.\n',
    });
    const plan = {
      source: 'zendesk',
      warnings: [],
      articles: [
        {
          title: 'Refunds',
          body: '# Refunds\n\nWithin 30 days.\n\n![Form](https://cdn.test/form.png)\n\n![Logo](https://cdn.test/logo.svg)',
          collection: { title: 'Billing', description: 'Money' },
          sourceUrl: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
        },
        {
          title: 'Tax',
          body: 'New words.',
          collection: { title: 'Billing' },
          sourceUrl: 'https://acme.zendesk.com/hc/en-us/articles/12-Tax',
        },
      ],
    };
    const doFetch = fakeFetch({
      'https://cdn.test/form.png': () =>
        new Response(PNG, { headers: { 'content-type': 'image/png' } }),
      'https://cdn.test/logo.svg': () =>
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          headers: { 'content-type': 'image/svg+xml' },
        }),
    });
    const progress: string[] = [];
    const result = await writeImportPlan(
      plan,
      contentImportTarget({ content, assets: contentAssetStore(content) }),
      {
        helpPath: '/support',
        fetch: doFetch,
        onProgress: ({ done, total, title }) => progress.push(`${done}/${total} ${title}`),
      },
    );

    expect(result).toMatchObject({
      written: ['billing/refunds.md'],
      collections: ['billing'],
      redirects: 1,
      images: { saved: 1, failed: 1 },
    });
    expect(result.skipped).toEqual([
      { path: 'billing/tax.md', reason: expect.stringContaining('already exists') },
    ]);
    expect(progress).toEqual(['0/2 Refunds', '1/2 Tax']);

    const refunds = (await content.readText('billing/refunds.md')) ?? '';
    expect(refunds).toContain('title: Refunds');
    expect(refunds).not.toContain('# Refunds');
    expect(refunds).toMatch(/!\[Form\]\(\.\.\/_media\/[0-9a-f]{24}\.png\)/);
    // An SVG is not kept: it stays at its old address.
    expect(refunds).toContain('![Logo](https://cdn.test/logo.svg)');
    const image = /_media\/[0-9a-f]{24}\.png/.exec(refunds)?.[0] ?? '';
    expect(await content.read(image)).toEqual(PNG);
    expect(JSON.parse((await content.readText('billing/_meta.json')) ?? '')).toEqual({
      title: 'Billing',
      description: 'Money',
    });
    expect(await content.readText('billing/tax.md')).toContain('VAT.');
    expect(await readContentRedirects(content)).toEqual([
      {
        from: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
        to: '/support/billing/refunds',
      },
    ]);
  });

  it('copies an export’s own images from the archive, and keeps links it cannot follow', async () => {
    const content = createMemoryContentSource();
    const plan = readUploadedExport(
      zipOf({
        'kb/guides/start.md': '# Start\n\n![Here](img/here.png)\n\n![Gone](img/gone.png)',
        'kb/guides/img/here.png': PNG,
      }),
      'kb.zip',
    );
    const result = await writeImportPlan(
      plan,
      contentImportTarget({ content, assets: contentAssetStore(content) }),
    );
    expect(result.images).toEqual({ saved: 1, failed: 1 });
    const start = (await content.readText('guides/start.md')) ?? '';
    expect(start).toMatch(/!\[Here\]\(\.\.\/_media\/[0-9a-f]{24}\.png\)/);
    expect(start).toContain('![Gone](img/gone.png)');
  });

  it('leaves images where they are when there is no asset store', async () => {
    const content = createMemoryContentSource();
    const doFetch = fakeFetch({});
    const result = await writeImportPlan(
      {
        source: 'crawl',
        warnings: [],
        articles: [
          { title: 'A', body: 'Text.\n\n![x](https://cdn.test/x.png)', collection: { title: 'G' } },
        ],
      },
      contentImportTarget({ content, assets: null }),
      { fetch: doFetch },
    );
    expect(result.images.failed).toBe(1);
    expect(await content.readText('g/a.md')).toContain('](https://cdn.test/x.png)');
  });
});

describe('publicFetch', () => {
  it('reads only public https addresses, before and after resolving them', async () => {
    const read = publicFetch({
      // Every name resolves to a private address here, as a rebinding attacker would arrange.
      lookup: (_host, _options, callback) => callback(null, [{ address: '10.0.0.5', family: 4 }]),
      timeoutMs: 2000,
    });
    await expect(read('http://example.com/')).rejects.toThrow(/https/);
    await expect(read('https://localhost/')).rejects.toThrow(/not a public address/);
    await expect(read('https://169.254.169.254/latest')).rejects.toThrow(/not a public address/);
    await expect(read('https://user:pass@example.com/')).rejects.toThrow(/password/);
    await expect(read('https://example.com/', { method: 'POST' })).rejects.toThrow(/GET/);
    await expect(read('https://example.com/')).rejects.toThrow(/private/);
  });
});
