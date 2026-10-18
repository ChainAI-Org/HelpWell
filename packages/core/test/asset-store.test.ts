/**
 * The asset seam: images uploaded for articles, kept through an `AssetStore`.
 *
 * Checked by their bytes (PNG, JPEG, GIF, WebP; never SVG), capped in size,
 * named by a hash so the same image is one file, and kept wherever the
 * install keeps them: its content source (managed), the docs folder on disk
 * (a repo), or a host's own store that answers with a URL. The API takes
 * uploads at `POST /admin/assets` and serves what the built-in stores keep at
 * `/media/_media/…`, the way it serves screenshots.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHelpWellHandler } from '../src/api.js';
import {
  type AssetStore,
  assetMarkdown,
  contentAssetStore,
  fileAssetStore,
  MAX_ASSET_BYTES,
  resolveAssetStore,
  sniffImage,
  storeAsset,
} from '../src/content/assets.js';
import { createMemoryContentSource } from '../src/content/source.js';
import { freshDb, type TestDb } from './helpers/db.js';

const ADMIN = 'assets-admin-token-assets-admin-token';

/** The smallest bytes each format is recognised by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const GIF = new TextEncoder().encode('GIF89a....');
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const SVG = new TextEncoder().encode(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

let t: TestDb;
let dir: string;

beforeEach(async () => {
  t = await freshDb();
  dir = mkdtempSync(join(tmpdir(), 'helpwell-assets-'));
});

afterEach(async () => {
  await t.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('checking an upload', () => {
  it('knows the four formats by their bytes, and nothing else', () => {
    expect([PNG, JPEG, GIF, WEBP].map(sniffImage)).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]);
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });

  it('refuses SVG, unknown types, empty files and anything over the limit, saying why', async () => {
    const content = createMemoryContentSource();
    const store = contentAssetStore(content);
    await expect(storeAsset(store, SVG)).rejects.toMatchObject({
      code: 'bad_request',
      details: { reason: 'svg' },
      publicMessage: expect.stringContaining('PNG'),
    });
    await expect(storeAsset(store, new TextEncoder().encode('hello'))).rejects.toMatchObject({
      details: { reason: 'type' },
    });
    await expect(storeAsset(store, new Uint8Array())).rejects.toMatchObject({
      details: { reason: 'empty' },
    });
    const big = new Uint8Array(MAX_ASSET_BYTES + 1);
    big.set(PNG);
    await expect(storeAsset(store, big)).rejects.toMatchObject({
      details: { reason: 'too_large' },
    });
    expect(content.files.size).toBe(0);
  });
});

describe('the built-in stores', () => {
  it('keeps an image among the content, once, and says how an article reaches it', async () => {
    const content = createMemoryContentSource();
    const record = await storeAsset(contentAssetStore(content), PNG);
    expect(record.path).toMatch(/^_media\/[0-9a-f]{24}\.png$/);
    expect(record).toMatchObject({ contentType: 'image/png', size: PNG.length, url: null });
    expect(record.reference).toBe(`../${record.path}`);
    expect(await content.read(record.path)).toEqual(PNG);
    // The same bytes again are the same file, not a second one.
    const again = await storeAsset(contentAssetStore(content), PNG);
    expect(again.path).toBe(record.path);
    expect(content.files.size).toBe(1);
    expect(assetMarkdown(record, 'billing-page.png')).toBe(`![billing page](${record.reference})`);
    expect(assetMarkdown(record, 'a ] b [ c')).toBe(`![a b c](${record.reference})`);
  });

  it('keeps an image in the docs folder on disk, under _media', async () => {
    const record = await storeAsset(fileAssetStore({ docs: 'docs', cwd: dir }), JPEG);
    expect(record.path).toMatch(/^_media\/[0-9a-f]{24}\.jpg$/);
    expect(new Uint8Array(readFileSync(join(dir, 'docs', ...record.path.split('/'))))).toEqual(
      JPEG,
    );
  });

  it('uses the URL a host’s own store answers with, and refuses one that is not a URL', async () => {
    const put: string[] = [];
    const cdn: AssetStore = {
      async put(asset) {
        put.push(`${asset.path} ${asset.contentType} ${asset.bytes.length}`);
        return { url: `https://cdn.example.com/acme/${asset.path}` };
      },
    };
    const record = await storeAsset(cdn, GIF);
    expect(put).toEqual([`${record.path} image/gif ${GIF.length}`]);
    expect(record.url).toBe(`https://cdn.example.com/acme/${record.path}`);
    expect(record.reference).toBe(record.url);

    const bad: AssetStore = { put: async () => ({ url: 'javascript:alert(1)' }) };
    await expect(storeAsset(bad, GIF)).rejects.toMatchObject({ code: 'internal' });
  });

  it('picks the store an install’s options call for', () => {
    const own: AssetStore = { put: async () => ({}) };
    const writable = createMemoryContentSource();
    const readOnly = { ...createMemoryContentSource(), write: undefined, remove: undefined };
    expect(resolveAssetStore({ assetStore: own, content: writable })).toBe(own);
    expect(resolveAssetStore({ assetStore: false, content: writable })).toBeNull();
    expect(resolveAssetStore({ content: writable })).not.toBeNull();
    expect(resolveAssetStore({ content: readOnly })).toBeNull();
    expect(resolveAssetStore({ docs: null })).toBeNull();
    expect(resolveAssetStore({ docs: 'docs', cwd: dir })).not.toBeNull();
  });
});

describe('POST /admin/assets', () => {
  const upload = (
    handler: ReturnType<typeof createHelpWellHandler>,
    bytes: Uint8Array<ArrayBuffer>,
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request('http://localhost/api/helpwell/admin/assets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ADMIN}`,
          'content-type': 'application/octet-stream',
          ...headers,
        },
        body: bytes,
      }),
    );

  it('keeps an upload in a managed install’s content, and serves it at /media', async () => {
    const content = createMemoryContentSource();
    const handler = createHelpWellHandler({ db: t.db, adminToken: ADMIN, content, env: {} });
    const response = await upload(handler, PNG, {
      'x-helpwell-filename': encodeURIComponent('The page.png'),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string>;
    expect(body.path).toMatch(/^_media\/[0-9a-f]{24}\.png$/);
    expect(body.markdown).toBe(`![The page](../${body.path})`);
    expect(body.src).toBe(`/api/helpwell/media/${body.path}`);

    const served = await handler(new Request(`http://localhost${body.src}`));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('keeps an upload in the docs folder of a repo install that can save articles', async () => {
    const handler = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      env: {},
      media: { docs: join(dir, 'docs') },
      writeArticle: () => {},
    });
    const response = await upload(handler, WEBP);
    expect(response.status).toBe(201);
    const { path, src } = (await response.json()) as { path: string; src: string };
    expect(new Uint8Array(readFileSync(join(dir, 'docs', ...path.split('/'))))).toEqual(WEBP);
    expect((await handler(new Request(`http://localhost${src}`))).status).toBe(200);
  });

  it('refuses SVG with 400 and says why, and answers 501 where nothing can be kept', async () => {
    const content = createMemoryContentSource();
    const handler = createHelpWellHandler({ db: t.db, adminToken: ADMIN, content, env: {} });
    const svg = await upload(handler, SVG);
    expect(svg.status).toBe(400);
    expect(((await svg.json()) as { error: { message: string } }).error.message).toContain('SVG');
    expect(content.files.size).toBe(0);

    // A repo install with no way to save articles keeps no images either.
    const none = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      env: {},
      media: { docs: join(dir, 'docs') },
    });
    expect((await upload(none, PNG)).status).toBe(501);
    const off = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      content,
      assetStore: false,
      env: {},
    });
    expect((await upload(off, PNG)).status).toBe(501);
    // Admins only.
    const anonymous = await handler(
      new Request('http://localhost/api/helpwell/admin/assets', { method: 'POST', body: PNG }),
    );
    expect(anonymous.status).toBe(401);
  });

  it('refuses a body over the limit before reading it all', async () => {
    const handler = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      content: createMemoryContentSource(),
      env: {},
    });
    const big = new Uint8Array(MAX_ASSET_BYTES + 10);
    big.set(PNG);
    const response = await upload(handler, big);
    expect(response.status).toBe(400);
    expect(
      ((await response.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('too_large');
  });
});
