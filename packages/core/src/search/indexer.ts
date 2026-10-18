/**
 * Building the search index from the repo.
 *
 * Called by `helpwell sync`, by `helpwell dev` on file change, and after a doc
 * update merges. Articles whose content hash has not moved keep their existing
 * embedding, so re-indexing a 200-article help centre costs nothing. An
 * unchanged article with no vector at all (indexed before there was a key, or
 * saved from the dashboard with no model) is embedded the next time a model is
 * available, so adding a key and syncing once is enough. An article that did
 * change and could not be embedded loses its old vector: a vector for text the
 * article no longer says would match the wrong meaning.
 *
 * Every change the index sees is also recorded as a version of the article,
 * which is where the dashboard's history and diffs come from (KB-16).
 */

import { sql } from 'drizzle-orm';
import { recordSpend } from '../agent/guards.js';
import type { ModelPort } from '../agent/model.js';
import { type Article, type Collection, hashContent } from '../content/articles.js';
import { parseFrontmatter } from '../content/frontmatter.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { articleIndex, articleVersions, collectionIndex, UNORDERED } from '../db/schema.js';
import { emitStoredWebhooks, type WebhookOptions } from '../webhooks.js';

export interface IndexResult {
  indexed: number;
  unchanged: number;
  removed: number;
  embedded: number;
  /** Versions recorded: articles whose words changed since the last one. */
  versions: number;
}

/** Who made a change, as the history shows it. */
export type VersionOrigin = 'sync' | 'dashboard' | 'api';

/** Used when a caller passes a model but no name. The settings default. */
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

export interface IndexOptions {
  /** Provide a model to compute embeddings for the semantic pass. */
  model?: ModelPort;
  /** An empty string switches embeddings off even when a model is provided. */
  embeddingModel?: string;
  /** Re-embed everything, even unchanged articles. */
  force?: boolean;
  /**
   * Called after each article is written. Indexing a large knowledge base with
   * embeddings is slow enough that a silent command looks hung.
   */
  onProgress?: (done: number, total: number) => void;
  /** Recorded on any version this run creates. Defaults to `sync`. */
  origin?: VersionOrigin;
  /** How `article.published` is sent: the install's own webhook fetch, when it has one. */
  webhooks?: WebhookOptions;
}

export async function indexArticles(
  db: Db,
  articles: Article[],
  options: IndexOptions = {},
): Promise<IndexResult> {
  const existing = await db
    .select({
      slug: articleIndex.slug,
      contentHash: articleIndex.contentHash,
      embedding: articleIndex.embedding,
      status: articleIndex.status,
    })
    .from(articleIndex);
  const previous = new Map(existing.map((row) => [row.slug, row]));

  const changed = articles.filter(
    (a) => options.force || previous.get(a.slug)?.contentHash !== a.contentHash,
  );
  const changedSlugs = new Set(changed.map((a) => a.slug));

  // Embed what changed, and anything still without a vector: indexed before
  // there was a key, or saved from the dashboard with no model. Only when a
  // model is available; with none, `embed` does nothing.
  const embeddings = await embed(
    db,
    articles.filter((a) => changedSlugs.has(a.slug) || !previous.get(a.slug)?.embedding),
    options,
  );

  let done = 0;
  for (const article of articles) {
    // A fresh vector when one was computed; the old one only when the text it
    // describes is unchanged; otherwise nothing, so the semantic pass skips
    // the article rather than matching what it used to say.
    const embedding =
      embeddings.get(article.slug) ??
      (changedSlugs.has(article.slug) ? null : (previous.get(article.slug)?.embedding ?? null));

    await upsert(db, article, embedding);

    done++;
    options.onProgress?.(done, articles.length);
  }

  // `force` re-embeds unchanged articles; it does not make them new versions.
  const versions = await recordVersions(
    db,
    articles.filter((a) => previous.get(a.slug)?.contentHash !== a.contentHash),
    options.origin ?? 'sync',
  );

  // Anything that vanished from the repo leaves the index too, so a deleted
  // article stops being an answer immediately. Its history stays.
  const slugs = articles.map((a) => a.slug);
  const removed = slugs.length
    ? await db
        .delete(articleIndex)
        .where(sql`slug NOT IN ${slugs}`)
        .returning({ slug: articleIndex.slug })
    : await db.delete(articleIndex).returning({ slug: articleIndex.slug });

  // The very first sync would announce the whole help centre at once, so
  // `article.published` starts from the second.
  if (existing.length > 0) await announcePublished(db, articles, previous, options.webhooks);

  return {
    indexed: changed.length,
    unchanged: articles.length - changed.length,
    removed: removed.length,
    embedded: embeddings.size,
    versions: versions.length,
  };
}

/**
 * Index one article and leave the rest alone: what a save from the dashboard
 * or the API does. `indexArticles` would treat every article not passed to it
 * as deleted, so it is the wrong tool for a single file.
 */
export async function indexArticle(
  db: Db,
  article: Article,
  options: Pick<IndexOptions, 'model' | 'embeddingModel' | 'origin' | 'webhooks'> = {},
): Promise<{ changed: boolean; embedded: boolean; versionId: number | null }> {
  const [previous] = await db
    .select({
      contentHash: articleIndex.contentHash,
      embedding: articleIndex.embedding,
      status: articleIndex.status,
    })
    .from(articleIndex)
    .where(sql`slug = ${article.slug}`)
    .limit(1);
  const changed = previous?.contentHash !== article.contentHash;

  // As in `indexArticles`: what changed, or has no vector yet.
  const embeddings =
    changed || !previous?.embedding
      ? await embed(db, [article], options)
      : new Map<string, number[]>();
  const embedding =
    embeddings.get(article.slug) ?? (changed ? null : (previous?.embedding ?? null));
  await upsert(db, article, embedding);
  await announcePublished(
    db,
    [article],
    new Map(previous ? [[article.slug, previous]] : []),
    options.webhooks,
  );

  const [version] = changed ? await recordVersions(db, [article], options.origin ?? 'sync') : [];
  // `embedded` is whether semantic search has the article as it now reads,
  // whether that vector was computed just now or kept from before.
  return { changed, embedded: embedding !== null, versionId: version?.id ?? null };
}

async function embed(
  db: Db,
  articles: Article[],
  options: Pick<IndexOptions, 'model' | 'embeddingModel'>,
): Promise<Map<string, number[]>> {
  const embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const out = new Map<string, number[]>();
  if (!options.model || !embeddingModel || articles.length === 0) return out;

  const input = articles.map((a) => embeddingText(a));
  const { vectors, usage } = await options.model.embed({ model: embeddingModel, input });
  // Embeddings are paid for on the same key as chat, so they count against
  // the same daily cap.
  await recordSpend(db, { kind: 'embedding', model: embeddingModel, usage });
  articles.forEach((article, i) => {
    const vector = vectors[i];
    if (vector) out.set(article.slug, vector);
  });
  return out;
}

async function upsert(db: Db, article: Article, embedding: number[] | null): Promise<void> {
  const values = {
    collection: article.collection,
    title: article.title,
    description: article.description,
    body: article.body,
    headings: article.headings,
    status: article.status,
    appliesTo: article.appliesTo,
    orderIndex: article.order,
    readingMinutes: article.readingMinutes,
    embedding,
    contentHash: article.contentHash,
    updatedAt: article.updatedAt,
    path: article.path,
    source: article.source ?? null,
  };
  await db
    .insert(articleIndex)
    .values({ slug: article.slug, ...values })
    .onConflictDoUpdate({ target: articleIndex.slug, set: values });
}

/** The hash a version is known by: of the file as written, when there is one. */
function writtenHash(article: Article): string {
  return article.source === undefined ? article.contentHash : hashContent(article.source);
}

/**
 * A version for each article whose words differ from its latest version.
 *
 * The index hash moving is not quite enough on its own: it also moves when
 * only the served image URLs changed (a new API path, or the first sync after
 * an upgrade), and a version with nothing in it but that would be noise. So
 * the latest version's hash of the file as written is the comparison.
 */
async function recordVersions(
  db: Db,
  articles: Article[],
  origin: VersionOrigin,
): Promise<{ id: number }[]> {
  if (articles.length === 0) return [];
  const slugs = articles.map((a) => a.slug);
  const latest = await db.execute(sql`
    SELECT DISTINCT ON (slug) slug, content_hash
    FROM helpwell.article_versions
    WHERE slug IN ${slugs}
    ORDER BY slug, id DESC
  `);
  const known = new Map(
    rowsOf<{ slug: string; content_hash: string }>(latest).map((row) => [
      row.slug,
      row.content_hash,
    ]),
  );
  const fresh = articles.filter((a) => known.get(a.slug) !== writtenHash(a));
  return insertVersions(db, fresh, origin);
}

async function insertVersions(
  db: Db,
  articles: Article[],
  origin: VersionOrigin,
): Promise<{ id: number }[]> {
  if (articles.length === 0) return [];
  return db
    .insert(articleVersions)
    .values(
      articles.map((article) => ({
        slug: article.slug,
        path: article.path,
        contentHash: writtenHash(article),
        title: article.title,
        description: article.description,
        status: article.status,
        // As written: the history is what the author wrote, not what the
        // index rewrote it to.
        body:
          article.source === undefined ? article.body : parseFrontmatter(article.source).content,
        source: article.source ?? null,
        origin,
        createdAt: new Date(),
      })),
    )
    .returning({ id: articleVersions.id });
}

/**
 * Write the folder metadata the help centre presents collections with.
 *
 * Separate from `indexArticles` because it costs nothing and never embeds:
 * a docs folder's title, icon and tint are three short strings, and they are
 * worth rewriting on every sync rather than hashing.
 */
export async function indexCollections(
  db: Db,
  collections: Collection[],
): Promise<{ written: number; removed: number }> {
  for (const collection of collections) {
    const values = {
      title: collection.title,
      description: collection.description,
      icon: collection.icon,
      tint: collection.tint,
      orderIndex: collection.order ?? UNORDERED,
      askAgent: collection.askAgent,
      visibility: collection.visibility,
      updatedAt: new Date(),
    };
    await db
      .insert(collectionIndex)
      .values({ id: collection.id, ...values })
      .onConflictDoUpdate({ target: collectionIndex.id, set: values });
  }

  // A folder that left the repo leaves the index with it.
  const ids = collections.map((c) => c.id);
  const removed = ids.length
    ? await db
        .delete(collectionIndex)
        .where(sql`id NOT IN ${ids}`)
        .returning({ id: collectionIndex.id })
    : await db.delete(collectionIndex).returning({ id: collectionIndex.id });

  return { written: collections.length, removed: removed.length };
}

/**
 * `article.published` for every article that is published now and was not
 * before: new in the repo, or moved from draft. An edit to an article that
 * was already live is not a publication.
 */
async function announcePublished(
  db: Db,
  articles: Article[],
  before: Map<string, { status: string | null }>,
  webhooks?: WebhookOptions,
): Promise<void> {
  for (const article of articles) {
    if (article.status !== 'published') continue;
    if (before.get(article.slug)?.status === 'published') continue;
    await emitStoredWebhooks(
      db,
      'article.published',
      {
        slug: article.slug,
        title: article.title,
        collection: article.collection,
        description: article.description,
      },
      webhooks,
    );
  }
}

/** Title and description carry the most signal; body is truncated to keep cost down. */
function embeddingText(article: Article): string {
  const body = article.body.replace(/\s+/g, ' ').slice(0, 4000);
  return [article.title, article.description ?? '', body].filter(Boolean).join('\n\n');
}
