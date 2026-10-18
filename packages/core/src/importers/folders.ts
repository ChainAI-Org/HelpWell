/**
 * Reading articles out of a folder: plain Markdown, plain HTML, a GitBook
 * repository, or a Notion export.
 *
 * Folders are the one import that needs no credentials, and they cover every
 * tool that can export: most help desks export HTML, GitBook syncs Markdown
 * to git, and Notion exports either. The first folder level becomes the
 * collection; deeper folders flatten into it. The folder can be on disk (the
 * CLI) or an uploaded archive (the dashboard): see files.ts.
 */

import { posix } from 'node:path';
import { parseFrontmatter } from '../content/frontmatter.js';
import { titleCase } from '../content/naming.js';
import type { ImportFiles } from './files.js';
import { htmlTitle, htmlToMarkdown, mainContent } from './html-to-markdown.js';
import type { ImportedArticle, ImportPlan } from './plan.js';

/** Files a docs folder has that are not articles. */
const NOT_ARTICLES = new Set(['readme.md', 'summary.md', 'changelog.md', 'license.md']);

/** The folder formats, in the order `detectFolderSource` weighs them. */
export const FOLDER_SOURCES = ['markdown', 'html', 'gitbook', 'notion'] as const;
export type FolderSource = (typeof FOLDER_SOURCES)[number];

/** The files with these extensions, leaving out anything under an underscored folder. */
function walk(files: ImportFiles, extensions: string[]): string[] {
  return files
    .paths()
    .filter(
      (path) =>
        extensions.includes(posix.extname(path).toLowerCase()) &&
        !path.split('/').some((segment) => segment.startsWith('_')),
    );
}

function text(files: ImportFiles, path: string): string {
  const bytes = files.read(path);
  return bytes ? new TextDecoder().decode(bytes).replace(/^﻿/, '') : '';
}

/** The collection a file belongs to: its first folder. */
function collectionOf(path: string, fallback: string, clean = (s: string) => s) {
  const parts = path.split('/');
  if (parts.length < 2) return { title: fallback };
  return { title: titleCase(clean(parts[0]!)) };
}

/** A file's name as a slug, with deeper folders folded in: `a/b/c.md` in `a` is `b-c`. */
function slugOf(path: string, clean = (s: string) => s): string {
  const parts = path.split('/').map(clean);
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  return rest.join('-').replace(/\.(md|mdx|html?)$/i, '');
}

function folderOf(path: string): string {
  const dir = posix.dirname(path);
  return dir === '.' ? '' : dir;
}

function firstHeading(markdown: string): string | null {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? null;
}

/**
 * What a folder is, from what is in it: a GitBook repository has a
 * SUMMARY.md, a Notion export names every page with a 32-character id, and
 * otherwise whichever of HTML or Markdown there is more of.
 */
export function detectFolderSource(files: ImportFiles): FolderSource {
  const paths = files.paths();
  if (paths.some((path) => path.toLowerCase() === 'summary.md')) return 'gitbook';
  const names = paths.flatMap((path) => path.split('/'));
  if (names.some((name) => /\s[0-9a-f]{32}(\.(md|html))?$/i.test(name))) return 'notion';
  const html = paths.filter((path) => /\.html?$/i.test(path)).length;
  const md = paths.filter((path) => /\.mdx?$/i.test(path)).length;
  return html > md ? 'html' : 'markdown';
}

/** Read a folder as `source` says, or as `detectFolderSource` decides. */
export function readFolder(
  files: ImportFiles,
  source: FolderSource | 'auto' = 'auto',
  options: { collection?: string } = {},
): ImportPlan {
  const kind = source === 'auto' ? detectFolderSource(files) : source;
  if (kind === 'html') return readHtmlFiles(files, options);
  if (kind === 'gitbook') return readGitbookFiles(files);
  if (kind === 'notion') return readNotionFiles(files);
  return readMarkdownFiles(files, options);
}

export function readMarkdownFiles(
  files: ImportFiles,
  options: { collection?: string } = {},
): ImportPlan {
  const fallback = options.collection ?? titleCase(files.name) ?? 'General';
  const articles: ImportedArticle[] = [];
  for (const path of walk(files, ['.md', '.mdx'])) {
    if (NOT_ARTICLES.has(posix.basename(path).toLowerCase())) continue;
    const { data, content } = parseFrontmatter(text(files, path));
    const title =
      (typeof data.title === 'string' && data.title) ||
      firstHeading(content) ||
      titleCase(posix.basename(path).replace(/\.mdx?$/i, ''));
    articles.push({
      title,
      body: content,
      description: typeof data.description === 'string' ? data.description : null,
      collection: collectionOf(path, fallback),
      slug: slugOf(path),
      status: data.status === 'draft' ? 'draft' : 'published',
      order: typeof data.order === 'number' ? data.order : null,
      assetDir: folderOf(path),
    });
  }
  return { source: 'markdown', articles, warnings: [], files };
}

export function readHtmlFiles(
  files: ImportFiles,
  options: { collection?: string } = {},
): ImportPlan {
  const fallback = options.collection ?? titleCase(files.name);
  const articles: ImportedArticle[] = [];
  const warnings: string[] = [];
  for (const path of walk(files, ['.html', '.htm'])) {
    const page = text(files, path);
    const body = htmlToMarkdown(mainContent(page));
    if (!body.trim()) {
      warnings.push(`${path} has no readable content; skipped.`);
      continue;
    }
    articles.push({
      title: htmlTitle(page) ?? titleCase(posix.basename(path).replace(/\.html?$/i, '')),
      body,
      collection: collectionOf(path, fallback),
      slug: slugOf(path),
      assetDir: folderOf(path),
    });
  }
  return { source: 'html', articles, warnings, files };
}

/**
 * A GitBook repository. SUMMARY.md is the table of contents: each `## Group`
 * heading is a collection and each linked page under it an article, in order.
 * Without a SUMMARY.md it reads as a plain Markdown folder.
 */
export function readGitbookFiles(files: ImportFiles): ImportPlan {
  const summaryPath = files.paths().find((path) => path.toLowerCase() === 'summary.md');
  if (!summaryPath) {
    const plan = readMarkdownFiles(files);
    for (const article of plan.articles) article.body = gitbookToMarkdown(article.body);
    return { ...plan, source: 'gitbook', warnings: ['No SUMMARY.md; read the folder instead.'] };
  }
  const summary = text(files, summaryPath);

  const articles: ImportedArticle[] = [];
  const warnings: string[] = [];
  let group = titleCase(files.name);
  let order = 0;
  for (const line of summary.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      group = heading[1]!.trim();
      continue;
    }
    const link = /^\s*[*-]\s+\[([^\]]+)\]\(([^)]+)\)/.exec(line);
    if (!link) continue;
    let path: string;
    try {
      path = decodeURIComponent(link[2]!.split('#')[0]!);
    } catch {
      continue;
    }
    if (!/\.md$/i.test(path)) continue;
    const file = posix.normalize(path.replace(/^\.?\//, ''));
    const bytes = files.read(file);
    if (bytes === null) {
      warnings.push(`SUMMARY.md links to ${path}, which is not there.`);
      continue;
    }
    const { data, content } = parseFrontmatter(new TextDecoder().decode(bytes));
    const folder = folderOf(file);
    articles.push({
      title: link[1]!.trim(),
      body: gitbookToMarkdown(content),
      description: typeof data.description === 'string' ? data.description : null,
      collection: { title: group },
      slug:
        posix.basename(file).toLowerCase() === 'readme.md'
          ? posix.basename(folder || files.name)
          : posix.basename(file, posix.extname(file)),
      order: order++,
      assetDir: folder,
    });
  }
  return { source: 'gitbook', articles, warnings, files };
}

/** GitBook's `{% ... %}` blocks, as plain Markdown. */
export function gitbookToMarkdown(markdown: string): string {
  return markdown
    .replace(
      /\{%\s*hint\s+style="(\w+)"\s*%\}([\s\S]*?)\{%\s*endhint\s*%\}/g,
      (_, style: string, inner: string) =>
        `\n${inner
          .trim()
          .split('\n')
          .map((line, i) => `> ${i === 0 ? `**${titleCase(style)}:** ` : ''}${line}`.trimEnd())
          .join('\n')}\n`,
    )
    .replace(/\{%\s*embed\s+url="([^"]+)"\s*%\}/g, '[$1]($1)')
    .replace(/\{%\s*tab\s+title="([^"]+)"\s*%\}/g, '\n### $1\n')
    .replace(
      /\{%\s*content-ref\s+url="([^"]+)"\s*%\}[\s\S]*?\{%\s*endcontent-ref\s*%\}/g,
      '[$1]($1)',
    )
    .replace(/\{%[^%]*%\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Notion puts a 32-character id after every page name: "Billing 1a2b…". */
export function stripNotionId(name: string): string {
  return name.replace(/\s+[0-9a-f]{32}(?=(\.[a-z]+)?$)/i, '').trim();
}

/**
 * A Notion export ("Markdown & CSV", or HTML). Top-level pages that have
 * children become collections; their children become the articles.
 */
export function readNotionFiles(files: ImportFiles): ImportPlan {
  const html = walk(files, ['.html']).length > walk(files, ['.md']).length;
  const plan = html ? readHtmlFiles(files) : readMarkdownFiles(files);
  const clean = (s: string) => stripNotionId(s);
  for (const article of plan.articles) {
    article.title = stripNotionId(article.title);
    article.slug = clean(article.slug ?? article.title);
    article.collection = { title: stripNotionId(article.collection.title) };
  }
  // Recompute collections from folder names with their ids removed.
  const paths = walk(files, html ? ['.html'] : ['.md']).filter(
    (path) => !NOT_ARTICLES.has(posix.basename(path).toLowerCase()),
  );
  paths.forEach((path, i) => {
    const article = plan.articles[i];
    if (!article) return;
    article.collection = collectionOf(path, titleCase(clean(files.name)), clean);
    article.slug = slugOf(path, clean);
  });
  return { ...plan, source: 'notion' };
}
