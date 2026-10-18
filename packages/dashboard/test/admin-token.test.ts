/**
 * The admin token gate (admin-token.ts): a browser gets into the dashboard by
 * entering HELPWELL_ADMIN_TOKEN, never by a cookie it made up; guessing is
 * limited per address; and with no token configured there is no form at all.
 */

import { createHelpWellHandler } from '@helpwell/core';
import type { Db } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'https://app.acme.test';
const BASE = '/admin/helpwell';
const TOKEN = '9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c0b2d4f6e8a0c2e4f6a8b0d2f4e6a8c0b';

let db: Db;
let dashboard: DashboardHandler;

function make(config: Partial<Parameters<typeof createDashboard>[0]> = {}): DashboardHandler {
  return createDashboard({ db, basePath: BASE, apiPath: '/api/helpwell', ...config });
}

function get(path: string, headers: Record<string, string> = {}, origin = ORIGIN) {
  return dashboard(new Request(`${origin}${BASE}${path}`, { headers }));
}

/** The token form, posted the way a browser posts it from this site. */
function signIn(
  token: string,
  options: { next?: string; ip?: string; origin?: string; headers?: Record<string, string> } = {},
) {
  const origin = options.origin ?? ORIGIN;
  return dashboard(
    new Request(`${origin}${BASE}/_admin-token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        'x-forwarded-for': options.ip ?? '203.0.113.7',
        ...options.headers,
      },
      body: new URLSearchParams({ token, next: options.next ?? `${BASE}/conversations` }),
    }),
  );
}

/** The `name=value` part of a Set-Cookie, to send back. */
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0]!;

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
  dashboard = make({ adminToken: TOKEN });
});

describe('the admin token gate', () => {
  it('refuses a cookie anyone could set, and offers the token form instead', async () => {
    for (const cookie of ['role=admin', 'hw_admin=yes', `hw_admin=${TOKEN.slice(0, -1)}0`, '']) {
      const response = await get('/conversations', cookie ? { cookie } : {});
      expect(response.status, cookie).toBe(401);
      const page = await response.text();
      expect(page).toContain('Enter your admin token');
      expect(page).toContain('type="password"');
      expect(page).toContain(`action="${BASE}/_admin-token"`);
      // Both ways in are explained, whichever is set up.
      expect(page).toContain('isAdmin');
      expect(page).toContain('HELPWELL_ADMIN_TOKEN');
    }
  });

  it('sets a strict, HttpOnly cookie for the right token, and that cookie gets in', async () => {
    const response = await signIn(TOKEN);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/conversations`);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`hw_admin=${TOKEN}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
    // The path the dashboard and the API share, so settings saves carry it too.
    expect(setCookie).toContain('Path=/;');

    const inside = await get('/conversations', { cookie: cookieOf(response) });
    expect(inside.status).toBe(200);
    const page = await inside.text();
    expect(page).toContain(`action="${BASE}/_admin-token/sign-out"`);
    expect(page).toContain('Sign out');
  });

  it('lets the API accept the same cookie when it is given the same token', async () => {
    const api = createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      adminToken: TOKEN,
      env: {},
    });
    const cookie = cookieOf(await signIn(TOKEN));
    const response = await api(
      new Request(`${ORIGIN}/api/helpwell/admin/settings`, {
        method: 'PATCH',
        headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ product: { name: 'Acme Two' } }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('is not Secure on plain http://localhost, where a browser would drop a Secure cookie', async () => {
    const response = await signIn(TOKEN, { origin: 'http://localhost:3000' });
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
    // A server on every interface sees 0.0.0.0 in its own URL; the browser's Host is what counts.
    const everywhere = await dashboard(
      new Request(`http://0.0.0.0:3000${BASE}/_admin-token`, {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token: TOKEN }),
      }),
    );
    expect(everywhere.status).toBe(303);
    expect(everywhere.headers.get('set-cookie')).not.toContain('Secure');
    // Anywhere else it is Secure, over http too.
    const remote = await signIn(TOKEN, { origin: 'http://192.0.2.10:3000', ip: '192.0.2.99' });
    expect(remote.headers.get('set-cookie')).toContain('Secure');
  });

  it('says so for a wrong token, then refuses every attempt from that address once past the limit', async () => {
    const wrong = await signIn('not-the-token-at-all');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(await wrong.text()).toContain('That is not the admin token.');

    for (let n = 1; n < 10; n++) expect((await signIn(`wrong-${n}`)).status).toBe(401);
    const limited = await signIn('wrong-again');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.text()).toContain('Too many wrong tokens');
    // The right token too: a limit that still checked it would not stop guessing.
    expect((await signIn(TOKEN)).status).toBe(429);
    // Another address is counted on its own.
    expect((await signIn(TOKEN, { ip: '198.51.100.4' })).status).toBe(303);
  });

  it('refuses a sign-in posted from another site', async () => {
    const response = await signIn(TOKEN, { headers: { origin: 'https://evil.test' } });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('only ever sends someone back inside the dashboard', async () => {
    for (const next of ['https://evil.test/', '//evil.test/x', '/\\evil.test', '/elsewhere']) {
      const response = await signIn(TOKEN, { next, ip: `192.0.2.${next.length}` });
      expect(response.headers.get('location'), next).toBe(BASE);
    }
  });

  it('admits a script with the token as a bearer token', async () => {
    expect((await get('/conversations', { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await get('/conversations', { authorization: 'Bearer nope' })).status).toBe(401);
  });

  it('signs out by clearing the cookie', async () => {
    const cookie = cookieOf(await signIn(TOKEN));
    const response = await dashboard(
      new Request(`${ORIGIN}${BASE}/_admin-token/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: ORIGIN },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(BASE);
    const cleared = response.headers.get('set-cookie') ?? '';
    expect(cleared).toMatch(/^hw_admin=;/);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/;');
  });
});

describe('without an admin token', () => {
  it('shows no form when the host has its own isAdmin and no adminToken', async () => {
    dashboard = make({ isAdmin: (request) => request.headers.get('x-admin') === 'yes' });
    const response = await get('/conversations', { cookie: `hw_admin=${TOKEN}` });
    expect(response.status).toBe(401);
    const page = await response.text();
    expect(page).not.toContain('type="password"');
    expect(page).not.toContain('_admin-token');
    // Posting to the form's address does nothing either.
    expect((await signIn(TOKEN)).status).toBe(401);
    expect((await get('/conversations', { 'x-admin': 'yes' })).status).toBe(200);
  });

  it('ignores a token too short to be a secret, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dashboard = make({ adminToken: 'admin' });
    expect(warn).toHaveBeenCalledTimes(1);
    const page = await (await get('/conversations', { cookie: 'hw_admin=admin' })).text();
    expect(page).not.toContain('type="password"');
    expect((await get('/conversations', { authorization: 'Bearer admin' })).status).toBe(401);
    warn.mockRestore();
  });
});
