/**
 * A throwaway database per test file, exactly as core does it.
 *
 * The tools are almost entirely SQL, so testing them against a stub would test
 * the stub. PGlite is real Postgres, and it is also what a developer running
 * `helpwell dev` has behind this MCP server, so these are the same conditions.
 */

import type { Db, DbHandle } from '@helpwell/core/db';
import { createDb, migrate } from '@helpwell/core/db';

export interface TestDb extends DbHandle {
  db: Db;
}

export async function freshDb(): Promise<TestDb> {
  const handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
  return handle;
}

/** A database that is reachable but has never had HelpWell installed in it. */
export async function emptyDb(): Promise<TestDb> {
  return createDb({ url: 'pglite://memory' });
}
