/**
 * Webhooks: the right subscribers get the right event, signed, and a failure
 * is a row in the delivery log rather than an error in the caller.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler } from '../src/api.js';
import { rowsOf } from '../src/db/rows.js';
import type { Db } from '../src/db.js';
import { WEBHOOK_EXAMPLES } from '../src/integration-prompts.js';
import { createChangelogEntry, updateChangelogEntry } from '../src/repos/changelog.js';
import { indexArticles } from '../src/search/indexer.js';
import { parseSettings } from '../src/settings/schema.js';
import { SettingsStore } from '../src/settings/store.js';
import {
  emitWebhooks,
  listDeliveries,
  MAX_ATTEMPTS,
  retryDelayMs,
  retryWebhooks,
  sendTestWebhook,
  sign,
  targetsFor,
  verifySignature,
} from '../src/webhooks.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
});

afterAll(async () => {
  await t.close();
});

const settings = parseSettings({
  webhooks: [
    { url: 'https://a.test/all', events: [], secret: 's3cret', active: true },
    { url: 'https://b.test/gaps', events: ['gap.created'], secret: '', active: true },
    { url: 'https://c.test/off', events: [], secret: '', active: false },
  ],
});

type Recorded = { url: string; headers: Headers; body: string };

function fakeFetch(respond: (url: string) => Response | Error): {
  calls: Recorded[];
  fetch: typeof fetch;
} {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
    const outcome = respond(url);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return { calls, fetch: impl };
}

async function deliveries(): Promise<
  { url: string; status: string; response_code: number | null; error: string | null }[]
> {
  const result = await db.execute(
    sql`SELECT url, status, response_code, error FROM helpwell.webhook_deliveries ORDER BY created_at, url`,
  );
  return rowsOf<{
    url: string;
    status: string;
    response_code: number | null;
    error: string | null;
  }>(result);
}

describe('targetsFor', () => {
  it('sends everything to an unfiltered hook, filtered events to a filtered one, nothing to an inactive one', () => {
    expect(targetsFor(settings, 'roadmap.idea').map((t) => t.url)).toEqual(['https://a.test/all']);
    expect(targetsFor(settings, 'gap.created').map((t) => t.url)).toEqual([
      'https://a.test/all',
      'https://b.test/gaps',
    ]);
  });
});

describe('emitWebhooks', () => {
  it('posts a signed JSON event and records the delivery', async () => {
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    const { calls, fetch } = fakeFetch(() => new Response('ok', { status: 200 }));

    await emitWebhooks(
      db,
      settings,
      'gap.created',
      { id: 'gap_1', question: 'Refunds?' },
      { fetch },
    );

    expect(calls.map((c) => c.url)).toEqual(['https://a.test/all', 'https://b.test/gaps']);
    const signed = calls[0]!;
    expect(signed.headers.get('content-type')).toBe('application/json');
    expect(signed.headers.get('x-helpwell-event')).toBe('gap.created');
    expect(signed.headers.get('x-helpwell-signature')).toBe(
      `sha256=${await sign('s3cret', signed.body)}`,
    );
    expect(JSON.parse(signed.body)).toMatchObject({
      event: 'gap.created',
      data: { id: 'gap_1', question: 'Refunds?' },
    });
    // No secret, no signature — rather than a signature over an empty key.
    expect(calls[1]!.headers.get('x-helpwell-signature')).toBeNull();

    expect(await deliveries()).toEqual([
      { url: 'https://a.test/all', status: 'delivered', response_code: 200, error: null },
      { url: 'https://b.test/gaps', status: 'delivered', response_code: 200, error: null },
    ]);
  });

  it('records a failure and a thrown fetch, and never throws itself', async () => {
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    const { fetch } = fakeFetch((url) =>
      url.includes('a.test') ? new Response('nope', { status: 500 }) : new Error('ECONNREFUSED'),
    );

    await expect(
      emitWebhooks(db, settings, 'gap.created', { id: 'gap_2' }, { fetch }),
    ).resolves.toBeUndefined();

    expect(await deliveries()).toEqual([
      { url: 'https://a.test/all', status: 'failed', response_code: 500, error: 'HTTP 500' },
      { url: 'https://b.test/gaps', status: 'failed', response_code: null, error: 'ECONNREFUSED' },
    ]);
  });

  it('does nothing at all when nobody subscribed', async () => {
    const { calls, fetch } = fakeFetch(() => new Response('ok'));
    await emitWebhooks(db, parseSettings({}), 'gap.created', {}, { fetch });
    expect(calls).toEqual([]);
  });
});

describe('verifySignature', () => {
  it('accepts the signature it made and refuses everything else', async () => {
    const body = '{"event":"gap.created"}';
    const header = `sha256=${await sign('s3cret', body)}`;
    expect(await verifySignature('s3cret', body, header)).toBe(true);
    expect(await verifySignature('other', body, header)).toBe(false);
    expect(await verifySignature('s3cret', `${body} `, header)).toBe(false);
    expect(await verifySignature('s3cret', body, null)).toBe(false);
    expect(await verifySignature('s3cret', body, 'md5=abc')).toBe(false);
  });
});

/* --------------------------------------------------------------- retries */

describe('retries', () => {
  const hook = parseSettings({
    webhooks: [{ url: 'https://r.test/hook', events: [], secret: 'k', active: true }],
  });
  const t0 = new Date('2026-09-22T10:00:00Z');
  const at = (minutes: number) => () => new Date(t0.getTime() + minutes * 60_000);

  async function rows() {
    return rowsOf<{
      status: string;
      attempts: number;
      next_attempt_at: string | Date | null;
    }>(
      await db.execute(
        sql`SELECT status, attempts, next_attempt_at FROM helpwell.webhook_deliveries`,
      ),
    );
  }

  it('schedules a failed delivery with backoff and resends the same bytes when it is due', async () => {
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    const failing = fakeFetch(() => new Response('down', { status: 503 }));
    await emitWebhooks(
      db,
      hook,
      'gap.created',
      { id: 'gap_r' },
      { fetch: failing.fetch, now: at(0) },
    );

    let [row] = await rows();
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(new Date(row!.next_attempt_at!).toISOString()).toBe(at(1)().toISOString());

    // Not due yet: nothing is sent.
    const early = await retryWebhooks(db, hook, { fetch: failing.fetch, now: at(0.5) });
    expect(early.attempted).toBe(0);

    const working = fakeFetch(() => new Response('ok'));
    const result = await retryWebhooks(db, hook, { fetch: working.fetch, now: at(2) });
    expect(result).toMatchObject({ attempted: 1, delivered: 1, failed: 0, gaveUp: 0 });
    expect(working.calls[0]!.body).toBe(failing.calls[0]!.body);
    expect(working.calls[0]!.headers.get('x-helpwell-attempt')).toBe('2');
    expect(working.calls[0]!.headers.get('x-helpwell-signature')).toBe(
      `sha256=${await sign('k', failing.calls[0]!.body)}`,
    );
    [row] = await rows();
    expect(row).toMatchObject({ status: 'delivered', attempts: 2, next_attempt_at: null });
  });

  it('backs off exponentially and gives up after five attempts', async () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 240_000, 960_000, 3_840_000]);
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    const failing = fakeFetch(() => new Error('ECONNRESET'));
    await emitWebhooks(
      db,
      hook,
      'gap.created',
      { id: 'gap_s' },
      { fetch: failing.fetch, now: at(0) },
    );

    let minute = 0;
    for (let tries = 2; tries <= MAX_ATTEMPTS; tries++) {
      minute += 200;
      const result = await retryWebhooks(db, hook, { fetch: failing.fetch, now: at(minute) });
      expect(result.attempted).toBe(1);
    }
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, next_attempt_at: null });
    const after = await retryWebhooks(db, hook, {
      fetch: failing.fetch,
      now: at(10_000),
      force: true,
    });
    expect(after.attempted).toBe(0);
  });

  it('retries early when forced, rides along with the next emit, and gives up on a removed webhook', async () => {
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    const failing = fakeFetch(() => new Response('no', { status: 500 }));
    await emitWebhooks(
      db,
      hook,
      'gap.created',
      { id: 'gap_t' },
      { fetch: failing.fetch, now: at(0) },
    );

    const forced = await retryWebhooks(db, hook, { fetch: failing.fetch, now: at(0), force: true });
    expect(forced).toMatchObject({ attempted: 1, failed: 1 });

    // The next event delivers itself and the retry that is now due.
    const working = fakeFetch(() => new Response('ok'));
    await emitWebhooks(
      db,
      hook,
      'roadmap.idea',
      { id: 'rmp_1' },
      { fetch: working.fetch, now: at(30) },
    );
    expect(working.calls.map((c) => c.headers.get('x-helpwell-event'))).toEqual([
      'roadmap.idea',
      'gap.created',
    ]);

    await emitWebhooks(
      db,
      hook,
      'gap.created',
      { id: 'gap_u' },
      { fetch: failing.fetch, now: at(40) },
    );
    const elsewhere = parseSettings({ webhooks: [{ url: 'https://other.test' }] });
    const removed = await retryWebhooks(db, elsewhere, { fetch: failing.fetch, now: at(100) });
    expect(removed).toMatchObject({ attempted: 0, gaveUp: 1 });
  });

  it('sends a test delivery to every active webhook, whatever it subscribes to, without retrying', async () => {
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    const mixed = fakeFetch((url) =>
      url.includes('b.test') ? new Response('ok') : new Response('no', { status: 500 }),
    );
    const results = await sendTestWebhook(db, settings, { fetch: mixed.fetch });
    expect(results.map((r) => [r.url, r.status, r.nextAttemptAt])).toEqual([
      ['https://a.test/all', 'failed', null],
      ['https://b.test/gaps', 'delivered', null],
    ]);
    expect(JSON.parse(mixed.calls[0]!.body)).toMatchObject({ event: 'webhook.test' });
    expect(await listDeliveries(db, { status: 'retrying' })).toHaveLength(0);
    expect(await listDeliveries(db)).toHaveLength(2);
  });
});

/* ------------------------------------------------------ where events fire */

describe('events raised by the rest of HelpWell', () => {
  const received: { event: string; data: Record<string, unknown> }[] = [];
  const names = () => received.map((r) => r.event);
  const base = {
    collection: 'billing',
    description: null,
    headings: [],
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    await db.execute(sql`DELETE FROM helpwell.webhook_deliveries`);
    await new SettingsStore(db).update({
      webhooks: [{ url: 'https://events.test/in', events: [], secret: '', active: true }],
    });
    // These tests catch deliveries on a stand-in global fetch, so the guard,
    // which connects for itself, is off: the local-development switch.
    vi.stubEnv('HELPWELL_WEBHOOK_GUARD', 'off');
    vi.stubGlobal('fetch', (async (_url: string, init?: RequestInit) => {
      received.push(JSON.parse(String(init?.body)));
      return new Response('ok');
    }) as typeof fetch);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('a chat raises conversation.created and message.created for both sides; ratings raise feedback.created', async () => {
    await indexArticles(db, [
      {
        ...base,
        slug: 'billing/invoices',
        title: 'Exporting invoices',
        body: 'Open Billing, choose Invoices, then press Export.',
        status: 'published',
        path: 'billing/invoices.md',
        contentHash: 'h1',
      },
    ]);
    const handler = createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      secureCookies: false,
      model: new FakeModel([{ text: 'Open Billing, then Invoices.' }]),
    });
    const browser = client(handler);
    received.length = 0;

    const reply = (await (
      await browser.call('/chat', { body: { message: 'How do I export invoices?' } })
    ).json()) as { conversationId: string; messageId: string };
    expect(names()).toEqual(['conversation.created', 'message.created', 'message.created']);
    expect(received[1]!.data).toMatchObject({
      role: 'customer',
      body: 'How do I export invoices?',
    });
    expect(received[2]!.data).toMatchObject({ role: 'agent', id: reply.messageId });

    received.length = 0;
    await browser.call(`/messages/${reply.messageId}/feedback`, { body: { feedback: 'helpful' } });
    await browser.call(`/conversations/${reply.conversationId}/rating`, {
      body: { rating: 'love' },
    });
    await browser.call('/articles/billing/invoices/rating', { body: { value: 'up' } });
    expect(received.map((r) => [r.event, r.data.kind])).toEqual([
      ['feedback.created', 'message'],
      ['feedback.created', 'conversation'],
      ['feedback.created', 'article'],
    ]);
  });

  it('publishing a changelog entry raises changelog.published once', async () => {
    received.length = 0;
    const draft = await createChangelogEntry(db, { title: 'Dark mode' });
    await updateChangelogEntry(db, draft, { status: 'published' });
    await updateChangelogEntry(db, draft, { status: 'published', title: 'Dark mode, everywhere' });
    await createChangelogEntry(db, { title: 'Straight out', status: 'published' });
    expect(received.map((r) => [r.event, r.data.title])).toEqual([
      ['changelog.published', 'Dark mode'],
      ['changelog.published', 'Straight out'],
    ]);
  });

  it('an article going live on a later sync raises article.published; an edit does not', async () => {
    const invoices = {
      ...base,
      slug: 'billing/invoices',
      title: 'Exporting invoices',
      body: 'Edited.',
      status: 'published' as const,
      path: 'billing/invoices.md',
      contentHash: 'h2',
    };
    const refunds = {
      ...base,
      slug: 'billing/refunds',
      title: 'Refunds',
      path: 'billing/refunds.md',
    };
    received.length = 0;
    await indexArticles(db, [
      invoices,
      { ...refunds, body: 'Soon.', status: 'draft', contentHash: 'r1' },
    ]);
    expect(names()).toEqual([]);
    await indexArticles(db, [
      invoices,
      { ...refunds, body: 'Now.', status: 'published', contentHash: 'r2' },
    ]);
    expect(received.map((r) => [r.event, r.data.slug])).toEqual([
      ['article.published', 'billing/refunds'],
    ]);
  });

  it('a survey answer raises survey.response with exactly the documented keys', async () => {
    const handler = createHelpWellHandler({ db, basePath: '/api/helpwell', secureCookies: false });
    received.length = 0;
    const answered = await client(handler).call('/surveys/nps-q3/response', {
      body: { kind: 'nps', score: 9, comment: 'Fast answers.', session: 's1', questionId: 'q1' },
    });
    expect(answered.status).toBe(201);
    expect(names()).toEqual(['survey.response']);
    const data = received[0]!.data;
    // The example receivers are written against has to be the payload itself.
    expect(Object.keys(data)).toEqual(Object.keys(WEBHOOK_EXAMPLES['survey.response']));
    expect(data).toMatchObject({
      surveyId: 'nps-q3',
      sessionId: 's1',
      questionId: 'q1',
      kind: 'nps',
      score: 9,
      choice: null,
      choices: null,
      comment: 'Fast answers.',
    });
  });
});
