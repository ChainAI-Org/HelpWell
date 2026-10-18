/**
 * The GitHub releases reader, as `helpwell changelog` and `helpwell init`
 * use it.
 *
 * The reader itself lives in core (`@helpwell/core/changelog`), so a host
 * that drafts entries on its own schedule reads releases exactly as the CLI
 * does. What is the CLI's is only this: each request is traced for
 * `--verbose`, GitHub sees a CLI user agent, and an error for a repository
 * with no release says what to do about it with this command's flags.
 */

import { HelpWellError } from '@helpwell/core';
import {
  fetchRelease as coreFetchRelease,
  hasPublishedRelease as coreHasPublishedRelease,
  type GitHubAccess,
  type GitHubRelease,
  isNoRelease,
  type ReleaseLookup,
} from '@helpwell/core/changelog';
import { trace } from './ui.js';

export {
  GITHUB_API,
  type GitHubRelease,
  isNoRelease,
  NO_RELEASE,
  parseGitHubRepo,
  type ReleaseLookup,
} from '@helpwell/core/changelog';

const cli: Pick<GitHubAccess, 'userAgent' | 'onRequest'> = {
  userAgent: 'helpwell-cli',
  onRequest: (url, { authenticated }) =>
    trace(`GET ${url}${authenticated ? ' (with GITHUB_TOKEN)' : ''}`),
};

export async function fetchRelease(lookup: ReleaseLookup): Promise<GitHubRelease> {
  try {
    return await coreFetchRelease({ ...cli, ...lookup });
  } catch (error) {
    if (!isNoRelease(error)) throw error;
    const reason = error as HelpWellError;
    throw new HelpWellError(
      reason.code,
      `${reason.message} Publish one, pass --release <tag>, or set changelog.source to tags or commits.`,
      { details: reason.details },
    );
  }
}

/**
 * Whether `repo` has a published release, for `helpwell init` choosing where
 * changelog entries are drafted from. `init` takes anything but true as
 * "draft from git tags".
 */
export function hasPublishedRelease(
  lookup: GitHubAccess & { repo: string; timeoutMs?: number },
): Promise<boolean | null> {
  return coreHasPublishedRelease({ ...cli, ...lookup });
}
