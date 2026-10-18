/**
 * Drafting a changelog entry from what shipped, with the install's own model.
 *
 * Two callers share this so an entry reads the same wherever it was drafted:
 * `helpwell changelog` in the CLI, which reads commits or a release and
 * prints what it wrote, and `draftChangelogFromReleases`, which a host calls
 * on its own schedule or when GitHub says a release was published.
 *
 * Every entry is saved as a draft unless the caller says otherwise:
 * publishing stays a human decision. A release is only ever turned into an
 * entry once, however often this runs (CL-01, CL-02).
 */

import type { ModelPort, Usage } from '../agent/model.js';
import type { Db } from '../db/client.js';
import { HelpWellError } from '../errors.js';
import { changelogExistsForRef, createChangelogEntry } from '../repos/changelog.js';
import type { Settings } from '../settings/schema.js';
import { SettingsStore } from '../settings/store.js';
import type { WebhookOptions } from '../webhooks.js';
import {
  fetchRelease,
  type GitHubAccess,
  type GitHubRelease,
  listReleases,
  parseGitHubRepo,
  releaseSourceRef,
} from './github-releases.js';

export interface ChangelogDraft {
  version: string | null;
  title: string;
  summary: string;
  body: string;
  tags: string[];
}

/** What the model is told it is reading. */
export type ShippedKind = 'commits' | 'release notes';

export interface WriteChangelogDraftInput {
  kind: ShippedKind;
  /** What shipped, as text. Anything past 30,000 characters is not read. */
  text: string;
  /** Stamped on the draft as it is; the model never picks a version. */
  version: string | null;
  productName: string;
  /** The tags the model may choose from: Settings' `changelog.categories`. */
  categories: string[];
  /** The OpenRouter model id: Settings' `agent.models.docs`. */
  modelId: string;
  signal?: AbortSignal;
}

export type WrittenChangelogDraft =
  | { outcome: 'draft'; draft: ChangelogDraft; usage: Usage }
  /** Nothing in it was customer-visible, and the model said so rather than padding. */
  | { outcome: 'internal'; usage: Usage }
  /** The model's reply had no entry in it. */
  | { outcome: 'unusable'; usage: Usage };

/** Asks the model for one entry. Writes nothing. */
export async function writeChangelogDraft(
  model: ModelPort,
  input: WriteChangelogDraftInput,
): Promise<WrittenChangelogDraft> {
  const response = await model.chat({
    model: input.modelId,
    maxTokens: 4_000,
    signal: input.signal,
    messages: [
      {
        role: 'system',
        content: `You write the changelog for ${input.productName}.

Turn these ${input.kind} into an entry a customer would want to read. Group
by what changed for them, not by what changed in the code. Say only what the
${input.kind} say: do not describe screens, settings or behaviour they do not
mention, and do not guess at how a change is presented. Skip refactors, bumps,
CI and anything with no visible effect — if nothing is customer-visible, say
so rather than padding.

Return JSON only:
{"title":"...","summary":"one line","tags":["New"],"body":"Markdown, no H1","customerVisible":true}

Available tags: ${input.categories.join(', ')}.
The title is a benefit, not a version number. No marketing language.`,
      },
      { role: 'user', content: input.text.slice(0, 30_000) },
    ],
  });

  const usage = response.usage;
  const parsed = jsonObjectIn(response.text);
  if (!parsed || typeof parsed.title !== 'string') return { outcome: 'unusable', usage };
  if (parsed.customerVisible === false) return { outcome: 'internal', usage };
  return {
    outcome: 'draft',
    usage,
    draft: {
      version: input.version,
      title: parsed.title,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    },
  };
}

/** What the model reads for a release: its title as a heading, then its notes. */
export function releaseNotesText(release: GitHubRelease): string {
  return `# ${release.name || release.tagName}\n\n${release.body}`;
}

/* ---------------------------------------------------- from GitHub releases */

export interface DraftFromReleasesOptions extends GitHubAccess {
  /** The install's model. Entries are written with Settings' `agent.models.docs`. */
  model: ModelPort;
  /** `owner/name` on GitHub. Defaults to Settings' `changelog.repo`. */
  repo?: string;
  /** Draft this one release. Left out, the newest `limit` published releases. */
  tag?: string;
  /** How many of the newest published releases to consider. Defaults to 1, at most 100. */
  limit?: number;
  /** Publish straight away rather than saving drafts. Defaults to false. */
  publish?: boolean;
  /** Ask the model and return what it wrote, but save nothing. */
  dryRun?: boolean;
  /** Settings to draft with. Defaults to the install's saved settings. */
  settings?: Settings;
  /** How a published entry's `changelog.published` webhook is sent. */
  webhooks?: WebhookOptions;
  signal?: AbortSignal;
}

export type ReleaseDraftStatus =
  /** An entry was saved (or, on a dry run, would have been). */
  | 'created'
  /** An entry for this release already exists; nothing was asked or written. */
  | 'exists'
  /** The release has no notes on GitHub to draft from. */
  | 'no_notes'
  /** Everything in it was internal: nothing to announce. */
  | 'internal'
  /** The model did not return a usable entry. */
  | 'unusable';

export interface ReleaseDraftResult {
  release: GitHubRelease;
  /** What the entry records as its source, e.g. `github:acme/app@v1.5.0`. */
  sourceRef: string;
  status: ReleaseDraftStatus;
  /** The saved entry; null when nothing was saved. */
  entryId: string | null;
  draft: ChangelogDraft | null;
}

export interface DraftFromReleasesResult {
  /** `owner/name`, as read. */
  repo: string;
  /** One per release considered, oldest first: the order the entries were written in. */
  results: ReleaseDraftResult[];
  /** How many entries were saved. */
  created: number;
  /** What the model calls cost, summed. */
  usage: Usage;
}

/**
 * Drafts changelog entries from a repository's GitHub releases, through the
 * normal changelog repo: one entry per release, recorded against it so a
 * second run skips it. Releases with no notes, or nothing customer-visible,
 * are reported and skipped.
 *
 * It reads releases because it was asked to: `changelog.source` is the CLI's
 * setting and is not consulted here. It throws for a repository GitHub will
 * not show (`not_found`), a spent rate limit (`rate_limited`), a refused
 * token, no repository to read (`not_configured`), and a model that fails;
 * entries saved before a failure stay saved, and the next run carries on
 * from them. With `tag`, a release with that tag must exist; without one, a
 * repository with no published release gives an empty `results`.
 */
export async function draftChangelogFromReleases(
  db: Db,
  options: DraftFromReleasesOptions,
): Promise<DraftFromReleasesResult> {
  const settings = options.settings ?? (await new SettingsStore(db).get());
  const given = options.repo?.trim() || settings.changelog.repo.trim();
  if (!given) {
    throw new HelpWellError(
      'not_configured',
      'There is no GitHub repository to read releases from. Set changelog.repo to owner/name, e.g. acme/app.',
    );
  }
  const repo = parseGitHubRepo(given);
  if (!repo) {
    throw new HelpWellError(
      'bad_request',
      `"${given}" is not a GitHub repository. changelog.repo is owner/name, e.g. acme/app.`,
    );
  }
  const access: GitHubAccess = {
    token: options.token,
    fetch: options.fetch,
    apiBase: options.apiBase,
    userAgent: options.userAgent,
    tokenName: options.tokenName,
    onRequest: options.onRequest,
  };

  const releases = options.tag
    ? [await fetchRelease({ ...access, repo, tag: options.tag })]
    : // Newest first from GitHub; written oldest first, so the newest
      // release's entry is the newest entry too.
      (await listReleases({ ...access, repo, limit: options.limit ?? 1 })).reverse();

  const usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const results: ReleaseDraftResult[] = [];
  let created = 0;

  for (const release of releases) {
    const sourceRef = releaseSourceRef(repo, release.tagName);
    const result = { release, sourceRef, entryId: null, draft: null };
    if (await changelogExistsForRef(db, sourceRef)) {
      results.push({ ...result, status: 'exists' });
      continue;
    }
    if (!release.body.trim()) {
      results.push({ ...result, status: 'no_notes' });
      continue;
    }

    const written = await writeChangelogDraft(options.model, {
      kind: 'release notes',
      text: releaseNotesText(release),
      version: release.tagName || null,
      productName: settings.product.name,
      categories: settings.changelog.categories,
      modelId: settings.agent.models.docs,
      signal: options.signal,
    });
    usage.tokensIn += written.usage.tokensIn;
    usage.tokensOut += written.usage.tokensOut;
    usage.costUsd += written.usage.costUsd;
    if (written.outcome !== 'draft') {
      results.push({ ...result, status: written.outcome });
      continue;
    }

    const entryId = options.dryRun
      ? null
      : await createChangelogEntry(
          db,
          {
            ...written.draft,
            sourceRef,
            status: options.publish ? 'published' : 'draft',
          },
          { webhooks: options.webhooks },
        );
    if (entryId) created += 1;
    results.push({ ...result, status: 'created', entryId, draft: written.draft });
  }

  return { repo, results, created, usage };
}

/**
 * Models wrap JSON in prose and fences however they feel that day, so take
 * the outermost braces rather than trusting the whole reply to parse.
 */
function jsonObjectIn(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
