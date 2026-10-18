/**
 * Contacts as the host app writes them: identify merges rather than replaces,
 * the server can update a person by its own user id, fields are typed once
 * and then only by a person, and segments, events, CSV and imports all read
 * the same records.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHelpWellHandler, signIdentity } from '../src/api.js';
import { rowsOf } from '../src/db/rows.js';
import type { Db } from '../src/db.js';
import { getField, inferFieldType, recordFields, updateField } from '../src/fields/index.js';
import { importContacts } from '../src/repos/contacts.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const SECRET = 'audience-identity-secret';
const ADMIN = 'audience-admin-token';

let t: TestDb;
let db: Db;
let handler: ReturnType<typeof createHelpWellHandler>;

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
  handler = createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    identitySecret: SECRET,
    adminToken: ADMIN,
    secureCookies: false,
  });
});

afterAll(async () => {
  await t.close();
});

const admin = () => client(handler, { adminToken: ADMIN });

async function identify(claims: Parameters<typeof signIdentity>[0]) {
  const browser = client(handler);
  const response = await browser.call('/identify', {
    body: { token: await signIdentity(claims, SECRET) },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { contactId: string };
}

async function contact(id: string) {
  const response = await admin().call(`/admin/contacts/${encodeURIComponent(id)}`);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    id: string;
    name: string | null;
    email: string | null;
    attributes: Record<string, unknown>;
    tags: string[];
    source: string;
    consent: string;
    consentSource: string | null;
    consentAt: string | null;
    signedUpAt: string | null;
    eventCounts: { name: string; count: number }[];
  };
}

describe('identify merges', () => {
  it('keeps what a later token leaves out, and unsets what it sends as null', async () => {
    const { contactId } = await identify({
      id: 'usr_merge',
      email: 'merge@example.com',
      name: 'Mo',
      createdAt: '2025-03-04T10:00:00Z',
      consent: 'granted',
      plan: 'pro',
      seats: 4,
      beta: true,
    });
    await identify({ id: 'usr_merge', seats: 5, beta: null, role: 'owner' });

    const after = await contact(contactId);
    expect(after.attributes).toEqual({ plan: 'pro', seats: 5, role: 'owner' });
    expect(after.name).toBe('Mo');
    expect(after.email).toBe('merge@example.com');
    expect(after.signedUpAt).toBe('2025-03-04T10:00:00.000Z');
    expect(after.source).toBe('identify');
    expect(after.consent).toBe('granted');
    expect(after.consentSource).toBe('identify');
    expect(after.consentAt).not.toBeNull();
  });

  it('keeps the first consent time when the app repeats itself, and a bad value is ignored', async () => {
    const { contactId } = await identify({ id: 'usr_consent', consent: 'granted' });
    const first = (await contact(contactId)).consentAt;
    await identify({ id: 'usr_consent', consent: 'granted' });
    await identify({ id: 'usr_consent', consent: 'maybe' as 'granted' });
    const after = await contact(contactId);
    expect(after.consentAt).toBe(first);
    expect(after.consent).toBe('granted');
  });

  it('matches on the user id only, exactly as before', async () => {
    const a = await identify({ id: 'usr_same', email: 'same@example.com' });
    const b = await identify({ id: 'usr_same' });
    expect(b.contactId).toBe(a.contactId);
    const c = await identify({ id: 'usr_other', email: 'same@example.com' });
    expect(c.contactId).not.toBe(a.contactId);
    // The address is already vouched for, so the second person goes without it.
    expect((await contact(c.contactId)).email).toBeNull();
  });

  it('registers each attribute key with an inferred type', async () => {
    expect(await getField(db, 'seats')).toMatchObject({
      type: 'number',
      source: 'app',
      locked: false,
    });
    expect(await getField(db, 'beta')).toMatchObject({ type: 'boolean' });
    expect(await getField(db, 'plan')).toMatchObject({ type: 'text', label: 'Plan' });
  });
});

describe('the field registry', () => {
  it('infers from the value, and from the key when the value is ambiguous', () => {
    expect(inferFieldType('site', 'https://acme.com')).toBe('url');
    expect(inferFieldType('renews', '2026-10-01')).toBe('date');
    expect(inferFieldType('trial_ends_at', 1_760_000_000)).toBe('date');
    expect(inferFieldType('mrr', 49)).toBe('money');
    expect(inferFieldType('price', '$12.00')).toBe('money');
    expect(inferFieldType('roles', ['a'])).toBe('list');
    expect(inferFieldType('company', { name: 'x' })).toBe('text');
  });

  it('never changes a type once inferred, and locks it when a person changes it', async () => {
    await recordFields(db, { fleet: 3 }, 'api');
    await recordFields(db, { fleet: 'three' }, 'api', new Date(Date.now() + 3_600_000));
    expect(await getField(db, 'fleet')).toMatchObject({ type: 'number', sample: 'three' });

    const changed = await updateField(db, 'fleet', { type: 'text', label: 'Fleet size' });
    expect(changed).toMatchObject({ type: 'text', locked: true, label: 'Fleet size' });
    await expect(updateField(db, 'fleet', { type: 'number' })).rejects.toThrow(/locked/);
    expect(await updateField(db, 'fleet', { locked: false, type: 'number' })).toMatchObject({
      type: 'number',
      locked: true,
    });
  });

  it('keeps built-in fields fixed and puts an attribute that borrows their name under attributes.', async () => {
    await expect(updateField(db, 'tags', { type: 'text' })).rejects.toThrow(/built-in/);
    await recordFields(db, { email: 'x@y.z' }, 'app');
    expect(await getField(db, 'attributes.email')).toMatchObject({ type: 'text', source: 'app' });
    expect(await getField(db, 'email')).toMatchObject({ source: 'helpwell', builtin: true });
  });

  it('is listed and edited over the admin API', async () => {
    const list = (await (await admin().call('/admin/fields')).json()) as {
      items: { key: string; builtin: boolean }[];
    };
    expect(list.items.slice(0, 8).map((f) => f.key)).toEqual([
      'email',
      'name',
      'signed_up',
      'last_seen',
      'identified',
      'tags',
      'source',
      'consent',
    ]);
    const patched = await admin().call('/admin/fields/plan', {
      method: 'PATCH',
      body: { hidden: true, label: 'Plan name' },
    });
    expect(await patched.json()).toMatchObject({ key: 'plan', hidden: true, label: 'Plan name' });
    expect(
      (await admin().call('/admin/fields/plan', { method: 'PATCH', body: { type: 'colour' } }))
        .status,
    ).toBe(400);
    expect(
      (await admin().call('/admin/fields/nope', { method: 'PATCH', body: { hidden: true } }))
        .status,
    ).toBe(404);
  });
});

describe('server-side contact updates', () => {
  it('updates by the host user id, merging attributes and tags', async () => {
    const { contactId } = await identify({ id: 'usr_8412', plan: 'team', seats: 2 });
    const response = await admin().call('/admin/contacts/usr_8412', {
      method: 'PATCH',
      body: {
        attributes: { seats: 4, plan: null },
        tags: { add: ['Beta', 'vip'] },
        consent: 'denied',
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Awaited<ReturnType<typeof contact>>;
    expect(body.id).toBe(contactId);
    expect(body.attributes).toEqual({ seats: 4 });
    expect(body.tags).toEqual(['beta', 'vip']);
    expect(body.consent).toBe('denied');
    expect(body.consentSource).toBe('api');

    await admin().call(`/admin/contacts/${contactId}`, {
      method: 'PATCH',
      body: { tags: { remove: ['vip'] } },
    });
    expect((await contact('usr_8412')).tags).toEqual(['beta']);
  });

  it('creates a contact for a user id it has never seen, unless told not to', async () => {
    const created = await admin().call('/admin/contacts/usr_new_from_api', {
      method: 'PATCH',
      body: { attributes: { seats: 1 } },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ source: 'api', identified: true });

    const refused = await admin().call('/admin/contacts/usr_nobody', {
      method: 'PATCH',
      body: { attributes: { seats: 1 }, upsert: false },
    });
    expect(refused.status).toBe(404);
    // One of HelpWell's own ids that does not exist is never invented.
    expect(
      (await admin().call('/admin/contacts/con_doesnotexist0000000', { method: 'PATCH', body: {} }))
        .status,
    ).toBe(404);
  });

  it('refuses bad input and callers without the token', async () => {
    expect(
      (
        await admin().call('/admin/contacts/usr_8412', {
          method: 'PATCH',
          body: { attributes: ['no'] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin().call('/admin/contacts/usr_8412', {
          method: 'PATCH',
          body: { consent: 'yes' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await client(handler).call('/admin/contacts/usr_8412', { method: 'PATCH', body: {} }))
        .status,
    ).toBe(401);
  });
});

describe('events', () => {
  it('records server-side events and lists and counts them', async () => {
    for (const name of ['exported_csv', 'exported_csv', 'invited_user']) {
      const response = await admin().call('/admin/events', {
        method: 'POST',
        body: { contact: 'usr_8412', name, props: { rows: 10 } },
      });
      expect(response.status).toBe(201);
    }
    const backfill = await admin().call('/admin/events', {
      method: 'POST',
      body: { contact: 'usr_8412', name: 'signed_up', at: '2025-01-01T00:00:00Z' },
    });
    expect(backfill.status).toBe(201);

    const page = (await (await admin().call('/admin/contacts/usr_8412/events?limit=2')).json()) as {
      items: { name: string }[];
      nextCursor: string | null;
    };
    expect(page.items.map((e) => e.name)).toEqual(['invited_user', 'exported_csv']);
    const rest = (await (
      await admin().call(
        `/admin/contacts/usr_8412/events?limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`,
      )
    ).json()) as { items: { name: string }[]; nextCursor: string | null };
    expect(rest.items.map((e) => e.name)).toEqual(['exported_csv', 'signed_up']);
    expect(rest.nextCursor).toBeNull();

    const counts = (await (
      await admin().call('/admin/events/counts?contactId=usr_8412')
    ).json()) as { items: { name: string; count: number; contacts: number }[] };
    expect(counts.items[0]).toMatchObject({ name: 'exported_csv', count: 2, contacts: 1 });
    expect((await contact('usr_8412')).eventCounts.map((e) => e.name)).toContain('invited_user');

    const byName = (await (await admin().call('/admin/events?name=invited_user')).json()) as {
      items: unknown[];
    };
    expect(byName.items).toHaveLength(1);
  });

  it('refuses an event without a name or a contact', async () => {
    expect(
      (await admin().call('/admin/events', { method: 'POST', body: { contact: 'usr_8412' } }))
        .status,
    ).toBe(400);
    expect(
      (await admin().call('/admin/events', { method: 'POST', body: { name: 'x' } })).status,
    ).toBe(400);
  });
});

describe('segments', () => {
  let segmentId: string;

  it('saves rules, counts them and lists the members', async () => {
    const response = await admin().call('/admin/segments', {
      method: 'POST',
      body: {
        name: 'Power exporters',
        rules: {
          all: [
            { field: 'seats', op: 'gte', value: 4 },
            { event: 'exported_csv', op: 'at_least', count: 2 },
          ],
        },
      },
    });
    expect(response.status).toBe(201);
    const segment = (await response.json()) as { id: string; count: number };
    segmentId = segment.id;
    expect(segment.count).toBe(1);

    const members = (await (await admin().call(`/admin/segments/${segmentId}/members`)).json()) as {
      items: { id: string }[];
    };
    expect(members.items).toHaveLength(1);

    const listed = (await (await admin().call(`/admin/contacts?segment=${segmentId}`)).json()) as {
      items: { id: string; source: string }[];
    };
    expect(listed.items.map((c) => c.id)).toEqual(members.items.map((c) => c.id));

    const all = (await (await admin().call('/admin/segments')).json()) as {
      items: { name: string; count: number }[];
    };
    expect(all.items).toEqual([expect.objectContaining({ name: 'Power exporters', count: 1 })]);
  });

  it('previews unsaved rules and filters the list with them', async () => {
    const preview = await admin().call('/admin/segments/preview', {
      method: 'POST',
      body: { rules: { field: 'identified', op: 'is_true' } },
    });
    const { count } = (await preview.json()) as { count: number };
    expect(count).toBeGreaterThan(3);

    const conditions = encodeURIComponent(
      JSON.stringify({ field: 'tags', op: 'includes_any', value: ['beta'] }),
    );
    const listed = (await (
      await admin().call(`/admin/contacts?conditions=${conditions}`)
    ).json()) as {
      items: { tags: string[] }[];
    };
    expect(listed.items.length).toBe(1);
    expect(listed.items[0]!.tags).toContain('beta');
  });

  it('refuses bad rules, a clashing name and a mismatched operator', async () => {
    const bad = await admin().call('/admin/segments', {
      method: 'POST',
      body: { name: 'Broken', rules: { field: 'plan', op: 'near', value: 'x' } },
    });
    expect(bad.status).toBe(400);
    const mismatch = await admin().call('/admin/segments', {
      method: 'POST',
      body: { name: 'Mismatch', rules: { field: 'seats', op: 'contains', value: '4' } },
    });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: { message: string } }).error.message).toContain(
      'number field',
    );
    const clash = await admin().call('/admin/segments', {
      method: 'POST',
      body: { name: 'power EXPORTERS', rules: { all: [] } },
    });
    expect(clash.status).toBe(409);
  });

  it('updates, counts and deletes', async () => {
    const patched = await admin().call(`/admin/segments/${segmentId}`, {
      method: 'PATCH',
      body: { rules: { field: 'identified', op: 'is_true' }, description: 'Everyone signed in' },
    });
    expect(await patched.json()).toMatchObject({ description: 'Everyone signed in' });
    const counted = (await (await admin().call(`/admin/segments/${segmentId}/count`)).json()) as {
      count: number;
    };
    expect(counted.count).toBeGreaterThan(3);
    expect((await admin().call(`/admin/segments/${segmentId}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await admin().call(`/admin/segments/${segmentId}`)).status).toBe(404);
    expect((await admin().call(`/admin/contacts?segment=${segmentId}`)).status).toBe(404);
  });
});

describe('export and import', () => {
  it('exports contacts as CSV with source and consent on every row', async () => {
    const response = await admin().call('/admin/contacts.csv?identified=true');
    expect(response.headers.get('content-type')).toContain('text/csv');
    const [header, ...rows] = (await response.text()).trim().split('\n');
    expect(header).toBe(
      'id,external_id,name,email,identified,source,consent,consent_source,consent_at,signed_up_at,first_seen_at,last_seen_at,tags,attributes,forms_submitted,last_form_submitted_at,giveaways_entered,giveaway_entries',
    );
    const denied = rows.find((row) => row.includes('usr_8412'));
    expect(denied).toContain(',denied,api,');
    // No forms yet: zero counts and an empty date, not blanks that read as unknown.
    expect(denied).toMatch(/,0,,0,0$/);
  });

  it('includes source and consent in the per-person export', async () => {
    const { contactId } = await identify({ id: 'usr_export', consent: 'granted' });
    const dump = (await (await admin().call(`/admin/contacts/${contactId}/export`)).json()) as {
      contact: Record<string, unknown>;
      formSubmissions: unknown[];
      giveawayEntries: unknown[];
    };
    expect(dump.contact).toMatchObject({
      source: 'identify',
      consent: 'granted',
      consentSource: 'identify',
    });
    expect(dump.formSubmissions).toEqual([]);
    expect(dump.giveawayEntries).toEqual([]);
  });

  it('imports people as import-sourced with unknown consent, and is safe to run twice', async () => {
    const rows = [
      {
        id: 'usr_imp_1',
        email: 'one@import.test',
        name: 'One',
        tags: ['legacy'],
        attributes: { plan: 'basic' },
      },
      { email: 'two@import.test', signedUpAt: '2024-05-01' },
      { name: 'Nobody' },
      { email: 'not-an-email' },
    ];
    const first = await importContacts(db, rows);
    expect(first).toEqual({
      created: 2,
      updated: 0,
      skipped: [
        { row: 3, reason: 'needs an id or an email' },
        { row: 4, reason: '"not-an-email" is not an email address' },
      ],
    });
    const again = await importContacts(db, rows.slice(0, 2));
    expect(again).toMatchObject({ created: 0, updated: 2 });

    const imported = rowsOf<{ source: string; consent: string; identified: boolean }>(
      await db.execute(sql`
        SELECT source, consent, identified FROM helpwell.contacts
        WHERE email IN ('one@import.test', 'two@import.test')
      `),
    );
    expect(imported).toEqual([
      { source: 'import', consent: 'unknown', identified: false },
      { source: 'import', consent: 'unknown', identified: false },
    ]);

    // Signing in later finds the imported record by the user id.
    const { contactId } = await identify({ id: 'usr_imp_1', seats: 3 });
    const after = await contact(contactId);
    expect(after.source).toBe('import');
    expect(after.attributes).toEqual({ plan: 'basic', seats: 3 });
    expect(after.tags).toEqual(['legacy']);
  });
});
