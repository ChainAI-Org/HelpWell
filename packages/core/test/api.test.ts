import { beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import type { HelpWellConfig, HelpWellHandler } from '../src/api.js';
import { createHelpWellHandler, signIdentity } from '../src/api.js';
import type { Article } from '../src/content/articles.js';
import type { Db } from '../src/db/client.js';
import { changelogEntries, roadmapItems } from '../src/db/schema.js';
import { indexArticles } from '../src/search/indexer.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb } from './helpers/db.js';

const BASE = 'http://localhost/api/helpwell';
const SECRET = 'test-identity-secret-value';
const ADMIN = 'test-admin-token';

let db: Db;
let handler: HelpWellHandler;

/** Cookies the "browser" is holding, so a visitor persists across calls. */
let jar: string[] = [];

/** RequestInit, except `body` is whatever we want to send as JSON. */
type CallInit = Omit<RequestInit, 'body'> & { admin?: boolean; body?: unknown };

function call(path: string, init: CallInit = {}): Promise<Response> {
  const { admin, body, ...rest } = init;
  const headers = new Headers(rest.headers);
  const cookies = [...jar];
  if (admin) cookies.push(`hw_admin=${ADMIN}`);
  if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
  if (body !== undefined) headers.set('content-type', 'application/json');

  return handler(
    new Request(`${BASE}${path}`, {
      ...rest,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** Call, then remember any cookie the response set. */
async function browse(path: string, init: CallInit = {}): Promise<Response> {
  const response = await call(path, init);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const pair = setCookie.split(';')[0];
    if (pair) jar = [...jar.filter((c) => !c.startsWith(`${pair.split('=')[0]}=`)), pair];
  }
  return response;
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** A complete Article, so the fixtures below stay to the point. */
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

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  jar = [];
  handler = createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    identitySecret: SECRET,
    adminToken: ADMIN,
    secureCookies: false,
    model: new FakeModel([{ text: 'You can export invoices from Billing, then Invoices.' }]),
  });

  await indexArticles(db, [
    article({
      slug: 'billing/invoices',
      collection: 'billing',
      title: 'Exporting invoices',
      description: 'Download a PDF of any invoice.',
      body: 'Open Billing, choose Invoices, then press Export. A PDF downloads.',
    }),
    article({
      slug: 'getting-started/install',
      collection: 'getting-started',
      title: 'Installing the widget',
      description: 'Add one script tag.',
      body: 'Paste the loader script before the closing body tag.',
    }),
  ]);
});

describe('routing', () => {
  it('answers health without any auth', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    expect(await body<{ ok: boolean }>(response)).toEqual({ ok: true, name: 'helpwell' });
  });

  it('404s a path outside the base', async () => {
    const response = await handler(new Request('http://localhost/elsewhere/health'));
    expect(response.status).toBe(404);
  });

  it('404s an unknown route', async () => {
    expect((await call('/nope')).status).toBe(404);
  });

  it('rejects a known path under the wrong method with a 405 that says what works', async () => {
    const response = await call('/health', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('answers a preflight', async () => {
    const response = await call('/chat', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('never leaks an internal message', async () => {
    const broken = createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      isAdmin: () => {
        throw new Error('secret detail about the database');
      },
    });
    // /health deliberately never builds a context, so use a route that does.
    const response = await broken(new Request(`${BASE}/config`));
    expect(response.status).toBe(500);
    const payload = await body<{ error: { message: string } }>(response);
    expect(payload.error.message).toBe('Something went wrong on our side.');
    expect(JSON.stringify(payload)).not.toContain('secret detail');
  });
});

describe('identity', () => {
  it('promotes an anonymous visitor into the identified contact', async () => {
    const first = await browse('/visitor', { method: 'POST' });
    const { contactId: anonymous } = await body<{ contactId: string }>(first);
    expect(anonymous).toMatch(/^con_/);

    // The visitor asks something while still anonymous.
    await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } });

    const token = await signIdentity(
      { id: 'user-77', email: 'Ada@Example.com', name: 'Ada' },
      SECRET,
    );
    const response = await browse('/identify', { method: 'POST', body: { token } });
    const { contactId, firstName } = await body<{ contactId: string; firstName?: string }>(
      response,
    );

    // Same record, so the conversation they just had is still theirs.
    expect(contactId).toBe(anonymous);
    // What the widget's Home greets them by.
    expect(firstName).toBe('Ada');

    const mine = await browse('/conversations');
    expect((await body<{ items: unknown[] }>(mine)).items).toHaveLength(1);
  });

  it('refuses a token signed with the wrong secret', async () => {
    const token = await signIdentity({ id: 'user-1' }, 'a-different-secret-entirely');
    const response = await call('/identify', { method: 'POST', body: { token } });
    expect(response.status).toBe(401);
    expect((await body<{ error: { message: string } }>(response)).error.message).toBe(
      'We could not verify who you are.',
    );
  });

  it('matches an existing contact by email on a later identify', async () => {
    const first = await signIdentity({ id: 'user-a', email: 'same@example.com' }, SECRET);
    const a = await body<{ contactId: string }>(
      await call('/identify', { method: 'POST', body: { token: first } }),
    );

    jar = [];
    const second = await signIdentity({ id: 'user-a', email: 'same@example.com' }, SECRET);
    const b = await body<{ contactId: string }>(
      await call('/identify', { method: 'POST', body: { token: second } }),
    );

    expect(b.contactId).toBe(a.contactId);
    // No name was sent, so there is nothing to greet them by.
    expect(b).not.toHaveProperty('firstName');
  });
});

describe('chat', () => {
  it('answers, cites, and sets a visitor cookie', async () => {
    const response = await browse('/chat', {
      method: 'POST',
      body: { message: 'How do I export invoices?', pageUrl: '/billing' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('hw_visitor=');

    const reply = await body<{
      conversationId: string;
      text: string;
      citations: { slug: string }[];
    }>(response);
    expect(reply.text).toContain('Billing');
    expect(reply.citations[0]?.slug).toBe('billing/invoices');
  });

  it('rejects an empty message with a message a customer can read', async () => {
    const response = await call('/chat', { method: 'POST', body: { message: '   ' } });
    expect(response.status).toBe(400);
    expect((await body<{ error: { message: string } }>(response)).error.message).toBe(
      'Type a message first.',
    );
  });

  it('rejects a body that is not JSON', async () => {
    const response = await handler(
      new Request(`${BASE}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('keeps one thread across turns', async () => {
    const first = await body<{ conversationId: string }>(
      await browse('/chat', { method: 'POST', body: { message: 'First question' } }),
    );
    const second = await body<{ conversationId: string }>(
      await browse('/chat', {
        method: 'POST',
        body: { message: 'Follow up', conversationId: first.conversationId },
      }),
    );
    expect(second.conversationId).toBe(first.conversationId);

    const thread = await body<{ messages: unknown[] }>(
      await browse(`/conversations/${first.conversationId}`),
    );
    expect(thread.messages.length).toBe(4);
  });

  it('will not hand a conversation to a different visitor', async () => {
    const mine = await body<{ conversationId: string }>(
      await browse('/chat', { method: 'POST', body: { message: 'Private question' } }),
    );

    jar = [];
    await browse('/visitor', { method: 'POST' });
    const response = await browse(`/conversations/${mine.conversationId}`);
    expect(response.status).toBe(403);
  });

  it('accepts pre-chat details before the agent runs', async () => {
    await browse('/chat', {
      method: 'POST',
      body: { message: 'Hello', email: 'Pre@Chat.com', name: 'Pre Chat' },
    });

    const contacts = await body<{ items: { email: string | null }[] }>(
      await call('/admin/contacts', { admin: true }),
    );
    expect(contacts.items[0]?.email).toBe('pre@chat.com');
  });
});

describe('search and articles', () => {
  it('finds an article and records the search', async () => {
    const response = await browse('/search?q=export%20invoices');
    const payload = await body<{ results: { slug: string; snippet: string }[] }>(response);
    expect(payload.results[0]?.slug).toBe('billing/invoices');
    expect(payload.results[0]?.snippet).toContain('<mark>');

    const reports = await body<{ searches: { query: string }[] }>(
      await call('/admin/reports?range=30d', { admin: true }),
    );
    expect(reports.searches.some((s) => s.query === 'export invoices')).toBe(true);
  });

  it('returns an empty result for an empty query rather than erroring', async () => {
    const payload = await body<{ results: unknown[] }>(await call('/search?q='));
    expect(payload.results).toEqual([]);
  });

  it('serves an article whose slug contains a slash', async () => {
    const response = await call('/articles/billing/invoices');
    expect(response.status).toBe(200);
    const payload = await body<{ article: { title: string }; related: unknown[] }>(response);
    expect(payload.article.title).toBe('Exporting invoices');
    expect(Array.isArray(payload.related)).toBe(true);
  });

  it('404s an unpublished or missing article', async () => {
    expect((await call('/articles/billing/nope')).status).toBe(404);
  });

  it('names the article’s collection, so the widget need not ask twice', async () => {
    const payload = await body<{ article: { collection: string; collection_title: string } }>(
      await call('/articles/billing/invoices'),
    );
    expect(payload.article.collection).toBe('billing');
    expect(payload.article.collection_title).toBe('Billing');
  });

  it('lists collections with counts', async () => {
    const payload = await body<{
      items: { id: string; collection: string; title: string; articles: number }[];
    }>(await call('/collections'));

    expect(payload.items).toHaveLength(2);
    expect(payload.items.every((c) => c.articles === 1)).toBe(true);
    expect(payload.items.map((c) => c.title)).toEqual(['Billing', 'Getting started']);
    // The old field name still rides along, so a cached widget keeps working.
    expect(payload.items.every((c) => c.collection === c.id)).toBe(true);
  });

  it('records an article rating', async () => {
    const response = await browse('/articles/billing/invoices/rating', {
      method: 'POST',
      body: { value: 'up' },
    });
    expect(response.status).toBe(204);
  });

  it('rejects a rating that is neither up nor down', async () => {
    const response = await browse('/articles/billing/invoices/rating', {
      method: 'POST',
      body: { value: 'sideways' },
    });
    expect(response.status).toBe(400);
  });
});

describe('changelog', () => {
  beforeEach(async () => {
    await db.insert(changelogEntries).values([
      {
        id: 'chg_one',
        version: '1.0.0',
        title: 'First release',
        summary: 'It begins.',
        body: 'Long body one.',
        status: 'published',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'chg_two',
        version: '1.1.0',
        title: 'Second release',
        summary: 'More things.',
        body: 'Long body two.',
        status: 'published',
        publishedAt: new Date('2026-02-01T00:00:00Z'),
      },
      {
        id: 'chg_draft',
        version: '1.2.0',
        title: 'Unreleased',
        body: 'Not yet.',
        status: 'draft',
      },
    ]);
  });

  it('hides drafts from the public feed and pages newest first', async () => {
    const page = await body<{ items: { id: string }[]; nextCursor: string | null }>(
      await call('/changelog?limit=1'),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe('chg_two');
    expect(page.nextCursor).not.toBeNull();

    const next = await body<{ items: { id: string }[]; nextCursor: string | null }>(
      await call(`/changelog?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`),
    );
    expect(next.items[0]?.id).toBe('chg_one');
    expect(next.nextCursor).toBeNull();
  });

  it('never ships article bodies in the list', async () => {
    const raw = await (await call('/changelog')).text();
    expect(raw).not.toContain('Long body one');
    expect(raw).toContain('It begins.');
  });

  it('tracks unread and clears it', async () => {
    await browse('/visitor', { method: 'POST' });
    expect((await body<{ count: number }>(await browse('/changelog/unread'))).count).toBe(2);

    await browse('/changelog/chg_one/read', { method: 'POST' });
    expect((await body<{ count: number }>(await browse('/changelog/unread'))).count).toBe(1);

    await browse('/changelog/read-all', { method: 'POST' });
    expect((await body<{ count: number }>(await browse('/changelog/unread'))).count).toBe(0);
  });

  it('404s a draft by id on the public route', async () => {
    expect((await call('/changelog/chg_draft')).status).toBe(404);
  });

  it('shows drafts to an admin', async () => {
    const page = await body<{ items: unknown[] }>(await call('/admin/changelog', { admin: true }));
    expect(page.items).toHaveLength(3);
  });

  it('does not move the publish date when a published entry is edited', async () => {
    await call('/admin/changelog/chg_one', {
      method: 'PATCH',
      admin: true,
      body: { title: 'First release, revised', status: 'published' },
    });
    const entry = await body<{ title: string; publishedAt: string }>(
      await call('/admin/changelog/chg_one', { admin: true }),
    );
    expect(entry.title).toBe('First release, revised');
    expect(new Date(entry.publishedAt).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('roadmap', () => {
  beforeEach(async () => {
    await db.insert(roadmapItems).values({
      id: 'rmp_one',
      title: 'Dark mode',
      status: 'planned',
    });
  });

  it('toggles a vote and keeps the count honest', async () => {
    await browse('/visitor', { method: 'POST' });

    const first = await body<{ voted: boolean; votesCount: number }>(
      await browse('/roadmap/rmp_one/vote', { method: 'POST' }),
    );
    expect(first).toEqual({ voted: true, votesCount: 1 });

    // Voting twice from the same visitor must not double-count.
    const second = await body<{ voted: boolean; votesCount: number }>(
      await browse('/roadmap/rmp_one/vote', { method: 'POST' }),
    );
    expect(second).toEqual({ voted: false, votesCount: 0 });
  });

  it('reports whether the caller has voted', async () => {
    await browse('/visitor', { method: 'POST' });
    await browse('/roadmap/rmp_one/vote', { method: 'POST' });

    const board = await body<{ planned: { voted: boolean }[] }>(await browse('/roadmap'));
    expect(board.planned[0]?.voted).toBe(true);
  });

  it('blocks an anonymous submission when the setting says identified only', async () => {
    await browse('/visitor', { method: 'POST' });
    const response = await browse('/roadmap', {
      method: 'POST',
      body: { title: 'An idea' },
    });
    expect(response.status).toBe(403);
    expect((await body<{ error: { message: string } }>(response)).error.message).toBe(
      'Sign in to suggest an idea.',
    );
  });

  it('accepts a submission from an identified person and self-votes it', async () => {
    const token = await signIdentity({ id: 'user-9', email: 'ida@example.com' }, SECRET);
    await browse('/identify', { method: 'POST', body: { token } });

    const response = await browse('/roadmap', {
      method: 'POST',
      body: { title: 'Keyboard shortcuts', body: 'For power users.' },
    });
    expect(response.status).toBe(201);

    const board = await body<{ under_review: { title: string; votesCount: number }[] }>(
      await browse('/roadmap'),
    );
    expect(board.under_review[0]?.title).toBe('Keyboard shortcuts');
    expect(board.under_review[0]?.votesCount).toBe(1);
  });

  it('rejects an empty title', async () => {
    const token = await signIdentity({ id: 'user-10' }, SECRET);
    await browse('/identify', { method: 'POST', body: { token } });
    const response = await browse('/roadmap', { method: 'POST', body: { title: '  ' } });
    expect(response.status).toBe(400);
  });

  it('404s the whole roadmap when it is switched off', async () => {
    await new SettingsStore(db).update({ changelog: { roadmap: { enabled: false } } });
    expect((await call('/roadmap')).status).toBe(404);
  });
});

describe('engage', () => {
  const tour = {
    id: 'welcome-tour',
    kind: 'tour' as const,
    enabled: true,
    title: 'Welcome',
    paths: { include: ['/app/**'], exclude: ['/app/settings'] },
    frequency: 'once' as const,
  };

  beforeEach(async () => {
    await new SettingsStore(db).update({ engage: { enabled: true, engagements: [tour] } });
  });

  it('matches an include path and respects an exclude', async () => {
    await browse('/visitor', { method: 'POST' });
    const shown = await body<{ items: { id: string }[] }>(await browse('/engage?path=/app/home'));
    expect(shown.items.map((i) => i.id)).toEqual(['welcome-tour']);

    const excluded = await body<{ items: unknown[] }>(await browse('/engage?path=/app/settings'));
    expect(excluded.items).toEqual([]);

    const unrelated = await body<{ items: unknown[] }>(await browse('/engage?path=/marketing'));
    expect(unrelated.items).toEqual([]);
  });

  it('does not show a once-only engagement twice', async () => {
    await browse('/visitor', { method: 'POST' });
    await browse('/engage/welcome-tour/impression', {
      method: 'POST',
      body: { state: 'seen' },
    });
    const again = await body<{ items: unknown[] }>(await browse('/engage?path=/app/home'));
    expect(again.items).toEqual([]);
  });

  it('never re-shows something that was dismissed', async () => {
    await new SettingsStore(db).update({
      engage: { enabled: true, engagements: [{ ...tour, frequency: 'always' }] },
    });
    await browse('/visitor', { method: 'POST' });
    await browse('/engage/welcome-tour/impression', {
      method: 'POST',
      body: { state: 'dismissed' },
    });
    const again = await body<{ items: unknown[] }>(await browse('/engage?path=/app/home'));
    expect(again.items).toEqual([]);
  });

  it('records an NPS response and summarises it', async () => {
    await browse('/visitor', { method: 'POST' });
    const response = await browse('/surveys/nps-q3/response', {
      method: 'POST',
      body: { kind: 'nps', score: 10, comment: 'Love it' },
    });
    expect(response.status).toBe(201);

    const report = await body<{ nps: { score: number; promoters: number } }>(
      await call('/admin/reports/engage?surveyId=nps-q3&range=30d', { admin: true }),
    );
    expect(report.nps.promoters).toBe(1);
    expect(report.nps.score).toBe(100);
  });

  it('rejects an out-of-range NPS score', async () => {
    await browse('/visitor', { method: 'POST' });
    const response = await browse('/surveys/nps-q3/response', {
      method: 'POST',
      body: { kind: 'nps', score: 11 },
    });
    expect(response.status).toBe(400);
    expect((await body<{ error: { message: string } }>(response)).error.message).toBe(
      'Pick a score from 0 to 10.',
    );
  });
});

describe('admin auth', () => {
  const guarded: [string, string][] = [
    ['GET', '/admin/conversations'],
    ['GET', '/admin/contacts'],
    ['GET', '/admin/gaps'],
    ['GET', '/admin/reports'],
    ['GET', '/admin/settings'],
    ['GET', '/admin/spend'],
    ['GET', '/admin/evals'],
    ['GET', '/admin/changelog'],
    ['GET', '/admin/roadmap'],
    ['GET', '/admin/articles'],
    ['GET', '/admin/blocked'],
    ['POST', '/admin/maintenance'],
  ];

  it.each(guarded)('401s %s %s without admin', async (method, path) => {
    const response = await call(path, { method });
    expect(response.status).toBe(401);
  });

  it('allows them with the admin cookie', async () => {
    for (const [method, path] of guarded) {
      const response = await call(path, { method, admin: true });
      expect(response.status, `${method} ${path}`).toBeLessThan(400);
    }
  });

  it('accepts a bearer token as well as a cookie', async () => {
    const response = await call('/admin/settings', {
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    expect(response.status).toBe(200);
  });

  it('rejects a nearly-correct token', async () => {
    const response = await call('/admin/settings', {
      headers: { authorization: `Bearer ${ADMIN}x` },
    });
    expect(response.status).toBe(401);
  });

  it('locks everything when no admin is configured at all', async () => {
    const locked = createHelpWellHandler({ db, basePath: '/api/helpwell' });
    const response = await locked(new Request(`${BASE}/admin/settings`));
    expect(response.status).toBe(401);
  });
});

describe('admin', () => {
  it('lists a conversation, tags it and marks it reviewed', async () => {
    const reply = await body<{ conversationId: string }>(
      await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } }),
    );

    const list = await body<{ items: { id: string; snippet: string }[] }>(
      await call('/admin/conversations', { admin: true }),
    );
    expect(list.items[0]?.id).toBe(reply.conversationId);
    expect(list.items[0]?.snippet).toBe('How do I export invoices?');

    await call(`/admin/conversations/${reply.conversationId}/tags`, {
      method: 'POST',
      admin: true,
      body: { tag: 'Billing' },
    });
    await call(`/admin/conversations/${reply.conversationId}`, {
      method: 'PATCH',
      admin: true,
      body: { reviewed: true, status: 'resolved' },
    });

    const thread = await body<{
      tags: string[];
      reviewedAt: string | null;
      status: string;
      messages: unknown[];
    }>(await call(`/admin/conversations/${reply.conversationId}`, { admin: true }));

    expect(thread.tags).toEqual(['billing']);
    expect(thread.reviewedAt).not.toBeNull();
    expect(thread.status).toBe('resolved');
    expect(thread.messages).toHaveLength(2);

    await call(`/admin/conversations/${reply.conversationId}/tags/billing`, {
      method: 'DELETE',
      admin: true,
    });
    const after = await body<{ tags: string[] }>(
      await call(`/admin/conversations/${reply.conversationId}`, { admin: true }),
    );
    expect(after.tags).toEqual([]);
  });

  it('filters conversations by status and by search', async () => {
    await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } });

    const resolved = await body<{ items: unknown[] }>(
      await call('/admin/conversations?status=resolved', { admin: true }),
    );
    expect(resolved.items).toHaveLength(1);

    const unresolved = await body<{ items: unknown[] }>(
      await call('/admin/conversations?status=unresolved', { admin: true }),
    );
    expect(unresolved.items).toEqual([]);

    const found = await body<{ items: unknown[] }>(
      await call('/admin/conversations?q=invoices', { admin: true }),
    );
    expect(found.items).toHaveLength(1);
  });

  it('shows a contact with conversations and help centre activity', async () => {
    const token = await signIdentity(
      { id: 'user-5', email: 'lee@example.com', name: 'Lee' },
      SECRET,
    );
    await browse('/identify', { method: 'POST', body: { token } });
    await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } });
    await browse('/search?q=invoices&source=widget');
    await browse('/articles/billing/invoices/rating', { method: 'POST', body: { value: 'up' } });

    const list = await body<{ items: { id: string; email: string }[] }>(
      await call('/admin/contacts?q=lee', { admin: true }),
    );
    const id = list.items[0]?.id as string;
    expect(list.items[0]?.email).toBe('lee@example.com');

    const detail = await body<{
      name: string;
      conversations: unknown[];
      activity: { kind: string }[];
      attributes: Record<string, unknown>;
    }>(await call(`/admin/contacts/${id}`, { admin: true }));

    expect(detail.name).toBe('Lee');
    expect(detail.conversations).toHaveLength(1);
    expect([...new Set(detail.activity.map((a) => a.kind))].sort()).toEqual([
      'article_rating',
      'search',
    ]);
  });

  it('exports and then erases a contact', async () => {
    const token = await signIdentity({ id: 'user-6', email: 'gone@example.com' }, SECRET);
    const { contactId } = await body<{ contactId: string }>(
      await browse('/identify', { method: 'POST', body: { token } }),
    );
    await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } });

    const exported = await call(`/admin/contacts/${contactId}/export`, { admin: true });
    expect(exported.headers.get('content-disposition')).toContain(contactId);
    const dump = await body<{ contact: { email: string }; conversations: unknown[] }>(exported);
    expect(dump.contact.email).toBe('gone@example.com');
    expect(dump.conversations.length).toBeGreaterThan(0);

    expect(
      (await call(`/admin/contacts/${contactId}`, { method: 'DELETE', admin: true })).status,
    ).toBe(204);
    expect((await call(`/admin/contacts/${contactId}`, { admin: true })).status).toBe(404);

    const remaining = await body<{ items: unknown[] }>(
      await call('/admin/contacts', { admin: true }),
    );
    expect(remaining.items).toEqual([]);
  });

  it('logs a gap when the docs do not cover the question', async () => {
    handler = createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      adminToken: ADMIN,
      secureCookies: false,
      model: new FakeModel([{ text: "I don't have anything on that yet." }]),
    });

    await browse('/chat', { method: 'POST', body: { message: 'Do you support SAML SSO?' } });

    const gaps = await body<{ items: { question: string; asks: number }[] }>(
      await call('/admin/gaps', { admin: true }),
    );
    expect(gaps.items).toHaveLength(1);
    expect(gaps.items[0]?.question).toContain('SAML');

    const id = (await body<{ items: { id: string }[] }>(await call('/admin/gaps', { admin: true })))
      .items[0]?.id as string;

    expect(
      (
        await call(`/admin/gaps/${id}`, {
          method: 'PATCH',
          admin: true,
          body: { status: 'dismissed' },
        })
      ).status,
    ).toBe(204);

    const open = await body<{ items: unknown[] }>(
      await call('/admin/gaps?status=new', { admin: true }),
    );
    expect(open.items).toEqual([]);
  });

  it('builds the reports bundle', async () => {
    await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } });

    const report = await body<{
      headline: { conversations: number; resolutionRate: number | null; costUsd: number };
      series: { day: string }[];
      articles: { slug: string; citations: number }[];
    }>(await call('/admin/reports?range=30d', { admin: true }));

    expect(report.headline.conversations).toBe(1);
    expect(report.series.length).toBeGreaterThan(0);
    expect(report.articles[0]?.slug).toBe('billing/invoices');
    expect(report.articles[0]?.citations).toBe(1);
  });

  it('exports the report as CSV', async () => {
    const response = await call('/admin/reports/export?range=7d', { admin: true });
    expect(response.headers.get('content-type')).toContain('text/csv');
    const text = await response.text();
    expect(text.split('\n')[0]).toBe('day,conversations,resolved,cost_usd');
  });

  it('saves valid settings and refuses invalid ones', async () => {
    const saved = await body<{ product: { name: string } }>(
      await call('/admin/settings', {
        method: 'PATCH',
        admin: true,
        body: { product: { name: 'Acme' } },
      }),
    );
    expect(saved.product.name).toBe('Acme');

    const rejected = await call('/admin/settings', {
      method: 'PATCH',
      admin: true,
      body: { agent: { spend: { dailyCapUsd: 'lots' } } },
    });
    expect(rejected.status).toBe(400);

    // The bad write must not have clobbered the good one.
    const current = await body<{ product: { name: string } }>(
      await call('/admin/settings', { admin: true }),
    );
    expect(current.product.name).toBe('Acme');
  });

  it('runs maintenance without a retention setting deleting everything', async () => {
    await browse('/chat', { method: 'POST', body: { message: 'How do I export invoices?' } });
    const result = await body<{ conversationsPruned: number; countersPruned: number }>(
      await call('/admin/maintenance', { method: 'POST', admin: true }),
    );
    expect(result.conversationsPruned).toBe(0);

    const list = await body<{ items: unknown[] }>(
      await call('/admin/conversations', { admin: true }),
    );
    expect(list.items).toHaveLength(1);
  });
});

describe('widget config', () => {
  it('serves what the widget needs and no secrets', async () => {
    await new SettingsStore(db).update({
      product: { name: 'Acme' },
      webhooks: [{ url: 'https://secret.example.com/hook', secret: 'shh-webhook-secret' }],
    });

    const response = await call('/config');
    const raw = await response.text();
    expect(raw).not.toContain('secret.example.com');
    expect(raw).not.toContain('shh-');

    const config = JSON.parse(raw) as {
      product: { name: string };
      widget: { tabs: Record<string, boolean> };
      unread: number;
    };
    expect(config.product.name).toBe('Acme');
    expect(config.widget.tabs.home).toBe(true);
    expect(config.unread).toBe(0);
  });

  it('carries the support email only when no support extension answers people', async () => {
    const supportEmail = async (config: Partial<HelpWellConfig>) => {
      const api = createHelpWellHandler({ db, basePath: '/api/helpwell', ...config });
      const response = await api(new Request(`${BASE}/config`));
      return ((await response.json()) as { product: { supportEmail: string | null } }).product
        .supportEmail;
    };

    expect(await supportEmail({ support: false })).toBeNull();
    await new SettingsStore(db).update({ product: { supportEmail: ' help@acme.test ' } });
    expect(await supportEmail({ support: false })).toBe('help@acme.test');

    // A support extension handles human replies: its own flow applies.
    const extension = {
      afterReply: async () => {},
      handleMessage: async () => null,
      handoff: async () => {},
      thread: async () => null,
    };
    expect(await supportEmail({ support: extension as never })).toBeNull();

    // It lands in a mailto link, so anything but a plain address is left out.
    await new SettingsStore(db).update({
      product: { supportEmail: 'help@acme.test?bcc=everyone@acme.test' },
    });
    expect(await supportEmail({ support: false })).toBeNull();
  });
});
