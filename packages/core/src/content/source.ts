/**
 * Where the knowledge base's files live.
 *
 * On a self-hosted install that is the repo: the docs folder and the
 * screenshots folder, read straight off disk. That is still the default, and
 * nothing about it changes when no source is configured. A host running many
 * installs in one process has no repo per install; it keeps each install's
 * files wherever it keeps files, and hands HelpWell a `ContentSource` over
 * them. Then everything that reads or writes content goes through this one
 * small interface: `syncContent`, the editor's save when there is no
 * `writeArticle` hook, and the images and videos the API and the help centre
 * serve.
 *
 * Paths are relative to the docs root, with forward slashes and no leading
 * slash: `billing/invoices.md`, `billing/_meta.json`, `billing/export.png`.
 * Screenshots are always under `_screenshots/`, whichever folder they really
 * live in, because that is where `/screenshots/<file>` is read from.
 */

import type { Dirent } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { WriteArticle } from './editing.js';
import { DEFAULT_SCREENSHOTS, screenshotsRelativeToDocs } from './media.js';

/** One file in a source. */
export interface ContentEntry {
  /** Relative to the docs root, forward slashes: `billing/invoices.md`. */
  path: string;
  /** Bytes. */
  size: number;
  /** When it last changed: the article's `updatedAt`, and part of a media ETag. */
  modifiedAt: Date;
}

/**
 * The files of one install's knowledge base.
 *
 * Every method takes a path in the shape above and must refuse, by returning
 * null or throwing, anything that would leave the install's own files: the
 * callers validate paths too, but a source is the last line. A read-only
 * source leaves out `write` and `remove`.
 */
export interface ContentSource {
  /**
   * Every file whose path starts with `prefix` (all of them without one),
   * at any depth, the way an object store lists keys. Directories are not
   * entries. Order does not matter.
   */
  list(prefix?: string): Promise<ContentEntry[]>;
  /** The file's bytes, or null when there is no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /**
   * The file's bytes from `range.start` to `range.end` inclusive (the whole
   * file without a range) as a stream, or null when there is no such file.
   * Optional: without it, media is served through `read`, which holds the
   * whole file in memory for as long as the response takes. A source that
   * keeps videos, or anything large, should have it; an object store can
   * answer it with a ranged GET.
   */
  stream?(
    path: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null>;
  /** The file as UTF-8 text, or null when there is no such file. */
  readText(path: string): Promise<string | null>;
  /** Create or replace a file, creating whatever folders it needs. */
  write?(path: string, data: Uint8Array | string): Promise<void>;
  /** Delete a file. Deleting one that is not there is not an error. */
  remove?(path: string): Promise<void>;
  /** Size and modification time, or null when there is no such file. */
  stat(path: string): Promise<ContentEntry | null>;
  /**
   * How an article in this source reaches the screenshots by a relative
   * path, relative to the docs root: `_screenshots` unless the source says
   * otherwise. Only a source whose screenshots really sit somewhere else in
   * the author's tree (the filesystem one, with a screenshots folder outside
   * the docs) needs to set it; `syncContent` uses it to recognise screenshot
   * references when it rewrites image URLs.
   */
  readonly screenshots?: string;
}

/** The longest path a source is asked about. Far beyond any real one. */
const MAX_PATH = 1024;

/**
 * `path` in the one shape a source accepts, or null.
 *
 * Every segment must be a plain name: not empty, not `.` or `..`, not
 * hidden, and free of backslashes, drive colons and control characters.
 * Underscored names (`_meta.json`, `_screenshots`) are fine; they are how the
 * knowledge base marks things that are not collections.
 */
export function contentPath(path: string): string | null {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH) return null;
  const segments = path.split('/');
  const plain = segments.every(
    (segment) =>
      segment !== '' &&
      !segment.startsWith('.') &&
      segment.trim() === segment &&
      !/[\\:]/.test(segment) &&
      [...segment].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f),
  );
  return plain ? path : null;
}

/**
 * A prefix for `list`: '' for everything, otherwise a path, with or without a
 * trailing slash. Null when it could never match a valid path.
 */
function listPrefix(prefix: string | undefined): string | null {
  if (!prefix) return '';
  const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (!bare) return '';
  return contentPath(bare) === null ? null : prefix;
}

/**
 * The `writeArticle` hook a source gives the editor: the host's own hook
 * when there is one, otherwise a write through a writable source, otherwise
 * nothing, and the editor offers the file to download as it always has.
 */
export function articleWriter(
  hook: WriteArticle | undefined,
  source: ContentSource | undefined,
): WriteArticle | undefined {
  if (hook) return hook;
  const write = source?.write;
  if (!write) return undefined;
  return (path, markdown) => write.call(source, path, markdown);
}

/* ------------------------------------------------------------ filesystem */

export interface FileContentSourceOptions {
  /** The docs folder. Defaults to `docs`, relative to `cwd`. */
  docs?: string;
  /** The screenshots folder. Defaults to `<docs>/_screenshots`. */
  screenshots?: string;
  /** What relative folders are resolved against. Defaults to the working directory. */
  cwd?: string;
  /** Refuse writes: `write` and `remove` are left out. */
  readOnly?: boolean;
}

/**
 * The repo's folders as a source: what a self-hosted install reads.
 *
 * `_screenshots/…` is answered from the screenshots folder wherever it is;
 * everything else from the docs folder. Reads never leave the two folders:
 * a symlink is followed only when where it points is still inside the folder
 * it was found in, the rule media serving has always had.
 */
export function createFileContentSource(options: FileContentSourceOptions = {}): ContentSource {
  const cwd = options.cwd ?? process.cwd();
  const docsRoot = resolve(cwd, options.docs ?? 'docs');
  const shotsRoot = options.screenshots
    ? resolve(cwd, options.screenshots)
    : resolve(docsRoot, DEFAULT_SCREENSHOTS);
  const screenshots = screenshotsRelativeToDocs(docsRoot, shotsRoot);

  /** The folder a path belongs to and where it is inside it, or null. */
  const locate = (path: string): { root: string; full: string } | null => {
    const clean = contentPath(path);
    if (!clean) return null;
    const segments = clean.split('/');
    const [root, rest] =
      segments[0] === DEFAULT_SCREENSHOTS ? [shotsRoot, segments.slice(1)] : [docsRoot, segments];
    if (rest.length === 0) return null;
    const full = resolve(root, ...rest);
    return inside(root, full) ? { root, full } : null;
  };

  /** The file behind a path, symlinks resolved and checked, or null. */
  const real = async (path: string): Promise<string | null> => {
    const where = locate(path);
    if (!where) return null;
    try {
      const [realRoot, realFile] = await Promise.all([realpath(where.root), realpath(where.full)]);
      return inside(realRoot, realFile) ? realFile : null;
    } catch {
      return null;
    }
  };

  const statOf = async (path: string): Promise<ContentEntry | null> => {
    const file = await real(path);
    if (!file) return null;
    try {
      const info = await stat(file);
      return info.isFile() ? { path, size: info.size, modifiedAt: info.mtime } : null;
    } catch {
      return null;
    }
  };

  /** Every file under `dir`, as source paths starting with `as`. */
  const walk = async (root: string, dir: string, as: string, out: ContentEntry[]) => {
    let names: Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of names) {
      const path = as ? `${as}/${dirent.name}` : dirent.name;
      if (contentPath(path) === null) continue;
      // `_screenshots` at the top always means the screenshots folder, which
      // is listed from wherever it really is.
      if (dir === docsRoot && dirent.name === DEFAULT_SCREENSHOTS) continue;
      const full = resolve(dir, dirent.name);
      if (dirent.isSymbolicLink() && !(await stays(root, full))) continue;
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) await walk(root, full, path, out);
      else if (info.isFile()) out.push({ path, size: info.size, modifiedAt: info.mtime });
    }
  };

  const source: ContentSource = {
    screenshots,

    async list(prefix) {
      const want = listPrefix(prefix);
      if (want === null) return [];
      const shots = `${DEFAULT_SCREENSHOTS}/`;
      const out: ContentEntry[] = [];
      if (!want.startsWith(shots)) await walk(docsRoot, docsRoot, '', out);
      if (shots.startsWith(want) || want.startsWith(shots)) {
        await walk(shotsRoot, shotsRoot, DEFAULT_SCREENSHOTS, out);
      }
      return out.filter((entry) => entry.path.startsWith(want));
    },

    async read(path) {
      const file = await real(path);
      if (!file) return null;
      try {
        const info = await stat(file);
        if (!info.isFile()) return null;
        return new Uint8Array(await readFile(file));
      } catch {
        return null;
      }
    },

    async readText(path) {
      const bytes = await source.read(path);
      return bytes === null ? null : new TextDecoder().decode(bytes);
    },

    async stream(path, range) {
      const file = await real(path);
      if (!file) return null;
      // Opened here, not when the first chunk is pulled, so a file that is
      // missing answers null rather than failing half way through a response.
      let handle: FileHandle;
      try {
        handle = await open(file, 'r');
      } catch {
        return null;
      }
      try {
        if (!(await handle.stat()).isFile()) {
          await handle.close();
          return null;
        }
      } catch {
        await handle.close().catch(() => {});
        return null;
      }
      const stream = handle.createReadStream(range ? { start: range.start, end: range.end } : {});
      // Node's web stream type and the DOM's are the same object with two names.
      return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    },

    stat: statOf,
  };

  if (!options.readOnly) {
    source.write = async (path, data) => {
      const where = locate(path);
      if (!where) throw new Error(`Not a path HelpWell writes: ${path}`);
      const folder = dirname(where.full);
      await mkdir(where.root, { recursive: true });
      // The deepest folder that already exists must really be inside the
      // root, so a symlinked folder cannot carry the write out of the docs.
      let existing = folder;
      while (existing !== where.root && !(await exists(existing))) existing = dirname(existing);
      const realRoot = await realpath(where.root);
      if (!within(realRoot, await realpath(existing))) {
        throw new Error(`Not a path HelpWell writes: ${path}`);
      }
      await mkdir(folder, { recursive: true });
      const target = resolve(await realpath(folder), basename(where.full));
      if (!inside(realRoot, target)) throw new Error(`Not a path HelpWell writes: ${path}`);
      if ((await isSymlink(target)) && !(await stays(where.root, target))) {
        throw new Error(`Not a path HelpWell writes: ${path}`);
      }
      await writeFile(target, data);
    };
    source.remove = async (path) => {
      const file = await real(path);
      if (file) await rm(file, { force: true });
    };
  }

  return source;
}

function inside(base: string, full: string): boolean {
  const rel = relative(base, full);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** `full` is `base` itself or inside it. */
function within(base: string, full: string): boolean {
  return full === base || inside(base, full);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Whether a symlink's target is still inside `root`. */
async function stays(root: string, full: string): Promise<boolean> {
  try {
    const [realRoot, target] = await Promise.all([realpath(root), realpath(full)]);
    return inside(realRoot, target);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- memory */

/**
 * A source held in memory: for tests, for a host that keeps content in its
 * own database and loads it per request, and for trying things out. Seed it
 * with `{ 'billing/invoices.md': '# Invoices\n…' }`.
 */
export function createMemoryContentSource(
  files: Record<string, string | Uint8Array> = {},
  options: { now?: () => Date; screenshots?: string } = {},
): ContentSource & { files: Map<string, { data: Uint8Array; modifiedAt: Date }> } {
  const now = options.now ?? (() => new Date());
  const store = new Map<string, { data: Uint8Array; modifiedAt: Date }>();
  const bytes = (data: string | Uint8Array) =>
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);

  for (const [path, data] of Object.entries(files)) {
    const clean = contentPath(path);
    if (!clean) throw new Error(`Not a content path: ${path}`);
    store.set(clean, { data: bytes(data), modifiedAt: now() });
  }

  const entry = (path: string): ContentEntry | null => {
    const clean = contentPath(path);
    const file = clean ? store.get(clean) : undefined;
    return file && clean
      ? { path: clean, size: file.data.length, modifiedAt: file.modifiedAt }
      : null;
  };

  return {
    files: store,
    ...(options.screenshots ? { screenshots: options.screenshots } : {}),
    async list(prefix) {
      const want = listPrefix(prefix);
      if (want === null) return [];
      return [...store.keys()]
        .filter((path) => path.startsWith(want))
        .map((path) => entry(path))
        .filter((found): found is ContentEntry => found !== null);
    },
    async read(path) {
      const clean = contentPath(path);
      const file = clean ? store.get(clean) : undefined;
      return file ? new Uint8Array(file.data) : null;
    },
    async readText(path) {
      const clean = contentPath(path);
      const file = clean ? store.get(clean) : undefined;
      return file ? new TextDecoder().decode(file.data) : null;
    },
    async write(path, data) {
      const clean = contentPath(path);
      if (!clean) throw new Error(`Not a content path: ${path}`);
      store.set(clean, { data: bytes(data), modifiedAt: now() });
    },
    async remove(path) {
      const clean = contentPath(path);
      if (clean) store.delete(clean);
    },
    async stat(path) {
      return entry(path);
    },
  };
}
