/**
 * Writing an import plan: one implementation for the CLI and the dashboard.
 *
 * The rules live here: one folder per collection with a `_meta.json`, one
 * Markdown file per article with a small front matter, a redirect map from
 * the old URLs (MG-03), and the images each article shows brought along so
 * the old platform can be switched off. Existing files are left alone unless
 * the caller forces it, which makes an import safe to run twice.
 *
 * Where it all goes is the `ImportTarget`'s business. The CLI's writes into
 * the docs folder, keeps images under `_images/`, and merges the redirects
 * into `helpwell/redirects.json`; `contentImportTarget` writes through a
 * content source, keeps images through the install's asset store, and merges
 * the redirects into the source's own map, for an install with no repo.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, posix, resolve } from 'node:path';
import { slugify } from '../content/articles.js';
import { type AssetStore, storeAsset } from '../content/assets.js';
import { stringifyFrontmatter } from '../content/frontmatter.js';
import {
  mergeRedirects,
  type RedirectRule,
  readContentRedirects,
  writeContentRedirects,
} from '../content/redirects.js';
import type { ContentSource } from '../content/source.js';
import type { ImportPlan } from './plan.js';

/** Where an import is written. Paths are relative to the docs root: `billing/refunds.md`. */
export interface ImportTarget {
  /** Whether a file is already there. */
  exists(path: string): Promise<boolean>;
  /** Write an article or a `_meta.json`. */
  write(path: string, text: string): Promise<void>;
  /**
   * Keep one of an article's images, and answer with how the article
   * references it; null leaves the original link and counts it as failed.
   */
  image(image: ImportImage): Promise<string | null>;
  /** Fold the new old-URL rules into the redirect map. */
  redirects(rules: RedirectRule[]): Promise<void>;
  /** How a written file is named in the result. Defaults to its path. */
  shown?(path: string): string;
}

/** One image an article brings with it. */
export interface ImportImage {
  bytes: Uint8Array;
  /** From the response or the file name: `.png`, `.jpg`… possibly empty. */
  ext: string;
  collectionId: string;
  /** The article's file name, without `.md`. */
  articleName: string;
  /** 1 for the article's first image, 2 for its second… */
  index: number;
}

export interface WriteImportOptions {
  /** Where the help centre is mounted, for the redirect targets. Default /help. */
  helpPath?: string;
  /** Replace files that already exist. */
  force?: boolean;
  /** Write every article as a draft, whatever the source said. */
  draft?: boolean;
  /** Download remote images. Default true. */
  downloadImages?: boolean;
  dryRun?: boolean;
  /** How remote images are downloaded. */
  fetch?: typeof fetch;
  /** Called as each article is written, for a progress bar. */
  onProgress?: (progress: { done: number; total: number; title: string }) => void;
}

export interface ImportWriteResult {
  written: string[];
  skipped: { path: string; reason: string }[];
  collections: string[];
  redirects: number;
  images: { saved: number; failed: number };
}

/** The most one imported image may be. */
export const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;

/** The largest article an import writes. Anything bigger is not a help article. */
export const MAX_IMPORT_ARTICLE_BYTES = 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

/** Write every article in `plan` to `target`. */
export async function writeImportPlan(
  plan: ImportPlan,
  target: ImportTarget,
  options: WriteImportOptions = {},
): Promise<ImportWriteResult> {
  const result: ImportWriteResult = {
    written: [],
    skipped: [],
    collections: [],
    redirects: 0,
    images: { saved: 0, failed: 0 },
  };
  const shown = (path: string) => target.shown?.(path) ?? path;
  const taken = new Set<string>();
  const redirects: RedirectRule[] = [];
  const helpPath = (options.helpPath ?? '/help').replace(/\/+$/, '');
  const collections = new Map<string, ImportPlan['articles'][number]['collection']>();
  const total = plan.articles.length;
  let done = 0;

  for (const article of plan.articles) {
    const collectionId =
      slugify(article.collection.id ?? '') || slugify(article.collection.title) || 'general';
    if (!collections.has(collectionId)) collections.set(collectionId, article.collection);

    const base = slugify(article.slug ?? '') || slugify(article.title) || 'untitled';
    let name = base;
    for (let n = 2; taken.has(`${collectionId}/${name}`); n++) name = `${base}-${n}`;
    taken.add(`${collectionId}/${name}`);

    const path = `${collectionId}/${name}.md`;
    options.onProgress?.({ done: done++, total, title: article.title });
    if ((await target.exists(path)) && !options.force) {
      result.skipped.push({ path: shown(path), reason: 'already exists; --force replaces it' });
      continue;
    }

    let body = article.body.trim();
    // A body that opens with the title as a heading would show it twice.
    const heading = /^#\s+(.+)\n*/.exec(body);
    if (heading && heading[1]!.trim().toLowerCase() === article.title.trim().toLowerCase()) {
      body = body.slice(heading[0].length).trim();
    }
    body = await localiseImages(body, plan, article.assetDir ?? null, {
      target,
      collectionId,
      articleName: name,
      download: options.downloadImages !== false && !options.dryRun,
      copy: !options.dryRun,
      fetch: options.fetch ?? fetch,
      images: result.images,
    });

    const frontmatter: Record<string, string | number> = { title: article.title };
    if (article.description) frontmatter.description = article.description;
    frontmatter.status = options.draft ? 'draft' : (article.status ?? 'published');
    if (typeof article.order === 'number') frontmatter.order = article.order;
    if (article.sourceUrl) frontmatter.importedFrom = article.sourceUrl;

    const markdown = stringifyFrontmatter(frontmatter, body);
    if (new TextEncoder().encode(markdown).length > MAX_IMPORT_ARTICLE_BYTES) {
      result.skipped.push({ path: shown(path), reason: 'too large to be a help article' });
      continue;
    }
    if (!options.dryRun) await target.write(path, markdown);
    result.written.push(shown(path));
    if (article.sourceUrl) {
      redirects.push({ from: article.sourceUrl, to: `${helpPath}/${collectionId}/${name}` });
    }
  }

  for (const [id, collection] of collections) {
    result.collections.push(id);
    const meta = `${id}/_meta.json`;
    if (options.dryRun || (await target.exists(meta))) continue;
    const body: Record<string, unknown> = { title: collection.title };
    if (collection.description) body.description = collection.description;
    if (typeof collection.order === 'number') body.order = collection.order;
    await target.write(meta, `${JSON.stringify(body, null, 2)}\n`);
  }

  if (redirects.length > 0) {
    result.redirects = redirects.length;
    if (!options.dryRun) await target.redirects(redirects);
  }
  return result;
}

/**
 * Bring an article's images with it: remote ones are downloaded, relative
 * ones read from the folder the article came from, and each is handed to
 * the target, whose answer replaces the link. An image that cannot be
 * fetched, read or kept keeps its original link and is counted as failed.
 */
async function localiseImages(
  body: string,
  plan: ImportPlan,
  assetDir: string | null,
  options: {
    target: ImportTarget;
    collectionId: string;
    articleName: string;
    download: boolean;
    /** Whether files are written: false for a dry run, which only counts. */
    copy: boolean;
    fetch: typeof fetch;
    images: { saved: number; failed: number };
  },
): Promise<string> {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
  const matches = [...body.matchAll(pattern)];
  let out = body;
  let n = 0;
  for (const match of matches) {
    const [whole, alt, src, title] = match;
    const url = src!.replace(/^<|>$/g, '');
    let bytes: Uint8Array | null = null;
    let ext = extname(url.split(/[?#]/)[0] ?? '').toLowerCase();

    if (/^https?:\/\//i.test(url)) {
      if (!options.download) continue;
      let fetched: { bytes: Uint8Array; type: string } | null = null;
      try {
        fetched = await download(options.fetch, url);
      } catch {
        fetched = null;
      }
      if (!fetched) {
        options.images.failed++;
        continue;
      }
      bytes = fetched.bytes;
      const sniffed = sniffType(bytes);
      ext =
        IMAGE_TYPES[fetched.type] ??
        (sniffed ? IMAGE_TYPES[sniffed] : undefined) ??
        (ext || '.img');
    } else if (assetDir !== null && !url.startsWith('/') && !/^[a-z]+:/i.test(url)) {
      let decoded = url;
      try {
        decoded = decodeURIComponent(url);
      } catch {
        // keep it as written
      }
      const found = readLocal(plan, assetDir, decoded);
      if (found === null) {
        options.images.failed++;
        continue;
      }
      if (!options.copy) continue;
      bytes = found;
    } else {
      continue;
    }

    // Only reached when files are being written: a dry run stops short of here.
    n++;
    let reference: string | null;
    try {
      reference = await options.target.image({
        bytes,
        ext,
        collectionId: options.collectionId,
        articleName: options.articleName,
        index: n,
      });
    } catch {
      reference = null;
    }
    if (reference === null) {
      options.images.failed++;
      continue;
    }
    options.images.saved++;
    out = out.replace(whole!, `![${alt}](${reference}${title ?? ''})`);
  }
  return out;
}

/** An image's bytes from the folder the article was read from, or null. */
function readLocal(plan: ImportPlan, assetDir: string, url: string): Uint8Array | null {
  if (plan.files) {
    return plan.files.read(posix.join(assetDir, url.replace(/\\/g, '/')));
  }
  // A plan built by hand, with no files: its folders are on disk.
  const from = isAbsolute(url) ? url : resolve(assetDir, url);
  if (!existsSync(from)) return null;
  try {
    return new Uint8Array(readFileSync(from));
  } catch {
    return null;
  }
}

/** A remote image's bytes and type, or null when it is not an image or is too large. */
async function download(
  doFetch: typeof fetch,
  url: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await doFetch(url, { redirect: 'follow', signal: controller.signal });
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const length = Number(response.headers.get('content-length') ?? 0);
    if (!response.ok || !type.startsWith('image/') || length > MAX_IMPORT_IMAGE_BYTES) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > MAX_IMPORT_IMAGE_BYTES ? null : { bytes: buffer, type };
  } finally {
    clearTimeout(timer);
  }
}

/** What an image is by its first bytes, to name its file by. */
function sniffType(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  const ascii = (from: number, length: number) =>
    String.fromCharCode(...bytes.slice(from, from + length));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (/<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 512)))) return 'image/svg+xml';
  return null;
}

/* ----------------------------------------------------------- content target */

export interface ContentImportTargetOptions {
  /** Where the articles and `_meta.json` files go. Must be writable. */
  content: ContentSource;
  /** Where the images go: null leaves every image at its original address. */
  assets: AssetStore | null;
}

/**
 * An import written for an install with no repo: articles and folders
 * through its content source, images through its asset store (PNG, JPEG,
 * GIF and WebP; anything else keeps its original link), and the old URLs
 * merged into the source's own redirect map, which its help centre serves.
 */
export function contentImportTarget(options: ContentImportTargetOptions): ImportTarget {
  const { content, assets } = options;
  const write = content.write;
  if (!write) throw new Error('An import needs a writable content source.');
  return {
    async exists(path) {
      return (await content.stat(path)) !== null;
    },
    async write(path, text) {
      await write.call(content, path, text);
    },
    async image(image) {
      if (!assets) return null;
      try {
        return (await storeAsset(assets, image.bytes)).reference;
      } catch {
        return null;
      }
    },
    async redirects(rules) {
      await writeContentRedirects(
        content,
        mergeRedirects(await readContentRedirects(content), rules),
      );
    },
  };
}
