/**
 * Restoring an article to an earlier version: the old words saved again as
 * the newest version, through the same hook or writable content source as
 * any save, with the history before it left exactly as it was. Through the
 * repo function and through the admin API, for a repo install (a
 * `writeArticle` hook) and a managed one (a content source).
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHelpWellHandler } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import { rowsOf } from '../src/db/rows.js';
import {
  listArticleVersions,
  restoreArticleVersion,
  saveArticle,
} from '../src/repos/article-history.js';
import { syncContent } from '../src/search/sync.js';
import { freshDb, type TestDb } from './helpers/db.js';

const ADMIN = 'restore-admin-token-restore-admin-token';

let t: TestDb;

beforeEach(async () => {
  t = await freshDb();
});

afterEach(async () => {
  await t.close();
});

function file(title: string, body: string, extra = ''): string {
  return `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
}

/** Three saves of one article through a hook that keeps the files in a map. */
async function threeVersions() {
  const written = new Map<string, string>();
  const write = (path: string, markdown: string) => {
    written.set(path, markdown);
  };
  const path = 'billing/refunds.md';
  await saveArticle(t.db, {
    path,
    markdown: file('Refunds', 'Within 14 days.'),
    write,
    create: true,
  });
  await saveArticle(t.db, {
    path,
    markdown: file('Refunds', 'Within 30 days.'),
    write,
    slug: 'billing/refunds',
  });
  await saveArticle(t.db, {
    path,
    markdown: file('Refunds and credits', 'Within 60 days, as credit.'),
    write,
    slug: 'billing/refunds',
  });
  const versions = await listArticleVersions(t.db, 'billing/refunds');
  return { written, write, versions };
}

describe('restoreArticleVersion', () => {
  it('saves the old words as the newest version, and keeps every version before it', async () => {
    const { written, write, versions } = await threeVersions();
    expect(versions).toHaveLength(3);
    const oldest = versions[2]!;

    const restored = await restoreArticleVersion(t.db, {
      slug: 'billing/refunds',
      versionId: oldest.id,
      write,
      origin: 'dashboard',
    });
    expect(restored).toMatchObject({
      changed: true,
      restoredFrom: oldest.id,
      slug: 'billing/refunds',
    });
    // Written through the hook, as a save would be.
    expect(written.get('billing/refunds.md')).toContain('Within 14 days.');
    expect(written.get('billing/refunds.md')).toContain('title: Refunds\n');

    const after = await listArticleVersions(t.db, 'billing/refunds');
    expect(after).toHaveLength(4);
    // History is only added to: the three before are untouched.
    expect(after.slice(1).map((v) => v.id)).toEqual(versions.map((v) => v.id));
    expect(after[0]).toMatchObject({ restoredFrom: oldest.id, origin: 'dashboard' });
    expect(after.slice(1).every((v) => v.restoredFrom === null)).toBe(true);

    const [row] = rowsOf<{ body: string; title: string }>(
      await t.db.execute(
        sql`SELECT body, title FROM helpwell.article_index WHERE slug = 'billing/refunds'`,
      ),
    );
    expect(row).toMatchObject({ title: 'Refunds' });
    expect(row?.body).toContain('Within 14 days.');
  });

  it('changes nothing when the version is what the article already says', async () => {
    const { write, versions } = await threeVersions();
    const result = await restoreArticleVersion(t.db, {
      slug: 'billing/refunds',
      versionId: versions[0]!.id,
      write,
    });
    expect(result.changed).toBe(false);
    expect(await listArticleVersions(t.db, 'billing/refunds')).toHaveLength(3);
  });

  it('refuses a version from another article, and one with nowhere to write', async () => {
    const { write, versions } = await threeVersions();
    await saveArticle(t.db, {
      path: 'billing/tax.md',
      markdown: file('Tax', 'VAT is added.'),
      write,
      create: true,
    });
    await expect(
      restoreArticleVersion(t.db, { slug: 'billing/tax', versionId: versions[2]!.id, write }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      restoreArticleVersion(t.db, {
        slug: 'billing/refunds',
        versionId: versions[2]!.id,
        write: undefined,
      }),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('POST /admin/articles/:slug/versions/:id/restore', () => {
  async function call(handler: ReturnType<typeof createHelpWellHandler>, path: string) {
    return handler(
      new Request(`http://localhost/api/helpwell${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN}` },
      }),
    );
  }

  it('restores through the hook in a repo install', async () => {
    const { written, write, versions } = await threeVersions();
    const handler = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      writeArticle: write,
      env: {},
    });
    const response = await call(
      handler,
      `/admin/articles/billing/refunds/versions/${versions[1]!.id}/restore`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: true, restoredFrom: versions[1]!.id });
    expect(written.get('billing/refunds.md')).toContain('Within 30 days.');
    const [latest] = await listArticleVersions(t.db, 'billing/refunds', { limit: 1 });
    expect(latest).toMatchObject({ origin: 'api', restoredFrom: versions[1]!.id });
  });

  it('restores through a writable content source in a managed install', async () => {
    const content = createMemoryContentSource({
      'billing/refunds.md': file('Refunds', 'Within 14 days.'),
    });
    await syncContent(t.db, content);
    await content.write!('billing/refunds.md', file('Refunds', 'Within 30 days.'));
    await syncContent(t.db, content);
    const versions = await listArticleVersions(t.db, 'billing/refunds');
    expect(versions).toHaveLength(2);

    const handler = createHelpWellHandler({ db: t.db, adminToken: ADMIN, content, env: {} });
    const response = await call(
      handler,
      `/admin/articles/billing/refunds/versions/${versions[1]!.id}/restore`,
    );
    expect(response.status).toBe(200);
    expect(await content.readText('billing/refunds.md')).toContain('Within 14 days.');
    expect(await listArticleVersions(t.db, 'billing/refunds')).toHaveLength(3);
  });

  it('answers 404 for an unknown version, 400 for a bad id, and 501 with nowhere to write', async () => {
    const { write, versions } = await threeVersions();
    const handler = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      writeArticle: write,
      env: {},
    });
    expect(
      (await call(handler, '/admin/articles/billing/refunds/versions/99999/restore')).status,
    ).toBe(404);
    expect((await call(handler, '/admin/articles/billing/refunds/versions/x/restore')).status).toBe(
      400,
    );
    const readOnly = createHelpWellHandler({ db: t.db, adminToken: ADMIN, env: {} });
    expect(
      (await call(readOnly, `/admin/articles/billing/refunds/versions/${versions[2]!.id}/restore`))
        .status,
    ).toBe(501);
    // Not without admin rights.
    const anonymous = await handler(
      new Request(
        `http://localhost/api/helpwell/admin/articles/billing/refunds/versions/${versions[2]!.id}/restore`,
        {
          method: 'POST',
        },
      ),
    );
    expect(anonymous.status).toBe(401);
  });
});
