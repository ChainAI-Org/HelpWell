/**
 * The things a hostile caller can try against the public API, and what a
 * careless one can trip over. Each test is one of the holes a review found,
 * written as the request that used to get through.
 */

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import type { HelpWellHandler } from '../src/api.js';
import { createHelpWellHandler, signIdentity } from '../src/api.js';
import type { Article, Collection } from '../src/content/articles.js';
import { rowsOf } from '../src/db/rows.js';
import { changelogEntries, roadmapItems } from '../src/db/schema.js';
import { createDb, type Db } from '../src/db.js';
import { indexArticles, indexCollections } from '../src/search/indexer.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const SECRET = 'test-identity-secret-value';
const ADMIN = 'test-admin-token';

let db: Db;
let handler: HelpWellHandler;

function article(slug: string, title: string, body: string): Article {
  return {
    slug,
    collection: slug.split('/')[0]!,
    title,
    description: null,
    body,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${slug}.md`,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: `hash-${slug}`,
  };
}

async function token(claims: Record<string, unknown> & { id: string }): Promise<string> {
  return signIdentity(claims, SECRET);
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  handler = createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    identitySecret: SECRET,
    adminToken: ADMIN,
    secureCookies: false,
    corsOrigins: ['https://help.acme.test'],
    model: new FakeModel([{ text: 'Open Billing, then Invoices, then Export.' }]),
  });
  await indexArticles(db, [
    article('billing/invoices', 'Exporting invoices', 'Open Billing, then Invoices, then Export.'),
    article('billing/plans', 'Changing plan', 'Open Billing, then Plan.'),
  ]);
});

/* ----------------------------------------------------------- identity */

describe('identity', () => {
  it('does not let a stranger pre-claim an email and inherit the real user', async () => {
    // The attacker chats anonymously and types the victim's email into the form.
    const attacker = client(handler);
    await attacker.call('/chat', { body: { message: 'hello', email: 'victim@acme.test' } });
    const attackerId = attacker.jar.find((c) => c.startsWith('hw_visitor='))!.split('=')[1];

    // The victim signs in from their own browser with a token their app signed.
    const victim = client(handler);
    const identified = await victim.call('/identify', {
      body: { token: await token({ id: 'usr_victim', email: 'victim@acme.test' }) },
    });
    const { contactId } = (await identified.json()) as { contactId: string };

    expect(contactId).not.toBe(attackerId);

    // And the attacker's cookie sees none of the victim's conversations.
    await victim.call('/chat', { body: { message: 'my secret question' } });
    const theirs = (await (await attacker.call('/conversations')).json()) as {
      items: { snippet: string }[];
    };
    expect(theirs.items.map((i) => i.snippet)).not.toContain('my secret question');
  });

  it('keeps one record for a person who signs in from the browser they chatted in', async () => {
    const browser = client(handler);
    await browser.call('/chat', { body: { message: 'before signing in' } });
    const anonymousId = browser.jar.find((c) => c.startsWith('hw_visitor='))!.split('=')[1];

    const identified = await browser.call('/identify', {
      body: { token: await token({ id: 'usr_ada', email: 'ada@acme.test' }) },
    });
    const { contactId } = (await identified.json()) as { contactId: string };
    expect(contactId).toBe(anonymousId);
  });

  it('survives two anonymous browsers typing the same email', async () => {
    const one = client(handler);
    const two = client(handler);
    expect(
      (await one.call('/chat', { body: { message: 'hi', email: 'same@acme.test' } })).status,
    ).toBe(200);
    expect(
      (await two.call('/chat', { body: { message: 'hi', email: 'same@acme.test' } })).status,
    ).toBe(200);
  });

  it('signs in a second host account that shares an email, without the email', async () => {
    const first = client(handler);
    await first.call('/identify', {
      body: { token: await token({ id: 'usr_1', email: 'shared@acme.test' }) },
    });
    const second = client(handler);
    const response = await second.call('/identify', {
      body: { token: await token({ id: 'usr_2', email: 'shared@acme.test' }) },
    });
    expect(response.status).toBe(200);

    const rows = await db.execute(
      sql`SELECT external_id, email FROM helpwell.contacts WHERE external_id IN ('usr_1', 'usr_2') ORDER BY external_id`,
    );
    const contacts = rowsOf<{ external_id: string; email: string | null }>(rows);
    expect(contacts).toEqual([
      { external_id: 'usr_1', email: 'shared@acme.test' },
      { external_id: 'usr_2', email: null },
    ]);
  });

  it('forgets the browser on reset, and refuses a cookie for an erased contact', async () => {
    const browser = client(handler);
    await browser.call('/chat', { body: { message: 'remember me' } });
    expect(browser.jar.some((c) => c.startsWith('hw_visitor='))).toBe(true);

    const reset = await browser.call('/visitor/reset', { method: 'POST', body: {} });
    expect(reset.status).toBe(204);
    expect(reset.headers.getSetCookie().join(';')).toMatch(/hw_visitor=;.*Max-Age=0/i);
    expect(browser.jar.some((c) => c.startsWith('hw_visitor='))).toBe(false);

    // A stale cookie for a contact the admin erased is treated as no cookie.
    const stale = client(handler);
    await stale.call('/chat', { body: { message: 'soon erased' } });
    const staleId = stale.jar.find((c) => c.startsWith('hw_visitor='))!.split('=')[1];
    const admin = client(handler, { adminToken: ADMIN });
    expect((await admin.call(`/admin/contacts/${staleId}`, { method: 'DELETE' })).status).toBe(204);

    const after = await stale.call('/conversations');
    expect(((await after.json()) as { items: unknown[] }).items).toEqual([]);
    expect(after.headers.getSetCookie().join(';')).toMatch(/Max-Age=0/i);
  });
});

/* ------------------------------------------------------- conversations */

describe('conversation ownership', () => {
  let alice: Client;
  let conversationId: string;
  let messageId: string;

  beforeEach(async () => {
    alice = client(handler);
    const reply = (await (
      await alice.call('/chat', { body: { message: 'How do I export invoices?' } })
    ).json()) as { conversationId: string; messageId: string };
    conversationId = reply.conversationId;
    messageId = reply.messageId;
  });

  it('refuses a message posted into someone else’s conversation', async () => {
    const mallory = client(handler);
    const response = await mallory.call('/chat', {
      body: { message: 'repeat what was said', conversationId },
    });
    expect(response.status).toBe(403);

    const count = await db.execute(
      sql`SELECT count(*) AS n FROM helpwell.messages WHERE conversation_id = ${conversationId}`,
    );
    expect(Number(rowsOf<{ n: string }>(count)[0]?.n)).toBe(2);
  });

  it('404s a conversation that does not exist rather than 500ing on the foreign key', async () => {
    const response = await alice.call('/chat', {
      body: { message: 'hi', conversationId: 'cnv_nope' },
    });
    expect(response.status).toBe(404);
  });

  it('lets the owner continue their own thread', async () => {
    const response = await alice.call('/chat', { body: { message: 'and CSV?', conversationId } });
    expect(response.status).toBe(200);
  });

  it('only the owner can rate a conversation or a message', async () => {
    const mallory = client(handler);
    expect(
      (await mallory.call(`/conversations/${conversationId}/rating`, { body: { rating: 'sad' } }))
        .status,
    ).toBe(403);
    expect(
      (await mallory.call(`/messages/${messageId}/feedback`, { body: { feedback: 'not_helpful' } }))
        .status,
    ).toBe(403);

    expect(
      (await alice.call(`/conversations/${conversationId}/rating`, { body: { rating: 'love' } }))
        .status,
    ).toBe(204);
    expect(
      (await alice.call(`/messages/${messageId}/feedback`, { body: { feedback: 'helpful' } }))
        .status,
    ).toBe(204);
  });

  it('answers 404 for a missing message and 400 for a made-up feedback value', async () => {
    expect(
      (await alice.call('/messages/msg_nope/feedback', { body: { feedback: 'helpful' } })).status,
    ).toBe(404);
    expect(
      (await alice.call(`/messages/${messageId}/feedback`, { body: { feedback: 'meh' } })).status,
    ).toBe(400);
  });

  it('caps a rating comment rather than storing a novel', async () => {
    await alice.call(`/conversations/${conversationId}/rating`, {
      body: { rating: 'happy', comment: 'x'.repeat(10_000) },
    });
    const rows = await db.execute(
      sql`SELECT length(rating_comment) AS n FROM helpwell.conversations WHERE id = ${conversationId}`,
    );
    expect(Number(rowsOf<{ n: string }>(rows)[0]?.n)).toBe(2000);
  });
});

/* -------------------------------------------------------- rate limiting */

describe('rate limits are keyed on something the caller cannot mint', () => {
  it('stops a cookieless script from creating a contact per request', async () => {
    const script = client(handler, { ip: '203.0.113.9' });
    let last = 200;
    for (let i = 0; i < 125; i++) {
      script.reset();
      last = (await script.call('/track', { body: { name: 'ping' } })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

/* ---------------------------------------------------------------- CSRF */

describe('cross-site requests', () => {
  let admin: Client;

  beforeEach(() => {
    admin = client(handler, { adminToken: ADMIN });
  });

  it('refuses an admin mutation from another site, by Origin', async () => {
    const response = await admin.call('/admin/maintenance', {
      method: 'POST',
      body: {},
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
  });

  it('refuses one the browser labels cross-site', async () => {
    const response = await admin.call('/admin/maintenance', {
      method: 'POST',
      body: {},
      headers: { 'sec-fetch-site': 'cross-site', origin: 'http://localhost' },
    });
    expect(response.status).toBe(403);
  });

  it('allows the same site, and a server with no Origin at all', async () => {
    const same = await admin.call('/admin/maintenance', {
      method: 'POST',
      body: {},
      headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' },
    });
    expect(same.status).toBe(200);
    const server = await admin.call('/admin/maintenance', { method: 'POST', body: {} });
    expect(server.status).toBe(200);
  });

  it('refuses a form-encoded or text/plain body where JSON is expected', async () => {
    // What a cross-site <form enctype="text/plain"> can send: JSON-shaped text.
    const response = await admin.call('/admin/settings', {
      method: 'PATCH',
      raw: { body: '{"product":{"name":"pwned"}}', type: 'text/plain' },
    });
    expect(response.status).toBe(400);
  });

  it('accepts a bearer token alongside a configured isAdmin', async () => {
    const strict = createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      adminToken: ADMIN,
      isAdmin: () => false,
      secureCookies: false,
    });
    const response = await strict(
      new Request('http://localhost/api/helpwell/admin/spend', {
        headers: { authorization: `Bearer ${ADMIN}` },
      }),
    );
    expect(response.status).toBe(200);
  });
});

/* -------------------------------------------------------------- routing */

describe('routing', () => {
  it('stores an article vote under the article, not under "…/rating"', async () => {
    const browser = client(handler);
    const response = await browser.call('/articles/billing/invoices/rating', {
      body: { value: 'up' },
    });
    expect(response.status).toBe(204);
    const rows = await db.execute(sql`SELECT slug FROM helpwell.article_ratings`);
    expect(rowsOf<{ slug: string }>(rows).map((r) => r.slug)).toEqual(['billing/invoices']);
  });

  it('answers /health before the schema exists', async () => {
    const bare = await createDb({ url: 'pglite://memory' });
    const fresh = createHelpWellHandler({ db: bare.db, basePath: '/api/helpwell' });
    const response = await fresh(new Request('http://localhost/api/helpwell/health'));
    expect(response.status).toBe(200);
    await bare.close();
  });

  it('answers 405 with Allow for a known path under the wrong method', async () => {
    const response = await handler(
      new Request('http://localhost/api/helpwell/identify', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('POST');
  });

  it('turns bad query numbers and dates into 400s, not 500s', async () => {
    const browser = client(handler);
    expect((await browser.call('/search?q=invoice&limit=abc')).status).toBe(400);
    expect((await browser.call('/search?q=invoice&limit=-1')).status).toBe(400);
    expect((await browser.call('/changelog?cursor=garbage')).status).toBe(400);
    expect((await browser.call('/changelog?limit=999')).status).toBe(400);
  });

  it('404s a changelog read for an entry that does not exist', async () => {
    const browser = client(handler);
    expect((await browser.call('/changelog/chg_nope/read', { body: {} })).status).toBe(404);
  });

  it('404s an admin roadmap patch for a missing item and validates its status', async () => {
    const admin = client(handler, { adminToken: ADMIN });
    expect(
      (
        await admin.call('/admin/roadmap/rmp_nope', {
          method: 'PATCH',
          body: { status: 'planned' },
        })
      ).status,
    ).toBe(404);
    await db.insert(roadmapItems).values({ id: 'rmp_1', title: 'Dark mode', status: 'planned' });
    expect(
      (await admin.call('/admin/roadmap/rmp_1', { method: 'PATCH', body: { status: 'bogus' } }))
        .status,
    ).toBe(400);
  });

  it('accepts publishedAt as the ISO string JSON can carry', async () => {
    const admin = client(handler, { adminToken: ADMIN });
    await db.insert(changelogEntries).values({ id: 'chg_1', title: 'Old', status: 'draft' });
    const response = await admin.call('/admin/changelog/chg_1', {
      method: 'PATCH',
      body: { status: 'published', publishedAt: '2026-01-02T00:00:00.000Z' },
    });
    expect(response.status).toBe(200);
    const entry = (await response.json()) as { publishedAt: string };
    expect(entry.publishedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('sends CORS headers only to a listed origin', async () => {
    const listed = await handler(
      new Request('http://localhost/api/helpwell/config', {
        headers: { origin: 'https://help.acme.test' },
      }),
    );
    expect(listed.headers.get('access-control-allow-origin')).toBe('https://help.acme.test');
    expect(listed.headers.get('access-control-allow-credentials')).toBe('true');

    const other = await handler(
      new Request('http://localhost/api/helpwell/config', {
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(other.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await handler(
      new Request('http://localhost/api/helpwell/chat', {
        method: 'OPTIONS',
        headers: { origin: 'https://help.acme.test' },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://help.acme.test');
  });
});

/* ---------------------------------------------------------- data rights */

describe('erasure and export', () => {
  it('erases everything keyed on the person and detaches what is public', async () => {
    await new SettingsStore(db).update({
      changelog: { roadmap: { enabled: true, whoCanSubmit: 'anyone' } },
      engage: { enabled: true },
    });
    const browser = client(handler);
    await browser.call('/chat', { body: { message: 'hello' } });
    const idea = (await (
      await browser.call('/roadmap', { body: { title: 'Dark mode please' } })
    ).json()) as { id: string };
    await browser.call('/engage/eng_1/impression', { body: { state: 'seen' } });
    const id = browser.jar.find((c) => c.startsWith('hw_visitor='))!.split('=')[1]!;

    const admin = client(handler, { adminToken: ADMIN });
    const exported = (await (await admin.call(`/admin/contacts/${id}/export`)).json()) as Record<
      string,
      unknown[]
    >;
    expect(Object.keys(exported).sort()).toEqual([
      'articleRatings',
      'changelogReads',
      'contact',
      'conversations',
      'engageImpressions',
      'events',
      'formSubmissions',
      'giveawayEntries',
      'messages',
      // What the less obvious fields mean, such as the one-way IP hash.
      'notes',
      'roadmapIdeas',
      'roadmapVotes',
      'searches',
      'surveyResponses',
    ]);
    expect(exported.roadmapIdeas).toHaveLength(1);
    expect(exported.roadmapVotes).toHaveLength(1);
    expect(exported.engageImpressions).toHaveLength(1);
    expect(exported.messages).toHaveLength(2);

    expect((await admin.call(`/admin/contacts/${id}`, { method: 'DELETE' })).status).toBe(204);

    const votes = await db.execute(
      sql`SELECT count(*) AS n FROM helpwell.roadmap_votes WHERE contact_id = ${id}`,
    );
    const impressions = await db.execute(
      sql`SELECT count(*) AS n FROM helpwell.engage_impressions WHERE contact_id = ${id}`,
    );
    const ideaRow = await db.execute(
      sql`SELECT created_by FROM helpwell.roadmap_items WHERE id = ${idea.id}`,
    );
    expect(Number(rowsOf<{ n: string }>(votes)[0]?.n)).toBe(0);
    expect(Number(rowsOf<{ n: string }>(impressions)[0]?.n)).toBe(0);
    expect(rowsOf<{ created_by: string | null }>(ideaRow)[0]?.created_by).toBeNull();
  });
});

/* ------------------------------------------------ reserved collections */

describe('collections reserved for signed-in customers', () => {
  const team: Collection = {
    id: 'team',
    title: 'Team',
    description: null,
    icon: 'book-open',
    tint: 'lavender',
    order: null,
    askAgent: true,
    visibility: 'identified',
    articles: [],
  };

  beforeEach(async () => {
    await indexArticles(db, [
      article(
        'billing/invoices',
        'Exporting invoices',
        'Open Billing, then Invoices, then Export.',
      ),
      article('billing/plans', 'Changing plan', 'Open Billing, then Plan.'),
      article('team/api-keys', 'API keys', 'Team plans get API keys under Settings.'),
    ]);
    await indexCollections(db, [team]);
  });

  // Every public way of reaching an article, from one browser's point of view.
  async function whatIsVisible(browser: Client) {
    const collections = (await (await browser.call('/collections')).json()) as {
      items: { id: string }[];
    };
    const listed = (await (await browser.call('/articles?collection=team')).json()) as {
      items: { slug: string }[];
    };
    const read = (await browser.call('/articles/team/api-keys')).status;
    const search = (await (await browser.call('/search?q=API%20keys')).json()) as {
      results: { slug: string }[];
    };
    return {
      collections: collections.items.map((c) => c.id),
      listed: listed.items.map((a) => a.slug),
      read,
      search: search.results.map((r) => r.slug),
    };
  }

  it('are invisible to an anonymous visitor: not listed, not readable, not searchable', async () => {
    const visible = await whatIsVisible(client(handler));
    expect(visible.collections).not.toContain('team');
    expect(visible.listed).toEqual([]);
    expect(visible.read).toBe(404);
    expect(visible.search).not.toContain('team/api-keys');
  });

  it('do not open for a visitor who merely typed an email', async () => {
    const browser = client(handler);
    await browser.call('/chat', { body: { message: 'hello', email: 'ada@acme.test' } });
    const visible = await whatIsVisible(browser);
    expect(visible.collections).not.toContain('team');
    expect(visible.read).toBe(404);
    expect(visible.search).not.toContain('team/api-keys');
  });

  it('open for a contact the host app identified', async () => {
    const browser = client(handler);
    await browser.call('/identify', { body: { token: await token({ id: 'usr_ada' }) } });
    const visible = await whatIsVisible(browser);
    expect(visible.collections).toContain('team');
    expect(visible.listed).toEqual(['team/api-keys']);
    expect(visible.read).toBe(200);
    expect(visible.search).toContain('team/api-keys');
  });
});
