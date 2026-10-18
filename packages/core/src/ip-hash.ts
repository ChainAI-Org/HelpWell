/**
 * A keyed one-way hash for IP addresses, and anything else that must be
 * compared without being kept.
 *
 * An IP address is personal data, so HelpWell stores a hash of it: enough to
 * count repeat offenders and rate-limit a flood, not enough to say who sent
 * it. An unkeyed hash is not that. There are only four billion IPv4
 * addresses, and anyone holding a database dump could hash them all in
 * minutes and read every address back. So the hash is an HMAC-SHA256 with a
 * secret this install makes the first time it needs one and keeps in its own
 * database (`helpwell.install_state`, like the visitor-token and form signing
 * keys). Without that secret the hash cannot be reversed or even checked, and
 * two installs hash the same address differently, so their data cannot be
 * joined on it.
 *
 * Within one install the hash is stable, which is all a rate limit or a
 * duplicate check needs. The output is the first 128 bits, as hex.
 */

import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { rowsOf } from './db/rows.js';

const KEY_NAME = 'privacy.hash_key';
/** 128 bits: far past any collision a rate limit could notice. */
export const HASH_HEX_LENGTH = 32;

const encoder = new TextEncoder();
const keys = new WeakMap<Db, Promise<CryptoKey>>();

/**
 * The keyed hash of a value that must be compared but not kept: 32 hex
 * characters. `hashIp` is the same function, named for its usual job.
 */
export async function keyedHash(db: Db, value: string): Promise<string> {
  const digest = await crypto.subtle.sign('HMAC', await hashKey(db), encoder.encode(value.trim()));
  return hexOf(new Uint8Array(digest).subarray(0, HASH_HEX_LENGTH / 2));
}

/**
 * The keyed hash of an IP address, or of anything a rate limit counts in the
 * same way, such as an email address.
 */
export const hashIp: (db: Db, ip: string) => Promise<string> = keyedHash;

/** The HMAC key for this install's database, made and stored the first time it is asked for. */
function hashKey(db: Db): Promise<CryptoKey> {
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
  const fresh = hexOf(crypto.getRandomValues(new Uint8Array(32)));
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
    throw new Error('The privacy hash key in helpwell.install_state is missing or malformed.');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function hexOf(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
