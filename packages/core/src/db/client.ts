/**
 * Database connection.
 *
 * Two drivers, one type. Postgres is what a customer runs in production, with
 * HelpWell's tables inside their existing database. PGlite is real Postgres
 * compiled to WASM, which is what `helpwell dev` and every test use so nobody
 * has to install a server to try the product (DX-07).
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { firstRow } from './rows.js';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  driver: 'postgres' | 'pglite';
  /** Release the pool / free the WASM instance. */
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /**
   * `postgres://…` for a server, `pglite://./path` or `pglite://memory` for the
   * embedded engine. Defaults to `defaultDatabaseUrl()`.
   */
  url?: string;
  /** Log every statement. `helpwell dev --verbose` turns this on. */
  logger?: boolean;
}

/**
 * The repo HelpWell is installed in: the nearest directory at or above `from`
 * that holds `helpwell/helpwell.config.json`. Null outside any install.
 */
export function findProjectRoot(from = process.cwd()): string | null {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'helpwell', 'helpwell.config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Where the database is when nobody said.
 *
 * `HELPWELL_DATABASE_URL` wins. Otherwise the embedded database under the
 * install's own `helpwell/data`, so the app, the CLI and the MCP server all
 * open the same file — an app that used memory while `helpwell sync` wrote to
 * disk was the first thing every new install tripped over. Only with no
 * install in sight at all does it fall back to memory.
 *
 * The host app's own `DATABASE_URL` is deliberately not consulted. It is
 * usually production, and HelpWell creating a schema there because someone
 * ran `helpwell sync` on a laptop is not a surprise anyone should get.
 */
export function defaultDatabaseUrl(from = process.cwd()): string {
  const fromEnv = process.env.HELPWELL_DATABASE_URL;
  if (fromEnv) return fromEnv;
  const root = findProjectRoot(from);
  return root ? `pglite://${join(root, 'helpwell', 'data')}` : 'pglite://memory';
}

async function importOptional<T>(name: string, why: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ name)) as T;
  } catch (cause) {
    throw new Error(
      `HelpWell needs the "${name}" package ${why}. Install it with:\n\n  npm install ${name}\n`,
      { cause },
    );
  }
}

export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  const url = options.url ?? defaultDatabaseUrl();

  if (url.startsWith('pglite://')) {
    const { PGlite } = await importOptional<typeof import('@electric-sql/pglite')>(
      '@electric-sql/pglite',
      'to run the embedded database',
    );
    const { drizzle } = await import('drizzle-orm/pglite');
    const target = url.slice('pglite://'.length);
    const client = new PGlite(target === 'memory' || target === '' ? undefined : target);
    const db = drizzle(client, { schema, logger: options.logger }) as unknown as Db;
    return { db, driver: 'pglite', close: () => client.close() };
  }

  const postgres = (
    await importOptional<{ default: typeof import('postgres') }>(
      'postgres',
      'to connect to Postgres',
    )
  ).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  // A small pool by default: the dashboard and widget API are chatty but light,
  // and serverless platforms punish large pools.
  const client = postgres(url, { max: 8, prepare: false });
  const db = drizzle(client, { schema, logger: options.logger }) as unknown as Db;
  return { db, driver: 'postgres', close: () => client.end({ timeout: 5 }) };
}

/** Does the `helpwell` schema exist yet? Used by `helpwell doctor`. */
export async function schemaExists(db: Db): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql`SELECT EXISTS (
      SELECT 1 FROM information_schema.schemata WHERE schema_name = 'helpwell'
    ) AS exists`,
  );
  return Boolean(firstRow<{ exists: boolean }>(result)?.exists);
}

export { schema };
