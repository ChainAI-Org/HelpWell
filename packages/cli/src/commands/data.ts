/**
 * The commands that move data around: migrate, export, prune.
 *
 * All three exist because HelpWell keeps everything in the customer's own
 * database. They own the data, so they need a way to see it, take it, and
 * throw it away without asking anyone (CT-09, CT-10, DX-12).
 */

import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pruneRateCounters } from '@helpwell/core/agent';
import { type Db, loadMigrations, migrate, rowsOf, schema, schemaExists } from '@helpwell/core/db';
import { pruneConversations } from '@helpwell/core/repos';
import { type Settings, SettingsStore } from '@helpwell/core/settings';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { loadProject, openDb, redactUrl } from '../project.js';
import { detail, heading, ok, say, table, warn } from '../ui.js';

export interface MigrateSummary {
  applied: string[];
  alreadyApplied: string[];
  total: number;
  /** The connection string, with any password hidden. */
  database: string;
}

export async function runMigrate(options: { cwd: string; url?: string }): Promise<MigrateSummary> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url, migrate: false });

  try {
    heading('Migrating');
    detail(redactUrl(handle.url));

    const before = await schemaExists(handle.db);
    const result = await migrate(handle.db);

    say();
    if (result.applied.length === 0) {
      ok(before ? 'Already up to date.' : 'Nothing to apply.');
    } else {
      ok(`Applied ${result.applied.length} migration${result.applied.length === 1 ? '' : 's'}`);
      for (const name of result.applied) detail(name);
    }

    const all = loadMigrations();
    say();
    table([
      ['Migrations', `${result.applied.length} applied, ${all.length} total`],
      ['Database', redactUrl(handle.url)],
    ]);
    say();
    return {
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      total: all.length,
      database: redactUrl(handle.url),
    };
  } finally {
    await handle.close();
  }
}

export interface ExportOptions {
  cwd: string;
  url?: string;
  /** Where to write. Defaults to stdout. */
  out?: string;
  /**
   * Keep the shape and the counts, drop what a person said or is. Nulls
   * emails, names, avatars, external ids, IP hashes, locations and locales,
   * every comment, every page URL and identify attributes; replaces message
   * bodies with their length and drops tool calls; hashes search queries, gap
   * questions and roadmap titles with a per-export key so counts still add up;
   * empties event props and webhook payloads. Ids stay, so rows still join.
   */
  anonymise?: boolean;
  /** Write nothing to stdout even without `out`: `--json` prints the document itself. */
  quiet?: boolean;
}

/**
 * Every table in the schema except `settings`, which is exported as a
 * document with its secrets redacted rather than as a raw row. Derived from
 * the schema so a table added to core cannot be forgotten here.
 */
export const EXPORTED_TABLES: readonly string[] = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableName(table))
  .filter((name) => name !== 'settings');

const REDACTED = '<redacted>';

/** Settings without the values that would let someone impersonate the install. */
export function redactSettings(settings: Settings): Settings {
  const copy = JSON.parse(JSON.stringify(settings)) as Settings;
  for (const hook of copy.webhooks) {
    if (hook.secret) hook.secret = REDACTED;
  }
  return copy;
}

/**
 * Everything HelpWell holds, as one JSON document.
 *
 * Deliberately a plain dump rather than a restorable backup format: the point
 * is that a customer can read it, grep it, and load it somewhere else without
 * needing HelpWell to do it for them. Webhook secrets are redacted whatever
 * the flags say; an export is a file that gets emailed.
 */
export async function runExport(options: ExportOptions): Promise<string> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });

  try {
    const settings = await new SettingsStore(handle.db).get();
    const anonymise = options.anonymise ? anonymiser() : null;

    const data: Record<string, unknown> = {};
    for (const table of EXPORTED_TABLES) {
      data[table] = await dump(handle.db, table, anonymise);
    }

    const document = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        product: settings.product.name,
        anonymised: options.anonymise ?? false,
        settings: redactSettings(settings),
        data,
      },
      null,
      2,
    );

    if (options.out) {
      writeFileSync(options.out, `${document}\n`, 'utf8');
      ok(`Wrote ${options.out}`);
      const counts = Object.entries(data).map(
        ([name, rows]) => [name, String((rows as unknown[]).length)] as [string, string],
      );
      say();
      table(counts);
      say();
    } else if (!options.quiet) {
      process.stdout.write(`${document}\n`);
    }

    return document;
  } finally {
    await handle.close();
  }
}

type Row = Record<string, unknown>;

async function dump(
  db: Db,
  table: string,
  anonymise: ((table: string, row: Row) => Row) | null,
): Promise<unknown[]> {
  // Table names come from the schema module, never from input.
  const result = await db.execute(sql.raw(`SELECT * FROM helpwell."${table}"`));
  const rows = rowsOf<Row>(result);
  return anonymise ? rows.map((row) => anonymise(table, row)) : rows;
}

/**
 * Anonymising keeps the shape and the counts, and drops anything that could
 * identify a person or repeat what they said. Free text that is useful in
 * aggregate (searches, gap questions) is hashed with a key made for this one
 * export: the same query hashes the same within the file, so "asked 14 times"
 * survives, but nothing can be looked up across exports.
 */
function anonymiser(): (table: string, row: Row) => Row {
  const key = randomBytes(32);
  const hash = (value: unknown): unknown =>
    typeof value === 'string' && value
      ? `hashed:${createHmac('sha256', key).update(value).digest('hex').slice(0, 24)}`
      : value;

  return (table, row) => {
    const copy: Row = { ...row };
    const drop = (...fields: string[]) => {
      for (const field of fields) if (field in copy) copy[field] = null;
    };
    const mask = (...fields: string[]) => {
      for (const field of fields) if (field in copy) copy[field] = hash(copy[field]);
    };

    // Who someone is.
    if (table === 'contacts') drop('name');
    drop('email', 'avatar_url', 'external_id', 'ip_hash', 'locale', 'timezone', 'country', 'city');
    if ('attributes' in copy) copy.attributes = {};

    // What they said.
    drop('comment', 'rating_comment', 'feedback_comment', 'detail', 'suggested_title');
    if (table === 'messages') {
      copy.body = `[${String(copy.body ?? '').length} chars]`;
      copy.tool_calls = [];
    }
    mask('query', 'question', 'asked_as');
    if (table === 'gaps' && Array.isArray(copy.variants)) copy.variants = copy.variants.map(hash);
    if (table === 'roadmap_items') {
      mask('title');
      drop('body');
    }

    // Where they were. A webhook delivery's url is the operator's endpoint,
    // not a visitor's page, so it stays; its payload does not.
    drop('page_url');
    if (table !== 'webhook_deliveries') drop('url');
    if ('props' in copy) copy.props = {};
    if ('payload' in copy) copy.payload = {};
    // A delivery keeps the exact bytes it sent, which is the payload again.
    if (table === 'webhook_deliveries') drop('body');
    // A field's example value is somebody's value.
    if (table === 'contact_fields') drop('sample');

    return copy;
  };
}

export interface PruneSummary {
  conversationsDeleted: number;
  countersCleared: number;
  /** 0 means conversations are kept forever. */
  retentionMonths: number;
}

export async function runPrune(options: {
  cwd: string;
  url?: string;
  months?: number;
}): Promise<PruneSummary> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });

  try {
    const settings = await new SettingsStore(handle.db).get();
    const months = options.months ?? settings.data.retentionMonths;

    heading('Housekeeping');

    if (months <= 0) {
      warn('Retention is set to keep conversations forever, so none were deleted.');
      detail('Set data.retentionMonths, or pass --months.');
    }

    const [conversations, counters] = await Promise.all([
      pruneConversations(handle.db, months),
      pruneRateCounters(handle.db),
    ]);

    say();
    table([
      ['Conversations deleted', String(conversations)],
      ['Rate counters cleared', String(counters)],
      ['Retention', months > 0 ? `${months} months` : 'forever'],
    ]);
    detail('Contacts are never deleted automatically. Erase one from their page.');
    say();
    return {
      conversationsDeleted: conversations,
      countersCleared: counters,
      retentionMonths: months,
    };
  } finally {
    await handle.close();
  }
}
