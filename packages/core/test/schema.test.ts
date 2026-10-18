/**
 * The Drizzle schema against the SQL that actually runs.
 *
 * `db/schema.ts` says it is a mirror of the migrations and that this file
 * checks the two never drift. For a long time it was not true, so a column
 * added to one and not the other would only show up as a runtime error in
 * whichever query happened to touch it first.
 *
 * The check is deliberately structural — table names and column names — rather
 * than a full type comparison. Anything finer starts failing on the
 * differences between how a driver reports a type and how Drizzle spells it,
 * and the failure mode worth catching is a forgotten table or column.
 */

import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { rowsOf } from '../src/db/rows.js';
import * as schema from '../src/db/schema.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;

/** Every table the migrations created, with the columns they gave it. */
let live: Map<string, Set<string>>;

beforeAll(async () => {
  t = await freshDb();
  const result = await t.db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'helpwell'
  `);

  live = new Map();
  for (const row of rowsOf<{ table_name: string; column_name: string }>(result)) {
    const columns = live.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    live.set(row.table_name, columns);
  }
});

afterAll(async () => {
  await t.close();
});

/** The Drizzle tables, keyed by the name they claim in Postgres. */
function declaredTables(): Map<string, PgTable> {
  const tables = new Map<string, PgTable>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) tables.set(getTableName(value), value);
  }
  return tables;
}

it('declares a Drizzle table for something the migrations really created', () => {
  const missing = [...declaredTables().keys()].filter((name) => !live.has(name));
  expect(missing).toEqual([]);
});

it('gives every declared column a column that exists', () => {
  const wrong: string[] = [];
  for (const [name, table] of declaredTables()) {
    const columns = live.get(name);
    if (!columns) continue; // the test above already reports this
    for (const column of Object.values(getTableColumns(table))) {
      if (!columns.has(column.name)) wrong.push(`${name}.${column.name}`);
    }
  }
  expect(wrong).toEqual([]);
});

it('has a Drizzle table for every table the migrations create', () => {
  const declared = declaredTables();
  const undeclared = [...live.keys()].filter(
    // schema_migrations is the migrator's own bookkeeping and is written with
    // raw SQL on purpose, so that nothing can typo it into a new table.
    (name) => name !== 'schema_migrations' && !declared.has(name),
  );
  expect(undeclared).toEqual([]);
});

it('covers the collection metadata the help centre reads', () => {
  // A guard on the specific table this test was written alongside: the one
  // that existed only in the repo for months before it reached the database.
  expect(live.get('collection_index')).toBeDefined();
  expect([...(live.get('collection_index') ?? [])].sort()).toEqual([
    'ask_agent',
    'description',
    'icon',
    'id',
    'order_index',
    'tint',
    'title',
    'updated_at',
    'visibility',
  ]);
});
