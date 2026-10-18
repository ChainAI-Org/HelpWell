/**
 * Reading releases from the GitHub Releases API, for drafting changelog
 * entries from them: `helpwell changelog` in the CLI, and any host that
 * calls `draftChangelogFromReleases` itself (a scheduled job, a webhook for a
 * published release).
 *
 * The notes a team already writes on a release are the best thing to draft
 * a customer-facing entry from, so this reads them rather than the commits.
 * How GitHub is reached is the caller's: a fetch and a token are passed in,
 * never read from the environment here, so a host with one token per
 * install, or tests with a fake GitHub, need nothing global. Without a token,
 * GitHub allows 60 requests an hour from an IP address and cannot see a
 * private repository, and the errors below say that in so many words rather
 * than passing on a bare 404.
 */

import { HelpWellError } from '../errors.js';

export const GITHUB_API = 'https://api.github.com';

/** `details.reason` on the error for a repository that has published no release yet. */
export const NO_RELEASE = 'no_release';

export interface GitHubRelease {
  tagName: string;
  /** The release's title; often the same as the tag. */
  name: string;
  /** The notes, as Markdown. Empty when nobody wrote any. */
  body: string;
  url: string;
  publishedAt: string | null;
}

/** How GitHub is reached. Every field is optional; nothing is read from the environment. */
export interface GitHubAccess {
  /** Sent as a bearer token when set. */
  token?: string;
  /** Defaults to the global fetch. Tests pass a fake. */
  fetch?: typeof globalThis.fetch;
  /** Defaults to https://api.github.com; GitHub Enterprise Server is `https://<host>/api/v3`. */
  apiBase?: string;
  /** Defaults to `helpwell`. */
  userAgent?: string;
  /**
   * What the token is called in error messages, where the person reading
   * them set it. Defaults to `GITHUB_TOKEN`, the environment variable the
   * CLI reads.
   */
  tokenName?: string;
  /** Told about each request before it is sent, for a verbose log. Never sees the token. */
  onRequest?: (url: string, info: { authenticated: boolean }) => void;
}

export interface ReleaseLookup extends GitHubAccess {
  /** `owner/name`, or anything `parseGitHubRepo` understands. */
  repo: string;
  /** A tag to read. Left out, the latest published release (no drafts, no pre-releases). */
  tag?: string;
}

export interface ReleaseListing extends GitHubAccess {
  repo: string;
  /** How many of the newest published releases to return. Defaults to 10, at most 100. */
  limit?: number;
}

/**
 * `owner/name` from what someone typed or what `git remote` says: the short
 * form, an https URL, or an ssh address, on github.com. Null for anything else.
 */
export function parseGitHubRepo(value: string): string | null {
  const text = value.trim();
  const match =
    /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      text,
    );
  if (!match) return null;
  const [, owner, name] = match;
  if (!owner || !name || name === '.' || name === '..') return null;
  return `${owner}/${name}`;
}

/**
 * What a changelog entry drafted from a release records as its source, so the
 * same release is never drafted twice. The CLI and hosts share the one form.
 */
export function releaseSourceRef(repo: string, tagName: string): string {
  return `github:${repo}@${tagName}`;
}

/** One release: the one tagged `lookup.tag`, or the latest published one. */
export async function fetchRelease(lookup: ReleaseLookup): Promise<GitHubRelease> {
  const repo = requireRepo(lookup.repo);
  const path = lookup.tag
    ? `/repos/${repo}/releases/tags/${encodeURIComponent(lookup.tag)}`
    : `/repos/${repo}/releases/latest`;
  const response = await get(path, lookup);

  if (response.ok) {
    return toRelease((await response.json()) as Record<string, unknown>, repo, lookup.tag);
  }

  if (response.status === 404) {
    // The same 404 means "no such release" and "no such repo, or one this
    // token cannot see". One more request tells them apart.
    const repoSeen = (await get(`/repos/${repo}`, lookup)).ok;
    if (!repoSeen) throw missingRepo(repo, lookup);
    throw new HelpWellError(
      'not_found',
      lookup.tag
        ? `${repo} has no release tagged ${lookup.tag}.`
        : `${repo} has no published release yet (drafts and pre-releases do not count).`,
      lookup.tag ? {} : { details: { reason: NO_RELEASE } },
    );
  }

  throw failure(response, lookup);
}

/**
 * The newest published releases, newest first: no drafts and no
 * pre-releases, as for "latest". An empty list for a repository that has
 * published none; an error for one that cannot be read.
 */
export async function listReleases(listing: ReleaseListing): Promise<GitHubRelease[]> {
  const repo = requireRepo(listing.repo);
  const limit = Math.min(Math.max(Math.trunc(listing.limit ?? 10), 1), 100);
  // Drafts (visible to a token with push access) and pre-releases come back
  // in the same list and are dropped below, so ask for a little more than
  // is wanted rather than paging.
  const perPage = Math.min(limit + 10, 100);
  const response = await get(`/repos/${repo}/releases?per_page=${perPage}`, listing);
  if (response.status === 404) throw missingRepo(repo, listing);
  if (!response.ok) throw failure(response, listing);
  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).draft !== true &&
        (item as Record<string, unknown>).prerelease !== true,
    )
    .map((item) => toRelease(item, repo))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, limit);
}

/** True for `fetchRelease`'s error when the repository has published no release at all. */
export function isNoRelease(error: unknown): boolean {
  return error instanceof HelpWellError && error.details?.reason === NO_RELEASE;
}

/**
 * Whether `repo` has a published release, for choosing where changelog
 * entries are drafted from. One request, given a few seconds. True or false
 * when GitHub answered (false also for a repository this caller cannot see);
 * null when it could not be asked: no network, a rate limit, a timeout.
 */
export async function hasPublishedRelease(
  lookup: GitHubAccess & { repo: string; timeoutMs?: number },
): Promise<boolean | null> {
  const repo = parseGitHubRepo(lookup.repo);
  if (!repo) return null;
  const url = `${apiBase(lookup)}/repos/${repo}/releases/latest`;
  lookup.onRequest?.(url, { authenticated: Boolean(lookup.token) });
  try {
    const response = await (lookup.fetch ?? globalThis.fetch)(url, {
      headers: headersFor(lookup),
      signal: AbortSignal.timeout(lookup.timeoutMs ?? 5_000),
    });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return true;
    return response.status === 404 ? false : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- helpers */

function requireRepo(value: string): string {
  const repo = parseGitHubRepo(value);
  if (!repo) {
    throw new HelpWellError(
      'bad_request',
      `"${value}" is not a GitHub repository. changelog.repo is owner/name, e.g. acme/app.`,
    );
  }
  return repo;
}

function toRelease(json: Record<string, unknown>, repo: string, tag?: string): GitHubRelease {
  return {
    tagName: String(json.tag_name ?? tag ?? ''),
    name: typeof json.name === 'string' ? json.name : '',
    body: typeof json.body === 'string' ? json.body : '',
    url: typeof json.html_url === 'string' ? json.html_url : `https://github.com/${repo}`,
    publishedAt: typeof json.published_at === 'string' ? json.published_at : null,
  };
}

function apiBase(access: GitHubAccess): string {
  return (access.apiBase ?? GITHUB_API).replace(/\/+$/, '');
}

function tokenName(access: GitHubAccess): string {
  return access.tokenName ?? 'GITHUB_TOKEN';
}

function headersFor(access: GitHubAccess): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': access.userAgent ?? 'helpwell',
  };
  if (access.token) headers.authorization = `Bearer ${access.token}`;
  return headers;
}

async function get(path: string, access: GitHubAccess): Promise<Response> {
  const url = `${apiBase(access)}${path}`;
  access.onRequest?.(url, { authenticated: Boolean(access.token) });
  try {
    return await (access.fetch ?? globalThis.fetch)(url, { headers: headersFor(access) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HelpWellError('upstream_failed', `Could not reach GitHub: ${reason}`);
  }
}

function missingRepo(repo: string, access: GitHubAccess): HelpWellError {
  return new HelpWellError(
    'not_found',
    access.token
      ? `GitHub has no repository ${repo} that this ${tokenName(access)} can read. Check changelog.repo, and that the token has access to it.`
      : `GitHub has no public repository ${repo}. Check changelog.repo; if the repository is private, set ${tokenName(access)}.`,
  );
}

function failure(response: Response, access: GitHubAccess): HelpWellError {
  const name = tokenName(access);
  const remaining = response.headers.get('x-ratelimit-remaining');
  if ((response.status === 403 || response.status === 429) && remaining === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const when = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null;
    const after = when ? ` It resets at ${when.toISOString().slice(11, 16)} UTC.` : '';
    return new HelpWellError(
      'rate_limited',
      access.token
        ? `GitHub's rate limit for this ${name} is used up.${after}`
        : `GitHub's rate limit for requests without a token (60 an hour from one IP address) is used up.${after} Set ${name} to raise it.`,
    );
  }
  if (response.status === 401) {
    return new HelpWellError(
      'unauthorized',
      `GitHub refused ${name} (401). It may have expired or been revoked; make a new one.`,
    );
  }
  if (response.status === 403) {
    return new HelpWellError(
      'forbidden',
      'GitHub refused the request (403). The token may not have read access to this repository’s contents.',
    );
  }
  return new HelpWellError('upstream_failed', `GitHub answered ${response.status}.`);
}
