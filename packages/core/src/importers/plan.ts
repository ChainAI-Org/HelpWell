/**
 * What every importer hands over: a plan of articles in collections.
 *
 * Every source (a folder of Markdown, a ZIP of a Notion export, a Zendesk
 * help centre, a crawl) is turned into the same list of `ImportedArticle`s,
 * and one writer (write.ts) turns that into files, so the rules live in one
 * place whether the CLI writes them into a repo or the dashboard writes them
 * through a content source.
 */

import type { ImportFiles } from './files.js';

export interface ImportedCollection {
  /** Folder name; derived from the title when absent. */
  id?: string;
  title: string;
  description?: string | null;
  order?: number | null;
}

export interface ImportedArticle {
  title: string;
  /** Markdown. HTML sources convert before they get here. */
  body: string;
  description?: string | null;
  collection: ImportedCollection;
  /** The file name to use, without extension. Derived from the title when absent. */
  slug?: string;
  status?: 'draft' | 'published';
  order?: number | null;
  /** Where the article lived before, for the redirect map. */
  sourceUrl?: string | null;
  /**
   * The folder the article's file sat in, so the images it references by a
   * relative path can be brought with it: a path inside the plan's `files`
   * ('' for the top), or, for a plan with no `files`, a folder on disk.
   */
  assetDir?: string | null;
}

export interface ImportPlan {
  /** Which reader made it: `markdown`, `html`, `gitbook`, `notion`, `zendesk`, `crawl`… */
  source: string;
  articles: ImportedArticle[];
  /** Things the source reader could not read, said plainly. */
  warnings: string[];
  /**
   * The files the articles were read from, when they came from a folder or
   * an archive: where their relative images are read from.
   */
  files?: ImportFiles;
}
