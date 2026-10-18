/**
 * A visitor token for a widget whose API is on another site.
 *
 * The visitor cookie works while the API and the page share a site. When they
 * do not (the API on a hosting service's domain, the page on the customer's),
 * Safari and other browsers block or partition the cookie, and an anonymous
 * visitor becomes a stranger on every call: no thread survives a reload, and
 * no conversation is ever theirs to read back. So a widget on another site
 * carries its identity in a header instead. It sends `X-HelpWell-Visitor` on
 * every call (`new` until it has a token), the API answers each one with a
 * signed token for whoever the visitor is by the end of that request, and the
 * widget keeps it in localStorage, per API address, and sends it back.
 *
 * The token says what the cookie says, a contact id, but signed with a key
 * this install makes and keeps in its own database, so it cannot be made from
 * a contact id seen somewhere else (a webhook payload, an export). It is then
 * checked exactly as the cookie is, against the database, so an erased
 * contact's token is no token, and every ownership rule reads the same
 * contact id whichever way it arrived. A cookie, when one arrives, wins; the
 * header is only read without one. Identify still decides who someone is:
 * the token is issued for whoever the request ended as, so after `/identify`
 * it is the signed-in contact's, and after `/visitor/reset` it is withdrawn.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { RequestContext } from './context.js';
import { VISITOR_COOKIE } from './identity.js';

/** The request and response header. Lower case, as `Headers` hands it back. */
export const VISITOR_HEADER = 'x-helpwell-visitor';
/** What a widget sends before it has a token: "I cannot keep cookies, give me one". */
export const VISITOR_TOKEN_REQUEST = 'new';
/** What the API answers when the widget should drop the token it sent. */
export const VISITOR_TOKEN_FORGET = 'forget';
/** A year, the same as the cookie. Every answer re-issues it, so an active visitor never expires. */
export const VISITOR_TOKEN_MAX_AGE_S = 365 * 24 * 60 * 60;

const KEY_NAME = 'visitor.signing_key';
const MAX_TOKEN = 300;
const encoder = new TextEncoder();
const keys = new WeakMap<Db, Promise<CryptoKey>>();

/** A token for this contact, good for a year from `now`. */
export async function signVisitorToken(
  db: Db,
  contactId: string,
  now: number = Date.now(),
): Promise<string> {
  const exp = Math.floor(now / 1000) + VISITOR_TOKEN_MAX_AGE_S;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(db),
    encoder.encode(message(contactId, exp)),
  );
  return `v1.${contactId}.${exp}.${base64url(new Uint8Array(signature))}`;
}

/**
 * The contact id a token vouches for, or null when it is not one this
 * install signed, or it has expired. Whether that contact still exists is
 * the caller's check, as it is for the cookie.
 */
export async function verifyVisitorToken(
  db: Db,
  token: unknown,
  now: number = Date.now(),
): Promise<string | null> {
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, contactId, expText, signature] = parts as [string, string, string, string];
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(contactId) || !/^\d{1,12}$/.test(expText)) return null;
  const exp = Number(expText);
  if (exp * 1000 <= now) return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(signature);
  } catch {
    return null;
  }
  // `verify` compares in constant time.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(db),
    bytes as Uint8Array<ArrayBuffer>,
    encoder.encode(message(contactId, exp)),
  );
  return valid ? contactId : null;
}

/** What the caller sent in the header: a token, `new`, or null when it sent none. */
export function presentedVisitorToken(request: Request): string | null {
  const value = request.headers.get(VISITOR_HEADER);
  return value === null ? null : value.trim();
}

/**
 * The response with the header a widget on another site keeps: a fresh
 * token for whoever the visitor now is, or `forget` when the one it sent no
 * longer names anybody (a reset, an erased contact, a token from elsewhere).
 * A request that sent no header, or came from the API's own origin, gets the
 * response back untouched: the cookie is doing the job.
 */
export async function withVisitorToken(
  response: Response,
  context: Pick<RequestContext, 'db' | 'request' | 'cookies' | 'peekContactId'>,
): Promise<Response> {
  const presented = presentedVisitorToken(context.request);
  if (presented === null) return response;
  // Only a caller on another origin is handed one. On the API's own origin
  // the HttpOnly cookie does the job, and a script there has no business
  // turning it into a token it could carry off.
  if (!fromAnotherOrigin(context.request)) return response;

  // A cookie a route chose to set this time says who the visitor is; the
  // contact the request resolved to otherwise. A cleared cookie sets nothing.
  const id = lastVisitorCookie(context.cookies) || context.peekContactId();
  let value: string | null = null;
  try {
    if (id) value = await signVisitorToken(context.db, id);
    else if (presented && presented !== VISITOR_TOKEN_REQUEST) value = VISITOR_TOKEN_FORGET;
  } catch {
    // No key to sign with (a database that is not there yet): the answer
    // still goes out, and the widget asks again next time.
    value = null;
  }
  if (value === null) return response;

  const headers = new Headers(response.headers);
  headers.set(VISITOR_HEADER, value);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/* ---------------------------------------------------------------- helpers */

function message(contactId: string, exp: number): string {
  return `visitor:${contactId}:${exp}`;
}

/** A browser sends `Origin` on every cross-origin call; the API's own pages do not differ from it. */
function fromAnotherOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    return origin !== new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** The value of the last visitor cookie set on a response, '' when it was a clear. */
function lastVisitorCookie(cookies: readonly string[]): string {
  for (let i = cookies.length - 1; i >= 0; i--) {
    const cookie = cookies[i] ?? '';
    if (!cookie.startsWith(`${VISITOR_COOKIE}=`)) continue;
    const raw = cookie.slice(VISITOR_COOKIE.length + 1).split(';')[0] ?? '';
    try {
      return decodeURIComponent(raw);
    } catch {
      return '';
    }
  }
  return '';
}

/** The HMAC key for this install's database, made and stored the first time it is asked for. */
function signingKey(db: Db): Promise<CryptoKey> {
  let key = keys.get(db);
  if (!key) {
    key = loadKey(db).catch((error) => {
      keys.delete(db);
      throw error;
    });
    keys.set(db, key);
  }
  return key;
}

async function loadKey(db: Db): Promise<CryptoKey> {
  const fresh = base64url(crypto.getRandomValues(new Uint8Array(32)));
  // Two instances starting at once both try; the first insert wins and both
  // read back the same key.
  await db.execute(sql`
    INSERT INTO helpwell.install_state (key, value)
    VALUES (${KEY_NAME}, ${JSON.stringify({ secret: fresh })}::jsonb)
    ON CONFLICT (key) DO NOTHING
  `);
  const row = rowsOf<{ value: unknown }>(
    await db.execute(sql`SELECT value FROM helpwell.install_state WHERE key = ${KEY_NAME}`),
  )[0];
  const value = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
  const secret = (value as { secret?: unknown } | undefined)?.secret;
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('The visitor signing key in helpwell.install_state is missing or malformed.');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('not base64url');
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
