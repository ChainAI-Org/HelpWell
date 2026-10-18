/**
 * What a repository can tell a model about the product, within a budget: the
 * README, the manifest, the articles that already exist, routes and handlers,
 * plan and limit definitions, an API description, UI copy, the changelog and
 * a CLI's own help.
 *
 * It works on a list of paths and a reader, so the same selection serves a
 * checkout on disk (`helpwell docs generate`) and a repository read through
 * an API by a host. The rules for which files are noise, which could hold a
 * secret, and which are routes, plans or copy live here too.
 */

import { basename, dirname, extname } from 'node:path';

export interface RepoContext {
  /** The material, one `--- path ---` block per file. */
  text: string;
  /** How many files made it in. */
  files: number;
  chars: number;
  /** Each file that made it in, and how much of it. For `--verbose`. */
  sources: { path: string; chars: number; clipped: boolean }[];
  /** Files that were found but did not fit their budget. For `--verbose`. */
  omitted: string[];
}

/** An article as the context shows it: where it is, its title and its body. */
export interface ContextArticle {
  path: string;
  title: string;
  body: string;
}

interface Piece {
  path: string;
  content: string;
  /** Per-file cap, when smaller than the default. */
  limit?: number;
}

export const TOTAL_BUDGET = 60_000;
const FILE_LIMIT = 6_000;
/** Less room than this and a file would arrive as little more than "[truncated]". */
const MIN_PIECE = 200;
/**
 * Per-source budgets, so one enormous README cannot crowd out the routes and
 * the plan definitions. They add up to a little over the total on purpose:
 * most repos are missing a source or two.
 */
const BUDGET = {
  readme: 8_000,
  manifest: 2_000,
  articles: 10_000,
  routes: 20_000,
  plans: 8_000,
  openapi: 6_000,
  copy: 4_000,
  changelog: 3_000,
  help: 2_000,
} as const;
/** The largest file worth reading. */
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SCANNED = 3_000;

export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  'tmp',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
]);
export const CODE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.php',
  '.cs',
]);
export const TEXT = new Set([
  ...CODE,
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.vue',
  '.svelte',
  '.astro',
  '.graphql',
  '.gql',
  '.sql',
]);
/** A file that wires an HTTP method is a route file whatever it is called. */
export const ROUTE_CALL = /\b(app|router|server)\.(get|post|put|patch|delete|on|route)\(/;

export interface AssembleOptions {
  /** Where the articles live, as the path prefix they are shown under. Defaults to `docs`. */
  docs?: string;
  /** The articles that exist already, bodies included. */
  articles?: ContextArticle[];
  /** The package manifest's summary (`summariseManifest`), when there is one. */
  manifest?: ManifestSummary | null;
  /** A CLI's own `--help`, asked for only when the manifest names a bin. */
  cliHelp?: (bin: string) => string | null;
}

/**
 * The context from `files` (relative paths with forward slashes, already
 * filtered with `isListed`) and `read`, which returns a file's text or null.
 *
 * Read in priority order — README, manifest, existing articles, routes and
 * handlers, plans and limits, API description, UI copy, changelog, CLI help —
 * each source capped so the whole thing stays around 60k characters and every
 * source gets a share. Individual files are cut at 6k. Source comments are
 * kept: they are the best documentation most repos have.
 */
export function assembleRepoContext(
  files: string[],
  read: (path: string) => string | null,
  options: AssembleOptions = {},
): RepoContext {
  const sections: string[] = [];
  const sources: RepoContext['sources'] = [];
  const omitted: string[] = [];
  let remaining = TOTAL_BUDGET;

  /** Add pieces until this source's budget or the total runs out. */
  const add = (budget: number, pieces: Piece[]): number => {
    let left = Math.min(budget, remaining);
    let added = 0;
    for (const piece of pieces) {
      if (left < MIN_PIECE) {
        omitted.push(piece.path);
        continue;
      }
      const trimmed = piece.content.trim();
      const content = clip(trimmed, Math.min(piece.limit ?? FILE_LIMIT, left));
      if (!content) continue;
      sections.push(`--- ${piece.path} ---\n${content}`);
      sources.push({ path: piece.path, chars: content.length, clipped: content !== trimmed });
      left -= content.length;
      remaining -= content.length;
      added++;
    }
    return added;
  };

  const pieces = (paths: string[], limit?: number): Piece[] =>
    paths.flatMap((path) => {
      const content = read(path);
      return content ? [{ path, content, limit }] : [];
    });

  // (a) The README, and docs/README.md when docs/ is not the help folder.
  add(BUDGET.readme, pieces(files.filter((f) => /^(docs\/)?readme\.(md|mdx|txt|rst)$/i.test(f))));

  // (b) The manifest: name, description, scripts and bin say what the thing
  // is and how it runs. Nothing else in package.json helps a customer.
  const manifest = options.manifest;
  if (manifest) {
    add(BUDGET.manifest, [
      { path: 'package.json', content: JSON.stringify(manifest.summary, null, 2) },
    ]);
  }

  // (c) Existing articles, bodies included, so the model neither repeats them
  // nor contradicts them. Whatever does not fit is listed by title.
  const docs = options.docs ?? 'docs';
  const articles = options.articles ?? [];
  const included = add(
    BUDGET.articles,
    articles.map((article) => ({
      path: `${docs}/${article.path}`,
      content: `# ${article.title}\n\n${article.body}`,
      limit: 1_500,
    })),
  );
  if (included < articles.length) {
    add(1_000, [
      {
        path: 'other existing articles',
        content: articles
          .slice(included)
          .map((article) => article.title)
          .join('; '),
      },
    ]);
  }

  // (d) Routes, handlers and controllers: by name first, then anything that
  // wires an HTTP method, wherever it lives.
  const code = files.filter((f) => CODE.has(extname(f).toLowerCase()) && !isNoise(f));
  const byName = code.filter(isRouteFile).sort((a, b) => a.length - b.length);
  const named = new Set(byName);
  const byContent: Piece[] = [];
  let scanned = 0;
  for (const path of code) {
    if (named.has(path) || scanned >= MAX_SCANNED) continue;
    scanned++;
    const content = read(path);
    if (content && ROUTE_CALL.test(content)) byContent.push({ path, content });
  }
  add(BUDGET.routes, [...pieces(byName), ...byContent]);

  // (e) Plans, limits, pricing, features, config: where the facts a customer
  // actually asks about are written down.
  add(
    BUDGET.plans,
    pieces(
      files
        .filter((f) => TEXT.has(extname(f).toLowerCase()) && !isNoise(f) && isPlanFile(f))
        .sort((a, b) => a.length - b.length),
    ),
  );

  // (f) An API description, if there is one.
  add(BUDGET.openapi, pieces(files.filter(isApiDescription)));

  // (g) UI copy: the words customers actually see. English first.
  add(
    BUDGET.copy,
    pieces(
      files
        .filter(isCopyFile)
        .sort((a, b) => englishFirst(a) - englishFirst(b) || a.length - b.length),
    ),
  );

  // (h) The changelog, newest entries at the top.
  add(
    BUDGET.changelog,
    pieces(
      files.filter(isChangelog).sort((a, b) => a.length - b.length),
      BUDGET.changelog,
    ),
  );

  // (i) A CLI's own --help is its documentation.
  if (manifest?.bin && options.cliHelp) {
    const help = options.cliHelp(manifest.bin);
    if (help) add(BUDGET.help, [{ path: `${manifest.bin} --help`, content: help }]);
  }

  const text = sections.join('\n\n');
  return { text, files: sources.length, chars: text.length, sources, omitted };
}

/**
 * Whether a listed path is worth looking at at all: not in an ignored folder,
 * not HelpWell's own config, not the docs folder (articles are added
 * separately), and nothing that could hold a secret.
 */
export function isListed(path: string, docs: string | null): boolean {
  return (
    !path.split('/').some((segment) => IGNORED_DIRS.has(segment)) &&
    !path.startsWith('helpwell/') &&
    (!docs || (path !== docs && !path.startsWith(`${docs}/`))) &&
    !isSensitive(path)
  );
}

/**
 * The files `assembleRepoContext` could read, best first, for a host that
 * reads a repository file by file and cannot afford every one: the README,
 * the manifest, routes by name, plans, the API description, copy and the
 * changelog. Code that might wire routes by content comes after, shortest
 * paths first.
 */
export function contextCandidates(files: string[]): string[] {
  const named = files.filter(
    (f) =>
      /^(docs\/)?readme\.(md|mdx|txt|rst)$/i.test(f) ||
      f === 'package.json' ||
      isApiDescription(f) ||
      isChangelog(f) ||
      isCopyFile(f) ||
      (TEXT.has(extname(f).toLowerCase()) && !isNoise(f) && isPlanFile(f)),
  );
  const code = files.filter((f) => CODE.has(extname(f).toLowerCase()) && !isNoise(f));
  const routes = code.filter(isRouteFile).sort((a, b) => a.length - b.length);
  const rest = code.filter((f) => !isRouteFile(f)).sort((a, b) => a.length - b.length);
  return [...new Set([...named, ...routes, ...rest])];
}

export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 16))}\n… [truncated]`;
}

/** Nothing here should ever be pasted into a prompt. */
export function isSensitive(path: string): boolean {
  const name = basename(path);
  return (
    /^\.env(\..*)?$/.test(name) ||
    /secret|credential|password/i.test(name) ||
    /\.(pem|key|p12|pfx)$/i.test(name) ||
    /^database\.ya?ml$/i.test(name)
  );
}

/** Tests, mocks, fixtures, stories, type declarations, minified and generated files. */
export function isNoise(path: string): boolean {
  return (
    /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures|mocks)\//.test(path) ||
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(path) ||
    /\.d\.[cm]?ts$/.test(path) ||
    /\.min\.[cm]?js$/.test(path) ||
    /\.generated\./.test(path)
  );
}

export function isRouteFile(path: string): boolean {
  const name = basename(path);
  const segments = path.split('/');
  return (
    segments.includes('routes') ||
    segments.includes('api') ||
    /\.controller\./.test(name) ||
    (segments.includes('app') && /^route\.[cm]?[jt]sx?$/.test(name)) ||
    path.includes('pages/api/') ||
    /^server\.[cm]?[jt]s$/.test(name) ||
    /^src\/index\.[cm]?[jt]s$/.test(path)
  );
}

export function isPlanFile(path: string): boolean {
  const stem = basename(path)
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
  const parent = basename(dirname(path)).toLowerCase();
  return (
    /^(plans?|pricing|prices?|limits?|features?|entitlements?|tiers?|quotas?)([-_.]|$)/.test(
      stem,
    ) || parent === 'config'
  );
}

export function isCopyFile(path: string): boolean {
  const segments = path.split('/');
  return (
    ['locales', 'messages', 'i18n', 'translations', 'lang'].some((s) => segments.includes(s)) &&
    /\.(json|ya?ml|[cm]?[jt]s)$/.test(path) &&
    !isNoise(path)
  );
}

function isApiDescription(path: string): boolean {
  return /^(openapi|swagger)\.(json|ya?ml)$/i.test(basename(path));
}

function isChangelog(path: string): boolean {
  return /^changelog(\.(md|mdx|txt|rst))?$/i.test(basename(path));
}

function englishFirst(path: string): number {
  return /(^|[/._-])en([-_][A-Za-z]{2})?([/._-]|$)/.test(path) ? 0 : 1;
}

export interface ManifestSummary {
  summary: Record<string, unknown>;
  bin: string | null;
}

/** The parts of a package.json that say what the thing is and how it runs. */
export function summariseManifest(text: string | null): ManifestSummary | null {
  if (!text) return null;
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'version', 'scripts', 'bin']) {
      if (pkg[key] !== undefined) summary[key] = pkg[key];
    }
    const bin =
      typeof pkg.bin === 'string'
        ? pkg.bin
        : pkg.bin && typeof pkg.bin === 'object'
          ? (Object.values(pkg.bin as Record<string, unknown>).find(
              (value): value is string => typeof value === 'string',
            ) ?? null)
          : null;
    return { summary, bin };
  } catch {
    return null;
  }
}
