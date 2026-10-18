/**
 * `helpwell capture` — take the screenshots the docs reference.
 *
 * Screenshots are the first thing in any help centre to go stale, because
 * nothing fails when the UI moves. This drives a real browser through the
 * shots listed in the config and rewrites the images in place, so a release
 * can refresh them the same way it refreshes anything else (SS-01, SS-02).
 *
 * Pages behind the app's sign-in are reached by signing in once, with values
 * read from environment variables the config names, and reusing that session
 * for every shot; or by starting from a Playwright storage-state file. Before
 * each shot, the annotations it lists are drawn into the page (SS-04, SS-05).
 *
 * Playwright is an optional peer dependency: most installs never capture, and
 * a browser download is not something to impose on them.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readKnowledgeBase, refusedScreenshot, screenshotsInArticle } from '@helpwell/core/content';
import {
  type AnnotationOutcome,
  type AnnotationPayload,
  drawAnnotations,
  type MissedAnnotation,
  prepareAnnotations,
} from '../annotations.js';
import { type CaptureLogin, loadProject, type ScreenshotConfig } from '../project.js';
import { detail, fail, heading, list, ok, progress, say, warn } from '../ui.js';

export { readShots, type Shot } from '../project.js';

export interface CaptureOptions {
  cwd: string;
  /** Override the app URL from the config. */
  url?: string;
  /** Only capture shots whose name matches. */
  only?: string;
  /** Where to write. Defaults to the configured screenshots folder. */
  out?: string;
  /**
   * How to get hold of Chromium. Defaults to importing Playwright; a test
   * hands in a stub so it can exercise the "not installed" path.
   */
  chromium?: () => Promise<PlaywrightChromium | null>;
  /** Where credentials are read from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface CaptureResult {
  written: string[];
  skipped: string[];
  /** Annotations that were skipped, and config that was ignored. */
  warnings: string[];
  /**
   * False when the run could not do its job at all: Playwright is missing,
   * signing in failed, or every shot it was asked for failed. The process
   * exits non-zero on false.
   */
  ok: boolean;
}

export async function capture(options: CaptureOptions): Promise<CaptureResult> {
  const project = loadProject(options.cwd);
  const config = project.config.screenshots;
  const shots = config.shots;
  const outDir = options.out ?? project.paths.screenshotsDir;
  const appUrl = (options.url ?? project.config.appUrl).replace(/\/+$/, '');
  const env = options.env ?? process.env;

  heading('Capturing screenshots');

  if (shots.length === 0) {
    warn('No shots configured.');
    detail(
      'List them under `screenshots.shots` in helpwell/helpwell.config.json — each needs a name and a path. The docs README has an example, and a prompt to hand the setup to an AI assistant.',
    );
    return { written: [], skipped: [], warnings: [], ok: true };
  }

  const chromium = await (options.chromium ?? loadPlaywright)();
  const browserState = browserReady(chromium);
  if (browserState !== 'ready') {
    fail(
      browserState === 'no-playwright'
        ? 'Playwright is not installed, so nothing was captured.'
        : 'Chromium is not downloaded, so nothing was captured.',
    );
    for (const line of browserFix(browserState)) detail(line);
    return { written: [], skipped: shots.map((shot) => shot.name), warnings: [], ok: false };
  }

  const wanted = options.only
    ? shots.filter((shot) => shot.name.includes(options.only as string))
    : shots;

  if (wanted.length === 0) {
    warn(`No shot is named like "${options.only}".`);
    detail(`Configured: ${shots.map((shot) => shot.name).join(', ')}`);
    return { written: [], skipped: [], warnings: [], ok: true };
  }

  // Only the sign-in config reports problems at this level. Capturing anyway
  // would photograph the sign-in page and call it the dashboard.
  if (config.problems && config.problems.length > 0) {
    fail('The sign-in settings for capture need fixing first, so nothing was captured.');
    list(config.problems);
    return {
      written: [],
      skipped: wanted.map((shot) => shot.name),
      warnings: [...config.problems],
      ok: false,
    };
  }

  // A warning is said once, however many schemes the shot is taken in.
  const warnings = new Set<string>();
  for (const shot of wanted) {
    for (const problem of shot.problems ?? []) warnings.add(`${shot.name}: ${problem}`);
  }

  detail(`${wanted.length} shots against ${appUrl}`);
  mkdirSync(outDir, { recursive: true });

  let browser: PlaywrightBrowser;
  try {
    browser = await chromium!.launch();
  } catch (error) {
    // Usually missing system libraries on a Linux server, in CI or in a container.
    fail('Chromium could not start, so nothing was captured.');
    detail(
      String(error instanceof Error ? error.message : error)
        .split('\n')[0]!
        .slice(0, 300),
    );
    for (const line of browserFix('no-browser')) detail(line);
    return { written: [], skipped: wanted.map((shot) => shot.name), warnings: [], ok: false };
  }
  const written: string[] = [];
  const skipped: string[] = [];
  /** Shots whose picture changed, and those not taken (their last picture is kept). */
  const changed = new Set<string>();
  const failed = new Set<string>();

  try {
    const session = await startSession(browser, config, {
      appUrl,
      env,
      root: project.paths.root,
    });
    if ('problem' in session) {
      fail(session.problem);
      if (session.hint) detail(session.hint);
      return {
        written: [],
        skipped: wanted.map((shot) => shot.name),
        warnings: [...warnings],
        ok: false,
      };
    }
    if (session.note) ok(session.note);

    const accent = project.config.settings.widget.appearance.accent;
    const bar = progress('capturing');

    for (const [index, shot] of wanted.entries()) {
      bar.update(`${index + 1}/${wanted.length} ${shot.name}`);
      const schemes: ('light' | 'dark')[] = shot.dark ? ['light', 'dark'] : ['light'];
      const items = prepareAnnotations(shot.annotate ?? [], { accent, blur: config.blur });

      for (const scheme of schemes) {
        const context = await browser.newContext({
          viewport: { width: shot.width ?? 1440, height: shot.height ?? 900 },
          colorScheme: scheme,
          // A screenshot with a half-drawn animation in it is worse than none.
          reducedMotion: 'reduce',
          deviceScaleFactor: 2,
          ...(session.state === undefined ? {} : { storageState: session.state }),
        });
        const page = await context.newPage();

        try {
          const asked = `${appUrl}${shot.path}`;
          const response = (await page.goto(asked, {
            waitUntil: 'networkidle',
            timeout: 30_000,
          })) as { status?: () => number } | null;
          // A sign-in page or an error must not replace a good picture.
          const refused = refusedScreenshot(
            asked,
            page.url?.() ?? asked,
            response?.status?.() ?? null,
            'Check the sign-in settings for capture',
          );
          if (refused) throw new Error(refused);
          if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 15_000 });
          for (const selector of shot.click ?? []) {
            await page.click(selector, { timeout: 10_000 });
            await page.waitForTimeout(500);
          }

          if (items.length > 0) {
            // Scrolled first, so the overlay is drawn where the element will
            // be when the clipped shot is taken.
            if (shot.clip) {
              await page
                .locator(shot.clip)
                .scrollIntoViewIfNeeded({ timeout: 5_000 })
                .catch(() => undefined);
            }
            const payload: AnnotationPayload = { items, scheme };
            const outcome = (await page.evaluate(drawAnnotations, payload)) as AnnotationOutcome;
            for (const missed of outcome.missing) {
              if (!missed.optional) warnings.add(`${shot.name}: ${describeMiss(missed)}`);
            }
          }

          const suffix = scheme === 'dark' ? '-dark' : '';
          const file = join(outDir, `${shot.name}${suffix}.png`);
          const target = shot.clip ? page.locator(shot.clip) : page;
          const before = fingerprint(file);
          await target.screenshot({ path: file });
          if (before !== null && before !== fingerprint(file)) changed.add(shot.name);
          written.push(relative(project.paths.root, file));
        } catch (error) {
          failed.add(shot.name);
          skipped.push(`${shot.name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          await context.close();
        }
      }
    }

    bar.done(`Wrote ${written.length} screenshots`);
  } finally {
    await browser.close();
  }

  list(written);

  const usage = screenshotUsage(project.paths.docsDir);
  const titles = (items: string[]) =>
    `${items.slice(0, 5).join(', ')}${items.length > 5 ? ` and ${items.length - 5} more` : ''}`;
  if (skipped.length > 0) {
    say();
    warn(`${skipped.length} could not be taken`);
    list(skipped);
    const used = [...failed].filter((name) => usage.get(name)?.articles.length);
    if (used.length) {
      detail(
        'These articles still show the last picture. Retake it once fixed, or replace it by hand:',
      );
      list(used.map((name) => `${name}: ${titles(usage.get(name)!.articles)}`));
    }
  }
  // A retake cannot redraw an annotated copy: the articles showing one need it made again.
  for (const name of changed) {
    const copies = usage.get(name)?.copies ?? [];
    if (copies.length)
      warnings.add(
        `${name} changed, and ${titles(copies)} ${copies.length === 1 ? 'shows an annotated copy' : 'show annotated copies'} of the old one. Annotate the new screenshot again.`,
      );
  }
  if (warnings.size > 0) {
    say();
    warn(`${warnings.size} ${warnings.size === 1 ? 'warning' : 'warnings'}`);
    list([...warnings]);
  }
  say();

  return { written, skipped, warnings: [...warnings], ok: written.length > 0 };
}

function fingerprint(file: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** The articles that show each screenshot, and those showing an annotated copy of it. */
function screenshotUsage(docsDir: string): Map<string, { articles: string[]; copies: string[] }> {
  const found = new Map<string, { articles: string[]; copies: string[] }>();
  if (!existsSync(docsDir)) return found;
  const entry = (name: string) => {
    const value = found.get(name) ?? { articles: [], copies: [] };
    found.set(name, value);
    return value;
  };
  for (const article of readKnowledgeBase(docsDir, { media: false }).articles) {
    const { shown, copies } = screenshotsInArticle(article.body);
    for (const name of shown) entry(name).articles.push(article.title);
    for (const name of new Set(copies.map((c) => c.name))) entry(name).copies.push(article.title);
  }
  return found;
}

function describeMiss(missed: MissedAnnotation): string {
  const what = `annotation ${missed.index + 1} (${missed.type})`;
  if (missed.reason === 'bad-selector') {
    return `${what} skipped: "${missed.target}" is not a valid CSS selector`;
  }
  if (missed.reason === 'not-visible') {
    return `${what} skipped: "${missed.target}" matched an element with no size, so it is not on screen`;
  }
  return `${what} skipped: nothing matches "${missed.target}"`;
}

/* --------------------------------------------------------------- signing in */

type Session = { state: unknown; note?: string } | { problem: string; hint?: string };

/**
 * The session every shot starts from.
 *
 * A storage-state file, when one is configured and exists. Otherwise, when
 * the config has a login or cookies, sign in once in a throwaway context and
 * hand its storage state to every shot, light and dark. Otherwise nothing.
 *
 * Values only ever come from the environment, and are scrubbed from any error
 * message before it is printed.
 */
async function startSession(
  browser: PlaywrightBrowser,
  config: ScreenshotConfig,
  options: { appUrl: string; env: Record<string, string | undefined>; root: string },
): Promise<Session> {
  const statePath = config.storageState ? resolve(options.root, config.storageState) : null;
  if (statePath && existsSync(statePath)) {
    return {
      state: statePath,
      note: `Starting from ${relative(options.root, statePath).split('\\').join('/')}`,
    };
  }

  const login = config.login;
  const cookies = config.cookies ?? [];
  if (!login && cookies.length === 0) {
    if (statePath) {
      return {
        problem: `The storage-state file ${config.storageState} does not exist.`,
        hint: 'Create it with Playwright, or add a screenshots.login block so HelpWell can sign in itself.',
      };
    }
    return { state: undefined };
  }

  const names = [...(login?.fill.map((field) => field.env) ?? []), ...cookies.map((c) => c.env)];
  const unset = [...new Set(names)].filter((name) => !options.env[name]);
  if (unset.length > 0) {
    return {
      problem: `Signing in needs ${unset.join(', ')}, which ${unset.length === 1 ? 'is' : 'are'} not set.`,
      hint: 'Set them in your shell, a .env file you keep out of git, or your CI secrets. They are read from the environment and never written anywhere.',
    };
  }
  const secrets = names.map((name) => options.env[name] ?? '').filter(Boolean);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    if (cookies.length > 0) {
      await context.addCookies(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: options.env[cookie.env] ?? '',
          ...(cookie.domain
            ? { domain: cookie.domain, path: cookie.path ?? '/' }
            : { url: options.appUrl }),
        })),
      );
    }
    if (login) await signIn(await context.newPage(), login, options);
    return {
      state: await context.storageState(),
      note: login ? `Signed in at ${login.url}` : `Set ${cookies.length} cookies`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      problem: `Signing in failed: ${scrub(message, secrets)}`,
      hint: 'Check the selectors under screenshots.login, and that the account can sign in by hand.',
    };
  } finally {
    await context.close();
  }
}

async function signIn(
  page: PlaywrightPage,
  login: CaptureLogin,
  options: { appUrl: string; env: Record<string, string | undefined> },
): Promise<void> {
  const url = /^https?:\/\//i.test(login.url)
    ? login.url
    : `${options.appUrl}${login.url.startsWith('/') ? '' : '/'}${login.url}`;
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  if (login.waitFor) await page.waitForSelector(login.waitFor, { timeout: 15_000 });

  for (const field of login.fill) {
    await page.fill(field.selector, options.env[field.env] ?? '', { timeout: 10_000 });
  }
  if (login.submit) {
    await page.click(login.submit, { timeout: 10_000 });
  } else {
    const last = login.fill[login.fill.length - 1];
    if (last) await page.press(last.selector, 'Enter', { timeout: 10_000 });
  }

  if (login.success) {
    await page.waitForSelector(login.success, { timeout: 30_000 });
  } else if (login.successUrl) {
    const expected = login.successUrl;
    await page.waitForURL((current) => current.href.includes(expected), { timeout: 30_000 });
  } else {
    // Nothing to look for, so leaving the sign-in page is the signal.
    await page.waitForURL((current) => current.href.split(/[?#]/)[0] !== url.split(/[?#]/)[0], {
      timeout: 30_000,
    });
  }
}

/** Never print a credential, even inside a browser's error message. */
function scrub(message: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => text.split(secret).join('***'), message);
}

/** Whether capture can run here: Playwright installed, and its Chromium downloaded. */
export type BrowserState = 'ready' | 'no-playwright' | 'no-browser';

export function browserReady(chromium: PlaywrightChromium | null): BrowserState {
  if (!chromium) return 'no-playwright';
  let path = '';
  try {
    path = chromium.executablePath?.() ?? '';
  } catch {
    return 'no-browser';
  }
  return path && !existsSync(path) ? 'no-browser' : 'ready';
}

/**
 * What to run so capture works. Capture runs where the app runs (a laptop, CI, a container);
 * the HelpWell server itself never needs a browser.
 */
export function browserFix(state: Exclude<BrowserState, 'ready'>): string[] {
  return [
    state === 'no-playwright'
      ? 'Install it: npm i -D playwright && npx playwright install chromium'
      : 'Download it: npx playwright install chromium',
    'On Linux, in CI or in a Docker image, add --with-deps so the system libraries are installed too: npx playwright install --with-deps chromium',
    'Or have your coding agent set it up: npx helpwell prompt capture',
  ];
}

/** Whether this project can take screenshots now, without opening a browser. */
export async function captureBrowserState(
  load: () => Promise<PlaywrightChromium | null> = loadPlaywright,
): Promise<BrowserState> {
  return browserReady(await load());
}

/**
 * Playwright is loaded at call time rather than imported, so an install that
 * never captures does not pay for it and does not fail without it.
 */
async function loadPlaywright(): Promise<PlaywrightChromium | null> {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    return null;
  }
}

/**
 * The slice of Playwright's surface this command uses.
 *
 * Written so that real Playwright (`playwright` or `@playwright/test`)
 * satisfies it as it is, with no cast: every parameter here is one
 * Playwright's own accepts, and every result one it returns. A narrower one,
 * like a mutable `unknown[]` where Playwright takes a read-only array of
 * cookies, makes the real `chromium` fail to fit. capture-types.test.ts
 * checks this against Playwright's own types.
 */
export interface PlaywrightChromium {
  launch(options?: unknown): Promise<PlaywrightBrowser>;
  /** Where Playwright expects its Chromium; the file is missing until it is downloaded. */
  executablePath?(): string;
}

export interface PlaywrightBrowser {
  newContext(options?: unknown): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

/** A cookie as capture sets it: from the environment, for the app's URL or a domain. */
export interface PlaywrightCookie {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
}

export interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  addCookies(cookies: readonly PlaywrightCookie[]): Promise<void>;
  storageState(): Promise<unknown>;
  close(): Promise<void>;
}

export interface PlaywrightLocator {
  screenshot(options: unknown): Promise<unknown>;
  scrollIntoViewIfNeeded(options?: unknown): Promise<void>;
}

export interface PlaywrightPage {
  goto(url: string, options?: unknown): Promise<unknown>;
  /** Where the page ended up, after redirects. */
  url?(): string;
  waitForSelector(selector: string, options?: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForURL(url: (url: URL) => boolean, options?: unknown): Promise<void>;
  click(selector: string, options?: unknown): Promise<void>;
  fill(selector: string, value: string, options?: unknown): Promise<void>;
  press(selector: string, key: string, options?: unknown): Promise<void>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  locator(selector: string): PlaywrightLocator;
  screenshot(options: unknown): Promise<unknown>;
}
