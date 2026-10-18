/**
 * The keyed IP hash (ip-hash.ts): stable within an install, different
 * between installs, and never the address or anything that reverses to it
 * without the install's own secret.
 */

import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { hashIp, recordBlocked } from '../src/agent/guards.js';
import { createHelpWellHandler } from '../src/api.js';
import { rowsOf } from '../src/db/rows.js';
import { HASH_HEX_LENGTH, keyedHash } from '../src/ip-hash.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

let one: TestDb;
let two: TestDb;

beforeAll(async () => {
  [one, two] = await Promise.all([freshDb(), freshDb()]);
});

afterAll(async () => {
  await Promise.all([one.close(), two.close()]);
});

async function secretOf(db: TestDb['db']): Promise<string> {
  const row = rowsOf<{ value: { secret: string } | string }>(
    await db.execute(sql`SELECT value FROM helpwell.install_state WHERE key = 'privacy.hash_key'`),
  )[0];
  const value = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
  return value.secret;
}

describe('the keyed IP hash', () => {
  it('is 128 bits of hex, and the same every time within one install', async () => {
    const first = await hashIp(one.db, '203.0.113.7');
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(HASH_HEX_LENGTH).toBe(32);
    expect(await hashIp(one.db, '203.0.113.7')).toBe(first);
    expect(await hashIp(one.db, '203.0.113.8')).not.toBe(first);
    // `keyedHash` is the same function under its general name.
    expect(await keyedHash(one.db, '203.0.113.7')).toBe(first);
  });

  it('hashes the same address differently in two installs', async () => {
    const a = await hashIp(one.db, '198.51.100.23');
    const b = await hashIp(two.db, '198.51.100.23');
    expect(a).not.toBe(b);
    expect(await secretOf(one.db)).not.toBe(await secretOf(two.db));
  });

  it('is an HMAC-SHA256 under the install’s own secret, which never includes the address', async () => {
    const secret = await secretOf(one.db);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHmac('sha256', secret)
      .update('192.0.2.44')
      .digest('hex')
      .slice(0, HASH_HEX_LENGTH);
    expect(await hashIp(one.db, '192.0.2.44')).toBe(expected);
    // Without the secret, hashing every candidate address finds nothing.
    const unkeyed = createHmac('sha256', '').update('192.0.2.44').digest('hex').slice(0, 32);
    expect(await hashIp(one.db, '192.0.2.44')).not.toBe(unkeyed);
  });

  it('makes one key when two first calls race', async () => {
    const fresh = await freshDb();
    try {
      const [a, b] = await Promise.all([
        hashIp(fresh.db, '10.0.0.1'),
        hashIp(fresh.db, '10.0.0.1'),
      ]);
      expect(a).toBe(b);
      const rows = rowsOf(
        await fresh.db.execute(
          sql`SELECT key FROM helpwell.install_state WHERE key = 'privacy.hash_key'`,
        ),
      );
      expect(rows).toHaveLength(1);
    } finally {
      await fresh.close();
    }
  });

  it('is what a blocked attempt stores, never the address', async () => {
    await recordBlocked(one.db, { reason: 'blocked_ip', ip: '203.0.113.99', detail: 'test' });
    const rows = rowsOf<{ ip_hash: string }>(
      await one.db.execute(
        sql`SELECT ip_hash FROM helpwell.blocked_attempts WHERE detail = 'test'`,
      ),
    );
    expect(rows[0]?.ip_hash).toBe(await hashIp(one.db, '203.0.113.99'));
    expect(JSON.stringify(rows)).not.toContain('203.0.113.99');
  });
});

describe('rate limits on an address', () => {
  it('count by the keyed hash, one bucket per address, exactly as tight as before', async () => {
    await new SettingsStore(one.db).update({ agent: { spend: { messagesPerVisitorPerHour: 2 } } });
    const handler = createHelpWellHandler({
      db: one.db,
      basePath: '/api/helpwell',
      secureCookies: false,
      model: new FakeModel([{ text: 'Open Billing, then Invoices.' }]),
    });
    // No cookie is ever kept, so every call is counted by its address.
    const from = (ip: string) => {
      const browser = client(handler, { ip });
      return async () => {
        browser.reset();
        return (await browser.call('/chat', { body: { message: 'How do I export?' } })).status;
      };
    };
    const ada = from('198.51.100.7');
    expect([await ada(), await ada(), await ada()]).toEqual([200, 200, 429]);
    // Another address has its own allowance.
    expect(await from('198.51.100.8')()).toBe(200);

    const buckets = rowsOf<{ bucket: string }>(
      await one.db.execute(sql`SELECT bucket FROM helpwell.rate_counters`),
    ).map((row) => row.bucket);
    const hashed = await hashIp(one.db, '198.51.100.7');
    expect(buckets).toContain(`chat:ip:${hashed}`);
    expect(buckets).toContain(`visitors:${hashed}`);
    expect(buckets.join(' ')).not.toMatch(/198\.51\.100/);
  });
});
