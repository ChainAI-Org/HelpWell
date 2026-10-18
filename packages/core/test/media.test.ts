/**
 * Screenshots and other media an article references: the rewrite at index
 * time, and serving the files back without ever leaving the folder they are
 * served from.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHelpWellHandler, type HelpWellHandler } from '../src/api.js';
import { parseArticle, readKnowledgeBase } from '../src/content/articles.js';
import {
  resolveMediaDirs,
  resolveMediaPath,
  rewriteMediaUrls,
  screenshotsRelativeToDocs,
} from '../src/content/media.js';
import { freshDb, type TestDb } from './helpers/db.js';

/** A real one-pixel PNG, so a browser (or a test) could decode what comes back. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('rewriting relative paths at index time', () => {
  const rewrite = (markdown: string, path = 'getting-started/welcome.md') =>
    rewriteMediaUrls(markdown, path);

  it('points the init template’s screenshot path at the API', () => {
    expect(rewrite('![The dashboard](../_screenshots/dashboard.png)')).toBe(
      '![The dashboard](/api/helpwell/screenshots/dashboard.png)',
    );
  });

  it('serves an image beside the article from the media route', () => {
    expect(rewrite('![x](./img/step-1.png) and ![y](diagram.svg)')).toBe(
      '![x](/api/helpwell/media/getting-started/img/step-1.png) and ![y](/api/helpwell/media/getting-started/diagram.svg)',
    );
    expect(rewrite('![Demo](../_screenshots/demo.mp4)')).toBe(
      '![Demo](/api/helpwell/screenshots/demo.mp4)',
    );
  });

  it('follows a custom API path and a screenshots folder outside the docs', () => {
    expect(
      rewriteMediaUrls('![x](../../public/shots/a.png)', 'billing/a.md', {
        apiPath: '/support/api/',
        screenshots: '../public/shots',
      }),
    ).toBe('![x](/support/api/screenshots/a.png)');
  });

  it('leaves absolute URLs, root paths, code and non-media alone', () => {
    const untouched = [
      '![x](https://cdn.example/a.png)',
      '![x](/static/a.png)',
      '`![x](../_screenshots/a.png)`',
      '```\n![x](../_screenshots/a.png)\n```',
      '[a link](../_screenshots/a.png)',
      '![x](../notes.txt)',
    ];
    for (const markdown of untouched) expect(rewrite(markdown)).toBe(markdown);
  });

  it('never invents a URL for a path that leaves the docs folder', () => {
    expect(rewrite('![x](../../../secret.png)')).toBe('![x](../../../secret.png)');
  });

  it('encodes each segment and keeps a query or fragment', () => {
    expect(rewrite('![x](../_screenshots/my%20shot.png?v=2)')).toBe(
      '![x](/api/helpwell/screenshots/my%20shot.png?v=2)',
    );
  });

  it('keeps the file as written on the article, and hashes as before when nothing moved', () => {
    const withImage = '---\ntitle: A\n---\n![x](../_screenshots/a.png)';
    const article = parseArticle(withImage, { collection: 'c', file: 'a.md' });
    expect(article.body).toBe('![x](/api/helpwell/screenshots/a.png)');
    expect(article.source).toBe(withImage);

    const plain = '---\ntitle: B\n---\nNo pictures.';
    const one = parseArticle(plain, { collection: 'c', file: 'b.md' });
    const two = parseArticle(plain, { collection: 'c', file: 'b.md', media: false });
    expect(one.contentHash).toBe(two.contentHash);

    const raw = parseArticle(withImage, { collection: 'c', file: 'a.md', media: false });
    expect(raw.body).toBe('![x](../_screenshots/a.png)');
    expect(raw.contentHash).not.toBe(article.contentHash);
  });

  it('works out where the screenshots folder is relative to the docs', () => {
    expect(screenshotsRelativeToDocs('/repo/docs', '/repo/docs/_screenshots')).toBe('_screenshots');
    expect(screenshotsRelativeToDocs('/repo/docs', '/repo/public/shots')).toBe('../public/shots');
  });
});

describe('resolving a requested file', () => {
  const root = join(tmpdir(), 'hw-media-root');

  it('accepts a plain path to an image or video', () => {
    expect(resolveMediaPath(root, 'dashboard.png')).toBe(join(root, 'dashboard.png'));
    expect(resolveMediaPath(root, 'billing/step 1.webp')).toBe(
      join(root, 'billing', 'step 1.webp'),
    );
  });

  it('refuses anything that could leave the folder or reach something hidden', () => {
    for (const path of [
      '../package.json',
      '../x.png',
      'a/../../x.png',
      './x.png',
      '/etc/x.png',
      'a//x.png',
      'a\\..\\x.png',
      'C:/x.png',
      '.git/x.png',
      'a/.hidden.png',
      'x.png\0.txt',
      '',
    ]) {
      expect(resolveMediaPath(root, path), path).toBeNull();
    }
  });

  it('refuses types that are not images or video', () => {
    expect(resolveMediaPath(root, 'welcome.md')).toBeNull();
    expect(resolveMediaPath(root, 'x.html')).toBeNull();
    expect(resolveMediaPath(root, 'x.js')).toBeNull();
  });

  it('defaults to the layout init writes, and serves nothing when told not to', () => {
    const dirs = resolveMediaDirs(undefined, '/repo');
    expect(dirs.docs).toBe(resolve('/repo', 'docs'));
    expect(dirs.screenshots).toBe(resolve('/repo', 'docs', '_screenshots'));
    expect(resolveMediaDirs({ docs: 'content' }, '/repo').screenshots).toBe(
      resolve('/repo', 'content', '_screenshots'),
    );
    expect(resolveMediaDirs(false)).toEqual({ docs: null, screenshots: null });
  });
});

describe('serving screenshots from the API', () => {
  let dir: string;
  let t: TestDb;
  let api: HelpWellHandler;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hw-media-'));
    mkdirSync(join(dir, 'docs', '_screenshots'), { recursive: true });
    mkdirSync(join(dir, 'docs', 'billing'), { recursive: true });
    writeFileSync(join(dir, 'docs', '_screenshots', 'dashboard.png'), PNG);
    writeFileSync(join(dir, 'docs', '_screenshots', 'demo.mp4'), Buffer.alloc(1000, 7));
    writeFileSync(join(dir, 'docs', 'billing', 'invoice.png'), PNG);
    writeFileSync(join(dir, 'docs', 'billing', 'invoices.md'), '# Secret draft');
    writeFileSync(join(dir, 'secret.png'), PNG);
    t = await freshDb();
    api = createHelpWellHandler({
      db: t.db,
      basePath: '/api/helpwell',
      media: { docs: join(dir, 'docs') },
    });
  });

  afterAll(async () => {
    await t.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, headers: Record<string, string> = {}) =>
    api(new Request(`http://localhost/api/helpwell${path}`, { headers }));

  it('serves a screenshot with its type and caching headers', async () => {
    const response = await get('/screenshots/dashboard.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('max-age=300');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('serves an image beside an article from the media route, but never the article', async () => {
    expect((await get('/media/billing/invoice.png')).status).toBe(200);
    expect((await get('/media/billing/invoices.md')).status).toBe(404);
    expect((await get('/media/_screenshots/dashboard.png')).status).toBe(200);
  });

  it('answers a revalidation with 304', async () => {
    const first = await get('/screenshots/dashboard.png');
    const etag = first.headers.get('etag') ?? '';
    const again = await get('/screenshots/dashboard.png', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  it('serves byte ranges, which Safari needs to play a video', async () => {
    const response = await get('/screenshots/demo.mp4', { range: 'bytes=0-99' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect((await response.arrayBuffer()).byteLength).toBe(100);
    expect((await get('/screenshots/demo.mp4', { range: 'bytes=5000-' })).status).toBe(416);
  });

  it('answers HEAD without a body', async () => {
    const response = await api(
      new Request('http://localhost/api/helpwell/screenshots/dashboard.png', { method: 'HEAD' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(PNG.length));
  });

  it('cannot be walked out of its folder, however the path is spelled', async () => {
    for (const path of [
      '/screenshots/../../secret.png',
      '/screenshots/..%2F..%2Fsecret.png',
      '/screenshots/%2e%2e/%2e%2e/secret.png',
      '/media/..%2Fsecret.png',
      '/media/..%5Csecret.png',
      '/screenshots/%zz.png',
      '/screenshots/missing.png',
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
    }
  });

  it('serves nothing when media is switched off', async () => {
    const off = createHelpWellHandler({ db: t.db, media: false });
    const response = await off(
      new Request('http://localhost/api/helpwell/screenshots/dashboard.png'),
    );
    expect(response.status).toBe(404);
  });

  it('indexes an article so the image it references is the one served', async () => {
    const kb = readKnowledgeBase(join(dir, 'docs'));
    // Only folders are collections; _screenshots is skipped.
    expect(kb.collections.map((c) => c.id)).toEqual(['billing']);
    writeFileSync(
      join(dir, 'docs', 'billing', 'invoices.md'),
      '# Invoices\n\n![An invoice](./invoice.png)\n\n![The dashboard](../_screenshots/dashboard.png)',
    );
    const [article] = readKnowledgeBase(join(dir, 'docs')).articles;
    const urls = [...(article?.body ?? '').matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(urls).toEqual([
      '/api/helpwell/media/billing/invoice.png',
      '/api/helpwell/screenshots/dashboard.png',
    ]);
    for (const url of urls) {
      const response = await api(new Request(`http://localhost${url}`));
      expect(response.status, url).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
    }
  });
});
