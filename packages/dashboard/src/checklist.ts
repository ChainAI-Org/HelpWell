/**
 * The "Get set up" checklist: what a new install still needs, worked out from
 * the install itself rather than from boxes someone ticked.
 *
 * Each step reads one fact: the model key is set, the docs folder has
 * articles, they are indexed, the widget has loaded on a real page, someone
 * signed in was identified, the agent has written an answer. Only the steps
 * HelpWell cannot see (the MCP server lives in someone's editor) are marked
 * done by hand, and any optional step can be.
 *
 * `gatherFacts` does the reading and `checklistSteps` the judging, so every
 * step's rule can be tested without a database.
 */

import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ContentSource } from '@helpwell/core/content';
import { type Db, rowsOf } from '@helpwell/core/db';
import { checklistState, type WidgetSighting, widgetSighting } from '@helpwell/core/repos';
import type { Settings } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import type { ContentMode } from './content-mode.js';

export type StepKey =
  | 'model-key'
  | 'content'
  | 'index'
  | 'widget'
  | 'identity'
  | 'answer'
  | 'webhooks'
  | 'mcp';

/** The steps that can be marked done by hand: the optional ones. */
export const OPTIONAL_STEPS: readonly StepKey[] = ['identity', 'webhooks', 'mcp'];

export interface SetupFacts {
  modelKey: boolean;
  chatModel: string;
  /** Markdown files in the docs folder, or null when the folder cannot be read from here. */
  docFiles: number | null;
  docsDir: string;
  /** Articles in the search index, drafts included, and the published ones. */
  indexed: number;
  published: number;
  collections: number;
  /** Published articles with an embedding. */
  embedded: number;
  /** Empty when semantic search is switched off. */
  embeddingModel: string;
  widget: WidgetSighting | null;
  identitySecret: boolean;
  /** Contacts the host app vouched for with a signed token. */
  identified: number;
  /** Agent replies a model wrote, and ones search wrote because no model answered. */
  answered: number;
  searchOnly: number;
  webhooksConfigured: number;
  webhooksDelivered: number;
  /** Optional steps marked done by hand. */
  markedDone: string[];
  dismissedAt: Date | null;
  /**
   * `managed` when there is no repo behind the content: saving indexes an
   * article, there is no CLI to run, and no editor to connect an MCP server
   * to the install from. See content-mode.ts.
   */
  contentMode?: ContentMode;
}

export type StepStatus = 'done' | 'partial' | 'todo';

export interface ChecklistStep {
  key: StepKey;
  title: string;
  optional: boolean;
  status: StepStatus;
  /** One sentence: what was seen, or what is missing. */
  detail: string;
  /** Marked done by hand rather than seen. */
  manual?: boolean;
}

export function checklistSteps(facts: SetupFacts): ChecklistStep[] {
  const marked = new Set(facts.markedDone);
  const step = (
    key: StepKey,
    title: string,
    status: StepStatus,
    detail: string,
    optional = false,
  ): ChecklistStep => {
    if (optional && status !== 'done' && marked.has(key)) {
      return { key, title, optional, status: 'done', detail: 'Marked done.', manual: true };
    }
    return { key, title, optional, status, detail };
  };

  const hasContent = facts.docFiles === null ? facts.indexed > 0 : facts.docFiles > 0;
  const semanticDone = !facts.embeddingModel || facts.embedded >= facts.published;
  const unindexedFiles =
    facts.docFiles !== null && facts.docFiles > facts.indexed ? facts.docFiles - facts.indexed : 0;
  // No repo: a save is what indexes an article, and there is nothing to run.
  const managed = facts.contentMode === 'managed';

  const steps = [
    step(
      'model-key',
      'Add your model key',
      facts.modelKey ? 'done' : 'todo',
      facts.modelKey
        ? `Set. Answers are written with ${facts.chatModel}.`
        : managed
          ? 'No model is set up yet, so the agent can only point people at the closest article.'
          : 'OPENROUTER_API_KEY is not set, so the agent can only point people at the closest article.',
    ),
    step(
      'content',
      'Write your first articles',
      hasContent ? 'done' : 'todo',
      hasContent
        ? facts.docFiles === null
          ? `${plural(facts.indexed, 'article')} in the index.`
          : managed
            ? `${plural(facts.docFiles, 'article')} saved.`
            : `${plural(facts.docFiles, 'Markdown file')} in ${facts.docsDir}.`
        : managed
          ? 'No articles yet. Write one in the knowledge base.'
          : `No articles in ${facts.docsDir} yet. Write one in the knowledge base, or run npx helpwell docs generate.`,
    ),
    step(
      'index',
      'Build the search index',
      facts.indexed === 0 ? 'todo' : semanticDone && unindexedFiles === 0 ? 'done' : 'partial',
      facts.indexed === 0
        ? managed
          ? 'Nothing is indexed yet. An article is indexed when it is saved.'
          : 'Nothing is indexed yet. Run npx helpwell sync.'
        : unindexedFiles > 0
          ? managed
            ? `${plural(unindexedFiles, 'saved article')} ${unindexedFiles === 1 ? 'is' : 'are'} not in the index yet. ${unindexedFiles === 1 ? 'It goes' : 'They go'} live once indexed.`
            : `${plural(unindexedFiles, 'file')} in the docs folder ${unindexedFiles === 1 ? 'is' : 'are'} not in the index. Run npx helpwell sync.`
          : !semanticDone
            ? managed
              ? `${facts.embedded} of ${facts.published} published articles have embeddings. The rest pick them up when they are next indexed with a model.`
              : `${facts.embedded} of ${facts.published} published articles have embeddings. Run npx helpwell sync with the model key set.`
            : `${plural(facts.indexed, 'article')} in ${plural(facts.collections, 'collection')}${
                facts.embeddingModel ? ', all searchable by meaning as well as words' : ''
              }.`,
    ),
    step(
      'widget',
      'Install the widget',
      facts.widget ? 'done' : 'todo',
      facts.widget
        ? `Loaded on ${facts.widget.lastPage ?? facts.widget.firstPage ?? 'a page'}.`
        : 'Not seen on any page yet. Add the script tag, then open your site.',
    ),
    step(
      'identity',
      'Identify signed-in people',
      facts.identified > 0 ? 'done' : facts.identitySecret ? 'partial' : 'todo',
      facts.identified > 0
        ? `${plural(facts.identified, 'signed-in person', 'signed-in people')} so far.`
        : facts.identitySecret
          ? 'The secret is set. Waiting for the first signed-in visitor.'
          : 'Optional. Without it everyone is an anonymous visitor, and the agent knows nothing about their account.',
      true,
    ),
    step(
      'answer',
      'Answer your first question',
      facts.answered > 0 ? 'done' : facts.searchOnly > 0 ? 'partial' : 'todo',
      facts.answered > 0
        ? `${plural(facts.answered, 'answer')} written so far.`
        : facts.searchOnly > 0
          ? 'Questions have been answered from search alone, without the model. Add the model key for written answers.'
          : 'Open your site, ask the widget something, and read the answer in Conversations.',
    ),
    step(
      'webhooks',
      'Send events to your systems',
      facts.webhooksDelivered > 0 ? 'done' : facts.webhooksConfigured > 0 ? 'partial' : 'todo',
      facts.webhooksDelivered > 0
        ? `${plural(facts.webhooksDelivered, 'delivery', 'deliveries')} made.`
        : facts.webhooksConfigured > 0
          ? `${plural(facts.webhooksConfigured, 'webhook')} configured, nothing delivered yet. Send a test from Connections.`
          : 'Optional. Webhooks tell your own systems when a conversation goes unresolved, a gap appears, and more.',
      true,
    ),
    step(
      'mcp',
      'Connect your coding agent',
      'todo',
      'Optional. HelpWell cannot see your editor, so mark this done once your agent lists the helpwell tools.',
      true,
    ),
  ];
  // The MCP server runs beside a repo and its database; managed content has neither.
  return managed ? steps.filter((each) => each.key !== 'mcp') : steps;
}

/** Every required step is done: the checklist can be put away. */
export function checklistComplete(steps: ChecklistStep[]): boolean {
  return steps.every((step) => step.optional || step.status === 'done');
}

export interface FactSources {
  modelKey: boolean;
  identitySecret: boolean;
  docsDir?: string;
  /** The host's content source, counted instead of the docs folder on disk. */
  content?: ContentSource;
  contentMode?: ContentMode;
}

export async function gatherFacts(
  db: Db,
  settings: Settings,
  sources: FactSources,
): Promise<SetupFacts> {
  const docsDir = (sources.docsDir ?? 'docs').replace(/\\/g, '/').replace(/\/+$/, '') || 'docs';
  const [counts, widget, state, docFiles] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*) FROM helpwell.article_index) AS indexed,
        (SELECT count(*) FROM helpwell.article_index WHERE status = 'published') AS published,
        (SELECT count(DISTINCT collection) FROM helpwell.article_index) AS collections,
        (SELECT count(*) FROM helpwell.article_index
          WHERE status = 'published' AND embedding IS NOT NULL
            AND jsonb_typeof(embedding) = 'array') AS embedded,
        (SELECT count(*) FROM helpwell.contacts
          WHERE identified AND external_id IS NOT NULL AND deleted_at IS NULL) AS identified,
        (SELECT count(*) FROM helpwell.messages
          WHERE role = 'agent' AND coalesce(model, '') NOT LIKE 'search-only%') AS answered,
        (SELECT count(*) FROM helpwell.messages
          WHERE role = 'agent' AND model LIKE 'search-only%') AS search_only,
        (SELECT count(*) FROM helpwell.webhook_deliveries WHERE status = 'delivered') AS delivered
    `),
    widgetSighting(db),
    checklistState(db),
    sources.content ? countSourceDocFiles(sources.content) : countDocFiles(docsDir),
  ]);
  const row = rowsOf<Record<string, number | string>>(counts)[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);

  return {
    modelKey: sources.modelKey,
    chatModel: settings.agent.models.chat,
    docFiles,
    docsDir,
    indexed: n('indexed'),
    published: n('published'),
    collections: n('collections'),
    embedded: n('embedded'),
    embeddingModel: settings.agent.models.embeddings.trim(),
    widget,
    identitySecret: sources.identitySecret,
    identified: n('identified'),
    answered: n('answered'),
    searchOnly: n('search_only'),
    webhooksConfigured: settings.webhooks.filter((hook) => hook.active && hook.url).length,
    webhooksDelivered: n('delivered'),
    markedDone: state.done,
    dismissedAt: state.dismissedAt,
    ...(sources.contentMode ? { contentMode: sources.contentMode } : {}),
  };
}

/**
 * Markdown files one folder down in the docs folder, where articles live
 * (`<collection>/<file>.md`), skipping `_screenshots` and other hidden or
 * underscored folders the knowledge base skips too. Null when the folder is
 * not on this server's disk, which is normal on a serverless host.
 */
export async function countDocFiles(dir: string, cwd = process.cwd()): Promise<number | null> {
  const root = resolve(cwd, dir);
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  let total = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || /^[._]/.test(entry.name)) continue;
    try {
      const files = await readdir(join(root, entry.name), { withFileTypes: true });
      total += files.filter((file) => file.isFile() && /\.mdx?$/i.test(file.name)).length;
    } catch {
      // A folder that vanished between the two reads holds no articles.
    }
  }
  return total;
}

/** The same count as `countDocFiles`, in a content source. Null when it cannot be listed. */
export async function countSourceDocFiles(source: ContentSource): Promise<number | null> {
  try {
    return (await source.list()).filter((entry) => {
      const parts = entry.path.split('/');
      return parts.length === 2 && !/^[._]/.test(parts[0] ?? '') && /\.mdx?$/i.test(parts[1] ?? '');
    }).length;
  } catch {
    return null;
  }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
