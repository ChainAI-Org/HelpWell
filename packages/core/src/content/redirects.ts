/**
 * Old help centre URLs and the articles they became: the redirect map.
 *
 * An import writes one, mapping each article's URL on the platform it came
 * from to its path in this help centre, so links in search results, bookmarks
 * and other people's pages keep working once the old domain points here. In
 * a repo the file is `helpwell/redirects.json`, beside the config. An install
 * whose content is managed for it has no repo, so its map is a file among its
 * content, `_redirects.json` at the docs root, read and written through its
 * `ContentSource` like the articles, and edited on the dashboard's Redirects
 * screen. Both are the same JSON: `{ "redirects": [{ "from", "to" }] }`.
 *
 * The file is written from what a third party's API or pages said, and a
 * person can edit it, so nothing here trusts a target: the help centre only
 * ever sends someone to a path inside itself (helpcenter/redirects.ts), and
 * the dashboard only writes targets that are its own articles.
 */

import type { ContentSource } from './source.js';

export interface RedirectRule {
  /** The old URL, absolute or a path. Only its path is matched. */
  from: string;
  /** The article it became: a path in this help centre, such as `/help/billing/refunds`. */
  to: string;
}

/** Where a managed install keeps its redirect map among its content, at the docs root. */
export const CONTENT_REDIRECTS_PATH = '_redirects.json';

/** More rules than any help centre has articles; a file beyond it is cut there. */
export const MAX_REDIRECTS = 10_000;

/** An origin nothing can reach, to resolve relative paths the way a browser would. */
const PROBE = 'http://help.invalid';

/**
 * The rules in a redirects file: `{ "redirects": [...] }`, or a bare array.
 * Null when the text is not that shape at all; entries without a string
 * `from` and `to` are left out.
 */
export function parseRedirects(text: string): RedirectRule[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { redirects?: unknown } | null)?.redirects)
      ? (parsed as { redirects: unknown[] }).redirects
      : null;
  if (list === null) return null;
  return list
    .filter(
      (rule): rule is RedirectRule =>
        typeof (rule as RedirectRule | null)?.from === 'string' &&
        typeof (rule as RedirectRule | null)?.to === 'string',
    )
    .map((rule) => ({ from: rule.from, to: rule.to }));
}

/** The file for a set of rules, as the importer and the dashboard write it. */
export function stringifyRedirects(rules: readonly RedirectRule[]): string {
  return `${JSON.stringify({ redirects: rules.map(({ from, to }) => ({ from, to })) }, null, 2)}\n`;
}

/**
 * The path an old URL is matched by, with no trailing slash: from an
 * absolute http(s) URL or a path. Null for anything else, and for the root,
 * which is the help centre's own home.
 */
export function redirectSourcePath(from: unknown): string | null {
  if (typeof from !== 'string' || !from.trim() || from.length > 2048) return null;
  try {
    const url = new URL(from.trim(), `${PROBE}/`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return path === '/' ? null : path;
  } catch {
    return null;
  }
}

/**
 * Whether `to` is a target worth keeping: a plain path on this site, such as
 * `/help/billing/refunds`. No scheme, no `//host`, no backslash, whitespace,
 * control character, query or fragment. The help centre checks every target
 * again when it answers, against where it is mounted; this is the check for
 * what is written into the map in the first place.
 */
export function isRedirectTarget(to: unknown): to is string {
  if (typeof to !== 'string' || to.length === 0 || to.length > 2048) return false;
  if (!to.startsWith('/') || to.startsWith('//')) return false;
  if (/[\\\s?#]/.test(to)) return false;
  return [...to].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f);
}

/**
 * `add` folded into `existing`, one rule per old path: a new rule for a path
 * already mapped replaces it, where it was. What an import does to the map
 * that is already there.
 */
export function mergeRedirects(
  existing: readonly RedirectRule[],
  add: readonly RedirectRule[],
): RedirectRule[] {
  const key = (rule: RedirectRule) => redirectSourcePath(rule.from) ?? rule.from;
  const byPath = new Map<string, RedirectRule>();
  for (const rule of existing) if (!byPath.has(key(rule))) byPath.set(key(rule), rule);
  for (const rule of add) byPath.set(key(rule), { from: rule.from, to: rule.to });
  return [...byPath.values()].slice(0, MAX_REDIRECTS);
}

/** The redirect map a content source holds: none when it has no file, or one that is not a map. */
export async function readContentRedirects(source: ContentSource): Promise<RedirectRule[]> {
  let text: string | null;
  try {
    text = await source.readText(CONTENT_REDIRECTS_PATH);
  } catch {
    return [];
  }
  if (text === null) return [];
  return (parseRedirects(text) ?? []).slice(0, MAX_REDIRECTS);
}

/** Replace the redirect map a content source holds. The source must be writable. */
export async function writeContentRedirects(
  source: ContentSource,
  rules: readonly RedirectRule[],
): Promise<void> {
  if (!source.write) throw new Error('This content source cannot be written to.');
  await source.write(CONTENT_REDIRECTS_PATH, stringifyRedirects(rules.slice(0, MAX_REDIRECTS)));
}
