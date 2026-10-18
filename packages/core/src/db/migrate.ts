/**
 * Migrations.
 *
 * Plain numbered .sql files, applied in order, recorded in
 * `helpwell.schema_migrations`. No codegen and no ORM-specific journal, because
 * a customer should be able to read exactly what will run against their
 * database before they let it near production.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { rowsOf } from './rows.js';
import { splitSql } from './split-sql.js';

export interface Migration {
  version: string;
  name: string;
  sql: string;
}

/**
 * The directory this module was loaded from.
 *
 * This has to survive three shapes: ESM from `src` during development, ESM
 * from `dist`, and CJS from `dist` — which is what a Next.js server bundle
 * ends up loading. `import.meta.url` does not make it through a CJS build
 * (esbuild rewrites `import.meta` to an empty object), so `__dirname` is the
 * fallback. Both are read through `typeof` because each one is missing in the
 * other module system, and reading a missing binding directly throws.
 */
function moduleDir(): string | null {
  const url = typeof import.meta === 'object' ? import.meta.url : undefined;
  if (typeof url === 'string' && url.length > 0) return dirname(fileURLToPath(url));
  if (typeof __dirname === 'string') return __dirname;
  return null;
}

/**
 * Where the .sql files live.
 *
 * Exported because a consumer that bundles HelpWell itself can lose the
 * module's own location, and passing the path explicitly to `migrate()` is
 * better than guessing.
 */
export function migrationsDir(): string {
  const here = moduleDir();
  // src/db/migrations during development, dist/migrations once built.
  const candidates = here ? [join(here, 'migrations'), join(here, '..', 'migrations')] : [];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error(
    'HelpWell could not find its migrations directory. ' +
      'If you are bundling @helpwell/core, pass the path explicitly: ' +
      'migrate(db, join(dirname(require.resolve("@helpwell/core/package.json")), "dist/migrations")).',
  );
}

export function loadMigrations(dir = migrationsDir()): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const version = file.slice(0, 4);
      return {
        version,
        name: file.replace(/\.sql$/, ''),
        sql: readFileSync(join(dir, file), 'utf8'),
      };
    });
}

async function appliedVersions(db: Db): Promise<Set<string>> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS helpwell`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS helpwell.schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const result = await db.execute<{ version: string }>(
    sql`SELECT version FROM helpwell.schema_migrations`,
  );
  return new Set(rowsOf<{ version: string }>(result).map((r) => r.version));
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * A fixed advisory-lock key, so two processes migrating the same database
 * take turns. Any 64-bit integer works as long as everyone uses the same one.
 */
const MIGRATION_LOCK = 7_310_154_209_262_671;

/**
 * Run every migration that has not run yet. Safe to call on every boot, and
 * safe to call from several processes booting at once: the whole run holds a
 * transaction-scoped advisory lock, and everything, even creating the schema
 * and the bookkeeping table, happens inside it, so the second process sees
 * the first one's work rather than racing it. (Two sessions running
 * `CREATE SCHEMA IF NOT EXISTS` at the same moment can both decide it is
 * missing, and the loser fails on a duplicate key.) Postgres can roll back
 * DDL, which is what makes one transaction for the lot safe — a failure half
 * way leaves nothing behind.
 *
 * The lock is per database, so installs with a database each never wait on
 * one another.
 */
export async function migrate(db: Db, dir?: string): Promise<MigrateResult> {
  const migrations = loadMigrations(dir);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
    const done = await appliedVersions(tx);
    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of migrations) {
      if (done.has(migration.version)) {
        alreadyApplied.push(migration.name);
        continue;
      }
      for (const statement of splitSql(migration.sql)) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`INSERT INTO helpwell.schema_migrations (version, name) VALUES (${migration.version}, ${migration.name})`,
      );
      applied.push(migration.name);
    }

    return { applied, alreadyApplied };
  });
}

/** Everything HelpWell created, gone. Used by tests. */
export async function dropAll(db: Db): Promise<void> {
  await db.execute(sql`DROP SCHEMA IF EXISTS helpwell CASCADE`);
}
