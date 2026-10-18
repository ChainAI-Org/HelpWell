import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pruneRateCounters } from '../src/agent/guards.js';
import { schema } from '../src/db/client.js';
import type { Db } from '../src/db.js';
import { rangeFor, reportBundle } from '../src/repos/reports.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;
let db: Db;
const params: unknown[] = [];

beforeAll(async () => {
  t = await freshDb();
  // The same database, logging every bound parameter.
  const client = (t.db as unknown as { $client: PGlite }).$client;
  db = drizzle(client, {
    schema,
    logger: { logQuery: (_query, values) => params.push(...values) },
  }) as unknown as Db;
});

afterAll(async () => {
  await t.close();
});

// postgres.js, the production driver, throws on a Date inside a raw sql template.
// PGlite accepts one, so the reports page worked in tests and failed on real servers.
describe('queries on a range', () => {
  it('bind dates as strings, which every driver accepts', async () => {
    const report = await reportBundle(db, rangeFor('7d'));
    await pruneRateCounters(db);
    expect(report.series.length).toBeGreaterThan(0);
    expect(params.length).toBeGreaterThan(0);
    expect(params.filter((value) => value instanceof Date)).toEqual([]);
  });
});
