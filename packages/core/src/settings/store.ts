/**
 * Reading and writing settings.
 *
 * The database row is the runtime copy; `helpwell sync` pushes the repo file
 * (`helpwell/helpwell.config.json`) over it, and the dashboard's Save buttons
 * merge into it. That split exists because the dashboard must not need write
 * access to the filesystem in production (serverless), while the repo must
 * stay the thing a coding agent edits and a PR reviews.
 *
 * Every store on the same database handle shares one cached copy, and every
 * read checks it is still current before using it, so a save is seen by the
 * very next read anywhere: the API, the dashboard and the help centre each
 * keep a store, and a dashboard save used to reach the widget only when the
 * API's own cache ran out. The check is the row's `xmin`, which Postgres
 * changes with every committed write, from this process or another one
 * (a second server, `helpwell sync`, a hand-run UPDATE), and which needs no
 * column of its own. A read whose copy is current costs one primary-key
 * lookup that returns a version string; only a changed row sends the
 * document back. Separate installs have separate databases, so they never
 * share a copy.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { firstRow } from '../db/rows.js';
import { settings as settingsTable } from '../db/schema.js';
import { defaultSettings, mergeSettings, parseSettings, type Settings } from './schema.js';

const ROW_ID = 'default';

/** A copy of the row, and the `xmin` it was read at (null: no row yet). */
interface Snapshot {
  value: Settings;
  version: string | null;
  checkedAt: number;
}

/** What every store on one database handle shares. */
interface Shared {
  snapshot: Snapshot | null;
  /** Bumped by every write, so a read that started before it is not reused after it. */
  generation: number;
  inflight: { generation: number; promise: Promise<Settings> } | null;
}

/**
 * Keyed by the handle itself: the dashboard, the API and the help centre of
 * one install are handed the same one, and a handle nobody holds any more
 * takes its copy with it. A transaction is a handle of its own, so what it
 * writes stays out of everyone else's copy until it commits.
 */
const sharedByDb = new WeakMap<Db, Shared>();

function sharedFor(db: Db): Shared {
  let shared = sharedByDb.get(db);
  if (!shared) {
    shared = { snapshot: null, generation: 0, inflight: null };
    sharedByDb.set(db, shared);
  }
  return shared;
}

export class SettingsStore {
  readonly #shared: Shared;
  /**
   * How long a read may use the shared copy without checking the version.
   * 0, the default, checks every time, so a save made anywhere shows up on
   * the next request. A save through any store on the same database handle
   * is seen at once whatever this says; only a save from elsewhere (another
   * process, `helpwell sync`) can wait out the window.
   */
  readonly ttlMs: number;

  constructor(
    private readonly db: Db,
    options: { ttlMs?: number } = {},
  ) {
    this.#shared = sharedFor(db);
    this.ttlMs = Math.max(0, options.ttlMs ?? 0);
  }

  async get(): Promise<Settings> {
    const shared = this.#shared;
    const snapshot = shared.snapshot;
    if (snapshot && this.ttlMs > 0 && Date.now() - snapshot.checkedAt < this.ttlMs) {
      return snapshot.value;
    }
    // Many requests can arrive at once; they share one query. Not one that
    // started before a save, though: it may be carrying the old row.
    const inflight = shared.inflight;
    if (inflight && inflight.generation === shared.generation) return inflight.promise;
    const next = {
      generation: shared.generation,
      promise: this.#read().finally(() => {
        if (shared.inflight === next) shared.inflight = null;
      }),
    };
    shared.inflight = next;
    return next.promise;
  }

  /** Replace the whole document. Used by the CLI when the repo file changes. */
  async replace(next: unknown): Promise<Settings> {
    const parsed = parseSettings(next);
    await this.#write(parsed);
    return parsed;
  }

  /** Merge a partial update. Used by every Save button in the dashboard. */
  async update(patch: unknown): Promise<Settings> {
    // Merge onto what the database holds now rather than a copy that may
    // be behind: another process (the CLI, a second server) may have written.
    const current = await this.#read();
    const next = mergeSettings(current, patch);
    await this.#write(next);
    return next;
  }

  /** When the row was last written, or null before anything has been saved. */
  async updatedAt(): Promise<Date | null> {
    const result = await this.db.execute<{ updated_at: string | Date }>(
      sql`SELECT updated_at FROM helpwell.settings WHERE id = ${ROW_ID}`,
    );
    const row = firstRow<{ updated_at: string | Date }>(result);
    return row ? new Date(row.updated_at) : null;
  }

  /** Forget the shared copy, so the next read on this database fetches the row. */
  invalidate(): void {
    this.#shared.snapshot = null;
    this.#shared.generation++;
  }

  /** The current settings: the shared copy when its version still matches, else the row. */
  async #read(): Promise<Settings> {
    const shared = this.#shared;
    const generation = shared.generation;
    const known = shared.snapshot;
    // The document comes back only when the version differs from the copy's.
    const result = await this.db.execute<{ version: string; data: unknown }>(sql`
      SELECT xmin::text AS version,
        CASE WHEN xmin::text = ${known?.version ?? null} THEN NULL ELSE data END AS data
      FROM helpwell.settings WHERE id = ${ROW_ID}
    `);
    const row = firstRow<{ version: string; data: unknown }>(result);
    const version = row ? String(row.version) : null;
    const value =
      known && known.version === version
        ? known.value
        : row && row.data !== null
          ? parseSettings(row.data)
          : defaultSettings();
    // A save that landed while this was in flight has the newer copy.
    if (shared.generation === generation) {
      shared.snapshot = { value, version, checkedAt: Date.now() };
    }
    return value;
  }

  async #write(value: Settings): Promise<void> {
    const shared = this.#shared;
    shared.generation++;
    const [row] = await this.db
      .insert(settingsTable)
      .values({ id: ROW_ID, data: value as unknown as Record<string, unknown> })
      .onConflictDoUpdate({
        target: settingsTable.id,
        set: { data: value as unknown as Record<string, unknown>, updatedAt: new Date() },
      })
      .returning({ version: sql<string>`xmin::text` });
    shared.generation++;
    shared.snapshot = {
      value,
      version: row ? String(row.version) : null,
      checkedAt: Date.now(),
    };
  }
}
