/**
 * Import entry point: bringing a help centre over from somewhere else.
 *
 * The CLI's `helpwell import` and the dashboard's "Import from another help
 * center" both run this code: readers for folders and archives, for Zendesk
 * and the other help desks' APIs and for a crawl, all producing one
 * `ImportPlan`, and one writer that turns a plan into files through an
 * `ImportTarget` (the repo's docs folder, or an install's content source).
 */

export { type CrawlOptions, crawlSite } from './importers/crawl.js';
export {
  diskImportFiles,
  type ImportFiles,
  isZip,
  memoryImportFiles,
  type ZipLimits,
  zipImportFiles,
} from './importers/files.js';
export {
  detectFolderSource,
  FOLDER_SOURCES,
  type FolderSource,
  gitbookToMarkdown,
  readFolder,
  readGitbookFiles,
  readHtmlFiles,
  readMarkdownFiles,
  readNotionFiles,
  stripNotionId,
} from './importers/folders.js';
export {
  decodeEntities,
  htmlTitle,
  htmlToMarkdown,
  mainContent,
  parseHtml,
} from './importers/html-to-markdown.js';
export type { ImportedArticle, ImportedCollection, ImportPlan } from './importers/plan.js';
export {
  importFromPlatform,
  isPlatform,
  PLATFORM_KEYS,
  PLATFORMS,
  type Platform,
  type PlatformOptions,
} from './importers/platforms.js';
export { type PublicFetchOptions, publicFetch } from './importers/public-fetch.js';
export {
  IMPORT_UPLOAD_FORMATS,
  IMPORT_URL_SOURCES,
  importUrlSource,
  MAX_IMPORT_UPLOAD_BYTES,
  readImportUrl,
  readUploadedExport,
  uploadedFiles,
} from './importers/sources.js';
export {
  type ContentImportTargetOptions,
  contentImportTarget,
  type ImportImage,
  type ImportTarget,
  type ImportWriteResult,
  MAX_IMPORT_ARTICLE_BYTES,
  MAX_IMPORT_IMAGE_BYTES,
  type WriteImportOptions,
  writeImportPlan,
} from './importers/write.js';
