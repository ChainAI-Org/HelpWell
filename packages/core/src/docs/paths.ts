/**
 * Which changed files could change what a customer sees, for hosts that read
 * a change file by file. By default the whole repository counts except tests
 * and fixtures, lockfiles, generated, vendored and built files, CI and editor
 * config, binary assets, anything that could hold a secret, HelpWell's own
 * config and the docs folder. A person can narrow it to a list of globs.
 */

import { extname } from 'node:path';
import { IGNORED_DIRS, isNoise, isSensitive } from './context.js';

/** Lockfiles are never a reason to rewrite an article. */
export function isLockfile(path: string): boolean {
  return (
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|go\.sum)$/.test(
      path,
    ) || /\.lock$/.test(path)
  );
}

const BINARY = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.svg',
  '.mp4',
  '.webm',
  '.mov',
  '.pdf',
  '.zip',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.map',
]);

/** Files that never describe the product to a customer, whatever is watched. */
export function isUnwatched(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.some((segment) => IGNORED_DIRS.has(segment) || segment === 'generated') ||
    segments[0] === '.github' ||
    segments[0] === '.vscode' ||
    segments[0] === '.idea' ||
    segments[0] === 'helpwell' ||
    isNoise(path) ||
    isLockfile(path) ||
    isSensitive(path) ||
    BINARY.has(extname(path).toLowerCase())
  );
}

/**
 * A glob as a regular expression: `**` is any number of folders, `*` anything
 * but a slash, `?` one character. A glob with no slash matches a file name at
 * any depth (`*.md`), and a folder glob matches everything under it (`src/`,
 * `src/billing`).
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim().replace(/^\.?\//, '');
  if (pattern.endsWith('/')) pattern = `${pattern}**`;
  const anyDepth = !pattern.includes('/');
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        const slash = pattern[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // `src/billing` also means everything under it.
  return new RegExp(`^${anyDepth ? '(?:.*/)?' : ''}${out}(?:/.*)?$`);
}

/**
 * Whether a change to `path` is worth reading for the docs. `globs` narrows
 * the repository (a leading `!` takes paths out again); empty watches all of
 * it. `docs` is the docs folder, which syncs on its own and is never read as
 * a code change.
 */
export function isWatched(
  path: string,
  globs: readonly string[] = [],
  docs?: string | null,
): boolean {
  const clean = path.replace(/^\/+/, '');
  if (docs && (clean === docs || clean.startsWith(`${docs}/`))) return false;
  if (isUnwatched(clean)) return false;
  const include = globs.filter((g) => g.trim() && !g.trim().startsWith('!'));
  const exclude = globs
    .filter((g) => g.trim().startsWith('!'))
    .map((g) => g.trim().slice(1))
    .filter(Boolean);
  if (exclude.some((g) => globToRegExp(g).test(clean))) return false;
  return include.length === 0 || include.some((g) => globToRegExp(g).test(clean));
}
