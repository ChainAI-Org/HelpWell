/**
 * What "Import from another help center" accepts, and how each is read.
 *
 * Two ways in, for an install with no terminal to run `helpwell import` in:
 *
 * - An uploaded export. A ZIP of a folder of Markdown (Mintlify, Docusaurus,
 *   a docs repo), a folder of HTML (what most help desks export), a GitBook
 *   repository, or a Notion export (which Notion itself hands over as a ZIP,
 *   sometimes one inside another), worked out from what is in it; or a
 *   single Markdown or HTML file.
 * - A public address. A Zendesk help centre at its zendesk.com address is
 *   read through Zendesk's public API, with its sections and draft states and
 *   no key; any other public help site is crawled page by page into drafts.
 *
 * Platforms that need a key (Intercom, Help Scout, Freshdesk, Document360,
 * Crisp) stay with the CLI, where the key lives in the person's own
 * environment rather than being typed into a web page.
 */

import { HelpWellError } from '../errors.js';
import { crawlSite } from './crawl.js';
import {
  type ImportFiles,
  isZip,
  memoryImportFiles,
  type ZipLimits,
  zipImportFiles,
} from './files.js';
import { type FolderSource, readFolder } from './folders.js';
import type { ImportPlan } from './plan.js';
import { importFromPlatform } from './platforms.js';

/** The kinds of export an upload may be, for the page that asks for one. */
export const IMPORT_UPLOAD_FORMATS: readonly { format: FolderSource; label: string }[] = [
  { format: 'markdown', label: 'A folder of Markdown files (a docs repo, Mintlify, Docusaurus)' },
  { format: 'html', label: 'A folder of HTML pages (most help desks’ export)' },
  { format: 'gitbook', label: 'A GitBook repository, with its SUMMARY.md' },
  { format: 'notion', label: 'A Notion export, as Markdown or HTML' },
];

/** The public addresses an import reads, for the same page. */
export const IMPORT_URL_SOURCES: readonly { source: 'zendesk' | 'crawl'; label: string }[] = [
  { source: 'zendesk', label: 'A Zendesk help center, at its zendesk.com address' },
  { source: 'crawl', label: 'Any other public help site, read page by page into drafts' },
];

/** The largest upload an import takes. */
export const MAX_IMPORT_UPLOAD_BYTES = 100 * 1024 * 1024;

function refuse(message: string): HelpWellError {
  return new HelpWellError('bad_request', `Import refused: ${message}`, { publicMessage: message });
}

/**
 * The files in an upload: a ZIP (unwrapping one ZIP inside another, as a
 * Notion export arrives), or a single Markdown or HTML file.
 */
export function uploadedFiles(
  bytes: Uint8Array,
  fileName: string,
  limits: ZipLimits = {},
): ImportFiles {
  if (bytes.byteLength === 0) throw refuse('That file is empty.');
  if (bytes.byteLength > MAX_IMPORT_UPLOAD_BYTES) {
    throw refuse(
      `That file is over ${MAX_IMPORT_UPLOAD_BYTES / (1024 * 1024)} MB. Split the export into smaller archives.`,
    );
  }
  const name = (fileName.split(/[\\/]/).pop() ?? '').replace(/\.[a-z0-9]+$/i, '') || 'import';
  if (isZip(bytes)) {
    let files = zipImportFiles(bytes, { ...limits, name });
    const paths = files.paths();
    // Notion hands over its export as a ZIP holding another ZIP.
    if (paths.length === 1 && /\.zip$/i.test(paths[0]!)) {
      const inner = files.read(paths[0]!);
      if (inner && isZip(inner)) files = zipImportFiles(inner, { ...limits, name });
    }
    if (files.paths().some((path) => /\.zip$/i.test(path)) && !hasArticles(files)) {
      throw refuse('That archive holds other archives. Upload each part on its own.');
    }
    return files;
  }
  if (/\.zip$/i.test(fileName)) throw refuse('That file is not a ZIP archive, or it is damaged.');
  if (/\.(md|mdx|markdown)$/i.test(fileName)) {
    return memoryImportFiles({ [`${name}.md`]: bytes }, name);
  }
  if (/\.html?$/i.test(fileName)) return memoryImportFiles({ [`${name}.html`]: bytes }, name);
  throw refuse('Upload a ZIP of the export, or a single Markdown or HTML file.');
}

function hasArticles(files: ImportFiles): boolean {
  return files.paths().some((path) => /\.(mdx?|html?)$/i.test(path));
}

/** Read an upload into a plan: its format as given, or worked out from what is in it. */
export function readUploadedExport(
  bytes: Uint8Array,
  fileName: string,
  options: { format?: FolderSource | 'auto'; collection?: string; limits?: ZipLimits } = {},
): ImportPlan {
  const files = uploadedFiles(bytes, fileName, options.limits);
  if (!hasArticles(files)) {
    throw refuse('There are no Markdown or HTML files in that upload.');
  }
  return readFolder(files, options.format ?? 'auto', { collection: options.collection });
}

/** How a public address is read: through Zendesk's API, or by crawling it. */
export function importUrlSource(
  address: string,
): { source: 'zendesk'; subdomain: string; locale?: string } | { source: 'crawl'; url: string } {
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(address.trim())
        ? address.trim()
        : `https://${address.trim()}`,
    );
  } catch {
    throw refuse('That is not a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw refuse('That is not a web address.');
  const zendesk = /^([a-z0-9-]+)\.zendesk\.com$/i.exec(url.hostname);
  if (zendesk) {
    const locale = /^\/hc\/([a-z]{2}(?:-[a-z0-9]{2,8})?)(?:\/|$)/i.exec(url.pathname)?.[1];
    return {
      source: 'zendesk',
      subdomain: zendesk[1]!.toLowerCase(),
      ...(locale ? { locale: locale.toLowerCase() } : {}),
    };
  }
  // Read over https: the fetch an import uses on a server takes nothing else.
  url.protocol = 'https:';
  return { source: 'crawl', url: url.href };
}

/**
 * Read a public help centre into a plan. `fetch` is how it is read: on a
 * server, pass `publicFetch()` or the host's own guarded fetch.
 */
export async function readImportUrl(
  address: string,
  options: { fetch: typeof fetch; max?: number; onProgress?: (text: string) => void },
): Promise<ImportPlan> {
  const where = importUrlSource(address);
  if (where.source === 'zendesk') {
    return importFromPlatform('zendesk', {
      fetch: options.fetch,
      // A public help centre needs no key, and none is read from anywhere.
      env: {},
      subdomain: where.subdomain,
      locale: where.locale,
      onProgress: options.onProgress,
    });
  }
  return crawlSite(where.url, {
    fetch: options.fetch,
    max: options.max,
    onProgress: options.onProgress,
  });
}
