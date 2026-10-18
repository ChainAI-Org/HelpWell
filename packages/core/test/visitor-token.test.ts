/**
 * The visitor token a widget on another site carries in a header, because
 * its cookie never arrives. It must hold a visitor across calls exactly as
 * the cookie does, pass exactly the ownership checks the cookie passes, lose
 * to a cookie when both arrive, follow identify, and be refused when it was
 * not signed by this install or names nobody.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import {
  createHelpWellHandler,
  type HelpWellHandler,
  signIdentity,
  signVisitorToken,
  VISITOR_HEADER,
  VISITOR_TOKEN_FORGET,
  VISITOR_TOKEN_MAX_AGE_S,
  VISITOR_TOKEN_REQUEST,
  verifyVisitorToken,
} from '../src/api.js';
import type { Db } from '../src/db/client.js';
import { rowsOf } from '../src/db/rows.js';
import { widgetInstallPromptSpec } from '../src/install-prompts.js';
import { formatSetupPrompt } from '../src/setup-prompt.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const BASE = 'https://api.hosted.example/p/acme/api';
const SITE = 'https://www.acme.example';

let t: TestDb;
let db: Db;
let handler: HelpWellHandler;

beforeEach(async () => {
  t = await freshDb();
  db = t.db;
  handler = createHelpWellHandler({
    db,
    basePath: '/p/acme/api',
    model: new FakeModel(() => ({ text: 'Open Billing, then Export.' })),
    identitySecret: 'identity-secret',
    corsOrigins: [SITE],
    env: {},
  });
});

afterEach(async () => {
  await t.close();
});

/**
 * A browser on another site, as Safari treats one: whatever cookies the API
 * sets never come back. It keeps the token as the widget does.
 */
function crossSite(options: { ip?: string } = {}) {
  let token: string | null = null;
  return {
    get token() {
      return token;
    },
    set token(value: string | null) {
      token = value;
    },
    async call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
      const headers = new Headers({
        origin: SITE,
        [VISITOR_HEADER]: token ?? VISITOR_TOKEN_REQUEST,
      });
      if (init.cookie) headers.set('cookie', init.cookie);
      if (options.ip) headers.set('x-forwarded-for', options.ip);
      if (init.body !== undefined) headers.set('content-type', 'application/json');
      const response = await handler(
        new Request(`${BASE}${path}`, {
          method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      );
      const issued = response.headers.get(VISITOR_HEADER);
      if (issued === VISITOR_TOKEN_FORGET) token = null;
      else if (issued) token = issued;
      return response;
    },
  };
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('signVisitorToken and verifyVisitorToken', () => {
  it('round-trips a contact id, and refuses anything altered', async () => {
    const token = await signVisitorToken(db, 'con_abc123');
    expect(token).toMatch(/^v1\.con_abc123\.\d+\.[A-Za-z0-9_-]+$/);
    expect(await verifyVisitorToken(db, token)).toBe('con_abc123');

    const [v, , exp, sig] = token.split('.');
    expect(await verifyVisitorToken(db, `${v}.con_other.${exp}.${sig}`)).toBeNull();
    expect(await verifyVisitorToken(db, `${v}.con_abc123.${Number(exp) + 1}.${sig}`)).toBeNull();
    expect(await verifyVisitorToken(db, `${token}x`)).toBeNull();
    for (const junk of ['', 'new', 'con_abc123', 'v2.a.b.c', 'v1.a.b', null, 42, 'x'.repeat(400)]) {
      expect(await verifyVisitorToken(db, junk)).toBeNull();
    }
  });

  it('expires after a year', async () => {
    const issued = Date.parse('2026-01-01T00:00:00Z');
    const token = await signVisitorToken(db, 'con_abc123', issued);
    const almost = issued + (VISITOR_TOKEN_MAX_AGE_S - 60) * 1000;
    expect(await verifyVisitorToken(db, token, almost)).toBe('con_abc123');
    expect(await verifyVisitorToken(db, token, almost + 120_000)).toBeNull();
  });

  it('is refused by another install, whose key is its own', async () => {
    const other = await freshDb();
    try {
      const token = await signVisitorToken(db, 'con_abc123');
      expect(await verifyVisitorToken(other.db, token)).toBeNull();
    } finally {
      await other.close();
    }
  });
});

describe('a widget on another site', () => {
  it('is issued a token when it becomes a visitor, and nothing before', async () => {
    const browser = crossSite();
    const config = await browser.call('/config');
    expect(config.status).toBe(200);
    expect(config.headers.get(VISITOR_HEADER)).toBeNull();
    expect(browser.token).toBeNull();

    const chat = await browser.call('/chat', { body: { message: 'How do I export?' } });
    expect(chat.status).toBe(200);
    expect(browser.token).toMatch(/^v1\.con_/);
    expect(chat.headers.get('cache-control')).toBe('no-store');
    // The browser may read it: CORS says so for the allowed origin.
    expect(chat.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(chat.headers.get('access-control-expose-headers')).toBe(VISITOR_HEADER);
  });

  it('keeps one visitor across calls with no cookie at all', async () => {
    const browser = crossSite();
    const first = await body<{ conversationId: string }>(
      await browser.call('/chat', { body: { message: 'How do I export?' } }),
    );
    const second = await browser.call('/chat', {
      body: { message: 'And then?', conversationId: first.conversationId },
    });
    expect(second.status).toBe(200);

    const thread = await browser.call(`/conversations/${first.conversationId}`);
    expect(thread.status).toBe(200);
    expect((await body<{ messages: unknown[] }>(thread)).messages).toHaveLength(4);
    const list = await body<{ items: { id: string }[] }>(await browser.call('/conversations'));
    expect(list.items.map((item) => item.id)).toEqual([first.conversationId]);

    const [contacts] = rowsOf<{ n: number }>(
      await db.execute(sql`SELECT count(*)::int AS n FROM helpwell.contacts`),
    );
    expect(contacts?.n).toBe(1);
  });

  it('refreshes the token on every answer once it has one, /config included', async () => {
    const browser = crossSite();
    await browser.call('/chat', { body: { message: 'hi' } });
    const held = browser.token;
    const config = await browser.call('/config');
    const refreshed = config.headers.get(VISITOR_HEADER);
    expect(refreshed).toMatch(/^v1\.con_/);
    expect(await verifyVisitorToken(db, refreshed)).toBe(await verifyVisitorToken(db, held));
  });

  it("passes the same ownership checks as the cookie: another visitor's thread is not theirs", async () => {
    const ada = crossSite({ ip: '198.51.100.1' });
    const bob = crossSite({ ip: '198.51.100.2' });
    const { conversationId } = await body<{ conversationId: string }>(
      await ada.call('/chat', { body: { message: 'Mine' } }),
    );
    await bob.call('/chat', { body: { message: 'His' } });

    expect((await bob.call(`/conversations/${conversationId}`)).status).toBe(403);
    const intrusion = await bob.call('/chat', { body: { message: 'Hijack', conversationId } });
    expect(intrusion.status).toBe(403);
    // With nothing at all, nothing is anybody's.
    const bare = await handler(new Request(`${BASE}/conversations/${conversationId}`));
    expect(bare.status).toBe(403);
  });

  it('refuses a token this install did not sign, and says to forget it', async () => {
    const ada = crossSite();
    const { conversationId } = await body<{ conversationId: string }>(
      await ada.call('/chat', { body: { message: 'Mine' } }),
    );
    const contactId = await verifyVisitorToken(db, ada.token);
    const [, , exp] = String(ada.token).split('.');

    // A contact id learned elsewhere, with a made-up signature.
    const forger = crossSite();
    forger.token = `v1.${contactId}.${exp}.${'A'.repeat(43)}`;
    const response = await forger.call(`/conversations/${conversationId}`);
    expect(response.status).toBe(403);
    expect(response.headers.get(VISITOR_HEADER)).toBe(VISITOR_TOKEN_FORGET);
    expect(forger.token).toBeNull();

    // And the raw contact id, which is what the cookie carries, is not a token.
    const raw = crossSite();
    raw.token = String(contactId);
    expect((await raw.call(`/conversations/${conversationId}`)).status).toBe(403);
  });

  it('stops working once the contact is erased', async () => {
    const ada = crossSite();
    const { conversationId } = await body<{ conversationId: string }>(
      await ada.call('/chat', { body: { message: 'Mine' } }),
    );
    const contactId = await verifyVisitorToken(db, ada.token);
    await db.execute(sql`UPDATE helpwell.contacts SET deleted_at = now() WHERE id = ${contactId}`);
    const response = await ada.call(`/conversations/${conversationId}`);
    expect(response.status).toBe(403);
    expect(ada.token).toBeNull();
  });

  it('loses to a cookie when both arrive', async () => {
    const cookieUser = client(handler, { base: BASE });
    const { conversationId: cookieThread } = await body<{ conversationId: string }>(
      await cookieUser.call('/chat', { body: { message: 'By cookie' } }),
    );
    const cookie = cookieUser.jar.join('; ');
    const cookieContact = cookie.split('=')[1];

    const ada = crossSite();
    const { conversationId: adaThread } = await body<{ conversationId: string }>(
      await ada.call('/chat', { body: { message: 'By header' } }),
    );

    // The cookie decides who this is, and the token the answer carries says so.
    const both = await ada.call(`/conversations/${cookieThread}`, { cookie });
    expect(both.status).toBe(200);
    expect(await verifyVisitorToken(db, ada.token)).toBe(cookieContact);
    expect((await ada.call(`/conversations/${adaThread}`, { cookie })).status).toBe(403);
  });

  it('follows identify: the signed-in contact is who the next token names', async () => {
    const ada = crossSite();
    await ada.call('/chat', { body: { message: 'Before signing in' } });
    const anonymous = await verifyVisitorToken(db, ada.token);

    const identified = await ada.call('/identify', {
      body: {
        token: await signIdentity({ id: 'user_1', email: 'ada@acme.example' }, 'identity-secret'),
      },
    });
    expect(identified.status).toBe(200);
    const { contactId } = await body<{ contactId: string }>(identified);
    // The anonymous visitor was promoted, so their history came with them.
    expect(contactId).toBe(anonymous);
    expect(await verifyVisitorToken(db, ada.token)).toBe(contactId);
    expect((await body<{ items: unknown[] }>(await ada.call('/conversations'))).items).toHaveLength(
      1,
    );

    // Someone else signs in on the same browser: identify wins over the token held.
    const bob = await ada.call('/identify', {
      body: { token: await signIdentity({ id: 'user_2' }, 'identity-secret') },
    });
    const bobId = (await body<{ contactId: string }>(bob)).contactId;
    expect(bobId).not.toBe(contactId);
    expect(await verifyVisitorToken(db, ada.token)).toBe(bobId);
    expect((await body<{ items: unknown[] }>(await ada.call('/conversations'))).items).toHaveLength(
      0,
    );
  });

  it('is told to forget the token on reset', async () => {
    const ada = crossSite();
    await ada.call('/chat', { body: { message: 'Mine' } });
    const reset = await ada.call('/visitor/reset', { body: {} });
    expect(reset.status).toBe(204);
    expect(reset.headers.get(VISITOR_HEADER)).toBe(VISITOR_TOKEN_FORGET);
    expect(ada.token).toBeNull();
    expect((await body<{ items: unknown[] }>(await ada.call('/conversations'))).items).toHaveLength(
      0,
    );
  });

  it('may send the header across origins: the preflight allows it', async () => {
    const preflight = await handler(
      new Request(`${BASE}/chat`, {
        method: 'OPTIONS',
        headers: {
          origin: SITE,
          'access-control-request-method': 'POST',
          'access-control-request-headers': `content-type,${VISITOR_HEADER}`,
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(preflight.headers.get('access-control-allow-headers')).toContain(VISITOR_HEADER);
  });
});

describe('the widget install prompt', () => {
  it('tells an assistant a site on another origin needs corsOrigins, and why', () => {
    const prompt = formatSetupPrompt(widgetInstallPromptSpec('html', { apiPath: BASE }));
    expect(prompt).toContain('corsOrigins');
    expect(prompt).toContain('X-HelpWell-Visitor');
  });
});

describe('a widget on the same site', () => {
  it('is not handed a token even when a script on the API origin asks for one', async () => {
    const same = new URL(BASE).origin;
    const browser = client(handler, { base: BASE });
    await browser.call('/chat', { body: { message: 'hi' } });
    const asked = await browser.call('/conversations', {
      headers: { origin: same, [VISITOR_HEADER]: VISITOR_TOKEN_REQUEST },
    });
    expect(asked.status).toBe(200);
    expect(asked.headers.get(VISITOR_HEADER)).toBeNull();
    const noOrigin = await browser.call('/conversations', {
      headers: { [VISITOR_HEADER]: VISITOR_TOKEN_REQUEST },
    });
    expect(noOrigin.headers.get(VISITOR_HEADER)).toBeNull();
  });

  it('uses the cookie and is never handed a token', async () => {
    const browser = client(handler, { base: BASE });
    const chat = await browser.call('/chat', { body: { message: 'hi' } });
    expect(chat.status).toBe(200);
    expect(chat.headers.get(VISITOR_HEADER)).toBeNull();
    expect(browser.jar.some((c) => c.startsWith('hw_visitor='))).toBe(true);
  });
});
