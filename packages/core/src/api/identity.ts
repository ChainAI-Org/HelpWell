/**
 * Who is on the other end of a request.
 *
 * Three kinds of caller:
 *   - an identified user, vouched for by a JWT the customer's server signed
 *     with a shared secret, so a browser cannot claim to be someone else (WG-06);
 *   - an anonymous visitor, tracked by a cookie so their conversation survives
 *     a page reload;
 *   - an admin, decided entirely by the host app (DX-08).
 */

import { sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { recordFields } from '../fields/registry.js';
import { idPrefix, newId } from '../ids.js';
import {
  CONSENT_STATES,
  cleanAttributes,
  mergedAttributes,
  setConsent,
} from '../repos/contacts.js';

export const VISITOR_COOKIE = 'hw_visitor';
export const ADMIN_COOKIE = 'hw_admin';

/**
 * What an identify token carries. Everything that is not one of the named
 * claims is an attribute. Attributes merge into what HelpWell already holds:
 * a key set to `null` removes it, and a key left out is kept.
 */
export interface IdentifyClaims {
  /** The customer's own user id. */
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  /** When they signed up to your app, ISO 8601. Drives the "signed up" field. */
  createdAt?: string;
  /** Recorded with the time and "identify" as its source (CT-09). */
  consent?: 'granted' | 'denied' | 'unknown';
  locale?: string | null;
  timezone?: string | null;
  [key: string]: unknown;
}

const encoder = new TextEncoder();

/**
 * Sign an identify token. Customers call this on their server, never in the
 * browser, which is the whole point of it being signed.
 */
export async function signIdentity(
  claims: IdentifyClaims,
  secret: string,
  options: { expiresIn?: string } = {},
): Promise<string> {
  if (!secret) throw new HelpWellError('not_configured', 'No identity secret is set.');
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setSubject(claims.id)
    .setExpirationTime(options.expiresIn ?? '7d')
    .sign(encoder.encode(secret));
}

export async function verifyIdentity(token: string, secret: string): Promise<IdentifyClaims> {
  if (!secret) {
    throw new HelpWellError('not_configured', 'No identity secret is set.', {
      publicMessage: 'Sign-in is not set up.',
    });
  }
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ['HS256'] });
    if (!payload.sub) throw new Error('no subject');
    return { ...(payload as Record<string, unknown>), id: String(payload.sub) } as IdentifyClaims;
  } catch (cause) {
    throw new HelpWellError('unauthorized', 'Identity token is not valid', {
      publicMessage: 'We could not verify who you are.',
      cause,
    });
  }
}

export interface UpsertContactResult {
  contactId: string;
  created: boolean;
}

/** Claims that are fields of their own rather than attributes. */
const RESERVED_CLAIMS = new Set([
  'id',
  'email',
  'name',
  'avatarUrl',
  'consent',
  'locale',
  'timezone',
  'createdAt',
  'iat',
  'exp',
  'nbf',
  'sub',
]);

/**
 * A claim that updates a column: a string sets it, an explicit null clears
 * it, and leaving the claim out leaves the column alone.
 */
function claimText(claims: IdentifyClaims, key: string, max: number): string | null | undefined {
  if (!(key in claims)) return undefined;
  const value = claims[key];
  if (value === null) return null;
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

/**
 * Create or update the contact behind an identify call.
 *
 * The external id is the identity: it is what the host app signed. Matching
 * is by that first, then by the anonymous visitor cookie from the same
 * browser so a person who used the widget before signing in keeps one record.
 *
 * Never by email. An anonymous row's email is whatever someone typed into a
 * form, and matching on it let a stranger type a victim's address, wait for
 * the victim to sign in, and end up holding the victim's conversations.
 *
 * Everything merges. Attributes the token carries are set, an attribute set
 * to null is removed, and an attribute the token leaves out is kept; the same
 * goes for name, email, avatar, locale, timezone and consent. A page that
 * signs a lighter token than the dashboard does must not erase what the
 * dashboard's token said.
 */
export async function upsertIdentifiedContact(
  db: Db,
  claims: IdentifyClaims,
  options: { visitorId?: string | null } = {},
): Promise<UpsertContactResult> {
  const now = new Date();
  const email =
    typeof claims.email === 'string'
      ? claims.email.trim().toLowerCase()
      : claims.email === null
        ? null
        : undefined;
  const attributes = cleanAttributes(
    Object.fromEntries(Object.entries(claims).filter(([key]) => !RESERVED_CLAIMS.has(key))),
  );

  // An email is a label, unique among the people the host app has vouched
  // for. If another identified contact already carries this one — two host
  // accounts sharing an inbox, or a host-side bug — this record keeps its
  // external id and goes without the email, rather than failing the sign-in
  // or being merged into a stranger.
  const emailTaken = email
    ? await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          sql`lower(email) = ${email} AND identified = true AND deleted_at IS NULL
              AND (external_id IS NULL OR external_id <> ${claims.id})`,
        )
        .limit(1)
    : [];

  const signedUp = typeof claims.createdAt === 'string' ? new Date(claims.createdAt) : null;
  const set: Partial<typeof contacts.$inferInsert> = {};
  if (email !== undefined) set.email = emailTaken.length > 0 ? null : email;
  const name = claimText(claims, 'name', 200);
  if (name !== undefined) set.name = name;
  const avatarUrl = claimText(claims, 'avatarUrl', 2000);
  if (avatarUrl !== undefined) set.avatarUrl = avatarUrl;
  const locale = claimText(claims, 'locale', 40);
  if (locale !== undefined) set.locale = locale;
  const timezone = claimText(claims, 'timezone', 80);
  if (timezone !== undefined) set.timezone = timezone;
  if (signedUp && !Number.isNaN(signedUp.getTime())) set.signedUpAt = signedUp;
  const consent = CONSENT_STATES.find((state) => state === claims.consent);

  const update = async (contactId: string, promoting = false) => {
    await db
      .update(contacts)
      .set({
        // A promoted visitor's email is whatever they typed into a form. It
        // does not become a vouched-for address just because they signed in.
        // An imported one is kept, unless someone vouched-for already has it.
        ...(email === undefined
          ? promoting
            ? { email: null }
            : {
                email: sql`CASE WHEN identified OR email IS NULL THEN email
                  WHEN EXISTS (SELECT 1 FROM helpwell.contacts o
                    WHERE lower(o.email) = lower(helpwell.contacts.email) AND o.identified
                      AND o.deleted_at IS NULL AND o.id <> helpwell.contacts.id)
                  THEN NULL ELSE email END`,
              }
          : {}),
        ...set,
        externalId: claims.id,
        identified: true,
        attributes: mergedAttributes(sql`attributes`, attributes),
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(sql`id = ${contactId}`);
  };
  const finish = async (contactId: string) => {
    if (consent) await setConsent(db, contactId, consent, 'identify', now);
    await recordFields(db, attributes, 'app', now);
  };

  const existing = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`external_id = ${claims.id} AND deleted_at IS NULL`)
    .limit(1);

  if (existing[0]) {
    await update(existing[0].id);
    await finish(existing[0].id);
    return { contactId: existing[0].id, created: false };
  }

  // Same browser, first sign-in: promote the anonymous visitor rather than
  // orphaning their history. Only an unidentified row is ever promoted, and
  // it keeps the source it arrived with.
  if (options.visitorId) {
    const visitor = await db
      .select({ id: contacts.id, identified: contacts.identified })
      .from(contacts)
      .where(sql`id = ${options.visitorId} AND deleted_at IS NULL`)
      .limit(1);
    if (visitor[0] && !visitor[0].identified) {
      await update(visitor[0].id, true);
      await finish(visitor[0].id);
      return { contactId: visitor[0].id, created: false };
    }
  }

  const id = newId(idPrefix.contact);
  await db.insert(contacts).values({
    id,
    source: 'identify',
    ...set,
    externalId: claims.id,
    identified: true,
    attributes: Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== null),
    ),
    lastSeenAt: now,
    updatedAt: now,
  });
  await finish(id);
  return { contactId: id, created: true };
}

/** Get or create the anonymous visitor behind a cookie. */
export async function ensureVisitor(db: Db, visitorId: string | null): Promise<string> {
  if (visitorId) {
    const rows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(sql`id = ${visitorId} AND deleted_at IS NULL`)
      .limit(1);
    if (rows[0]) {
      await db.update(contacts).set({ lastSeenAt: new Date() }).where(sql`id = ${rows[0].id}`);
      return rows[0].id;
    }
  }
  const id = newId(idPrefix.contact);
  await db.insert(contacts).values({ id, source: 'widget', identified: false });
  return id;
}

/* --------------------------------------------------------------- cookies */

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    // A malformed value (`%` on its own) is something any page on a sibling
    // subdomain can plant. It is a missing cookie, not a crashed request.
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  options: { maxAge?: number; secure?: boolean; sameSite?: 'Lax' | 'None' | 'Strict' } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${options.sameSite ?? 'Lax'}`,
    `Max-Age=${options.maxAge ?? 60 * 60 * 24 * 365}`,
  ];
  if (options.secure ?? true) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Constant-time string compare for the fallback admin password, so a timing
 * side channel cannot leak it a character at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
