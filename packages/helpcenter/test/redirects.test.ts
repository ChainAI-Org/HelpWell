/**
 * helpwell/redirects.json, served: an old help centre URL that would be a 404
 * here is sent on to the article it became, the target is only ever a path
 * inside this help centre, and a new import is picked up without a restart.
 */

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Article } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { indexArticles } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHelpCenter, type HelpCenterConfig, type RedirectRule } from '../src/index.js';
import { redirectTarget } from '../src/redirects.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'https://help.acme.test';
const OLD = 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds';

let db: Db;
let dir: string;
let file: string;

function article(slug: string, title: string): Article {
  return {
    slug,
    collection: slug.split('/')[0]!,
    title,
    body: `${title}, in full.`,
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${slug}.md`,
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    contentHash: `hash-${slug}`,
  };
}

/** Write redirects.json the way `helpwell import` does, with a fresh mtime each time. */
let writes = 0;
function writeRedirects(redirects: RedirectRule[] | string): void {
  writeFileSync(
    file,
    typeof redirects === 'string' ? redirects : JSON.stringify({ redirects }, null, 2),
    'utf8',
  );
  // Two writes inside one clock tick can share an mtime; the reload keys on it.
  const when = new Date(Date.UTC(2026, 0, 1) + ++writes * 1000);
  utimesSync(file, when, when);
}

function helpCenter(config: Partial<HelpCenterConfig> = {}) {
  return createHelpCenter({ db, basePath: '/help', origin: ORIGIN, redirects: file, ...config });
}

function get(handler: (request: Request) => Promise<Response>, path: string, method = 'GET') {
  return handler(new Request(`${ORIGIN}${path}`, { method }));
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
  await indexArticles(db, [
    article('billing/refunds', 'Issuing a refund'),
    article('billing/invoices', 'Exporting invoices'),
  ]);
  dir = mkdtempSync(join(tmpdir(), 'helpwell-redirects-'));
  file = join(dir, 'redirects.json');
  writeRedirects([{ from: OLD, to: '/help/billing/refunds' }]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('an old URL from an imported help centre', () => {
  it('is sent on to its article with a 301, under the mount or as it arrived', async () => {
    const help = helpCenter();
    for (const path of [
      '/help/hc/en-us/articles/11-Refunds',
      // The old domain now points at this help centre, so the old path arrives as is.
      '/hc/en-us/articles/11-Refunds',
      '/hc/en-us/articles/11-Refunds/',
    ]) {
      const response = await get(help, path);
      expect(response.status, path).toBe(301);
      expect(response.headers.get('location'), path).toBe('/help/billing/refunds');
    }
    // And the article is really there.
    const landed = await get(help, '/help/billing/refunds');
    expect(landed.status).toBe(200);
    expect(await landed.text()).toContain('Issuing a refund');
  });

  it('keeps the query string, and answers HEAD the same way', async () => {
    const help = helpCenter();
    const response = await get(help, '/hc/en-us/articles/11-Refunds?utm_source=newsletter');
    expect(response.headers.get('location')).toBe('/help/billing/refunds?utm_source=newsletter');
    const head = await get(help, '/hc/en-us/articles/11-Refunds', 'HEAD');
    expect(head.status).toBe(301);
    expect(head.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('lands under the base path the help centre is mounted at now', async () => {
    const docs = await get(helpCenter({ basePath: '/docs' }), '/hc/en-us/articles/11-Refunds');
    expect(docs.headers.get('location')).toBe('/docs/billing/refunds');
    const root = await get(helpCenter({ basePath: '/' }), '/hc/en-us/articles/11-Refunds');
    expect(root.headers.get('location')).toBe('/billing/refunds');
  });

  it('is a 404, as before, when nothing matches', async () => {
    const response = await get(helpCenter(), '/help/hc/en-us/articles/99-Never-existed');
    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('We could not find that page');
  });

  it('never shadows a page that exists, or sends a page to itself', async () => {
    writeRedirects([
      { from: '/help/billing/invoices', to: '/help/billing/refunds' },
      { from: '/help/billing/gone', to: '/help/billing/gone' },
    ]);
    const help = helpCenter();
    expect((await get(help, '/help/billing/invoices')).status).toBe(200);
    expect((await get(help, '/help/billing/gone')).status).toBe(404);
  });
});

describe('where a redirect may send someone', () => {
  const refused = [
    'https://evil.test/billing/refunds',
    'http://evil.test',
    '//evil.test/billing',
    '/\\evil.test',
    '\\\\evil.test',
    'javascript:alert(1)',
    'data:text/html,hi',
    '/help/../admin/helpwell',
    '/help/%2e%2e/admin/helpwell',
    '/help/\t/evil.test',
    '/help/billing/refunds\r\nset-cookie: x=1',
    '/admin/helpwell',
    '/help/billing/refunds?next=//evil.test',
  ];

  it('refuses anything outside this help centre, and the request stays a 404', async () => {
    writeRedirects(refused.map((to, n) => ({ from: `/old/${n}`, to })));
    const help = helpCenter();
    for (const [n, to] of refused.entries()) {
      const response = await get(help, `/old/${n}`);
      expect(response.status, to).toBe(404);
      expect(response.headers.get('location'), to).toBeNull();
    }
  });

  it('refuses another site on a help centre at the root, where every path is its own', () => {
    const root = { basePath: '', writtenUnder: '/help' };
    // A browser reads a Location of `//evil.test` as another host.
    expect(redirectTarget('/.//evil.test', root)).toBeNull();
    expect(redirectTarget('/help//evil.test', root)).toBeNull();
    for (const to of refused.filter((target) => /evil|:/.test(target))) {
      expect(redirectTarget(to, root), to).toBeNull();
    }
    expect(redirectTarget('/help/billing/refunds', root)).toBe('/billing/refunds');
  });

  it('takes a path relative to the help centre, or one written for another mount', () => {
    const mounts = { basePath: '/support', writtenUnder: '/help' };
    expect(redirectTarget('billing/refunds', mounts)).toBe('/support/billing/refunds');
    expect(redirectTarget('/help/billing/refunds', mounts)).toBe('/support/billing/refunds');
    expect(redirectTarget('/support/billing/refunds', mounts)).toBe('/support/billing/refunds');
    expect(redirectTarget('/help/billing/r%C3%A9sum%C3%A9', mounts)).toBe(
      '/support/billing/r%C3%A9sum%C3%A9',
    );
  });
});

describe('the redirects file', () => {
  it('is read again when it changes, so an import is live without a restart', async () => {
    const help = helpCenter();
    expect((await get(help, '/hc/en-us/articles/11-Refunds')).headers.get('location')).toBe(
      '/help/billing/refunds',
    );

    writeRedirects([{ from: OLD, to: '/help/billing/invoices' }]);
    expect((await get(help, '/hc/en-us/articles/11-Refunds')).headers.get('location')).toBe(
      '/help/billing/invoices',
    );

    rmSync(file);
    expect((await get(help, '/hc/en-us/articles/11-Refunds')).status).toBe(404);
  });

  it('is ignored, with one warning, when it is not a redirects file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRedirects('this is not json');
    const help = helpCenter();
    expect((await get(help, '/hc/en-us/articles/11-Refunds')).status).toBe(404);
    expect((await get(help, '/hc/en-us/articles/12-Other')).status).toBe(404);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('redirects.json');
  });

  it('can be rules in code instead, or switched off', async () => {
    const inCode = helpCenter({
      redirects: [{ from: '/en/articles/42-invoices', to: '/help/billing/invoices' }],
    });
    expect((await get(inCode, '/en/articles/42-invoices')).headers.get('location')).toBe(
      '/help/billing/invoices',
    );
    const off = helpCenter({ redirects: false });
    expect((await get(off, '/hc/en-us/articles/11-Refunds')).status).toBe(404);
  });
});
