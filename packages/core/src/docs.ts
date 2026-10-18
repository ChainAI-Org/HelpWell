/**
 * Docs entry point: `import { scoreArticles } from '@helpwell/core/docs'`.
 *
 * The pieces of `helpwell docs generate` and `helpwell docs update` that do
 * not need a checkout: what to read from a repository and in what order, the
 * prompts, which articles a diff touches, which part of the diff to show for
 * each, and reading the model's answers. The CLI reads files from disk and
 * git; a host can read the same things through an API and get the same
 * drafts.
 */

export {
  BLOCK_VOCABULARY,
  imagesIn,
  keepKnownImages,
  type ShotReference,
  screenshotGuidance,
} from './docs/blocks.js';
export {
  type AssembleOptions,
  assembleRepoContext,
  CODE,
  type ContextArticle,
  clip,
  contextCandidates,
  IGNORED_DIRS,
  isCopyFile,
  isListed,
  isNoise,
  isPlanFile,
  isRouteFile,
  isSensitive,
  MAX_FILE_BYTES,
  MAX_SCANNED,
  type ManifestSummary,
  type RepoContext,
  ROUTE_CALL,
  summariseManifest,
  TEXT,
  TOTAL_BUDGET,
} from './docs/context.js';
export {
  DIFF_BUDGET,
  type DiffChunk,
  diffFor,
  MIN_SHARED,
  relevantArticles,
  scoreArticles,
  splitDiff,
  tokens,
} from './docs/diff.js';
export {
  type Draft,
  parseDrafts,
  parseJsonBlock,
  parseVerdict,
  replaceBody,
} from './docs/parse.js';
export { globToRegExp, isLockfile, isUnwatched, isWatched } from './docs/paths.js';
export {
  articleCheckMessage,
  articleCheckPrompt,
  type GeneratePromptInput,
  generatePrompt,
} from './docs/prompts.js';
