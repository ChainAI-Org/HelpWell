/**
 * One install served by a host: on a custom domain it names that domain in
 * every absolute link, and its images come from the host's content source
 * rather than a docs folder on disk.
 */

import { createMemoryContentSource } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHelpCenter } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Where the host really serves it, and the address the customer gave it. */
const HOST = 'https://host.example';
const PUBLIC = 'https://help.acme.test';

let db: Db;
const content = createMemoryContentSource({
  'billing/invoices.md':
    '---\ntitle: Exporting invoices\ndescription: Download a CSV.\n---\n\n![Export](../_screenshots/export.png)\n\n![Chart](./chart.png)\n',
  'billing/chart.png': PNG,
  '_screenshots/export.png': PNG,
});

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({
    product: { name: 'Acme' },
    changelog: { publicPage: true },
  });
  await syncContent(db, content, { media: { apiPath: '/i/acme/api' } });
});

describe('publicUrl', () => {
  it('names the public address in canonical, Open Graph, sitemap, feed, llms.txt and JSON-LD', async () => {
    const help = createHelpCenter({ db, basePath: '/i/acme/help', publicUrl: `${PUBLIC}/` });
    const get = async (path: string) =>
      (await help(new Request(`${HOST}/i/acme/help${path}`))).text();

    const article = await get('/billing/invoices');
    expect(article).toContain(`<link rel="canonical" href="${PUBLIC}/billing/invoices">`);
    expect(article).toContain(`<meta property="og:url" content="${PUBLIC}/billing/invoices">`);
    expect(article).toContain(`"mainEntityOfPage":"${PUBLIC}/billing/invoices"`);
    expect(article).not.toContain(`${HOST}/i/acme/help/billing`);

    expect(await get('/sitemap.xml')).toContain(`<loc>${PUBLIC}/billing/invoices</loc>`);
    expect(await get('/llms.txt')).toContain(`(${PUBLIC}/billing/invoices)`);
    expect(await get('/changelog/rss.xml')).toContain(`<link>${PUBLIC}/changelog</link>`);

    // In-page links still follow where the handler is mounted.
    expect(await get('/')).toContain('href="/i/acme/help/changelog"');
  });

  it('keeps a path on the public address', async () => {
    const help = createHelpCenter({ db, basePath: '/help', publicUrl: 'https://acme.test/docs' });
    const page = await (await help(new Request(`${HOST}/help`))).text();
    expect(page).toContain('<link rel="canonical" href="https://acme.test/docs/">');
  });

  it('refuses an address that is not an absolute http(s) URL', () => {
    expect(() => createHelpCenter({ db, publicUrl: 'help.acme.test' })).toThrow(/absolute/);
    expect(() => createHelpCenter({ db, publicUrl: 'ftp://help.acme.test' })).toThrow(/http/);
  });

  it('falls back to origin and mount path without one, as before', async () => {
    const help = createHelpCenter({ db, basePath: '/help', origin: 'https://acme.test' });
    const page = await (await help(new Request(`${HOST}/help`))).text();
    expect(page).toContain('<link rel="canonical" href="https://acme.test/help/">');
  });
});

describe('a content source', () => {
  it('serves the images an article uses from the source', async () => {
    const help = createHelpCenter({
      db,
      basePath: '/i/acme/help',
      apiPath: '/i/acme/api',
      content,
    });
    const page = await (await help(new Request(`${HOST}/i/acme/help/billing/invoices`))).text();
    const sources = [...page.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(sources).toEqual([
      '/i/acme/help/_screenshots/export.png',
      '/i/acme/help/_media/billing/chart.png',
    ]);
    for (const src of sources) {
      const response = await help(new Request(`${HOST}${src}`));
      expect(response.status, src).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
    }
    expect((await help(new Request(`${HOST}/i/acme/help/_media/billing/invoices.md`))).status).toBe(
      404,
    );
  });

  it('serves nothing from it when media is off', async () => {
    const help = createHelpCenter({ db, basePath: '/help', content, media: false });
    expect((await help(new Request(`${HOST}/help/_screenshots/export.png`))).status).toBe(404);
  });
});
