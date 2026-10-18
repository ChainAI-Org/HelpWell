/**
 * `helpwell changelog` — draft an entry from what you actually shipped.
 *
 * Where it reads what shipped is Settings' `changelog.source`:
 *   - `github_releases`: the notes on a GitHub release of `changelog.repo`
 *     (read by @helpwell/core/changelog), with GITHUB_TOKEN when it is set;
 *   - `tags`: the commits since the previous tag, to HEAD;
 *   - `commits`: the commits since the last published entry, to HEAD. The
 *     entry's own range end when it recorded one (every entry this command
 *     drafts from git records the commit it ran to), otherwise its publish
 *     date, as `git log --since`. With no published entry yet, the previous
 *     tag, as for `tags`;
 *   - `manual`: nothing. The team writes entries by hand, and the command
 *     says so rather than drafting one anyway.
 *
 * Unset, the source is worked out on each run: `github_releases` when
 * `changelog.repo` is set or the `origin` remote is on github.com, otherwise
 * `tags`; and `tags` after all, with a one-line note, while that repository
 * has published no release. `helpwell init` writes `github_releases` only
 * when GitHub says there is a release to read, and `tags` otherwise, so the
 * choice is visible. A source someone set is never second-guessed.
 *
 * It asks the model to write what it read the way a customer would want to
 * read it, and saves a draft. Publishing stays a human decision, and a range
 * or a release is only ever turned into an entry once, so running this from
 * a release workflow is safe (CL-01, CL-02).
 */

import { execFileSync } from 'node:child_process';
import { formatSetupPrompt, githubTokenPromptSpec, HelpWellError } from '@helpwell/core';
import type { ModelPort } from '@helpwell/core/agent';
import {
  type ChangelogDraft,
  releaseNotesText,
  releaseSourceRef,
  type ShippedKind,
  writeChangelogDraft,
} from '@helpwell/core/changelog';
import type { Db } from '@helpwell/core/db';
import {
  changelogExistsForRef,
  createChangelogEntry,
  getChangelogEntry,
  listChangelog,
} from '@helpwell/core/repos';
import { type ChangelogSettings, SettingsStore } from '@helpwell/core/settings';
import {
  fetchRelease,
  type GitHubRelease,
  hasPublishedRelease,
  isNoRelease,
  parseGitHubRepo,
} from '../github-releases.js';
import { loadProject, openDb } from '../project.js';
import { detail, heading, ok, progress, say, style, table, trace, warn } from '../ui.js';
import { requireModel } from './docs.js';

export type ChangelogSource = NonNullable<ChangelogSettings['source']>;

export interface ChangelogOptions {
  cwd: string;
  url?: string;
  /** Where to draft from. Defaults to Settings' `changelog.source`, then detection. */
  source?: ChangelogSource;
  /** `owner/name` on GitHub. Defaults to `changelog.repo`, then this repo's GitHub remote. */
  repo?: string;
  /**
   * Start of the range. Defaults to the last published entry (`commits`) or
   * the previous tag (`tags`), then the first commit.
   */
  since?: string;
  /** End of the range. Defaults to HEAD. */
  to?: string;
  /**
   * Version to stamp on the entry. From git, defaults to the tag at `to`.
   * From GitHub, the release to read: defaults to the latest one.
   */
  version?: string;
  /** Publish straight away rather than saving a draft. */
  publish?: boolean;
  /** Write nothing; print the draft. */
  dryRun?: boolean;
  /** Print the AI-assistant prompt for a GitHub token, and draft nothing. */
  prompt?: boolean;
  /** The model to use. Defaults to OpenRouter with OPENROUTER_API_KEY. */
  model?: ModelPort;
  /** How GitHub is reached. Defaults to the global fetch; tests pass a fake. */
  fetch?: typeof globalThis.fetch;
  /** Where GITHUB_TOKEN is read from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export type { ChangelogDraft };

const SOURCES: readonly ChangelogSource[] = ['github_releases', 'tags', 'commits', 'manual'];

/** What was shipped, read from wherever the source says, ready to hand the model. */
interface Shipped {
  /** Recorded on the entry, so the same range or release is never drafted twice. */
  ref: string;
  /** The same, as a person reads it: `v1.4.0 (a1b2c3d) to HEAD (d4e5f6a)`. */
  shown: string;
  /** What the model is told it is reading. */
  kind: ShippedKind;
  text: string;
  version: string | null;
}

export async function changelog(options: ChangelogOptions): Promise<ChangelogDraft | null> {
  const project = loadProject(options.cwd);
  const root = project.paths.root;

  if (options.source !== undefined && !SOURCES.includes(options.source)) {
    throw new HelpWellError(
      'bad_request',
      `--source is one of ${SOURCES.join(', ')}; "${options.source}" is not.`,
    );
  }

  if (options.prompt) {
    const repo =
      options.repo ?? (project.config.settings.changelog.repo || githubRemote(root) || undefined);
    heading('Set this up with an AI assistant');
    detail('Paste this into ChatGPT, Claude or your coding agent. It holds no token.');
    say();
    say(
      formatSetupPrompt(
        githubTokenPromptSpec({ productName: project.config.settings.product.name, repo }),
      ),
    );
    return null;
  }

  // A team that writes entries by hand has nothing to draft, and needs no
  // key to be told so. The config file says before anything is opened; the
  // database's copy, which the dashboard edits, has the last word below.
  if ((options.source ?? project.config.settings.changelog.source) === 'manual') {
    return manual();
  }

  // The key is checked before git, GitHub or the database is touched, so a
  // missing one fails in a millisecond rather than after a migration. Dry
  // runs too.
  const model = options.model ?? requireModel(project.config.settings.product.name);

  const handle = await openDb(project.paths, { url: options.url });

  try {
    const settings = await new SettingsStore(handle.db).get();
    const chosen = options.source ?? settings.changelog.source;
    if (chosen === 'manual') return manual();
    // Unset: worked out from the repo, quietly. Tags always work.
    const source = chosen ?? detectChangelogSource(root, options.repo ?? settings.changelog.repo);
    if (!chosen) trace(`changelog.source is not set; drafting from ${source}`);

    let shipped =
      source === 'github_releases'
        ? await fromGitHub(options, root, settings.changelog.repo, !chosen)
        : await fromGit(options, root, source, handle.db);
    if (shipped === NO_RELEASES) {
      detail('No GitHub releases yet, drafting from git tags.');
      shipped = await fromGit(options, root, 'tags', handle.db);
    }
    if (!shipped) return null;

    // Running this twice for the same release should not produce two entries.
    if (await changelogExistsForRef(handle.db, shipped.ref)) {
      warn(`There is already an entry for ${shipped.shown}.`);
      detail(
        source === 'github_releases'
          ? 'Delete it first, or pass --release for another release.'
          : 'Delete it first, or pass a different --since.',
      );
      return null;
    }

    const bar = progress('writing');
    bar.update(`reading the ${shipped.kind}`);

    // The prompt and the parsing are core's, shared with hosts that draft
    // from releases themselves, so an entry reads the same either way.
    const written = await writeChangelogDraft(model, {
      kind: shipped.kind,
      text: shipped.text,
      version: shipped.version,
      productName: settings.product.name,
      categories: settings.changelog.categories,
      modelId: settings.agent.models.docs,
    });

    if (written.outcome === 'unusable') {
      bar.done('Nothing written');
      warn('The model did not return a usable entry.');
      return null;
    }

    if (written.outcome === 'internal') {
      bar.done('Nothing to announce');
      detail(
        shipped.kind === 'commits'
          ? 'Everything in this range was internal.'
          : 'Everything in this release was internal.',
      );
      return null;
    }

    const draft: ChangelogDraft = written.draft;

    bar.done(options.dryRun ? 'Drafted' : options.publish ? 'Published' : 'Saved as a draft');

    say();
    table([
      ['Version', draft.version ?? '—'],
      ['Title', draft.title],
      ['Tags', draft.tags.join(', ') || '—'],
    ]);
    say();
    say(
      draft.body
        .split('\n')
        .map((line) => `  ${style.dim(line)}`)
        .join('\n'),
    );
    say();

    if (options.dryRun) return draft;

    await createChangelogEntry(handle.db, {
      version: draft.version,
      title: draft.title,
      summary: draft.summary,
      body: draft.body,
      tags: draft.tags,
      sourceRef: shipped.ref,
      status: options.publish ? 'published' : 'draft',
    });

    if (options.publish) {
      ok('Published. It is on your changelog page and in the widget now.');
    } else {
      ok('Saved as a draft. Publish it from the dashboard when you are happy.');
    }
    say();

    return draft;
  } finally {
    await handle.close();
  }
}

function manual(): null {
  heading('Nothing to draft');
  detail('changelog.source is manual: entries are written by hand in the dashboard.');
  detail(
    'To draft them from what shipped, set it to github_releases, tags or commits, or pass --source.',
  );
  return null;
}

/* ---------------------------------------------------------------- GitHub */

/** What `fromGitHub` answers when a detected source finds no release to read yet. */
const NO_RELEASES = 'no_releases';

async function fromGitHub(
  options: ChangelogOptions,
  root: string,
  configured: string,
  /** The source was worked out, not chosen: no release yet means git tags instead. */
  detected = false,
): Promise<Shipped | null | typeof NO_RELEASES> {
  const given = options.repo?.trim() || configured.trim();
  const repo = given ? parseGitHubRepo(given) : githubRemote(root);
  if (!repo) {
    throw new HelpWellError(
      'not_configured',
      given
        ? `changelog.repo is "${given}", which is not a GitHub repository. It is owner/name, e.g. acme/app.`
        : 'changelog.source is github_releases, but changelog.repo is empty and this repo has no GitHub remote to take it from. Set changelog.repo to owner/name, pass --repo, or set changelog.source to tags or commits to draft from git.',
    );
  }
  const token = (options.env ?? process.env).GITHUB_TOKEN?.trim() || undefined;
  const lookup = { repo, tag: options.version, token, fetch: options.fetch };

  // A detected source asks first, and quietly: with no release to read yet,
  // the caller drafts from git tags, and nothing about GitHub needs saying.
  let release: GitHubRelease | null = null;
  if (detected) {
    try {
      release = await fetchRelease(lookup);
    } catch (error) {
      if (isNoRelease(error)) return NO_RELEASES;
      throw error;
    }
  }

  if (options.since || options.to) {
    warn('--since and --to read git history, so they do nothing with GitHub releases.');
    detail('Pass --source tags to draft from a range of commits instead.');
  }
  if (!token) {
    warn(
      'No GITHUB_TOKEN, so GitHub allows 60 requests an hour from this IP address and cannot see a private repository.',
    );
    detail('`helpwell changelog --prompt` prints the setup for one, for an AI assistant.');
  }

  heading('Drafting a changelog entry');
  detail(
    `from ${options.version ? `the ${options.version} release` : 'the latest release'} of ${repo} on GitHub`,
  );

  release ??= await fetchRelease(lookup);
  const shown = `${repo} ${release.tagName}`;
  detail(
    `${release.name || release.tagName}${release.publishedAt ? `, ${release.publishedAt.slice(0, 10)}` : ''}`,
  );

  if (!release.body.trim()) {
    warn(`The ${release.tagName} release has no notes on GitHub to draft from.`);
    detail('Write notes on the release, or pass --source tags to draft from its commits.');
    return null;
  }
  trace(release.body.split('\n')[0] ?? '');

  return {
    ref: releaseSourceRef(repo, release.tagName),
    shown,
    kind: 'release notes',
    text: releaseNotesText(release),
    version: options.version ?? (release.tagName || null),
  };
}

/** `owner/name` from the `origin` remote, when it is on GitHub. */
function githubRemote(root: string): string | null {
  const url = tryGit(root, ['remote', 'get-url', 'origin']);
  return url ? parseGitHubRepo(url) : null;
}

/**
 * The source for an install that has not chosen one: GitHub releases when
 * there is a repository to read them from (`changelog.repo`, or an `origin`
 * remote on github.com), and git tags otherwise. Never an error: a folder
 * with no git at all still gets `tags`, and says what is wrong when run.
 * Whether that repository has a release yet is checked when it is read.
 */
export function detectChangelogSource(root: string, repo = ''): 'github_releases' | 'tags' {
  return repo.trim() || githubRemote(root) ? 'github_releases' : 'tags';
}

/**
 * What `helpwell init` writes down: `github_releases` only when the `origin`
 * remote is on GitHub and GitHub says it has a published release; `tags`
 * otherwise, including when GitHub cannot be asked (no network, a rate
 * limit, a private repository without a token).
 */
export async function initialChangelogSource(
  root: string,
  options: { fetch?: typeof globalThis.fetch; env?: Record<string, string | undefined> } = {},
): Promise<'github_releases' | 'tags'> {
  const repo = githubRemote(root);
  if (!repo) return 'tags';
  const token = (options.env ?? process.env).GITHUB_TOKEN?.trim() || undefined;
  const released = await hasPublishedRelease({ repo, token, fetch: options.fetch });
  return released === true ? 'github_releases' : 'tags';
}

/* -------------------------------------------------------------- git bits */

/**
 * Where a range of history starts: a commit, or, for an entry that recorded
 * none, the moment it was published.
 */
type RangeStart =
  | { kind: 'commit'; sha: string; shown: string }
  | { kind: 'date'; after: Date; shown: string };

async function fromGit(
  options: ChangelogOptions,
  root: string,
  source: 'tags' | 'commits',
  db: Db,
): Promise<Shipped | null> {
  const to = options.to ?? 'HEAD';
  // The range is stored as resolved commits, not as the names given for it.
  // "HEAD" moves, so a name-based key made every later run say "already an
  // entry" after the first; two SHAs describe exactly one set of commits.
  const toSha = resolveCommit(root, to);
  const start =
    (options.since ? fromRef(root, options.since) : null) ??
    (source === 'commits' ? await sinceLastEntry(db, root) : null) ??
    fromRef(root, previousTag(root, to));
  const end = describe(to, toSha);
  const shown = `${start.shown} to ${end}`;

  heading('Drafting a changelog entry');
  detail(`from ${shown}`);

  const commits = commitsBetween(root, start, toSha);
  if (commits.length === 0) {
    warn(`Nothing landed between ${start.shown} and ${end}.`);
    return null;
  }
  detail(`${commits.length} commits`);
  // What the model is about to read, one subject per line.
  for (const commit of commits) trace(commit.split('\n')[0] ?? '');

  return {
    // Either way the ref ends with the commit this entry runs to, which is
    // where the next `commits` run starts once it is published.
    ref: `${start.kind === 'commit' ? start.sha : `since:${start.after.toISOString()}`}...${toSha}`,
    shown,
    kind: 'commits',
    text: commits.join('\n'),
    version: options.version ?? tagAt(root, to),
  };
}

function fromRef(root: string, ref: string): RangeStart {
  const sha = resolveCommit(root, ref);
  return { kind: 'commit', sha, shown: describe(ref, sha) };
}

/**
 * The newest published entry, as the start of a `commits` range: the commit
 * its own range ran to, when it recorded one this repo still has, otherwise
 * its publish date. Null when nothing is published yet.
 */
async function sinceLastEntry(db: Db, root: string): Promise<RangeStart | null> {
  const [latest] = (await listChangelog(db, { limit: 1 })).items;
  if (!latest) {
    detail('No changelog entry is published yet, so this starts from the previous tag, if any.');
    return null;
  }
  const entry = await getChangelogEntry(db, latest.id);
  const name = `the last entry, "${latest.title}"`;
  const recorded = /\.\.\.([0-9a-f]{40,64})$/.exec(entry?.sourceRef ?? '')?.[1];
  const sha = recorded
    ? tryGit(root, ['rev-parse', '--verify', '--quiet', `${recorded}^{commit}`])
    : null;
  if (sha) return { kind: 'commit', sha, shown: `${name} (${sha.slice(0, 7)})` };
  const at = latest.publishedAt ? new Date(latest.publishedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return { kind: 'date', after: at, shown: `${name} (${at.toISOString().slice(0, 10)})` };
}

function git(root: string, args: string[]): string {
  trace(`git ${args.join(' ')}`);
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new HelpWellError('bad_request', `git ${args[0]} failed: ${stderr || message}`);
  }
}

function tryGit(root: string, args: string[]): string | null {
  try {
    return git(root, args).trim() || null;
  } catch {
    return null;
  }
}

/** The tag before `to`, or the first commit when there are no tags. */
function previousTag(root: string, to: string): string {
  const tag = tryGit(root, ['describe', '--tags', '--abbrev=0', `${to}^`]);
  if (tag) return tag;
  const roots = git(root, ['rev-list', '--max-parents=0', to]).trim().split('\n').filter(Boolean);
  const first = roots[roots.length - 1];
  if (!first) throw new HelpWellError('bad_request', `git rev-list found no commits before ${to}.`);
  return first;
}

function resolveCommit(root: string, ref: string): string {
  const sha = tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!sha) {
    throw new HelpWellError('bad_request', `"${ref}" is not a commit, tag or branch in this repo.`);
  }
  return sha;
}

function describe(name: string, sha: string): string {
  const short = sha.slice(0, 7);
  return name === sha ? short : `${name} (${short})`;
}

function tagAt(root: string, ref: string): string | null {
  return tryGit(root, ['describe', '--tags', '--exact-match', ref]);
}

function commitsBetween(root: string, start: RangeStart, to: string): string[] {
  const range =
    start.kind === 'commit'
      ? [`${start.sha}..${to}`]
      : [`--since=${start.after.toISOString()}`, to];
  return git(root, ['log', '--no-merges', '--pretty=format:%s%n%b%n---', ...range])
    .split('\n---\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
