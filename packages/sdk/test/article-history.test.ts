/**
 * `client.admin` for editing articles and reading their history: each method
 * is one request to the route core registers for it, slugs encoded a segment
 * at a time so `billing/invoices` stays two segments, and all of them behind
 * the admin token.
 */

import type {
  ArticleComparison as CoreArticleComparison,
  ArticleSource as CoreArticleSource,
  ArticleVersion as CoreArticleVersion,
  ArticleVersionSummary as CoreArticleVersionSummary,
  RestoreArticleResult as CoreRestoreArticleResult,
  SaveArticleResult as CoreSaveArticleResult,
} from '@helpwell/core/repos';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import {
  type ArticleComparison,
  type ArticleSource,
  type ArticleVersion,
  type ArticleVersionSummary,
  HelpWellApiError,
  HelpWellClient,
  type RestoreArticleResult,
  type SaveArticleResult,
} from '../src/index.js';
import { BASE, type Recorder, recorder } from './helpers/recorder.js';

/** What JSON does to a repo's return value: every Date becomes a string. */
type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

describe('the wire types', () => {
  it('match what core returns, dates as strings', () => {
    expectTypeOf<ArticleVersionSummary>().toEqualTypeOf<Jsonified<CoreArticleVersionSummary>>();
    expectTypeOf<ArticleVersion>().toEqualTypeOf<Jsonified<CoreArticleVersion>>();
    expectTypeOf<ArticleComparison>().toEqualTypeOf<Jsonified<CoreArticleComparison>>();
    expectTypeOf<ArticleSource>().toEqualTypeOf<Jsonified<CoreArticleSource>>();
    expectTypeOf<SaveArticleResult>().toEqualTypeOf<Jsonified<CoreSaveArticleResult>>();
  });
});

const TOKEN = 'admin-token-for-tests';

let http: Recorder;
let client: HelpWellClient;

beforeEach(() => {
  http = recorder();
  client = new HelpWellClient({ baseUrl: BASE, adminToken: TOKEN, fetch: http.fetch });
});

describe('article history and editing', () => {
  it('saves an article as a JSON POST', async () => {
    http.reply({
      slug: 'billing/refunds',
      path: 'billing/refunds.md',
      title: 'Refunds',
      changed: true,
      versionId: 4,
    });
    const result = await client.admin.saveArticle({
      path: 'billing/refunds.md',
      markdown: '---\ntitle: Refunds\n---\n\nWithin 30 days.',
      create: true,
    });
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/articles');
    expect(call.body).toEqual({
      path: 'billing/refunds.md',
      markdown: '---\ntitle: Refunds\n---\n\nWithin 30 days.',
      create: true,
    });
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(result.versionId).toBe(4);
  });

  it('reads the source, the versions, one version and a diff by slug', async () => {
    http.reply({ slug: 'billing/a b', markdown: '# x' });
    await client.admin.articleSource('billing/a b');
    http.reply({ items: [{ id: 2 }, { id: 1 }] });
    const versions = await client.admin.articleVersions('billing/a b', { limit: 5 });
    http.reply({ id: 2 });
    await client.admin.articleVersion('billing/a b', 2);
    http.reply({ added: 1, removed: 1, lines: [] });
    await client.admin.articleDiff('billing/a b', 2);
    http.reply({ added: 0, removed: 0, lines: [] });
    await client.admin.articleDiff('billing/a b', 2, 1);

    expect(versions.map((v) => v.id)).toEqual([2, 1]);
    expect(http.calls.map((c) => c.path)).toEqual([
      '/admin/articles/billing/a%20b/source',
      '/admin/articles/billing/a%20b/versions?limit=5',
      '/admin/articles/billing/a%20b/versions/2',
      '/admin/articles/billing/a%20b/diff?to=2',
      '/admin/articles/billing/a%20b/diff?to=2&from=1',
    ]);
  });

  it('needs the admin token, like every admin call', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    for (const attempt of [
      () => bare.admin.saveArticle({ path: 'a/b.md', markdown: '' }),
      () => bare.admin.articleSource('a/b'),
      () => bare.admin.articleVersions('a/b'),
      () => bare.admin.articleVersion('a/b', 1),
      () => bare.admin.articleDiff('a/b', 1),
    ]) {
      await expect(attempt()).rejects.toThrow(HelpWellApiError);
    }
    expect(http.calls).toHaveLength(0);
  });

  it('surfaces a server with no writeArticle hook as a typed error', async () => {
    http.reply(
      {
        error: {
          code: 'not_configured',
          message: 'This install cannot save articles to the repo.',
        },
      },
      501,
    );
    await expect(
      client.admin.saveArticle({ path: 'a/b.md', markdown: '# b' }),
    ).rejects.toMatchObject({ code: 'not_configured', status: 501 });
  });
});

describe('restoring a version and uploading an image', () => {
  it('matches what core returns for a restore', () => {
    expectTypeOf<RestoreArticleResult>().toEqualTypeOf<Jsonified<CoreRestoreArticleResult>>();
  });

  it('restores a version as a POST with no body', async () => {
    http.reply({
      slug: 'billing/refunds',
      path: 'billing/refunds.md',
      title: 'Refunds',
      changed: true,
      versionId: 9,
      embedded: false,
      restoredFrom: 3,
    });
    const result = await client.admin.restoreArticleVersion('billing/refunds', 3);
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/articles/billing/refunds/versions/3/restore');
    expect(call.body).toBeUndefined();
    expect(result).toMatchObject({ restoredFrom: 3, versionId: 9 });
  });

  it('uploads an image as its raw bytes, with its name in a header', async () => {
    http.reply(
      {
        path: '_media/abc.png',
        contentType: 'image/png',
        size: 3,
        url: null,
        reference: '../_media/abc.png',
        markdown: '![The page](../_media/abc.png)',
        src: '/api/helpwell/media/_media/abc.png',
      },
      201,
    );
    const bytes = new Uint8Array([0x89, 0x50, 0x4e]);
    const asset = await client.admin.uploadAsset(bytes, { filename: 'The page.png' });
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/assets');
    expect(call.headers['content-type']).toBe('application/octet-stream');
    expect(call.headers['x-helpwell-filename']).toBe('The%20page.png');
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(asset.markdown).toBe('![The page](../_media/abc.png)');

    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    await expect(bare.admin.uploadAsset(bytes)).rejects.toThrow(HelpWellApiError);
    await expect(bare.admin.restoreArticleVersion('a/b', 1)).rejects.toThrow(HelpWellApiError);
  });
});
