/** Search entry point. */

export {
  type IndexOptions,
  type IndexResult,
  indexArticle,
  indexArticles,
  indexCollections,
  type VersionOrigin,
} from './search/indexer.js';
export {
  cosine,
  MIN_SIMILARITY,
  plainSnippet,
  type RetrievalSignals,
  recordSearch,
  type SearchHit,
  type SearchOptions,
  type SearchResult,
  searchArticles,
  searchWithSignals,
} from './search/search.js';
export {
  indexKnowledgeBase,
  type SyncContentOptions,
  type SyncContentResult,
  syncContent,
} from './search/sync.js';
