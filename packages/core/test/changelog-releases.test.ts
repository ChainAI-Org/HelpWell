/**
 * The GitHub releases reader and drafting entries from releases, as a host
 * calls them from `@helpwell/core/changelog`. GitHub is a fake: nothing
 * leaves the process.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent.js';
import {
  draftChangelogFromReleases,
  fetchRelease,
  hasPublishedRelease,
  isNoRelease,
  listReleases,
  parseGitHubRepo,
  releaseSourceRef,
  writeChangelogDraft,
} from '../src/changelog.js';
import { schema } from '../src/db.js';
import { getChangelogEntry, listChangelog } from '../src/repos.js';
import { SettingsStore } from '../src/settings.js';
import { freshDb, type TestDb } from './helpers/db.js';

const RELEASE = {
  tag_name: 'v1.5.0',
  name: 'PDF export',
  body: '## What changed\n\n- Invoices can be exported as PDF (#412)\n- Bump eslint (#415)',
  html_url: 'https://github.com/acme/app/releases/tag/v1.5.0',
  published_at: '2026-09-20T10:00:00Z',
  draft: false,
  prerelease: false,
};

const release = (tag: string, at: string, extra: Record<string, unknown> = {}) => ({
  ...RELEASE,
  tag_name: tag,
  name: tag,
  body: `- Something customers see in ${tag}`,
  html_url: `https://github.com/acme/app/releases/tag/${tag}`,
  published_at: at,
  ...extra,
});

/** A stand-in for api.github.com. Unknown paths are 404s, as GitHub's are. */
function github(answers: Record<string, () => Response> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    const path = String(url).replace(/^https:\/\/[^/]+(\/api\/v3)?/, '');
    const answer = answers[path];
    if (answer) return answer();
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** A model that writes the same entry every time, unless told otherwise. */
const entryModel = (
  reply = '{"title":"Export invoices as PDF","summary":"s","tags":["New"],"body":"Invoices export as PDF.","customerVisible":true}',
) => new FakeModel(() => ({ text: reply }));

describe('the GitHub releases reader', () => {
  it('reads the latest release, with the token and the headers GitHub asks for', async () => {
    const { fetch, calls } = github({
      '/repos/acme/app/releases/latest': () => Response.json(RELEASE),
    });
    const seen: string[] = [];
    const found = await fetchRelease({
      repo: 'https://github.com/acme/app.git',
      token: 'ghp_test_not_real',
      fetch,
      onRequest: (url, info) => seen.push(`${url} ${info.authenticated}`),
    });
    expect(found).toEqual({
      tagName: 'v1.5.0',
      name: 'PDF export',
      body: RELEASE.body,
      url: RELEASE.html_url,
      publishedAt: '2026-09-20T10:00:00Z',
    });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/app/releases/latest');
    expect(calls[0]?.headers.authorization).toBe('Bearer ghp_test_not_real');
    expect(calls[0]?.headers.accept).toBe('application/vnd.github+json');
    expect(calls[0]?.headers['user-agent']).toBe('helpwell');
    // The log line says a token was sent, never what it was.
    expect(seen).toEqual(['https://api.github.com/repos/acme/app/releases/latest true']);
  });

  it('reads a named release from GitHub Enterprise, with no token', async () => {
    const { fetch, calls } = github({
      '/repos/acme/app/releases/tags/v1.4.0': () =>
        Response.json({ ...RELEASE, tag_name: 'v1.4.0' }),
    });
    const found = await fetchRelease({
      repo: 'acme/app',
      tag: 'v1.4.0',
      fetch,
      apiBase: 'https://git.acme.test/api/v3/',
      userAgent: 'acme-host',
    });
    expect(found.tagName).toBe('v1.4.0');
    expect(calls[0]?.url).toBe('https://git.acme.test/api/v3/repos/acme/app/releases/tags/v1.4.0');
    expect(calls[0]?.headers).not.toHaveProperty('authorization');
    expect(calls[0]?.headers['user-agent']).toBe('acme-host');
  });

  it('tells a missing repository from one with no release, and names the token the host uses', async () => {
    const missing = github();
    await expect(fetchRelease({ repo: 'acme/secret', fetch: missing.fetch })).rejects.toThrow(
      /no public repository acme\/secret.*set GITHUB_TOKEN/,
    );
    await expect(
      fetchRelease({
        repo: 'acme/secret',
        fetch: missing.fetch,
        token: 't',
        tokenName: 'the GitHub connection',
      }),
    ).rejects.toThrow(/that this the GitHub connection can read/);

    const empty = github({ '/repos/acme/app': () => Response.json({ full_name: 'acme/app' }) });
    const error = await fetchRelease({ repo: 'acme/app', fetch: empty.fetch }).catch((e) => e);
    expect(String(error.message)).toMatch(/has no published release yet/);
    expect(isNoRelease(error)).toBe(true);
    const tagged = await fetchRelease({ repo: 'acme/app', tag: 'v9', fetch: empty.fetch }).catch(
      (e) => e,
    );
    expect(tagged.message).toBe('acme/app has no release tagged v9.');
    expect(isNoRelease(tagged)).toBe(false);
  });

  it('explains a spent rate limit, a refused token, a network failure and a bad repo', async () => {
    const limited = github({
      '/repos/acme/app/releases/latest': () =>
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
        }),
    });
    await expect(fetchRelease({ repo: 'acme/app', fetch: limited.fetch })).rejects.toMatchObject({
      code: 'rate_limited',
      message: expect.stringMatching(/60 an hour.*resets at \d\d:\d\d UTC.*Set GITHUB_TOKEN/),
    });

    const refused = github({
      '/repos/acme/app/releases/latest': () => new Response('{}', { status: 401 }),
    });
    await expect(
      fetchRelease({ repo: 'acme/app', token: 'old', fetch: refused.fetch }),
    ).rejects.toMatchObject({ code: 'unauthorized' });

    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchRelease({ repo: 'acme/app', fetch: offline })).rejects.toMatchObject({
      code: 'upstream_failed',
      message: 'Could not reach GitHub: fetch failed',
    });

    await expect(fetchRelease({ repo: 'gitlab.com/acme', fetch: offline })).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('lists the newest published releases, leaving out drafts and pre-releases', async () => {
    const { fetch, calls } = github({
      '/repos/acme/app/releases?per_page=12': () =>
        Response.json([
          release('v3.0.0-rc.1', '2026-09-24T00:00:00Z', { prerelease: true }),
          release('v3.0.0', '2026-09-25T00:00:00Z', { draft: true, published_at: null }),
          release('v2.1.0', '2026-09-22T00:00:00Z'),
          release('v2.0.0', '2026-09-10T00:00:00Z'),
          release('v1.9.0', '2026-08-01T00:00:00Z'),
        ]),
    });
    const found = await listReleases({ repo: 'acme/app', limit: 2, fetch });
    expect(found.map((r) => r.tagName)).toEqual(['v2.1.0', 'v2.0.0']);
    expect(calls).toHaveLength(1);

    const none = github({ '/repos/acme/app/releases?per_page=20': () => Response.json([]) });
    expect(await listReleases({ repo: 'acme/app', fetch: none.fetch })).toEqual([]);
    await expect(listReleases({ repo: 'acme/gone', fetch: none.fetch })).rejects.toThrow(
      /no public repository acme\/gone/,
    );
  });

  it('says whether a repository has a release, and null when GitHub cannot be asked', async () => {
    const yes = github({ '/repos/acme/app/releases/latest': () => Response.json(RELEASE) });
    expect(await hasPublishedRelease({ repo: 'acme/app', fetch: yes.fetch })).toBe(true);
    expect(await hasPublishedRelease({ repo: 'acme/none', fetch: yes.fetch })).toBe(false);
    const limited = github({
      '/repos/acme/app/releases/latest': () => new Response('{}', { status: 429 }),
    });
    expect(await hasPublishedRelease({ repo: 'acme/app', fetch: limited.fetch })).toBeNull();
    expect(await hasPublishedRelease({ repo: 'not a repo', fetch: yes.fetch })).toBeNull();
  });

  it('parses the forms a repository is written in', () => {
    expect(parseGitHubRepo('acme/app')).toBe('acme/app');
    expect(parseGitHubRepo('git@github.com:acme/my.app.git')).toBe('acme/my.app');
    expect(parseGitHubRepo('https://gitlab.com/acme/app')).toBeNull();
    expect(releaseSourceRef('acme/app', 'v1.5.0')).toBe('github:acme/app@v1.5.0');
  });
});

describe('writing an entry with the model', () => {
  it('asks with the categories and the docs model, and reports internal-only and unusable replies', async () => {
    const model = entryModel();
    const input = {
      kind: 'release notes' as const,
      text: '# v1\n\n- PDF export',
      version: 'v1',
      productName: 'Acme',
      categories: ['New', 'Fixed'],
      modelId: 'test/docs',
    };
    const written = await writeChangelogDraft(model, input);
    expect(written).toMatchObject({
      outcome: 'draft',
      draft: { version: 'v1', title: 'Export invoices as PDF', tags: ['New'] },
    });
    expect(model.requests[0]?.model).toBe('test/docs');
    expect(model.requests[0]?.messages[0]?.content).toContain('Turn these release notes');
    expect(model.requests[0]?.messages[0]?.content).toContain('Available tags: New, Fixed.');

    const internal = entryModel('```json\n{"title":"x","customerVisible":false}\n```');
    expect((await writeChangelogDraft(internal, input)).outcome).toBe('internal');
    expect((await writeChangelogDraft(entryModel('No idea.'), input)).outcome).toBe('unusable');
  });
});

describe('drafting changelog entries from releases', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await freshDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.db.delete(schema.changelogEntries);
    await new SettingsStore(t.db).update({
      product: { name: 'Acme' },
      changelog: { repo: 'acme/app' },
    });
  });

  const listing = () =>
    github({
      '/repos/acme/app/releases?per_page=13': () =>
        Response.json([
          release('v2.1.0', '2026-09-22T00:00:00Z'),
          release('v2.0.0', '2026-09-10T00:00:00Z', { body: '' }),
          release('v1.9.0', '2026-08-01T00:00:00Z'),
        ]),
      '/repos/acme/app/releases?per_page=11': () =>
        Response.json([release('v2.1.0', '2026-09-22T00:00:00Z')]),
    });

  it('writes the latest release as a draft through the changelog repo, once', async () => {
    const { fetch, calls } = listing();
    const model = entryModel();
    const first = await draftChangelogFromReleases(t.db, { model, fetch, token: 'ghp_fake' });
    expect(first.repo).toBe('acme/app');
    expect(first.created).toBe(1);
    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({
      status: 'created',
      sourceRef: 'github:acme/app@v2.1.0',
      draft: { version: 'v2.1.0', title: 'Export invoices as PDF' },
    });
    expect(calls[0]?.headers.authorization).toBe('Bearer ghp_fake');
    expect(model.requests[0]?.messages[0]?.content).toContain('changelog for Acme');
    expect(model.requests[0]?.messages[1]?.content).toContain('# v2.1.0');

    const saved = await getChangelogEntry(t.db, first.results[0]?.entryId ?? '', {
      includeUnpublished: true,
    });
    expect(saved).toMatchObject({
      status: 'draft',
      version: 'v2.1.0',
      sourceRef: 'github:acme/app@v2.1.0',
      body: 'Invoices export as PDF.',
    });
    // A draft: nothing on the public feed yet.
    expect((await listChangelog(t.db)).items).toHaveLength(0);

    const again = await draftChangelogFromReleases(t.db, { model, fetch });
    expect(again.created).toBe(0);
    expect(again.results[0]?.status).toBe('exists');
    expect(model.requests).toHaveLength(1);
  });

  it('backfills several releases oldest first, skipping one with no notes', async () => {
    const { fetch } = listing();
    const result = await draftChangelogFromReleases(t.db, {
      model: entryModel(),
      fetch,
      limit: 3,
    });
    expect(result.results.map((r) => [r.release.tagName, r.status])).toEqual([
      ['v1.9.0', 'created'],
      ['v2.0.0', 'no_notes'],
      ['v2.1.0', 'created'],
    ]);
    expect(result.created).toBe(2);
    const listed = await listChangelog(t.db, { includeUnpublished: true });
    expect(listed.items.map((e) => e.version)).toEqual(['v2.1.0', 'v1.9.0']);
  });

  it('reads one tagged release, and can publish it or only show it', async () => {
    const { fetch } = github({
      '/repos/acme/other/releases/tags/v1.4.0': () =>
        Response.json({ ...RELEASE, tag_name: 'v1.4.0' }),
    });
    const dry = await draftChangelogFromReleases(t.db, {
      model: entryModel(),
      fetch,
      repo: 'acme/other',
      tag: 'v1.4.0',
      dryRun: true,
    });
    expect(dry.results[0]).toMatchObject({ status: 'created', entryId: null });
    expect(dry.created).toBe(0);
    expect((await listChangelog(t.db, { includeUnpublished: true })).items).toHaveLength(0);

    const published = await draftChangelogFromReleases(t.db, {
      model: entryModel(),
      fetch,
      repo: 'acme/other',
      tag: 'v1.4.0',
      publish: true,
    });
    expect(published.created).toBe(1);
    expect((await listChangelog(t.db)).items.map((e) => e.version)).toEqual(['v1.4.0']);
  });

  it('skips a release with nothing customer-visible, and needs a repository', async () => {
    const { fetch } = listing();
    const internal = await draftChangelogFromReleases(t.db, {
      model: entryModel('{"title":"Chores","customerVisible":false}'),
      fetch,
    });
    expect(internal.results[0]?.status).toBe('internal');
    expect(internal.created).toBe(0);

    await new SettingsStore(t.db).update({ changelog: { repo: '' } });
    await expect(
      draftChangelogFromReleases(t.db, { model: entryModel(), fetch }),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('gives an empty result for a repository with no release, and throws for one it cannot see', async () => {
    const { fetch } = github({ '/repos/acme/app/releases?per_page=11': () => Response.json([]) });
    const none = await draftChangelogFromReleases(t.db, { model: entryModel(), fetch });
    expect(none.results).toEqual([]);
    await expect(
      draftChangelogFromReleases(t.db, { model: entryModel(), fetch, repo: 'acme/private' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
