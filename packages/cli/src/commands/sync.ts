/**
 * `helpwell sync` — read the docs out of the repo and index them.
 *
 * The repo is the source of truth, so this is the only way content reaches the
 * database. It is safe to run on every deploy: articles are matched by content
 * hash, so an unchanged file costs nothing and does not burn an embedding
 * (KB-01, KB-06).
 *
 * Settings are pushed too, but only when the file is the newer copy. The
 * dashboard saves settings the moment they change, and a sync that always
 * pushed the file reverted every one of those edits on the next deploy.
 *
 * When the project is connected to a remote support extension, what the
 * index now holds is sent to it straight away (content-push.ts), rather than
 * waiting for the server to notice. That never fails the sync.
 */

import { OpenRouterModel } from '@helpwell/core/agent';
import { readKnowledgeBase } from '@helpwell/core/content';
import { indexKnowledgeBase } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { type ContentPushOptions, pushContentToSupport } from '../content-push.js';
import { loadProject, mediaPathsFor, openDb, redactUrl } from '../project.js';
import { traced } from '../traced.js';
import { detail, heading, ok, progress, say, table, warn } from '../ui.js';
import { compareSettings } from './settings.js';

export interface SyncOptions {
  cwd: string;
  /** Override the database, for a one-off sync against staging. */
  url?: string;
  /** Skip embeddings even when a key is present. */
  noEmbeddings?: boolean;
  /** Re-embed everything, not just what changed. */
  force?: boolean;
  /**
   * What to do with the config file's settings. Left unset (the default), the
   * file is pushed only when it is newer than the database, so a dashboard
   * edit survives the next deploy. `force` pushes whatever is newer; `false`
   * leaves settings alone.
   */
  settings?: boolean | 'force';
  /** The environment and fetch the remote support extension is reached with; for tests. */
  support?: ContentPushOptions;
}

export interface SyncResult {
  articles: number;
  collections: number;
  /**
   * Collections taken out of the index because their folder is gone, or no
   * longer has a `_meta.json` or an article (a folder of images, say). Only
   * the index row goes; sync never deletes a file.
   */
  collectionsRemoved: number;
  /** Articles whose content changed since the last run. */
  indexed: number;
  unchanged: number;
  removed: number;
  embedded: number;
  /**
   * What happened to embeddings: `done`, `off` when no embeddings model is
   * configured, `no-key` without OPENROUTER_API_KEY, `skipped` on
   * --no-embeddings (or with nothing to index), `failed` when the provider
   * errored and the index fell back to text.
   */
  embeddings: 'done' | 'off' | 'no-key' | 'skipped' | 'failed';
  /** What happened to settings. */
  settings: 'pushed' | 'same' | 'kept' | 'skipped';
  /**
   * Whether the remote support extension was sent the new content: `sent`,
   * `not-linked` when there is none, `no-token` when `helpwell link` saved one
   * but HELPWELL_SUPPORT_TOKEN is not set here, `failed` when it did not land
   * (the server sends it again by itself), `skipped` with nothing indexed.
   */
  support: 'sent' | 'not-linked' | 'no-token' | 'failed' | 'skipped';
}

export async function sync(options: SyncOptions): Promise<SyncResult> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });

  try {
    heading('Indexing your docs');
    detail(`from ${project.paths.docsDir}`);
    detail(`into ${redactUrl(handle.url)}`);

    // Relative image paths become the URLs the API serves them at.
    const knowledgeBase = readKnowledgeBase(project.paths.docsDir, {
      media: mediaPathsFor(project),
    });
    if (knowledgeBase.articles.length === 0) {
      warn('No articles found.');
      detail('Add Markdown files under the docs folder, or run `helpwell docs generate`.');
      return {
        articles: 0,
        collections: 0,
        collectionsRemoved: 0,
        indexed: 0,
        unchanged: 0,
        removed: 0,
        embedded: 0,
        embeddings: 'skipped',
        settings: 'skipped',
        support: 'skipped',
      };
    }

    const apiKey = process.env.OPENROUTER_API_KEY ?? '';
    // An empty embeddings model switches the semantic pass off on purpose:
    // core indexes text only and reports nothing embedded. No model is built
    // for it, and the summary says "off" rather than showing a bare zero.
    const embeddingModel = project.config.settings.agent.models.embeddings;
    const embeddingsOff = !embeddingModel;
    const wantsEmbeddings = Boolean(apiKey) && !options.noEmbeddings && !embeddingsOff;

    const bar = progress('indexing');
    const indexOptions = {
      force: options.force,
      embeddingModel,
      onProgress: (done: number, total: number) => bar.update(`${done}/${total}`),
    };

    // The same indexing a host runs with `syncContent`: a bad key or a
    // provider outage leaves a text-only index rather than no index, and the
    // folders are rewritten as collections every time.
    const result = await indexKnowledgeBase(handle.db, knowledgeBase, {
      ...indexOptions,
      model: wantsEmbeddings
        ? traced(new OpenRouterModel({ apiKey, appName: project.config.settings.product.name }))
        : undefined,
    });
    const embeddingError = result.embeddingError;

    bar.done(`Indexed ${knowledgeBase.articles.length} articles`);

    if (embeddingError) {
      warn('Embeddings failed, so the index is text-only.');
      detail(embeddingError);
    }

    let settingsOutcome: SyncResult['settings'] = 'skipped';
    if (options.settings !== false) {
      const store = new SettingsStore(handle.db);
      const comparison = await compareSettings(project, handle.db, store);
      if (comparison.newer === 'same') {
        settingsOutcome = 'same';
        detail('Settings already match helpwell.config.json');
      } else if (options.settings === 'force' || comparison.newer === 'file') {
        await store.replace(project.config.settings);
        settingsOutcome = 'pushed';
        ok('Pushed settings from helpwell.config.json');
      } else {
        settingsOutcome = 'kept';
        warn(
          'The dashboard has settings newer than helpwell.config.json, so they were left alone.',
        );
        detail(
          'Run `helpwell settings pull` to write them into the file, or `helpwell sync --settings` to overwrite them.',
        );
      }
    }

    // The index is written; now the support extension hears about it.
    const pushed = await pushContentToSupport(project, handle.db, options.support);
    if (pushed.status === 'sent') {
      ok('Sent the published content to the remote support extension');
    } else if (pushed.status === 'no-token') {
      warn(
        'This project is linked to a remote support extension, but HELPWELL_SUPPORT_TOKEN is not set here, so the content was not sent.',
      );
      detail('The server sends it by itself within a minute of its next request.');
    } else if (pushed.status === 'failed') {
      warn(
        'The remote support extension did not take the content. The index is written either way.',
      );
      detail(pushed.reason);
      detail('The server sends it again by itself within a minute of its next request.');
    }

    say();
    table([
      ['Collections', String(knowledgeBase.collections.length)],
      ['Articles', String(knowledgeBase.articles.length)],
      ['Changed', String(result.indexed)],
      ['Unchanged', String(result.unchanged)],
      ['Removed', String(result.removed)],
      [
        'Embedded',
        embeddingError
          ? 'failed, text-only'
          : embeddingsOff
            ? 'off (no embeddings model configured)'
            : options.noEmbeddings
              ? 'skipped (--no-embeddings)'
              : wantsEmbeddings
                ? String(result.embedded)
                : 'skipped (no OPENROUTER_API_KEY)',
      ],
    ]);

    if (result.collectionsRemoved > 0) {
      say();
      detail(
        `${result.collectionsRemoved === 1 ? '1 folder is' : `${result.collectionsRemoved} folders are`} no longer a collection: a folder needs a _meta.json or an article to be one. Only the index changed; no file was touched.`,
      );
    }

    if (embeddingsOff) {
      say();
      detail(
        'Embeddings are off: agent.models.embeddings is empty in helpwell.config.json. Full-text search still works.',
      );
    } else if (!wantsEmbeddings && !embeddingError) {
      say();
      detail('Full-text search works without embeddings. Semantic search needs a key.');
    }
    say();

    const embeddings: SyncResult['embeddings'] = embeddingError
      ? 'failed'
      : embeddingsOff
        ? 'off'
        : options.noEmbeddings
          ? 'skipped'
          : apiKey
            ? 'done'
            : 'no-key';

    return {
      articles: knowledgeBase.articles.length,
      collections: knowledgeBase.collections.length,
      collectionsRemoved: result.collectionsRemoved,
      indexed: result.indexed,
      unchanged: result.unchanged,
      removed: result.removed,
      embedded: result.embedded,
      embeddings,
      settings: settingsOutcome,
      support: pushed.status,
    };
  } finally {
    await handle.close();
  }
}
