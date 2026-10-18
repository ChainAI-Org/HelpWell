/**
 * The tools that change something (DX-04): write and edit articles, draft the
 * changelog, retake screenshots, import docs, change a setting, run the evals,
 * and read segments and single conversations.
 *
 * Articles are files, so they are written into the repo's docs folder and
 * then indexed, exactly as `helpwell sync` would, and embedded on save when
 * the server has a model key, as a save from the dashboard or the API is;
 * the change reaches readers through the developer's normal review. The changelog, screenshots and
 * imports reuse the CLI rather than copies of it: the server runs the repo's
 * own `helpwell` with `--json` and hands its result back. Nothing here can
 * publish to customers on its own: new articles default to drafts, and the
 * changelog tool only ever saves a draft.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { HelpWellError } from '@helpwell/core';
import {
  casesFromLastRun,
  type EvalCase,
  loadEvalCases,
  type ModelPort,
  OpenRouterModel,
  runEvalSuite,
} from '@helpwell/core/agent';
import {
  EMPTY_ARTICLE_MESSAGE,
  type Frontmatter,
  isEmptyArticleBody,
  parseFrontmatter,
  readKnowledgeBase,
  slugify,
  stringifyFrontmatter,
} from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import {
  countSegment,
  getConversation,
  getSegment,
  listSegments,
  validateRules,
} from '@helpwell/core/repos';
import { indexArticle, indexCollections } from '@helpwell/core/search';
import { type Settings, SettingsStore } from '@helpwell/core/settings';
import type { McpEnvironment } from './project.js';
import { redactEmails, type ToolArgs } from './tools.js';

/* ---------------------------------------------------------------- reading */

function str(args: ToolArgs, key: string, required = false): string | undefined {
  const value = args?.[key];
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new HelpWellError(
        'bad_request',
        `"${key}" is required and must be a non-empty string.`,
      );
    }
    return undefined;
  }
  if (typeof value !== 'string')
    throw new HelpWellError('bad_request', `"${key}" must be a string.`);
  return value.trim();
}

function flag(args: ToolArgs, key: string): boolean | undefined {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new HelpWellError('bad_request', `"${key}" must be true or false.`);
}

function number(args: ToolArgs, key: string): number | undefined {
  const value = args?.[key];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new HelpWellError('bad_request', `"${key}" must be a number.`);
  }
  return parsed;
}

function needRepo(env: McpEnvironment): { root: string; docsDir: string } {
  if (!env.root || !env.docsDir) {
    throw new HelpWellError(
      'not_configured',
      'This tool writes into the repo, and no HelpWell install was found. Start the server from the repo, or set HELPWELL_PROJECT_DIR.',
    );
  }
  return { root: env.root, docsDir: env.docsDir };
}

/* --------------------------------------------------------------- articles */

export interface WrittenArticle {
  slug: string;
  /** Relative to the repo root: the file to review. */
  path: string;
  status: string;
  indexed: boolean;
  /**
   * Whether semantic search has the article as saved. False means text
   * search only, until a sync with OPENROUTER_API_KEY set embeds it.
   */
  embedded: boolean;
}

/** The model a saved article is embedded with, or null for text search only. */
function embeddingModel(env: McpEnvironment, settings: Settings): ModelPort | null {
  if (env.model !== undefined) return env.model;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenRouterModel({
    apiKey,
    appName: settings.product.name,
    appUrl: settings.product.appUrl || undefined,
  });
}

/**
 * Index one file from the docs folder, and the collection metadata beside it.
 * Embedded straight away when there is a model, as the dashboard and the API
 * do on save. A provider that fails leaves it indexed as text: the file is
 * already written, and the next sync with a key embeds it.
 */
async function indexFile(
  db: Db,
  docsDir: string,
  file: string,
  env: McpEnvironment,
): Promise<{ slug: string; embedded: boolean }> {
  const kb = readKnowledgeBase(docsDir);
  const wanted = relative(docsDir, file).split('\\').join('/');
  const article = kb.articles.find((a) => a.path === wanted);
  if (!article) throw new HelpWellError('internal', `Wrote ${wanted} but could not read it back.`);
  const settings = await new SettingsStore(db).get();
  const model = embeddingModel(env, settings);
  let indexed: { embedded: boolean };
  try {
    indexed = await indexArticle(db, article, {
      origin: 'api',
      model: model ?? undefined,
      embeddingModel: settings.agent.models.embeddings,
    });
  } catch (error) {
    if (!model) throw error;
    indexed = await indexArticle(db, article, { origin: 'api' });
  }
  await indexCollections(db, kb.collections);
  return { slug: article.slug, embedded: indexed.embedded };
}

/**
 * Write a new article. It lands as a draft unless `status: "published"` is
 * asked for, so a person still decides what customers read.
 */
export async function createArticleTool(
  db: Db,
  args: ToolArgs,
  env: McpEnvironment,
): Promise<WrittenArticle> {
  const { root, docsDir } = needRepo(env);
  const collection = str(args, 'collection', true)!;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(collection)) {
    throw new HelpWellError(
      'bad_request',
      '"collection" is a folder name: lower case letters, digits and hyphens. Use list_collections to see the existing ones.',
    );
  }
  const title = str(args, 'title', true)!;
  const body = markdown(args, 'body');
  if (body === undefined) {
    throw new HelpWellError(
      'bad_request',
      '"body" is required: the article\'s Markdown. It may be empty only for a draft.',
    );
  }
  const name = slugify(str(args, 'slug') ?? title);
  if (!name)
    throw new HelpWellError('bad_request', 'The title gives no usable file name; pass "slug".');
  const status = str(args, 'status') ?? 'draft';
  if (!['draft', 'published'].includes(status)) {
    throw new HelpWellError('bad_request', '"status" must be draft or published.');
  }
  refuseEmptyPublished(status, body, title);

  const file = join(docsDir, collection, `${name}.md`);
  if (existsSync(file)) {
    throw new HelpWellError(
      'conflict',
      `${relative(root, file)} already exists. Use update_article to change it.`,
    );
  }
  const frontmatter: Frontmatter = { title };
  const description = str(args, 'description');
  if (description) frontmatter.description = description;
  frontmatter.status = status;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringifyFrontmatter(frontmatter, body), 'utf8');

  const { slug, embedded } = await indexFile(db, docsDir, file, env);
  return {
    slug,
    path: relative(root, file).split('\\').join('/'),
    status,
    indexed: true,
    embedded,
  };
}

/** Change an article's words or frontmatter in place. Fields not passed stay as they are. */
export async function updateArticleTool(
  db: Db,
  args: ToolArgs,
  env: McpEnvironment,
): Promise<WrittenArticle> {
  const { root, docsDir } = needRepo(env);
  const slug = str(args, 'slug', true)!;
  const article = readKnowledgeBase(docsDir).articles.find((a) => a.slug === slug);
  if (!article) {
    throw new HelpWellError(
      'not_found',
      `No article with the slug "${slug}" in ${relative(root, docsDir) || 'the docs folder'}. Use search_articles to find it.`,
    );
  }
  const file = join(docsDir, article.path);
  const { data, content } = parseFrontmatter(readFileSync(file, 'utf8'));
  const title = str(args, 'title');
  const description = str(args, 'description');
  const status = str(args, 'status');
  const body = markdown(args, 'body') ?? content;
  if (status && !['draft', 'published', 'archived'].includes(status)) {
    throw new HelpWellError('bad_request', '"status" must be draft, published or archived.');
  }
  if (title) data.title = title;
  if (description !== undefined) data.description = description;
  if (status) data.status = status;
  // Checked on the article as it would be saved: an edit that only publishes
  // an empty draft, or only empties a published article, is refused too.
  refuseEmptyPublished(
    articleStatus(data.status),
    body,
    typeof data.title === 'string' ? data.title : article.title,
  );
  writeFileSync(file, stringifyFrontmatter(data, body), 'utf8');

  const { embedded } = await indexFile(db, docsDir, file, env);
  return {
    slug,
    path: relative(root, file).split('\\').join('/'),
    status: typeof data.status === 'string' ? data.status : 'published',
    indexed: true,
    embedded,
  };
}

/**
 * The Markdown body argument: any string, an empty one included, because a
 * draft may be saved before it is written. Missing is undefined.
 */
function markdown(args: ToolArgs, key: string): string | undefined {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new HelpWellError('bad_request', `"${key}" must be a string.`);
  }
  return value.trim();
}

/** The status an article is read with: what its frontmatter says, published when it says nothing usable. */
function articleStatus(value: unknown): string {
  return typeof value === 'string' && ['draft', 'published', 'archived'].includes(value)
    ? value
    : 'published';
}

/**
 * The rule the dashboard and the API apply (`saveArticle`): a published
 * article must say something, where a draft may be empty. Checked before the
 * file is written, so a refusal leaves the repo as it was. The message is
 * the one the dashboard shows, and it is what the assistant reads.
 */
function refuseEmptyPublished(status: string, body: string, title: string): void {
  if (status === 'published' && isEmptyArticleBody(body, title)) {
    throw new HelpWellError('bad_request', EMPTY_ARTICLE_MESSAGE);
  }
}

/* ---------------------------------------------------------- conversations */

export interface ConversationTranscript {
  id: string;
  status: string;
  topic: string | null;
  tags: string[];
  rating: string | null;
  messages: {
    role: string;
    /** Verbatim, except that email addresses read "[email]". */
    body: string;
    citations: string[];
    /** The names of the tools the agent used; their inputs and outputs can hold account data. */
    tools: string[];
    feedback: string | null;
    createdAt: string;
  }[];
}

/**
 * One conversation, for working out why an answer went wrong. Same masking as
 * recent_conversations: no contact record, email addresses blanked, and tool
 * calls reduced to their names because a user lookup returns account data.
 */
export async function readConversationTool(
  db: Db,
  args: ToolArgs,
): Promise<ConversationTranscript> {
  const id = str(args, 'id', true)!;
  const thread = await getConversation(db, id);
  if (!thread) {
    throw new HelpWellError(
      'not_found',
      `No conversation "${id}". Use recent_conversations to find one.`,
    );
  }
  return {
    id: thread.id,
    status: thread.status,
    topic: thread.topic,
    tags: thread.tags,
    rating: thread.rating,
    messages: thread.messages.map((m) => ({
      role: m.role,
      body: redactEmails(m.body),
      citations: m.citations.map((c) => c.slug),
      tools: m.toolCalls.map((call) => call.name),
      feedback: m.feedback,
      createdAt: new Date(m.createdAt).toISOString(),
    })),
  };
}

/* --------------------------------------------------------------- settings */

/** Settings the MCP server will not touch: where data is sent, and anything secret. */
const PROTECTED = /^(webhooks)(\.|$)|secret|token|password|key$/i;

/**
 * Change one setting by its dotted path, e.g. `widget.appearance.accent`.
 * Written to the database the app reads and, inside a repo, to
 * helpwell/helpwell.config.json too, so the file stays the source of truth.
 */
export async function updateSettingTool(
  db: Db,
  args: ToolArgs,
  env: McpEnvironment,
): Promise<{ path: string; value: unknown; configFile: string | null }> {
  const path = str(args, 'path', true)!;
  if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)*$/.test(path)) {
    throw new HelpWellError(
      'bad_request',
      '"path" is a dotted settings path, like widget.appearance.accent.',
    );
  }
  if (PROTECTED.test(path)) {
    throw new HelpWellError(
      'forbidden',
      `"${path}" decides where data goes or holds a secret, so it is changed in the dashboard or the config file by a person, not through MCP.`,
    );
  }
  if (!args || !('value' in args)) throw new HelpWellError('bad_request', '"value" is required.');
  const patch: Record<string, unknown> = {};
  const keys = path.split('.');
  let cursor = patch;
  for (const key of keys.slice(0, -1)) {
    cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys.at(-1)!] = args.value;

  let updated: Record<string, unknown>;
  try {
    updated = (await new SettingsStore(db).update(patch)) as unknown as Record<string, unknown>;
  } catch (cause) {
    throw new HelpWellError(
      'bad_request',
      `That value is not valid for ${path}: ${String(cause).slice(0, 300)}`,
    );
  }
  const value = keys.reduce<unknown>(
    (at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined),
    updated,
  );

  let configFile: string | null = null;
  if (env.root) {
    const file = join(env.root, 'helpwell', 'helpwell.config.json');
    try {
      const config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const settings = (config.settings ?? {}) as Record<string, unknown>;
      let at = settings;
      for (const key of keys.slice(0, -1)) {
        if (!at[key] || typeof at[key] !== 'object') at[key] = {};
        at = at[key] as Record<string, unknown>;
      }
      at[keys.at(-1)!] = value;
      config.settings = settings;
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      configFile = relative(env.root, file).split('\\').join('/');
    } catch {
      // No config file to keep in step: the database write stands on its own.
    }
  }
  return { path, value, configFile };
}

/* --------------------------------------------------------------- segments */

export async function listSegmentsTool(db: Db) {
  const segments = await listSegments(db);
  return segments.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    count: s.count,
    rules: s.rules,
  }));
}

/** How many contacts a saved segment, or some rules not yet saved, match. */
export async function countSegmentTool(db: Db, args: ToolArgs): Promise<{ count: number }> {
  const id = str(args, 'id');
  if (id) {
    const segment = await getSegment(db, id);
    if (!segment) throw new HelpWellError('not_found', `No segment "${id}". Use list_segments.`);
    return { count: await countSegment(db, segment.rules) };
  }
  if (!args || args.rules === undefined) {
    throw new HelpWellError(
      'bad_request',
      'Pass "id" for a saved segment, or "rules" to count unsaved conditions.',
    );
  }
  return { count: await countSegment(db, await validateRules(db, args.rules)) };
}

/* ------------------------------------------------------ through the CLI */

async function viaCli(env: McpEnvironment, args: string[]): Promise<unknown> {
  const outcome = await env.runCli(args);
  if (!outcome.ok) {
    throw new HelpWellError(
      'upstream_failed',
      outcome.error?.message ?? `helpwell ${args[0]} failed.`,
    );
  }
  return outcome.result;
}

const option = (name: string, value: string | number | undefined) =>
  value === undefined ? [] : [`--${name}`, String(value)];

/**
 * Draft a changelog entry from a GitHub release or the commits in a range, as
 * `helpwell changelog` does. Always a draft: publishing announces to
 * customers, which a person does.
 */
export async function generateChangelogTool(args: ToolArgs, env: McpEnvironment): Promise<unknown> {
  return viaCli(env, [
    'changelog',
    ...option('source', str(args, 'source')),
    ...option('since', str(args, 'since')),
    ...option('to', str(args, 'to')),
    ...option('release', str(args, 'release')),
    ...(flag(args, 'dryRun') ? ['--dry-run'] : []),
  ]);
}

export async function captureScreenshotsTool(
  args: ToolArgs,
  env: McpEnvironment,
): Promise<unknown> {
  return viaCli(env, [
    'capture',
    ...option('only', str(args, 'only')),
    ...option('url', str(args, 'url')),
  ]);
}

/** Import articles from another help desk, a folder or a crawl, as `helpwell import` does. */
export async function importDocsTool(args: ToolArgs, env: McpEnvironment): Promise<unknown> {
  const source = str(args, 'source', true)!;
  if (source === 'contacts') {
    throw new HelpWellError(
      'forbidden',
      'Contacts are personal data; import them with `helpwell import contacts` in a terminal.',
    );
  }
  const target = str(args, 'target');
  return viaCli(env, [
    'import',
    source,
    ...(target ? [target] : []),
    ...option('subdomain', str(args, 'subdomain')),
    ...option('locale', str(args, 'locale')),
    ...option('website-id', str(args, 'websiteId')),
    ...option('max', number(args, 'max')),
    ...(flag(args, 'dryRun') ? ['--dry-run'] : []),
    ...(flag(args, 'draft') ? ['--draft'] : []),
  ]);
}

/* ------------------------------------------------------------------ evals */

export interface EvalSummary {
  mode: string;
  model: string | null;
  score: number;
  passed: number;
  weak: number;
  failed: number;
  costUsd: number;
  recorded: boolean;
  /** The failures and weak answers first: those are the docs to fix. */
  problems: {
    question: string;
    verdict: string;
    expected: string | null;
    cited: string | null;
    reason?: string;
  }[];
}

/**
 * Replay the eval questions through the real agent. Uses
 * helpwell/evals.json when the server runs in the repo, else the cases from
 * the last recorded run. Without OPENROUTER_API_KEY it runs retrieval only,
 * which costs nothing and checks that the right article is found.
 */
export async function runEvalsTool(
  db: Db,
  args: ToolArgs,
  env: McpEnvironment,
): Promise<EvalSummary> {
  let cases: EvalCase[] = [];
  const file = env.root ? join(env.root, 'helpwell', 'evals.json') : null;
  if (file && existsSync(file)) cases = loadEvalCases(file);
  if (cases.length === 0) cases = await casesFromLastRun(db);
  if (cases.length === 0) {
    throw new HelpWellError(
      'not_found',
      'There are no eval cases: add some to helpwell/evals.json, or run `helpwell eval` once.',
    );
  }
  const settings = await new SettingsStore(db).get();
  const key = process.env.OPENROUTER_API_KEY;
  const read = (name: string) => {
    if (!env.root) return undefined;
    try {
      return readFileSync(join(env.root, 'helpwell', name), 'utf8');
    } catch {
      return undefined;
    }
  };
  const result = await runEvalSuite({
    db,
    settings,
    cases,
    model: key ? new OpenRouterModel({ apiKey: key, appName: settings.product.name }) : null,
    instructions: read('instructions.md'),
    playbook: read('playbook.md'),
    ref: str(args, 'ref') ?? 'mcp',
    dryRun: flag(args, 'dryRun') ?? false,
    threshold: number(args, 'threshold'),
  });
  const rank = { fail: 0, weak: 1, pass: 2 } as Record<string, number>;
  return {
    mode: result.mode,
    model: result.model,
    score: result.score,
    passed: result.passed,
    weak: result.weak,
    failed: result.failed,
    costUsd: result.costUsd,
    recorded: result.id !== null,
    problems: result.cases
      .filter((c) => c.verdict !== 'pass')
      .sort((a, b) => (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3))
      .slice(0, 20)
      .map((c) => ({
        question: c.question,
        verdict: c.verdict,
        expected: c.expected,
        cited: c.cited,
        reason: c.reason,
      })),
  };
}
