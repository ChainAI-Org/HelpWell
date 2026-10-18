/**
 * The remote support extension and the fail-open wrapper around every
 * extension.
 *
 * A fake remote service answers the protocol's actions over a fake fetch, so
 * each action is checked end to end through the real handler: what is sent,
 * with which token, and what the widget gets back. Then the ways a remote
 * fails (a 500, a timeout, a body that is not JSON, a refusal, a 429) are
 * each shown to leave the AI answering, and the circuit breaker, the pause
 * after a 429 and the durable retry queue are shown to do what they say.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { createContentSync } from '../src/api/content-sync.js';
import { failOpenSupport, HANDOFF_UNAVAILABLE } from '../src/api/fail-open.js';
import {
  checkRemoteSupport,
  createRemoteSupportExtension,
  type RemoteSupportExtension,
  rateLimitPause,
  remoteSupportPromptSpec,
  SupportUnavailableError,
  supportSnapshot,
} from '../src/api/remote-extension.js';
import type { ContentManifest, SupportExtension } from '../src/api/support-extension.js';
import { pendingRetries } from '../src/api/support-retries.js';
import { resolveSupport } from '../src/api/support-setup.js';
import { createHelpWellHandler, type HelpWellConfig, type HelpWellHandler } from '../src/api.js';
import type { Db } from '../src/db/client.js';
import { rowsOf } from '../src/db/rows.js';
import { HelpWellError } from '../src/errors.js';
import { SettingsStore } from '../src/settings/store.js';
import { formatSetupPrompt } from '../src/setup-prompt.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const URL_BASE = 'https://support.example.com/api';
const PRODUCT = 'prod_42';
const TOKEN = 'tok_secret_value';
const ANSWER = 'Open Billing, then Invoices.';

type Body = Record<string, unknown>;
type Answer = Body | Response | Promise<Body | Response>;
type ActionHandler = (body: Body, init: RequestInit) => Answer;

interface Call {
  action: string;
  body: Body;
  auth: string | null;
  url: string;
  redirect: RequestRedirect | undefined;
  headers: Headers;
  /** The raw bytes, for the one action that is not JSON (`upload`). */
  bytes?: Uint8Array;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DEFAULTS: Record<string, ActionHandler> = {
  sync: () => ({ handled: true, ticketId: 't_1' }),
  message: () => ({ handled: false, reason: 'ai' }),
  thread: () => ({ handled: false, reason: 'not_found' }),
  handoff: () => ({ handled: true }),
  seen: () => ({ handled: true }),
  playbook: () => ({ handled: true, text: 'Refunds take five working days.' }),
  proactive: () => ({ handled: true, items: [] }),
  'proactive-event': () => ({ handled: true }),
};

/** A service implementing the protocol, whose answers each test can change. */
function fakeRemote(overrides: Record<string, ActionHandler> = {}) {
  const handlers: Record<string, ActionHandler> = { ...DEFAULTS, ...overrides };
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const action = /\/bridge\/[^/]+\/([^/]+)$/.exec(new URL(url).pathname)?.[1] ?? '';
    const bytes = init.body instanceof Uint8Array ? init.body : undefined;
    const body = bytes ? {} : (JSON.parse(String(init.body ?? '{}')) as Body);
    calls.push({
      action,
      body,
      auth: new Headers(init.headers).get('authorization'),
      url,
      redirect: init.redirect,
      headers: new Headers(init.headers),
      ...(bytes ? { bytes } : {}),
    });
    const handler = handlers[action];
    if (!handler)
      return jsonResponse({ error: { code: 'not_found', message: 'Unknown action.' } }, 404);
    const answer = await handler(body, init);
    return answer instanceof Response ? answer : jsonResponse(answer);
  });
  return {
    fetch: fetchImpl as unknown as typeof fetch,
    fetchMock: fetchImpl,
    calls,
    of: (action: string) => calls.filter((call) => call.action === action),
    set(action: string, handler: ActionHandler) {
      handlers[action] = handler;
    },
  };
}

type FakeRemote = ReturnType<typeof fakeRemote>;

const silent = { warn: vi.fn() };

let t: TestDb;
let db: Db;
let handler: HelpWellHandler;
let visitor: Client;
let model: FakeModel;
let remote: FakeRemote;
let extension: RemoteSupportExtension;

function remoteExtension(
  options: Partial<Parameters<typeof createRemoteSupportExtension>[0]> = {},
) {
  return createRemoteSupportExtension({
    url: URL_BASE,
    product: PRODUCT,
    token: TOKEN,
    db,
    fetch: remote.fetch,
    logger: silent,
    ...options,
  });
}

function setup(config: Partial<HelpWellConfig> = {}, support?: SupportExtension): void {
  model = new FakeModel([{ text: ANSWER }]);
  extension = remoteExtension();
  handler = createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    secureCookies: false,
    model,
    support: support ?? failOpenSupport(extension, { db, logger: silent }),
    ...config,
  });
  visitor = client(handler);
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function chat(message: string, extra: Body = {}): Promise<Response> {
  return visitor.call('/chat', { body: { message, ...extra } });
}

async function startConversation(): Promise<string> {
  const response = await chat('How do I export invoices?');
  expect(response.status).toBe(200);
  return (await body<{ conversationId: string }>(response)).conversationId;
}

beforeEach(async () => {
  t = await freshDb();
  db = t.db;
  remote = fakeRemote();
  silent.warn.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await t.close();
});

/* ---------------------------------------------------------- configuration */

describe('connecting', () => {
  it('insists on https, except on this machine', () => {
    expect(() => remoteExtension({ url: 'http://support.example.com/api' })).toThrow(/https/);
    expect(() => remoteExtension({ url: 'ftp://support.example.com' })).toThrow(/https/);
    expect(() => remoteExtension({ url: 'https://user:pw@support.example.com' })).toThrow(
      /HELPWELL_SUPPORT_TOKEN/,
    );
    expect(() => remoteExtension({ url: 'http://localhost:4000/api' })).not.toThrow();
    expect(() => remoteExtension({ url: 'http://127.0.0.1:4000' })).not.toThrow();
  });

  it('needs a product and a token', () => {
    expect(() => remoteExtension({ product: ' ' })).toThrow(/product/);
    expect(() => remoteExtension({ token: '' })).toThrow(/token/);
  });

  it('reads the three environment variables, and says which is missing', () => {
    const env = {
      HELPWELL_SUPPORT_URL: URL_BASE,
      HELPWELL_SUPPORT_PRODUCT: PRODUCT,
      HELPWELL_SUPPORT_TOKEN: TOKEN,
    };
    const logger = { warn: vi.fn() };
    expect(resolveSupport({ db }, { env, logger })).toBeDefined();
    expect(resolveSupport({ db, support: false }, { env, logger })).toBeUndefined();

    expect(
      resolveSupport({ db }, { env: { ...env, HELPWELL_SUPPORT_TOKEN: '' }, logger }),
    ).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('HELPWELL_SUPPORT_TOKEN'));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TOKEN);

    logger.warn.mockClear();
    expect(
      resolveSupport(
        { db },
        { env: { ...env, HELPWELL_SUPPORT_URL: 'http://support.example.com' }, logger },
      ),
    ).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('https'));
    expect(resolveSupport({ db }, { env: {}, logger })).toBeUndefined();
  });

  it('takes { url, product, token } in code, and throws at startup when it is wrong', () => {
    expect(
      resolveSupport({ db, support: { url: URL_BASE, product: PRODUCT, token: TOKEN } }),
    ).toBeDefined();
    expect(() =>
      resolveSupport({ db, support: { url: 'http://x.example', product: PRODUCT, token: TOKEN } }),
    ).toThrow(/https/);
  });

  it('checks a connection in plain words, never sending the token anywhere but the URL', async () => {
    const ok = await checkRemoteSupport({
      url: URL_BASE,
      product: PRODUCT,
      token: TOKEN,
      fetch: remote.fetch,
    });
    expect(ok).toMatchObject({ ok: true, status: 200, message: 'Connected.' });
    expect(remote.calls[0]).toMatchObject({
      action: 'playbook',
      url: `${URL_BASE}/bridge/${PRODUCT}/playbook`,
      auth: `Bearer ${TOKEN}`,
      redirect: 'error',
    });

    remote.set('playbook', () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401),
    );
    const refused = await checkRemoteSupport({
      url: URL_BASE,
      product: PRODUCT,
      token: TOKEN,
      fetch: remote.fetch,
    });
    expect(refused).toMatchObject({ ok: false, status: 401 });
    expect(refused.message).toMatch(/token was refused/);

    const insecure = await checkRemoteSupport({
      url: 'http://x.example',
      product: PRODUCT,
      token: TOKEN,
    });
    expect(insecure.ok).toBe(false);
    expect(insecure.message).toMatch(/https/);
  });

  it('writes a setup prompt with the real values and no token', () => {
    const prompt = formatSetupPrompt(
      remoteSupportPromptSpec({ productName: 'Acme', url: URL_BASE, product: PRODUCT }),
    );
    expect(prompt).toContain('HELPWELL_SUPPORT_URL');
    expect(prompt).toContain(`${URL_BASE}/bridge/${PRODUCT}/playbook`);
    expect(prompt).toContain('Never ask me to paste');
    expect(prompt).not.toContain(TOKEN);
  });
});

/* ------------------------------------------------------------- round trips */

describe('every action round-trips', () => {
  beforeEach(() => setup());

  it('mirrors a conversation after the AI answers, with confidence on each answer', async () => {
    const id = await startConversation();
    const syncs = remote.of('sync');
    expect(syncs).toHaveLength(1);
    expect(syncs[0]?.auth).toBe(`Bearer ${TOKEN}`);
    const snapshot = syncs[0]?.body as {
      sourceId: string;
      subject: string;
      unresolved: boolean;
      contact: { sourceId: string };
      messages: { kind: string; body: string; confidence?: number; confidenceReason?: string }[];
    };
    expect(snapshot.sourceId).toBe(id);
    expect(snapshot.subject).toBe('How do I export invoices?');
    expect(snapshot.contact.sourceId).toMatch(/^con_/);
    expect(snapshot.messages.map((m) => m.kind)).toEqual(['customer', 'ai']);
    const answer = snapshot.messages[1]!;
    expect(answer.body).toBe(ANSWER);
    expect(typeof answer.confidence).toBe('number');
    expect(answer.confidence).toBeGreaterThanOrEqual(0);
    expect(answer.confidence).toBeLessThanOrEqual(1);
    expect(typeof answer.confidenceReason).toBe('string');
    expect(snapshot.messages[0]).not.toHaveProperty('confidence');
  });

  it('passes the AI the approved playbook, and reuses it for a minute', async () => {
    await startConversation();
    await chat('And credit notes?');
    expect(remote.of('playbook')).toHaveLength(1);
    const system = String(model.requests[0]?.messages[0]?.content ?? '');
    expect(system).toContain('Refunds take five working days.');
  });

  it('sends a follow-up with its requestId, and a person taking it keeps the AI quiet', async () => {
    const id = await startConversation();
    remote.set('message', () => ({
      handled: true,
      message: { id: 'rm_1', createdAt: new Date().toISOString() },
    }));
    const response = await chat('Are you there?', {
      conversationId: id,
      requestId: 'req_12345678',
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ pendingHuman: true, conversationId: id });
    expect(remote.of('message')[0]?.body).toEqual({
      sourceId: id,
      message: 'Are you there?',
      requestId: 'req_12345678',
    });
    expect(model.requests).toHaveLength(1);
  });

  it('drops a requestId that is not one', async () => {
    const id = await startConversation();
    await chat('Again', { conversationId: id, requestId: '<script>' });
    expect(remote.of('message')[0]?.body).not.toHaveProperty('requestId');
  });

  it("shows the service's transcript, keeping HelpWell's ids on AI answers", async () => {
    const id = await startConversation();
    const [agent] = rowsOf<{ id: string }>(
      await db.execute(
        sql`SELECT id FROM helpwell.messages WHERE conversation_id = ${id} AND role = 'agent'`,
      ),
    );
    await db.execute(
      sql`UPDATE helpwell.messages SET feedback = 'helpful' WHERE id = ${agent!.id}`,
    );
    remote.set('thread', () => ({
      handled: true,
      ticket: { id: 't_1', status: 'open', mode: 'human' },
      messages: [
        {
          id: 'r1',
          kind: 'customer',
          body: 'How do I export invoices?',
          citations: [],
          created_at: '2026-09-23T10:00:00Z',
          author_name: null,
        },
        {
          id: 'r2',
          kind: 'ai',
          source_id: agent!.id,
          body: ANSWER,
          citations: [],
          created_at: '2026-09-23T10:00:01Z',
          author_name: null,
        },
        {
          id: 'r3',
          kind: 'note',
          body: 'internal only',
          citations: [],
          created_at: '2026-09-23T10:00:02Z',
        },
        {
          id: 'r4',
          kind: 'human',
          body: 'Maya here.',
          citations: [],
          created_at: '2026-09-23T10:00:03Z',
          author_name: 'Maya',
        },
      ],
    }));
    const thread = await body<{
      mode: string;
      messages: { id: string; role: string; feedback: string | null; authorName?: string }[];
    }>(await visitor.call(`/conversations/${id}`));
    expect(thread.mode).toBe('human');
    expect(thread.messages.map((m) => [m.id, m.role])).toEqual([
      ['r1', 'customer'],
      [agent!.id, 'agent'],
      ['r4', 'human'],
    ]);
    expect(thread.messages[1]?.feedback).toBe('helpful');
    expect(thread.messages[2]?.authorName).toBe('Maya');
    expect(remote.of('thread')[0]?.body).toEqual({ sourceId: id });
  });

  it('mirrors before handing off, and passes read receipts through', async () => {
    const id = await startConversation();
    const response = await visitor.call(`/conversations/${id}/handoff`, { body: {} });
    expect(response.status).toBe(200);
    const order = remote.calls.map((c) => c.action).filter((a) => a === 'sync' || a === 'handoff');
    expect(order.slice(-2)).toEqual(['sync', 'handoff']);
    expect(remote.of('handoff')[0]?.body).toEqual({ sourceId: id });

    const seenId = '6f1c1c52-8f5d-4b61-9d2f-0a4f8e1d2c3b';
    const seen = await visitor.call(`/conversations/${id}/seen`, {
      body: { messageIds: [seenId] },
    });
    expect(seen.status).toBe(200);
    expect(remote.of('seen')[0]?.body).toEqual({ sourceId: id, messageIds: [seenId] });
  });

  it('mirrors again when the visitor leaves an email', async () => {
    const id = await startConversation();
    const before = remote.of('sync').length;
    await visitor.call(`/conversations/${id}/contact`, { body: { email: 'ada@example.com' } });
    const syncs = remote.of('sync');
    expect(syncs).toHaveLength(before + 1);
    const last = syncs.at(-1)?.body as { contact: { email: string } } | undefined;
    expect(last?.contact.email).toBe('ada@example.com');
  });

  it('asks for proactive items with who and where, and reports what the visitor did', async () => {
    remote.set('proactive', () => ({
      handled: true,
      items: [
        {
          kind: 'chat',
          id: 'hello_1',
          sender: { name: 'Maya', isAgent: false },
          blocks: [{ type: 'text', markdown: 'Need a hand with billing?' }],
          replyable: true,
        },
      ],
    }));
    const response = await visitor.call('/proactive?path=/billing&anon=browser_abc123');
    const list = await body<{ items: { id: string }[] }>(response);
    expect(list.items.map((i) => i.id)).toEqual(['hello_1']);
    expect(remote.of('proactive')[0]?.body).toEqual({
      contactSourceId: null,
      anonymousId: 'browser_abc123',
      path: '/billing',
      identified: false,
    });

    await visitor.call('/proactive/hello_1/events', {
      body: { event: 'seen', anon: 'browser_abc123' },
    });
    expect(remote.of('proactive-event')[0]?.body).toEqual({
      id: 'hello_1',
      event: 'seen',
      contactSourceId: expect.stringMatching(/^con_/),
      anonymousId: 'browser_abc123',
    });
  });

  it('stops asking for an action the service does not have, for a while', async () => {
    remote.set('proactive', () => jsonResponse({ error: { code: 'not_found' } }, 404));
    const context = {
      contactId: null,
      anonymousId: 'browser_abc123',
      path: '/',
      identified: false,
    };
    expect(await extension.proactive!(context)).toEqual([]);
    expect(await extension.proactive!(context)).toEqual([]);
    expect(remote.of('proactive')).toHaveLength(1);
  });

  it('snapshots a conversation the way the protocol takes it', async () => {
    const id = await startConversation();
    await db.execute(sql`UPDATE helpwell.contacts SET email = 'not an address' WHERE id = (
      SELECT contact_id FROM helpwell.conversations WHERE id = ${id})`);
    const snapshot = await supportSnapshot(db, id);
    expect(snapshot?.contact.email).toBeNull();
    expect(await supportSnapshot(db, 'cnv_missing')).toBeNull();
  });
});

/* -------------------------------------------------------------- fail open */

describe('failing open', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setup();
  });

  const failures: [string, ActionHandler][] = [
    [
      'a 500',
      () => jsonResponse({ handled: false, retryable: true, error: { code: 'unavailable' } }, 500),
    ],
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    [
      'a timeout',
      (_body, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ],
  ];

  for (const [name, failure] of failures) {
    it(`answers with the AI when the service's message action fails with ${name}`, async () => {
      extension = remoteExtension({ timeouts: { message: 50 } });
      handler = createHelpWellHandler({
        db,
        secureCookies: false,
        model,
        support: failOpenSupport(extension, { db, logger: silent }),
      });
      visitor = client(handler);
      const id = await startConversation();
      remote.set('message', failure);
      const response = await chat('Still there?', { conversationId: id });
      expect(response.status).toBe(200);
      const reply = await body<{ text: string; pendingHuman?: boolean }>(response);
      expect(reply.text).toBe(ANSWER);
      expect(reply.pendingHuman).toBeUndefined();
      expect(silent.warn).toHaveBeenCalled();
    });
  }

  it('shows HelpWell’s own transcript when the thread cannot be fetched', async () => {
    const id = await startConversation();
    remote.set('thread', () => jsonResponse({}, 503));
    const thread = await body<{ messages: { body: string }[] }>(
      await visitor.call(`/conversations/${id}`),
    );
    expect(thread.messages.map((m) => m.body)).toEqual(['How do I export invoices?', ANSWER]);
  });

  it('answers without the playbook when it cannot be fetched', async () => {
    remote.set('playbook', () => jsonResponse({}, 500));
    const response = await chat('Hello?');
    expect(response.status).toBe(200);
    expect((await body<{ text: string }>(response)).text).toBe(ANSWER);
  });

  it('tells the visitor the team could not be reached when a handoff fails', async () => {
    const id = await startConversation();
    remote.set('handoff', () => jsonResponse({}, 502));
    const response = await visitor.call(`/conversations/${id}/handoff`, { body: {} });
    expect(response.status).toBe(502);
    expect((await body<{ error: { message: string } }>(response)).error.message).toBe(
      HANDOFF_UNAVAILABLE,
    );
  });

  it('never fails the chat when mirroring fails, and queues the mirror', async () => {
    remote.set('sync', () => jsonResponse({}, 503));
    const response = await chat('Hi');
    expect(response.status).toBe(200);
    const { conversationId } = await body<{ conversationId: string }>(response);
    expect((await pendingRetries(db)).map((r) => [r.kind, r.key])).toEqual([
      ['after_reply', conversationId],
    ]);
  });

  it('does not queue what the service refused: a resend would be refused too', async () => {
    remote.set('sync', () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'bad token' } }, 401),
    );
    expect((await chat('Hi')).status).toBe(200);
    expect(await pendingRetries(db)).toEqual([]);
    expect(silent.warn).toHaveBeenCalledWith(
      expect.stringContaining('refused sync'),
      expect.anything(),
    );
  });

  it('keeps presence, typing and proactive quiet when an in-process extension throws', async () => {
    const boom = async () => {
      throw new Error('boom');
    };
    const support: SupportExtension = {
      afterReply: async () => {},
      handleMessage: async () => null,
      handoff: async () => {},
      thread: async () => null,
      typing: boom,
      presence: boom,
      proactive: boom,
      proactiveEvent: boom,
    };
    setup({ support });
    const id = await startConversation();
    expect(
      (await visitor.call(`/conversations/${id}/typing`, { body: { typing: true } })).status,
    ).toBe(204);
    expect(await body(await visitor.call(`/conversations/${id}/presence`))).toEqual({
      typing: null,
    });
    expect(await body(await visitor.call('/proactive?path=/'))).toEqual({ items: [] });
  });

  it('answers with the AI when an in-process handleMessage throws or returns junk', async () => {
    let mode: 'throw' | 'junk' = 'throw';
    setup({
      support: {
        afterReply: async () => {},
        handleMessage: async () => {
          if (mode === 'throw') throw new Error('database down');
          return { nonsense: true } as never;
        },
        handoff: async () => {},
        thread: async () => null,
      },
    });
    expect((await body<{ text: string }>(await chat('One'))).text).toBe(ANSWER);
    mode = 'junk';
    expect((await body<{ text: string }>(await chat('Two'))).text).toBe(ANSWER);
  });
});

/* --------------------------------------------------------------- ownership */

describe('ownership still refuses', () => {
  beforeEach(() => setup());

  it('refuses another visitor on a handoff before the service is asked', async () => {
    const id = await startConversation();
    const stranger = client(handler);
    await stranger.call('/chat', { body: { message: 'hi' } });
    const response = await stranger.call(`/conversations/${id}/handoff`, { body: {} });
    expect(response.status).toBe(403);
    expect(remote.of('handoff')).toHaveLength(0);
  });

  it('checks ownership itself, locally, before sending a message', async () => {
    const id = await startConversation();
    await expect(
      extension.handleMessage({ message: 'hi', conversationId: id, contactId: 'con_someone_else' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(remote.of('message')).toHaveLength(0);
  });

  it("lets an extension's ownership refusal through the wrapper as a 403", async () => {
    setup({
      support: {
        afterReply: async () => {},
        handleMessage: async () => {
          throw new HelpWellError('forbidden', 'This is not your conversation.');
        },
        handoff: async () => {},
        thread: async () => null,
      },
    });
    const response = await chat('hello');
    expect(response.status).toBe(403);
    expect((await body<{ error: { message: string } }>(response)).error.message).toBe(
      'That conversation is not available.',
    );
  });
});

/* ------------------------------------------------------- circuit breaker */

describe('the circuit breaker', () => {
  it('opens after three failures in a row and lets a call through again after 60 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    remote.set('playbook', () => jsonResponse({}, 500));
    const ext = remoteExtension();

    for (let i = 0; i < 3; i++)
      await expect(ext.playbook!()).rejects.toThrow(SupportUnavailableError);
    expect(remote.of('playbook')).toHaveLength(3);
    expect(ext.circuitOpen).toBe(true);

    await expect(ext.playbook!()).rejects.toMatchObject({ circuitOpen: true });
    expect(remote.of('playbook')).toHaveLength(3);

    vi.advanceTimersByTime(59_000);
    await expect(ext.playbook!()).rejects.toMatchObject({ circuitOpen: true });
    expect(remote.of('playbook')).toHaveLength(3);

    vi.advanceTimersByTime(1_001);
    remote.set('playbook', () => ({ handled: true, text: 'Back.' }));
    expect(ext.circuitOpen).toBe(false);
    expect(await ext.playbook!()).toBe('Back.');
    expect(remote.of('playbook')).toHaveLength(4);
  });

  it('does not count a refusal as a failure', async () => {
    remote.set('playbook', () => jsonResponse({ error: { code: 'unauthorized' } }, 401));
    const ext = remoteExtension();
    for (let i = 0; i < 5; i++) expect(await ext.playbook!()).toBe('');
    expect(remote.of('playbook')).toHaveLength(5);
    expect(ext.circuitOpen).toBe(false);
  });

  it('serves the last good playbook while the service is away', async () => {
    let clock = 1_000_000;
    const ext = remoteExtension({ now: () => clock });
    expect(await ext.playbook!()).toBe('Refunds take five working days.');
    remote.set('playbook', () => jsonResponse({}, 500));
    clock += 61_000;
    expect(await ext.playbook!()).toBe('Refunds take five working days.');
  });
});

/* ------------------------------------------------------------- rate limit */

/** The service's answer over its request limit, as a support service gives it. */
function limited(retryAfter: string | null): ActionHandler {
  return () =>
    new Response(
      JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests.' } }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          ...(retryAfter === null ? {} : { 'retry-after': retryAfter }),
        },
      },
    );
}

describe('a 429 from the service', () => {
  it('pauses every call for its Retry-After, logging once, then lets them through', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const logger = { warn: vi.fn() };
    remote.set('playbook', limited('2'));
    remote.set('presence', () => ({ handled: true, presence: { typing: null } }));
    const ext = remoteExtension({ logger });

    await expect(ext.playbook!()).rejects.toMatchObject({
      name: 'SupportUnavailableError',
      status: 429,
      rateLimited: true,
      retryInMs: 2_000,
    });
    expect(remote.calls).toHaveLength(1);
    expect(ext.rateLimited).toBe(true);
    expect(ext.circuitOpen).toBe(false);

    // During the pause nothing reaches the service, whatever the action.
    vi.advanceTimersByTime(1_900);
    await expect(ext.playbook!()).rejects.toMatchObject({ rateLimited: true, retryInMs: 100 });
    await expect(ext.presence!('cnv_1')).rejects.toMatchObject({ rateLimited: true });
    await expect(ext.thread('cnv_1')).rejects.toMatchObject({ rateLimited: true });
    expect(await ext.ping()).toMatchObject({ ok: false, status: 429 });
    expect(remote.calls).toHaveLength(1);
    // One line for the pause, not one per call.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(
      /slow down \(429 to playbook\); no calls for 2 seconds/,
    );

    vi.advanceTimersByTime(100);
    expect(ext.rateLimited).toBe(false);
    remote.set('playbook', () => ({ handled: true, text: 'Back.' }));
    expect(await ext.playbook!()).toBe('Back.');
    expect(await ext.presence!('cnv_1')).toEqual({ typing: null });
    expect(remote.calls.map((call) => call.action)).toEqual(['playbook', 'playbook', 'presence']);
  });

  it('logs one pause when several calls in flight are all turned away', async () => {
    const logger = { warn: vi.fn() };
    remote.set('playbook', limited('30'));
    remote.set('presence', limited('45'));
    const ext = remoteExtension({ logger });
    const results = await Promise.allSettled([
      ext.playbook!(),
      ext.presence!('cnv_1'),
      ext.presence!('cnv_2'),
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(remote.calls).toHaveLength(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // The longest wait any of them was told is the one kept.
    await expect(ext.playbook!()).rejects.toMatchObject({ rateLimited: true });
    expect(
      ((await ext.playbook!().catch((error: unknown) => error)) as { retryInMs: number }).retryInMs,
    ).toBeGreaterThan(44_000);
  });

  it('caps the wait at five minutes, reads a date, and waits a minute when told nothing', async () => {
    let clock = 1_000_000;
    remote.set('playbook', limited('86400'));
    const ext = remoteExtension({ now: () => clock });
    await expect(ext.playbook!()).rejects.toMatchObject({ retryInMs: 300_000 });
    clock += 299_999;
    await expect(ext.playbook!()).rejects.toMatchObject({ rateLimited: true });
    expect(remote.calls).toHaveLength(1);
    clock += 1;
    await expect(ext.playbook!()).rejects.toMatchObject({ retryInMs: 300_000 });
    expect(remote.calls).toHaveLength(2);

    const now = Date.parse('2026-09-23T10:00:00Z');
    expect(rateLimitPause('2', now)).toBe(2_000);
    expect(rateLimitPause('Wed, 23 Sep 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(rateLimitPause('Wed, 23 Sep 2026 12:00:00 GMT', now)).toBe(300_000);
    expect(rateLimitPause(null, now)).toBe(60_000);
    expect(rateLimitPause('soon', now)).toBe(60_000);
    // Never a loop: "now" or a time already past is a second.
    expect(rateLimitPause('0', now)).toBe(1_000);
    expect(rateLimitPause('Wed, 23 Sep 2026 09:00:00 GMT', now)).toBe(1_000);
  });

  it('is not a failure: it neither opens the circuit nor resets its count', async () => {
    let clock = 1_000_000;
    const ext = remoteExtension({ now: () => clock });
    remote.set('playbook', () => jsonResponse({}, 500));
    for (let i = 0; i < 2; i++)
      await expect(ext.playbook!()).rejects.toMatchObject({ status: 500 });

    for (let i = 0; i < 5; i++) {
      remote.set('playbook', limited('1'));
      await expect(ext.playbook!()).rejects.toMatchObject({ rateLimited: true });
      expect(ext.circuitOpen).toBe(false);
      clock += 1_000;
    }

    // The third failure in a row is still the third, and opens the circuit.
    remote.set('playbook', () => jsonResponse({}, 500));
    await expect(ext.playbook!()).rejects.toMatchObject({ status: 500 });
    expect(ext.circuitOpen).toBe(true);
  });

  it('fails open through the wrapper: the mirror waits in the queue at no cost, reads carry on', async () => {
    const start = new Date('2026-09-23T10:00:00Z');
    let clock = start;
    remote.set('sync', limited('120'));
    const ext = remoteExtension({ now: () => clock.getTime() });
    const wrapped = failOpenSupport(ext, { db, logger: silent, now: () => clock });
    setup({}, wrapped);

    // The visitor's answer is the AI's, as ever; the mirror is queued.
    const id = await startConversation();
    // Let any drain the chat's successful calls started finish first.
    await wrapped.drainRetries();
    const [row] = await pendingRetries(db);
    expect(row).toMatchObject({ kind: 'after_reply', key: id, attempts: 0 });
    expect(remote.of('sync')).toHaveLength(1);

    // Reads fail open exactly as in an outage, and reach nobody.
    const calls = remote.calls.length;
    expect(await wrapped.thread(id)).toBeNull();
    expect(await wrapped.presence!(id)).toEqual({ typing: null });
    expect(remote.calls).toHaveLength(calls);

    // A replay during the pause is not sent and not held against the row:
    // it waits for the end of the pause.
    clock = new Date(start.getTime() + 31_000);
    expect(await wrapped.drainRetries()).toBe(0);
    const [waiting] = await pendingRetries(db);
    expect(waiting?.attempts).toBe(0);
    expect(waiting?.nextAttemptAt.getTime()).toBe(start.getTime() + 120_000);
    expect(remote.of('sync')).toHaveLength(1);

    // After it, the mirror goes.
    clock = new Date(start.getTime() + 120_000);
    remote.set('sync', () => ({ handled: true, ticketId: 't_1' }));
    expect(await wrapped.drainRetries()).toBe(1);
    expect(await pendingRetries(db)).toEqual([]);
    expect(remote.of('sync')).toHaveLength(2);
  });

  it('is said in plain words by the connection check', async () => {
    remote.set('playbook', limited('90'));
    const check = await checkRemoteSupport({
      url: URL_BASE,
      product: PRODUCT,
      token: TOKEN,
      fetch: remote.fetch,
    });
    expect(check).toMatchObject({ ok: false, status: 429 });
    expect(check.message).toBe(
      'The service is limiting requests from this product right now. Try again in 90 seconds.',
    );
  });
});

/* ------------------------------------------------------------ retry queue */

describe('the retry queue', () => {
  it('replays a failed mirror once the service is back, with the latest snapshot', async () => {
    let clock = new Date('2026-09-23T10:00:00Z');
    remote.set('sync', () => jsonResponse({}, 503));
    const wrapped = failOpenSupport(remoteExtension(), { db, logger: silent, now: () => clock });
    setup({}, wrapped);

    const id = await startConversation();
    expect((await pendingRetries(db)).map((r) => r.key)).toEqual([id]);
    const failedSyncs = remote.of('sync').length;

    // Not due yet: the first retry waits half a minute.
    remote.set('sync', () => ({ handled: true, ticketId: 't_1' }));
    expect(await wrapped.drainRetries()).toBe(0);
    expect(remote.of('sync')).toHaveLength(failedSyncs);

    clock = new Date(clock.getTime() + 31_000);
    await vi.waitFor(async () => {
      await wrapped.drainRetries();
      expect(await pendingRetries(db)).toEqual([]);
    });
    const replayed = remote.of('sync').at(-1)?.body as { sourceId: string; messages: unknown[] };
    expect(replayed.sourceId).toBe(id);
    expect(replayed.messages).toHaveLength(2);
  });

  it('backs off after a failed replay, and an open circuit costs no attempt', async () => {
    let clock = new Date('2026-09-23T10:00:00Z');
    remote.set('sync', () => jsonResponse({}, 503));
    const ext = remoteExtension({ now: () => clock.getTime(), circuit: { cooldownMs: 300_000 } });
    const wrapped = failOpenSupport(ext, { db, logger: silent, now: () => clock });
    setup({}, wrapped);
    await startConversation();

    clock = new Date(clock.getTime() + 31_000);
    await wrapped.drainRetries();
    let [row] = await pendingRetries(db);
    expect(row?.attempts).toBe(1);
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(clock.getTime() + 50_000);

    // Two more failures open the circuit; the replay after that never
    // reaches the service, and is not held against it.
    await expect(ext.afterReply(row!.key)).rejects.toThrow();
    await expect(ext.afterReply(row!.key)).rejects.toThrow();
    expect(ext.circuitOpen).toBe(true);
    clock = new Date(clock.getTime() + 61_000);
    const calls = remote.of('sync').length;
    await wrapped.drainRetries();
    [row] = await pendingRetries(db);
    expect(row?.attempts).toBe(1);
    expect(remote.of('sync')).toHaveLength(calls);
  });

  it('queues read receipts and form submissions, and replays them', async () => {
    let clock = new Date('2026-09-23T10:00:00Z');
    let healthy = false;
    const seen = vi.fn(async () => {
      if (!healthy) throw new Error('down');
    });
    const forms = vi.fn(async (_submission: unknown) => {
      if (!healthy) throw new Error('down');
    });
    const inner = {
      afterReply: async () => {},
      handleMessage: async () => null,
      handoff: async () => {},
      thread: async () => null,
      markSeen: seen,
      formSubmitted: forms,
    } as SupportExtension;
    const wrapped = failOpenSupport(inner, { db, logger: silent, now: () => clock });

    await wrapped.markSeen!('cnv_1', 'con_1', ['m1', 'm2']);
    await (wrapped as unknown as { formSubmitted(s: unknown): Promise<void> }).formSubmitted({
      id: 'sub_1',
      email: 'ada@example.com',
    });
    expect((await pendingRetries(db)).map((r) => r.kind).sort()).toEqual([
      'form_submitted',
      'seen',
    ]);

    healthy = true;
    clock = new Date(clock.getTime() + 31_000);
    expect(await wrapped.drainRetries()).toBe(2);
    expect(seen).toHaveBeenLastCalledWith('cnv_1', 'con_1', ['m1', 'm2']);
    expect(forms).toHaveBeenLastCalledWith({ id: 'sub_1', email: 'ada@example.com' });
    expect(await pendingRetries(db)).toEqual([]);
  });
});

/* ------------------------------------------------- WP10a: the new actions */

async function ownerOf(conversationId: string): Promise<string> {
  const [row] = rowsOf<{ contact_id: string }>(
    await db.execute(
      sql`SELECT contact_id FROM helpwell.conversations WHERE id = ${conversationId}`,
    ),
  );
  return row!.contact_id;
}

describe('live support over the protocol', () => {
  beforeEach(() => setup());

  it('passes typing on, and never for someone else', async () => {
    remote.set('typing', () => ({ handled: true }));
    const id = await startConversation();
    const response = await visitor.call(`/conversations/${id}/typing`, {
      body: { typing: true },
    });
    expect(response.status).toBe(204);
    expect(remote.of('typing')[0]?.body).toEqual({ sourceId: id, typing: true });
    await expect(extension.typing!(id, 'con_someone_else', true)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(remote.of('typing')).toHaveLength(1);
  });

  it('shows presence as the service describes it, and nothing it cannot read', async () => {
    const id = await startConversation();
    remote.set('presence', () => ({
      handled: true,
      presence: {
        typing: { name: 'Maya' },
        seenUpTo: 'msg_1',
        notice: { text: 'We will email you the reply.', askEmail: true, extra: 1 },
      },
    }));
    expect(await body(await visitor.call(`/conversations/${id}/presence`))).toEqual({
      typing: { name: 'Maya' },
      seenUpTo: 'msg_1',
      notice: { text: 'We will email you the reply.', askEmail: true },
    });
    remote.set('presence', () => ({ handled: true, presence: { typing: 'yes' } }));
    expect(await extension.presence!(id)).toEqual({ typing: null });
    remote.set('presence', () => ({ handled: false, reason: 'not_found' }));
    expect(await extension.presence!(id)).toEqual({ typing: null });
    expect(remote.of('presence')[0]?.body).toEqual({ sourceId: id });
  });

  it('sends a file as its bytes, mirrors first, and hands back the attachment', async () => {
    remote.set('upload', () =>
      jsonResponse(
        {
          handled: true,
          attachment: {
            id: 'f_1',
            url: 'https://files.example/f_1',
            name: 'invoice.pdf',
            type: 'application/pdf',
            size: 4,
          },
        },
        201,
      ),
    );
    const id = await startConversation();
    const contactId = await ownerOf(id);
    expect(extension.uploads).toEqual({
      maxBytes: 10 * 1024 * 1024,
      types: expect.arrayContaining(['image/*', 'application/pdf']),
    });
    const syncsBefore = remote.of('sync').length;
    const attachment = await extension.upload!(id, contactId, {
      name: 'my invoice.pdf',
      type: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });
    expect(attachment).toEqual({
      id: 'f_1',
      url: 'https://files.example/f_1',
      name: 'invoice.pdf',
      type: 'application/pdf',
      size: 4,
    });
    expect(remote.of('sync')).toHaveLength(syncsBefore + 1);
    const call = remote.of('upload')[0]!;
    expect([...(call.bytes ?? [])]).toEqual([37, 80, 68, 70]);
    expect(call.headers.get('content-type')).toBe('application/octet-stream');
    expect(call.headers.get('x-helpwell-source-id')).toBe(encodeURIComponent(id));
    expect(call.headers.get('x-helpwell-filename')).toBe('my%20invoice.pdf');
    expect(call.headers.get('x-helpwell-type')).toBe('application/pdf');
    expect(call.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("keeps the service's reason when it refuses a file, and stops offering uploads it lacks", async () => {
    const id = await startConversation();
    const contactId = await ownerOf(id);
    const file = { name: 'a.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
    remote.set('upload', () =>
      jsonResponse(
        { error: { code: 'too_large', message: 'That file is larger than 10 MB.' } },
        400,
      ),
    );
    await expect(extension.upload!(id, contactId, file)).rejects.toMatchObject({
      code: 'bad_request',
      publicMessage: 'That file is larger than 10 MB.',
    });
    remote.set('upload', () => jsonResponse({ error: { code: 'not_found' } }, 404));
    await expect(extension.upload!(id, contactId, file)).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(extension.uploads).toBeUndefined();
    // No paperclip in the widget while the service does not take files.
    const config = await body<{ support: { uploads: unknown } }>(await visitor.call('/config'));
    expect(config.support.uploads).toBeNull();
  });

  it('can be told not to offer uploads at all', () => {
    expect(remoteExtension({ uploads: false }).uploads).toBeUndefined();
    expect(remoteExtension({ uploads: { maxBytes: 1024, types: ['image/png'] } }).uploads).toEqual({
      maxBytes: 1024,
      types: ['image/png'],
    });
  });

  it('carries the contact time zone and language in every mirror', async () => {
    const id = await startConversation();
    await db.execute(sql`UPDATE helpwell.contacts SET timezone = 'Europe/London', locale = 'en-GB'
      WHERE id = ${await ownerOf(id)}`);
    const snapshot = await supportSnapshot(db, id);
    expect(snapshot?.contact).toMatchObject({ timezone: 'Europe/London', locale: 'en-GB' });
    await db.execute(sql`UPDATE helpwell.contacts SET timezone = '<b>', locale = NULL
      WHERE id = ${await ownerOf(id)}`);
    expect((await supportSnapshot(db, id))?.contact).toMatchObject({
      timezone: null,
      locale: null,
    });
  });

  it('tells the service what the widget knows about the visit', async () => {
    await extension.proactive!({
      contactId: null,
      anonymousId: 'browser_abc123',
      path: '/pricing',
      identified: false,
      device: 'mobile',
      referrer: 'https://news.example/post',
      utm: { source: 'newsletter', medium: '' },
      locale: 'pt-BR',
    });
    expect(remote.of('proactive')[0]?.body).toEqual({
      contactSourceId: null,
      anonymousId: 'browser_abc123',
      path: '/pricing',
      identified: false,
      device: 'mobile',
      referrer: 'https://news.example/post',
      utm: { source: 'newsletter' },
      locale: 'pt-BR',
    });
  });
});

describe('form submissions over the protocol', () => {
  const submission = {
    id: 'sub_1',
    formId: 'waitlist',
    email: 'ada@example.com',
    fields: { email: 'ada@example.com' },
  } as never;

  it('sends the submission as it is', async () => {
    remote.set('form-submitted', () => ({ handled: true }));
    const ext = remoteExtension();
    await ext.formSubmitted!(submission);
    expect(remote.of('form-submitted')[0]?.body).toEqual({
      id: 'sub_1',
      formId: 'waitlist',
      email: 'ada@example.com',
      fields: { email: 'ada@example.com' },
    });
  });

  it('throws on an outage, so the queue sends it again, and not on a missing action', async () => {
    const ext = remoteExtension();
    await expect(ext.formSubmitted!(submission)).resolves.toBeUndefined();
    remote.set('form-submitted', () => jsonResponse({}, 503));
    await expect(remoteExtension().formSubmitted!(submission)).rejects.toThrow(
      SupportUnavailableError,
    );
  });
});

describe('agent overrides', () => {
  it('switch tools off, never on, and add instructions after the install', async () => {
    await new SettingsStore(db).update({ agent: { tools: { readChangelog: false } } });
    remote.set('agent-overrides', () => ({
      handled: true,
      tools: { search_docs: false, read_changelog: true, invent_tool: false, look_up_user: 'no' },
      instructions: 'Sign off as the Acme team.',
    }));
    setup({ instructions: 'Be brief.' });
    await startConversation();
    const request = model.requests[0]!;
    const tools = (request.tools ?? []).map((t) => t.name);
    expect(tools).not.toContain('search_docs');
    expect(tools).not.toContain('read_changelog');
    expect(tools).toContain('look_up_user');
    const system = String(request.messages[0]?.content ?? '');
    expect(system).toContain('Sign off as the Acme team.');
    expect(system.indexOf('Be brief.')).toBeLessThan(system.indexOf('Sign off as the Acme team.'));
  });

  it('are asked for once a minute, and a failure means none', async () => {
    let clock = new Date('2026-09-23T10:00:00Z');
    let answer: ActionHandler = () => ({ handled: true, instructions: 'Mention the sale.' });
    remote.set('agent-overrides', (b, i) => answer(b, i));
    const wrapped = failOpenSupport(remoteExtension(), { db, logger: silent, now: () => clock });
    expect(await wrapped.agentOverrides!()).toEqual({ instructions: 'Mention the sale.' });
    expect(await wrapped.agentOverrides!()).toEqual({ instructions: 'Mention the sale.' });
    expect(remote.of('agent-overrides')).toHaveLength(1);

    clock = new Date(clock.getTime() + 61_000);
    answer = () => jsonResponse({}, 500);
    expect(await wrapped.agentOverrides!()).toBeNull();
    expect(remote.of('agent-overrides')).toHaveLength(2);
  });

  it('are none from a service that does not have them', async () => {
    setup();
    await startConversation();
    expect(remote.of('agent-overrides')).toHaveLength(1);
    expect((model.requests[0]?.tools ?? []).map((t) => t.name)).toContain('search_docs');
  });
});

describe('content sync', () => {
  async function publish() {
    await db.execute(sql`INSERT INTO helpwell.collection_index (id, title, visibility)
      VALUES ('billing', 'Billing', 'public'), ('internal', 'Internal', 'identified')`);
    await db.execute(sql`INSERT INTO helpwell.article_index (slug, collection, title, description, body, status)
      VALUES
        ('billing/invoices', 'billing', 'Exporting invoices', 'How to export',
         ${`# Invoices\n\nOpen **Billing**, then [Invoices](/billing). ${'More words. '.repeat(80)}`}, 'published'),
        ('billing/draft', 'billing', 'Not yet', null, 'Draft body', 'draft'),
        ('internal/runbook', 'internal', 'Runbook', null, 'Secret steps', 'published')`);
    await db.execute(sql`INSERT INTO helpwell.changelog_entries (id, version, title, summary, body, status, published_at)
      VALUES ('rel_1', '2.4.0', 'Faster exports', 'Exports are twice as fast.', 'Body', 'published', now()),
             ('rel_2', null, 'Unreleased', null, 'Body', 'draft', null)`);
    await db.execute(sql`INSERT INTO helpwell.roadmap_items (id, title, status, votes_count)
      VALUES ('idea_1', 'Dark mode', 'planned', 12)`);
    await new SettingsStore(db).update({
      product: { name: 'Acme', appUrl: 'https://app.acme.test/dashboard' },
      engage: {
        engagements: [
          {
            id: 'setup-tour',
            name: 'Setting up',
            kind: 'tour',
            tour: { steps: [{ blocks: [{ type: 'text', markdown: 'Hi' }] }] },
          },
          {
            id: 'nps',
            kind: 'survey',
            enabled: false,
            survey: { questions: [{ id: 'q1', prompt: 'How likely?' }] },
          },
        ],
      },
    });
  }

  it('pushes what the public help centre shows, with the catalog', async () => {
    await publish();
    const catalog = vi.fn(async () => {});
    const ext = Object.assign(remoteExtension(), { catalog });
    const sync = createContentSync({
      db,
      support: ext,
      settings: () => new SettingsStore(db).get(),
    })!;
    expect(await sync.push()).toBe(true);
    const manifest = remote.of('content-sync')[0]?.body as unknown as ContentManifest;
    expect(manifest.version).toBe(1);
    expect(manifest.product).toEqual({
      name: 'Acme',
      helpCenterUrl: 'https://app.acme.test/help',
    });
    expect(manifest.articles.map((a) => a.slug)).toEqual(['billing/invoices']);
    const article = manifest.articles[0]!;
    expect(article.url).toBe('https://app.acme.test/help/billing/invoices');
    expect(article.excerpt.startsWith('Invoices Open Billing, then Invoices.')).toBe(true);
    expect(article.excerpt.length).toBeLessThanOrEqual(601);
    expect(manifest.changelog).toEqual([
      expect.objectContaining({
        id: 'rel_1',
        version: '2.4.0',
        summary: 'Exports are twice as fast.',
        url: 'https://app.acme.test/help/changelog/2.4.0',
      }),
    ]);
    expect(manifest.roadmap).toEqual([
      {
        id: 'idea_1',
        title: 'Dark mode',
        status: 'planned',
        votes: 12,
        url: 'https://app.acme.test/help/roadmap',
      },
    ]);
    expect(manifest.catalog).toEqual({
      tours: [{ id: 'setup-tour', name: 'Setting up', enabled: true }],
      surveys: [{ id: 'nps', name: 'nps', enabled: false }],
    });
    expect(catalog).toHaveBeenCalledWith(manifest.catalog);
  });

  it('pushes when something changed, and otherwise once an hour', async () => {
    await publish();
    remote.set('content-sync', () => ({ handled: true }));
    let clock = 1_000_000;
    const wrapped = failOpenSupport(remoteExtension(), { db, logger: silent });
    const sync = createContentSync({
      db,
      support: wrapped,
      settings: () => new SettingsStore(db).get(),
      now: () => clock,
    })!;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await db.execute(sql`SELECT 1`);
    };
    sync.tick();
    await vi.waitFor(() => expect(remote.of('content-sync')).toHaveLength(1));
    await settle();

    // Nothing changed, a minute later: no push.
    clock += 61_000;
    sync.tick();
    await settle();
    expect(remote.of('content-sync')).toHaveLength(1);

    // A release is published: pushed at the next look.
    await db.execute(sql`UPDATE helpwell.changelog_entries SET status = 'published', updated_at = now() + interval '1 minute'
      WHERE id = 'rel_2'`);
    clock += 61_000;
    sync.tick();
    await vi.waitFor(() => expect(remote.of('content-sync')).toHaveLength(2));
    await settle();

    // An hour on, pushed again even though nothing changed.
    clock += 60 * 60_000 + 1;
    sync.tick();
    await vi.waitFor(() => expect(remote.of('content-sync')).toHaveLength(3));
  });

  it('is off for an extension that takes no content', () => {
    const plain: SupportExtension = {
      afterReply: async () => {},
      handleMessage: async () => null,
      handoff: async () => {},
      thread: async () => null,
    };
    expect(
      createContentSync({ db, support: plain, settings: () => new SettingsStore(db).get() }),
    ).toBeNull();
  });

  it('starts from the handler, in the background, once requests come in', async () => {
    remote.set('content-sync', () => ({ handled: true }));
    setup();
    await visitor.call('/config');
    await vi.waitFor(() => expect(remote.of('content-sync')).toHaveLength(1));
    await visitor.call('/config');
    await db.execute(sql`SELECT 1`);
    expect(remote.of('content-sync')).toHaveLength(1);
  });
});
