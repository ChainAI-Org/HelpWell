/**
 * Old help centre URLs, sent on to the articles they became (KB-15, MG-03).
 *
 * `helpwell import` writes helpwell/redirects.json, mapping each article's
 * URL on the platform it came from to its path here. Links to those old URLs
 * live on in search results, bookmarks and other people's pages, and moving
 * the old domain over to this help centre should not break them. So a
 * request that would otherwise be a 404 has its path looked up in that map,
 * and a match is answered with a 301 to the article.
 *
 * The file is written from what a third party's API or pages said, so a
 * target is only ever a path inside this help centre. An absolute URL, a
 * `//host`, a backslash or anything that resolves outside the mount is
 * ignored, which is what keeps this from becoming an open redirect.
 *
 * The file is read when first needed and read again whenever it changes, so
 * an import is live the moment it is written, no restart needed. An install
 * whose knowledge base comes from a content source keeps the same map among
 * its content (`_redirects.json`, which the dashboard's Redirects screen and
 * its importer write), and it is read through that source the same way.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CONTENT_REDIRECTS_PATH,
  type ContentSource,
  parseRedirects,
  type RedirectRule,
  redirectSourcePath,
} from '@helpwell/core/content';
import type { SettingsStore } from '@helpwell/core/settings';
import { link, mountPath, stripMountPath } from '@helpwell/ui';

export { parseRedirects, type RedirectRule };

/**
 * Where redirects come from: the path of a JSON file (relative to the
 * working directory), the rules themselves, or `false` for none.
 */
export type RedirectsOption = string | readonly RedirectRule[] | false;

/** What `helpwell import` writes, from the repo root. */
export const DEFAULT_REDIRECTS_FILE = 'helpwell/redirects.json';

/** Where the help centre is, which targets are resolved against. */
export interface RedirectMounts {
  /** Where it is mounted now, as `mountPath` gives it: '' at the root. */
  basePath: string;
  /**
   * The help centre path the importer wrote targets under: the
   * `helpCenter.subpath` setting. A target under it is moved under
   * `basePath`, so a help centre mounted somewhere else still lands on the
   * article.
   */
  writtenUnder: string;
}

/** Old path to target, as written. Targets are checked per request, against the mount. */
type RuleMap = ReadonlyMap<string, string>;

const NONE: RuleMap = new Map();

/** A browser keeps a 301 for as long as it likes; a day lets a mistake be corrected. */
const CACHE_CONTROL = 'public, max-age=86400';

/** An origin nothing can reach, to resolve relative paths the way a browser would. */
const PROBE = 'http://help.invalid';

function isControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/** A path with no trailing slash, except the root itself. */
function trimSlash(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

function compile(rules: readonly RedirectRule[]): RuleMap {
  const map = new Map<string, string>();
  for (const rule of rules) {
    const path = redirectSourcePath(rule.from);
    // The first rule for a path wins, the way the importer merges them.
    if (path && !map.has(path)) map.set(path, rule.to);
  }
  return map;
}

/**
 * Where `to` sends someone, as a path inside the help centre, or null when
 * it would leave it.
 *
 * Refused outright: anything with a scheme (`https:`, `javascript:`), a
 * leading `//`, a backslash, whitespace or a control character (a browser
 * drops tabs and newlines, which would turn `/\t/evil.test` into
 * `//evil.test`), and a query or fragment, which no importer writes. What is
 * left is resolved the way a browser would resolve it, and must still be on
 * this origin and under the mount.
 */
export function redirectTarget(to: string, mounts: RedirectMounts): string | null {
  const value = to.trim();
  if (!value || value.length > 2048) return null;
  if (/[\\\s?#]/.test(value) || [...value].some(isControl)) return null;
  if (value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  const rest = value.startsWith('/')
    ? (stripMountPath(value, mounts.writtenUnder) ?? stripMountPath(value, mounts.basePath))
    : `/${value}`;
  if (rest === null) return null;

  let resolved: URL;
  try {
    resolved = new URL(link(mounts.basePath, rest), PROBE);
  } catch {
    return null;
  }
  if (resolved.origin !== PROBE) return null;
  // `/.//evil.test` resolves to the path `//evil.test` on this origin, which
  // a browser would read as another host.
  if (resolved.pathname.startsWith('//')) return null;
  if (stripMountPath(resolved.pathname, mounts.basePath) === null) return null;
  return resolved.pathname;
}

/**
 * The map a content source holds, read again whenever its size or time
 * changes. A source that fails to answer serves no redirects that request,
 * rather than failing a page that was a 404 anyway.
 */
function contentRuleSource(source: ContentSource): () => Promise<RuleMap> {
  let cache: { version: string; rules: RuleMap } | null = null;
  return async () => {
    let version: string;
    try {
      const entry = await source.stat(CONTENT_REDIRECTS_PATH);
      if (!entry) {
        cache = null;
        return NONE;
      }
      version = `${entry.modifiedAt.getTime()}:${entry.size}`;
    } catch {
      return cache?.rules ?? NONE;
    }
    if (cache?.version !== version) {
      let text: string | null;
      try {
        text = await source.readText(CONTENT_REDIRECTS_PATH);
      } catch {
        return cache?.rules ?? NONE;
      }
      cache = { version, rules: compile(text === null ? [] : (parseRedirects(text) ?? [])) };
    }
    return cache.rules;
  };
}

/** Rules from code never change; rules from a file are read again when the file does. */
function ruleSource(option: RedirectsOption | { content: ContentSource }): () => Promise<RuleMap> {
  if (option === false) return async () => NONE;
  if (typeof option === 'object' && 'content' in option) return contentRuleSource(option.content);
  if (typeof option !== 'string') {
    const rules = compile(option);
    return async () => rules;
  }

  const file = resolve(process.cwd(), option);
  let cache: { version: string; rules: RuleMap } | null = null;
  return async () => {
    let version: string;
    try {
      const info = await stat(file);
      version = `${info.mtimeMs}:${info.size}`;
    } catch {
      // No file: nothing was imported, which is the usual case.
      cache = null;
      return NONE;
    }
    if (cache?.version !== version) {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        return NONE;
      }
      const rules = parseRedirects(text);
      // Said once per version of the file, not on every request that misses.
      if (rules === null) {
        console.warn(
          `HelpWell: ${option} is not a redirects file ({ "redirects": [{ "from", "to" }] }), so no redirects are served from it.`,
        );
      }
      cache = { version, rules: compile(rules ?? []) };
    }
    return cache.rules;
  };
}

/**
 * The 301 for a request, or null. `mounts` is asked for only when a rule
 * could apply, since it reads Settings.
 */
export function createRedirects(
  option: RedirectsOption | { content: ContentSource },
): (request: Request, mounts: () => Promise<RedirectMounts>) => Promise<Response | null> {
  const rules = ruleSource(option);
  return async (request, mounts) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const map = await rules();
    if (map.size === 0) return null;

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return null;
    }
    const where = await mounts();
    const full = trimSlash(url.pathname);
    const inside = stripMountPath(url.pathname, where.basePath);
    // The old path as it arrived (the old domain now points here), or under
    // the mount (a proxy that puts everything under /help).
    const to = map.get(full) ?? (inside === null ? undefined : map.get(trimSlash(inside)));
    if (to === undefined) return null;

    const target = redirectTarget(to, where);
    // A rule that points at the page asked for would send the browser round in a loop.
    if (target === null || trimSlash(target) === full) return null;
    return new Response(null, {
      status: 301,
      headers: { location: `${target}${url.search}`, 'cache-control': CACHE_CONTROL },
    });
  };
}

/**
 * The help centre's redirects, as `createHelpCenter` wires them: the file
 * `helpwell import` writes by default; and when the knowledge base comes
 * from a `content` source, the map in that source (`_redirects.json`) and
 * nothing from disk, since a host serving many installs from one process must
 * not hand one install's file to all of them.
 */
export function helpCenterRedirects(
  config: { basePath?: string; content?: ContentSource; redirects?: RedirectsOption },
  store: SettingsStore,
): (request: Request) => Promise<Response | null> {
  const answer = createRedirects(
    config.redirects ?? (config.content ? { content: config.content } : DEFAULT_REDIRECTS_FILE),
  );
  const mounts = async (): Promise<RedirectMounts> => {
    const settings = await store.get();
    return {
      basePath: mountPath(config.basePath ?? settings.helpCenter.subpath ?? '/help'),
      writtenUnder: mountPath(settings.helpCenter.subpath || '/help'),
    };
  };
  return (request) => answer(request, mounts);
}
