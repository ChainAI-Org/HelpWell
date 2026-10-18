/**
 * Changelog entry point: `import { draftChangelogFromReleases } from '@helpwell/core/changelog'`.
 *
 * Reading GitHub releases and drafting entries from them, for the CLI and for
 * any host that drafts on its own schedule. Storing entries is the changelog
 * repo's (`@helpwell/core/repos`); this writes through it.
 */

export {
  type ChangelogDraft,
  type DraftFromReleasesOptions,
  type DraftFromReleasesResult,
  draftChangelogFromReleases,
  type ReleaseDraftResult,
  type ReleaseDraftStatus,
  releaseNotesText,
  type ShippedKind,
  type WriteChangelogDraftInput,
  type WrittenChangelogDraft,
  writeChangelogDraft,
} from './changelog/draft.js';
export {
  fetchRelease,
  GITHUB_API,
  type GitHubAccess,
  type GitHubRelease,
  hasPublishedRelease,
  isNoRelease,
  listReleases,
  NO_RELEASE,
  parseGitHubRepo,
  type ReleaseListing,
  type ReleaseLookup,
  releaseSourceRef,
} from './changelog/github-releases.js';
export {
  GITHUB_TOKEN_ENV,
  type GitHubTokenPromptOptions,
  githubTokenPromptSpec,
} from './changelog-prompts.js';
