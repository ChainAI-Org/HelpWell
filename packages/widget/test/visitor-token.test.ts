/**
 * The visitor token, from the widget's side: on another site it asks for a
 * token, keeps the one it is given under that API's address, sends it on
 * every call (uploads included), drops it when told to or on reset, and
 * copes with a page that blocks storage. On its own site it sends nothing
 * and the cookie does the job, as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, VISITOR_HEADER } from '../src/api.js';
import { Widget } from '../src/widget.js';
import { baseConfig, flush } from './helpers/server.js';

const HOSTED = 'https://api.hosted.example/p/acme/api';
const KEY = `helpwell:visitor:${HOSTED}`;

interface Seen {
  path: string;
  token: string | null;
}

/**
 * A stand-in for the API's side of the protocol: `new` gets a fresh token,
 * a token it issued is honoured and re-issued, and anything else is told to
 * forget itself. `/visitor/reset` always says forget.
 */
function tokenServer(routes: Record<string, unknown> = {}) {
  const seen: Seen[] = [];
  let issued = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), location.href);
    const path = url.pathname.replace(/^\/(p\/[a-z]+\/api|api\/helpwell)/, '');
    const token = new Headers(init?.headers).get(VISITOR_HEADER);
    seen.push({ path, token });
    const headers = new Headers({ 'content-type': 'application/json' });
    if (path === '/visitor/reset') headers.set(VISITOR_HEADER, 'forget');
    else if (token === 'new' && init?.method === 'POST')
      headers.set(VISITOR_HEADER, `v1.con_${++issued}.9.sig`);
    else if (token?.startsWith('v1.')) headers.set(VISITOR_HEADER, token);
    else if (token && token !== 'new') headers.set(VISITOR_HEADER, 'forget');
    if (path === '/visitor/reset') return new Response(null, { status: 204, headers });
    const body =
      path === '/config'
        ? baseConfig()
        : path === '/chat'
          ? {
              conversationId: 'cnv_1',
              messageId: 'msg_1',
              text: 'Hi',
              citations: [],
              unresolved: false,
              degraded: false,
            }
          : (routes[path] ?? { ok: true });
    return new Response(JSON.stringify(body), { status: 200, headers });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Api on another site', () => {
  it('asks for a token, keeps it under the API address, and sends it back', async () => {
    const server = tokenServer();
    const api = new Api({ baseUrl: HOSTED, fetch: server.fetch });

    await api.config();
    expect(server.seen[0]).toEqual({ path: '/config', token: 'new' });
    expect(localStorage.getItem(KEY)).toBeNull();

    await api.chat({ message: 'hello' });
    expect(server.seen[1]).toEqual({ path: '/chat', token: 'new' });
    expect(localStorage.getItem(KEY)).toBe('v1.con_1.9.sig');

    await api.conversations();
    expect(server.seen[2]).toEqual({ path: '/conversations', token: 'v1.con_1.9.sig' });

    // A later page load, a new client: the same visitor.
    const again = new Api({ baseUrl: `${HOSTED}/`, fetch: server.fetch });
    await again.config();
    expect(server.seen[3]?.token).toBe('v1.con_1.9.sig');
  });

  it('drops the token when the API says it names nobody', async () => {
    localStorage.setItem(KEY, 'stale-token');
    const server = tokenServer();
    const api = new Api({ baseUrl: HOSTED, fetch: server.fetch });
    await api.config();
    expect(server.seen[0]?.token).toBe('stale-token');
    expect(localStorage.getItem(KEY)).toBeNull();
    await api.config();
    expect(server.seen[1]?.token).toBe('new');
  });

  it('forgets the token on reset, even when the API cannot be reached', async () => {
    localStorage.setItem(KEY, 'v1.con_7.9.sig');
    const server = tokenServer();
    const api = new Api({ baseUrl: HOSTED, fetch: server.fetch });
    await api.resetVisitor();
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.setItem(KEY, 'v1.con_7.9.sig');
    const offline = new Api({
      baseUrl: HOSTED,
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(offline.resetVisitor()).rejects.toMatchObject({ code: 'offline' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a separate token for each API a page talks to', async () => {
    const first = tokenServer();
    const second = tokenServer();
    await new Api({ baseUrl: HOSTED, fetch: first.fetch }).chat({ message: 'a' });
    const other = 'https://api.hosted.example/p/other/api';
    await new Api({ baseUrl: other, fetch: second.fetch }).config();
    expect(second.seen[0]?.token).toBe('new');
    expect(localStorage.getItem(KEY)).toBe('v1.con_1.9.sig');
  });

  it('holds the token in memory when the page blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const server = tokenServer();
    const api = new Api({ baseUrl: HOSTED, fetch: server.fetch });
    await api.chat({ message: 'hello' });
    await api.conversations();
    expect(server.seen[1]?.token).toBe('v1.con_1.9.sig');
  });
});

describe('Api on its own site', () => {
  it('sends no token: the cookie carries the visitor', async () => {
    const server = tokenServer();
    const api = new Api({ baseUrl: '/api/helpwell', fetch: server.fetch });
    await api.chat({ message: 'hello' });
    await api.config();
    expect(server.seen.map((s) => s.token)).toEqual([null, null]);
    expect(localStorage.length).toBe(0);
  });

  it('can be told either way', async () => {
    const server = tokenServer();
    await new Api({ baseUrl: HOSTED, fetch: server.fetch, visitorToken: false }).config();
    await new Api({ baseUrl: '/api/helpwell', fetch: server.fetch, visitorToken: true }).config();
    expect(server.seen.map((s) => s.token)).toEqual([null, 'new']);
  });
});

describe('a widget mounted from another site', () => {
  let widget: Widget | null = null;

  afterEach(() => {
    widget?.destroy();
    widget = null;
  });

  it('identifies with the token it holds, and keeps the one identify hands back', async () => {
    const server = tokenServer({ '/identify': { contactId: 'con_1', identified: true } });
    localStorage.setItem(KEY, 'v1.con_1.9.sig');
    widget = new Widget({ apiUrl: HOSTED, fetch: server.fetch, token: 'signed-identify-token' });
    await widget.mount();
    await flush();

    const identify = server.seen.find((s) => s.path === '/identify');
    expect(identify?.token).toBe('v1.con_1.9.sig');
    expect(server.seen.every((s) => s.token !== null)).toBe(true);

    await widget.reset();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
