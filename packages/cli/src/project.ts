/**
 * Finding and reading a HelpWell installation.
 *
 * HelpWell installs into a repo the customer already has, so every command has
 * to answer the same three questions first: where is the project root, where
 * are the docs, and how do we reach the database. This is that answer, in one
 * place, so no command invents its own convention.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  DEFAULT_API_PATH,
  type MediaPaths,
  screenshotsRelativeToDocs,
} from '@helpwell/core/content';
import type { Db, DbHandle } from '@helpwell/core/db';
import { createDb, defaultDatabaseUrl, migrate, schemaExists } from '@helpwell/core/db';
import { parseSettings, type Settings } from '@helpwell/core/settings';
import { type Annotation, readAnnotations } from './annotations.js';
import { trace } from './ui.js';

export const CONFIG_FILE = 'helpwell.config.json';
export const INSTRUCTIONS_FILE = 'instructions.md';
export const PLAYBOOK_FILE = 'playbook.md';

export interface ProjectPaths {
  /** The repo root: the nearest directory up the tree with a config file. */
  root: string;
  /** `helpwell/` — config, instructions, playbook, eval cases. */
  helpwellDir: string;
  configPath: string;
  instructionsPath: string;
  playbookPath: string;
  /** Where the Markdown articles live. From config, default `docs/`. */
  docsDir: string;
  /** Where captured screenshots go. */
  screenshotsDir: string;
}

/** One screenshot `helpwell capture` takes. Lives in the config file. */
export interface Shot {
  /** File name, without an extension. Referenced from the Markdown. */
  name: string;
  /** Path on the app, appended to appUrl. */
  path: string;
  /** Optional CSS selector to crop to. */
  clip?: string;
  /** Wait for this selector before shooting. */
  waitFor?: string;
  /** Things to click first, in order. */
  click?: string[];
  /** Viewport. Defaults to 1440x900. */
  width?: number;
  height?: number;
  /** Take it in dark mode as well, written as `<name>-dark.png`. */
  dark?: boolean;
  /** Boxes, arrows, numbered steps, labels, spotlights and blurs to draw first. */
  annotate?: Annotation[];
  /** What was wrong with this shot's config, to warn about when it is captured. */
  problems?: string[];
}

/**
 * Signing in before capturing, for pages behind the app's login. Values come
 * from environment variables named here, never from the file itself.
 */
export interface CaptureLogin {
  /** The sign-in page: a path on the app, or a full URL. */
  url: string;
  /** Each field to fill, and the environment variable holding its value. */
  fill: { selector: string; env: string }[];
  /** The button to press. Without one, Enter is pressed in the last field. */
  submit?: string;
  /** Wait for this before filling, for a sign-in form that renders late. */
  waitFor?: string;
  /** A selector that only exists once signed in. */
  success?: string;
  /** Or: part of the URL the app lands on once signed in. */
  successUrl?: string;
}

/** A cookie to set before capturing, its value read from an environment variable. */
export interface CaptureCookie {
  name: string;
  env: string;
  /** Defaults to the app's own host. */
  domain?: string;
  path?: string;
}

export interface ScreenshotConfig {
  /** Where the images are written, relative to the root. */
  dir: string;
  /** What to capture. Empty until someone lists a few. */
  shots: Shot[];
  /** Sign in first, and reuse the session for every shot. */
  login?: CaptureLogin;
  /** A Playwright storage-state file to start from, relative to the root. Never commit one. */
  storageState?: string;
  /** Cookies to set on every shot. */
  cookies?: CaptureCookie[];
  /** Selectors blurred on every shot, e.g. an email in the header (SS-05). */
  blur?: string[];
  /** What was wrong with the login or cookie config. */
  problems?: string[];
}

export interface ProjectConfig {
  /** Settings, the same shape the database stores. */
  settings: Settings;
  /** Where the docs live, relative to the root. */
  docs: string;
  /** The screenshot folder and the shots `helpwell capture` takes. */
  screenshots: ScreenshotConfig;
  /** Base URL of the running app, for `capture` and `dev`. */
  appUrl: string;
  /** Eval cases, if the project has any. */
  evalFile: string;
  /**
   * Where the app mounts the API, when not `/api/helpwell`. `helpwell sync`
   * rewrites an article's relative image paths to screenshots served there.
   */
  apiPath?: string;
  /**
   * The remote support extension `helpwell link` connected: its URL and
   * product id. Never the token, which lives in HELPWELL_SUPPORT_TOKEN.
   */
  support?: SupportLink;
}

/** Where the remote support extension is. The token is not here, and never is. */
export interface SupportLink {
  url: string;
  product: string;
}

export interface Project {
  paths: ProjectPaths;
  config: ProjectConfig;
  instructions: string;
  playbook: string;
}

/**
 * Walk up from `cwd` looking for `helpwell/helpwell.config.json`.
 *
 * Walking up rather than requiring the command to be run from the root, so
 * `helpwell sync` works from inside a workspace package the way git does.
 */
export function findRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'helpwell', CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function pathsFor(root: string, config?: Partial<ProjectConfig>): ProjectPaths {
  const helpwellDir = join(root, 'helpwell');
  return {
    root,
    helpwellDir,
    configPath: join(helpwellDir, CONFIG_FILE),
    instructionsPath: join(helpwellDir, INSTRUCTIONS_FILE),
    playbookPath: join(helpwellDir, PLAYBOOK_FILE),
    docsDir: resolveIn(root, config?.docs ?? 'docs'),
    screenshotsDir: resolveIn(root, config?.screenshots?.dir ?? 'docs/_screenshots'),
  };
}

function resolveIn(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

export class NotInstalledError extends Error {
  constructor() {
    super('No HelpWell project here. Run `helpwell init` first.');
    this.name = 'NotInstalledError';
  }
}

export function loadProject(from = process.cwd()): Project {
  const root = findRoot(from);
  if (!root) throw new NotInstalledError();

  const paths = pathsFor(root);
  const raw = JSON.parse(readFileSync(paths.configPath, 'utf8')) as Record<string, unknown>;
  const docs = typeof raw.docs === 'string' ? raw.docs : 'docs';

  const config: ProjectConfig = {
    // parseSettings fills in anything the file is missing, so a config written
    // by an older version keeps working after an upgrade.
    settings: parseSettings(raw.settings ?? raw),
    docs,
    screenshots: readScreenshotConfig(raw.screenshots, docs),
    appUrl: typeof raw.appUrl === 'string' ? raw.appUrl : 'http://localhost:3000',
    evalFile: typeof raw.evalFile === 'string' ? raw.evalFile : 'helpwell/evals.json',
  };
  if (typeof raw.apiPath === 'string' && raw.apiPath.trim()) config.apiPath = raw.apiPath.trim();
  const support = readSupportLink(raw.support);
  if (support) config.support = support;

  return {
    paths: pathsFor(root, config),
    config,
    instructions: readIfPresent(paths.instructionsPath),
    playbook: readIfPresent(paths.playbookPath),
  };
}

/**
 * `screenshots` in the config is `{ "dir": "docs/_screenshots", "shots": [...] }`.
 * The first release wrote it as a bare string naming the folder; that form
 * still reads, with no shots.
 */
export function readScreenshotConfig(raw: unknown, docs = 'docs'): ScreenshotConfig {
  const fallback = `${docs}/_screenshots`;
  if (typeof raw === 'string') return { dir: raw, shots: [] };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const config: ScreenshotConfig = {
      dir: typeof record.dir === 'string' ? record.dir : fallback,
      shots: readShots(record.shots),
    };
    const problems: string[] = [];
    if (record.login !== undefined) {
      const login = readLogin(record.login, problems);
      if (login) config.login = login;
    }
    if (typeof record.storageState === 'string' && record.storageState.trim()) {
      config.storageState = record.storageState.trim();
    }
    if (record.cookies !== undefined) config.cookies = readCookies(record.cookies, problems);
    if (Array.isArray(record.blur)) {
      config.blur = record.blur.filter(
        (item): item is string => typeof item === 'string' && Boolean(item.trim()),
      );
    }
    if (problems.length > 0) config.problems = problems;
    return config;
  }
  return { dir: fallback, shots: readShots(raw) };
}

/** `support` in the config: a URL and a product id, or nothing. Anything else in it is ignored. */
export function readSupportLink(raw: unknown): SupportLink | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  const product = typeof record.product === 'string' ? record.product.trim() : '';
  return url && product ? { url, product } : undefined;
}

/** An environment variable's name: what the config holds instead of a secret. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readLogin(raw: unknown, problems: string[]): CaptureLogin | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('screenshots.login must be an object');
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.url !== 'string' || !record.url.trim()) {
    problems.push('screenshots.login needs a url: the sign-in page');
    return undefined;
  }
  const fill: CaptureLogin['fill'] = [];
  const fields = Array.isArray(record.fill) ? record.fill : [];
  fields.forEach((entry, i) => {
    const field = entry as Record<string, unknown> | null;
    if (field && typeof field === 'object' && 'value' in field) {
      // Refused outright: a value here would be a password in the repo.
      problems.push(
        `screenshots.login.fill[${i}] has a value. Put it in an environment variable and name that variable in "env" instead.`,
      );
      return;
    }
    if (
      !field ||
      typeof field.selector !== 'string' ||
      typeof field.env !== 'string' ||
      !ENV_NAME.test(field.env)
    ) {
      problems.push(`screenshots.login.fill[${i}] needs a selector and an env variable name`);
      return;
    }
    fill.push({ selector: field.selector, env: field.env });
  });
  if (fill.length === 0) {
    problems.push('screenshots.login.fill lists no fields to fill');
    return undefined;
  }
  const login: CaptureLogin = { url: record.url.trim(), fill };
  for (const key of ['submit', 'waitFor', 'success', 'successUrl'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) login[key] = value.trim();
  }
  return login;
}

function readCookies(raw: unknown, problems: string[]): CaptureCookie[] {
  if (!Array.isArray(raw)) {
    problems.push('screenshots.cookies must be a list');
    return [];
  }
  const cookies: CaptureCookie[] = [];
  raw.forEach((entry, i) => {
    const cookie = entry as Record<string, unknown> | null;
    if (cookie && typeof cookie === 'object' && 'value' in cookie) {
      problems.push(
        `screenshots.cookies[${i}] has a value. Name an environment variable in "env" instead.`,
      );
      return;
    }
    if (
      !cookie ||
      typeof cookie.name !== 'string' ||
      typeof cookie.env !== 'string' ||
      !ENV_NAME.test(cookie.env)
    ) {
      problems.push(`screenshots.cookies[${i}] needs a name and an env variable name`);
      return;
    }
    const out: CaptureCookie = { name: cookie.name, env: cookie.env };
    if (typeof cookie.domain === 'string') out.domain = cookie.domain;
    if (typeof cookie.path === 'string') out.path = cookie.path;
    cookies.push(out);
  });
  return cookies;
}

/** The `shots` list, with anything that is not a shot dropped. */
export function readShots(raw: unknown): Shot[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.name === 'string' && typeof item.path === 'string')
    .map((item) => {
      const shot: Shot = {
        name: String(item.name),
        path: String(item.path),
        clip: typeof item.clip === 'string' ? item.clip : undefined,
        waitFor: typeof item.waitFor === 'string' ? item.waitFor : undefined,
        click: Array.isArray(item.click) ? item.click.map(String) : undefined,
        width: typeof item.width === 'number' ? item.width : undefined,
        height: typeof item.height === 'number' ? item.height : undefined,
        dark: item.dark === true,
      };
      const { items, problems } = readAnnotations(item.annotate);
      if (items.length > 0) shot.annotate = items;
      if (problems.length > 0) shot.problems = problems;
      return shot;
    });
}

/**
 * How `sync` turns an article's relative image paths into served URLs for
 * this project: its API path, and where its screenshots folder sits relative
 * to its docs folder.
 */
export function mediaPathsFor(project: Project): MediaPaths {
  return {
    apiPath: project.config.apiPath ?? DEFAULT_API_PATH,
    screenshots: screenshotsRelativeToDocs(project.paths.docsDir, project.paths.screenshotsDir),
  };
}

export function saveConfig(paths: ProjectPaths, config: ProjectConfig): void {
  mkdirSync(paths.helpwellDir, { recursive: true });
  const body = {
    $schema: 'https://helpwell.dev/schema/config.json',
    docs: config.docs,
    screenshots: config.screenshots,
    appUrl: config.appUrl,
    evalFile: config.evalFile,
    ...(config.apiPath ? { apiPath: config.apiPath } : {}),
    ...(config.support
      ? { support: { url: config.support.url, product: config.support.product } }
      : {}),
    settings: config.settings,
  };
  writeFileSync(paths.configPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

export function readIfPresent(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

/* -------------------------------------------------------------- database */

export interface OpenDbResult extends DbHandle {
  db: Db;
  /** What we actually connected to, for the summary line. */
  url: string;
}

/**
 * Open the database and make sure the schema is there.
 *
 * An explicit `--url` wins. Otherwise core's `defaultDatabaseUrl()` decides,
 * the same way it does for the app and the MCP server: `HELPWELL_DATABASE_URL`,
 * else the embedded database under `helpwell/data` — so `helpwell dev` works
 * on a laptop with no Postgres. The host app's own `DATABASE_URL` is never
 * adopted; it is usually production.
 */
export async function openDb(
  paths: ProjectPaths,
  options: { url?: string; migrate?: boolean } = {},
): Promise<OpenDbResult> {
  const url = options.url ?? defaultDatabaseUrl(paths.root);
  trace(`database ${redactUrl(url)}`);

  const handle = await createDb({ url });
  const present = await schemaExists(handle.db);
  if (!present && options.migrate !== false) {
    await migrate(handle.db);
  }
  return { ...handle, url };
}

/** Hide a password before a connection string is printed anywhere. */
export function redactUrl(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
}
