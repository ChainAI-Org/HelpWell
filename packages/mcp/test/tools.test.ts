import type { Db } from '@helpwell/core/db';
import { schema } from '@helpwell/core/db';
import { indexArticles } from '@helpwell/core/search';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  listCollectionsTool,
  listGapsTool,
  readArticleTool,
  recentConversationsTool,
  redactEmails,
  reportSummaryTool,
  resolveGapTool,
  runTool,
  searchArticlesTool,
} from '../src/tools.js';
import { freshDb } from './helpers/db.js';
import { ARTICLES, seed } from './helpers/seed.js';

let db: Db;

/**
 * One database for the read-only suites. The two tests that write (resolve_gap)
 * take their own, so nothing here depends on the order suites run in.
 */
beforeAll(async () => {
  const handle = await freshDb();
  db = handle.db;
  await seed(db);
});

describe('search_articles', () => {
  it('finds an article by a word that only appears in its body', async () => {
    const hits = await searchArticlesTool(db, { query: 'receipt' });
    expect(hits.map((hit) => hit.slug)).toContain('billing/invoices');
  });

  it('never surfaces a draft, because a customer cannot read one', async () => {
    const hits = await searchArticlesTool(db, { query: 'refunds case by case' });
    expect(hits.map((hit) => hit.slug)).not.toContain('billing/refunds');
  });

  it('returns the collection and a plain-text snippet, so the agent can cite it', async () => {
    const [hit] = await searchArticlesTool(db, { query: 'invoices' });
    expect(hit?.collection).toBe('billing');
    // The API highlights matches with <mark> for a browser; a coding agent
    // reading JSON wants the words alone, with nothing to unescape.
    expect(hit?.snippet).toMatch(/invoices/i);
    expect(hit?.snippet).not.toContain('<mark>');
    expect(hit?.snippet).not.toContain('&');
    expect(hit?.matchedBy).toContain('text');
  });

  it('honours a limit', async () => {
    expect((await searchArticlesTool(db, { query: 'billing' })).length).toBeGreaterThan(1);
    expect(await searchArticlesTool(db, { query: 'billing', limit: 1 })).toHaveLength(1);
  });

  it('accepts a limit sent as a string, because hosts differ on that', async () => {
    const hits = await searchArticlesTool(db, { query: 'billing', limit: '1' });
    expect(hits).toHaveLength(1);
  });

  it('clamps a nonsensical limit instead of asking the database for zero rows', async () => {
    const hits = await searchArticlesTool(db, { query: 'billing', limit: 0 });
    expect(hits).toHaveLength(1);
  });

  it('refuses an empty query rather than returning the whole help centre', async () => {
    await expect(searchArticlesTool(db, { query: '   ' })).rejects.toThrow(/query/);
  });

  it('refuses a limit that is not a number', async () => {
    await expect(searchArticlesTool(db, { query: 'invoices', limit: 'lots' })).rejects.toThrow(
      /limit/,
    );
  });
});

describe('read_article', () => {
  it('returns the full body, not a snippet', async () => {
    const article = await readArticleTool(db, { slug: 'billing/invoices' });
    expect(article.body).toContain('choose Export to download a PDF receipt');
    expect(article.title).toBe('Exporting invoices');
    expect(article.collection).toBe('billing');
  });

  it('gives the timestamp as an ISO string the agent can read', async () => {
    const article = await readArticleTool(db, { slug: 'billing/invoices' });
    expect(article.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuses a draft, and says how to find a real slug', async () => {
    await expect(readArticleTool(db, { slug: 'billing/refunds' })).rejects.toThrow(
      /search_articles/,
    );
  });

  it('refuses a slug that does not exist', async () => {
    await expect(readArticleTool(db, { slug: 'nope/nope' })).rejects.toThrow(/No published/);
  });

  it('requires a slug', async () => {
    await expect(readArticleTool(db, {})).rejects.toThrow(/slug/);
  });
});

describe('list_collections', () => {
  it('counts published articles per collection and leaves drafts out', async () => {
    const collections = await listCollectionsTool(db);
    // `billing` has three articles in the fixture; the draft is not one of the
    // two counted here. Ordering is the collection's own `order` first, so the
    // folder that asked to be first is, whatever it is called.
    expect(collections).toEqual([
      {
        id: 'billing',
        title: 'Billing and plans',
        description: 'Invoices, receipts and what a plan includes.',
        icon: 'credit-card',
        tint: 'peach',
        articles: 2,
      },
      {
        id: 'account',
        title: 'Account',
        description: null,
        icon: 'book-open',
        tint: 'lavender',
        articles: 1,
      },
    ]);
  });

  it('titles a collection from its folder name when it has no _meta.json', async () => {
    const collections = await listCollectionsTool(db);
    expect(collections.find((c) => c.id === 'account')?.title).toBe('Account');
  });
});

describe('list_gaps', () => {
  it('shows the open gaps most-asked first, so the agent writes the useful doc', async () => {
    const gaps = await listGapsTool(db, {});
    expect(gaps[0]?.question).toBe('How do I export invoices to my accountant?');
    expect(gaps[0]?.asks).toBe(2);
    expect(gaps).toHaveLength(3);
  });

  it('carries the title and collection the support agent suggested', async () => {
    const gaps = await listGapsTool(db, {});
    const currency = gaps.find((gap) => gap.question.includes('currency'));
    expect(currency?.suggestedTitle).toBe('Changing your billing currency');
    expect(currency?.suggestedCollection).toBe('billing');
  });

  it('defaults to the new ones rather than the whole history', async () => {
    const gaps = await listGapsTool(db, {});
    expect(gaps.every((gap) => gap.status === 'new')).toBe(true);
  });

  it('refuses a status that is not one of the three', async () => {
    await expect(listGapsTool(db, { status: 'open' })).rejects.toThrow(/new, drafted, dismissed/);
  });
});

describe('resolve_gap', () => {
  it('marks the gap drafted against the article and moves it out of the backlog', async () => {
    const handle = await freshDb();
    await seed(handle.db);
    const [gap] = await listGapsTool(handle.db, {});

    const resolved = await resolveGapTool(handle.db, {
      id: gap?.id,
      articleSlug: 'billing/invoices',
    });
    expect(resolved).toMatchObject({ status: 'drafted', articleSlug: 'billing/invoices' });

    const open = await listGapsTool(handle.db, {});
    expect(open.map((g) => g.id)).not.toContain(gap?.id);
    const drafted = await listGapsTool(handle.db, { status: 'drafted' });
    expect(drafted.map((g) => g.id)).toContain(gap?.id);
    await handle.close();
  });

  it('accepts a draft article, because the doc is written before it is published', async () => {
    const handle = await freshDb();
    await seed(handle.db);
    const [gap] = await listGapsTool(handle.db, {});
    await expect(
      resolveGapTool(handle.db, { id: gap?.id, articleSlug: 'billing/refunds' }),
    ).resolves.toMatchObject({ articleSlug: 'billing/refunds' });
    await handle.close();
  });

  it('refuses an unknown gap id instead of silently updating nothing', async () => {
    await expect(
      resolveGapTool(db, { id: 'gap_missing', articleSlug: 'billing/invoices' }),
    ).rejects.toThrow(/No gap with id/);
  });

  it('finds a gap far down a long backlog, not just one in the top fifty', async () => {
    const handle = await freshDb();
    // Sixty distinct questions, each asked more often than the one we want,
    // so the target is ranked last by every ordering listGaps uses.
    await handle.db.insert(schema.gaps).values(
      Array.from({ length: 60 }, (_, i) => ({
        id: `gap_filler_${String(i).padStart(3, '0')}`,
        question: `Filler question number ${i} about feature ${i}?`,
        asks: 100 + i,
      })),
    );
    await handle.db.insert(schema.gaps).values({
      id: 'gap_at_the_bottom',
      question: 'How do I export invoices to my accountant?',
      asks: 1,
    });
    await indexArticles(handle.db, ARTICLES);

    expect((await listGapsTool(handle.db, {})).map((g) => g.id)).not.toContain('gap_at_the_bottom');

    await expect(
      resolveGapTool(handle.db, { id: 'gap_at_the_bottom', articleSlug: 'billing/invoices' }),
    ).resolves.toEqual({
      id: 'gap_at_the_bottom',
      question: 'How do I export invoices to my accountant?',
      status: 'drafted',
      articleSlug: 'billing/invoices',
    });
    const drafted = await listGapsTool(handle.db, { status: 'drafted' });
    expect(drafted.map((g) => g.id)).toEqual(['gap_at_the_bottom']);
    await handle.close();
  });

  it('resolves a gap by id whatever its status, so a drafted gap can be re-pointed', async () => {
    // A gap already drafted (or dismissed) can still be answered by a better
    // article later; that is the agent's call to make, so the lookup is by id
    // alone rather than through the open list.
    const handle = await freshDb();
    await seed(handle.db);
    const [gap] = await listGapsTool(handle.db, {});
    await resolveGapTool(handle.db, { id: gap?.id, articleSlug: 'billing/invoices' });
    await expect(
      resolveGapTool(handle.db, { id: gap?.id, articleSlug: 'billing/currency' }),
    ).resolves.toMatchObject({ articleSlug: 'billing/currency' });
    await handle.close();
  });

  it('refuses an article slug that was never indexed', async () => {
    const [gap] = await listGapsTool(db, {});
    await expect(
      resolveGapTool(db, { id: gap?.id, articleSlug: 'billing/imaginary' }),
    ).rejects.toThrow(/run the indexer/);
  });

  it('requires both the gap and the article', async () => {
    await expect(resolveGapTool(db, { id: 'gap_1' })).rejects.toThrow(/articleSlug/);
    await expect(resolveGapTool(db, { articleSlug: 'billing/invoices' })).rejects.toThrow(/"id"/);
  });
});

describe('recent_conversations', () => {
  it('returns the newest first with the customer’s last message as the snippet', async () => {
    const conversations = await recentConversationsTool(db, {});
    expect(conversations.map((c) => c.id)).toEqual([
      'conv_0000003',
      'conv_0000002',
      'conv_0000001',
    ]);
    expect(conversations[0]?.snippet).toBe('How do I turn on SSO?');
  });

  it('never includes the contact, so customer PII stays out of the agent’s context', async () => {
    const [first] = await recentConversationsTool(db, {});
    expect(JSON.stringify(first)).not.toContain('ada@example.com');
    expect(JSON.stringify(first)).not.toContain('Ada Lovelace');
    expect(first).not.toHaveProperty('contact');
  });

  it('blanks an email address the customer typed into their message', async () => {
    const handle = await freshDb();
    await seed(handle.db);
    await handle.db.insert(schema.conversations).values({
      id: 'conv_0000009',
      contactId: 'ct_0000001',
      status: 'unresolved',
      startedAt: new Date(),
      lastMessageAt: new Date(),
      messageCount: 1,
    });
    await handle.db.insert(schema.messages).values({
      id: 'msg_0000009',
      conversationId: 'conv_0000009',
      role: 'customer',
      body: 'Please send the invoice to Ada.Lovelace+billing@Example.co.uk or ada@example.com, thanks',
    });

    const [latest] = await recentConversationsTool(handle.db, { limit: 1 });
    expect(latest?.id).toBe('conv_0000009');
    expect(latest?.snippet).toBe('Please send the invoice to [email] or [email], thanks');
    expect(JSON.stringify(latest)).not.toMatch(/@/);
    await handle.close();
  });

  it('leaves text without an address exactly as it was', () => {
    expect(redactEmails('Where are my old invoices? @mentions and a@b are fine.')).toBe(
      'Where are my old invoices? @mentions and a@b are fine.',
    );
  });

  it('filters to the ones the agent could not resolve', async () => {
    const conversations = await recentConversationsTool(db, { status: 'unresolved' });
    expect(conversations.map((c) => c.id)).toEqual(['conv_0000002']);
  });

  it('honours a limit', async () => {
    const conversations = await recentConversationsTool(db, { limit: 2 });
    expect(conversations).toHaveLength(2);
  });

  it('carries the rating so the agent can see which answers landed', async () => {
    const [first] = await recentConversationsTool(db, {});
    expect(first?.rating).toBe('happy');
  });

  it('refuses a status that is not resolved or unresolved', async () => {
    await expect(recentConversationsTool(db, { status: 'pending' })).rejects.toThrow(
      /resolved, unresolved/,
    );
  });
});

describe('report_summary', () => {
  it('counts only the conversations inside the window', async () => {
    const month = await reportSummaryTool(db, { range: '30d' });
    expect(month.conversations).toBe(2);

    const everything = await reportSummaryTool(db, { range: 'all' });
    expect(everything.conversations).toBe(3);
  });

  it('reports the resolution rate rather than leaving the agent to divide', async () => {
    const summary = await reportSummaryTool(db, { range: '30d' });
    expect(summary.resolved).toBe(1);
    expect(summary.unresolved).toBe(1);
    expect(summary.resolutionRate).toBe(0.5);
  });

  it('says which window it used, so the numbers are not floating free', async () => {
    const summary = await reportSummaryTool(db, { range: '7d' });
    expect(summary.range.preset).toBe('7d');
    expect(Date.parse(summary.range.from)).toBeLessThan(Date.parse(summary.range.to));
  });

  it('defaults to the last 30 days', async () => {
    const summary = await reportSummaryTool(db, {});
    expect(summary.range.preset).toBe('30d');
  });

  it('names the topics people asked about most', async () => {
    const summary = await reportSummaryTool(db, { range: '30d' });
    expect(summary.topTopics).toContainEqual({ topic: 'billing', count: 1, resolvedRate: 0 });
  });

  it('refuses a range it does not understand', async () => {
    await expect(reportSummaryTool(db, { range: 'last tuesday' })).rejects.toThrow(/range/);
  });
});

describe('dispatch', () => {
  it('runs a tool by its protocol name', async () => {
    const result = await runTool(db, 'list_collections', {});
    expect(result).toEqual(await listCollectionsTool(db));
  });

  it('ignores arguments for a tool that takes none', async () => {
    await expect(runTool(db, 'list_collections', { nonsense: true })).resolves.toBeDefined();
  });

  it('lists the real tool names when asked for one that does not exist', async () => {
    await expect(runTool(db, 'delete_everything', {})).rejects.toThrow(/search_articles/);
  });
});
