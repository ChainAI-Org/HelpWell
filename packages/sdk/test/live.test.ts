/**
 * The SDK against a real HelpWell.
 *
 * The other suites check that a method call becomes the right request. This
 * one checks the other direction: that what a real handler on a real Postgres
 * (PGlite) sends back is what `types.ts` says it is, field for field, and
 * that a client behaves like one visitor across calls rather than a new one
 * per request. No mocks, so a wire change in core fails here first.
 */

import { FakeModel } from '@helpwell/core/agent';
import { createHelpWellHandler, type HelpWellHandler } from '@helpwell/core/api';
import type { Article } from '@helpwell/core/content';
import { createDb, type DbHandle, migrate, schema } from '@helpwell/core/db';
import { indexArticles } from '@helpwell/core/search';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HelpWellClient } from '../src/index.js';

const BASE = 'http://helpwell.test/api/helpwell';
const SECRET = 'live-test-identity-secret';
const ADMIN = 'live-test-admin-token';

let handle: DbHandle;
let handler: HelpWellHandler;

/** Hands the SDK's requests straight to the handler: no port, no server. */
function bridge(to: HelpWellHandler): typeof globalThis.fetch {
  return (input, init) => to(new Request(input, init));
}

function client(options: { adminToken?: string; identitySecret?: string } = {}): HelpWellClient {
  return new HelpWellClient({ baseUrl: BASE, fetch: bridge(handler), ...options });
}

function article(
  partial: Pick<Article, 'slug' | 'collection' | 'title' | 'body'> & Partial<Article>,
): Article {
  return {
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${partial.slug}.md`,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: `hash-${partial.slug}`,
    ...partial,
  };
}

beforeAll(async () => {
  handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
  handler = createHelpWellHandler({
    db: handle.db,
    basePath: '/api/helpwell',
    identitySecret: SECRET,
    adminToken: ADMIN,
    secureCookies: false,
    model: new FakeModel([{ text: 'Open Billing, then Invoices, then Export.' }]),
  });

  await indexArticles(handle.db, [
    article({
      slug: 'billing/invoices',
      collection: 'billing',
      title: 'Exporting invoices',
      description: 'Download a PDF of any invoice.',
      body: '## Steps\n\nOpen Billing, choose Invoices, then press Export. A PDF downloads.',
      headings: [{ depth: 2, text: 'Steps', id: 'steps' }],
    }),
  ]);
  await handle.db.insert(schema.roadmapItems).values({ id: 'rm_live_1', title: 'Dark mode' });
});

afterAll(async () => {
  await handle.close();
});

describe('one client is one visitor', () => {
  it('toggles a vote on and then off, because the second call carries the first call’s cookie', async () => {
    const visitor = client();
    await expect(visitor.vote('rm_live_1')).resolves.toEqual({ voted: true, votesCount: 1 });
    await expect(visitor.vote('rm_live_1')).resolves.toEqual({ voted: false, votesCount: 0 });
  });

  it('tracks several events against one contact rather than one contact per event', async () => {
    const before = (await client({ adminToken: ADMIN }).admin.contacts()).items.length;
    const visitor = client();
    await visitor.track('opened_pricing');
    await visitor.track('opened_pricing');
    await visitor.track('started_trial', { plan: 'pro' });
    const after = (await client({ adminToken: ADMIN }).admin.contacts()).items.length;
    expect(after - before).toBe(1);
  });

  it('is refused an idea while anonymous, and accepted once identified', async () => {
    const user = client({ identitySecret: SECRET });
    await expect(user.submitIdea('Dark mode, please')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });

    const identity = await user.identify(
      await user.signFor({ id: 'user_42', email: 'ada@example.com', name: 'Ada' }),
    );
    expect(identity.identified).toBe(true);

    const { id } = await user.submitIdea('Dark mode, please', 'It burns at night.');
    expect(id).toMatch(/^rmp_/);

    const contact = await client({ adminToken: ADMIN }).admin.contact(identity.contactId);
    expect(contact.identified).toBe(true);
    expect(contact.email).toBe('ada@example.com');
  });

  it('forgets its visitor on request and becomes a new one', async () => {
    const visitor = client();
    const first = await visitor.visitor();
    visitor.forget();
    const second = await visitor.visitor();
    expect(second.contactId).not.toBe(first.contactId);
  });
});

describe('what the server sends matches the types', () => {
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    const visitor = client();
    await visitor.search('invoices');
    const reply = await visitor.chat({ message: 'How do I export invoices?' });
    conversationId = reply.conversationId;
    messageId = reply.messageId;
    await visitor.feedback(messageId, 'helpful');
    await visitor.rateConversation(conversationId, 'love', 'Quick and right.');
  });

  it('ChatReply', async () => {
    const reply = await client().chat({ message: 'How do I export invoices?' });
    expect(reply).toMatchObject({
      conversationId: expect.stringMatching(/^cnv_/),
      messageId: expect.stringMatching(/^msg_/),
      text: expect.any(String),
      citations: [{ slug: 'billing/invoices', title: 'Exporting invoices', collection: 'billing' }],
      unresolved: false,
      degraded: false,
    });
    // Token counts and cost stay on the server; a visitor's browser never sees them.
    expect(reply).not.toHaveProperty('usage');
  });

  it('ReportBundle: searches, articles, topics and spend carry the fields the repo computes', async () => {
    const report = await client({ adminToken: ADMIN }).admin.reports({ range: '7d' });

    expect(report.range).toEqual({ from: expect.any(String), to: expect.any(String) });
    expect(report.headline).toMatchObject({
      conversations: expect.any(Number),
      resolved: expect.any(Number),
      unresolved: expect.any(Number),
      costUsd: expect.any(Number),
      helpfulVotes: expect.any(Number),
      unhelpfulVotes: expect.any(Number),
      articleViewsFromAgent: expect.any(Number),
    });
    expect(report.headline).toHaveProperty('resolutionRate');
    expect(report.headline).toHaveProperty('medianLatencyMs');

    expect(report.series[0]).toEqual({
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      conversations: expect.any(Number),
      resolved: expect.any(Number),
      costUsd: expect.any(Number),
    });
    expect(report.searches).toContainEqual({ query: 'invoices', count: 1, zeroResults: false });
    expect(report.articles[0]).toEqual({
      slug: 'billing/invoices',
      title: 'Exporting invoices',
      collection: 'billing',
      citations: expect.any(Number),
      helpful: expect.any(Number),
      unhelpful: expect.any(Number),
    });
    expect(report.topics).toContainEqual({
      topic: 'billing',
      count: expect.any(Number),
      resolvedRate: expect.any(Number),
    });
    expect(report.spend[0]).toEqual({
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      kind: 'chat',
      model: expect.any(String),
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number),
      costUsd: expect.any(Number),
    });
  });

  it('ConversationThread: every message carries toolCalls, model and latencyMs', async () => {
    const thread = await client({ adminToken: ADMIN }).admin.conversation(conversationId);

    expect(thread).toMatchObject({
      id: conversationId,
      status: 'resolved',
      topic: 'billing',
      tags: expect.any(Array),
      lastMessageAt: expect.any(String),
      startedAt: expect.any(String),
      messageCount: 2,
      reviewedAt: null,
      rating: 'love',
      contact: { id: expect.any(String), name: null, email: null, identified: false },
      snippet: 'How do I export invoices?',
      pageUrl: null,
      costUsd: expect.any(Number),
    });

    expect(thread.messages).toHaveLength(2);
    for (const message of thread.messages) {
      expect(Object.keys(message).sort()).toEqual([
        'body',
        'certainty',
        'citations',
        'confidence',
        'confidenceReason',
        'costUsd',
        'createdAt',
        'feedback',
        'id',
        'latencyMs',
        'model',
        'role',
        'sources',
        'tokensIn',
        'tokensOut',
        'toolCalls',
      ]);
      expect(typeof message.createdAt).toBe('string');
      expect(Array.isArray(message.toolCalls)).toBe(true);
      // What search showed the reply, for the review: never on a customer turn.
      expect(Array.isArray(message.sources)).toBe(true);
      if (message.role === 'customer') expect(message.sources).toEqual([]);
    }
    const agent = thread.messages.find((m) => m.role === 'agent');
    expect(agent).toMatchObject({ id: messageId, feedback: 'helpful', model: expect.any(String) });
    // Every agent answer records how long it took, if only a few milliseconds here.
    expect(typeof agent?.latencyMs).toBe('number');
    expect(typeof agent?.confidence).toBe('number');
  });

  it('ArticleDetail: the collection title rides alongside the folder id', async () => {
    const { article: detail, related } = await client().article('billing/invoices');
    expect(detail).toEqual({
      slug: 'billing/invoices',
      title: 'Exporting invoices',
      description: 'Download a PDF of any invoice.',
      collection: 'billing',
      collection_title: 'Billing',
      body: expect.stringContaining('press Export'),
      headings: [{ depth: 2, text: 'Steps', id: 'steps' }],
      reading_minutes: 1,
      applies_to: null,
      updated_at: expect.any(String),
    });
    expect(related).toEqual([]);
  });

  it('the public thread and list views', async () => {
    const visitor = client();
    const reply = await visitor.chat({ message: 'How do I export invoices?' });

    const mine = await visitor.conversations();
    expect(mine).toEqual([
      {
        id: reply.conversationId,
        status: 'resolved',
        topic: 'billing',
        lastMessageAt: expect.any(String),
        snippet: expect.any(String),
      },
    ]);

    const thread = await visitor.conversation(reply.conversationId);
    expect(thread.id).toBe(reply.conversationId);
    expect(thread.messages.map((m) => Object.keys(m).sort())).toEqual([
      ['body', 'citations', 'createdAt', 'feedback', 'id', 'role'],
      ['body', 'citations', 'createdAt', 'feedback', 'id', 'role'],
    ]);

    // Somebody else's thread is refused, not found.
    await expect(client().conversation(reply.conversationId)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('the changelog read state, per visitor', async () => {
    const admin = client({ adminToken: ADMIN }).admin;
    const { id } = await admin.createChangelogEntry({
      title: 'Faster exports',
      status: 'published',
      tags: ['improvement'],
    });

    const visitor = client();
    await visitor.visitor();
    expect(await visitor.unread()).toBe(1);
    const page = await visitor.changelog();
    expect(page.items.find((e) => e.id === id)).toMatchObject({
      read: false,
      publishedAt: expect.any(String),
    });
    expect(await visitor.markAllRead()).toBe(1);
    expect(await visitor.unread()).toBe(0);
    await visitor.markRead(id);

    const entry = await visitor.changelogEntry(id);
    expect(entry).toMatchObject({ id, body: '', status: 'published', sourceRef: null });
  });

  it('the admin-only lists and the CSV export', async () => {
    const admin = client({ adminToken: ADMIN }).admin;

    const articles = await admin.articles();
    expect(articles[0]).toEqual({
      slug: 'billing/invoices',
      title: 'Exporting invoices',
      description: 'Download a PDF of any invoice.',
      collection: 'billing',
      status: 'published',
      reading_minutes: 1,
      updated_at: expect.any(String),
      embedded: false,
    });
    expect((await admin.searchArticles('invoices'))[0]?.slug).toBe('billing/invoices');

    await expect(admin.blocked()).resolves.toEqual([]);
    await expect(admin.evals()).resolves.toEqual([]);
    await expect(admin.evalRun('ev_missing')).rejects.toMatchObject({ status: 404 });

    const csv = await admin.exportReport({ range: '7d' });
    expect(csv.split('\n')[0]).toBe('day,conversations,resolved,cost_usd');

    const engage = await admin.engageReport({ range: '7d', surveyId: 'nps_q3' });
    expect(engage).toEqual({
      engagements: [],
      nps: {
        responses: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        score: null,
        comments: [],
      },
    });
  });

  it('a ContactExport for a subject access request', async () => {
    const admin = client({ adminToken: ADMIN }).admin;
    const [contact] = (await admin.contacts({ identified: true })).items;
    const dump = await admin.exportContact(contact!.id);
    expect(dump.contact).toMatchObject({
      id: contact!.id,
      externalId: 'user_42',
      name: 'Ada',
      email: 'ada@example.com',
      attributes: {},
      identified: true,
      consent: 'unknown',
      firstSeenAt: expect.any(String),
      lastSeenAt: expect.any(String),
      tags: [],
    });
    // One key per table, so nothing held about a person can be left out, and
    // the notes that say what the less obvious fields are.
    expect(Object.keys(dump).sort()).toEqual([
      'articleRatings',
      'changelogReads',
      'contact',
      'conversations',
      'engageImpressions',
      'events',
      'formSubmissions',
      'giveawayEntries',
      'messages',
      'notes',
      'roadmapIdeas',
      'roadmapVotes',
      'searches',
      'surveyResponses',
    ]);
    expect(dump.conversations).toEqual([]);
    expect(dump.notes['formSubmissions.ip_address_hash']).toContain('one-way hash');
  });

  it('tags on both conversations and contacts round-trip', async () => {
    const admin = client({ adminToken: ADMIN }).admin;
    await admin.addConversationTag(conversationId, 'Billing Bug');
    expect((await admin.conversation(conversationId)).tags).toEqual(['billing bug']);
    await admin.removeConversationTag(conversationId, 'billing bug');
    expect((await admin.conversation(conversationId)).tags).toEqual([]);

    const [contact] = (await admin.contacts({ identified: true })).items;
    await admin.addContactTag(contact!.id, 'beta');
    expect((await admin.contact(contact!.id)).tags).toEqual(['beta']);
    await admin.removeContactTag(contact!.id, 'beta');
    expect((await admin.contact(contact!.id)).tags).toEqual([]);
  });
});

describe('the admin token', () => {
  it('is accepted as a bearer even when the host also configured isAdmin', async () => {
    const both = createHelpWellHandler({
      db: handle.db,
      basePath: '/api/helpwell',
      adminToken: ADMIN,
      secureCookies: false,
      // The host app's own check, which knows nothing about this script.
      isAdmin: () => false,
    });
    const script = new HelpWellClient({ baseUrl: BASE, adminToken: ADMIN, fetch: bridge(both) });
    const settings = await script.admin.settings();
    expect(settings.product.name).toEqual(expect.any(String));
  });

  it('is refused when it is not the one the server was started with', async () => {
    const wrong = client({ adminToken: `${ADMIN}-nope` });
    await expect(wrong.admin.settings()).rejects.toMatchObject({ status: 401 });
  });
});
