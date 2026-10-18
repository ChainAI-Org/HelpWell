/**
 * Who is an admin in the playground, and why there are two answers.
 *
 * Ridgeline has no real accounts, so for someone trying it on their own
 * machine, "Sign in as an admin" in the header sets a cookie that stands in
 * for a session. Anyone can set that cookie, so it is trusted only while
 * nobody else can reach the server: it listens on a loopback address and is
 * not a production build. Anywhere else, such as a demo deployed for others
 * or the end-to-end suite's production build, the playground uses the same
 * fail-closed check `helpwell init` prints: the only admin is whoever holds
 * HELPWELL_ADMIN_TOKEN (32 characters or more), entered on the dashboard's
 * sign-in page or sent as a bearer token, and while it is unset, nobody is.
 *
 * The choice is made once, on the first request, when the server is
 * certainly listening, and said in the log.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Server } from 'node:net';
import { readCookie, ADMIN_COOKIE as TOKEN_COOKIE } from '@helpwell/core/api';
import { ADMIN_COOKIE as DEMO_COOKIE } from './paths';

/** HELPWELL_ADMIN_TOKEN, when it is long enough to be a secret. */
export function adminToken(): string | undefined {
  const token = process.env.HELPWELL_ADMIN_TOKEN ?? '';
  return token.length >= 32 ? token : undefined;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** The fail-closed check: the admin token, as a bearer token or in the cookie the dashboard sets. */
function hasAdminToken(request: Request): boolean {
  const token = adminToken();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  return [bearer, readCookie(request, TOKEN_COOKIE)].some(
    (presented) => !!token && !!presented && timingSafeEqual(digest(presented), digest(token)),
  );
}

/** The demo stand-in for a session: the cookie "Sign in as an admin" sets. Not security. */
function hasDemoCookie(request: Request): boolean {
  return readCookie(request, DEMO_COOKIE) === 'yes';
}

/**
 * The addresses this process's servers listen on, or none when it cannot
 * tell. Next.js does not say which address it bound (it prints `localhost`
 * for every interface too), so this asks the servers themselves, through
 * Node's list of open handles. Not knowing means not loopback.
 */
function listeningAddresses(): string[] {
  const handles =
    (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  const addresses: string[] = [];
  for (const handle of handles) {
    if (!(handle instanceof Server) || !handle.listening) continue;
    const address = handle.address();
    if (address && typeof address === 'object') addresses.push(address.address);
  }
  return addresses;
}

function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

export interface AdminCheck {
  isAdmin: (request: Request) => boolean;
  /** Passed to the API and the dashboard, so the sign-in page can take it. */
  adminToken: string | undefined;
}

/** Which check this server uses, decided now and logged. */
export function chooseAdminCheck(): AdminCheck {
  const production = process.env.NODE_ENV === 'production';
  const addresses = listeningAddresses();
  const local = addresses.length > 0 && addresses.every(isLoopback);
  const token = adminToken();

  if (!production && local) {
    console.log(
      `[ridgeline] Admin check: the demo cookie ("Sign in as an admin" in the header), because this server only listens on ${addresses.join(', ')} and is not a production build.`,
    );
    return {
      isAdmin: (request) => hasDemoCookie(request) || hasAdminToken(request),
      adminToken: token,
    };
  }

  const why = production
    ? 'this is a production build'
    : addresses.length > 0
      ? `this server listens on ${addresses.join(', ')}, not only on this machine`
      : 'this server could not tell which address it listens on';
  console.log(
    `[ridgeline] Admin check: HELPWELL_ADMIN_TOKEN only, because ${why}. ${
      token
        ? 'Enter the token at /admin/helpwell.'
        : 'It is unset (or under 32 characters), so the dashboard is closed to everyone; run `pnpm dev` for the demo sign-in.'
    }`,
  );
  return { isAdmin: hasAdminToken, adminToken: token };
}
