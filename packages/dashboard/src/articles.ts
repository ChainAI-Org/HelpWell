/**
 * The knowledge base's routes: the list, an article with its history and a
 * restore, the editor with its image uploads (article-assets.ts), saving, the
 * live preview, and for managed content the Redirects and Import screens
 * (pages/redirects.ts, pages/import.ts).
 *
 * Its own module, registered by the server with one line for reads and one
 * for writes, because the editor is the one part of the dashboard that talks
 * to the host's repo. Saving goes through the host's `writeArticle` hook, or
 * with none, through a writable content source the host passed, and nowhere
 * else; without either, Save hands the file back with the path it belongs at.
 * Either way the article is re-indexed only after the repo has it, so the
 * index can never hold words the repo does not.
 *
 * The preview is rendered on the server, by the renderer the help centre
 * uses, and posted to as JSON from the editor as someone types.
 */

import { isHelpWellError, webhookOptionsFor } from '@helpwell/core';
import type { ModelPort } from '@helpwell/core/agent';
import { setGapStatus } from '@helpwell/core/agent';
import {
  ARTICLE_STATUSES,
  type ArticleStatus,
  articleWriter,
  collectionId,
  composeArticle,
  EMPTY_ARTICLE_MESSAGE,
  isEmptyArticleBody,
  type MediaPaths,
  newArticlePath,
  parseFrontmatter,
  rewriteMediaUrls,
  screenshotsRelativeToDocs,
} from '@helpwell/core/content';
import { type Db, rowsOf } from '@helpwell/core/db';
import {
  articleSource,
  compareArticleVersions,
  getArticleVersion,
  listArticleVersions,
  listCollections,
  restoreArticleVersion,
  saveArticle,
} from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { fillPathTemplate, html, renderMarkdown, slugPath } from '@helpwell/ui';
import { sql } from 'drizzle-orm';
import { dashboardAssetStore, uploadArticleImage } from './article-assets.js';
import { button, empty, formatDateTime, notice } from './components.js';
import { byMode, managedContent } from './content-mode.js';
import { can, type DashboardContext, renderDashboard } from './layout.js';
import { dashboardModel } from './model.js';
import { gapContext } from './pages/gap-draft.js';
import { importPost, importScreen } from './pages/import.js';
import {
  type ArticleDetailRow,
  type ArticleRow,
  articlePage,
  type EditorState,
  type EditorView,
  editorPage,
  knowledgePage,
} from './pages/knowledge.js';
import { redirectsPost, redirectsScreen } from './pages/redirects.js';
import type { DashboardConfig } from './server.js';

/** GET `/knowledge/...`. `rest` is what follows `knowledge`, decoded. */
export async function knowledgeScreen(
  config: DashboardConfig,
  context: DashboardContext,
  rest: string[],
  url: URL,
): Promise<Response> {
  if (rest.length === 0) return listScreen(config.db, context, url);
  if (rest.length === 1 && rest[0] === 'new') return newScreen(config, context, url);
  // Underscored names are never a collection, so never an article's slug.
  if (rest.length === 1 && rest[0] === '_redirects') return redirectsScreen(config, context, url);
  if (rest.length === 1 && rest[0] === '_import') return importScreen(config, context, url);

  const slug = rest.join('/');
  if (url.searchParams.has('edit')) return editScreen(config, context, slug);
  return articleScreen(config, context, slug, url);
}

/** POST `/knowledge/...`: the preview (JSON), a save, or a no-script preview. */
export async function knowledgePost(
  config: DashboardConfig,
  context: DashboardContext,
  rest: string[],
  request: Request,
): Promise<Response> {
  if (rest.length === 1 && rest[0] === '_preview') return preview(config, context, request);
  if (rest.length === 1 && rest[0] === '_upload') {
    return uploadArticleImage(config, context, request);
  }
  if (rest.length === 1 && rest[0] === '_redirects') return redirectsPost(config, context, request);
  if (rest.length === 1 && rest[0] === '_import') return importPost(config, context, request);

  const form = await request.formData();
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : '';
  };
  const isNew = rest.length === 1 && rest[0] === 'new';
  const slug = isNew ? null : rest.join('/');
  const source = slug ? await articleSource(config.db, slug) : null;
  if (slug && !source) return page(context, 'Article', notFoundBody(context), 404);
  if (slug && value('action') === 'restore') {
    return restore(config, context, slug, Number(value('version')));
  }

  const status = value('status');
  const state: EditorState = {
    slug,
    path: source?.path ?? null,
    title: value('title').trim(),
    description: value('description').trim(),
    collection: source?.collection ?? value('collection').trim(),
    status: isStatus(status) ? status : 'draft',
    // Browsers submit a textarea with CRLF line endings; the repo wants LF.
    body: value('body').replace(/\r\n/g, '\n'),
  };

  const errors: Record<string, string> = {};
  if (!state.title) errors.title = 'An article needs a title.';
  if (!isStatus(status)) errors.status = 'Pick a status from the list.';
  if (isNew && !state.collection) errors.collection = 'Pick a collection, or name a new one.';
  // Checked on Save, not on a preview: an empty draft is work in progress,
  // and a draft the AI could not write opens with nothing in it.
  if (
    value('action') !== 'preview' &&
    state.status === 'published' &&
    isEmptyArticleBody(state.body, state.title)
  ) {
    errors.body = EMPTY_ARTICLE_MESSAGE;
  }

  if (isNew && state.collection) {
    // A collection picked by its title lands in the folder that already has it.
    const collections = await writableCollections(config.db);
    const match = collections.find(
      (c) => c.id === state.collection || c.title.toLowerCase() === state.collection.toLowerCase(),
    );
    state.collection = match?.id ?? collectionId(state.collection);
    if (state.title) state.path = newArticlePath(state.collection, state.title);
  }

  const markdown = composeArticle(
    { title: state.title, description: state.description, status: state.status },
    state.body,
    source?.markdown,
  );

  // Written from a gap: it stays beside the editor, and a save marks it drafted.
  const gap = isNew ? await gapContext(config.db, value('gap')) : null;
  const render = async (extra: Partial<EditorView>, statusCode = 200) =>
    page(
      context,
      isNew ? 'New article' : `Edit ${state.title || 'article'}`,
      editorPage(
        context,
        await editorView(config, context, state, { gap, unsaved: true, ...extra }),
      ),
      statusCode,
    );

  if (Object.keys(errors).length > 0) return render({ errors }, 400);
  if (value('action') === 'preview' || !state.path) return render({});

  // No hook and no writable source: the file and its path, and nothing
  // written anywhere.
  const write = articleWriter(config.writeArticle, config.content);
  if (!write) return render({ download: { path: state.path, markdown } });

  try {
    const saved = await saveArticle(config.db, {
      path: state.path,
      markdown,
      write,
      media: mediaPaths(config, context),
      ...(await embedOnSave(config)),
      origin: 'dashboard',
      create: isNew,
      slug: slug ?? undefined,
      webhooks: webhookOptionsFor(config),
    });
    if (gap) await setGapStatus(config.db, gap.id, 'drafted', saved.slug);
    return redirect(
      `${context.basePath}/knowledge/${slugPath(saved.slug)}?saved=${saved.changed ? '1' : '0'}`,
    );
  } catch (error) {
    if (!isHelpWellError(error)) throw error;
    return render({ problem: error.publicMessage }, error.status === 409 ? 409 : 400);
  }
}

/**
 * Restore: the old version saved again as the newest, through the same hook
 * or source as any save, so history is only ever added to.
 */
async function restore(
  config: DashboardConfig,
  context: DashboardContext,
  slug: string,
  versionId: number,
): Promise<Response> {
  const back = `${context.basePath}/knowledge/${slugPath(slug)}`;
  const write = articleWriter(config.writeArticle, config.content);
  if (!write || !Number.isSafeInteger(versionId) || versionId < 1) {
    return redirect(`${back}?restored=none`);
  }
  try {
    const restored = await restoreArticleVersion(config.db, {
      slug,
      versionId,
      write,
      media: mediaPaths(config, context),
      ...(await embedOnSave(config)),
      origin: 'dashboard',
      webhooks: webhookOptionsFor(config),
    });
    return redirect(
      `${context.basePath}/knowledge/${slugPath(restored.slug)}?restored=${restored.changed ? String(restored.restoredFrom) : 'same'}`,
    );
  } catch (error) {
    if (!isHelpWellError(error)) throw error;
    // Drawn here rather than redirected, so the reason is never carried in a URL.
    return articleScreen(
      config,
      context,
      slug,
      new URL(back, 'http://dashboard.invalid'),
      notice('bad', `Nothing was restored. ${error.publicMessage}`),
      error.status === 404 ? 404 : 400,
    );
  }
}

/** What a restore did, said on the article it restored. */
async function restoredFlash(
  config: DashboardConfig,
  context: DashboardContext,
  slug: string,
  url: URL,
): Promise<ReturnType<typeof notice> | null> {
  const restored = url.searchParams.get('restored');
  if (!restored) return null;
  if (restored === 'same') {
    return notice('info', 'That version is what the article says now, so nothing changed.');
  }
  if (restored === 'none') {
    return notice('bad', 'Nothing was restored: this install cannot save articles from here.');
  }
  const id = Number(restored);
  const version = Number.isSafeInteger(id) ? await getArticleVersion(config.db, slug, id) : null;
  if (!version) return null;
  const when = formatDateTime(version.createdAt, context);
  return notice(
    'good',
    `Restored the version from ${when}. It is the newest version now, and the history keeps everything in between.`,
  );
}

/* ----------------------------------------------------------------- reads */

async function listScreen(db: Db, context: DashboardContext, url: URL): Promise<Response> {
  const q = url.searchParams.get('q')?.trim();
  const filter = q
    ? sql`(lower(title) LIKE ${`%${q.toLowerCase()}%`} OR lower(coalesce(description, '')) LIKE ${`%${q.toLowerCase()}%`})`
    : sql`TRUE`;

  const [result, collections] = await Promise.all([
    db.execute(sql`
      SELECT slug, title, description, collection, status, reading_minutes, updated_at,
             (embedding IS NOT NULL) AS embedded
      FROM helpwell.article_index
      WHERE ${filter}
      ORDER BY collection, order_index, title
    `),
    // The dashboard is already behind the host app's auth, so it sees the
    // collections a visitor would not.
    listCollections(db, { includeIdentified: true }),
  ]);

  return page(
    context,
    'Knowledge base',
    knowledgePage(
      context,
      rowsOf<ArticleRow>(result),
      { q: q ?? undefined },
      new Map(collections.map((c) => [c.id, c.title])),
    ),
    200,
    {
      subtitle: byMode(
        context,
        'Markdown in your repo, indexed for search and for the agent.',
        'Your help articles, indexed for search and for the agent.',
      ),
      actions: html`${
        // Redirects and imports are files in the repo there, made by the CLI.
        managedContent(context) && can(context, 'configure')
          ? html`${button('Redirects', { href: `${context.basePath}/knowledge/_redirects`, glyph: 'external' })}${button(
              'Import',
              { href: `${context.basePath}/knowledge/_import`, glyph: 'download' },
            )}`
          : null
      }${
        can(context, 'content')
          ? button('New article', {
              href: `${context.basePath}/knowledge/new`,
              glyph: 'plus',
              tone: 'primary',
            })
          : null
      }`,
    },
  );
}

async function articleScreen(
  config: DashboardConfig,
  context: DashboardContext,
  slug: string,
  url: URL,
  /** Shown first in place of what the URL says happened: a restore that failed. */
  problem: ReturnType<typeof notice> | null = null,
  status = 200,
): Promise<Response> {
  const result = await config.db.execute(sql`
    SELECT slug, title, description, collection, status, reading_minutes, updated_at,
           body, headings, applies_to, content_hash, path,
           (embedding IS NOT NULL) AS embedded
    FROM helpwell.article_index WHERE slug = ${slug} LIMIT 1
  `);
  const article = rowsOf<ArticleDetailRow>(result)[0];
  if (!article) return page(context, 'Article', notFoundBody(context), 404);

  const statsResult = await config.db.execute(sql`
    WITH cited AS (
      SELECT c->>'slug' AS slug, m.feedback
      FROM helpwell.messages m
      CROSS JOIN LATERAL jsonb_array_elements(m.citations) AS c
      WHERE m.role = 'agent'
    )
    SELECT count(*) AS citations,
           count(*) FILTER (WHERE feedback = 'helpful') AS helpful,
           count(*) FILTER (WHERE feedback = 'not_helpful') AS unhelpful
    FROM cited WHERE slug = ${slug}
  `);
  const row = rowsOf<{
    citations: number | string;
    helpful: number | string;
    unhelpful: number | string;
  }>(statsResult)[0];

  const versions = await listArticleVersions(config.db, slug, { limit: 30 });
  const compare = Number(url.searchParams.get('compare'));
  const comparison =
    Number.isSafeInteger(compare) && compare > 0
      ? await compareArticleVersions(config.db, slug, compare)
      : null;

  const saved = url.searchParams.get('saved');
  const flash =
    saved === '1'
      ? notice(
          'good',
          await savedMessage(config, context, Boolean(article.embedded), article.status),
        )
      : saved === '0'
        ? notice('info', 'Saved. Nothing had changed, so there is no new version.')
        : (problem ?? (await restoredFlash(config, context, slug, url)));

  return page(
    context,
    article.title,
    articlePage(
      context,
      article,
      // The real file when the index knows it; otherwise the slug, encoded per
      // segment so it cannot carry a quote or a space into the link.
      config.repoUrlTemplate
        ? fillPathTemplate(config.repoUrlTemplate, slugPath(article.path ?? `${article.slug}.md`))
        : null,
      {
        citations: Number(row?.citations ?? 0),
        helpful: Number(row?.helpful ?? 0),
        unhelpful: Number(row?.unhelpful ?? 0),
      },
      {
        bodyHtml: renderMarkdown(article.body).html,
        history: {
          versions,
          comparison,
          canRestore: Boolean(articleWriter(config.writeArticle, config.content)),
        },
        flash,
      },
    ),
    status,
    {
      subtitle: article.collection,
      actions: button('All articles', { href: `${context.basePath}/knowledge`, glyph: 'back' }),
    },
  );
}

async function newScreen(
  config: DashboardConfig,
  context: DashboardContext,
  url: URL,
): Promise<Response> {
  // A gap's Write it link arrives with its question as the title.
  const state: EditorState = {
    slug: null,
    path: null,
    title: (url.searchParams.get('title') ?? '').slice(0, 200),
    description: '',
    collection: (url.searchParams.get('collection') ?? '').slice(0, 80),
    status: 'draft',
    body: '',
  };
  const gap = await gapContext(config.db, (url.searchParams.get('gap') ?? '').slice(0, 80));
  return page(
    context,
    'New article',
    editorPage(context, await editorView(config, context, state, { gap })),
  );
}

/** The editor for a new article, filled in by someone else: a gap's draft. */
export async function editorResponse(
  config: DashboardConfig,
  context: DashboardContext,
  title: string,
  state: EditorState,
  extra: Partial<EditorView>,
  status = 200,
): Promise<Response> {
  return page(
    context,
    title,
    editorPage(context, await editorView(config, context, state, extra)),
    status,
  );
}

async function editScreen(
  config: DashboardConfig,
  context: DashboardContext,
  slug: string,
): Promise<Response> {
  const source = await articleSource(config.db, slug);
  if (!source) return page(context, 'Article', notFoundBody(context), 404);

  const { data, content } = parseFrontmatter(source.markdown);
  const status =
    typeof data.status === 'string' && isStatus(data.status) ? data.status : 'published';
  const state: EditorState = {
    slug,
    path: source.path,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    collection: source.collection,
    status,
    body: content,
  };
  const problem = source.pathKnown
    ? null
    : byMode(
        context,
        `The index does not know which file this article came from, so it would be saved as ${source.path}. Run helpwell sync once and it will.`,
        `The index does not know where this article is stored, so it would be saved as ${source.path}.`,
      );
  return page(
    context,
    `Edit ${state.title || 'article'}`,
    editorPage(context, await editorView(config, context, state, { problem })),
  );
}

/* --------------------------------------------------------------- preview */

/** The most a preview request may carry: far beyond any article. */
const MAX_PREVIEW = 256 * 1024;

async function preview(
  config: DashboardConfig,
  context: DashboardContext,
  request: Request,
): Promise<Response> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return json({ error: 'Send the Markdown as JSON.' }, 415);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_PREVIEW) {
    return json({ error: 'Too large to preview.' }, 413);
  }
  const text = await request.text();
  if (text.length > MAX_PREVIEW) return json({ error: 'Too large to preview.' }, 413);

  let body: { markdown?: unknown; path?: unknown; collection?: unknown; title?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: 'Not JSON.' }, 400);
  }
  if (typeof body.markdown !== 'string') return json({ error: 'markdown is required.' }, 400);

  const path =
    typeof body.path === 'string' && body.path
      ? body.path
      : typeof body.collection === 'string' && body.collection.trim()
        ? newArticlePath(body.collection, typeof body.title === 'string' ? body.title : 'untitled')
        : 'article/untitled.md';
  const rendered = renderMarkdown(
    rewriteMediaUrls(body.markdown, path, mediaPaths(config, context)),
  );
  return json({ html: rendered.html, headings: rendered.headings });
}

/* -------------------------------------------------------------- plumbing */

async function editorView(
  config: DashboardConfig,
  context: DashboardContext,
  state: EditorState,
  extra: Partial<EditorView>,
): Promise<EditorView> {
  const collections = await writableCollections(config.db);
  const path =
    state.path ?? (state.collection ? newArticlePath(state.collection, state.title) : null);
  return {
    state,
    collections,
    previewHtml: renderMarkdown(
      rewriteMediaUrls(state.body, path ?? 'article/untitled.md', mediaPaths(config, context)),
    ).html,
    canSave: Boolean(articleWriter(config.writeArticle, config.content)),
    canUpload: dashboardAssetStore(config) !== null,
    docsDir: config.docsDir ?? 'docs',
    ...extra,
  };
}

/**
 * The collections an article can be written into: every one the help centre
 * lists, then the ones it does not list yet because nothing in them is
 * published, such as a folder set up with only a `_meta.json`. Without
 * those, picking one by its title would make a second folder beside it.
 */
async function writableCollections(db: Db): Promise<{ id: string; title: string }[]> {
  const [listed, unlisted] = await Promise.all([
    listCollections(db, { includeIdentified: true }),
    db.execute(sql`
      SELECT id, title FROM helpwell.collection_index c
      WHERE NOT EXISTS (
        SELECT 1 FROM helpwell.article_index a WHERE a.collection = c.id AND a.status = 'published'
      )
      ORDER BY order_index, title
    `),
  ]);
  return [
    ...listed.map((c) => ({ id: c.id, title: c.title })),
    ...rowsOf<{ id: string; title: string }>(unlisted),
  ];
}

/** Image paths in an edited article point where the API serves them, as `sync` would. */
function mediaPaths(config: DashboardConfig, context: DashboardContext): MediaPaths {
  if (config.content) return { apiPath: context.apiPath, screenshots: config.content.screenshots };
  const docs = config.docsDir ?? 'docs';
  return {
    apiPath: context.apiPath,
    screenshots: config.screenshotsDir
      ? screenshotsRelativeToDocs(docs, config.screenshotsDir)
      : undefined,
  };
}

/**
 * What a save did for search, said as it happened. Read after the save, from
 * the row the save wrote: `embedded` is true when the article has a vector
 * for what it now says, computed on save (`embedOnSave`) whenever the install
 * has a model. Otherwise the article is in text search now, and the indexer
 * embeds any article still without a vector on the next sync that has one.
 */
async function savedMessage(
  config: DashboardConfig,
  context: DashboardContext,
  embedded: boolean,
  status: string,
): Promise<string> {
  if (status === 'draft')
    return 'Draft saved. It stays hidden from visitors and the agent until you publish it.';
  if (status === 'archived')
    return 'Archived article saved. It stays hidden from visitors and the agent.';
  // With no repo there is no sync to wait for: the save is what indexed it.
  const saved = byMode(context, 'Saved to the repo and re-indexed', 'Saved and indexed: live');
  if (embedded) return `${saved} for text and semantic search.`;
  const settings = await new SettingsStore(config.db).get();
  const textOnly = `${saved} for text search.`;
  if (!settings.agent.models.embeddings) return `${textOnly} Semantic search is switched off.`;
  if (dashboardModel(config, settings, 'embeddings')) {
    // A model was offered on save and gave no vector: the provider failed.
    return `${textOnly} It could not be embedded just now, so semantic search picks it up ${byMode(context, 'on the next sync', 'the next time it is indexed')}.`;
  }
  // A host's factory with no embeddings port: this install has no semantic
  // search to catch up. An install with no key at all gets one by adding it.
  if (config.modelFactory) return textOnly;
  return `${textOnly} Semantic search picks it up ${byMode(context, 'on the next helpwell sync with the model key set', 'once a model key is set and the article is indexed again')}.`;
}

/**
 * A saved article is embedded straight away whenever the install has a
 * model, its own OpenRouter key or a host's factory, so semantic search is
 * current the moment Save returns. A provider that fails leaves it indexed
 * as text and never fails the save: the file is already written. With no
 * model, it is indexed as text and the next sync with one embeds it.
 */
async function embedOnSave(
  config: DashboardConfig,
): Promise<{ model?: ModelPort; embeddingModel?: string }> {
  const settings = await new SettingsStore(config.db).get();
  const model = dashboardModel(config, settings, 'embeddings');
  return model ? { model, embeddingModel: settings.agent.models.embeddings } : {};
}

function isStatus(value: string): value is ArticleStatus {
  return (ARTICLE_STATUSES as readonly string[]).includes(value);
}

function page(
  context: DashboardContext,
  title: string,
  body: ReturnType<typeof articlePage>,
  status = 200,
  header: { subtitle?: string; actions?: ReturnType<typeof button> | null } = {},
): Response {
  return new Response(renderDashboard(context, 'knowledge', { title, ...header }, body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function notFoundBody(context: DashboardContext) {
  return empty(
    'alert',
    'That is not here',
    'It may have been deleted, or it has not been indexed yet.',
    button('All articles', { href: `${context.basePath}/knowledge`, glyph: 'back' }),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location: string): Response {
  // 303 so the browser follows with GET: a refresh must never re-submit.
  return new Response(null, { status: 303, headers: { location } });
}
