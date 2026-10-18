/**
 * Files uploaded for forms: a lead magnet (a PDF guide, a ZIP of templates,
 * an e-book) that a signed download link hands out, and the pictures and
 * videos of a form's content.
 *
 * They are kept where the knowledge base's files are: through the install's
 * content source (`config.content`) when it has one that can be written,
 * which is how a hosted install with no disk of its own keeps them, and in
 * the docs folder on this server's disk otherwise, under `_forms/`. Each is
 * named by a hash of its bytes, so the same file uploaded twice is one file.
 *
 * A lead magnet is referred to as `upload:_forms/<name>` rather than by an
 * address: it is never served at a URL of its own (the media route does not
 * serve PDFs or archives), only through the form's signed, expiring download
 * link, so the file cannot be shared around the sign-up.
 *
 * Only the formats listed are taken, checked by their first bytes rather than
 * their name. SVG and HTML are refused: they can carry script.
 */

import type { ContentSource } from '../content/source.js';

export const FORM_FILES_FOLDER = '_forms';

/** The most one file may be. */
export const MAX_FORM_FILE_BYTES = 25 * 1024 * 1024;

/** How a definition names an uploaded lead magnet. */
export const FORM_FILE_REF =
  /^upload:_forms\/([a-f0-9]{24}\.(?:pdf|epub|zip|png|jpg|gif|webp|mp4))$/;

interface Format {
  ext: string;
  type: string;
  test: (bytes: Uint8Array) => boolean;
}

const starts = (bytes: Uint8Array, prefix: number[]) =>
  prefix.every((value, i) => bytes[i] === value);
const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.slice(at, at + length));

/** What a lead magnet can be. EPUB before ZIP: an EPUB is a ZIP that says so. */
const DOWNLOADS: Format[] = [
  { ext: 'pdf', type: 'application/pdf', test: (b) => ascii(b, 0, 5) === '%PDF-' },
  {
    ext: 'epub',
    type: 'application/epub+zip',
    test: (b) =>
      starts(b, [0x50, 0x4b, 0x03, 0x04]) && ascii(b, 30, 28) === 'mimetypeapplication/epub+zip',
  },
  { ext: 'zip', type: 'application/zip', test: (b) => starts(b, [0x50, 0x4b, 0x03, 0x04]) },
  { ext: 'png', type: 'image/png', test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
  { ext: 'jpg', type: 'image/jpeg', test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { ext: 'gif', type: 'image/gif', test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    ext: 'webp',
    type: 'image/webp',
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 4) === 'WEBP',
  },
  { ext: 'mp4', type: 'video/mp4', test: (b) => ascii(b, 4, 4) === 'ftyp' },
];

const TYPES = new Map(DOWNLOADS.map((f) => [f.ext, f.type]));

/** What an uploaded lead magnet is, or null when it is not a format a form hands out. */
export function sniffFormFile(bytes: Uint8Array): { ext: string; type: string } | null {
  const found = DOWNLOADS.find((format) => format.test(bytes));
  return found ? { ext: found.ext, type: found.type } : null;
}

/** Where a file is kept: an install's content source that can be written, or a docs folder on disk. */
export interface FormFileStore {
  content?: ContentSource | null;
  /** The docs folder, relative to the working directory (or absolute). Used without a writable source. */
  docsDir?: string | null;
}

export type StoredFile =
  | { ok: true; path: string; name: string; type: string }
  | { ok: false; status: number; error: string };

/**
 * Keep one file, already checked, under `folder` (`_forms`, or `_engage` for
 * block media shared with the engage editor). Returns its path relative to
 * the docs root.
 */
export async function storeFile(
  bytes: Uint8Array,
  ext: string,
  folder: string,
  store: FormFileStore,
): Promise<StoredFile> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  const name = `${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
  const path = `${folder}/${name}`;
  const type = TYPES.get(ext) ?? 'application/octet-stream';
  try {
    if (store.content?.write) {
      await store.content.write(path, bytes);
      return { ok: true, path, name, type };
    }
    if (store.content && !store.content.write) {
      return {
        ok: false,
        status: 501,
        error:
          'This install keeps its files somewhere that cannot be written from here. Paste an https:// address instead.',
      };
    }
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const dir = resolve(process.cwd(), store.docsDir || 'docs', folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
    return { ok: true, path, name, type };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? 'error';
    return {
      ok: false,
      status: 500,
      error: `The file could not be saved (${code}). Paste an https:// address instead.`,
    };
  }
}

/** Take an uploaded lead magnet: check it, keep it, and return how a definition names it. */
export async function storeFormFile(
  file: unknown,
  store: FormFileStore,
): Promise<{ ok: true; ref: string; type: string } | { ok: false; status: number; error: string }> {
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, status: 400, error: 'Choose a file to upload.' };
  }
  if (file.size > MAX_FORM_FILE_BYTES) {
    return { ok: false, status: 413, error: 'That file is over 25 MB.' };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffFormFile(bytes);
  if (!format) {
    return {
      ok: false,
      status: 415,
      error: 'Upload a PDF, EPUB, ZIP, image or MP4 file.',
    };
  }
  const stored = await storeFile(bytes, format.ext, FORM_FILES_FOLDER, store);
  return stored.ok ? { ok: true, ref: `upload:${stored.path}`, type: format.type } : stored;
}

/** An uploaded lead magnet's bytes and type, or null when it is not there. */
export async function readFormFile(
  ref: string,
  store: FormFileStore,
): Promise<{ bytes: Uint8Array; type: string; name: string } | null> {
  const match = FORM_FILE_REF.exec(ref);
  if (!match) return null;
  const name = match[1]!;
  const path = `${FORM_FILES_FOLDER}/${name}`;
  const type = TYPES.get(name.split('.').pop() ?? '') ?? 'application/octet-stream';
  try {
    if (store.content) {
      const bytes = await store.content.read(path);
      return bytes ? { bytes, type, name } : null;
    }
    if (!store.docsDir) return null;
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    // The name is 24 hex digits and an extension: it cannot leave the folder.
    const bytes = await readFile(resolve(process.cwd(), store.docsDir, FORM_FILES_FOLDER, name));
    return { bytes: new Uint8Array(bytes), type, name };
  } catch {
    return null;
  }
}
