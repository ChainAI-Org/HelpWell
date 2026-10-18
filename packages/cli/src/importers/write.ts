/**
 * Writing imported articles into the docs folder.
 *
 * What is written, and how, is core's (`writeImportPlan` in
 * `@helpwell/core/import`), shared with the dashboard's importer. This is
 * the repo's side of it: articles and `_meta.json` files in the docs folder,
 * images under `docs/_images/<collection>/`, and the old URLs merged into
 * `helpwell/redirects.json`, all to be reviewed and committed like any other
 * change before `helpwell sync` indexes them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { mergeRedirects, parseRedirects, stringifyRedirects } from '@helpwell/core/content';
import {
  type ImportPlan,
  type ImportTarget,
  type ImportWriteResult,
  writeImportPlan,
} from '@helpwell/core/import';

export type { ImportedArticle, ImportedCollection, ImportPlan } from '@helpwell/core/import';

export type WriteResult = ImportWriteResult;

export interface WriteOptions {
  docsDir: string;
  /** helpwell/redirects.json, merged with what is already there. */
  redirectsPath: string;
  /** Where the help centre is mounted, for the redirect targets. Default /help. */
  helpPath?: string;
  /** Replace files that already exist. */
  force?: boolean;
  /** Write every article as a draft, whatever the source said. */
  draft?: boolean;
  /** Download remote images next to the docs. Default true. */
  downloadImages?: boolean;
  dryRun?: boolean;
  fetch?: typeof fetch;
}

export async function writeImport(plan: ImportPlan, options: WriteOptions): Promise<WriteResult> {
  const file = (path: string) => join(options.docsDir, ...path.split('/'));
  const target: ImportTarget = {
    async exists(path) {
      return existsSync(file(path));
    },
    async write(path, text) {
      mkdirSync(dirname(file(path)), { recursive: true });
      writeFileSync(file(path), text, 'utf8');
    },
    // Next to the docs, one folder per collection, named after the article.
    async image(image) {
      const name = `${image.articleName}-${image.index}${image.ext || '.png'}`;
      const path = join(options.docsDir, '_images', image.collectionId, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, image.bytes);
      return `../_images/${image.collectionId}/${name}`;
    },
    async redirects(rules) {
      let existing: ReturnType<typeof parseRedirects> = null;
      try {
        existing = parseRedirects(readFileSync(options.redirectsPath, 'utf8'));
      } catch {
        // No file yet: start one.
      }
      mkdirSync(dirname(options.redirectsPath), { recursive: true });
      writeFileSync(
        options.redirectsPath,
        stringifyRedirects(mergeRedirects(existing ?? [], rules)),
        'utf8',
      );
    },
    shown(path) {
      return relative(process.cwd(), file(path)) || file(path);
    },
  };
  return writeImportPlan(plan, target, {
    helpPath: options.helpPath,
    force: options.force,
    draft: options.draft,
    downloadImages: options.downloadImages,
    dryRun: options.dryRun,
    fetch: options.fetch,
  });
}
