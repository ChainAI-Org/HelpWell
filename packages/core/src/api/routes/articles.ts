/**
 * Admin routes for editing articles, reading their history, restoring an old
 * version, and uploading the images an article shows.
 *
 * Its own module rather than more of `admin.ts`, and registered by the
 * handler, because these need to know where the API is mounted: an article
 * saved here is re-indexed with its image paths pointing at this API's media
 * URLs, the same ones `helpwell sync` would have written, and embedded with
 * the install's model when it has one.
 *
 * Every route calls requireAdmin first, which also refuses writes from
 * another site.
 */

import {
  type AssetStore,
  assetMarkdown,
  fileAssetStore,
  MAX_ASSET_BYTES,
  resolveAssetStore,
  storeAsset,
} from '../../content/assets.js';
import type { MediaDirs, MediaPaths } from '../../content/media.js';
import { resolveMediaDirs, screenshotsRelativeToDocs } from '../../content/media.js';
import { articleWriter, type ContentSource } from '../../content/source.js';
import { HelpWellError } from '../../errors.js';
import {
  articleSource,
  compareArticleVersions,
  getArticleVersion,
  listArticleVersions,
  restoreArticleVersion,
  saveArticle,
} from '../../repos/article-history.js';
import { webhookOptionsFor } from '../../webhook-guard.js';
import type { RequestContext, ResolvedHelpWellConfig } from '../context.js';
import { requireAdmin } from '../context.js';
import { intParam, json, type Router, readJson } from '../router.js';

export interface ArticleRoutesOptions {
  /** Where the API is mounted, normalised: `/api/helpwell`, or `` at the root. */
  basePath: string;
  media?: MediaDirs | false;
  /** The host's content source: where screenshots are, and where a save goes without a hook. */
  content?: ContentSource;
}

export function articleRoutes(
  router: Router<RequestContext>,
  options: ArticleRoutesOptions,
): Router<RequestContext> {
  const dirs = resolveMediaDirs(options.media);
  const media: MediaPaths = {
    apiPath: options.basePath,
    screenshots: options.content
      ? options.content.screenshots
      : dirs.docs && dirs.screenshots
        ? screenshotsRelativeToDocs(dirs.docs, dirs.screenshots)
        : undefined,
  };

  /**
   * Save an article through the host's `writeArticle` hook, or its writable
   * content source when it has no hook, then re-index it.
   */
  router.post('/admin/articles', async ({ context }) => {
    requireAdmin(context);
    const body = await readJson<{
      path?: unknown;
      markdown?: unknown;
      create?: unknown;
      slug?: unknown;
    }>(context.request);
    if (typeof body.path !== 'string' || typeof body.markdown !== 'string') {
      throw new HelpWellError('bad_request', 'path and markdown are required strings');
    }
    const result = await saveArticle(context.db, {
      path: body.path,
      markdown: body.markdown,
      write: articleWriter(context.config.writeArticle, options.content),
      media,
      // Embedded straight away whenever this install has a model, its own
      // key or a host's factory, so semantic search has the article as saved.
      // A provider that fails leaves it indexed as text, and the save still
      // succeeds; the next sync with a model embeds it (the indexer embeds
      // any article still without a vector). `embedded` says which happened.
      model: context.model('embeddings') ?? undefined,
      embeddingModel: context.settings.agent.models.embeddings,
      origin: 'api',
      create: body.create === true,
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      webhooks: webhookOptionsFor(context.config),
    });
    return json(result, { status: body.create === true ? 201 : 200 });
  });

  /**
   * Bring back what one version said, as a new version: history is never
   * rewritten. Written through the same hook or source as any save.
   */
  router.post('/admin/articles/*slug/versions/:id/restore', async ({ params, context }) => {
    requireAdmin(context);
    const result = await restoreArticleVersion(context.db, {
      slug: params.slug!,
      versionId: versionId(params.id),
      write: articleWriter(context.config.writeArticle, options.content),
      media,
      model: context.model('embeddings') ?? undefined,
      embeddingModel: context.settings.agent.models.embeddings,
      origin: 'api',
      webhooks: webhookOptionsFor(context.config),
    });
    return json(result);
  });

  /**
   * An image for an article, as the raw bytes of the file: PNG, JPEG, GIF or
   * WebP, read from the bytes, up to 10 MB. Kept through the install's asset
   * store, and answered with how an article shows it: `reference` to use in
   * its Markdown, `markdown` ready to paste, and `src` for a browser now.
   * `X-HelpWell-Filename` names it, for the alt text.
   */
  router.post('/admin/assets', async ({ context }) => {
    requireAdmin(context);
    const store = assetStoreFor(context.config);
    if (!store) {
      throw new HelpWellError('not_configured', 'No asset store', {
        publicMessage:
          'This install cannot keep uploaded images. Reference an image by its https:// address instead.',
      });
    }
    const bytes = await readCapped(context.request, MAX_ASSET_BYTES);
    const record = await storeAsset(store, bytes);
    const name = context.request.headers.get('x-helpwell-filename') ?? '';
    return json(
      {
        ...record,
        markdown: assetMarkdown(record, safeName(name)),
        src: record.url ?? `${options.basePath}/media/${record.path}`,
      },
      { status: 201 },
    );
  });

  /** The file as written, for an editor: not the body the index searches. */
  router.get('/admin/articles/*slug/source', async ({ params, context }) => {
    requireAdmin(context);
    const source = await articleSource(context.db, params.slug!);
    if (!source) throw new HelpWellError('not_found', 'No such article');
    return json(source);
  });

  router.get('/admin/articles/*slug/versions', async ({ params, query, context }) => {
    requireAdmin(context);
    return json({
      items: await listArticleVersions(context.db, params.slug!, {
        limit: intParam(query, 'limit', { default: 50, max: 200 }),
      }),
    });
  });

  router.get('/admin/articles/*slug/versions/:id', async ({ params, context }) => {
    requireAdmin(context);
    const version = await getArticleVersion(context.db, params.slug!, versionId(params.id));
    if (!version) throw new HelpWellError('not_found', 'No such version');
    return json(version);
  });

  /** `?to=<id>`, and optionally `&from=<id>`; without `from`, the version before `to`. */
  router.get('/admin/articles/*slug/diff', async ({ params, query, context }) => {
    requireAdmin(context);
    const to = versionId(query.get('to'));
    const from = query.get('from');
    const comparison = await compareArticleVersions(
      context.db,
      params.slug!,
      to,
      from === null ? null : versionId(from),
    );
    if (!comparison) throw new HelpWellError('not_found', 'No such version');
    return json(comparison);
  });

  return router;
}

/**
 * Where this install's uploads go: its own store, or none when it said
 * `false`; otherwise its writable content source; otherwise, when it can
 * save articles at all, the docs folder it serves media from.
 */
function assetStoreFor(config: ResolvedHelpWellConfig): AssetStore | null {
  if (config.assetStore !== undefined || config.content) {
    return resolveAssetStore({ assetStore: config.assetStore, content: config.content });
  }
  const docs = resolveMediaDirs(config.media).docs;
  return config.writeArticle && docs ? fileAssetStore({ docs }) : null;
}

/** A file name as alt text: its last segment, without control characters. */
function safeName(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // keep it as sent
  }
  return [...(decoded.split(/[/]/).pop() ?? '')]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .slice(0, 120);
}

/** The body, refused as soon as it passes `limit` rather than after reading it all. */
async function readCapped(request: Request, limit: number): Promise<Uint8Array> {
  const tooLarge = () =>
    new HelpWellError('bad_request', 'Asset refused: too_large', {
      publicMessage: `That image is over ${Math.round(limit / (1024 * 1024))} MB. Save it smaller and try again.`,
      details: { reason: 'too_large' },
    });
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw tooLarge();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function versionId(value: string | null | undefined): number {
  const id = Number(value);
  if (!value || !Number.isSafeInteger(id) || id < 1) {
    throw new HelpWellError('bad_request', 'A version id is a positive whole number');
  }
  return id;
}
