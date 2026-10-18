/**
 * Collections: what a docs folder's _meta.json turns into once it is indexed.
 *
 * The interesting cases are all about a collection that has *no* metadata row,
 * because that is the state of every install that indexed before this table
 * existed and of every folder without a _meta.json. None of those may lose
 * their collection from the help centre.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Article, Collection } from '../src/content/articles.js';
import { contacts } from '../src/db/schema.js';
import { getCollection, listCollections } from '../src/repos/collections.js';
import { indexArticles, indexCollections } from '../src/search/indexer.js';
import { freshDb, type TestDb } from './helpers/db.js';

function article(slug: string, collection: string, extra: Partial<Article> = {}): Article {
  return {
    slug,
    collection,
    title: slug.split('/')[1] ?? slug,
    description: null,
    body: 'Body text that is long enough to be indexed.',
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${slug}.md`,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: `hash-${slug}`,
    ...extra,
  };
}

function meta(id: string, extra: Partial<Collection> = {}): Collection {
  return {
    id,
    title: id,
    description: null,
    icon: 'book-open',
    tint: 'lavender',
    order: null,
    askAgent: true,
    visibility: 'public',
    articles: [],
    ...extra,
  };
}

const ARTICLES: Article[] = [
  article('billing/invoices', 'billing'),
  article('billing/plans', 'billing'),
  article('billing/refunds', 'billing', { status: 'draft' }),
  article('getting-started/welcome', 'getting-started'),
  article('admin-and-billing/roles', 'admin-and-billing'),
];

let t: TestDb;

beforeEach(async () => {
  t = await freshDb();
  await indexArticles(t.db, ARTICLES);
});

describe('a collection with metadata', () => {
  beforeEach(async () => {
    await indexCollections(t.db, [
      meta('billing', {
        title: 'Billing and plans',
        description: 'Invoices and receipts.',
        icon: 'credit-card',
        tint: 'peach',
        order: 1,
      }),
    ]);
  });

  it('presents what its _meta.json asked for', async () => {
    const [billing] = await listCollections(t.db);
    expect(billing).toEqual({
      id: 'billing',
      title: 'Billing and plans',
      description: 'Invoices and receipts.',
      icon: 'credit-card',
      tint: 'peach',
      articles: 2,
    });
  });

  it('counts published articles only', async () => {
    const billing = await getCollection(t.db, 'billing');
    // Three articles are in the folder; the draft is not one a visitor sees.
    expect(billing?.articles).toBe(2);
  });

  it('sorts ahead of the collections that did not ask for a position', async () => {
    const ids = (await listCollections(t.db)).map((c) => c.id);
    expect(ids).toEqual(['billing', 'admin-and-billing', 'getting-started']);
  });
});

describe('a collection with no metadata row', () => {
  it('still appears, titled from its folder name', async () => {
    const collections = await listCollections(t.db);
    expect(collections.map((c) => c.title)).toEqual([
      'Admin and billing',
      'Billing',
      'Getting started',
    ]);
  });

  it('takes the same defaults a fresh _meta.json would have been given', async () => {
    const collection = await getCollection(t.db, 'getting-started');
    expect(collection).toMatchObject({ icon: 'book-open', tint: 'lavender', description: null });
  });
});

describe('syncing collections', () => {
  it('rewrites a row whose _meta.json changed', async () => {
    await indexCollections(t.db, [meta('billing', { title: 'Billing' })]);
    await indexCollections(t.db, [meta('billing', { title: 'Billing and plans' })]);
    expect((await getCollection(t.db, 'billing'))?.title).toBe('Billing and plans');
  });

  it('drops a folder that left the repo', async () => {
    await indexCollections(t.db, [meta('billing'), meta('getting-started', { title: 'Start' })]);
    const result = await indexCollections(t.db, [meta('billing')]);

    expect(result.removed).toBe(1);
    // The articles are still indexed, so the collection is still listed — it
    // has simply gone back to the folder-name fallback.
    expect((await getCollection(t.db, 'getting-started'))?.title).toBe('Getting started');
  });

  it('removes every row when the docs folder is emptied', async () => {
    await indexCollections(t.db, [meta('billing')]);
    const result = await indexCollections(t.db, []);
    expect(result.removed).toBe(1);
  });
});

describe('an identified-only collection', () => {
  beforeEach(async () => {
    await indexCollections(t.db, [meta('billing', { visibility: 'identified' })]);
  });

  it('is hidden from a visitor nobody has identified', async () => {
    const ids = (await listCollections(t.db)).map((c) => c.id);
    expect(ids).not.toContain('billing');
    expect(await getCollection(t.db, 'billing')).toBeNull();
  });

  it('is shown to a contact the host app identified', async () => {
    // An external id is the host app vouching for who this is.
    await t.db
      .insert(contacts)
      .values({ id: 'con_known', externalId: 'usr_ada', identified: true, source: 'widget' });
    const ids = (await listCollections(t.db, { contactId: 'con_known' })).map((c) => c.id);
    expect(ids).toContain('billing');
  });

  it('stays hidden from an anonymous visitor who has a cookie but no identity', async () => {
    await t.db.insert(contacts).values({ id: 'con_anon', source: 'widget' });
    const ids = (await listCollections(t.db, { contactId: 'con_anon' })).map((c) => c.id);
    expect(ids).not.toContain('billing');
  });

  it('is visible on the admin surfaces, which have their own auth', async () => {
    const ids = (await listCollections(t.db, { includeIdentified: true })).map((c) => c.id);
    expect(ids).toContain('billing');
  });
});
