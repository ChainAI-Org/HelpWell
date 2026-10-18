/**
 * The admin token: a way into the dashboard from a browser that still fails
 * closed, for an install whose own sign-in is not wired to `isAdmin` yet.
 *
 * HelpWell has no accounts (DX-08), and this is not one: no user, no
 * password to reset, nothing stored. The host sets HELPWELL_ADMIN_TOKEN (at
 * least 32 characters) and passes it as `adminToken`, and whoever holds it is
 * an admin, as they already are to the API with core's `adminToken`. A
 * browser cannot send a bearer header by itself, so the locked-out page
 * offers a form that takes the token once and keeps it in the `hw_admin`
 * cookie the API also reads: HttpOnly, SameSite=Lax, Secure except on
 * http://localhost, and scoped to the path the dashboard and the API share,
 * so the settings the dashboard saves through the API carry it too. A cookie
 * holding a secret cannot be forged the way a `role=admin` cookie could.
 * Lax, not Strict, so a dashboard link followed from chat or email opens the
 * page rather than the token form; a cross-site post still goes without the
 * cookie, and core's origin check refuses one that carries it anyway.
 *
 * Wrong tokens are counted per client address, under the install's keyed
 * hash of it and never the address itself. Past the limit every attempt is
 * refused until the window ends, the right token included, since a limit
 * that still checked the token would not stop anyone guessing.
 *
 * Without `adminToken` none of this exists: no form, no routes, and the
 * dashboard answers to `isAdmin` alone.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { hashIp, rateLimit } from '@helpwell/core/agent';
import { ADMIN_COOKIE, assertSameOrigin, clientIp, readCookie } from '@helpwell/core/api';
import { type Db, schema } from '@helpwell/core/db';
import { html, link, type RawHtml, stripMountPath } from '@helpwell/ui';
import { and, eq } from 'drizzle-orm';
import { renderBare } from './layout.js';

/** Shorter than this, a token is guessable, and is treated as no token at all. */
export const ADMIN_TOKEN_MIN_LENGTH = 32;

/** Wrong tokens allowed from one address in one window. */
const ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;
/** A week, after which the browser asks for the token again. */
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

const SIGN_IN = '/_admin-token';
const SIGN_OUT = '/_admin-token/sign-out';

export interface AdminTokenGate {
  /** Whether a usable token is configured, so the form is offered. */
  readonly enabled: boolean;
  /** Whether the request carries the token, as a bearer token or in the cookie. */
  admits(request: Request): boolean;
  /** Where the rail's sign-out posts, when the request came in with the cookie; else undefined. */
  signOutAction(request: Request): string | undefined;
  /** The sign-in and sign-out posts; null for any other path, or when there is no token. */
  route(request: Request, path: string): Promise<Response | null>;
  /** The 401 page: how to get in, with the token form when there is a token. */
  lockedOut(request: Request): Response;
}

export interface AdminTokenOptions {
  db: Db;
  token: string | undefined;
  /** Where the dashboard is mounted, from `mountPath`: '' at the root. */
  basePath: string;
  /** Where the API is mounted, from `mountPath`. */
  apiPath: string;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** The longest path both `a` and `b` sit under, by whole segments: `/` when they share none. */
export function sharedPath(a: string, b: string): string {
  const left = a.split('/').filter(Boolean);
  const right = b.split('/').filter(Boolean);
  const shared: string[] = [];
  for (let i = 0; i < Math.min(left.length, right.length) && left[i] === right[i]; i++) {
    shared.push(left[i]!);
  }
  return `/${shared.join('/')}`;
}

/**
 * Plain http is only fine for a browser on the same machine; everywhere else
 * the cookie is Secure. The host is the one the browser asked for: a server
 * bound to every interface (`next dev -H 0.0.0.0`) builds `request.url` from
 * 0.0.0.0, while the browser is on localhost.
 */
function plainLocalhost(request: Request): boolean {
  const url = new URL(request.url);
  let host = url.hostname;
  const header = request.headers.get('host');
  if (header) {
    try {
      host = new URL(`http://${header}`).hostname;
    } catch {
      // A malformed Host header is not a local browser.
      return false;
    }
  }
  return (
    url.protocol === 'http:' &&
    (host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '[::1]')
  );
}

function isControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/** Where to go after signing in: a path under the dashboard, or its home. */
function safeNext(value: unknown, basePath: string): string {
  const home = link(basePath, '/');
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return home;
  if (/[\\\s]/.test(value) || [...value].some(isControl)) return home;
  try {
    const resolved = new URL(value, 'http://dashboard.invalid');
    if (resolved.origin !== 'http://dashboard.invalid' || resolved.pathname.startsWith('//')) {
      return home;
    }
    if (stripMountPath(resolved.pathname, basePath) === null) return home;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return home;
  }
}

export function createAdminTokenGate(options: AdminTokenOptions): AdminTokenGate {
  const { db, basePath, apiPath } = options;
  let token: string | null = options.token ?? null;
  if (token !== null && token.length < ADMIN_TOKEN_MIN_LENGTH) {
    console.warn(
      `HelpWell: the dashboard's adminToken is shorter than ${ADMIN_TOKEN_MIN_LENGTH} characters, so it is ignored. Generate one with \`openssl rand -hex 32\`.`,
    );
    token = null;
  }
  // The API is usually beside the dashboard, not under it: the cookie must
  // reach both, or the settings the dashboard saves through the API are refused.
  const cookiePath = apiPath.startsWith('/') ? sharedPath(basePath, apiPath) : link(basePath, '/');
  const signInAction = link(basePath, SIGN_IN);
  const signOutPath = link(basePath, SIGN_OUT);

  const matches = (presented: string | null | undefined): boolean =>
    token !== null && !!presented && timingSafeEqual(digest(presented), digest(token));

  const cookie = (request: Request, value: string, maxAge: number) =>
    [
      `${ADMIN_COOKIE}=${encodeURIComponent(value)}`,
      `Path=${cookiePath}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
      ...(plainLocalhost(request) ? [] : ['Secure']),
    ].join('; ');

  /** How many wrong tokens this address has sent in the current window, without counting one. */
  async function failures(bucket: string): Promise<number> {
    const now = Date.now();
    const windowAt = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
    const rows = await db
      .select({ count: schema.rateCounters.count })
      .from(schema.rateCounters)
      .where(
        and(eq(schema.rateCounters.bucket, bucket), eq(schema.rateCounters.windowAt, windowAt)),
      );
    return rows[0]?.count ?? 0;
  }

  function page(
    request: Request,
    status: number,
    extra: { error?: string; next?: string; headers?: Record<string, string> } = {},
  ): Response {
    const url = new URL(request.url);
    const next = extra.next ?? safeNext(`${url.pathname}${url.search}`, basePath);
    const body = lockedOutBody({
      basePath,
      apiPath,
      form: token ? { action: signInAction, next } : null,
      error: extra.error,
    });
    return new Response(renderBare('Sign in', body, basePath), {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...extra.headers,
      },
    });
  }

  return {
    enabled: token !== null,

    admits(request) {
      const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
      return matches(bearer) || matches(readCookie(request, ADMIN_COOKIE));
    },

    signOutAction(request) {
      return matches(readCookie(request, ADMIN_COOKIE)) ? signOutPath : undefined;
    },

    async route(request, path) {
      if (token === null || (path !== SIGN_IN && path !== SIGN_OUT)) return null;
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      }
      // A form on another site must not sign anyone in or out.
      try {
        assertSameOrigin(request);
      } catch {
        return new Response('That request did not come from this site.', { status: 403 });
      }

      if (path === SIGN_OUT) {
        return new Response(null, {
          status: 303,
          headers: { location: link(basePath, '/'), 'set-cookie': cookie(request, '', 0) },
        });
      }

      const form = await request.formData().catch(() => null);
      const next = safeNext(form?.get('next'), basePath);
      const ip = clientIp(request);
      const bucket = `admin-token:${ip ? await hashIp(db, ip) : 'unknown'}`;
      if ((await failures(bucket)) >= ATTEMPTS) {
        const minutes = Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 60_000);
        return page(request, 429, {
          next,
          error: `Too many wrong tokens from here. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          headers: { 'retry-after': String(minutes * 60) },
        });
      }

      const presented = form?.get('token');
      if (typeof presented === 'string' && matches(presented.trim())) {
        return new Response(null, {
          status: 303,
          headers: { location: next, 'set-cookie': cookie(request, token, COOKIE_MAX_AGE) },
        });
      }
      await rateLimit(db, bucket, ATTEMPTS, WINDOW_MS);
      return page(request, 401, { next, error: 'That is not the admin token.' });
    },

    lockedOut(request) {
      return page(request, 401);
    },
  };
}

/**
 * What an unauthenticated request sees.
 *
 * Deliberately not a login form for accounts: HelpWell has none, and
 * inventing one would be a second password for a team to look after. It
 * names the two ways in, the app's own sign-in through `isAdmin` or the
 * admin token, and offers the token form only when a token is set. A bare
 * page, too: the rail and the island are for admins.
 */
function lockedOutBody(options: {
  basePath: string;
  apiPath: string;
  form: { action: string; next: string } | null;
  error?: string;
}): RawHtml {
  const { basePath, apiPath, form, error } = options;
  const example = `createDashboard({
  db,
  basePath: ${JSON.stringify(basePath || '/')},
  apiPath: ${JSON.stringify(apiPath || '/')},
  isAdmin: (request) => myAuth(request).role === 'admin',
})`;
  return html`<div class="db-empty" style="padding-top:120px;max-width:560px;margin:0 auto">
  <h2>This dashboard is closed</h2>
  ${
    form
      ? html`<p>Enter your admin token to open it.</p>
  <form method="post" action="${form.action}" style="margin:18px auto;text-align:start">
    <label class="db-field">
      <span class="db-field__label">Admin token</span>
      <input class="db-input" type="password" name="token" autocomplete="off" required>
      ${error ? html`<p class="db-field__hint" role="alert" style="color:var(--hw-bad)">${error}</p>` : null}
    </label>
    <input type="hidden" name="next" value="${form.next}">
    <button class="db-btn db-btn--primary" type="submit">Sign in</button>
  </form>`
      : null
  }
  <p>
    HelpWell does not have its own accounts. There are two ways in: replace
    <code>isAdmin</code> in your mount code with your app's own admin check,
    so its admins get in with the sign-in they already have, or set
    <code>HELPWELL_ADMIN_TOKEN</code> (at least 32 characters), pass it to
    <code>createDashboard</code> as <code>adminToken</code>, and enter it here.
  </p>
  <pre class="db-code" style="max-width:520px;margin:18px auto;text-align:start">${example}</pre>
</div>`;
}
