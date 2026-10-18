/**
 * Reading articles out of a folder on disk: plain Markdown, plain HTML, a
 * GitBook repository, or a Notion export.
 *
 * The readers live in core (`@helpwell/core/import`), where they read any
 * folder of files, an uploaded archive included; these hand them a folder
 * on disk, which is what `helpwell import <folder>` points at.
 */

import {
  diskImportFiles,
  type ImportPlan,
  readGitbookFiles,
  readHtmlFiles,
  readMarkdownFiles,
  readNotionFiles,
} from '@helpwell/core/import';

export { gitbookToMarkdown, stripNotionId } from '@helpwell/core/import';

export function readMarkdownFolder(
  root: string,
  options: { collection?: string } = {},
): ImportPlan {
  return readMarkdownFiles(diskImportFiles(root), options);
}

export function readHtmlFolder(root: string, options: { collection?: string } = {}): ImportPlan {
  return readHtmlFiles(diskImportFiles(root), options);
}

/**
 * A GitBook repository. SUMMARY.md is the table of contents: each `## Group`
 * heading is a collection and each linked page under it an article, in order.
 * Without a SUMMARY.md it reads as a plain Markdown folder.
 */
export function readGitbook(root: string): ImportPlan {
  return readGitbookFiles(diskImportFiles(root));
}

/**
 * A Notion export ("Markdown & CSV", or HTML). Top-level pages that have
 * children become collections; their children become the articles.
 */
export function readNotion(root: string): ImportPlan {
  return readNotionFiles(diskImportFiles(root));
}
