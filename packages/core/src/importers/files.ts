/**
 * A folder of files to import from, wherever it is.
 *
 * The CLI reads an export folder straight off disk. The dashboard has no
 * disk to point at: someone uploads the export, and a folder of Markdown, an
 * HTML export, a GitBook repository or a Notion export all arrive as one ZIP.
 * So the readers work on this small interface instead of the filesystem, and
 * each place hands them the folder it has: `diskImportFiles` for a path,
 * `zipImportFiles` for an uploaded archive, `memoryImportFiles` for tests.
 *
 * An archive is read in memory and never written anywhere. It is still a file
 * from a stranger, so reading one is bounded: how many entries, how large
 * each may unpack to and how large all of them may, checked against what the
 * archive claims and again against what really comes out, so a small ZIP
 * that unpacks to gigabytes stops at the limit. Entries with `..` in their
 * path, absolute paths, encrypted entries and the clutter archivers add
 * (`__MACOSX/`, `.DS_Store`) are left out.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { HelpWellError } from '../errors.js';

/** A folder of files an importer reads. Paths are relative, with forward slashes. */
export interface ImportFiles {
  /** A name for the folder, for the collection its top-level files fall into. */
  readonly name: string;
  /** Every file in it, sorted. Hidden files and folders are left out. */
  paths(): string[];
  /**
   * A file's bytes, or null when there is none. `path` is relative to the
   * folder and may have been worked out from a relative link, so it is
   * normalised here; one that leads outside the folder is null for an
   * archive or memory, and read from beside the folder on disk.
   */
  read(path: string): Uint8Array | null;
}

/** The same path however it was written: forward slashes, no `.` segments, no leading slash. */
function normalise(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/')).replace(/^\/+/, '');
}

/** A path that stays inside the folder: not `..`, not absolute, not empty. */
function insideFolder(path: string): boolean {
  return path !== '' && path !== '.' && path !== '..' && !path.startsWith('../');
}

/** Whether a path has a hidden segment, or is the clutter an archiver adds. */
function hidden(path: string): boolean {
  return path
    .split('/')
    .some(
      (segment) => segment.startsWith('.') || segment === '__MACOSX' || segment === 'node_modules',
    );
}

/** Files held in memory, by path: for tests, and anything already unpacked. */
export function memoryImportFiles(
  files: Record<string, string | Uint8Array>,
  name = 'import',
): ImportFiles {
  const store = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    const clean = normalise(path);
    if (!insideFolder(clean) || hidden(clean)) continue;
    store.set(clean, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
  const sorted = [...store.keys()].sort();
  return {
    name,
    paths: () => [...sorted],
    read: (path) => {
      const clean = normalise(path);
      return insideFolder(clean) ? (store.get(clean) ?? null) : null;
    },
  };
}

/**
 * A folder on disk, as the CLI reads one. Links out of the folder are read
 * from beside it, as `helpwell import` always has: it is the person's own
 * machine, and an export often keeps its images one folder up.
 */
export function diskImportFiles(root: string): ImportFiles {
  const base = resolve(root);
  const found: string[] = [];
  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === '__MACOSX') continue;
      const full = join(dir, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) visit(full);
      else found.push(relative(base, full).split(sep).join('/'));
    }
  };
  visit(base);
  found.sort();
  return {
    name: basename(base),
    paths: () => [...found],
    read: (path) => {
      const decoded = path.replace(/\\/g, '/');
      const full = isAbsolute(decoded) ? decoded : resolve(base, ...decoded.split('/'));
      try {
        if (!statSync(full).isFile()) return null;
        return new Uint8Array(readFileSync(full));
      } catch {
        return null;
      }
    },
  };
}

/* ------------------------------------------------------------------- zip */

export interface ZipLimits {
  /** The most entries an archive may list. Default 20,000. */
  maxEntries?: number;
  /** The most one file may unpack to. Default 50 MB. */
  maxFileBytes?: number;
  /** The most all files together may unpack to. Default 500 MB. */
  maxTotalBytes?: number;
}

const ZIP_DEFAULTS: Required<ZipLimits> = {
  maxEntries: 20_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
};

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  /** Where the entry's local header starts. */
  offset: number;
}

function refuse(message: string): HelpWellError {
  return new HelpWellError('bad_request', `Unreadable archive: ${message}`, {
    publicMessage: message,
  });
}

/** Whether `bytes` start like a ZIP archive. */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * The files in a ZIP archive, read in memory. When everything sits in one
 * folder at the top, as most exports do, that folder is the one imported, the
 * way the CLI would be pointed at it. Throws a `bad_request` HelpWellError
 * whose message says what is wrong, for an archive that cannot be read or
 * passes a limit.
 */
export function zipImportFiles(
  bytes: Uint8Array,
  options: ZipLimits & { name?: string } = {},
): ImportFiles {
  const limits = { ...ZIP_DEFAULTS, ...options };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  // The end-of-central-directory record: at the end, before a comment of up to 64 KB.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw refuse('That file is not a ZIP archive, or it is damaged.');
  const count = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryOffset = u32(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw refuse('That archive is too large to import here. Split it into smaller ones.');
  }
  if (count > limits.maxEntries) {
    throw refuse(
      `That archive has more than ${limits.maxEntries} files. Split it into smaller ones.`,
    );
  }
  if (directoryOffset + directorySize > end) {
    throw refuse('That file is not a ZIP archive, or it is damaged.');
  }

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let total = 0;
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) {
      throw refuse('That file is not a ZIP archive, or it is damaged.');
    }
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const compressedSize = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const offset = u32(at + 42);
    const rawName = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    const isDirectory = rawName.endsWith('/') || rawName.endsWith('\\');
    // A name that climbs (`a/../b`) or starts at a root was made to get out
    // of wherever an archive is unpacked; it is no part of an export.
    const raw = rawName.replace(/\\/g, '/');
    const climbs = raw.split('/').includes('..') || raw.startsWith('/') || /^[a-z]:/i.test(raw);
    const name = normalise(rawName);
    if (isDirectory || climbs || !insideFolder(name) || hidden(name)) continue;
    if (flags & 0x1) continue; // encrypted: nothing to read it with
    if (method !== 0 && method !== 8) continue; // only stored and deflated
    if (size > limits.maxFileBytes) {
      throw refuse(
        `${name} is over ${Math.round(limits.maxFileBytes / (1024 * 1024))} MB, more than one file here may be.`,
      );
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw refuse(
        `That archive unpacks to more than ${Math.round(limits.maxTotalBytes / (1024 * 1024))} MB. Split it into smaller ones.`,
      );
    }
    entries.set(name, { method, compressedSize, size, offset });
  }

  // One folder at the top holding everything: that folder is the import.
  const names = [...entries.keys()];
  const tops = new Set(names.map((name) => (name.includes('/') ? name.split('/')[0] : '')));
  const wrapper = tops.size === 1 && !tops.has('') && names.length > 0 ? `${[...tops][0]}/` : '';
  const files = new Map<string, ZipEntry>();
  for (const [name, entry] of entries) files.set(name.slice(wrapper.length), entry);
  const sorted = [...files.keys()].sort();

  let unpacked = 0;
  const read = (path: string): Uint8Array | null => {
    const clean = normalise(path);
    const entry = insideFolder(clean) ? files.get(clean) : undefined;
    if (!entry) return null;
    const local = entry.offset;
    if (local + 30 > bytes.length || u32(local) !== 0x04034b50) return null;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const data = bytes.subarray(start, start + entry.compressedSize);
    if (data.length !== entry.compressedSize) return null;
    let out: Uint8Array;
    try {
      out =
        entry.method === 0
          ? new Uint8Array(data)
          : new Uint8Array(inflateRawSync(data, { maxOutputLength: limits.maxFileBytes }));
    } catch {
      return null;
    }
    // What really came out counts, whatever the archive claimed.
    unpacked += out.length;
    if (unpacked > limits.maxTotalBytes * 2) {
      throw refuse('That archive unpacks to more than it says. It cannot be imported.');
    }
    return out;
  };

  return {
    name: (wrapper ? wrapper.slice(0, -1) : options.name) ?? 'import',
    paths: () => [...sorted],
    read,
  };
}
