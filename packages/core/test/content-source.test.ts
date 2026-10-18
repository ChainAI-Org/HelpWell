/**
 * Content that is not on this server's disk: the source interface, the two
 * sources HelpWell ships, and everything routed through a source (sync, the
 * media the API serves, and saving from the editor with its history).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler } from '../src/api.js';
import { readKnowledgeBase, readKnowledgeBaseFrom } from '../src/content/articles.js';
import { serveContentMedia } from '../src/content/media.js';
import {
  articleWriter,
  type ContentSource,
  contentPath,
  createFileContentSource,
  createMemoryContentSource,
} from '../src/content/source.js';
import { rowsOf } from '../src/db/rows.js';
import { listArticleVersions } from '../src/repos/article-history.js';
import { listCollections } from '../src/repos/collections.js';
import { syncContent } from '../src/search/sync.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ADMIN = 'content-admin-token';

/** A small knowledge base, as a host would keep it. */
function sampleFiles(): Record<string, string | Uint8Array> {
  return {
    'billing/_meta.json': JSON.stringify({ title: 'Billing', icon: 'wallet', order: 1 }),
    'billing/invoices.md':
      '---\ntitle: Exporting invoices\ndescription: Download a CSV.\n---\n\nOpen Billing, then Export.\n\n![The export button](../_screenshots/export.png)\n',
    'billing/refunds.md': '# Refunds\n\nRefunds take five days.\n\n![Receipt](./receipt.png)\n',
    'billing/receipt.png': PNG,
    'getting-started/welcome.md': '---\ntitle: Welcome\norder: 1\n---\n\nHello.\n',
    '_screenshots/export.png': PNG,
    '_drafts/ignored.md': '# Not a collection',
  };
}

describe('content paths', () => {
  it('accepts plain relative paths, underscored names included', () => {
    for (const path of ['billing/invoices.md', 'billing/_meta.json', '_screenshots/a.png']) {
      expect(contentPath(path)).toBe(path);
    }
  });

  it('refuses anything that could leave the content or hide in it', () => {
    for (const path of [
      '',
      '/etc/passwd',
      '../secrets.md',
      'billing/../../x.md',
      'billing//x.md',
      'billing/./x.md',
      '.git/config',
      'billing/.env',
      'C:/x.md',
      'billing\\x.md',
      'billing/x\u0000.md',
      ' billing/x.md',
    ]) {
      expect(contentPath(path), path).toBeNull();
    }
  });
});

describe('the memory source', () => {
  it('lists, reads, writes, stats and removes', async () => {
    const source = createMemoryContentSource({ 'a/one.md': '# One' });
    await source.write?.('a/two.md', '# Two');
    await source.write?.('b/three.md', new TextEncoder().encode('# Three'));

    expect((await source.list()).map((e) => e.path).sort()).toEqual([
      'a/one.md',
      'a/two.md',
      'b/three.md',
    ]);
    expect((await source.list('a/')).map((e) => e.path).sort()).toEqual(['a/one.md', 'a/two.md']);
    expect(await source.readText('b/three.md')).toBe('# Three');
    expect((await source.stat('a/one.md'))?.size).toBe(5);
    expect(await source.stat('a/missing.md')).toBeNull();

    await source.remove?.('a/one.md');
    expect(await source.read('a/one.md')).toBeNull();
    await expect(source.write?.('../escape.md', 'x')).rejects.toThrow();
  });
});

describe('the filesystem source', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hw-source-'));
    mkdirSync(join(root, 'docs', 'billing'), { recursive: true });
    mkdirSync(join(root, 'public', 'shots'), { recursive: true });
    writeFileSync(join(root, 'docs', 'billing', 'invoices.md'), '# Invoices\n');
    writeFileSync(join(root, 'docs', 'billing', 'chart.png'), PNG);
    writeFileSync(join(root, 'public', 'shots', 'export.png'), PNG);
    writeFileSync(join(root, 'secret.txt'), 'do not serve');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('answers _screenshots/ from the screenshots folder wherever it lives', async () => {
    const source = createFileContentSource({
      cwd: root,
      docs: 'docs',
      screenshots: 'public/shots',
    });
    expect(source.screenshots).toBe('../public/shots');
    expect((await source.list()).map((e) => e.path).sort()).toEqual([
      '_screenshots/export.png',
      'billing/chart.png',
      'billing/invoices.md',
    ]);
    expect((await source.list('_screenshots/')).map((e) => e.path)).toEqual([
      '_screenshots/export.png',
    ]);
    expect((await source.read('_screenshots/export.png'))?.length).toBe(PNG.length);
    expect(await source.readText('billing/invoices.md')).toBe('# Invoices\n');
  });

  it('never reads outside its two folders', async () => {
    const source = createFileContentSource({ cwd: root, docs: 'docs' });
    expect(await source.read('../secret.txt')).toBeNull();
    expect(await source.stat('../secret.txt')).toBeNull();
    expect(await source.readText('billing/../../secret.txt')).toBeNull();
  });

  it('refuses a symlink that points out of the folder', async (ctx) => {
    const link = join(root, 'docs', 'billing', 'leak.png');
    try {
      symlinkSync(join(root, 'secret.txt'), link);
    } catch {
      ctx.skip(); // Windows without the symlink privilege.
      return;
    }
    const source = createFileContentSource({ cwd: root, docs: 'docs' });
    expect(await source.read('billing/leak.png')).toBeNull();
    expect((await source.list()).map((e) => e.path)).not.toContain('billing/leak.png');
    rmSync(link, { force: true });
  });

  it('writes new folders and files, and leaves them out when read-only', async () => {
    const source = createFileContentSource({ cwd: root, docs: 'docs' });
    await source.write?.('guides/new.md', '# New\n');
    expect(await source.readText('guides/new.md')).toBe('# New\n');
    await source.remove?.('guides/new.md');
    expect(await source.stat('guides/new.md')).toBeNull();
    await expect(source.write?.('../outside.md', 'x')).rejects.toThrow();

    const readOnly = createFileContentSource({ cwd: root, docs: 'docs', readOnly: true });
    expect(readOnly.write).toBeUndefined();
    expect(articleWriter(undefined, readOnly)).toBeUndefined();
  });

  it('streams a file, or a byte range of it, and nothing outside its folders', async () => {
    const source = createFileContentSource({
      cwd: root,
      docs: 'docs',
      screenshots: 'public/shots',
    });
    const whole = await source.stream?.('_screenshots/export.png');
    expect(Buffer.from(await new Response(whole).arrayBuffer()).equals(PNG)).toBe(true);
    const part = await source.stream?.('billing/chart.png', { start: 1, end: 3 });
    expect(Buffer.from(await new Response(part).arrayBuffer()).equals(PNG.subarray(1, 4))).toBe(
      true,
    );
    expect(await source.stream?.('billing/missing.png')).toBeNull();
    expect(await source.stream?.('billing')).toBeNull();
    expect(await source.stream?.('../secret.txt')).toBeNull();
  });
});

describe('streaming media from a source', () => {
  let root: string;
  // Big enough to arrive in several chunks, with bytes that differ by offset.
  const video = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hw-stream-'));
    mkdirSync(join(root, 'docs', 'guides'), { recursive: true });
    writeFileSync(join(root, 'docs', 'guides', 'tour.mp4'), video);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** The filesystem source, recording which way each response was read. */
  function watched() {
    const files = createFileContentSource({ cwd: root, docs: 'docs' });
    const calls = { reads: 0, streams: [] as ({ start: number; end: number } | undefined)[] };
    const source: ContentSource = {
      ...files,
      read: async (path) => {
        calls.reads++;
        return files.read(path);
      },
      stream: async (path, range) => {
        calls.streams.push(range);
        return (await files.stream?.(path, range)) ?? null;
      },
    };
    return { source, calls };
  }

  const get = (source: ContentSource, headers: Record<string, string> = {}, method = 'GET') =>
    serveContentMedia(
      source,
      'guides/tour.mp4',
      new Request('http://localhost/api/helpwell/media/guides/tour.mp4', { method, headers }),
    );

  it('streams the whole file, never reading it whole', async () => {
    const { source, calls } = watched();
    const response = await get(source);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe(String(video.length));
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await response.arrayBuffer()).equals(video)).toBe(true);
    expect(calls).toEqual({ reads: 0, streams: [{ start: 0, end: video.length - 1 }] });
  });

  it('streams just the range asked for', async () => {
    const { source, calls } = watched();
    const response = await get(source, { range: 'bytes=150000-150099' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 150000-150099/${video.length}`);
    expect(response.headers.get('content-length')).toBe('100');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(video.subarray(150_000, 150_100))).toBe(true);

    const tail = await get(source, { range: 'bytes=-10' });
    expect(Buffer.from(await tail.arrayBuffer()).equals(video.subarray(-10))).toBe(true);
    expect(calls).toEqual({
      reads: 0,
      streams: [
        { start: 150_000, end: 150_099 },
        { start: video.length - 10, end: video.length - 1 },
      ],
    });
  });

  it('keeps the 304, the 416 and HEAD off the file entirely', async () => {
    const { source, calls } = watched();
    const etag = (await get(source, {}, 'HEAD')).headers.get('etag') ?? '';
    expect((await get(source, { 'if-none-match': etag })).status).toBe(304);
    expect((await get(source, { range: `bytes=${video.length}-` })).status).toBe(416);
    expect(calls).toEqual({ reads: 0, streams: [] });
  });

  it('answers 404 when the file goes between the stat and the stream', async () => {
    const { source } = watched();
    const vanishing: ContentSource = { ...source, stream: async () => null };
    expect((await get(vanishing)).status).toBe(404);
  });

  it('falls back to reading the whole file from a source that cannot stream', async () => {
    const { source, calls } = watched();
    const response = await get({ ...source, stream: undefined }, { range: 'bytes=0-9' });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer()).equals(video.subarray(0, 10))).toBe(true);
    expect(calls.reads).toBe(1);
  });
});

describe('reading a knowledge base from a source', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hw-kb-'));
    for (const [path, data] of Object.entries(sampleFiles())) {
      const full = join(root, 'docs', ...path.split('/'));
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, data);
    }
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('means the same thing as the repo on disk', async () => {
    const fromDisk = readKnowledgeBase(join(root, 'docs'));
    const fromSource = await readKnowledgeBaseFrom(createMemoryContentSource(sampleFiles()));
    const shape = (kb: typeof fromDisk) => ({
      collections: kb.collections.map(({ articles, ...c }) => ({
        ...c,
        articles: articles.map(({ updatedAt: _, ...a }) => a),
      })),
    });
    expect(shape(fromSource)).toEqual(shape(fromDisk));
    expect(fromSource.collections.map((c) => c.id)).toEqual(['billing', 'getting-started']);
    expect(fromSource.articles.map((a) => a.slug)).not.toContain('_drafts/ignored');
  });

  it('rewrites screenshots against the source’s own layout', async () => {
    const kb = await readKnowledgeBaseFrom(createMemoryContentSource(sampleFiles()), {
      media: { apiPath: '/i/acme/api' },
    });
    const invoices = kb.articles.find((a) => a.slug === 'billing/invoices');
    expect(invoices?.body).toContain('](/i/acme/api/screenshots/export.png)');
    const refunds = kb.articles.find((a) => a.slug === 'billing/refunds');
    expect(refunds?.body).toContain('](/i/acme/api/media/billing/receipt.png)');
  });

  it('counts a folder with only a _meta.json as a collection, and a folder of images as none', async () => {
    const files = {
      ...sampleFiles(),
      'pricing/_meta.json': JSON.stringify({ title: 'Plans and pricing', order: 3 }),
      'images/logo.png': PNG,
      'images/old/notes.md': '# One level too deep to be an article',
    };
    const fromSource = await readKnowledgeBaseFrom(createMemoryContentSource(files));
    const pricing = fromSource.collections.find((c) => c.id === 'pricing');
    expect(pricing).toMatchObject({ title: 'Plans and pricing', order: 3, articles: [] });
    expect(fromSource.collections.map((c) => c.id)).toEqual([
      'billing',
      'pricing',
      'getting-started',
    ]);

    // The same files on disk, plus an empty folder: the same collections.
    const disk = mkdtempSync(join(tmpdir(), 'hw-kb-folders-'));
    try {
      for (const [path, data] of Object.entries(files)) {
        const full = join(disk, ...path.split('/'));
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, data);
      }
      mkdirSync(join(disk, 'drafts-to-come'));
      expect(readKnowledgeBase(disk).collections.map((c) => c.id)).toEqual([
        'billing',
        'pricing',
        'getting-started',
      ]);
    } finally {
      rmSync(disk, { recursive: true, force: true });
    }
  });
});

describe('syncContent', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await freshDb();
  });

  afterEach(async () => {
    await t.close();
  });

  it('indexes, skips what did not change, and removes what left', async () => {
    const source = createMemoryContentSource(sampleFiles());
    const first = await syncContent(t.db, source);
    expect(first).toMatchObject({ articles: 3, collections: 2, indexed: 3, skipped: false });

    const again = await syncContent(t.db, source);
    expect(again).toMatchObject({ indexed: 0, unchanged: 3, removed: 0, versions: 0 });

    await source.remove?.('billing/refunds.md');
    await source.write?.('getting-started/welcome.md', '---\ntitle: Welcome aboard\n---\n\nHi.\n');
    const third = await syncContent(t.db, source);
    expect(third).toMatchObject({ articles: 2, indexed: 1, removed: 1, versions: 1 });

    const titles = rowsOf<{ title: string }>(
      await t.db.execute(sql`SELECT title FROM helpwell.article_index ORDER BY title`),
    ).map((r) => r.title);
    expect(titles).toEqual(['Exporting invoices', 'Welcome aboard']);
  });

  it('keeps a collection with no articles yet in the index, and removes it with its folder', async () => {
    const source = createMemoryContentSource({
      ...sampleFiles(),
      'pricing/_meta.json': JSON.stringify({ title: 'Plans and pricing' }),
      'images/logo.png': PNG,
    });
    expect(await syncContent(t.db, source)).toMatchObject({ collections: 3, articles: 3 });
    const indexed = async () =>
      rowsOf<{ id: string; title: string }>(
        await t.db.execute(sql`SELECT id, title FROM helpwell.collection_index ORDER BY id`),
      );
    expect(await indexed()).toContainEqual({ id: 'pricing', title: 'Plans and pricing' });
    expect((await indexed()).map((c) => c.id)).not.toContain('images');
    // Public listings show a collection once it has something published in it.
    expect((await listCollections(t.db)).map((c) => c.id)).not.toContain('pricing');

    await source.write?.('pricing/plans.md', '# Plans\n\nThree of them.\n');
    await syncContent(t.db, source);
    expect((await listCollections(t.db)).find((c) => c.id === 'pricing')).toMatchObject({
      title: 'Plans and pricing',
      articles: 1,
    });

    await source.remove?.('pricing/plans.md');
    await source.remove?.('pricing/_meta.json');
    expect(await syncContent(t.db, source)).toMatchObject({ collectionsRemoved: 1, removed: 1 });
    expect((await indexed()).map((c) => c.id)).not.toContain('pricing');
  });

  it('prunes a folder of images from the index, and never deletes a file on disk', async () => {
    // An install indexed before the rule changed has `images` as a collection.
    await t.db.execute(sql`
      INSERT INTO helpwell.collection_index (id, title, icon, tint)
      VALUES ('images', 'Images', 'book-open', 'lavender')
    `);
    const root = mkdtempSync(join(tmpdir(), 'hw-prune-'));
    try {
      const files = { ...sampleFiles(), 'images/logo.png': PNG, 'images/diagrams/flow.png': PNG };
      for (const [path, data] of Object.entries(files)) {
        const full = join(root, 'docs', ...path.split('/'));
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, data);
      }
      const source = createFileContentSource({ docs: join(root, 'docs'), cwd: root });

      const result = await syncContent(t.db, source);
      expect(result).toMatchObject({ collections: 2, collectionsRemoved: 1 });
      const ids = rowsOf<{ id: string }>(
        await t.db.execute(sql`SELECT id FROM helpwell.collection_index ORDER BY id`),
      ).map((row) => row.id);
      expect(ids).toEqual(['billing', 'getting-started']);

      // Only the index row went: every file is where it was.
      for (const path of Object.keys(files)) {
        expect(existsSync(join(root, 'docs', ...path.split('/'))), path).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves the index alone when the source is empty, unless told otherwise', async () => {
    const source = createMemoryContentSource(sampleFiles());
    await syncContent(t.db, source);
    const empty = createMemoryContentSource();
    expect(await syncContent(t.db, empty)).toMatchObject({ skipped: true, removed: 0 });
    expect(await syncContent(t.db, empty, { allowEmpty: true })).toMatchObject({ removed: 3 });
  });

  it('keeps a text index when the embedding provider fails', async () => {
    const broken = new FakeModel();
    broken.embed = async () => {
      throw new Error('provider down');
    };
    const result = await syncContent(t.db, createMemoryContentSource(sampleFiles()), {
      model: broken,
      embeddingModel: 'openai/text-embedding-3-small',
    });
    expect(result).toMatchObject({ indexed: 3, embedded: 0, embeddingError: 'provider down' });
  });

  it('embeds with the model it is given', async () => {
    const model = new FakeModel();
    const result = await syncContent(t.db, createMemoryContentSource(sampleFiles()), {
      model,
      embeddingModel: 'openai/text-embedding-3-small',
    });
    expect(result.embedded).toBe(3);
    expect(model.embedRequests).toHaveLength(1);
  });
});

describe('the API with a content source', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await freshDb();
  });

  afterEach(async () => {
    await t.close();
  });

  it('serves screenshots and media from the source, with ranges and no escapes', async () => {
    const source = createMemoryContentSource(sampleFiles());
    const api = client(createHelpWellHandler({ db: t.db, content: source }));

    const shot = await api.call('/screenshots/export.png');
    expect(shot.status).toBe(200);
    expect(shot.headers.get('content-type')).toBe('image/png');
    expect(shot.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(new Uint8Array(PNG));

    const media = await api.call('/media/billing/receipt.png', { headers: { range: 'bytes=0-3' } });
    expect(media.status).toBe(206);
    expect(media.headers.get('content-range')).toBe(`bytes 0-3/${PNG.length}`);
    expect((await media.arrayBuffer()).byteLength).toBe(4);

    const etag = shot.headers.get('etag') ?? '';
    expect(
      (await api.call('/screenshots/export.png', { headers: { 'if-none-match': etag } })).status,
    ).toBe(304);

    expect((await api.call('/media/billing/invoices.md')).status).toBe(404);
    expect((await api.call('/screenshots/missing.png')).status).toBe(404);
    expect((await api.call('/media/..%2F..%2Fsecret.png')).status).toBe(404);
  });

  it('serves nothing when media is switched off', async () => {
    const api = client(
      createHelpWellHandler({
        db: t.db,
        content: createMemoryContentSource(sampleFiles()),
        media: false,
      }),
    );
    expect((await api.call('/screenshots/export.png')).status).toBe(404);
  });

  it('saves an article into a writable source, indexes it and records its history', async () => {
    const source = createMemoryContentSource(sampleFiles());
    await syncContent(t.db, source);
    // No key, whatever this machine has set: a save with one embeds.
    const api = client(
      createHelpWellHandler({ db: t.db, content: source, adminToken: ADMIN, env: {} }),
      { adminToken: ADMIN },
    );

    const markdown = '---\ntitle: Changing plans\n---\n\n![Plans](../_screenshots/export.png)\n';
    const saved = await api.call('/admin/articles', {
      body: { path: 'billing/plans.md', markdown, create: true },
    });
    expect(saved.status).toBe(201);
    expect(await source.readText('billing/plans.md')).toBe(markdown);

    const [row] = rowsOf<{ body: string }>(
      await t.db.execute(sql`SELECT body FROM helpwell.article_index WHERE slug = 'billing/plans'`),
    );
    expect(row?.body).toContain('](/api/helpwell/screenshots/export.png)');

    const versions = await listArticleVersions(t.db, 'billing/plans');
    expect(versions.map((v) => v.origin)).toEqual(['api']);

    // The next sync reads the same file back: nothing new to record.
    expect(await syncContent(t.db, source)).toMatchObject({ versions: 0, removed: 0 });
  });

  it('prefers the host’s hook over the source, and refuses to save with neither', async () => {
    const source = createMemoryContentSource(sampleFiles());
    const written: string[] = [];
    const hook = async (path: string) => {
      written.push(path);
    };
    expect(articleWriter(hook, source)).toBe(hook);

    const readOnly = client(
      createHelpWellHandler({
        db: t.db,
        content: { ...source, write: undefined, remove: undefined },
        adminToken: ADMIN,
      }),
      { adminToken: ADMIN },
    );
    const refused = await readOnly.call('/admin/articles', {
      body: { path: 'billing/plans.md', markdown: '# Plans', create: true },
    });
    expect(refused.status).toBe(501);
  });
});
