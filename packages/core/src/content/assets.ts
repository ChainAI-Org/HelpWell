/**
 * Images an article shows that nobody captured: pasted, dropped or picked in
 * the editor, or brought over from another help centre by an import.
 *
 * A screenshot `helpwell capture` takes lives in the repo and is referenced by
 * its path, and nothing about that changes. An uploaded image needs somewhere
 * to go, and the answer depends on the install, so it goes through one small
 * seam, the `AssetStore`: `put` keeps the bytes and says how an article
 * reaches them.
 *
 * Without a store of its own, an install keeps them where the articles are:
 * written through its writable content source, or into the docs folder on
 * disk, under `_media/`, named by a hash of their bytes so the same image
 * uploaded twice is one file. An article references one by a path relative
 * to itself (`../_media/3f9a….png`), exactly as it would a screenshot, and
 * the API and the help centre already serve that folder (`<api>/media/…`,
 * `<help>/_media/…`). A host that keeps files elsewhere, behind a CDN, passes
 * a store whose `put` answers with the absolute URL the file is served at,
 * and the article carries that URL instead.
 *
 * Only the image formats every browser shows are taken, recognised by their
 * first bytes rather than their name: PNG, JPEG, GIF and WebP. SVG is refused,
 * because it can carry script, and one opened on its own would run it.
 */

import { createHash } from 'node:crypto';
import { HelpWellError } from '../errors.js';
import { type ContentSource, createFileContentSource } from './source.js';

/** Where uploaded images are kept among the knowledge base's files. */
export const ASSET_FOLDER = '_media';

/** The largest image one upload may be. A full-page retina screenshot is a few MB. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** The formats an upload may be, by content type, with the extension each is saved under. */
export const ASSET_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
} as const;

export type AssetContentType = keyof typeof ASSET_TYPES;

/** What `put` is handed: the bytes, already checked, and the path HelpWell chose for them. */
export interface AssetUpload {
  /**
   * Where HelpWell would keep the file among the knowledge base's files,
   * relative to the docs root: `_media/<24 hex digits>.<ext>`, named by a
   * hash of the bytes. A store that keeps files elsewhere can use it as a key.
   */
  path: string;
  bytes: Uint8Array;
  /** Read from the bytes, never from a name: one of `ASSET_TYPES`. */
  contentType: AssetContentType;
}

/** What `put` answers. */
export interface StoredAsset {
  /**
   * The absolute `https://` (or `http://`) URL the file is served at, for a
   * store that serves its own files. The article references it as it is.
   * Left out or null: the file is at `path` among the knowledge base's files,
   * the article references it relative to itself, and the API and the help
   * centre serve it from there.
   */
  url?: string | null;
}

/**
 * Where uploaded images go. `put` is called once per upload with bytes that
 * have passed the type and size checks; it may be called again with bytes it
 * already has (the same image twice), and should simply succeed. To refuse
 * one (a storage limit, say), throw a `HelpWellError` whose `publicMessage`
 * says why: that is what the person who uploaded is shown. Anything else
 * thrown is reported as a failure, without its message.
 */
export interface AssetStore {
  put(asset: AssetUpload): Promise<StoredAsset>;
}

/** One stored image, as the editor, the API and the importers see it. */
export interface AssetRecord {
  /** Among the knowledge base's files, relative to the docs root: `_media/3f9a….png`. */
  path: string;
  contentType: AssetContentType;
  size: number;
  /** The store's own URL for it, or null when it is at `path`. */
  url: string | null;
  /**
   * What an article puts in its Markdown to show it: the store's URL, or the
   * path relative to the article, which is always `../_media/…` since every
   * article sits one folder down, in its collection.
   */
  reference: string;
}

/* ----------------------------------------------------------------- check */

function starts(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, i) => bytes[i] === value);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.slice(at, at + length));
}

/** What an image's bytes are, or null when it is not one of `ASSET_TYPES`. */
export function sniffImage(bytes: Uint8Array): AssetContentType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** Whether the bytes look like an SVG, so the refusal can say why. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).replace(/^﻿/, '');
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(
    head,
  );
}

/** Why an upload is refused, in words for the person who chose the file. */
export type AssetRefusal = 'empty' | 'too_large' | 'svg' | 'type';

function refuse(reason: AssetRefusal, maxBytes: number): HelpWellError {
  const messages: Record<AssetRefusal, string> = {
    empty: 'Choose an image to upload.',
    too_large: `That image is over ${Math.round(maxBytes / (1024 * 1024))} MB. Save it smaller and try again.`,
    svg: 'SVG images are not taken, because they can carry script. Save it as a PNG and upload that.',
    type: 'Upload a PNG, JPEG, GIF or WebP image.',
  };
  return new HelpWellError('bad_request', `Asset refused: ${reason}`, {
    publicMessage: messages[reason],
    details: { reason },
  });
}

/** The path an image's bytes are kept at: `_media/<hash>.<ext>`. */
export function assetPath(bytes: Uint8Array, contentType: AssetContentType): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  return `${ASSET_FOLDER}/${hash}.${ASSET_TYPES[contentType]}`;
}

/**
 * Check an image and keep it through `store`. Throws a `HelpWellError`
 * (`bad_request`, with `details.reason` one of `AssetRefusal`) for an empty,
 * oversized, SVG or unknown file, and passes on whatever the store throws.
 */
export async function storeAsset(
  store: AssetStore,
  bytes: Uint8Array,
  options: { maxBytes?: number } = {},
): Promise<AssetRecord> {
  const maxBytes = options.maxBytes ?? MAX_ASSET_BYTES;
  if (bytes.byteLength === 0) throw refuse('empty', maxBytes);
  if (bytes.byteLength > maxBytes) throw refuse('too_large', maxBytes);
  const contentType = sniffImage(bytes);
  if (!contentType) throw refuse(looksLikeSvg(bytes) ? 'svg' : 'type', maxBytes);

  const path = assetPath(bytes, contentType);
  const stored = await store.put({ path, bytes, contentType });
  const url = typeof stored?.url === 'string' && stored.url ? stored.url : null;
  if (url !== null && !/^https?:\/\/[^\s"'<>()]+$/i.test(url)) {
    throw new HelpWellError(
      'internal',
      `The asset store answered with a URL HelpWell cannot use: ${url}`,
    );
  }
  return { path, contentType, size: bytes.byteLength, url, reference: url ?? `../${path}` };
}

/** `![alt](reference)`, with the alt text made safe to sit inside the brackets. */
export function assetMarkdown(record: Pick<AssetRecord, 'reference'>, alt = ''): string {
  const text = alt
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[[\]\\\r\n]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `![${text}](${record.reference})`;
}

/* ---------------------------------------------------------------- stores */

/**
 * A store that keeps images among the knowledge base's files, through a
 * writable content source. The same bytes are one file: one already there at
 * that size is not written again.
 */
export function contentAssetStore(source: ContentSource): AssetStore {
  const write = source.write;
  if (!write) throw new Error('contentAssetStore needs a writable content source.');
  return {
    async put(asset) {
      const existing = await source.stat(asset.path).catch(() => null);
      if (existing?.size !== asset.bytes.byteLength)
        await write.call(source, asset.path, asset.bytes);
      return {};
    },
  };
}

/** A store that keeps images in the docs folder on this server's disk, under `_media/`. */
export function fileAssetStore(options: { docs?: string; cwd?: string } = {}): AssetStore {
  return contentAssetStore(createFileContentSource({ docs: options.docs, cwd: options.cwd }));
}

/**
 * The store an install's uploads go through: its own when it passed one;
 * none when it passed `false`; otherwise its content source when that is
 * writable (a read-only one takes no uploads); and with no content source,
 * the docs folder on disk when `docs` names one (null leaves that out).
 */
export function resolveAssetStore(options: {
  assetStore?: AssetStore | false;
  content?: ContentSource;
  docs?: string | null;
  cwd?: string;
}): AssetStore | null {
  if (options.assetStore === false) return null;
  if (options.assetStore) return options.assetStore;
  if (options.content) return options.content.write ? contentAssetStore(options.content) : null;
  if (options.docs === null) return null;
  return fileAssetStore({ docs: options.docs ?? 'docs', cwd: options.cwd });
}
