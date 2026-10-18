/**
 * The webhook guard: every delivery goes through one fetch, the install's own
 * or the built-in guard, which refuses anything but a public https address at
 * the moment it connects. Nothing here reaches the network: the guard's
 * resolver is swapped for one that answers from a table, and every address it
 * answers with is private, so each test ends before a connection is opened.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import type { LookupFunction } from '../src/api/status-page.js';
import { createHelpWellHandler, type HelpWellConfig } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import type { Db } from '../src/db/client.js';
import { rowsOf } from '../src/db/rows.js';
import { webhookReceiverPromptSpec } from '../src/integration-prompts.js';
import { SettingsStore } from '../src/settings/store.js';
import { formatSetupPrompt } from '../src/setup-prompt.js';
import {
  checkWebhookUrl,
  defaultWebhookFetch,
  guardedWebhookFetch,
  WEBHOOK_GUARD_ENV,
  WebhookRefusedError,
  webhookFetchFor,
} from '../src/webhook-guard.js';
import { emitWebhooks, retryWebhooks, sendTestWebhook } from '../src/webhooks.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

let t: TestDb;
let db: Db;

beforeEach(async () => {
  t = await freshDb();
  db = t.db;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await t.close();
});

/** A resolver that answers from a table, and records what it was asked. */
function fakeDns(answers: Record<string, string[]>): LookupFunction & { asked: string[] } {
  const asked: string[] = [];
  const lookup = ((hostname, options, callback) => {
    asked.push(hostname);
    const addresses = answers[hostname];
    if (!addresses) {
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, '', 4);
      return;
    }
    const all = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    if (options.all) callback(null, all);
    else callback(null, all[0]!.address, all[0]!.family);
  }) as LookupFunction & { asked: string[] };
  lookup.asked = asked;
  return lookup;
}

async function deliveries() {
  return rowsOf<{
    event: string;
    url: string;
    status: string;
    error: string | null;
    next_attempt_at: string | Date | null;
  }>(
    await db.execute(sql`
      SELECT event, url, status, error, next_attempt_at
      FROM helpwell.webhook_deliveries ORDER BY created_at, id
    `),
  );
}

describe('checkWebhookUrl', () => {
  it('passes a public https URL on to DNS', () => {
    expect(checkWebhookUrl('https://hooks.example.com/in')).toBeNull();
    expect(checkWebhookUrl('https://hooks.example.com:8443/in')).toBeNull();
  });

  it.each([
    ['http://hooks.example.com/in', 'https'],
    ['ftp://hooks.example.com/in', 'https'],
    ['not a url', 'not a URL'],
    ['https://localhost/in', 'not a public address'],
    ['https://db.internal/in', 'not a public address'],
    ['https://printer.local/in', 'not a public address'],
    ['https://intranet/in', 'not a public address'],
    ['https://127.0.0.1/in', 'not a public address'],
    ['https://10.1.2.3/in', 'not a public address'],
    ['https://172.20.0.5/in', 'not a public address'],
    ['https://192.168.1.1/in', 'not a public address'],
    ['https://169.254.169.254/latest/meta-data', 'not a public address'],
    ['https://100.64.0.1/in', 'not a public address'],
    ['https://[::1]/in', 'not a public address'],
    ['https://[fd00::1]/in', 'not a public address'],
    ['https://[fe80::1]/in', 'not a public address'],
    ['https://[::ffff:10.0.0.1]/in', 'not a public address'],
  ])('refuses %s', (url, reason) => {
    expect(checkWebhookUrl(url)).toContain(reason);
  });

  it('says how to turn the guard off for local development', () => {
    expect(checkWebhookUrl('http://localhost:4000/hook')).toContain(`${WEBHOOK_GUARD_ENV}=off`);
    // And so does the prompt an assistant builds a receiver from.
    const prompt = formatSetupPrompt(webhookReceiverPromptSpec({ productName: 'Acme' }));
    expect(prompt).toContain('only sends to a public https address');
    expect(prompt).toContain(`${WEBHOOK_GUARD_ENV}=off`);
  });
});

describe('guardedWebhookFetch', () => {
  it('refuses a plain-http or private URL before it resolves anything', async () => {
    const dns = fakeDns({});
    const send = guardedWebhookFetch({ lookup: dns });
    await expect(send('http://hooks.example.com/in', { method: 'POST' })).rejects.toBeInstanceOf(
      WebhookRefusedError,
    );
    await expect(send('https://169.254.169.254/', { method: 'POST' })).rejects.toBeInstanceOf(
      WebhookRefusedError,
    );
    expect(dns.asked).toEqual([]);
  });

  it('checks the addresses the name resolves to, on the connection itself', async () => {
    // A public-looking name that resolves inside the network: the rebinding case.
    const dns = fakeDns({
      'rebind.example.com': ['10.0.0.8'],
      'metadata.example.com': ['169.254.169.254'],
      'loopback.example.com': ['::1'],
    });
    const send = guardedWebhookFetch({ lookup: dns });
    for (const host of ['rebind.example.com', 'metadata.example.com', 'loopback.example.com']) {
      const error = await send(`https://${host}/in`, { method: 'POST', body: '{}' }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(WebhookRefusedError);
      expect(String((error as Error).message)).toContain('resolves to a private address');
    }
    expect(dns.asked).toEqual([
      'rebind.example.com',
      'metadata.example.com',
      'loopback.example.com',
    ]);
  });

  it('refuses a name when any one of its addresses is private', async () => {
    const dns = fakeDns({ 'mixed.example.com': ['93.184.216.34', '192.168.0.10'] });
    const send = guardedWebhookFetch({ lookup: dns });
    await expect(send('https://mixed.example.com/in', { method: 'POST' })).rejects.toBeInstanceOf(
      WebhookRefusedError,
    );
  });

  it('passes a name that does not resolve on as a network failure, not a refusal', async () => {
    const send = guardedWebhookFetch({ lookup: fakeDns({}) });
    const error = await send('https://nowhere.example.com/in', { method: 'POST' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WebhookRefusedError);
    expect(String((error as Error).message)).toContain('ENOTFOUND');
  });

  it('stops at once when the delivery is cancelled', async () => {
    const send = guardedWebhookFetch({ lookup: fakeDns({}) });
    const controller = new AbortController();
    controller.abort();
    await expect(
      send('https://hooks.example.com/in', { method: 'POST', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('which fetch an install uses', () => {
  it('is the guard unless the environment turns it off', () => {
    expect(defaultWebhookFetch({})).toBe(defaultWebhookFetch({}));
    expect(defaultWebhookFetch({ [WEBHOOK_GUARD_ENV]: 'off' })).not.toBe(defaultWebhookFetch({}));
    expect(webhookFetchFor({ env: {} })).toBe(defaultWebhookFetch({}));
  });

  it("is the host's own when it passes one, and the plain fetch for false", async () => {
    const own = vi.fn(async () => new Response('ok')) as unknown as typeof fetch;
    expect(webhookFetchFor({ webhookFetch: own, env: {} })).toBe(own);

    const stub = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', stub);
    await webhookFetchFor({ webhookFetch: false, env: {} })('http://localhost:4000/hook');
    await webhookFetchFor({ env: { [WEBHOOK_GUARD_ENV]: 'off' } })('http://localhost:4000/hook');
    expect(stub).toHaveBeenCalledTimes(2);
  });
});

describe('deliveries through the default guard', () => {
  const local = { url: 'http://localhost:4000/hook', events: [], secret: 's', active: true };

  it('records a refused delivery and never retries it', async () => {
    const stub = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', stub);
    const settings = await new SettingsStore(db).update({ webhooks: [local] });

    await emitWebhooks(db, settings, 'gap.created', { id: 'gap_1' });
    const [row] = await deliveries();
    expect(row).toMatchObject({ status: 'failed', url: local.url });
    expect(row?.error).toContain('Webhook guard');
    expect(row?.next_attempt_at).toBeNull();
    // The plain fetch was never reached.
    expect(stub).not.toHaveBeenCalled();

    const retried = await retryWebhooks(db, settings, { force: true });
    expect(retried.attempted).toBe(0);
    const [test] = await sendTestWebhook(db, settings);
    expect(test?.status).toBe('failed');
    expect(test?.error).toContain('Webhook guard');
    expect(stub).not.toHaveBeenCalled();
  });

  it('sends with the plain fetch once the environment turns the guard off', async () => {
    vi.stubEnv(WEBHOOK_GUARD_ENV, 'off');
    const stub = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', stub);
    const settings = await new SettingsStore(db).update({ webhooks: [local] });
    await emitWebhooks(db, settings, 'gap.created', { id: 'gap_1' });
    expect(stub).toHaveBeenCalledTimes(1);
    expect((await deliveries())[0]?.status).toBe('delivered');
  });
});

describe('HelpWellConfig.webhookFetch', () => {
  // `.invalid` never resolves (RFC 6761), so a send that slipped past the
  // install's fetch could never reach anybody.
  const hook = { url: 'https://hooks.acme.invalid/in', events: [], secret: 's', active: true };

  async function install(config: Partial<HelpWellConfig>, url = hook.url) {
    const content = createMemoryContentSource({
      'billing/invoices.md': '---\ntitle: Exporting invoices\n---\n\nOpen Billing, then Export.\n',
    });
    await new SettingsStore(db).update({
      webhooks: [{ ...hook, url }],
      changelog: { roadmap: { enabled: true, whoCanSubmit: 'anyone' } },
    });
    const handler = createHelpWellHandler({
      db,
      adminToken: 'admin',
      env: {},
      content,
      // Says it does not know, so the turn is unresolved and records a gap.
      model: new FakeModel(() => ({
        text: 'I do not know.',
        certainty: { level: 'not_covered', reason: 'nothing on this' },
      })),
      ...config,
    });
    return {
      admin: client(handler, { adminToken: 'admin' }),
      visitor: client(handler, { ip: '198.51.100.20' }),
    };
  }

  it('carries every send: routes, the agent, the indexer, changelog, retries and tests', async () => {
    const sent: { url: string; event: string }[] = [];
    const own = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { event: string };
      sent.push({ url: String(url), event: body.event });
      return new Response('nope', { status: 500 });
    });
    // The global fetch must never be used for a delivery.
    const global = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', global);
    const { admin, visitor } = await install({ webhookFetch: own as unknown as typeof fetch });

    // A chat turn the agent cannot answer: conversation.created, the gap,
    // conversation.unresolved and message.created.
    const chat = await visitor.call('/chat', { body: { message: 'Do you support SAML?' } });
    expect(chat.status).toBe(200);
    // A roadmap idea, from a public route.
    expect((await visitor.call('/roadmap', { body: { title: 'Dark mode' } })).status).toBe(201);
    // A changelog entry published through the admin API.
    const entry = await admin.call('/admin/changelog', {
      body: { title: 'Faster exports', status: 'published' },
    });
    expect(entry.status).toBe(201);
    // An article saved, and so published, through the admin API.
    const article = await admin.call('/admin/articles', {
      body: {
        path: 'billing/refunds.md',
        markdown: '---\ntitle: Refunds\n---\n\nPro rata, to the day.\n',
        create: true,
      },
    });
    expect(article.status).toBe(201);
    // A test delivery and a forced retry.
    expect((await admin.call('/admin/webhooks/test', { body: {} })).status).toBe(200);
    const retry = await admin.call('/admin/webhooks/retry', { body: { force: true } });
    expect(retry.status).toBe(200);

    const events = new Set(sent.map((s) => s.event));
    for (const event of [
      'conversation.created',
      'conversation.unresolved',
      'gap.created',
      'message.created',
      'roadmap.idea',
      'changelog.published',
      'article.published',
      'webhook.test',
    ]) {
      expect(events, event).toContain(event);
    }
    expect(sent.every((s) => s.url === hook.url)).toBe(true);
    // Retries went through it too: more sends than deliveries recorded.
    expect(sent.length).toBeGreaterThan((await deliveries()).length);
    expect(global).not.toHaveBeenCalled();
  });

  it('is the built-in guard when the host passes nothing', async () => {
    const global = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', global);
    const { admin } = await install({}, 'http://127.0.0.1:9/in');
    const response = await admin.call('/admin/webhooks/test', { body: {} });
    const { items } = (await response.json()) as { items: { status: string; error: string }[] };
    expect(items[0]?.status).toBe('failed');
    expect(items[0]?.error).toContain('Webhook guard');
    expect(global).not.toHaveBeenCalled();
  });

  it('sends with the plain fetch for webhookFetch: false, for local development', async () => {
    const global = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', global);
    const { admin } = await install({ webhookFetch: false }, 'http://localhost:4000/hook');
    const response = await admin.call('/admin/webhooks/test', { body: {} });
    const { items } = (await response.json()) as { items: { status: string }[] };
    expect(items[0]?.status).toBe('delivered');
    expect(global).toHaveBeenCalledTimes(1);
  });

  it('turns off from the install env, not from the process', async () => {
    vi.stubEnv(WEBHOOK_GUARD_ENV, 'off');
    const global = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', global);
    // env: {} for this install, so the process's switch does not reach it.
    const { admin } = await install({}, 'http://localhost:4000/hook');
    const guarded = await admin.call('/admin/webhooks/test', { body: {} });
    expect(((await guarded.json()) as { items: { status: string }[] }).items[0]?.status).toBe(
      'failed',
    );
    const { admin: local } = await install(
      { env: { [WEBHOOK_GUARD_ENV]: 'off' } },
      'http://localhost:4000/hook',
    );
    const sent = await local.call('/admin/webhooks/test', { body: {} });
    expect(((await sent.json()) as { items: { status: string }[] }).items[0]?.status).toBe(
      'delivered',
    );
    expect(global).toHaveBeenCalledTimes(1);
  });
});
