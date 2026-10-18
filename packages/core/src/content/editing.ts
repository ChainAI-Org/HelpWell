/**
 * Editing an article from the dashboard or the API.
 *
 * The repo stays the source of truth, so HelpWell never writes a file itself.
 * The host app hands it a `writeArticle(path, markdown)` hook, the same way it
 * hands the dashboard `writeInstructions`: in development that writes to disk,
 * in production it might commit through the GitHub API. Without one, the
 * editor still works and offers the file to copy or download, with the exact
 * path to save it to.
 *
 * What lives here is the part with no database and no disk: which paths are
 * acceptable, where a new article goes, and how edited fields are folded back
 * into a file without losing the front matter HelpWell does not know about.
 */

import { slugify } from './articles.js';
import { type Frontmatter, parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

/**
 * Save an article's Markdown in the repo.
 *
 * `path` is relative to the docs folder, always `<collection>/<file>.md`, and
 * has been checked with `isArticlePath` before the hook is called. `markdown`
 * is the whole file, front matter included. Throw to refuse; the message is
 * shown to the person who pressed Save.
 */
export type WriteArticle = (path: string, markdown: string) => Promise<void> | void;

export type ArticleStatus = 'draft' | 'published' | 'archived';

export const ARTICLE_STATUSES: readonly ArticleStatus[] = ['draft', 'published', 'archived'];

/** The largest article the editor will save. Far beyond any help article. */
export const MAX_ARTICLE_BYTES = 200 * 1024;

/**
 * Whether `path` is somewhere an article can be written: a collection folder
 * and a Markdown file inside it, which is the only depth the knowledge base
 * is read at. Nothing hidden or underscored (those folders are skipped when
 * reading, so an article there would vanish), no `..`, no backslash, no drive
 * letter and no control character. A hook can trust it not to leave the
 * docs folder.
 */
export function isArticlePath(path: string): boolean {
  const parts = path.split('/');
  if (parts.length !== 2) return false;
  const plain = parts.every(
    (part) =>
      part.length > 0 &&
      part.length <= 200 &&
      part.trim() === part &&
      !/^[._]/.test(part) &&
      !/[\\:*?"<>|]/.test(part) &&
      [...part].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f),
  );
  return plain && /\.mdx?$/i.test(parts[1] ?? '');
}

/** A collection folder name for a new article: an existing id, or one made from a title. */
export function collectionId(name: string): string {
  return slugify(name) || 'help';
}

/** Where a new article with this title goes: `billing/exporting-invoices.md`. */
export function newArticlePath(collection: string, title: string): string {
  return `${collectionId(collection)}/${slugify(title) || 'untitled'}.md`;
}

/** Why a published article with nothing in it is refused, in the words the editor shows. */
export const EMPTY_ARTICLE_MESSAGE =
  'A published article needs a body. Write it, or save it as a draft for now.';

/**
 * Whether an article's body has nothing a reader would see: blank, or only a
 * heading repeating the title the page already shows above it. Saved as a
 * draft that is fine, work in progress. Published it would be an empty page
 * in the help centre and a passage with nothing in it for the agent, which is
 * what a failed AI draft published as it stood used to produce.
 */
export function isEmptyArticleBody(body: string, title: string): boolean {
  const plain = (text: string) =>
    text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const rest = body
    .replace(/^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/, (heading, text: string) =>
      plain(text) === plain(title) ? '' : heading,
    )
    .trim();
  return rest.length === 0;
}

export interface ArticleFields {
  title: string;
  description?: string | null;
  status?: ArticleStatus;
}

/**
 * The file to save: `fields` written into the front matter of `original` (or
 * of nothing, for a new article), then the body.
 *
 * Keys the editor does not show — `order`, `appliesTo`, `slug`, tags — are
 * kept as they were and where they were, so saving from the dashboard never
 * quietly drops something a person put there by hand.
 */
export function composeArticle(fields: ArticleFields, body: string, original?: string): string {
  const data: Frontmatter = original ? { ...parseFrontmatter(original).data } : {};
  data.title = fields.title.trim();
  const description = fields.description?.trim();
  if (description) data.description = description;
  else delete data.description;
  if (fields.status) data.status = fields.status;
  return stringifyFrontmatter(data, body);
}
