/** Content entry point: reading the knowledge base out of the repo. */

export {
  type Article,
  type Collection,
  extractHeadings,
  type Heading,
  hashContent,
  type KnowledgeBase,
  type ParseArticleOptions,
  parseArticle,
  type ReadKnowledgeBaseOptions,
  readingMinutes,
  readKnowledgeBase,
  readKnowledgeBaseFrom,
  slugify,
  TINTS,
  type Tint,
} from './content/articles.js';
// Images uploaded rather than captured, and where they are kept (the asset seam).
export {
  ASSET_FOLDER,
  ASSET_TYPES,
  type AssetContentType,
  type AssetRecord,
  type AssetRefusal,
  type AssetStore,
  type AssetUpload,
  assetMarkdown,
  assetPath,
  contentAssetStore,
  fileAssetStore,
  MAX_ASSET_BYTES,
  resolveAssetStore,
  type StoredAsset,
  sniffImage,
  storeAsset,
} from './content/assets.js';
export {
  collapseDiff,
  type DiffChunk,
  type DiffLine,
  type DiffOp,
  type DiffPart,
  diffLines,
  diffStats,
} from './content/diff.js';
export {
  ARTICLE_STATUSES,
  type ArticleFields,
  type ArticleStatus,
  collectionId,
  composeArticle,
  EMPTY_ARTICLE_MESSAGE,
  isArticlePath,
  isEmptyArticleBody,
  MAX_ARTICLE_BYTES,
  newArticlePath,
  type WriteArticle,
} from './content/editing.js';
export {
  type Frontmatter,
  type FrontmatterValue,
  type ParsedDocument,
  parseFrontmatter,
  stringifyFrontmatter,
} from './content/frontmatter.js';
export {
  DEFAULT_API_PATH,
  DEFAULT_SCREENSHOTS,
  type MediaDirs,
  type MediaPaths,
  mediaType,
  resolveMediaDirs,
  resolveMediaPath,
  rewriteMediaUrls,
  screenshotsRelativeToDocs,
  serveContentMedia,
  serveMedia,
} from './content/media.js';
export { titleCase } from './content/naming.js';
// Old URLs sent on to the articles they became: the map an import writes.
export {
  CONTENT_REDIRECTS_PATH,
  isRedirectTarget,
  MAX_REDIRECTS,
  mergeRedirects,
  parseRedirects,
  type RedirectRule,
  readContentRedirects,
  redirectSourcePath,
  stringifyRedirects,
  writeContentRedirects,
} from './content/redirects.js';
export {
  annotatedCopyTitle,
  refusedScreenshot,
  screenshotsInArticle,
} from './content/screenshots.js';
export {
  CAPTURE_ENV,
  type CapturePromptOptions,
  captureLoginSetupPrompt,
  captureSetupPrompt,
  type WriteArticlePromptOptions,
  writeArticleSetupPrompt,
} from './content/setup-prompts.js';
// Where content lives when it is not the repo on this server's disk.
export {
  articleWriter,
  type ContentEntry,
  type ContentSource,
  contentPath,
  createFileContentSource,
  createMemoryContentSource,
  type FileContentSourceOptions,
} from './content/source.js';
