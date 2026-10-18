import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import type { Article, Collection } from '../src/content.js';
import { hashContent } from '../src/content.js';
import { rowsOf, schema } from '../src/db.js';
import {
  cosine,
  indexArticles,
  indexCollections,
  MIN_SIMILARITY,
  plainSnippet,
  recordSearch,
  searchArticles,
  searchWithSignals,
} from '../src/search.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;

function article(partial: Partial<Article> & { slug: string; title: string }): Article {
  const body = partial.body ?? '';
  return {
    collection: partial.slug.split('/')[0]!,
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${partial.slug}.md`,
    updatedAt: new Date(),
    contentHash: hashContent(body + partial.title),
    ...partial,
    body,
  };
}

function collection(partial: Partial<Collection> & { id: string }): Collection {
  return {
    title: partial.id,
    description: null,
    icon: 'book-open',
    tint: 'lavender',
    order: null,
    askAgent: true,
    visibility: 'public',
    articles: [],
    ...partial,
  };
}

const ARTICLES: Article[] = [
  article({
    slug: 'billing/exporting-invoices-as-csv',
    title: 'Exporting invoices as CSV',
    description: 'Download every invoice in a date range.',
    body: 'Open Billing then Invoices and choose Export CSV at the top right. Tick include refunds to add them.',
  }),
  article({
    slug: 'billing/understanding-your-invoice',
    title: 'Understanding your invoice',
    description: 'What each line means.',
    body: 'Seats, usage and credits are listed separately on every invoice.',
  }),
  article({
    slug: 'team/inviting-teammates',
    title: 'Inviting teammates',
    description: 'Add people to your workspace.',
    body: 'Go to Team and choose Invite. Invite links expire after seven days.',
  }),
  article({
    slug: 'team/draft-only',
    title: 'Roles we have not shipped',
    status: 'draft',
    body: 'Internal notes about roles and permissions.',
  }),
];

class BrokenEmbeddings extends FakeModel {
  override async embed(): Promise<never> {
    throw new Error('embeddings down');
  }
}

beforeAll(async () => {
  t = await freshDb();
  await indexArticles(t.db, ARTICLES);
});

afterAll(async () => {
  await t.close();
});

describe('indexing', () => {
  it('writes every article once', async () => {
    const rows = await t.db.select().from(schema.articleIndex);
    expect(rows).toHaveLength(ARTICLES.length);
  });

  it('skips articles whose content has not changed', async () => {
    const result = await indexArticles(t.db, ARTICLES);
    expect(result.indexed).toBe(0);
    expect(result.unchanged).toBe(ARTICLES.length);
  });

  it('re-indexes only what changed', async () => {
    const edited = ARTICLES.map((a) =>
      a.slug === 'team/inviting-teammates'
        ? {
            ...a,
            body: `${a.body} Invites now expire after fourteen days.`,
            contentHash: 'changed',
          }
        : a,
    );
    const result = await indexArticles(t.db, edited);
    expect(result.indexed).toBe(1);
    expect(result.unchanged).toBe(ARTICLES.length - 1);

    const [row] = await t.db
      .select()
      .from(schema.articleIndex)
      .where(sql`slug = 'team/inviting-teammates'`);
    expect(row?.body).toContain('fourteen days');
    await indexArticles(t.db, ARTICLES, { force: true });
  });

  it('drops articles that left the repo, so a deleted page stops answering', async () => {
    const fewer = ARTICLES.slice(0, 2);
    const result = await indexArticles(t.db, fewer);
    expect(result.removed).toBe(2);
    const rows = await t.db.select().from(schema.articleIndex);
    expect(rows).toHaveLength(2);
    await indexArticles(t.db, ARTICLES);
  });

  it('computes embeddings when a model is available', async () => {
    const model = new FakeModel();
    const result = await indexArticles(t.db, ARTICLES, { model, force: true });
    expect(result.embedded).toBe(ARTICLES.length);
    const [row] = await t.db
      .select()
      .from(schema.articleIndex)
      .where(sql`slug = 'billing/exporting-invoices-as-csv'`);
    expect(Array.isArray(row?.embedding)).toBe(true);
  });

  it('drops the embedding of an article that changed when it cannot re-embed it', async () => {
    await indexArticles(t.db, ARTICLES, { model: new FakeModel(), force: true });
    const edited = ARTICLES.map((a) =>
      a.slug === 'team/inviting-teammates'
        ? { ...a, body: `${a.body} Now with single sign-on.`, contentHash: 'changed-again' }
        : a,
    );
    const result = await indexArticles(t.db, edited);
    expect(result.indexed).toBe(1);
    expect(result.embedded).toBe(0);

    const rows = await t.db
      .select({ slug: schema.articleIndex.slug, embedding: schema.articleIndex.embedding })
      .from(schema.articleIndex);
    expect(rows.find((r) => r.slug === 'team/inviting-teammates')?.embedding).toBeNull();
    expect(
      Array.isArray(rows.find((r) => r.slug === 'billing/exporting-invoices-as-csv')?.embedding),
    ).toBe(true);
    await indexArticles(t.db, ARTICLES, { force: true });
  });

  it('switches embeddings off when the model name is empty', async () => {
    const model = new FakeModel();
    const result = await indexArticles(t.db, ARTICLES, { model, embeddingModel: '', force: true });
    expect(result.embedded).toBe(0);
    expect(model.embedRequests).toHaveLength(0);
  });
});

describe('searching', () => {
  it('finds the right article by its words', async () => {
    const hits = await searchArticles(t.db, 'export invoices csv');
    expect(hits[0]?.slug).toBe('billing/exporting-invoices-as-csv');
  });

  it('marks the matching words in the snippet', async () => {
    const hits = await searchArticles(t.db, 'refunds');
    expect(hits[0]?.snippet).toContain('<mark>');
  });

  it('never shows a draft to the public', async () => {
    const hits = await searchArticles(t.db, 'roles permissions');
    expect(hits.map((h) => h.slug)).not.toContain('team/draft-only');
  });

  it('shows drafts to the dashboard when asked', async () => {
    const hits = await searchArticles(t.db, 'roles permissions', { includeDrafts: true });
    expect(hits.map((h) => h.slug)).toContain('team/draft-only');
  });

  it('can be scoped to one collection', async () => {
    const hits = await searchArticles(t.db, 'invite', { collection: 'billing' });
    expect(hits.every((h) => h.collection === 'billing')).toBe(true);
  });

  it('returns nothing for an empty query instead of everything', async () => {
    expect(await searchArticles(t.db, '   ')).toEqual([]);
  });

  it('works with no embeddings at all, so a fresh install still searches', async () => {
    const bare = await freshDb();
    await indexArticles(bare.db, ARTICLES);
    const hits = await searchArticles(bare.db, 'invite teammates');
    expect(hits[0]?.slug).toBe('team/inviting-teammates');
    await bare.close();
  });

  it('merges the semantic pass in and says which pass found a hit', async () => {
    const model = new FakeModel();
    await indexArticles(t.db, ARTICLES, { model, force: true });
    const hits = await searchArticles(t.db, 'export invoices csv', {
      model,
      embeddingModel: 'fake/embeddings',
    });
    const top = hits[0]!;
    expect(top.slug).toBe('billing/exporting-invoices-as-csv');
    expect(top.matchedBy).toEqual(['text', 'semantic']);
    expect(model.embedRequests.length).toBeGreaterThan(0);
  });

  it('skips the semantic pass when no embeddings model is configured', async () => {
    const model = new FakeModel();
    await indexArticles(t.db, ARTICLES, { model, force: true });
    model.embedRequests.length = 0;

    const hits = await searchArticles(t.db, 'export invoices csv', { model });
    expect(hits[0]?.slug).toBe('billing/exporting-invoices-as-csv');
    expect(model.embedRequests).toHaveLength(0);
    expect(hits.every((h) => !h.matchedBy.includes('semantic'))).toBe(true);
  });

  it('falls back to full text when the embedding call fails', async () => {
    await indexArticles(t.db, ARTICLES, { model: new FakeModel(), force: true });
    const hits = await searchArticles(t.db, 'export invoices csv', {
      model: new BrokenEmbeddings(),
      embeddingModel: 'fake/embeddings',
    });
    expect(hits[0]?.slug).toBe('billing/exporting-invoices-as-csv');
    expect(hits[0]?.matchedBy).toEqual(['text']);
  });

  it('counts embeddings against the daily spend', async () => {
    await t.db.execute(sql`DELETE FROM helpwell.spend_ledger`);
    const model = new FakeModel();
    await indexArticles(t.db, ARTICLES, { model, embeddingModel: 'fake/embeddings', force: true });
    await searchArticles(t.db, 'export invoices csv', { model, embeddingModel: 'fake/embeddings' });

    const rows = rowsOf<{ kind: string; model: string; n: number | string }>(
      await t.db.execute(
        sql`SELECT kind, model, count(*) AS n FROM helpwell.spend_ledger GROUP BY kind, model`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('embedding');
    expect(rows[0]?.model).toBe('fake/embeddings');
    expect(Number(rows[0]?.n)).toBe(2);
  });
});

describe('wordy questions', () => {
  it('falls back to any of the words when matching every word finds nothing', async () => {
    // "accountant" and "file" are in no article, so an every-word match is empty.
    const hits = await searchArticles(
      t.db,
      'hi, how would I get my invoices out as a csv file for my accountant please',
    );
    expect(hits[0]?.slug).toBe('billing/exporting-invoices-as-csv');
  });

  it('says which kind of match it was, and how much of the question it covered', async () => {
    const strict = await searchWithSignals(t.db, 'export invoices csv');
    expect(strict.signals.text).toBe('strict');
    expect(strict.signals.textCoverage).toBe(1);

    const loose = await searchWithSignals(t.db, 'invoices for my accountant');
    expect(loose.hits.length).toBeGreaterThan(0);
    expect(loose.signals.text).toBe('loose');
    expect(loose.signals.textCoverage).toBeCloseTo(0.5);

    const none = await searchWithSignals(t.db, 'klingon translation');
    expect(none.hits).toEqual([]);
    expect(none.signals.text).toBe('none');
    expect(none.signals.textCoverage).toBe(0);
  });

  it('ranks the article with more of the words first', async () => {
    // "spreadsheet" is nowhere, so this is a loose match; the CSV article has
    // three of the other words and the invoice explainer only one.
    const hits = await searchArticles(t.db, 'refunds csv invoices spreadsheet');
    expect(hits[0]?.slug).toBe('billing/exporting-invoices-as-csv');
    expect(hits.map((h) => h.slug)).toContain('billing/understanding-your-invoice');
  });

  it('marks the words it did match', async () => {
    const [hit] = await searchArticles(t.db, 'refunds for my accountant');
    expect(hit?.snippet).toContain('<mark>');
  });

  it('keeps drafts out of the fallback as well', async () => {
    const hits = await searchArticles(t.db, 'roles permissions accountant');
    expect(hits.map((h) => h.slug)).not.toContain('team/draft-only');
    const admin = await searchArticles(t.db, 'roles permissions accountant', {
      includeDrafts: true,
    });
    expect(admin.map((h) => h.slug)).toContain('team/draft-only');
  });

  it('finds nothing for a question made only of common words', async () => {
    const result = await searchWithSignals(t.db, 'what is it');
    expect(result.hits).toEqual([]);
    expect(result.signals.text).toBe('none');
  });
});

describe('the similarity floor', () => {
  it('drops semantic candidates under the floor, and still says how close the best was', async () => {
    const bare = await freshDb();
    const model = new FakeModel();
    await indexArticles(
      bare.db,
      [
        article({
          slug: 'team/sso',
          title: 'Single sign-on',
          body: 'Single sign-on is available on the Team plan.',
        }),
      ],
      { model, embeddingModel: 'fake/embeddings' },
    );
    const options = { model, embeddingModel: 'fake/embeddings' };

    const open = await searchWithSignals(bare.db, 'zzz', { ...options, minSimilarity: -1 });
    expect(open.hits.map((h) => h.slug)).toEqual(['team/sso']);
    const best = open.signals.bestSimilarity!;

    const floored = await searchWithSignals(bare.db, 'zzz', {
      ...options,
      minSimilarity: best + 0.01,
    });
    expect(floored.hits).toEqual([]);
    expect(floored.signals.semantic).toBe(true);
    expect(floored.signals.bestSimilarity).toBeCloseTo(best);
    await bare.close();
  });

  it('no longer counts every embedded article as a match for any question', async () => {
    const model = new FakeModel();
    const options = { model, embeddingModel: 'fake/embeddings' };
    await indexArticles(t.db, ARTICLES, { ...options, force: true });
    try {
      // Nothing in the docs is about this. Without a floor every published
      // article came back for it; with one, only a toy-embedding collision can.
      const question = 'quantum origami for hamsters';
      const unfloored = await searchArticles(t.db, question, { ...options, minSimilarity: -1 });
      const floored = await searchWithSignals(t.db, question, options);
      expect(unfloored).toHaveLength(3);
      expect(floored.hits.length).toBeLessThan(unfloored.length);
      expect(floored.signals.minSimilarity).toBe(MIN_SIMILARITY);
    } finally {
      await indexArticles(t.db, ARTICLES, { force: true });
    }
  });

  it('reports agreement when both passes put the same article on top', async () => {
    const model = new FakeModel();
    const options = { model, embeddingModel: 'fake/embeddings' };
    await indexArticles(t.db, ARTICLES, { ...options, force: true });
    try {
      const { hits, signals } = await searchWithSignals(t.db, 'export invoices csv', options);
      expect(hits[0]?.matchedBy).toEqual(['text', 'semantic']);
      expect(signals.agreement).toBe(true);
      expect(signals.bestSimilarity).toBeGreaterThanOrEqual(MIN_SIMILARITY);
    } finally {
      await indexArticles(t.db, ARTICLES, { force: true });
    }
  });

  it('is a documented constant between 0 and 1', () => {
    expect(MIN_SIMILARITY).toBeGreaterThan(0);
    expect(MIN_SIMILARITY).toBeLessThan(1);
  });
});

describe('snippets', () => {
  it('escapes the article body, so a snippet is safe to insert as HTML', async () => {
    const bare = await freshDb();
    await indexArticles(bare.db, [
      article({
        slug: 'billing/refund-policy',
        title: 'Refund policy',
        body: 'Refunds take five days. <img src=x onerror=alert(1)> Ask Billing & Support about refunds.',
      }),
    ]);
    const [hit] = await searchArticles(bare.db, 'refunds');

    expect(hit?.snippet).toContain('<mark>');
    expect(hit?.snippet).toContain('&lt;img');
    expect(hit?.snippet).toContain('&amp;');
    expect(hit?.snippet).not.toMatch(/<img/);
    expect(hit?.snippet).not.toMatch(/<(?!\/?mark>)/);

    const text = plainSnippet(hit!.snippet);
    expect(text).toContain('<img src=x onerror=alert(1)>');
    expect(text).toContain('Billing & Support');
    expect(text).not.toContain('<mark>');
    await bare.close();
  });

  it('is the article as a reader sees it: no Markdown, and code kept word for word', async () => {
    const bare = await freshDb();
    await indexArticles(bare.db, [
      article({
        slug: 'setup/install',
        title: 'Installing the widget',
        body: [
          '## Install it',
          '',
          '> [!TIP]',
          '> Paste the **snippet** in the `<head>` of [every page](https://acme.com/pages), before _anything_ else.',
          '',
          '```html',
          '<script src="https://acme.com/widget.js"></script>',
          '```',
        ].join('\n'),
      }),
    ]);
    const [hit] = await searchArticles(bare.db, 'snippet');

    expect(hit?.snippet).toContain('<mark>snippet</mark>');
    expect(hit?.snippet).toContain('in the &lt;head&gt; of every page, before anything else.');
    expect(hit?.snippet).toContain('&lt;script src=&quot;https://acme.com/widget.js&quot;&gt;');
    for (const markup of ['**', '##', '`', '[!TIP]', '](', '> Paste', '_anything_']) {
      expect(plainSnippet(hit!.snippet)).not.toContain(markup);
    }
    expect(hit?.snippet).not.toMatch(/<(?!\/?mark>)/);
    await bare.close();
  });

  it('leaves out a first heading that repeats the title, and keeps other headings apart from their text', async () => {
    const bare = await freshDb();
    await indexArticles(bare.db, [
      article({
        slug: 'setup/tracking',
        title: 'Install the tracking snippet',
        body: [
          '# Install the tracking snippet',
          '',
          'The snippet is one line of HTML.',
          '',
          '## Where it goes',
          '',
          'Paste the snippet before the closing body tag.',
        ].join('\n'),
      }),
    ]);
    const [hit] = await searchArticles(bare.db, 'snippet');
    const text = plainSnippet(hit!.snippet);

    expect(text.startsWith('The snippet is one line of HTML.')).toBe(true);
    expect(text).not.toContain('Install the tracking snippet');
    expect(text).toContain('HTML. Where it goes — Paste the snippet');
    expect(text).not.toMatch(/Where it goes Paste/);
    await bare.close();
  });

  it('keeps a first heading that is not the title', async () => {
    const bare = await freshDb();
    await indexArticles(bare.db, [
      article({
        slug: 'setup/overview',
        title: 'Getting started',
        body: '# Before you begin\n\nYou need an account with admin rights.',
      }),
    ]);
    const [hit] = await searchArticles(bare.db, 'admin');
    expect(plainSnippet(hit!.snippet)).toBe(
      'Before you begin — You need an account with admin rights.',
    );
    await bare.close();
  });

  it('marks a match inside a code span, and says where it cut the article short', async () => {
    const bare = await freshDb();
    const intro = Array.from({ length: 30 }, (_, k) => `Sentence ${k} is about something else.`);
    await indexArticles(bare.db, [
      article({
        slug: 'setup/head',
        title: 'Where the tag goes',
        body: `${intro.join(' ')}\n\nThe loader belongs in \`<head>\` and nowhere else, ever, for any reason at all, on any page of any site, as the docs have always said`,
      }),
    ]);
    const [hit] = await searchArticles(bare.db, 'loader');

    expect(hit?.snippet).toContain('<mark>loader</mark> belongs in &lt;head&gt;');
    expect(hit?.snippet.startsWith('…')).toBe(true);
    await bare.close();
  });

  it('escapes the semantic snippet as well', async () => {
    const bare = await freshDb();
    const model = new FakeModel();
    await indexArticles(
      bare.db,
      [
        article({
          slug: 'team/sso',
          title: 'Single sign-on',
          body: '<script>alert(1)</script> Single sign-on is available on the Team plan.',
        }),
      ],
      { model, embeddingModel: 'fake/embeddings' },
    );
    // Nothing in the text matches, so the only hit is the semantic one. The
    // toy embeddings put "zzz" nowhere near it, so the floor is taken away.
    const hits = await searchArticles(bare.db, 'zzz', {
      model,
      embeddingModel: 'fake/embeddings',
      minSimilarity: -1,
    });
    expect(hits[0]?.matchedBy).toEqual(['semantic']);
    expect(hits[0]?.snippet).toContain('&lt;script&gt;');
    expect(hits[0]?.snippet).not.toMatch(/<script/);
    await bare.close();
  });
});

describe('collection rules', () => {
  beforeAll(async () => {
    await indexCollections(t.db, [
      collection({ id: 'billing', title: 'Billing' }),
      collection({ id: 'team', title: 'Team', visibility: 'identified', askAgent: false }),
    ]);
  });

  afterAll(async () => {
    await indexCollections(t.db, []);
  });

  it('hides an identified-only collection from anonymous search', async () => {
    const anonymous = await searchArticles(t.db, 'invite teammates');
    expect(anonymous.map((h) => h.slug)).not.toContain('team/inviting-teammates');

    const identified = await searchArticles(t.db, 'invite teammates', { identified: true });
    expect(identified.map((h) => h.slug)).toContain('team/inviting-teammates');

    const admin = await searchArticles(t.db, 'invite teammates', { includeDrafts: true });
    expect(admin.map((h) => h.slug)).toContain('team/inviting-teammates');
  });

  it('keeps an askAgent: false collection away from the agent', async () => {
    const forAgent = await searchArticles(t.db, 'invite teammates', {
      identified: true,
      forAgent: true,
    });
    expect(forAgent.map((h) => h.slug)).not.toContain('team/inviting-teammates');

    const billing = await searchArticles(t.db, 'export invoices', { forAgent: true });
    expect(billing[0]?.slug).toBe('billing/exporting-invoices-as-csv');
  });

  it('applies the same rules to the semantic pass', async () => {
    const model = new FakeModel();
    await indexArticles(t.db, ARTICLES, { model, embeddingModel: 'fake/embeddings', force: true });
    const hits = await searchArticles(t.db, 'zzz', {
      model,
      embeddingModel: 'fake/embeddings',
      minSimilarity: -1,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.collection === 'billing')).toBe(true);
    await indexArticles(t.db, ARTICLES, { force: true });
  });
});

describe('cosine', () => {
  it('is 1 for the same vector and 0 for orthogonal ones', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('does not divide by zero on an empty vector', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('recording searches', () => {
  it('keeps the ones that found nothing, because those become gaps', async () => {
    await recordSearch(t.db, {
      query: 'vat number on receipts',
      resultsCount: 0,
      source: 'widget',
    });
    const rows = await t.db.execute(
      sql`SELECT query, results_count FROM helpwell.searches WHERE results_count = 0`,
    );
    const empty = rowsOf<{ query: string; results_count: number }>(rows);
    expect(empty.some((r) => r.query === 'vat number on receipts')).toBe(true);
  });
});
