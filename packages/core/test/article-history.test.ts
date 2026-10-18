/**
 * Article history and editing: the versions the indexer records, the diffs
 * between them, the admin routes that read them, and saving an article
 * through the host's `writeArticle` hook.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler, type HelpWellHandler } from '../src/api.js';
import { parseArticle } from '../src/content/articles.js';
import { collapseDiff, diffLines, diffStats } from '../src/content/diff.js';
import {
  composeArticle,
  EMPTY_ARTICLE_MESSAGE,
  isArticlePath,
  isEmptyArticleBody,
  newArticlePath,
} from '../src/content/editing.js';
import { rowsOf } from '../src/db/rows.js';
import {
  articleSource,
  compareArticleVersions,
  listArticleVersions,
  saveArticle,
} from '../src/repos/article-history.js';
import { indexArticle, indexArticles } from '../src/search/indexer.js';
import { freshDb, type TestDb } from './helpers/db.js';

const ADMIN = 'history-admin-token';

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

function article(path: string, source: string) {
  const [collection, name] = path.split('/') as [string, string];
  return parseArticle(source, { collection, file: name });
}

describe('diffs', () => {
  it('marks added and removed lines', () => {
    const lines = diffLines('a\nb\nc', 'a\nc\nd');
    expect(lines.map((l) => `${l.op}:${l.text}`)).toEqual([
      'same:a',
      'remove:b',
      'same:c',
      'add:d',
    ]);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  });

  it('shows which words changed inside an edited paragraph', () => {
    const [removed, added] = diffLines(
      'Refunds are issued within 14 days of the request.',
      'Refunds are issued within 30 days of the request.',
    );
    expect(removed?.op).toBe('remove');
    expect(removed?.parts?.filter((p) => p.op === 'remove').map((p) => p.text)).toEqual(['14']);
    expect(added?.parts?.filter((p) => p.op === 'add').map((p) => p.text)).toEqual(['30']);
    expect(added?.parts?.map((p) => p.text).join('')).toBe(
      'Refunds are issued within 30 days of the request.',
    );
  });

  it('does not pretend two unrelated lines are an edit of each other', () => {
    const [removed] = diffLines('Completely different words here', 'Nothing alike at all');
    expect(removed?.parts).toBeUndefined();
  });

  it('collapses long unchanged stretches around the changes', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line ten');
    const chunks = collapseDiff(diffLines(before, after), 2);
    // Lines 0-7 hidden, 8-9 and 11-12 shown around the edit, the last 7 hidden.
    expect(chunks.map((c) => (c.kind === 'skip' ? `skip ${c.count}` : 'lines'))).toEqual([
      'skip 8',
      'lines',
      'skip 7',
    ]);
  });
});

describe('editing helpers', () => {
  it('accepts only <collection>/<file>.md paths that stay in the docs folder', () => {
    expect(isArticlePath('billing/invoices.md')).toBe(true);
    expect(isArticlePath('Getting started/Welcome.mdx')).toBe(true);
    for (const path of [
      'invoices.md',
      'a/b/c.md',
      '../x.md',
      'billing/../x.md',
      '_screenshots/x.md',
      '.git/x.md',
      'billing/x.txt',
      'billing\\x.md',
      'C:/x.md',
      ' billing/x.md',
      `billing/x${String.fromCharCode(0)}.md`,
    ]) {
      expect(isArticlePath(path), path).toBe(false);
    }
  });

  it('knows a body with nothing a reader would see', () => {
    expect(isEmptyArticleBody('', 'Refunds')).toBe(true);
    expect(isEmptyArticleBody(' \n\n ', 'Refunds')).toBe(true);
    expect(isEmptyArticleBody('# Refunds\n', 'Refunds')).toBe(true);
    expect(isEmptyArticleBody('# **Refunds** #\n\n', 'refunds')).toBe(true);
    expect(isEmptyArticleBody('# Refunds\n\nWithin 14 days.', 'Refunds')).toBe(false);
    expect(isEmptyArticleBody('# Something else', 'Refunds')).toBe(false);
    expect(isEmptyArticleBody('![Screenshot](../_screenshots/a.png)', 'Refunds')).toBe(false);
  });

  it('puts a new article in a folder and file named from its collection and title', () => {
    expect(newArticlePath('Billing & invoices', 'Exporting a PDF')).toBe(
      'billing-invoices/exporting-a-pdf.md',
    );
  });

  it('writes edited fields into the front matter and keeps the keys it does not show', () => {
    const original = '---\ntitle: Old\norder: 3\nappliesTo: Pro\nstatus: draft\n---\n\nBody';
    const out = composeArticle(
      { title: 'New: the guide', description: 'One line.', status: 'published' },
      'New body',
      original,
    );
    expect(out).toBe(
      '---\ntitle: "New: the guide"\norder: 3\nappliesTo: Pro\nstatus: published\ndescription: One line.\n---\n\nNew body\n',
    );
    expect(composeArticle({ title: 'T', description: '' }, 'B', out)).not.toContain('description');
  });
});

describe('versions', () => {
  it('records the first index, each change, and nothing for an unchanged or forced sync', async () => {
    const v1 = article('billing/invoices.md', file('Invoices', 'Within 14 days.'));
    await indexArticles(t.db, [v1]);
    await indexArticles(t.db, [v1]);
    await indexArticles(t.db, [v1], { force: true });
    expect(await listArticleVersions(t.db, 'billing/invoices')).toHaveLength(1);

    const v2 = article('billing/invoices.md', file('Invoices', 'Within 30 days.'));
    const result = await indexArticles(t.db, [v2]);
    expect(result.versions).toBe(1);

    const versions = await listArticleVersions(t.db, 'billing/invoices');
    expect(versions.map((v) => v.origin)).toEqual(['sync', 'sync']);
    expect(versions[0]?.path).toBe('billing/invoices.md');

    const comparison = await compareArticleVersions(t.db, 'billing/invoices', versions[0]!.id);
    expect(comparison?.from?.id).toBe(versions[1]?.id);
    expect(comparison?.added).toBe(1);
    expect(comparison?.removed).toBe(1);
  });

  it('keeps the words as written, not the served image URLs', async () => {
    const source = file('Welcome', '![The dashboard](../_screenshots/dashboard.png)');
    await indexArticles(t.db, [article('start/welcome.md', source)]);
    const [latest] = await listArticleVersions(t.db, 'start/welcome');
    const rows = rowsOf<{ body: string; source: string }>(
      await t.db.execute(
        sql`SELECT body, source FROM helpwell.article_versions WHERE id = ${latest!.id}`,
      ),
    );
    expect(rows[0]?.body).toBe('![The dashboard](../_screenshots/dashboard.png)');
    expect(rows[0]?.source).toBe(source);
  });

  it('does not record a version when only the served URLs moved', async () => {
    const source = file('Welcome', '![x](../_screenshots/a.png)');
    await indexArticles(t.db, [article('start/welcome.md', source)]);
    const moved = parseArticle(source, {
      collection: 'start',
      file: 'welcome.md',
      media: { apiPath: '/elsewhere' },
    });
    const result = await indexArticles(t.db, [moved]);
    expect(result.indexed).toBe(1);
    expect(result.versions).toBe(0);
  });

  it('keeps the history of an article that left the repo', async () => {
    await indexArticles(t.db, [article('a/one.md', file('One', 'x'))]);
    await indexArticles(t.db, []);
    expect(await listArticleVersions(t.db, 'a/one')).toHaveLength(1);
  });

  it('indexes one article without touching the others', async () => {
    await indexArticles(t.db, [
      article('a/one.md', file('One', 'x')),
      article('a/two.md', file('Two', 'y')),
    ]);
    const result = await indexArticle(t.db, article('a/one.md', file('One', 'changed')), {
      origin: 'dashboard',
    });
    expect(result.changed).toBe(true);
    expect(result.versionId).toBeTypeOf('number');
    const slugs = rowsOf<{ slug: string }>(
      await t.db.execute(sql`SELECT slug FROM helpwell.article_index ORDER BY slug`),
    ).map((r) => r.slug);
    expect(slugs).toEqual(['a/one', 'a/two']);
    const [latest] = await listArticleVersions(t.db, 'a/one');
    expect(latest?.origin).toBe('dashboard');
  });
});

describe('saving through the hook', () => {
  it('writes the file, re-indexes the article and records a version', async () => {
    const written = new Map<string, string>();
    const markdown = file('Exporting', '![x](../_screenshots/export.png)');
    const result = await saveArticle(t.db, {
      path: 'billing/exporting.md',
      markdown,
      write: (path, value) => {
        written.set(path, value);
      },
      create: true,
    });
    expect(written.get('billing/exporting.md')).toBe(markdown);
    expect(result).toMatchObject({ slug: 'billing/exporting', changed: true });

    const source = await articleSource(t.db, 'billing/exporting');
    expect(source).toMatchObject({ path: 'billing/exporting.md', pathKnown: true, markdown });
    const rows = rowsOf<{ body: string }>(
      await t.db.execute(
        sql`SELECT body FROM helpwell.article_index WHERE slug = 'billing/exporting'`,
      ),
    );
    expect(rows[0]?.body).toBe('![x](/api/helpwell/screenshots/export.png)');
  });

  it('refuses a path outside the docs, a missing hook, and overwriting on create', async () => {
    const write = () => undefined;
    await expect(
      saveArticle(t.db, { path: '../x.md', markdown: '# x', write }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      saveArticle(t.db, { path: 'a/x.md', markdown: '# x', write: undefined }),
    ).rejects.toMatchObject({ code: 'not_configured' });

    await indexArticles(t.db, [article('a/x.md', file('X', 'x'))]);
    await expect(
      saveArticle(t.db, { path: 'a/x.md', markdown: file('X', 'y'), write, create: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Editing it is fine.
    await expect(
      saveArticle(t.db, { path: 'a/x.md', markdown: file('X', 'y'), write, slug: 'a/x' }),
    ).resolves.toMatchObject({ changed: true });
  });

  it('refuses to publish an article with nothing in it, and saves it as a draft', async () => {
    const written = new Map<string, string>();
    const write = (path: string, value: string) => {
      written.set(path, value);
    };
    const empty = [
      file('Refunds', ''),
      file('Refunds', '  \n\n\t'),
      // Only the title again: the page shows the title already.
      file('Refunds', '# Refunds'),
      file('Refunds', '', 'status: published\n'),
      '# Refunds\n',
    ];
    for (const markdown of empty) {
      await expect(
        saveArticle(t.db, { path: 'billing/refunds.md', markdown, write, create: true }),
      ).rejects.toMatchObject({ code: 'bad_request', publicMessage: EMPTY_ARTICLE_MESSAGE });
    }
    expect(written.size).toBe(0);
    expect(await articleSource(t.db, 'billing/refunds')).toBeNull();

    // A draft may be empty while it is written, and a real body publishes.
    await expect(
      saveArticle(t.db, {
        path: 'billing/refunds.md',
        markdown: file('Refunds', '', 'status: draft\n'),
        write,
        create: true,
      }),
    ).resolves.toMatchObject({ slug: 'billing/refunds' });
    await expect(
      saveArticle(t.db, {
        path: 'billing/refunds.md',
        markdown: file('Refunds', '# Refunds\n\nWithin 14 days.'),
        write,
        slug: 'billing/refunds',
      }),
    ).resolves.toMatchObject({ changed: true });
  });

  it('says whether the saved article is embedded, and the next sync with a model embeds it', async () => {
    const write = () => undefined;
    const markdown = file('Plans', 'Three of them.');
    const textOnly = await saveArticle(t.db, { path: 'billing/plans.md', markdown, write });
    expect(textOnly).toMatchObject({ changed: true, embedded: false });

    // Unchanged on disk, but with no vector yet: a sync with a model embeds
    // it, rather than keeping the nothing it had.
    const model = new FakeModel();
    const synced = await indexArticles(t.db, [article('billing/plans.md', markdown)], {
      model,
      embeddingModel: 'fake/embeddings',
    });
    expect(synced).toMatchObject({ indexed: 0, unchanged: 1, embedded: 1, versions: 0 });
    // And only once: the next sync has nothing to do.
    const again = await indexArticles(t.db, [article('billing/plans.md', markdown)], { model });
    expect(again.embedded).toBe(0);
    expect(model.embedRequests).toHaveLength(1);

    const edited = await saveArticle(t.db, {
      path: 'billing/plans.md',
      markdown: file('Plans', 'Four of them.'),
      write,
      slug: 'billing/plans',
      model,
      embeddingModel: 'fake/embeddings',
    });
    expect(edited).toMatchObject({ changed: true, embedded: true });
  });

  it('reports a hook that failed, and indexes nothing', async () => {
    await expect(
      saveArticle(t.db, {
        path: 'a/x.md',
        markdown: file('X', 'x'),
        write: () => {
          throw new Error('read-only file system');
        },
      }),
    ).rejects.toMatchObject({ code: 'upstream_failed' });
    expect(await articleSource(t.db, 'a/x')).toBeNull();
  });

  it('rebuilds a file for an article indexed before the source was kept', async () => {
    await indexArticles(t.db, [{ ...article('a/old.md', file('Old', 'Body')), source: undefined }]);
    await t.db.execute(sql`UPDATE helpwell.article_index SET path = NULL`);
    const source = await articleSource(t.db, 'a/old');
    expect(source?.pathKnown).toBe(false);
    expect(source?.path).toBe('a/old.md');
    expect(source?.markdown).toContain('title: Old');
    expect(source?.markdown).toContain('Body');
  });
});

describe('admin routes', () => {
  let api: HelpWellHandler;
  let written: Map<string, string>;

  beforeEach(() => {
    written = new Map();
    api = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      writeArticle: (path, markdown) => {
        written.set(path, markdown);
      },
      // No key, whatever this machine has set: a save with one embeds.
      env: {},
    });
  });

  function call(path: string, init: { method?: string; body?: unknown; admin?: boolean } = {}) {
    const headers = new Headers();
    if (init.admin !== false) headers.set('authorization', `Bearer ${ADMIN}`);
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    return api(
      new Request(`http://localhost/api/helpwell${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );
  }

  it('refuses to publish an empty article, and says why', async () => {
    const response = await call('/admin/articles', {
      body: { path: 'billing/refunds.md', markdown: file('Refunds', ''), create: true },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(EMPTY_ARTICLE_MESSAGE);
    expect(written.size).toBe(0);

    const draft = await call('/admin/articles', {
      body: {
        path: 'billing/refunds.md',
        markdown: file('Refunds', '', 'status: draft\n'),
        create: true,
      },
    });
    expect(draft.status).toBe(201);
  });

  it('saves an article and lists its versions, newest first, with a diff', async () => {
    const first = await call('/admin/articles', {
      body: {
        path: 'billing/refunds.md',
        markdown: file('Refunds', 'Within 14 days.'),
        create: true,
      },
    });
    expect(first.status).toBe(201);
    const second = await call('/admin/articles', {
      body: {
        path: 'billing/refunds.md',
        markdown: file('Refunds', 'Within 30 days.'),
        slug: 'billing/refunds',
      },
    });
    expect(second.status).toBe(200);
    expect(written.get('billing/refunds.md')).toContain('30 days');

    const versions = (await (await call('/admin/articles/billing/refunds/versions')).json()) as {
      items: { id: number; origin: string }[];
    };
    expect(versions.items.map((v) => v.origin)).toEqual(['api', 'api']);

    const latest = versions.items[0]!.id;
    const one = (await (
      await call(`/admin/articles/billing/refunds/versions/${latest}`)
    ).json()) as {
      source: string;
    };
    expect(one.source).toContain('Within 30 days.');

    const diff = (await (
      await call(`/admin/articles/billing/refunds/diff?to=${latest}`)
    ).json()) as {
      added: number;
      removed: number;
      lines: { op: string; text: string }[];
    };
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.lines.find((l) => l.op === 'add')?.text).toBe('Within 30 days.');

    const source = (await (await call('/admin/articles/billing/refunds/source')).json()) as {
      markdown: string;
    };
    expect(source.markdown).toContain('Within 30 days.');
  });

  it('embeds a saved article with the install’s own key, and saves it as text when that fails', async () => {
    // A stand-in for OpenRouter: nothing leaves the process.
    const calls: { url: string; body: { model: string; input: string[] } }[] = [];
    let up = true;
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return up
        ? Response.json({ data: [{ embedding: [0.6, 0.8] }], usage: { prompt_tokens: 9 } })
        : new Response('upstream down', { status: 503 });
    }) as typeof fetch);
    try {
      const own = createHelpWellHandler({
        db: t.db,
        adminToken: ADMIN,
        openRouterKey: 'sk-or-test-not-a-real-key',
        writeArticle: (path, markdown) => {
          written.set(path, markdown);
        },
      });
      const save = async (body: string) =>
        (await (
          await own(
            new Request('http://localhost/api/helpwell/admin/articles', {
              method: 'POST',
              headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
              body: JSON.stringify({ path: 'billing/refunds.md', markdown: file('Refunds', body) }),
            }),
          )
        ).json()) as { embedded: boolean; changed: boolean };

      expect(await save('Within 14 days.')).toMatchObject({ changed: true, embedded: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toMatch(/\/embeddings$/);
      expect(calls[0]?.body.model).toBe('openai/text-embedding-3-small');
      const [row] = rowsOf<{ embedded: boolean }>(
        await t.db.execute(
          sql`SELECT embedding IS NOT NULL AS embedded FROM helpwell.article_index WHERE slug = 'billing/refunds'`,
        ),
      );
      expect(row?.embedded).toBe(true);

      // The provider failing never fails the save: the file is written and
      // text search has it; the next sync with a model embeds it.
      up = false;
      expect(await save('Within 30 days.')).toMatchObject({ changed: true, embedded: false });
      expect(written.get('billing/refunds.md')).toContain('30 days');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answers 501 without a hook, and 404 for an unknown version', async () => {
    const bare = createHelpWellHandler({ db: t.db, adminToken: ADMIN });
    const response = await bare(
      new Request('http://localhost/api/helpwell/admin/articles', {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'a/b.md', markdown: '# b' }),
      }),
    );
    expect(response.status).toBe(501);
    expect((await call('/admin/articles/a/b/versions/999')).status).toBe(404);
    expect((await call('/admin/articles/a/b/versions/nope')).status).toBe(400);
  });

  it('is closed to anyone who is not an admin, and to other sites', async () => {
    expect((await call('/admin/articles/a/b/versions', { admin: false })).status).toBe(401);
    const forged = await api(
      new Request('http://localhost/api/helpwell/admin/articles', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ADMIN}`,
          'content-type': 'application/json',
          origin: 'https://evil.example',
        },
        body: JSON.stringify({ path: 'a/b.md', markdown: '# b' }),
      }),
    );
    expect(forged.status).toBe(403);
    expect(written.size).toBe(0);
  });
});
