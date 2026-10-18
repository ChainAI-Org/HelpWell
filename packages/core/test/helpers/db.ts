/**
 * A throwaway database per test.
 *
 * PGlite is real Postgres, so these are integration tests against the same
 * engine a customer runs — generated columns, full-text search and constraints
 * all behave exactly as they will in production.
 *
 * Booting Postgres and running every migration takes about three seconds, so
 * each worker does it once and snapshots the data directory. Every
 * `freshDb()` after that starts its own database from the snapshot in a
 * fraction of the time, fully isolated from the others.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema } from '../../src/db/client.js';
import { createDb, type Db, type DbHandle, migrate } from '../../src/db.js';

export interface TestDb extends DbHandle {
  db: Db;
}

let snapshot: Promise<File | Blob> | undefined;

async function migratedSnapshot(): Promise<File | Blob> {
  const handle = await createDb({ url: 'pglite://memory' });
  try {
    await migrate(handle.db);
    const client = (handle.db as unknown as { $client: PGlite }).$client;
    return await client.dumpDataDir('none');
  } finally {
    await handle.close();
  }
}

export async function freshDb(): Promise<TestDb> {
  snapshot ??= migratedSnapshot();
  const client = new PGlite({ loadDataDir: await snapshot });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, driver: 'pglite', close: () => client.close() };
}
