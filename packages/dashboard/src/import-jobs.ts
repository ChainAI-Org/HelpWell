/**
 * The seam for running "Import from another help center" somewhere other
 * than the request that asked for it.
 *
 * By default the import runs inside the form's POST and streams its progress
 * back to the page. A host that runs long work on workers (a crawl can take
 * minutes, and a request can be cut off long before that) passes
 * `DashboardConfig.importJobs`: the dashboard still checks and reads the
 * form, then hands the request to `start`, and streams whatever `watch`
 * yields to the same page, in the same shape. The worker can run the very
 * import the dashboard would have, with `runImportJob`.
 */

import type { ImportWriteResult } from '@helpwell/core/import';

/** What the form asked for, checked: an upload or an address, never both. */
export interface ImportJobRequest {
  /** The uploaded export, at most `MAX_IMPORT_UPLOAD_BYTES`. */
  upload: { bytes: Uint8Array; name: string } | null;
  /** A public help center's address, when there is no upload. */
  address: string | null;
  /** Import every article as a draft. */
  draft: boolean;
  /** Replace articles already here. */
  force: boolean;
}

/** Where the job was asked for, for a host that keeps jobs per install or per person. */
export interface ImportJobContext {
  /** The request that submitted the form: the host's own session is on it. */
  request: Request;
  /** Where the dashboard is mounted. */
  basePath: string;
  /** Where the API is mounted: imported images and media are indexed under it. */
  apiPath: string;
}

/** How an import ended, as the page's summary shows it. Plain data, so a worker can send it. */
export interface ImportSummary {
  /** Where the articles were read from: an importer's name, or `crawl`. */
  source: string;
  /** How many articles were found. */
  found: number;
  /** What was written, skipped, and brought over. */
  written: ImportWriteResult;
  /** Whether the knowledge base was indexed afterwards, and what the indexer said if not fully. */
  indexed: { articles: number; embeddingError: string | null } | null;
  /** What the reader noticed on the way, for "Worth a look". */
  warnings: string[];
}

/** One step of a running import, as the page's progress bar shows it. */
export interface ImportProgress {
  text: string;
  done?: number;
  total?: number;
}

/** What `watch` yields: progress, then exactly one `done` or `error`. */
export type ImportJobEvent =
  | ({ type: 'progress' } & ImportProgress)
  | { type: 'done'; summary: ImportSummary }
  /** Shown to the admin as it is: plain words, nothing from inside a failure. */
  | { type: 'error'; message: string };

export interface ImportJobs {
  /**
   * Start the import. Answers an id `watch` can find it by. A throw with a
   * `HelpWellError` shows its public message on the form; anything else, a
   * plain "the import stopped part way".
   */
  start(request: ImportJobRequest, context: ImportJobContext): Promise<{ id: string }>;
  /**
   * The job's progress until it ends. The dashboard streams each event to
   * the page as it arrives and stops at the first `done` or `error`; a
   * stream that ends without one is reported as an import that stopped.
   */
  watch(id: string, context: ImportJobContext): AsyncIterable<ImportJobEvent>;
}
