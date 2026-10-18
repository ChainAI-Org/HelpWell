/**
 * The images and videos articles reference.
 *
 * An article in the repo points at a screenshot the way any Markdown file
 * would, by a path relative to itself: `![The dashboard](../_screenshots/dashboard.png)`.
 * That path means nothing to a browser on `/help/getting-started/welcome`, and
 * less than nothing inside the widget on a customer's page. So two things
 * happen here.
 *
 * At index time, relative image paths are rewritten to the URLs the API serves
 * them at: `<api>/screenshots/<file>` for the screenshots folder, and
 * `<api>/media/<path>` for anything else inside the docs folder. The help
 * centre and the widget then render the same body and both load the image.
 *
 * At request time, those two URL spaces are answered from disk, with the path
 * checked so a request cannot walk out of the folder it names, only image and
 * video types served, and caching headers a re-captured screenshot can get
 * through. A host whose content is not on disk serves the same URLs from its
 * content source instead (`serveContentMedia`), with the same rules.
 */

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, posix, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ContentEntry, ContentSource } from './source.js';

/** Where the API is mounted when nobody says otherwise, as in the README. */
export const DEFAULT_API_PATH = '/api/helpwell';

/** The screenshots folder `helpwell init` configures, relative to the docs folder. */
export const DEFAULT_SCREENSHOTS = '_screenshots';

/** How served media URLs are built when an article is indexed. */
export interface MediaPaths {
  /** Where the API is mounted, e.g. `/api/helpwell`. Media is served under it. */
  apiPath?: string;
  /**
   * The screenshots folder relative to the docs folder, with forward slashes:
   * `_screenshots` by default, `../public/shots` for one outside the docs.
   */
  screenshots?: string;
}

/** The folders the API serves media from, relative to the working directory. */
export interface MediaDirs {
  /** The docs folder. Defaults to `docs`. */
  docs?: string;
  /** The screenshots folder. Defaults to `docs/_screenshots`. */
  screenshots?: string;
}

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
};

/** The Content-Type for a media file, or null when it is not one HelpWell serves. */
export function mediaType(path: string): string | null {
  return TYPES[extname(path).toLowerCase()] ?? null;
}

/* --------------------------------------------------------------- rewrite */

const IMAGE = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
const FENCE = /^ {0,3}```/;

/**
 * Rewrite the relative image and video paths in one article's body to the
 * URLs they are served at.
 *
 * `articlePath` is the file relative to the docs folder (`billing/invoices.md`),
 * which is what a relative path is resolved against. Absolute URLs, root paths
 * and anything inside code are left exactly as written, and so is a path that
 * leads out of both the docs folder and the screenshots folder: there is no
 * URL for it, and a broken image is better than an invented one.
 */
export function rewriteMediaUrls(
  markdown: string,
  articlePath: string,
  paths: MediaPaths = {},
): string {
  return mapImageUrls(markdown, (url) => servedMediaUrl(url, articlePath, paths));
}

/**
 * The URL one image path relative to an article is served at, by the rules
 * above, or null when it is not such a path or has no URL.
 */
export function servedMediaUrl(
  url: string,
  articlePath: string,
  paths: MediaPaths = {},
): string | null {
  const api = trimSlashes(paths.apiPath ?? DEFAULT_API_PATH);
  const shots = posix.normalize(paths.screenshots ?? DEFAULT_SCREENSHOTS).replace(/\/+$/, '');
  const from = posix.dirname(articlePath.replace(/\\/g, '/'));
  return servedUrl(url, from, shots, api);
}

/**
 * Every image and video URL in a Markdown body (`![alt](url)`), through
 * `map`, which answers the URL to write instead or null to leave it. Code,
 * fenced or in a span, stays exactly as written.
 */
export function mapImageUrls(markdown: string, map: (url: string) => string | null): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // Code spans stay literal: only the text between them is rewritten.
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(IMAGE, (whole, alt: string, url: string) => {
                const mapped = map(url);
                return mapped ? `![${alt}](${mapped})` : whole;
              }),
        )
        .join('');
    })
    .join('\n');
}

function servedUrl(url: string, from: string, shots: string, api: string): string | null {
  // Only a path relative to the article: no scheme, not rooted, not a fragment.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^[/\\#?]/.test(url)) return null;
  const cut = url.search(/[?#]/);
  const pathPart = cut === -1 ? url : url.slice(0, cut);
  const suffix = cut === -1 ? '' : url.slice(cut);

  let decoded: string;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    return null;
  }
  if (!mediaType(decoded)) return null;

  const resolved = posix.normalize(posix.join(from, decoded));
  if (shots !== '.' && resolved.startsWith(`${shots}/`)) {
    return `${api}/screenshots/${encodePath(resolved.slice(shots.length + 1))}${suffix}`;
  }
  if (resolved === '..' || resolved.startsWith('../')) return null;
  return `${api}/media/${encodePath(resolved)}${suffix}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function trimSlashes(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/* ----------------------------------------------------------------- serve */

/**
 * The file `relPath` names inside `root`, or null.
 *
 * `relPath` is the decoded remainder of a URL. Every segment must be a plain
 * name: no `..`, no `.`, no empty segment, no backslash or drive colon, and
 * nothing hidden. The resolved path must still sit under `root`, and so must
 * the path a symlink points at, which `serveMedia` checks against the disk.
 */
export function resolveMediaPath(root: string, relPath: string): string | null {
  if (!plainMediaPath(relPath)) return null;
  const base = resolve(root);
  const full = resolve(base, ...relPath.split('/'));
  return inside(base, full) ? full : null;
}

/** Every segment a plain name, and a type HelpWell serves: the rule for both kinds of root. */
function plainMediaPath(relPath: string): boolean {
  if (!relPath || relPath.length > 1024) return false;
  const plain = relPath
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        !segment.startsWith('.') &&
        !/[\\:\0]/.test(segment) &&
        segment.trim() === segment,
    );
  return plain && mediaType(relPath) !== null;
}

function inside(base: string, full: string): boolean {
  const rel = relative(base, full);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Answer a request for a media file from `root`.
 *
 * GET and HEAD, with an ETag so a browser revalidates instead of downloading
 * again, a short cache so a re-captured screenshot shows up within minutes,
 * and byte ranges, without which Safari will not play a video at all. Files
 * are streamed, never read whole into memory.
 *
 * Served with `nosniff` and a sandboxing CSP: an SVG is an image here, and a
 * browser opening one directly must not run whatever script it carries.
 */
export async function serveMedia(
  root: string | null | undefined,
  relPath: string,
  request: Request,
): Promise<Response> {
  if (!root) return missing();
  const full = resolveMediaPath(root, relPath);
  if (!full) return missing();

  let size: number;
  let modified: Date;
  try {
    // Symlinks are followed only when they stay inside the folder.
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(full)]);
    if (!inside(realRoot, realFile)) return missing();
    const info = await stat(realFile);
    if (!info.isFile()) return missing();
    size = info.size;
    modified = info.mtime;
  } catch {
    return missing();
  }

  // Node's web stream type and the DOM's are the same object with two names.
  return mediaResponse(request, full, size, modified, (start, end) =>
    Promise.resolve(Readable.toWeb(createReadStream(full, { start, end })) as unknown as BodyInit),
  );
}

/**
 * Answer a request for a media file from a content source (source.ts): the
 * same checks, headers and byte ranges as `serveMedia`, for content that is
 * not on this server's disk. `relPath` is the decoded remainder of the URL,
 * a path inside the source; screenshots are under `_screenshots/`.
 *
 * A source with `stream` is asked for just the bytes the response sends, so
 * a video is never held in memory whole. One without it is read whole and
 * sliced, and a file that changed size since the stat is refused rather than
 * sent with the wrong length.
 */
export async function serveContentMedia(
  source: ContentSource | null | undefined,
  relPath: string,
  request: Request,
): Promise<Response> {
  if (!source || !plainMediaPath(relPath)) return missing();
  let found: ContentEntry | null;
  try {
    found = await source.stat(relPath);
  } catch {
    return missing();
  }
  if (!found) return missing();
  const info = found;

  return mediaResponse(request, relPath, info.size, info.modifiedAt, async (start, end) => {
    if (source.stream) {
      const stream = await source.stream(relPath, { start, end });
      if (!stream) throw new Error('gone');
      return stream;
    }
    const bytes = await source.read(relPath);
    // Replaced between the stat and the read: the length already sent is wrong.
    if (!bytes || bytes.length !== info.size) throw new Error('changed');
    return bytes.slice(start, end + 1);
  });
}

/** The headers, the 304, the 416 and the range: everything but where the bytes come from. */
async function mediaResponse(
  request: Request,
  name: string,
  size: number,
  modified: Date,
  body: (start: number, end: number) => Promise<BodyInit>,
): Promise<Response> {
  const etag = `W/"${size.toString(16)}-${Math.floor(modified.getTime()).toString(16)}"`;
  const headers = new Headers({
    'content-type': mediaType(name) ?? 'application/octet-stream',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    etag,
    'last-modified': modified.toUTCString(),
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    // A help centre on its own domain embeds these too.
    'cross-origin-resource-policy': 'cross-origin',
  });

  if (matches(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }

  const range = byteRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers.set('content-length', String(size === 0 ? 0 : end - start + 1));
  if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);
  const status = range ? 206 : 200;

  if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers });
  try {
    return new Response(await body(start, end), { status, headers });
  } catch {
    // Gone between the stat and the read.
    return missing();
  }
}

function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
}

/** One `bytes=` range, clamped to the file. Several ranges get the whole file. */
function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    // `bytes=-500`: the last 500 bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

function missing(): Response {
  return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No such file' } }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * The folders to serve from, resolved against the working directory. `false`
 * serves nothing; anything unset takes the layout `helpwell init` writes.
 */
export function resolveMediaDirs(
  dirs: MediaDirs | false | undefined,
  cwd = process.cwd(),
): { docs: string | null; screenshots: string | null } {
  if (dirs === false) return { docs: null, screenshots: null };
  const docs = resolve(cwd, dirs?.docs ?? 'docs');
  const screenshots = dirs?.screenshots
    ? resolve(cwd, dirs.screenshots)
    : resolve(docs, DEFAULT_SCREENSHOTS);
  return { docs, screenshots };
}

/**
 * The screenshots folder relative to the docs folder, as `MediaPaths` wants
 * it: the same answer whichever of the two a config file moved.
 */
export function screenshotsRelativeToDocs(docsDir: string, screenshotsDir: string): string {
  const rel = relative(resolve(docsDir), resolve(screenshotsDir)).split('\\').join('/');
  return rel || '.';
}
