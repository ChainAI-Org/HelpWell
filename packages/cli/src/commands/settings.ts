/**
 * `helpwell settings pull` and `helpwell settings push`, and the rule `sync`
 * follows for which copy of the settings wins.
 *
 * Settings live twice: in helpwell.config.json, reviewed in pull requests,
 * and in the database, where the dashboard saves the moment you change
 * something. Neither may overwrite the other silently. `sync` pushes the file
 * only when it is the newer of the two; when the dashboard has moved on,
 * `pull` writes that into the file, and `push` says the file wins after all.
 */

import { readFileSync, statSync } from 'node:fs';
import type { Db } from '@helpwell/core/db';
import { type Settings, SettingsStore } from '@helpwell/core/settings';
import { loadProject, openDb, type Project, writeFile } from '../project.js';
import { detail, heading, ok, say } from '../ui.js';

export interface SettingsCommandOptions {
  cwd: string;
  url?: string;
}

export type NewerSide = 'file' | 'database' | 'same';

export interface SettingsComparison {
  /** Which copy changed most recently, or `same` when they already agree. */
  newer: NewerSide;
  fileAt: Date;
  /** Null before the first push, when there is no row yet. */
  databaseAt: Date | null;
  database: Settings;
}

export function sameSettings(a: Settings, b: Settings): boolean {
  // Both come out of parseSettings, which writes keys in schema order, so a
  // string comparison is a structural one.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The file's settings against the database's: which is newer, or `same`.
 *
 * "Newer" is the file's mtime against the row's `updated_at`. A fresh CI
 * checkout gives every file a brand-new mtime, so there the file always wins;
 * `sync --no-settings` is the answer when the dashboard owns settings.
 */
export async function compareSettings(
  project: Project,
  db: Db,
  store = new SettingsStore(db),
): Promise<SettingsComparison> {
  const database = await store.get();
  const fileAt = statSync(project.paths.configPath).mtime;
  const databaseAt = await store.updatedAt();

  if (sameSettings(project.config.settings, database)) {
    return { newer: 'same', fileAt, databaseAt, database };
  }
  return {
    newer: databaseAt && databaseAt.getTime() > fileAt.getTime() ? 'database' : 'file',
    fileAt,
    databaseAt,
    database,
  };
}

/** Write the database's settings into helpwell.config.json. */
export async function settingsPull(options: SettingsCommandOptions): Promise<Settings> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });

  try {
    heading('Pulling settings from the database');
    const settings = await new SettingsStore(handle.db).get();

    if (sameSettings(settings, project.config.settings)) {
      ok('helpwell.config.json already matches the database.');
      say();
      return settings;
    }

    // Replace only the settings key, so docs, screenshots and anything else
    // someone keeps in the file survive untouched.
    const raw = JSON.parse(readFileSync(project.paths.configPath, 'utf8')) as Record<
      string,
      unknown
    >;
    raw.settings = settings;
    writeFile(project.paths.configPath, `${JSON.stringify(raw, null, 2)}\n`);

    ok('Wrote the database settings into helpwell/helpwell.config.json');
    detail('Review the diff and commit it. `helpwell sync` now has nothing to overwrite.');
    say();
    return settings;
  } finally {
    await handle.close();
  }
}

/** Push helpwell.config.json into the database, whichever is newer. */
export async function settingsPush(options: SettingsCommandOptions): Promise<Settings> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });

  try {
    heading('Pushing settings to the database');
    const settings = await new SettingsStore(handle.db).replace(project.config.settings);
    ok('Pushed settings from helpwell.config.json');
    detail('Anything changed in the dashboard since the file was last edited is gone.');
    say();
    return settings;
  } finally {
    await handle.close();
  }
}
