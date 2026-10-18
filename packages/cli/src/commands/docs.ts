/**
 * `helpwell docs generate` and `helpwell docs update`.
 *
 * The self-updating half of HelpWell. `generate` reads what is actually in the
 * repo — README, manifest, routes and handlers, plan and limit definitions,
 * UI copy, changelog, CLI help, and the articles that already exist — and
 * drafts the articles a customer would search for. `update` looks at what
 * changed since a ref and rewrites the articles the change made wrong
 * (KB-02, KB-07).
 *
 * Both write Markdown files and stop. Nothing is committed and nothing reaches
 * the index until `helpwell sync`. New drafts land with `status: draft` so a
 * person publishes them. `update` is different on purpose: it edits a live
 * article in place and keeps its status, because the rewrite is meant to ship
 * as a pull request that a person reads like any other.
 */

import { execFileSync } from 'node:child_process';
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HelpWellError } from '@helpwell/core';
import type { ModelPort } from '@helpwell/core/agent';
import { OpenRouterModel } from '@helpwell/core/agent';
import {
  type Article,
  readKnowledgeBase,
  slugify,
  stringifyFrontmatter,
} from '@helpwell/core/content';
import {
  articleCheckMessage,
  articleCheckPrompt,
  assembleRepoContext,
  diffFor,
  generatePrompt,
  IGNORED_DIRS,
  imagesIn,
  isListed,
  keepKnownImages,
  MAX_FILE_BYTES,
  MIN_SHARED,
  parseDrafts,
  parseVerdict,
  type RepoContext,
  replaceBody,
  type ShotReference,
  scoreArticles,
  splitDiff,
  summariseManifest,
} from '@helpwell/core/docs';
import { loadProject, type Project, writeFile } from '../project.js';
import { traced } from '../traced.js';
import { detail, heading, list, ok, progress, say, style, trace, warn } from '../ui.js';

// The drafting rules live in `@helpwell/core/docs` so a host reading a repo
// through an API drafts exactly what this command drafts.
export {
  BLOCK_VOCABULARY,
  type DiffChunk,
  diffFor,
  keepKnownImages,
  parseDrafts,
  parseJsonBlock,
  parseVerdict,
  type RepoContext,
  relevantArticles,
  replaceBody,
  scoreArticles,
  splitDiff,
} from '@helpwell/core/docs';

export interface DocsGenerateOptions {
  cwd: string;
  /** Narrow the drafts to one area ("billing"). The repo is still read. */
  about?: string;
  /** How many articles to draft. At most 20. */
  count?: number;
  /** Print what it would write and change nothing. */
  dryRun?: boolean;
  /** The model to use. Defaults to OpenRouter with OPENROUTER_API_KEY. */
  model?: ModelPort;
}

export interface DraftedArticle {
  path: string;
  collection: string;
  title: string;
  body: string;
}

export async function docsGenerate(options: DocsGenerateOptions): Promise<DraftedArticle[]> {
  const project = loadProject(options.cwd);
  const model = options.model ?? requireModel(project.config.settings.product.name);
  const count = Math.min(Math.max(1, options.count ?? 5), 20);
  const root = project.paths.root;
  const show = (path: string) => posix(relative(root, path));

  heading('Drafting articles');

  // As written: the model must see and keep the paths the repo uses, not the
  // served URLs `sync` rewrites them to.
  const existing = readKnowledgeBase(project.paths.docsDir, { media: false });
  const shots = availableShots(project);
  const context = buildRepoContext(root, {
    docsDir: project.paths.docsDir,
    articles: existing.articles,
  });
  detail(`read ${context.files} files, ${Math.round(context.chars / 1000)}k chars`);
  for (const source of context.sources) {
    trace(
      `read ${source.path} · ${source.chars.toLocaleString('en-US')} chars${source.clipped ? ', cut to fit' : ''}`,
    );
  }
  if (context.omitted.length > 0) {
    trace(`over budget, not read: ${summarise(context.omitted)}`);
  }
  if (options.about) detail(`about: ${options.about}`);

  const bar = progress('writing');
  bar.update('asking the model');

  const response = await model.chat({
    model: project.config.settings.agent.models.docs,
    // The default output budget is sized for a chat reply; a batch of
    // articles needs room or the JSON is cut off mid-body.
    maxTokens: Math.min(32_000, 1_500 * count + 1_000),
    messages: [
      {
        role: 'system',
        content: generatePrompt({
          product: project.config.settings.product.name,
          count,
          about: options.about,
          existing: existing.articles.map((article) => article.title),
          shots,
        }),
      },
      { role: 'user', content: context.text || '(the repository is empty)' },
    ],
  });

  const drafts = parseDrafts(response.text);
  if (drafts.length === 0) {
    bar.done('Nothing written');
    warn('The model did not return anything usable.');
    return [];
  }

  // The model names collections in prose ("Billing & Invoices"). Map that onto
  // a folder that already exists when one does, by id or by title, so a second
  // run adds to `billing/` rather than inventing `billing-invoices/` beside it.
  const folders = new Map<string, string>();
  for (const collection of existing.collections) {
    folders.set(collection.id, collection.id);
    folders.set(slugify(collection.title), collection.id);
  }

  const written: DraftedArticle[] = [];
  const skipped: string[] = [];
  const created: { path: string; title: string }[] = [];
  const createdDirs = new Set<string>();
  const invented: string[] = [];
  const allowed = new Set(shots.map((shot) => shot.ref));

  for (const draft of drafts.slice(0, count)) {
    const wanted = slugify(draft.collection) || 'help';
    const folder = folders.get(wanted) ?? wanted;
    const dir = join(project.paths.docsDir, folder);
    const path = join(dir, `${slugify(draft.title) || 'untitled'}.md`);

    // Never overwrite something a person wrote.
    if (existsSync(path)) {
      skipped.push(show(path));
      continue;
    }

    // A folder the model just invented gets a _meta.json carrying the name it
    // chose, so "Billing & Invoices" does not surface as "Billing invoices".
    // A folder that already exists is left exactly as it is, _meta.json or not.
    if (!existsSync(dir) && !createdDirs.has(dir)) {
      createdDirs.add(dir);
      const metaPath = join(dir, '_meta.json');
      created.push({ path: show(metaPath), title: draft.collection });
      if (!options.dryRun) {
        writeFile(metaPath, `${JSON.stringify({ title: draft.collection }, null, 2)}\n`);
      }
    }

    // An image the model was not given is one it made up.
    const checked = keepKnownImages(draft.body, allowed);
    draft.body = checked.body;
    invented.push(...checked.removed);

    const contents = stringifyFrontmatter(
      {
        title: draft.title,
        description: draft.description,
        // Drafts are drafts. A human publishes.
        status: 'draft',
      },
      draft.body.trim(),
    );

    if (!options.dryRun) writeFile(path, contents);
    written.push({
      path: show(path),
      collection: draft.collection,
      title: draft.title,
      body: draft.body,
    });
  }

  bar.done(
    options.dryRun
      ? `${written.length} articles would be written`
      : `Wrote ${written.length} articles`,
  );
  list(written.map((item) => `${item.path} ${style.dim(item.title)}`));

  if (created.length > 0) {
    say();
    detail(
      `${options.dryRun ? 'would create' : 'created'} ${created.length} new ${created.length === 1 ? 'collection' : 'collections'}:`,
    );
    list(created.map((item) => `${item.path} ${style.dim(`"${item.title}"`)}`));
  }

  if (skipped.length > 0) {
    say();
    warn(`skipped ${skipped.length} that already exist: ${skipped.join(', ')}`);
  }

  if (invented.length > 0) {
    say();
    warn(
      `removed ${invented.length} ${invented.length === 1 ? 'image' : 'images'} the model invented: ${summarise(invented)}`,
    );
    detail('Only screenshots listed under screenshots.shots in the config can be referenced.');
  }

  say();
  detail('All drafts. Read them, edit them, set status: published, then run `helpwell sync`.');
  say();

  return written;
}

/* ------------------------------------------------------- screenshots */

export interface AvailableShot extends ShotReference {
  /** Whether `helpwell capture` has taken it yet. */
  captured: boolean;
}

/**
 * The screenshots an article may reference: the shots in the capture config,
 * light and dark, by the relative path an article one folder deep uses. A
 * shot not captured yet still counts; `capture` will take it.
 */
export function availableShots(project: Project): AvailableShot[] {
  const from = join(project.paths.docsDir, 'collection');
  const prefix = posix(relative(from, project.paths.screenshotsDir));
  return project.config.screenshots.shots.flatMap((shot) => {
    const files = shot.dark ? [`${shot.name}.png`, `${shot.name}-dark.png`] : [`${shot.name}.png`];
    return files.map((file) => ({
      ref: `${prefix}/${file}`,
      path: shot.path,
      captured: existsSync(join(project.paths.screenshotsDir, file)),
    }));
  });
}

/* ----------------------------------------------------------- the context */

/**
 * What the repo can tell a model about the product, within a budget. The
 * selection and budgets are `assembleRepoContext`'s; this reads the files
 * from disk and runs a CLI's own `--help`.
 */
export function buildRepoContext(
  root: string,
  options: { docsDir?: string; articles?: Article[] } = {},
): RepoContext {
  const docs = options.docsDir ? posix(relative(root, options.docsDir)) : null;
  return assembleRepoContext(listFiles(root, docs), (path) => readText(join(root, path)), {
    docs: docs ?? 'docs',
    articles: options.articles,
    manifest: summariseManifest(readText(join(root, 'package.json'))),
    cliHelp: (bin) => cliHelp(root, bin),
  });
}

/**
 * Every file worth looking at, relative to the root with forward slashes.
 * `git ls-files` (tracked plus untracked-but-not-ignored) when the repo is a
 * git repo, a walk otherwise. The docs folder and `helpwell/` are left out:
 * articles are added separately, and the config is not product material.
 */
function listFiles(root: string, docs: string | null): string[] {
  let paths: string[];
  try {
    trace('git ls-files -z --cached --others --exclude-standard');
    paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    paths = walk(root);
  }
  return paths.map(posix).filter((path) => isListed(path, docs));
}

function walk(root: string): string[] {
  const out: string[] = [];
  const stack = [''];
  while (stack.length > 0 && out.length < 20_000) {
    const dir = stack.pop() ?? '';
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) out.push(path);
    }
  }
  return out.sort();
}

function readText(path: string): string | null {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null;
    const text = readFileSync(path, 'utf8');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

/** `node <bin> --help`, five seconds at most. Any failure just means no help. */
function cliHelp(root: string, bin: string): string | null {
  const path = join(root, bin);
  if (!existsSync(path)) return null;
  trace(`node ${bin} --help`);
  try {
    return execFileSync(process.execPath, [path, '--help'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (error) {
    // Some CLIs print help and exit 1. Take whatever came out.
    const out = (error as { stdout?: unknown }).stdout;
    return typeof out === 'string' && out.trim() ? out : null;
  }
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

/* ---------------------------------------------------------------- update */

export interface DocsUpdateOptions {
  cwd: string;
  /** Compare against this git ref. Defaults to the last tag, then the first commit. */
  since?: string;
  dryRun?: boolean;
  /** The model to use. Defaults to OpenRouter with OPENROUTER_API_KEY. */
  model?: ModelPort;
}

export interface ProposedEdit {
  path: string;
  title: string;
  reason: string;
  body: string;
}

export async function docsUpdate(options: DocsUpdateOptions): Promise<ProposedEdit[]> {
  const project = loadProject(options.cwd);
  const model = options.model ?? requireModel(project.config.settings.product.name);
  const root = project.paths.root;

  heading('Checking the docs against what changed');

  const since = options.since ? { ref: options.since, label: options.since } : lastRef(root);
  detail(`comparing against ${since.label}`);

  const diff = gitDiff(root, since.ref, project.paths.docsDir);
  if (!diff.trim()) {
    ok(`Nothing has changed since ${since.label}.`);
    return [];
  }

  // As written, because whatever the model returns is written back to the file.
  const knowledgeBase = readKnowledgeBase(project.paths.docsDir, { media: false });
  const shots = availableShots(project);
  if (knowledgeBase.articles.length === 0) {
    warn('No articles to check. Run `helpwell docs generate` first.');
    return [];
  }

  // Per file, so a generated file that happens to sort early cannot hide the
  // hunk that matters from either the prefilter or the model.
  const chunks = splitDiff(diff, (path, chars) =>
    trace(`left out ${path}: ${chars.toLocaleString('en-US')} chars of diff is data, not a change`),
  );
  const scored = scoreArticles(
    knowledgeBase.articles,
    chunks.map((chunk) => chunk.text).join('\n'),
  );
  for (const { article, shared } of scored) {
    const words =
      shared.length > 0 ? `shares ${summarise(shared)}` : 'shares nothing with the diff';
    trace(`${shared.length >= MIN_SHARED ? 'check' : 'skip '} ${article.path} · ${words}`);
  }
  const candidates = scored
    .filter(({ shared }) => shared.length >= MIN_SHARED)
    .map(({ article }) => article);
  if (candidates.length === 0) {
    ok(`None of the ${knowledgeBase.articles.length} articles mention what changed.`);
    return [];
  }
  detail(
    `checking ${candidates.length} of ${knowledgeBase.articles.length} articles that mention what changed`,
  );

  const bar = progress('reviewing');
  const proposals: ProposedEdit[] = [];
  const invented: string[] = [];

  for (const [index, article] of candidates.entries()) {
    bar.update(`${index + 1}/${candidates.length} ${article.title.slice(0, 36)}`);

    const shown = diffFor(article, chunks);
    const files = [...shown.matchAll(/^diff --git a\/(.+?) b\//gm)].map((match) => match[1]);
    trace(`${article.path} is judged against ${summarise(files as string[])}`);

    const response = await model.chat({
      model: project.config.settings.agent.models.docs,
      maxTokens: 8_000,
      messages: [
        { role: 'system', content: articleCheckPrompt(shots) },
        { role: 'user', content: articleCheckMessage(article, shown) },
      ],
    });

    const verdict = parseVerdict(response.text);
    if (!verdict?.stale || !verdict.body) continue;

    // The article's own images may stay; anything else it added was invented.
    const checked = keepKnownImages(
      verdict.body,
      new Set([...shots.map((shot) => shot.ref), ...imagesIn(article.body)]),
    );
    verdict.body = checked.body;
    for (const url of checked.removed) invented.push(`${article.path}: ${url}`);

    // `article.path` is the real file: the slug can be overridden in the
    // frontmatter and the extension can be .mdx, so it is not derivable.
    const path = join(project.paths.docsDir, article.path);
    if (!options.dryRun) {
      writeFile(path, replaceBody(readFileSync(path, 'utf8'), verdict.body));
    }

    proposals.push({
      path: posix(relative(root, path)),
      title: article.title,
      reason: verdict.reason,
      body: verdict.body,
    });
  }

  bar.done(
    proposals.length === 0
      ? 'Every article still reads correctly'
      : `${proposals.length} article${proposals.length === 1 ? '' : 's'} ${options.dryRun ? 'would change' : 'updated'}`,
  );

  for (const proposal of proposals) {
    say(`  ${style.violet('·')} ${proposal.path}`);
    say(`    ${style.dim(proposal.reason)}`);
  }

  if (invented.length > 0) {
    say();
    warn(`removed ${invented.length} invented ${invented.length === 1 ? 'image' : 'images'}`);
    list(invented);
  }

  if (proposals.length > 0) {
    say();
    detail('Review the diff before you commit it. Nothing has been published.');
  }
  say();

  return proposals;
}

/* -------------------------------------------------------------- helpers */

export function requireModel(productName: string): ModelPort {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new HelpWellError(
      'not_configured',
      'Writing docs needs a model. Set OPENROUTER_API_KEY.',
    );
  }
  return traced(new OpenRouterModel({ apiKey, appName: productName }));
}

/** At most eight, then a count, so a verbose line stays one line. */
function summarise(items: string[]): string {
  const shown = items.slice(0, 8).join(', ');
  return items.length > 8 ? `${shown} and ${items.length - 8} more` : shown;
}

function git(root: string, args: string[], options: { maxBuffer?: number } = {}): string {
  trace(`git ${args.join(' ')}`);
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
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

export interface GitRange {
  /** What to hand to git. */
  ref: string;
  /** What to show a person. */
  label: string;
}

/**
 * The last tag, or the first commit when the repo has none. The old fallback
 * was `HEAD~20`, which does not exist in a repo with fewer than 21 commits
 * and silently ignores everything older in one with more.
 */
export function lastRef(root: string): GitRange {
  const tag = tryGit(root, ['describe', '--tags', '--abbrev=0']);
  if (tag) return { ref: tag, label: tag };

  const roots = git(root, ['rev-list', '--max-parents=0', 'HEAD'])
    .trim()
    .split('\n')
    .filter(Boolean);
  const first = roots[roots.length - 1];
  if (!first) throw new HelpWellError('bad_request', 'git rev-list found no commits.');
  return { ref: first, label: `the first commit, ${first.slice(0, 7)} (no tags found)` };
}

/**
 * Lockfiles are never a reason to rewrite an article. A leading `*` matches at
 * any depth including the root, because git's default pathspec wildcard also
 * matches slashes; `**\/*.lock` would need a slash and miss the root.
 */
const DIFF_EXCLUDES = [
  ':!*.lock',
  ':!*package-lock.json',
  ':!*pnpm-lock.yaml',
  ':!*yarn.lock',
  ':!*bun.lockb',
];

/** Everything that changed since `since`, minus lockfiles, the docs and helpwell/. */
export function gitDiff(root: string, since: string, docsDir: string): string {
  const docs = posix(relative(root, docsDir)) || 'docs';
  return git(
    root,
    ['diff', `${since}...HEAD`, '--', '.', ...DIFF_EXCLUDES, `:!${docs}/**`, ':!helpwell/**'],
    { maxBuffer: 32 * 1024 * 1024 },
  );
}
