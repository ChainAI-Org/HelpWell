// @vitest-environment happy-dom
/**
 * `helpwell capture` against a stubbed Chromium.
 *
 * The stub records what the command asks of the browser, and runs the
 * annotation overlay for real against happy-dom's document, through the
 * function's own source, which is what Playwright does with it. That proves
 * the overlay is self-contained as well as what it draws.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawAnnotations, prepareAnnotations, readAnnotations } from '../src/annotations.js';
import { browserReady, capture, type PlaywrightChromium } from '../src/commands/capture.js';
import { init } from '../src/commands/init.js';
import { loadProject } from '../src/project.js';

let dir: string;
let output: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-capture-'));
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  await init({ cwd: dir, name: 'Acme' });
  document.getElementById('helpwell-annotations')?.remove();
  document.body.innerHTML = `
    <main>
      <div class="card">Plan</div>
      <button id="upgrade">Upgrade</button>
      <span class="email">jane@acme.test</span>
      <div class="hidden"></div>
    </main>`;
  place('.card', { left: 40, top: 60, width: 300, height: 160 });
  place('#upgrade', { left: 400, top: 120, width: 90, height: 36 });
  place('.email', { left: 900, top: 20, width: 160, height: 20 });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function printed(): string {
  return output.join('');
}

/** happy-dom does no layout, so each element the tests point at gets a box. */
function place(
  selector: string,
  box: { left: number; top: number; width: number; height: number },
) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(selector);
  element.getBoundingClientRect = () =>
    ({
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => box,
    }) as DOMRect;
}

function configure(screenshots: Record<string, unknown>): void {
  const path = join(dir, 'helpwell', 'helpwell.config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.screenshots = { dir: 'docs/_screenshots', ...screenshots };
  writeFileSync(path, JSON.stringify(config), 'utf8');
}

interface Stub {
  chromium: PlaywrightChromium;
  calls: [string, ...unknown[]][];
  contexts: Record<string, unknown>[];
}

/** A Chromium that does nothing but remember, and draws overlays into happy-dom. */
function stubChromium(
  options: {
    failAt?: string;
    landOn?: string;
    /** Where a page sends the browser, by the address asked for. */
    redirect?: Record<string, string>;
    status?: number;
    /** What each screenshot writes, so a test can tell a changed picture. */
    picture?: string;
  } = {},
): Stub {
  const calls: Stub['calls'] = [];
  const contexts: Stub['contexts'] = [];
  let url = 'about:blank';

  const page = {
    async goto(target: string) {
      calls.push(['goto', target]);
      url = options.redirect?.[target] ?? target;
      return { status: () => options.status ?? 200 };
    },
    url() {
      return url;
    },
    async waitForSelector(selector: string) {
      calls.push(['waitForSelector', selector]);
      if (selector === options.failAt) throw new Error(`Timeout waiting for ${selector}`);
    },
    async waitForTimeout() {},
    async waitForURL(test: (url: URL) => boolean) {
      calls.push(['waitForURL']);
      url = options.landOn ?? 'http://localhost:3000/dashboard';
      if (!test(new URL(url))) throw new Error('Timeout waiting for the URL');
    },
    async click(selector: string) {
      calls.push(['click', selector]);
    },
    async fill(selector: string, value: string) {
      calls.push(['fill', selector, value]);
      if (selector === options.failAt) throw new Error(`Could not fill ${selector} with ${value}`);
    },
    async press(selector: string, key: string) {
      calls.push(['press', selector, key]);
    },
    async evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R> {
      calls.push(['evaluate', arg]);
      // What Playwright does: the function travels as source text.
      const isolated = new Function(`return (${fn.toString()})`)() as (arg: A) => R;
      return isolated(arg);
    },
    locator(selector: string) {
      return {
        async screenshot(shot: { path: string }) {
          calls.push(['screenshot', selector, shot.path]);
        },
        async scrollIntoViewIfNeeded() {
          calls.push(['scrollIntoView', selector]);
        },
      };
    },
    async screenshot(shot: { path: string }) {
      calls.push(['screenshot', null, shot.path]);
      if (options.picture !== undefined) writeFileSync(shot.path, options.picture);
    },
  };

  const context = {
    async newPage() {
      return page;
    },
    async addCookies(cookies: readonly unknown[]) {
      calls.push(['addCookies', cookies]);
    },
    async storageState() {
      calls.push(['storageState']);
      return { cookies: [{ name: 'session', value: 'from-login' }], origins: [] };
    },
    async close() {},
  };

  const browser = {
    async newContext(contextOptions: Record<string, unknown> = {}) {
      contexts.push(contextOptions);
      return context;
    },
    async close() {},
  };

  return { chromium: { launch: async () => browser }, calls, contexts };
}

describe('annotations', () => {
  it('draws each kind into the page before the shot, in light and dark', async () => {
    configure({
      shots: [
        {
          name: 'billing',
          path: '/billing',
          dark: true,
          annotate: [
            { type: 'rect', target: '.card', color: '#E5484D' },
            { type: 'ellipse', target: '#upgrade' },
            { type: 'arrow', target: '#upgrade', direction: 'left', text: 'Click here' },
            { type: 'step', target: '.card' },
            { type: 'step', target: '#upgrade' },
            { type: 'label', target: '.card', text: 'Your plan', direction: 'right' },
            { type: 'spotlight', target: '.card' },
            { type: 'blur', target: '.email' },
          ],
        },
      ],
    });
    const stub = stubChromium();
    const result = await capture({ cwd: dir, chromium: async () => stub.chromium });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.written.map((p) => p.replace(/\\/g, '/'))).toEqual([
      'docs/_screenshots/billing.png',
      'docs/_screenshots/billing-dark.png',
    ]);

    const drawn = stub.calls.filter((call) => call[0] === 'evaluate');
    expect(drawn.map((call) => (call[1] as { scheme: string }).scheme)).toEqual(['light', 'dark']);
    // Drawing happens after navigating and before shooting.
    const order = stub.calls.map((call) => call[0]);
    expect(order.indexOf('evaluate')).toBeGreaterThan(order.indexOf('goto'));
    expect(order.indexOf('evaluate')).toBeLessThan(order.indexOf('screenshot'));

    const overlay = document.getElementById('helpwell-annotations');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    const rect = overlay?.querySelector('rect');
    expect(rect?.getAttribute('stroke')).toBe('#E5484D');
    expect(rect?.getAttribute('x')).toBe('34');
    expect(overlay?.querySelector('ellipse')).not.toBeNull();
    const spotlight = overlay?.querySelector('path[data-kind="spotlight"]');
    expect(spotlight?.getAttribute('fill-rule')).toBe('evenodd');
    // The arrow's shaft and head, under the spotlight's dimming.
    expect(overlay?.querySelectorAll('path:not([data-kind])')).toHaveLength(2);
    const text = overlay?.textContent ?? '';
    expect(text).toContain('Click here');
    expect(text).toContain('Your plan');
    const markers = [...(overlay?.querySelectorAll('div') ?? [])].map((d) => d.textContent);
    expect(markers).toContain('1');
    expect(markers).toContain('2');
    const blur = [...(overlay?.querySelectorAll('div') ?? [])].find((d) =>
      d.style.cssText.includes('blur(12px)'),
    );
    expect(blur).toBeDefined();
  });

  it('skips a target that matches nothing, and says so, rather than drawing it elsewhere', async () => {
    configure({
      shots: [
        {
          name: 'billing',
          path: '/billing',
          annotate: [
            { type: 'rect', target: '#gone' },
            { type: 'step', target: '.hidden' },
            { type: 'label', target: '[[bad', text: 'x' },
            { type: 'rect', target: '.card' },
          ],
        },
      ],
    });
    const stub = stubChromium();
    const result = await capture({ cwd: dir, chromium: async () => stub.chromium });

    expect(result.ok).toBe(true);
    expect(result.written).toHaveLength(1);
    expect(result.warnings).toEqual([
      'billing: annotation 1 (rect) skipped: nothing matches "#gone"',
      'billing: annotation 2 (step) skipped: ".hidden" matched an element with no size, so it is not on screen',
      'billing: annotation 3 (label) skipped: "[[bad" is not a valid CSS selector',
    ]);
    expect(printed()).toContain('nothing matches "#gone"');
    expect(document.querySelectorAll('#helpwell-annotations rect')).toHaveLength(1);
  });

  it('warns once for a shot taken in both schemes', async () => {
    configure({
      shots: [{ name: 'a', path: '/', dark: true, annotate: [{ type: 'rect', target: '#gone' }] }],
    });
    const result = await capture({ cwd: dir, chromium: async () => stubChromium().chromium });
    expect(result.warnings).toHaveLength(1);
  });

  it('blurs global selectors on every shot, quietly when a page does not have them', async () => {
    configure({
      blur: ['.email', '.api-key'],
      shots: [{ name: 'a', path: '/' }],
    });
    const stub = stubChromium();
    const result = await capture({ cwd: dir, chromium: async () => stub.chromium });
    expect(result.warnings).toEqual([]);
    const payload = stub.calls.find((call) => call[0] === 'evaluate')?.[1] as {
      items: { type: string; target: string }[];
    };
    expect(payload.items.map((item) => `${item.type} ${item.target}`)).toEqual([
      'blur .email',
      'blur .api-key',
    ]);
  });

  it('scrolls a clipped target into view before drawing', async () => {
    configure({
      shots: [
        { name: 'a', path: '/', clip: 'main', annotate: [{ type: 'rect', target: '.card' }] },
      ],
    });
    const stub = stubChromium();
    await capture({ cwd: dir, chromium: async () => stub.chromium });
    const order = stub.calls.map((call) => call[0]);
    expect(order.indexOf('scrollIntoView')).toBeLessThan(order.indexOf('evaluate'));
    expect(stub.calls.find((call) => call[0] === 'screenshot')?.[1]).toBe('main');
  });

  it('reads the config strictly and numbers steps in order', () => {
    const { items, problems } = readAnnotations([
      { type: 'step', target: '#a' },
      { type: 'step', target: '#b', step: 5 },
      { type: 'step', target: '#c' },
      { type: 'arrow', target: '#a', direction: 'sideways' },
      { type: 'label', target: '#a' },
      { type: 'circle', target: '#a' },
      { type: 'rect' },
      { type: 'rect', target: '#a', color: 'red', offset: { x: 4 }, padding: 500 },
    ]);
    expect(problems).toEqual([
      'annotate[3] direction must be up, down, left or right',
      'annotate[4] (label) needs text',
      'annotate[5] has no known type (use rect, ellipse, arrow, step, label, spotlight, blur)',
      'annotate[6] (rect) needs a target selector',
      'annotate[7] colour "red" is not a hex colour; using the default',
    ]);
    const prepared = prepareAnnotations(items, { accent: '#7A3BEB' });
    expect(prepared.filter((i) => i.type === 'step').map((i) => i.step)).toEqual([1, 5, 3]);
    const rect = prepared.find((i) => i.type === 'rect');
    expect(rect).toMatchObject({ color: '#7A3BEB', offset: { x: 4, y: 0 }, padding: 80 });
  });

  it('carries annotation problems into the capture output', async () => {
    configure({
      shots: [{ name: 'a', path: '/', annotate: [{ type: 'circle', target: '#a' }] }],
    });
    const result = await capture({ cwd: dir, chromium: async () => stubChromium().chromium });
    expect(result.warnings[0]).toContain('a: annotate[0] has no known type');
  });

  it('replaces an earlier overlay instead of stacking a second one', () => {
    const items = prepareAnnotations([{ type: 'rect', target: '.card' }], { accent: '#7A3BEB' });
    drawAnnotations({ items, scheme: 'light' });
    drawAnnotations({ items, scheme: 'dark' });
    expect(document.querySelectorAll('#helpwell-annotations')).toHaveLength(1);
  });
});

describe('signing in', () => {
  const login = {
    url: '/login',
    fill: [
      { selector: '#email', env: 'CAPTURE_EMAIL' },
      { selector: '#password', env: 'CAPTURE_PASSWORD' },
    ],
    submit: 'button[type=submit]',
    success: '.account-menu',
  };
  const env = { CAPTURE_EMAIL: 'demo@acme.test', CAPTURE_PASSWORD: 'hunter2-not-real' };

  it('signs in once, from the environment, and every shot reuses the session', async () => {
    configure({
      login,
      shots: [
        { name: 'one', path: '/dashboard', dark: true },
        { name: 'two', path: '/settings' },
      ],
    });
    const stub = stubChromium();
    const result = await capture({ cwd: dir, env, chromium: async () => stub.chromium });

    expect(result.ok).toBe(true);
    expect(result.written).toHaveLength(3);
    expect(stub.calls.filter((call) => call[0] === 'fill')).toEqual([
      ['fill', '#email', 'demo@acme.test'],
      ['fill', '#password', 'hunter2-not-real'],
    ]);
    expect(stub.calls.filter((call) => call[0] === 'storageState')).toHaveLength(1);
    expect(stub.calls).toContainEqual(['goto', 'http://localhost:3000/login']);
    expect(stub.calls).toContainEqual(['click', 'button[type=submit]']);
    expect(stub.calls).toContainEqual(['waitForSelector', '.account-menu']);

    // The first context signs in; each of the three shots starts from its state.
    const shots = stub.contexts.slice(1);
    expect(shots).toHaveLength(3);
    for (const context of shots) {
      expect(context.storageState).toEqual({
        cookies: [{ name: 'session', value: 'from-login' }],
        origins: [],
      });
    }
    expect(printed()).toContain('Signed in at /login');
    expect(printed()).not.toContain('hunter2-not-real');
    expect(printed()).not.toContain('demo@acme.test');
  });

  it('says which variables are missing, names only, and captures nothing', async () => {
    configure({ login, shots: [{ name: 'one', path: '/' }] });
    const stub = stubChromium();
    const result = await capture({
      cwd: dir,
      env: { CAPTURE_EMAIL: 'demo@acme.test' },
      chromium: async () => stub.chromium,
    });
    expect(result.ok).toBe(false);
    expect(result.written).toEqual([]);
    expect(printed()).toContain('Signing in needs CAPTURE_PASSWORD, which is not set.');
    expect(stub.calls.filter((call) => call[0] === 'screenshot')).toEqual([]);
  });

  it('keeps a credential out of a sign-in error', async () => {
    configure({ login, shots: [{ name: 'one', path: '/' }] });
    const stub = stubChromium({ failAt: '#password' });
    const result = await capture({ cwd: dir, env, chromium: async () => stub.chromium });
    expect(result.ok).toBe(false);
    expect(printed()).toContain('Signing in failed: Could not fill #password with ***');
    expect(printed()).not.toContain('hunter2-not-real');
  });

  it('refuses a password written into the config', async () => {
    configure({
      login: { url: '/login', fill: [{ selector: '#password', value: 'hunter2' }] },
      shots: [{ name: 'one', path: '/' }],
    });
    const project = loadProject(dir);
    expect(project.config.screenshots.login).toBeUndefined();
    const stub = stubChromium();
    const result = await capture({ cwd: dir, env, chromium: async () => stub.chromium });
    expect(result.ok).toBe(false);
    expect(printed()).toContain('has a value. Put it in an environment variable');
    expect(stub.calls).toEqual([]);
  });

  it('waits for a URL, or for leaving the sign-in page, when there is no selector', async () => {
    const { success: _drop, ...rest } = login;
    configure({
      login: { ...rest, successUrl: '/dashboard' },
      shots: [{ name: 'one', path: '/' }],
    });
    const stub = stubChromium();
    expect((await capture({ cwd: dir, env, chromium: async () => stub.chromium })).ok).toBe(true);

    configure({ login: rest, shots: [{ name: 'one', path: '/' }] });
    const stuck = stubChromium({ landOn: 'http://localhost:3000/login' });
    const result = await capture({ cwd: dir, env, chromium: async () => stuck.chromium });
    expect(result.ok).toBe(false);
    expect(printed()).toContain('Signing in failed');
  });

  it('sets cookies from the environment on the app’s host', async () => {
    configure({
      cookies: [{ name: 'session', env: 'APP_SESSION' }],
      shots: [{ name: 'one', path: '/' }],
    });
    const stub = stubChromium();
    const result = await capture({
      cwd: dir,
      env: { APP_SESSION: 's3cr3t' },
      chromium: async () => stub.chromium,
    });
    expect(result.ok).toBe(true);
    expect(stub.calls).toContainEqual([
      'addCookies',
      [{ name: 'session', value: 's3cr3t', url: 'http://localhost:3000' }],
    ]);
    expect(printed()).not.toContain('s3cr3t');
  });

  it('starts from a storage-state file when there is one', async () => {
    mkdirSync(join(dir, 'helpwell', '.auth'), { recursive: true });
    writeFileSync(join(dir, 'helpwell', '.auth', 'state.json'), '{"cookies":[],"origins":[]}');
    configure({
      storageState: 'helpwell/.auth/state.json',
      login,
      shots: [{ name: 'one', path: '/' }],
    });
    const stub = stubChromium();
    const result = await capture({ cwd: dir, env: {}, chromium: async () => stub.chromium });
    expect(result.ok).toBe(true);
    expect(stub.calls.filter((call) => call[0] === 'fill')).toEqual([]);
    expect(stub.contexts[0]?.storageState).toBe(join(dir, 'helpwell', '.auth', 'state.json'));
  });

  it('fails clearly when a storage-state file is missing and there is no way to sign in', async () => {
    configure({ storageState: 'helpwell/.auth/state.json', shots: [{ name: 'one', path: '/' }] });
    const result = await capture({ cwd: dir, chromium: async () => stubChromium().chromium });
    expect(result.ok).toBe(false);
    expect(printed()).toContain('does not exist');
  });
});

describe('a screenshot that cannot be retaken', () => {
  const shotPath = () => join(dir, 'docs', '_screenshots', 'billing.png');
  const article = (name: string, body: string) => {
    mkdirSync(join(dir, 'docs', 'billing'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'billing', `${name}.md`), body, 'utf8');
  };
  beforeEach(() => {
    configure({ shots: [{ name: 'billing', path: '/settings/billing' }] });
    mkdirSync(join(dir, 'docs', '_screenshots'), { recursive: true });
    writeFileSync(shotPath(), 'the good picture');
    article('plans', '---\ntitle: Choose a plan\n---\n\n![Billing](../_screenshots/billing.png)');
    article(
      'invoices',
      '---\ntitle: Download invoices\n---\n\n![billing-annotated](../_media/abc.png "Annotated copy of _screenshots/billing.png")',
    );
  });

  it('keeps the last picture when the page sends the browser to sign in, and names the articles', async () => {
    const stub = stubChromium({
      picture: 'a sign-in form',
      redirect: { 'http://localhost:3000/settings/billing': 'http://localhost:3000/login' },
    });
    const result = await capture({ cwd: dir, chromium: async () => stub.chromium });
    expect(result.ok).toBe(false);
    expect(result.skipped[0]).toMatch(/^billing: The page went to \/login instead/);
    expect(readFileSync(shotPath(), 'utf8')).toBe('the good picture');
    expect(printed()).toContain('Retake it once fixed, or replace it by hand');
    expect(printed()).toMatch(
      /billing: (Choose a plan, Download invoices|Download invoices, Choose a plan)/,
    );
  });

  it('keeps it after an error status too', async () => {
    const stub = stubChromium({ picture: 'an error page', status: 502 });
    const result = await capture({ cwd: dir, chromium: async () => stub.chromium });
    expect(result.skipped).toEqual([
      'billing: The page answered 502, so the last picture was kept.',
    ]);
    expect(readFileSync(shotPath(), 'utf8')).toBe('the good picture');
  });

  it('does not ask to redo an annotated copy for a first picture', async () => {
    rmSync(shotPath());
    const result = await capture({
      cwd: dir,
      chromium: async () => stubChromium({ picture: 'the first billing page' }).chromium,
    });
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it('says which annotated copies to make again when a picture changes, and only then', async () => {
    let result = await capture({
      cwd: dir,
      chromium: async () => stubChromium({ picture: 'the new billing page' }).chromium,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      'billing changed, and Download invoices shows an annotated copy of the old one. Annotate the new screenshot again.',
    ]);
    result = await capture({
      cwd: dir,
      chromium: async () => stubChromium({ picture: 'the new billing page' }).chromium,
    });
    expect(result.warnings).toEqual([]);
  });
});

describe('a browser to capture with', () => {
  beforeEach(() => configure({ shots: [{ name: 'billing', path: '/settings/billing' }] }));

  it('says when Chromium is not downloaded, with the commands and the agent prompt', async () => {
    const stub = stubChromium();
    const chromium = { ...stub.chromium, executablePath: () => join(dir, 'no-such-chrome') };
    expect(browserReady(chromium)).toBe('no-browser');
    expect(browserReady(null)).toBe('no-playwright');
    expect(browserReady(stub.chromium)).toBe('ready');
    const result = await capture({ cwd: dir, chromium: async () => chromium });
    expect(result.ok).toBe(false);
    expect(stub.calls).toEqual([]);
    expect(printed()).toContain('Chromium is not downloaded, so nothing was captured.');
    expect(printed()).toContain('npx playwright install chromium');
    expect(printed()).toContain('npx playwright install --with-deps chromium');
    expect(printed()).toContain('npx helpwell prompt capture');
  });

  it('says when Chromium cannot start, as on a server without its libraries', async () => {
    const chromium: PlaywrightChromium = {
      launch: async () => {
        throw new Error(
          'browserType.launch: Host system is missing dependencies to run browsers.\nlibnss3',
        );
      },
    };
    const result = await capture({ cwd: dir, chromium: async () => chromium });
    expect(result).toMatchObject({ ok: false, skipped: ['billing'] });
    expect(printed()).toContain('Chromium could not start');
    expect(printed()).toContain('Host system is missing dependencies');
    expect(printed()).not.toContain('libnss3');
    expect(printed()).toContain('--with-deps');
  });
});
