/**
 * Uploading an image, GIF or video for an engagement.
 *
 * Files go where article media already lives, the docs folder, under
 * `_engage/`, named by a hash of their bytes. The API serves that folder at
 * `<api>/media/`, with its type allow-list and path guards, so an uploaded
 * file is reachable at `<api>/media/_engage/<hash>.<ext>` with nothing new
 * to serve it, and it sits in the repo beside the docs, to be committed like
 * a screenshot. The same bytes uploaded twice are one file.
 *
 * Only the formats the widget shows are taken, checked by their first bytes
 * rather than their name, and SVG is refused: it can carry script.
 *
 * When the host keeps the docs in a content source rather than on this
 * server's disk (`content` in the dashboard's config, the same one the API
 * serves `/media/` from), the file is written through that source instead,
 * at the same path, so the URL is the same either way. A source that cannot
 * be written takes no uploads; the editor then offers links only.
 */

/// <reference types="node" />

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ContentSource } from '@helpwell/core/content';

/** The most one upload may be. A banner GIF is a few MB; a short clip, more. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const UPLOAD_FOLDER = '_engage';

const FORMATS: { ext: string; type: string; test: (b: Uint8Array) => boolean }[] = [
  { ext: 'png', type: 'image/png', test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
  { ext: 'jpg', type: 'image/jpeg', test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { ext: 'gif', type: 'image/gif', test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    ext: 'webp',
    type: 'image/webp',
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 4) === 'WEBP',
  },
  { ext: 'mp4', type: 'video/mp4', test: (b) => ascii(b, 4, 4) === 'ftyp' },
  { ext: 'webm', type: 'video/webm', test: (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]) },
];

function starts(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, i) => bytes[i] === value);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.slice(at, at + length));
}

/** What the bytes are, or null when it is not a format engagements show. */
export function sniffMedia(bytes: Uint8Array): { ext: string; type: string } | null {
  const found = FORMATS.find((format) => format.test(bytes));
  return found ? { ext: found.ext, type: found.type } : null;
}

export type UploadResult =
  | { ok: true; url: string; type: string }
  | { ok: false; status: number; error: string };

/**
 * Store one uploaded file and return the URL it will be served at. `docsDir`
 * is the docs folder relative to the working directory, as the dashboard and
 * the API are both configured with.
 */
export async function storeUpload(
  file: unknown,
  options: { docsDir: string; apiPath: string; content?: ContentSource },
): Promise<UploadResult> {
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, status: 400, error: 'Choose a file to upload.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: 'That file is over 25 MB.' };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffMedia(bytes);
  if (!format) {
    return {
      ok: false,
      status: 415,
      error: 'Upload a PNG, JPEG, GIF, WebP, MP4 or WebM file.',
    };
  }

  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${format.ext}`;
  const { content } = options;
  if (content && !content.write) {
    return {
      ok: false,
      status: 501,
      error:
        'The docs are in a source that cannot be written to. Paste an https:// address instead.',
    };
  }
  try {
    if (content?.write) {
      await content.write(`${UPLOAD_FOLDER}/${name}`, bytes);
    } else {
      const folder = resolve(process.cwd(), options.docsDir, UPLOAD_FOLDER);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, name), bytes);
    }
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: `The file could not be saved (${(error as NodeJS.ErrnoException).code ?? 'error'}). Paste an https:// address instead.`,
    };
  }
  const api = options.apiPath.replace(/\/+$/, '');
  return { ok: true, url: `${api}/media/${UPLOAD_FOLDER}/${name}`, type: format.type };
}
