/**
 * Content sync: telling a support extension what this install has published.
 *
 * A hosted service that writes about the product (a newsletter, a digest of
 * what shipped) needs the install's articles, changelog and roadmap, and the
 * tours and surveys a proactive item can start. It cannot call into the
 * install: HelpWell has no inbound API for it and wants none. So HelpWell
 * pushes a manifest instead, through `SupportExtension.contentSync` (and
 * `catalog`, for an extension that wants only the tours and surveys).
 *
 * When. Each handler looks, at most once a minute and only while it is
 * serving requests, at a cheap fingerprint of what the manifest would hold:
 * counts and last-changed times, and the catalog. When that has moved (a
 * `helpwell sync`, an article saved in the dashboard, a release published, a
 * tour added) the manifest goes out; otherwise at most once an hour, so a
 * service that lost one catches up. A host that indexes content itself can
 * call `pushContentSync` straight after `syncContent`.
 *
 * Never in the visitor's way: the look happens after a request has been
 * handed to its route, and nothing it does can fail a request. What goes out
 * is what the public help centre shows: published articles in public
 * collections, published changelog entries, and the roadmap.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { Settings } from '../settings/schema.js';
import { consoleSupportLogger, type SupportLogger } from './fail-open.js';
import type { ContentManifest, EngageCatalog, SupportExtension } from './support-extension.js';

/** How often a handler looks for a change, and the longest it goes without a push. */
const CHECK_EVERY_MS = 60_000;
const PUSH_AT_LEAST_EVERY_MS = 60 * 60_000;
/** How much of each article's body the manifest carries. */
const EXCERPT = 600;
const MAX_ARTICLES = 1_000;
const MAX_CHANGELOG = 200;
const MAX_ROADMAP = 300;

export interface ContentSync {
  /** A request came in: look for a change, now and then. Returns at once; never throws. */
  tick(): void;
  /** Build the manifest and push it now. Resolves to whether it was pushed. */
  push(): Promise<boolean>;
}

export interface ContentSyncOptions {
  db: Db;
  support: SupportExtension | undefined;
  /** The install's settings, as they are now. */
  settings: () => Promise<Settings>;
  logger?: SupportLogger;
  /** Milliseconds; for tests. */
  now?: () => number;
  checkEveryMs?: number;
  pushAtLeastEveryMs?: number;
}

/**
 * The content syncer for one handler, or null when its extension takes no
 * content (neither `contentSync` nor `catalog`).
 */
export function createContentSync(options: ContentSyncOptions): ContentSync | null {
  const { db, support } = options;
  if (!support?.contentSync && !support?.catalog) return null;
  const clock = options.now ?? Date.now;
  const logger = options.logger ?? consoleSupportLogger;
  const checkEvery = options.checkEveryMs ?? CHECK_EVERY_MS;
  const pushEvery = options.pushAtLeastEveryMs ?? PUSH_AT_LEAST_EVERY_MS;

  let lastCheck = Number.NEGATIVE_INFINITY;
  let lastPush = Number.NEGATIVE_INFINITY;
  let pushedPrint: string | null = null;
  let running: Promise<unknown> | null = null;

  const push = async (settings?: Settings): Promise<boolean> => {
    const current = settings ?? (await options.settings());
    const manifest = await buildContentManifest(db, current);
    await pushContentSync(support, manifest);
    lastPush = clock();
    pushedPrint = await contentFingerprint(db, current);
    return true;
  };

  const check = async () => {
    const settings = await options.settings();
    const print = await contentFingerprint(db, settings);
    if (print !== pushedPrint || clock() - lastPush >= pushEvery) await push(settings);
  };

  return {
    tick() {
      const at = clock();
      if (running || at - lastCheck < checkEvery) return;
      lastCheck = at;
      running = check()
        .catch((error: unknown) => {
          logger.warn('could not send this install’s content to the support extension.', {
            error: error instanceof Error ? error.message.slice(0, 300) : String(error),
          });
        })
        .finally(() => {
          running = null;
        });
    },
    push: () => push(),
  };
}

/**
 * Push a manifest to an extension: `contentSync` with all of it, `catalog`
 * with its catalog. For a host that indexes content itself, straight after
 * `syncContent`. An extension behind the fail-open wrapper never throws here.
 */
export async function pushContentSync(
  support: SupportExtension | undefined,
  manifest: ContentManifest,
): Promise<void> {
  if (support?.contentSync) await support.contentSync(manifest);
  if (support?.catalog) await support.catalog(manifest.catalog);
}

/* -------------------------------------------------------------- manifest */

/** Everything the manifest holds, read now. */
export async function buildContentManifest(db: Db, settings: Settings): Promise<ContentManifest> {
  const help = helpCenterUrl(settings);
  const link = (path: string) => (help ? `${help}${path}` : null);

  const articles = rowsOf<{
    slug: string;
    title: string;
    description: string | null;
    collection: string;
    body: string;
    updated_at: string | Date;
  }>(
    await db.execute(sql`
      SELECT a.slug, a.title, a.description, a.collection, a.body, a.updated_at
      FROM helpwell.article_index a
      WHERE ${publicArticle}
      ORDER BY a.collection, a.order_index, a.title
      LIMIT ${MAX_ARTICLES}
    `),
  );
  const changelog = rowsOf<{
    id: string;
    version: string | null;
    title: string;
    summary: string | null;
    body: string;
    published_at: string | Date | null;
  }>(
    await db.execute(sql`
      SELECT id, version, title, summary, body, published_at
      FROM helpwell.changelog_entries
      WHERE status = 'published'
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT ${MAX_CHANGELOG}
    `),
  );
  const roadmap = rowsOf<{ id: string; title: string; status: string; votes_count: number }>(
    await db.execute(sql`
      SELECT id, title, status, votes_count
      FROM helpwell.roadmap_items
      ORDER BY votes_count DESC, created_at DESC
      LIMIT ${MAX_ROADMAP}
    `),
  );

  const body: Omit<ContentManifest, 'generatedAt' | 'fingerprint'> = {
    version: 1,
    product: { name: settings.product.name, helpCenterUrl: help },
    articles: articles.map((a) => ({
      slug: a.slug,
      title: a.title,
      description: a.description ?? null,
      collection: a.collection,
      url: link(`/${a.slug.split('/').map(encodeURIComponent).join('/')}`),
      updatedAt: new Date(a.updated_at).toISOString(),
      excerpt: plainExcerpt(a.body, EXCERPT),
    })),
    changelog: changelog.map((entry) => ({
      id: entry.id,
      version: entry.version ?? null,
      title: entry.title,
      date: entry.published_at ? new Date(entry.published_at).toISOString() : null,
      url: link(`/changelog/${encodeURIComponent(entry.version || entry.id)}`),
      summary: (entry.summary?.trim() || plainExcerpt(entry.body, 300)).slice(0, 500),
    })),
    roadmap: roadmap.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      votes: Number(item.votes_count) || 0,
      url: link('/roadmap'),
    })),
    catalog: engageCatalog(settings),
  };
  return {
    ...body,
    generatedAt: new Date().toISOString(),
    fingerprint: await hash(JSON.stringify(body)),
  };
}

/** The install's tours and surveys, by id: what a proactive item can start. */
export function engageCatalog(settings: Settings): EngageCatalog {
  const list = (kind: 'tour' | 'survey') =>
    settings.engage.engagements
      .filter((e) => e.kind === kind)
      .map((e) => ({ id: e.id, name: e.name || e.id, enabled: e.enabled }));
  return { tours: list('tour'), surveys: list('survey') };
}

/**
 * Something that moves whenever the manifest would: counts and last-changed
 * times of what it reads, and the catalog. Cheap, so it can be asked often.
 */
export async function contentFingerprint(db: Db, settings: Settings): Promise<string> {
  const [row] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM helpwell.article_index a WHERE ${publicArticle}) AS articles,
        (SELECT max(a.updated_at) FROM helpwell.article_index a WHERE ${publicArticle}) AS articles_at,
        (SELECT count(*) FROM helpwell.changelog_entries WHERE status = 'published') AS releases,
        (SELECT max(updated_at) FROM helpwell.changelog_entries) AS releases_at,
        (SELECT count(*) FROM helpwell.roadmap_items) AS ideas,
        (SELECT max(updated_at) FROM helpwell.roadmap_items) AS ideas_at,
        (SELECT coalesce(sum(votes_count), 0) FROM helpwell.roadmap_items) AS votes,
        (SELECT max(updated_at) FROM helpwell.collection_index) AS collections_at
    `),
  );
  return await hash(
    JSON.stringify([row, engageCatalog(settings), settings.product.name, helpCenterUrl(settings)]),
  );
}

/** Published, and not in a collection only signed-in people can read. */
const publicArticle = sql`a.status = 'published' AND NOT EXISTS (
  SELECT 1 FROM helpwell.collection_index c
  WHERE c.id = a.collection AND c.visibility = 'identified')`;

/**
 * Where the help centre is: its own domain when one is set, else the
 * product's address with the help centre's subpath. Null when neither says.
 */
function helpCenterUrl(settings: Settings): string | null {
  const domain = settings.helpCenter.domain.trim().replace(/\/+$/, '');
  if (domain) {
    const withScheme = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
    try {
      const url = new URL(withScheme);
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return null;
    }
  }
  const app = settings.product.appUrl;
  if (!app) return null;
  try {
    const origin = new URL(app).origin;
    const subpath = settings.helpCenter.subpath.trim().replace(/\/+$/, '');
    return `${origin}${subpath.startsWith('/') || !subpath ? subpath : `/${subpath}`}`;
  } catch {
    return null;
  }
}

/** Markdown as a line of plain text, cut at a word near `max`. */
function plainExcerpt(markdown: string, max: number): string {
  const text = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:::.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Web Crypto rather than node:crypto, so this runs wherever the handler does. */
async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
