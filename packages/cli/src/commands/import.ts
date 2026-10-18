/**
 * `helpwell import` — bring docs and contacts over from wherever they live now.
 *
 * Articles land as Markdown files in the docs folder, with a `_meta.json` per
 * new collection and a redirect map from the old URLs, and nothing is indexed
 * until `helpwell sync`: an import is a change to review like any other.
 * Contacts go straight into the database, labelled `import` with consent
 * `unknown` (MG-04); `--dry-run` runs the whole import inside a transaction
 * and rolls it back, so its counts are the real ones.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { contactImportPromptSpec, formatSetupPrompt, HelpWellError } from '@helpwell/core';
import { type ImportContactsResult, importContacts } from '@helpwell/core/repos';
import { readContactsFile } from '../importers/contacts.js';
import { crawlSite } from '../importers/crawl.js';
import { readGitbook, readHtmlFolder, readMarkdownFolder, readNotion } from '../importers/local.js';
import { importFromPlatform, isPlatform, PLATFORMS } from '../importers/platforms.js';
import { type ImportPlan, type WriteResult, writeImport } from '../importers/write.js';
import { loadProject, openDb } from '../project.js';
import { detail, heading, ok, progress, say, table, warn } from '../ui.js';

export const IMPORT_SOURCES = [
  'markdown',
  'html',
  'gitbook',
  'notion',
  ...PLATFORMS,
  'crawl',
  'contacts',
] as const;

export interface ImportOptions {
  cwd: string;
  url?: string;
  /** A source name, or a folder or file to detect one from. */
  source?: string;
  /** The folder, file or URL the source reads. */
  target?: string;
  dryRun?: boolean;
  /** Replace article files that already exist. */
  force?: boolean;
  /** Write every article as a draft. */
  draft?: boolean;
  /** Download remote images next to the docs. Default true. */
  images?: boolean;
  /** Collection for files at the top of a folder. */
  collection?: string;
  subdomain?: string;
  locale?: string;
  email?: string;
  websiteId?: string;
  /** Crawl: stop after this many pages. */
  max?: number;
  /** Print the setup prompt for moving contacts, and import nothing. */
  prompt?: boolean;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export interface ImportResult {
  source: string;
  kind: 'articles' | 'contacts' | 'prompt';
  dryRun: boolean;
  warnings: string[];
  articles?: WriteResult & { found: number };
  contacts?: ImportContactsResult & { rows: number };
  prompt?: string;
}

/** Work out the source from a path: a CSV or JSON file is contacts, a folder is docs. */
export function detectSource(path: string): string {
  if (!existsSync(path)) return 'unknown';
  if (!statSync(path).isDirectory()) {
    return ['.csv', '.json'].includes(extname(path).toLowerCase()) ? 'contacts' : 'unknown';
  }
  if (existsSync(join(path, 'SUMMARY.md'))) return 'gitbook';
  const names: string[] = [];
  const visit = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue;
      names.push(entry);
      const full = join(dir, entry);
      if (depth < 3 && statSync(full).isDirectory()) visit(full, depth + 1);
    }
  };
  visit(path, 0);
  if (names.some((name) => /\s[0-9a-f]{32}(\.(md|html))?$/i.test(name))) return 'notion';
  const html = names.filter((name) => /\.html?$/i.test(name)).length;
  const md = names.filter((name) => /\.mdx?$/i.test(name)).length;
  return html > md ? 'html' : 'markdown';
}

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  if (options.prompt) {
    const prompt = formatSetupPrompt(contactImportPromptSpec());
    say(prompt);
    return { source: 'contacts', kind: 'prompt', dryRun: true, warnings: [], prompt };
  }

  const project = loadProject(options.cwd);
  let source = options.source;
  let target = options.target;
  // `helpwell import ./export` or `helpwell import contacts.csv`: the path says what it is.
  if (source && !(IMPORT_SOURCES as readonly string[]).includes(source)) {
    target = source;
    source = detectSource(resolve(options.cwd, source));
  }
  if (!source || source === 'unknown') {
    throw new HelpWellError(
      'bad_request',
      `Import from what? One of: ${IMPORT_SOURCES.join(', ')}, or a folder or CSV file.`,
    );
  }
  const where = (value: string | undefined, what: string) => {
    if (!value) throw new HelpWellError('bad_request', `helpwell import ${source} needs ${what}.`);
    return isAbsolute(value) ? value : resolve(options.cwd, value);
  };

  if (source === 'contacts') {
    return importContactFile(project.paths, where(target, 'a CSV or JSON file'), options);
  }

  heading(`Importing from ${source}`);
  const bar = progress('Reading');
  let plan: ImportPlan;
  if (source === 'markdown') plan = readMarkdownFolder(where(target, 'a folder'), options);
  else if (source === 'html') plan = readHtmlFolder(where(target, 'a folder'), options);
  else if (source === 'gitbook') plan = readGitbook(where(target, 'a folder'));
  else if (source === 'notion') plan = readNotion(where(target, 'a folder'));
  else if (source === 'crawl') {
    if (!target) throw new HelpWellError('bad_request', 'helpwell import crawl needs a URL.');
    plan = await crawlSite(target, {
      max: options.max,
      fetch: options.fetch,
      onProgress: (text) => bar.update(text),
    });
  } else if (isPlatform(source)) {
    plan = await importFromPlatform(source, {
      fetch: options.fetch,
      env: options.env,
      subdomain: options.subdomain ?? target,
      locale: options.locale,
      email: options.email,
      websiteId: options.websiteId ?? target,
      onProgress: (text) => bar.update(text),
    });
  } else {
    throw new HelpWellError('bad_request', `Unknown import source: ${source}`);
  }
  bar.done(`Found ${plan.articles.length} article${plan.articles.length === 1 ? '' : 's'}`);

  const written = await writeImport(plan, {
    docsDir: project.paths.docsDir,
    redirectsPath: join(project.paths.helpwellDir, 'redirects.json'),
    helpPath: project.config.settings.helpCenter.subpath || '/help',
    force: options.force,
    draft: options.draft,
    downloadImages: options.images !== false,
    dryRun: options.dryRun,
    fetch: options.fetch,
  });

  say();
  table([
    [options.dryRun ? 'Would write' : 'Written', `${written.written.length} articles`],
    ['Collections', written.collections.join(', ') || '—'],
    ['Skipped', String(written.skipped.length)],
    ['Images', `${written.images.saved} saved, ${written.images.failed} could not be fetched`],
    ['Redirects', written.redirects > 0 ? `${written.redirects} in helpwell/redirects.json` : '—'],
  ]);
  for (const skip of written.skipped.slice(0, 10)) detail(`${skip.path}: ${skip.reason}`);
  for (const message of plan.warnings) warn(message);
  say();
  if (!options.dryRun && written.written.length > 0) {
    ok('Review the files, then run `helpwell sync` to index them.');
  }

  return {
    source: plan.source,
    kind: 'articles',
    dryRun: options.dryRun ?? false,
    warnings: plan.warnings,
    articles: { ...written, found: plan.articles.length },
  };
}

class DryRunRollback extends Error {}

async function importContactFile(
  paths: ReturnType<typeof loadProject>['paths'],
  file: string,
  options: ImportOptions,
): Promise<ImportResult> {
  const format = extname(file).toLowerCase() === '.json' ? 'json' : 'csv';
  const rows = readContactsFile(readFileSync(file, 'utf8'), format);
  heading(options.dryRun ? 'Checking the contacts import' : 'Importing contacts');
  detail(`${rows.length} rows in ${file}`);

  const handle = await openDb(paths, { url: options.url });
  let result: ImportContactsResult;
  try {
    if (options.dryRun) {
      let counted: ImportContactsResult | null = null;
      try {
        await handle.db.transaction(async (tx: unknown) => {
          counted = await importContacts(tx as unknown as typeof handle.db, rows);
          throw new DryRunRollback();
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
      result = counted!;
    } else {
      result = await importContacts(handle.db, rows);
    }
  } finally {
    await handle.close();
  }

  say();
  table([
    [options.dryRun ? 'Would create' : 'Created', String(result.created)],
    [options.dryRun ? 'Would update' : 'Updated', String(result.updated)],
    ['Skipped', String(result.skipped.length)],
  ]);
  for (const skip of result.skipped.slice(0, 10)) detail(`row ${skip.row}: ${skip.reason}`);
  say();
  detail('Imported contacts are labelled Import, with consent not given.');
  say();
  return {
    source: 'contacts',
    kind: 'contacts',
    dryRun: options.dryRun ?? false,
    warnings: [],
    contacts: { ...result, rows: rows.length },
  };
}
