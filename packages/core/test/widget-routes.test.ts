/**
 * The widget's own routes: the inline email card, the Turnstile bot check,
 * attachments, typing and presence (through a support extension), and status.
 *
 * Every write here is scoped to a conversation, so ownership is tested on
 * each one; and everything a support extension provides must be absent, not
 * broken, without one.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel, type ScriptedTurn } from '../src/agent/fake-model.js';
import { clearStatusCache } from '../src/api/status-page.js';
import type { SupportExtension } from '../src/api/support-extension.js';
import { createHelpWellHandler, type HelpWellConfig, type HelpWellHandler } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import type { Db } from '../src/db/client.js';
import { rowsOf } from '../src/db/rows.js';
import { syncContent } from '../src/search/sync.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const BASE = 'http://localhost/api/helpwell';

let t: TestDb;
let db: Db;
let handler: HelpWellHandler;
let visitor: Client;
let model: FakeModel;

async function setup(
  config: Partial<HelpWellConfig> = {},
  settings: Record<string, unknown> = {},
  turns: ScriptedTurn[] = [{ text: 'Open Billing, then Invoices.' }],
): Promise<void> {
  if (Object.keys(settings).length > 0) await new SettingsStore(db).update(settings);
  model = new FakeModel(turns);
  handler = createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    secureCookies: false,
    model,
    ...config,
  });
  visitor = client(handler);
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Start a conversation as `visitor` and return its id. */
async function startConversation(extra: Record<string, unknown> = {}): Promise<string> {
  const response = await visitor.call('/chat', { body: { message: 'How do I export?', ...extra } });
  expect(response.status).toBe(200);
  return (await json<{ conversationId: string }>(response)).conversationId;
}

async function contactRow(id: string) {
  return rowsOf<{ email: string | null; name: string | null; identified: boolean }>(
    await db.execute(sql`
      SELECT c.email, c.name, c.identified FROM helpwell.contacts c
      JOIN helpwell.conversations v ON v.contact_id = c.id WHERE v.id = ${id}
    `),
  )[0];
}

beforeEach(async () => {
  t = await freshDb();
  db = t.db;
  clearStatusCache();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

/* ------------------------------------------------------------ email card */

describe('POST /conversations/:id/contact', () => {
  beforeEach(() => setup());

  it('saves the email and name on the contact without adding a message', async () => {
    const id = await startConversation();
    const response = await visitor.call(`/conversations/${id}/contact`, {
      body: { email: ' Ada@Example.com ', name: 'Ada' },
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      contact: { email: 'ada@example.com', name: 'Ada' },
    });
    expect(await contactRow(id)).toMatchObject({ email: 'ada@example.com', name: 'Ada' });

    // The thread says so, for the card after a reload, and has no new message.
    const thread = await json<{
      messages: unknown[];
      contact: { email: string; identified: boolean };
    }>(await visitor.call(`/conversations/${id}`));
    expect(thread.contact).toEqual({ email: 'ada@example.com', name: 'Ada', identified: false });
    expect(thread.messages).toHaveLength(2);
  });

  it('refuses a blocked domain without saying which rule caught it', async () => {
    await setup({}, { agent: { abuse: { blockedDomains: ['spam.test'] } } });
    const id = await startConversation();
    const response = await visitor.call(`/conversations/${id}/contact`, {
      body: { email: 'x@mail.spam.test' },
    });
    expect(response.status).toBe(403);
    expect((await json<{ error: { message: string } }>(response)).error.message).toBe(
      'That did not go through.',
    );
    expect((await contactRow(id))?.email).toBeNull();
  });

  it('refuses a disposable address when that setting is on', async () => {
    const id = await startConversation();
    const response = await visitor.call(`/conversations/${id}/contact`, {
      body: { email: 'someone@mailinator.com' },
    });
    expect(response.status).toBe(403);
    expect((await json<{ error: { message: string } }>(response)).error.message).toBe(
      'Please use an address we can reply to.',
    );
  });

  it('refuses something that is not an address, and a filled honeypot', async () => {
    const id = await startConversation();
    const bad = await visitor.call(`/conversations/${id}/contact`, { body: { email: 'nope' } });
    expect(bad.status).toBe(400);
    const bot = await visitor.call(`/conversations/${id}/contact`, {
      body: { email: 'ada@example.com', honeypot: 'filled' },
    });
    expect(bot.status).toBe(403);
    expect((await contactRow(id))?.email).toBeNull();
  });

  it("refuses another visitor's conversation, and one that does not exist", async () => {
    const id = await startConversation();
    const stranger = client(handler);
    await stranger.call('/chat', { body: { message: 'hello' } });
    const theirs = await stranger.call(`/conversations/${id}/contact`, {
      body: { email: 'eve@example.com' },
    });
    expect(theirs.status).toBe(403);
    const missing = await visitor.call('/conversations/cnv_nope/contact', {
      body: { email: 'ada@example.com' },
    });
    expect(missing.status).toBe(404);
    expect((await contactRow(id))?.email).toBeNull();
  });

  it('never overwrites the email of an identified visitor', async () => {
    const id = await startConversation();
    await db.execute(sql`
      UPDATE helpwell.contacts SET identified = true, email = 'real@acme.com'
      WHERE id = (SELECT contact_id FROM helpwell.conversations WHERE id = ${id})
    `);
    const response = await visitor.call(`/conversations/${id}/contact`, {
      body: { email: 'other@example.com' },
    });
    expect(response.status).toBe(409);
    expect((await contactRow(id))?.email).toBe('real@acme.com');

    // The thread does not hand an identified visitor's email to the widget.
    const thread = await json<{ contact: unknown; emailAsk: unknown }>(
      await visitor.call(`/conversations/${id}`),
    );
    expect(thread.contact).toEqual({ email: null, name: null, identified: true });
    expect(thread.emailAsk).toBeNull();
  });

  it('insists on a JSON body, like every other write', async () => {
    const id = await startConversation();
    const response = await visitor.call(`/conversations/${id}/contact`, {
      raw: { body: 'email=ada@example.com', type: 'application/x-www-form-urlencoded' },
    });
    expect(response.status).toBe(400);
  });

  it('hands the address to a support extension that wants it', async () => {
    const captured = vi.fn(async () => {});
    await setup({ support: fakeSupport({ contactCaptured: captured }) });
    const id = await startConversation();
    await visitor.call(`/conversations/${id}/contact`, { body: { email: 'ada@example.com' } });
    expect(captured).toHaveBeenCalledWith(id, expect.any(String), {
      email: 'ada@example.com',
      name: null,
    });
  });
});

describe('the email ask on the thread', () => {
  it('remembers which agent message asked, and the agent stops asking once it has one', async () => {
    const asks: ScriptedTurn[] = [
      { toolCalls: [{ name: 'collect_email', arguments: { reason: 'So the team can reply.' } }] },
      { text: 'I have flagged this for the team.' },
    ];
    await setup({}, {}, asks);
    const first = await json<{
      conversationId: string;
      messageId: string;
      askForEmail?: { reason?: string };
    }>(await visitor.call('/chat', { body: { message: 'Can someone call me?' } }));
    expect(first.askForEmail).toEqual({ reason: 'So the team can reply.' });

    const thread = await json<{ emailAsk: unknown; contact: unknown }>(
      await visitor.call(`/conversations/${first.conversationId}`),
    );
    expect(thread.emailAsk).toEqual({
      messageId: first.messageId,
      reason: 'So the team can reply.',
    });

    await visitor.call(`/conversations/${first.conversationId}/contact`, {
      body: { email: 'ada@example.com' },
    });
    model.script(asks);
    const second = await json<{ askForEmail?: unknown }>(
      await visitor.call('/chat', {
        body: { message: 'Anything else?', conversationId: first.conversationId },
      }),
    );
    expect(second.askForEmail).toBeUndefined();
  });
});

/* -------------------------------------------- the answer's own verdict */

describe('which answers left a question open, on the thread', () => {
  interface Thread {
    status: string;
    messages: {
      id: string;
      role: string;
      body: string;
      unresolved?: boolean;
      smallTalk?: boolean;
    }[];
  }
  interface Reply {
    conversationId: string;
    messageId: string;
    unresolved: boolean;
    smallTalk?: boolean;
  }

  async function ask(message: string, conversationId?: string): Promise<Reply> {
    const response = await visitor.call('/chat', { body: { message, conversationId } });
    expect(response.status).toBe(200);
    return json<Reply>(response);
  }

  async function answers(conversationId: string): Promise<Thread> {
    return json<Thread>(await visitor.call(`/conversations/${conversationId}`));
  }

  it('says nothing about small talk, and leaves nothing open', async () => {
    await setup({}, {}, [{ text: 'Hi! What can I help you with?', certainty: 'answered' }]);
    const hi = await ask('hi');
    expect(hi.unresolved).toBe(false);
    expect(hi.smallTalk).toBe(true);

    const thread = await answers(hi.conversationId);
    // Nothing was asked, so nothing is open.
    expect(thread.status).toBe('resolved');
    const agent = thread.messages.find((m) => m.role === 'agent');
    expect(agent?.body).toBe('Hi! What can I help you with?');
    expect(agent).not.toHaveProperty('unresolved');
    expect(agent?.smallTalk).toBe(true);
    const gaps = rowsOf(await db.execute(sql`SELECT id FROM helpwell.gaps`));
    expect(gaps).toEqual([]);
  });

  it('says nothing about an answered question', async () => {
    await setup({}, {}, [
      {
        text: 'Open Billing, choose Invoices, then press Export.',
        cites: [1],
        certainty: 'answered',
      },
    ]);
    await syncContent(
      db,
      createMemoryContentSource({
        'billing/invoices.md': [
          '---',
          'title: Exporting invoices',
          '---',
          '',
          'Open Billing, choose Invoices, then press Export to download invoices.',
        ].join('\n'),
      }),
    );
    const reply = await ask('How do I export invoices?');
    expect(reply.unresolved).toBe(false);
    expect(reply).not.toHaveProperty('smallTalk');
    const thread = await answers(reply.conversationId);
    expect(thread.status).toBe('resolved');
    const agent = thread.messages.find((m) => m.role === 'agent');
    expect(agent).not.toHaveProperty('unresolved');
    expect(agent).not.toHaveProperty('smallTalk');
  });

  it('flags an unanswered question, and only that answer', async () => {
    await setup({}, {}, [
      { text: 'The docs do not cover VAT numbers.', certainty: 'not_covered' },
      { text: 'You are welcome.', certainty: 'answered' },
    ]);
    const vat = await ask('Do you have a VAT number for receipts?');
    expect(vat.unresolved).toBe(true);
    expect(vat).not.toHaveProperty('smallTalk');
    let thread = await answers(vat.conversationId);
    expect(thread.messages.find((m) => m.id === vat.messageId)?.unresolved).toBe(true);
    // The customer's own message never carries it.
    expect(thread.messages.find((m) => m.role === 'customer')).not.toHaveProperty('unresolved');

    // A thank-you after it is small talk, and says so: the widget passes over
    // it, and the unanswered question is still the latest real one.
    const thanks = await ask('thanks!', vat.conversationId);
    expect(thanks).toMatchObject({ unresolved: false, smallTalk: true });
    thread = await answers(vat.conversationId);
    expect(thread.messages.find((m) => m.id === vat.messageId)?.unresolved).toBe(true);
    const reply = thread.messages.find((m) => m.id === thanks.messageId);
    expect(reply).not.toHaveProperty('unresolved');
    expect(reply?.smallTalk).toBe(true);
  });
});

/* ------------------------------------------------------------- turnstile */

describe('the Turnstile bot check', () => {
  let verify: ReturnType<typeof vi.fn>;
  let verdict: { success: boolean; 'error-codes'?: string[] };

  beforeEach(async () => {
    verdict = { success: true };
    verify = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return new Response(JSON.stringify(verdict), {
        headers: { 'content-type': 'application/json' },
      });
    });
    await setup(
      { turnstile: { secret: 'test-secret', fetch: verify as unknown as typeof fetch } },
      { agent: { abuse: { botCheck: 'turnstile', turnstileSiteKey: '0x4AAAAsite' } } },
    );
  });

  it('tells the widget the site key, and never the secret', async () => {
    const config = await json<{ botCheck?: unknown }>(await visitor.call('/config'));
    expect(config.botCheck).toEqual({ provider: 'turnstile', siteKey: '0x4AAAAsite' });
    expect(JSON.stringify(config)).not.toContain('test-secret');
  });

  it('refuses a first message with no token, in a way the widget can retry', async () => {
    const response = await visitor.call('/chat', { body: { message: 'hello' } });
    expect(response.status).toBe(403);
    const error = (await json<{ error: { details: { humanCheck: string } } }>(response)).error;
    expect(error.details.humanCheck).toBe('missing');
    expect(verify).not.toHaveBeenCalled();
    const count = rowsOf<{ n: string }>(
      await db.execute(sql`SELECT count(*) AS n FROM helpwell.conversations`),
    )[0];
    expect(Number(count?.n)).toBe(0);
  });

  it('refuses a token siteverify rejects', async () => {
    verdict = { success: false, 'error-codes': ['invalid-input-response'] };
    const response = await visitor.call('/chat', {
      body: { message: 'hello', turnstileToken: 'bad-token' },
    });
    expect(response.status).toBe(403);
    expect(
      (await json<{ error: { details: { humanCheck: string } } }>(response)).error.details
        .humanCheck,
    ).toBe('failed');
  });

  it('verifies once per conversation, with the secret, token and address', async () => {
    const first = await visitor.call('/chat', {
      body: { message: 'hello', turnstileToken: 'good-token' },
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(first.status).toBe(200);
    const { conversationId } = await json<{ conversationId: string }>(first);
    expect(verify).toHaveBeenCalledTimes(1);
    const [url, init] = verify.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('secret')).toBe('test-secret');
    expect(form.get('response')).toBe('good-token');
    expect(form.get('remoteip')).toBe('203.0.113.9');

    // The next message, and the email card, need no token.
    const second = await visitor.call('/chat', { body: { message: 'and?', conversationId } });
    expect(second.status).toBe(200);
    const card = await visitor.call(`/conversations/${conversationId}/contact`, {
      body: { email: 'ada@example.com' },
    });
    expect(card.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);

    const thread = await json<{ botVerified: boolean }>(
      await visitor.call(`/conversations/${conversationId}`),
    );
    expect(thread.botVerified).toBe(true);
  });

  it('asks the email card for a token on a conversation that never passed', async () => {
    // Started before the check was switched on.
    await setup({}, { agent: { abuse: { botCheck: 'off' } } });
    const id = await startConversation();
    await setup(
      { turnstile: { secret: 'test-secret', fetch: verify as unknown as typeof fetch } },
      { agent: { abuse: { botCheck: 'turnstile', turnstileSiteKey: '0x4AAAAsite' } } },
    );
    // A fresh handler means a fresh client; carry the visitor over.
    const cookie = rowsOf<{ contact_id: string }>(
      await db.execute(sql`SELECT contact_id FROM helpwell.conversations WHERE id = ${id}`),
    )[0]!.contact_id;
    const call = (body: unknown) =>
      handler(
        new Request(`${BASE}/conversations/${id}/contact`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `hw_visitor=${cookie}` },
          body: JSON.stringify(body),
        }),
      );
    expect((await call({ email: 'ada@example.com' })).status).toBe(403);
    expect((await call({ email: 'ada@example.com', turnstileToken: 'good' })).status).toBe(200);
  });

  it('stays off, rather than refusing everyone, while the secret is missing', async () => {
    vi.stubEnv('HELPWELL_TURNSTILE_SECRET', '');
    await setup({}, { agent: { abuse: { botCheck: 'turnstile', turnstileSiteKey: 'k' } } });
    const config = await json<{ botCheck?: unknown }>(await visitor.call('/config'));
    expect(config.botCheck).toBeUndefined();
    expect((await visitor.call('/chat', { body: { message: 'hello' } })).status).toBe(200);
  });

  it('reads the secret from the environment, and tells an admin where it came from', async () => {
    vi.stubEnv('HELPWELL_TURNSTILE_SECRET', 'env-secret');
    await setup(
      { adminToken: 'admin', turnstile: { fetch: verify as unknown as typeof fetch } },
      { agent: { abuse: { botCheck: 'turnstile', turnstileSiteKey: 'k' } } },
    );
    const admin = client(handler, { adminToken: 'admin' });
    const checks = await json<{
      botCheck: { active: boolean; secretSet: boolean; secretSource: string };
    }>(await admin.call('/admin/widget/checks'));
    expect(checks.botCheck).toMatchObject({
      active: true,
      secretSet: true,
      secretSource: 'environment',
    });
    expect(JSON.stringify(checks)).not.toContain('env-secret');
    expect((await visitor.call('/admin/widget/checks')).status).toBe(401);

    await visitor.call('/chat', { body: { message: 'hi', turnstileToken: 'tok' } });
    expect(new URLSearchParams(String(verify.mock.calls[0]?.[1]?.body)).get('secret')).toBe(
      'env-secret',
    );
  });

  it('says siteverify was unreachable as a retryable error', async () => {
    verify.mockRejectedValueOnce(new Error('network down'));
    const response = await visitor.call('/chat', {
      body: { message: 'hello', turnstileToken: 'tok' },
    });
    expect(response.status).toBe(502);
  });
});

/* ------------------------------------------------ extension-only features */

function fakeSupport(overrides: Partial<SupportExtension> = {}): SupportExtension {
  return {
    afterReply: async () => {},
    handleMessage: async () => null,
    handoff: async () => {},
    thread: async () => null,
    ...overrides,
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function upload(
  id: string,
  bytes: Uint8Array | string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return handler(
    new Request(`${BASE}/conversations/${id}/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: visitor.jar.join('; '),
        'x-helpwell-filename': encodeURIComponent('../../screen shot.png'),
        ...headers,
      },
      body: typeof bytes === 'string' ? bytes : new Blob([new Uint8Array(bytes)]),
    }),
  );
}

describe('without a support extension', () => {
  beforeEach(() => setup());

  it('has no attachments, typing or presence, and the config says so', async () => {
    const id = await startConversation();
    expect((await upload(id, PNG)).status).toBe(404);
    expect(
      (await visitor.call(`/conversations/${id}/typing`, { body: { typing: true } })).status,
    ).toBe(404);
    expect((await visitor.call(`/conversations/${id}/presence`)).status).toBe(404);
    const config = await json<{ support?: unknown }>(await visitor.call('/config'));
    expect(config.support).toBeUndefined();
    const thread = await json<{ uploads: unknown }>(await visitor.call(`/conversations/${id}`));
    expect(thread.uploads).toBeNull();
  });
});

describe('attachments', () => {
  let stored: {
    conversationId: string;
    contactId: string;
    name: string;
    type: string;
    size: number;
  }[];

  beforeEach(async () => {
    stored = [];
    await setup({
      support: fakeSupport({
        uploads: { maxBytes: 64, types: ['image/*', 'application/pdf', 'image/svg+xml'] },
        async upload(conversationId, contactId, file) {
          stored.push({
            conversationId,
            contactId,
            name: file.name,
            type: file.type,
            size: file.bytes.length,
          });
          return {
            id: 'att_1',
            url: 'https://files.example/att_1',
            name: file.name,
            type: file.type,
            size: file.bytes.length,
          };
        },
      }),
    });
  });

  it('tells the widget, and never offers a type that could run script', async () => {
    const config = await json<{ support: { uploads: { types: string[] } } }>(
      await visitor.call('/config'),
    );
    expect(config.support.uploads.types).toEqual(['image/*', 'application/pdf']);
  });

  it('routes a checked file to the extension with its sniffed type and a clean name', async () => {
    const id = await startConversation();
    const response = await upload(id, PNG, { 'x-helpwell-type': 'application/pdf' });
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({ id: 'att_1', url: 'https://files.example/att_1' });
    expect(stored).toEqual([
      {
        conversationId: id,
        contactId: expect.any(String),
        name: 'screen shot.png',
        type: 'image/png',
        size: PNG.length,
      },
    ]);
  });

  it('refuses a file over the size limit', async () => {
    const id = await startConversation();
    const big = new Uint8Array(65);
    big.set(PNG);
    const response = await upload(id, big);
    expect(response.status).toBe(400);
    expect((await json<{ error: { message: string } }>(response)).error.message).toContain(
      'too large',
    );
    expect(stored).toHaveLength(0);
  });

  it('goes by the bytes, not the claimed type: text called a PNG is refused', async () => {
    const id = await startConversation();
    const response = await upload(id, 'just some text', { 'x-helpwell-type': 'image/png' });
    expect(response.status).toBe(400);
    expect(stored).toHaveLength(0);
  });

  it('refuses SVG and HTML even when the extension would take them', async () => {
    const id = await startConversation();
    const svg = await upload(
      id,
      '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
    );
    expect(svg.status).toBe(400);
    const html = await upload(id, '<!doctype html><script>alert(1)</script>');
    expect(html.status).toBe(400);
    expect(stored).toHaveLength(0);
  });

  it('refuses a form post, which a hostile page could send', async () => {
    const id = await startConversation();
    const response = await upload(id, PNG, { 'content-type': 'multipart/form-data; boundary=x' });
    expect(response.status).toBe(400);
  });

  it("refuses another visitor's conversation", async () => {
    const id = await startConversation();
    visitor = client(handler);
    await visitor.call('/chat', { body: { message: 'hi' } });
    expect((await upload(id, PNG)).status).toBe(403);
    expect(stored).toHaveLength(0);
  });
});

describe('typing and presence', () => {
  const typing = vi.fn(async () => {});

  beforeEach(async () => {
    typing.mockClear();
    await setup({
      support: fakeSupport({
        typing,
        presence: async () =>
          ({
            typing: { name: `  Maya ${'x'.repeat(100)}` },
            seenUpTo: 'msg_1',
            notice: { text: "If you're away, we'll reply by email.", askEmail: true },
            secret: 'not for the widget',
          }) as never,
      }),
    });
  });

  it('passes typing through for the owner only', async () => {
    const id = await startConversation();
    const ok = await visitor.call(`/conversations/${id}/typing`, { body: { typing: true } });
    expect(ok.status).toBe(204);
    expect(typing).toHaveBeenCalledWith(id, expect.any(String), true);

    const stranger = client(handler);
    await stranger.call('/chat', { body: { message: 'hi' } });
    expect(
      (await stranger.call(`/conversations/${id}/typing`, { body: { typing: false } })).status,
    ).toBe(403);
    expect(typing).toHaveBeenCalledTimes(1);
  });

  it('answers presence with only the fields the widget draws, trimmed', async () => {
    const id = await startConversation();
    const presence = await json(await visitor.call(`/conversations/${id}/presence`));
    expect(presence).toEqual({
      typing: { name: `Maya ${'x'.repeat(55)}` },
      seenUpTo: 'msg_1',
      notice: { text: "If you're away, we'll reply by email.", askEmail: true },
    });
  });

  it('lists what the extension can do in the config', async () => {
    const config = await json<{ support: unknown }>(await visitor.call('/config'));
    expect(config.support).toEqual({
      human: true,
      uploads: null,
      typing: true,
      presence: true,
      proactive: false,
    });
  });
});

/* ---------------------------------------------------------------- status */

describe('GET /status', () => {
  const summary = {
    page: { url: 'https://status.acme.com', updated_at: '2026-09-23T10:00:00Z' },
    status: { indicator: 'major', description: 'Partial System Outage' },
    incidents: [
      { name: 'Exports are slow', status: 'investigating', shortlink: 'https://stspg.io/x' },
    ],
    scheduled_maintenances: [],
  };

  it('is empty when nothing is configured', async () => {
    await setup();
    expect(await json(await visitor.call('/status'))).toMatchObject({ level: null, url: null });
  });

  it('shows a manual status whatever the page says', async () => {
    const fetchStatusPage = vi.fn(async () => summary);
    await setup(
      { fetchStatusPage },
      {
        widget: {
          statusUrl: 'https://status.acme.com',
          status: { mode: 'manual', level: 'maintenance', message: 'Upgrading the database.' },
        },
      },
    );
    const status = await json(await visitor.call('/status'));
    expect(status).toMatchObject({
      level: 'maintenance',
      message: 'Upgrading the database.',
      url: 'https://status.acme.com',
      source: 'manual',
    });
    expect(fetchStatusPage).not.toHaveBeenCalled();
  });

  it('reads a Statuspage page, caches it for a minute, and lets a CDN cache it', async () => {
    const fetchStatusPage = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v2/summary.json')) return summary;
      throw new Error('404');
    });
    await setup({ fetchStatusPage }, { widget: { statusUrl: 'https://status.acme.com/' } });
    const response = await visitor.call('/status');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await json(response)).toMatchObject({
      level: 'partial_outage',
      message: 'Partial System Outage',
      source: 'statuspage',
      incidents: [{ name: 'Exports are slow', status: 'investigating', url: 'https://stspg.io/x' }],
    });
    await visitor.call('/status');
    expect(fetchStatusPage).toHaveBeenCalledTimes(1);
    expect(fetchStatusPage).toHaveBeenCalledWith('https://status.acme.com/api/v2/summary.json');
  });

  it('shows the host app’s own incident ahead of the page', async () => {
    await setup(
      { incident: { title: 'Login is failing for some people' } },
      { widget: { statusUrl: 'https://status.acme.com' } },
    );
    expect(await json(await visitor.call('/status'))).toMatchObject({
      level: 'degraded',
      message: 'Login is failing for some people',
      source: 'host',
    });
  });

  it('says nothing, rather than guessing, when the page cannot be read', async () => {
    await setup(
      { fetchStatusPage: async () => ({ html: true }) },
      { widget: { statusUrl: 'https://status.acme.com' } },
    );
    expect(await json(await visitor.call('/status'))).toMatchObject({
      level: null,
      url: 'https://status.acme.com',
    });
  });
});
