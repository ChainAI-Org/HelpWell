/**
 * A throwaway, migrated database per test.
 *
 * Booting PGlite and running every migration takes about three seconds, so
 * each worker does it once and snapshots the data directory. Every
 * `freshDb()` after that starts its own isolated database from the snapshot
 * in a fraction of the time. Same approach as core's test helper.
 */

import { PGlite } from '@electric-sql/pglite';
import { createDb, type Db, type DbHandle, migrate, schema } from '@helpwell/core/db';
import { drizzle } from 'drizzle-orm/pglite';

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

export async function freshDb(): Promise<DbHandle> {
  snapshot ??= migratedSnapshot();
  const client = new PGlite({ loadDataDir: await snapshot });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, driver: 'pglite', close: () => client.close() };
}
