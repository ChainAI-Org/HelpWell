/**
 * An article's history, and saving an article from outside the repo.
 *
 * The history is the versions the indexer recorded each time an article's
 * words changed (KB-16): who made the change (a sync, the dashboard or the
 * API), when, and what the file said. Comparing two of them gives the diff the
 * dashboard shows, word-level where a line was edited rather than replaced.
 *
 * Saving goes through the host's `writeArticle` hook, because the repo is the
 * source of truth and HelpWell never writes a file itself. Once the hook has
 * written it, the one article is re-indexed, so the help centre shows the
 * change straight away and the history gains a version. Restoring an old
 * version is a save of its words, so it adds to the history and never
 * rewrites it.
 */

import { sql } from 'drizzle-orm';
import type { ModelPort } from '../agent/model.js';
import { parseArticle } from '../content/articles.js';
import { type DiffLine, diffLines, diffStats } from '../content/diff.js';
import {
  EMPTY_ARTICLE_MESSAGE,
  isArticlePath,
  isEmptyArticleBody,
  MAX_ARTICLE_BYTES,
  type WriteArticle,
} from '../content/editing.js';
import { stringifyFrontmatter } from '../content/frontmatter.js';
import type { MediaPaths } from '../content/media.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { articleIndex } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { indexArticle, type VersionOrigin } from '../search/indexer.js';
import type { WebhookOptions } from '../webhooks.js';

export interface ArticleVersionSummary {
  id: number;
  slug: string;
  path: string | null;
  title: string;
  status: string;
  origin: VersionOrigin;
  createdAt: Date;
  /** The version this one brought back, when a restore saved it. */
  restoredFrom?: number | null;
}

export interface ArticleVersion extends ArticleVersionSummary {
  description: string | null;
  /** The body as written, without front matter. */
  body: string;
  /** The whole file as written, when the indexer had it. */
  source: string | null;
  contentHash: string;
}

interface VersionRow {
  id: number | string;
  slug: string;
  path: string | null;
  title: string;
  status: string;
  origin: VersionOrigin;
  created_at: string | Date;
  restored_from?: number | string | null;
  description?: string | null;
  body?: string;
  source?: string | null;
  content_hash?: string;
}

function summary(row: VersionRow): ArticleVersionSummary {
  return {
    id: Number(row.id),
    slug: row.slug,
    path: row.path,
    title: row.title,
    status: row.status,
    origin: row.origin,
    createdAt: new Date(row.created_at),
    restoredFrom:
      row.restored_from === null || row.restored_from === undefined
        ? null
        : Number(row.restored_from),
  };
}

/** Newest first. */
export async function listArticleVersions(
  db: Db,
  slug: string,
  options: { limit?: number } = {},
): Promise<ArticleVersionSummary[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
  const result = await db.execute(sql`
    SELECT id, slug, path, title, status, origin, restored_from, created_at
    FROM helpwell.article_versions
    WHERE slug = ${slug}
    ORDER BY id DESC
    LIMIT ${limit}
  `);
  return rowsOf<VersionRow>(result).map(summary);
}

export async function getArticleVersion(
  db: Db,
  slug: string,
  id: number,
): Promise<ArticleVersion | null> {
  if (!Number.isSafeInteger(id)) return null;
  const result = await db.execute(sql`
    SELECT id, slug, path, title, status, origin, restored_from, created_at, description, body,
           source, content_hash
    FROM helpwell.article_versions
    WHERE slug = ${slug} AND id = ${id}
    LIMIT 1
  `);
  const row = rowsOf<VersionRow>(result)[0];
  if (!row) return null;
  return {
    ...summary(row),
    description: row.description ?? null,
    body: row.body ?? '',
    source: row.source ?? null,
    contentHash: row.content_hash ?? '',
  };
}

export interface ArticleComparison {
  /** Null when `to` is the first version: everything in it is new. */
  from: ArticleVersionSummary | null;
  to: ArticleVersionSummary;
  lines: DiffLine[];
  added: number;
  removed: number;
}

/**
 * The difference between two versions of one article. With no `fromId`, the
 * version just before `toId`, which is what "what changed here" means.
 *
 * Whole files are compared when both versions have one, so a status going
 * from draft to published shows up; otherwise the bodies.
 */
export async function compareArticleVersions(
  db: Db,
  slug: string,
  toId: number,
  fromId?: number | null,
): Promise<ArticleComparison | null> {
  const to = await getArticleVersion(db, slug, toId);
  if (!to) return null;

  let from: ArticleVersion | null = null;
  if (fromId !== undefined && fromId !== null) {
    from = await getArticleVersion(db, slug, fromId);
    if (!from) return null;
  } else {
    const result = await db.execute(sql`
      SELECT id FROM helpwell.article_versions
      WHERE slug = ${slug} AND id < ${toId}
      ORDER BY id DESC
      LIMIT 1
    `);
    const before = rowsOf<{ id: number | string }>(result)[0];
    from = before ? await getArticleVersion(db, slug, Number(before.id)) : null;
  }

  const whole = Boolean(to.source && (from === null || from.source));
  const text = (version: ArticleVersion | null) =>
    version === null ? '' : whole ? (version.source ?? '') : version.body;
  const lines = diffLines(text(from), text(to));
  return {
    from: from ? summarise(from) : null,
    to: summarise(to),
    lines,
    ...diffStats(lines),
  };
}

function summarise(version: ArticleVersion): ArticleVersionSummary {
  const { id, slug, path, title, status, origin, createdAt, restoredFrom } = version;
  return { id, slug, path, title, status, origin, createdAt, restoredFrom };
}

export interface ArticleSource {
  slug: string;
  collection: string;
  /** Relative to the docs folder. A best guess for an article indexed before 0006. */
  path: string;
  /** False when `path` is that guess. */
  pathKnown: boolean;
  /** The file as written. Rebuilt from the index for an article indexed before 0006. */
  markdown: string;
}

/**
 * What an editor opens: the file as it was written, not the body the index
 * searches, whose image paths have been rewritten to served URLs.
 */
export async function articleSource(db: Db, slug: string): Promise<ArticleSource | null> {
  const [row] = await db
    .select({
      slug: articleIndex.slug,
      collection: articleIndex.collection,
      title: articleIndex.title,
      description: articleIndex.description,
      status: articleIndex.status,
      body: articleIndex.body,
      path: articleIndex.path,
      source: articleIndex.source,
    })
    .from(articleIndex)
    .where(sql`slug = ${slug}`)
    .limit(1);
  if (!row) return null;

  const guess = `${row.collection}/${slug.split('/').pop() ?? slug}.md`;
  const markdown =
    row.source ??
    stringifyFrontmatter(
      {
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        status: row.status,
      },
      row.body,
    );
  return {
    slug: row.slug,
    collection: row.collection,
    path: row.path ?? guess,
    pathKnown: row.path !== null,
    markdown,
  };
}

export interface SaveArticleInput {
  /** Relative to the docs folder: `<collection>/<file>.md`. */
  path: string;
  /** The whole file, front matter included. */
  markdown: string;
  /** The host's hook. Without one there is nowhere to save to. */
  write: WriteArticle | undefined;
  /** How image paths become served URLs when the saved article is indexed. */
  media?: MediaPaths | false;
  origin?: VersionOrigin;
  /** A new article: refuse rather than overwrite one already at that path or slug. */
  create?: boolean;
  /** The article being edited, when it is an edit. */
  slug?: string;
  /**
   * Embed the saved article now, with this port and model name. Left out,
   * it is indexed as text and picks up a vector on the next sync. A provider
   * that fails does not fail the save: the file is already written.
   */
  model?: ModelPort;
  embeddingModel?: string;
  /** How `article.published` is sent, when the save publishes it: the install's own fetch. */
  webhooks?: WebhookOptions;
}

export interface SaveArticleResult {
  slug: string;
  path: string;
  title: string;
  /** False when the file was saved exactly as it already was. */
  changed: boolean;
  versionId: number | null;
  /**
   * Whether semantic search has the article as saved: embedded just now, or
   * unchanged and keeping the vector it had. False means text search only,
   * until a sync with a model key embeds it.
   */
  embedded: boolean;
}

export async function saveArticle(db: Db, input: SaveArticleInput): Promise<SaveArticleResult> {
  const path = input.path.trim();
  if (!isArticlePath(path)) {
    throw new HelpWellError('bad_request', `Not an article path: ${path}`, {
      publicMessage:
        'An article lives at <collection>/<file>.md inside the docs folder. That path is not one.',
    });
  }
  if (new TextEncoder().encode(input.markdown).length > MAX_ARTICLE_BYTES) {
    throw new HelpWellError('bad_request', 'Article too large', {
      publicMessage: 'That article is too large to save from here.',
    });
  }
  if (!input.write) {
    throw new HelpWellError('not_configured', 'No writeArticle hook', {
      publicMessage:
        'This install cannot save articles to the repo. Pass writeArticle when mounting HelpWell.',
    });
  }

  const [collection, file] = path.split('/') as [string, string];
  const article = parseArticle(input.markdown, {
    collection,
    file,
    updatedAt: new Date(),
    media: input.media,
  });
  // A draft may be empty while it is written; a published page may not.
  if (article.status === 'published' && isEmptyArticleBody(article.body, article.title)) {
    throw new HelpWellError('bad_request', 'A published article needs a body', {
      publicMessage: EMPTY_ARTICLE_MESSAGE,
    });
  }

  // Two files must never claim one slug, and a new article must never land
  // on top of an existing one.
  const taken = rowsOf<{ slug: string; path: string | null }>(
    await db.execute(sql`
      SELECT slug, path FROM helpwell.article_index
      WHERE slug = ${article.slug} OR path = ${path}
    `),
  );
  for (const row of taken) {
    const same = row.slug === input.slug || (row.path === path && !input.create);
    if (input.create || !same) {
      throw new HelpWellError('conflict', `Article already exists: ${row.slug}`, {
        publicMessage:
          row.path === path
            ? `There is already an article at ${path}.`
            : `Another article already uses the slug ${article.slug}.`,
      });
    }
  }

  try {
    await input.write(path, input.markdown);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new HelpWellError('upstream_failed', `writeArticle failed: ${reason}`, {
      publicMessage: `The file could not be saved: ${reason}`,
      cause,
    });
  }

  const origin = input.origin ?? 'dashboard';
  let indexed: Awaited<ReturnType<typeof indexArticle>>;
  try {
    indexed = await indexArticle(db, article, {
      origin,
      model: input.model,
      embeddingModel: input.embeddingModel,
      webhooks: input.webhooks,
    });
  } catch (error) {
    if (!input.model) throw error;
    indexed = await indexArticle(db, article, { origin, webhooks: input.webhooks });
  }
  // A slug changed in the front matter moves the article; the old row would
  // otherwise linger until the next sync.
  if (input.slug && input.slug !== article.slug) {
    await db.delete(articleIndex).where(sql`slug = ${input.slug}`);
  }

  return {
    slug: article.slug,
    path,
    title: article.title,
    changed: indexed.changed,
    versionId: indexed.versionId,
    embedded: indexed.embedded,
  };
}

/* --------------------------------------------------------------- restore */

export interface RestoreArticleInput
  extends Pick<
    SaveArticleInput,
    'write' | 'media' | 'origin' | 'model' | 'embeddingModel' | 'webhooks'
  > {
  /** The article as it is known now. */
  slug: string;
  /** The version to bring back: one of this article's own. */
  versionId: number;
}

export interface RestoreArticleResult extends SaveArticleResult {
  /** The version that was brought back. */
  restoredFrom: number;
}

/**
 * Bring an article back to what one of its versions said.
 *
 * History is never rewritten: the old file is saved again, through the same
 * hook or writable source any save goes through, and becomes the article's
 * newest version, marked with the version it came from. Everything in
 * between stays in the history, so a restore can itself be undone by
 * restoring the version before it. Restoring the words the article already
 * has is not an error; it saves nothing, and `changed` says so.
 *
 * The file goes back where the article lives now. A version recorded before
 * the index kept whole files is rebuilt from its title, description, status
 * and body.
 */
export async function restoreArticleVersion(
  db: Db,
  input: RestoreArticleInput,
): Promise<RestoreArticleResult> {
  const version = await getArticleVersion(db, input.slug, input.versionId);
  if (!version) {
    throw new HelpWellError('not_found', 'No such version', {
      publicMessage: 'That version is not in this article’s history.',
    });
  }
  const current = await articleSource(db, input.slug);
  const path = current?.path ?? version.path;
  if (!path) {
    throw new HelpWellError('bad_request', 'No path to restore to', {
      publicMessage:
        'The index does not know where this article was stored, so that version cannot be restored.',
    });
  }
  const markdown =
    version.source ??
    stringifyFrontmatter(
      {
        title: version.title,
        ...(version.description ? { description: version.description } : {}),
        status: version.status,
      },
      version.body,
    );

  const saved = await saveArticle(db, {
    path,
    markdown,
    write: input.write,
    media: input.media,
    origin: input.origin,
    model: input.model,
    embeddingModel: input.embeddingModel,
    webhooks: input.webhooks,
    // Gone from the index since (a sync that no longer found the file): it
    // comes back as a new article at the path it had.
    create: current === null,
    slug: current ? input.slug : undefined,
  });
  if (saved.versionId !== null) {
    await db.execute(sql`
      UPDATE helpwell.article_versions SET restored_from = ${version.id}
      WHERE id = ${saved.versionId}
    `);
  }
  return { ...saved, restoredFrom: version.id };
}
