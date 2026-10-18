/**
 * `helpwell sync` as a function: read the knowledge base and index it.
 *
 * The CLI reads the repo off disk and calls `indexKnowledgeBase`; a host
 * whose content lives elsewhere calls `syncContent` with its own content
 * source, after an edit or on a schedule. Both do exactly the same indexing:
 * unchanged articles keep their embeddings, a provider that fails leaves a
 * text-only index rather than no index, and folders become collections.
 */

import { type KnowledgeBase, readKnowledgeBaseFrom } from '../content/articles.js';
import type { MediaPaths } from '../content/media.js';
import type { ContentSource } from '../content/source.js';
import type { Db } from '../db/client.js';
import { type IndexOptions, type IndexResult, indexArticles, indexCollections } from './indexer.js';

export interface SyncContentOptions extends IndexOptions {
  /**
   * How relative image paths become served URLs: `apiPath` is where the API
   * is mounted (`/api/helpwell` by default). `false` leaves bodies as written.
   */
  media?: MediaPaths | false;
  /**
   * Index an empty knowledge base, which removes every article from search.
   * Off by default, the same as `helpwell sync`: a source that answers with
   * nothing is far more often misconfigured or unreachable than emptied on
   * purpose, and the help centre going blank is the worse mistake.
   */
  allowEmpty?: boolean;
}

export interface SyncContentResult extends IndexResult {
  /** Articles found in the content. */
  articles: number;
  /** Collections found in the content. */
  collections: number;
  /** Collections that left the index because their folder is gone. */
  collectionsRemoved: number;
  /**
   * Why embeddings failed, when a model was passed and the provider refused:
   * the index was still written, as text only.
   */
  embeddingError: string | null;
  /** True when nothing was found and `allowEmpty` was not set, so nothing changed. */
  skipped: boolean;
}

/** Read a content source and index everything in it. */
export async function syncContent(
  db: Db,
  source: ContentSource,
  options: SyncContentOptions = {},
): Promise<SyncContentResult> {
  const knowledgeBase = await readKnowledgeBaseFrom(source, { media: options.media });
  return indexKnowledgeBase(db, knowledgeBase, options);
}

/** Index a knowledge base already read, from the repo or a source. */
export async function indexKnowledgeBase(
  db: Db,
  knowledgeBase: KnowledgeBase,
  options: Omit<SyncContentOptions, 'media'> = {},
): Promise<SyncContentResult> {
  const { allowEmpty, ...indexOptions } = options;
  if (knowledgeBase.articles.length === 0 && !allowEmpty) {
    return {
      articles: 0,
      collections: knowledgeBase.collections.length,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      embedded: 0,
      versions: 0,
      collectionsRemoved: 0,
      embeddingError: null,
      skipped: true,
    };
  }

  let result: IndexResult;
  let embeddingError: string | null = null;
  try {
    result = await indexArticles(db, knowledgeBase.articles, indexOptions);
  } catch (error) {
    // A bad key or a provider outage must not stop the docs being indexed.
    // Text search is the part people actually depend on.
    if (!indexOptions.model) throw error;
    embeddingError = error instanceof Error ? error.message : String(error);
    result = await indexArticles(db, knowledgeBase.articles, {
      ...indexOptions,
      model: undefined,
    });
  }

  // Folder metadata is three short strings per collection and never embeds,
  // so it is rewritten every time rather than hashed.
  const collections = await indexCollections(db, knowledgeBase.collections);

  return {
    ...result,
    articles: knowledgeBase.articles.length,
    collections: knowledgeBase.collections.length,
    collectionsRemoved: collections.removed,
    embeddingError,
    skipped: false,
  };
}
