/**
 * Signatures that prove a submission came through a form HelpWell drew.
 *
 * A hosted edition enriches only the addresses these forms capture, so a
 * submission has to be provably real, not a script posting to the API. The
 * first proof is the render token: when a form is drawn, the server signs
 * which form, variant and placement it is, the page, and the moment it was
 * issued. A submission without a valid one is refused, and the time since it
 * was issued is how long the visitor took to fill the form in, which is
 * measured on the server where a script cannot fake it.
 *
 * The same key signs the lead-magnet download links (so the file's address
 * is not handed to anyone who has not submitted, and the link expires) and a
 * giveaway entrant's key (so only they can claim their bonus entries).
 *
 * The key is made on first use and kept in the database, so every instance
 * of the app shares it without anyone configuring a secret. It never leaves
 * the server.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { FormPlacement } from './schema.js';

const KEY_NAME = 'forms.signing_key';
/** A render token is good for a day: long enough for a tab left open over lunch. */
export const RENDER_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const keys = new WeakMap<Db, Promise<CryptoKey>>();

/** The HMAC key for this database, made and stored the first time it is asked for. */
export function signingKey(db: Db): Promise<CryptoKey> {
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
    throw new Error('The forms signing key in helpwell.install_state is missing or malformed.');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmac(db: Db, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(db),
    new TextEncoder().encode(message),
  );
  return base64url(new Uint8Array(signature));
}

async function verifyHmac(db: Db, message: string, signature: string): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(signature);
  } catch {
    return false;
  }
  // `verify` compares in constant time.
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(db),
    bytes as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(message),
  );
}

/* ------------------------------------------------------------ render token */

export interface RenderClaims {
  /** The form. */
  formId: string;
  /** Which version of it was drawn. */
  version: number;
  variant: string;
  placement: FormPlacement;
  /** The page path it was drawn on. */
  page: string;
  /** When it was drawn, in ms since the epoch. */
  issuedAt: number;
  /** Random, and unique per drawing: what makes the token single-use. */
  nonce: string;
}

export async function signRenderToken(
  db: Db,
  claims: Omit<RenderClaims, 'nonce' | 'issuedAt'> & { issuedAt?: number; nonce?: string },
): Promise<string> {
  const full: RenderClaims = {
    ...claims,
    page: claims.page.slice(0, 300),
    issuedAt: claims.issuedAt ?? Date.now(),
    nonce: claims.nonce ?? base64url(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        f: full.formId,
        r: full.version,
        v: full.variant,
        p: full.placement,
        u: full.page,
        t: full.issuedAt,
        n: full.nonce,
      }),
    ),
  );
  return `v1.${body}.${await hmac(db, `render:${body}`)}`;
}

export type RenderTokenProblem = 'missing' | 'malformed' | 'signature' | 'expired' | 'wrong_form';

/** The claims in a render token, or why it is not one. */
export async function verifyRenderToken(
  db: Db,
  token: unknown,
  expected: { formId: string; now?: number },
): Promise<{ ok: true; claims: RenderClaims } | { ok: false; problem: RenderTokenProblem }> {
  if (typeof token !== 'string' || !token) return { ok: false, problem: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || token.length > 2000) {
    return { ok: false, problem: 'malformed' };
  }
  const [, body, signature] = parts as [string, string, string];
  if (!(await verifyHmac(db, `render:${body}`, signature))) {
    return { ok: false, problem: 'signature' };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  } catch {
    return { ok: false, problem: 'malformed' };
  }
  const claims: RenderClaims = {
    formId: String(raw.f ?? ''),
    version: Number(raw.r) || 1,
    variant: String(raw.v ?? ''),
    placement: String(raw.p ?? '') as FormPlacement,
    page: String(raw.u ?? ''),
    issuedAt: Number(raw.t) || 0,
    nonce: String(raw.n ?? ''),
  };
  if (claims.formId !== expected.formId) return { ok: false, problem: 'wrong_form' };
  const age = (expected.now ?? Date.now()) - claims.issuedAt;
  if (age > RENDER_TOKEN_MAX_AGE_MS || age < -60_000) return { ok: false, problem: 'expired' };
  return { ok: true, claims };
}

/* ---------------------------------------------------------- download links */

/**
 * The path, under the API, of a signed download for one submission. Relative
 * so the widget prefixes its own API address.
 */
export async function signedDownloadPath(
  db: Db,
  input: { formId: string; submissionId: string; expiresAt: number },
): Promise<string> {
  const exp = Math.floor(input.expiresAt / 1000);
  const sig = await hmac(db, `download:${input.formId}:${input.submissionId}:${exp}`);
  return `/forms/${encodeURIComponent(input.formId)}/download/${encodeURIComponent(input.submissionId)}?exp=${exp}&sig=${sig}`;
}

export async function verifyDownload(
  db: Db,
  input: { formId: string; submissionId: string; exp: string | null; sig: string | null },
  now: number = Date.now(),
): Promise<'ok' | 'invalid' | 'expired'> {
  const exp = Number(input.exp);
  if (!input.sig || !Number.isInteger(exp)) return 'invalid';
  const valid = await verifyHmac(
    db,
    `download:${input.formId}:${input.submissionId}:${exp}`,
    input.sig,
  );
  if (!valid) return 'invalid';
  return exp * 1000 < now ? 'expired' : 'ok';
}

/* -------------------------------------------------------------- entry keys */

/** What a giveaway entrant holds to claim bonus entries on their own entry. */
export async function signEntryKey(db: Db, entryId: string): Promise<string> {
  return `${entryId}.${await hmac(db, `entry:${entryId}`)}`;
}

/** The entry id an entry key is for, or null. */
export async function verifyEntryKey(db: Db, key: unknown): Promise<string | null> {
  if (typeof key !== 'string' || key.length > 300) return null;
  const at = key.lastIndexOf('.');
  if (at <= 0) return null;
  const entryId = key.slice(0, at);
  return (await verifyHmac(db, `entry:${entryId}`, key.slice(at + 1))) ? entryId : null;
}

/* ------------------------------------------------------------------ helpers */

/**
 * A short, stable, unkeyed hash. Not for anything that can be guessed and
 * hashed back, such as an IP address: unique visitors are counted with this
 * install's keyed hash instead (`keyedHash`, ip-hash.ts).
 */
export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest)).slice(0, 22);
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('not base64url');
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
