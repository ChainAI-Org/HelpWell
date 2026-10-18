/**
 * Facts about this install that are not settings.
 *
 * The dashboard's "Get set up" checklist needs to know a few things no config
 * file should hold: whether the widget has ever loaded on a real page, and what
 * the person told the checklist (that they dismissed it, or that they set up
 * the MCP server, which HelpWell cannot see for itself). They live in
 * `helpwell.install_state` (migration 0010) rather than in the settings
 * document, because `helpwell sync` replaces that document from the repo.
 *
 * The widget sighting is written from the API route the widget calls on every
 * page load, so it has to cost nothing: one insert the first time, then at
 * most one small update an hour per process, and it never throws into the
 * request it rides on.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';

const WIDGET_KEY = 'widget_seen';
const CHECKLIST_KEY = 'checklist';

/** How often one process refreshes "last seen". The first sighting is always written. */
const REFRESH_MS = 60 * 60 * 1000;

/** When each database last had a sighting written by this process. */
const lastWrite = new WeakMap<Db, number>();

export interface WidgetSighting {
  /** The first time the widget loaded outside the help centre. */
  firstSeenAt: Date;
  /** The page it loaded on, when the browser said (origin and path, no query). */
  firstPage: string | null;
  lastSeenAt: Date;
  lastPage: string | null;
}

export interface ChecklistState {
  /** Set once the finished checklist has been put away. */
  dismissedAt: Date | null;
  /** Optional steps the person marked done themselves, by key. */
  done: string[];
}

/**
 * Record that the widget loaded. `helpCenterPath` is the help centre's own
 * mount (it embeds the widget too), whose pages do not count as an install.
 */
export async function noteWidgetSeen(
  db: Db,
  request: Request,
  options: { helpCenterPath?: string; now?: Date } = {},
): Promise<void> {
  try {
    const now = options.now ?? new Date();
    const previous = lastWrite.get(db);
    if (previous !== undefined && now.getTime() - previous < REFRESH_MS) return;

    const page = pageOf(request);
    if (page && options.helpCenterPath && isUnder(page, options.helpCenterPath)) return;

    lastWrite.set(db, now.getTime());
    const at = now.toISOString();
    const first = JSON.stringify({
      firstSeenAt: at,
      firstPage: page,
      lastSeenAt: at,
      lastPage: page,
    });
    const last = JSON.stringify({ lastSeenAt: at, lastPage: page });
    await db.execute(sql`
      INSERT INTO helpwell.install_state (key, value, updated_at)
      VALUES (${WIDGET_KEY}, ${first}::jsonb, ${at})
      ON CONFLICT (key) DO UPDATE
        SET value = helpwell.install_state.value || ${last}::jsonb, updated_at = ${at}
    `);
  } catch {
    // A sighting is a nicety for the checklist. The widget's config must load.
  }
}

/** The widget's first and latest sighting, or null when it has never loaded. */
export async function widgetSighting(db: Db): Promise<WidgetSighting | null> {
  const value = await read(db, WIDGET_KEY);
  if (!value) return null;
  const firstSeenAt = dateOf(value.firstSeenAt);
  if (!firstSeenAt) return null;
  return {
    firstSeenAt,
    firstPage: typeof value.firstPage === 'string' ? value.firstPage : null,
    lastSeenAt: dateOf(value.lastSeenAt) ?? firstSeenAt,
    lastPage: typeof value.lastPage === 'string' ? value.lastPage : null,
  };
}

export async function checklistState(db: Db): Promise<ChecklistState> {
  const value = await read(db, CHECKLIST_KEY);
  return {
    dismissedAt: dateOf(value?.dismissedAt),
    done: Array.isArray(value?.done)
      ? (value.done as unknown[]).filter((item): item is string => typeof item === 'string')
      : [],
  };
}

/** Dismiss or bring back the checklist, or mark an optional step done or not done. */
export async function updateChecklistState(
  db: Db,
  change: { dismissed?: boolean; done?: { key: string; value: boolean } },
  now = new Date(),
): Promise<ChecklistState> {
  const current = await checklistState(db);
  const done = new Set(current.done);
  if (change.done) {
    const key = change.done.key.slice(0, 40);
    if (change.done.value) done.add(key);
    else done.delete(key);
  }
  const next: ChecklistState = {
    dismissedAt:
      change.dismissed === undefined
        ? current.dismissedAt
        : change.dismissed
          ? (current.dismissedAt ?? now)
          : null,
    done: [...done].sort(),
  };
  const value = JSON.stringify({
    dismissedAt: next.dismissedAt?.toISOString() ?? null,
    done: next.done,
  });
  await db.execute(sql`
    INSERT INTO helpwell.install_state (key, value, updated_at)
    VALUES (${CHECKLIST_KEY}, ${value}::jsonb, ${now.toISOString()})
    ON CONFLICT (key) DO UPDATE SET value = ${value}::jsonb, updated_at = ${now.toISOString()}
  `);
  return next;
}

async function read(db: Db, key: string): Promise<Record<string, unknown> | null> {
  const result = await db.execute(
    sql`SELECT value FROM helpwell.install_state WHERE key = ${key} LIMIT 1`,
  );
  const value = rowsOf<{ value: unknown }>(result)[0]?.value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * The page the widget loaded on, from the Referer the browser sent with the
 * config request: origin and path only, so a query string's token never lands
 * in the database. Null when there is none, or it is not a web URL.
 */
function pageOf(request: Request): string | null {
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

function isUnder(page: string, mount: string): boolean {
  const base = `/${mount.replace(/^\/+|\/+$/g, '')}`;
  if (base === '/') return false;
  try {
    const path = new URL(page).pathname;
    return path === base || path.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
