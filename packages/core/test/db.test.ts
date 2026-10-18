import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropAll, loadMigrations, migrate, rowsOf, schema, schemaExists } from '../src/db.js';
import { idPrefix, newId } from '../src/ids.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;

beforeAll(async () => {
  t = await freshDb();
});

afterAll(async () => {
  await t.close();
});

describe('migrations', () => {
  it('creates the helpwell schema', async () => {
    expect(await schemaExists(t.db)).toBe(true);
  });

  it('is idempotent: running again applies nothing', async () => {
    const result = await migrate(t.db);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied.length).toBeGreaterThan(0);
  });

  it('ships migrations that are numbered and ordered', () => {
    const versions = loadMigrations().map((m) => m.version);
    expect(versions).toEqual([...versions].sort());
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('can be torn down completely', async () => {
    const scratch = await freshDb();
    await dropAll(scratch.db);
    expect(await schemaExists(scratch.db)).toBe(false);
    await scratch.close();
  });

  /*
   * A Next.js server bundle loads the CommonJS build, where `import.meta` is
   * rewritten to an empty object. That used to make `migrationsDir()` call
   * fileURLToPath(undefined) and throw a TypeError with nothing in it about
   * migrations — so `migrate(db)` was simply unusable from CJS, and nothing in
   * the ESM test suite could tell.
   */
  it('finds its .sql files from the CommonJS build too', async () => {
    const dist = join(fileURLToPath(new URL('../dist', import.meta.url)), 'db.cjs');
    if (!existsSync(dist)) return; // dist is a build artifact; skip before one exists.

    const cjs = createRequire(import.meta.url)(dist) as { loadMigrations(): { version: string }[] };
    expect(cjs.loadMigrations().map((m) => m.version)).toEqual(
      loadMigrations().map((m) => m.version),
    );
  });

  /*
   * Two instances booting at once both call migrate(). Without the advisory
   * lock, both read an empty applied set and the second one crashes on
   * "relation already exists". With it, one applies and the other waits and
   * finds nothing left to do.
   */
  it('lets two boots migrate the same database at once', async () => {
    const scratch = await freshDb();
    await dropAll(scratch.db);

    const [first, second] = await Promise.all([migrate(scratch.db), migrate(scratch.db)]);
    const applied = [...first.applied, ...second.applied].sort();
    expect(applied).toEqual(loadMigrations().map((m) => m.name));
    expect(await schemaExists(scratch.db)).toBe(true);
    await scratch.close();
  });
});

describe('contacts', () => {
  it('stores identify data and enforces one row per external id', async () => {
    const id = newId(idPrefix.contact);
    await t.db.insert(schema.contacts).values({
      id,
      externalId: 'usr_4k2m9',
      email: 'jane@northwindstudio.co',
      name: 'Jane Martin',
      identified: true,
      attributes: { plan: 'pro', seats: 4 },
    });

    const [row] = await t.db.select().from(schema.contacts).where(sql`id = ${id}`);
    expect(row?.attributes).toEqual({ plan: 'pro', seats: 4 });
    expect(row?.identified).toBe(true);

    await expect(
      t.db.insert(schema.contacts).values({ id: newId(idPrefix.contact), externalId: 'usr_4k2m9' }),
    ).rejects.toThrow();
  });

  it('treats email as case-insensitively unique among identified contacts', async () => {
    await t.db.insert(schema.contacts).values({
      id: newId(idPrefix.contact),
      externalId: 'usr_diego',
      email: 'diego@nordic.co',
      identified: true,
    });
    await expect(
      t.db.insert(schema.contacts).values({
        id: newId(idPrefix.contact),
        externalId: 'usr_diego_2',
        email: 'DIEGO@nordic.co',
        identified: true,
      }),
    ).rejects.toThrow();
  });

  it('lets anonymous visitors type the same email, because a typed email is not an identity', async () => {
    await t.db
      .insert(schema.contacts)
      .values({ id: newId(idPrefix.contact), email: 'shared@nordic.co' });
    await expect(
      t.db
        .insert(schema.contacts)
        .values({ id: newId(idPrefix.contact), email: 'shared@nordic.co' }),
    ).resolves.toBeDefined();
  });

  it('lets two anonymous visitors coexist', async () => {
    await t.db.insert(schema.contacts).values({ id: newId(idPrefix.contact) });
    await t.db.insert(schema.contacts).values({ id: newId(idPrefix.contact) });
    const rows = await t.db.select().from(schema.contacts);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});

describe('conversations and messages', () => {
  it('defaults to unresolved and cascades messages on delete', async () => {
    const contactId = newId(idPrefix.contact);
    await t.db.insert(schema.contacts).values({ id: contactId, email: 'tom@weber.io' });

    const conversationId = newId(idPrefix.conversation);
    await t.db.insert(schema.conversations).values({ id: conversationId, contactId });

    const [conversation] = await t.db
      .select()
      .from(schema.conversations)
      .where(sql`id = ${conversationId}`);
    expect(conversation?.status).toBe('unresolved');

    await t.db.insert(schema.messages).values([
      { id: newId(idPrefix.message), conversationId, role: 'customer', body: 'How do I export?' },
      {
        id: newId(idPrefix.message),
        conversationId,
        role: 'agent',
        body: 'Billing → Invoices → Export CSV.',
        citations: [
          {
            slug: 'exporting-invoices-as-csv',
            title: 'Exporting invoices as CSV',
            collection: 'billing',
          },
        ],
      },
    ]);

    const before = await t.db
      .select()
      .from(schema.messages)
      .where(sql`conversation_id = ${conversationId}`);
    expect(before).toHaveLength(2);
    expect(before[1]?.citations[0]?.slug).toBe('exporting-invoices-as-csv');

    await t.db.delete(schema.conversations).where(sql`id = ${conversationId}`);
    const after = await t.db
      .select()
      .from(schema.messages)
      .where(sql`conversation_id = ${conversationId}`);
    expect(after).toHaveLength(0);
  });

  it('refuses a status the product does not have', async () => {
    await expect(
      t.db
        .insert(schema.conversations)
        .values({ id: newId(idPrefix.conversation), status: 'open' as never }),
    ).rejects.toThrow();
  });
});

describe('article index', () => {
  it('builds a weighted full-text vector so titles beat body text', async () => {
    await t.db.insert(schema.articleIndex).values([
      {
        slug: 'exporting-invoices-as-csv',
        collection: 'billing',
        title: 'Exporting invoices as CSV',
        description: 'Download every invoice in a date range.',
        body: 'Open Billing then Invoices and choose Export CSV at the top right.',
      },
      {
        slug: 'understanding-your-invoice',
        collection: 'billing',
        title: 'Understanding your invoice',
        description: 'What each line on the invoice means.',
        body: 'Seats, usage and credits. You can export a CSV from here too.',
      },
    ]);

    const rows = await t.db.execute<{ slug: string; rank: number }>(sql`
      SELECT slug, ts_rank(search_tsv, websearch_to_tsquery('english', 'export csv')) AS rank
      FROM helpwell.article_index
      WHERE search_tsv @@ websearch_to_tsquery('english', 'export csv')
      ORDER BY rank DESC
    `);
    const ordered = rowsOf<{ slug: string }>(rows);
    expect(ordered[0]?.slug).toBe('exporting-invoices-as-csv');
    expect(ordered).toHaveLength(2);
  });
});

describe('gaps', () => {
  it('keeps one row per question with the ways people phrased it', async () => {
    const gapId = newId(idPrefix.gap);
    await t.db.insert(schema.gaps).values({
      id: gapId,
      question: 'Do you have a VAT number for receipts?',
      variants: ['Is there a VAT number on the invoice?'],
      asks: 1,
    });
    await t.db
      .update(schema.gaps)
      .set({
        asks: 2,
        variants: ['Is there a VAT number on the invoice?', 'EU VAT reverse charge?'],
      })
      .where(sql`id = ${gapId}`);

    const [gap] = await t.db.select().from(schema.gaps).where(sql`id = ${gapId}`);
    expect(gap?.asks).toBe(2);
    expect(gap?.variants).toHaveLength(2);
    expect(gap?.status).toBe('new');
  });
});
