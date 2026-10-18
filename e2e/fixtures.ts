/**
 * What every journey shares.
 *
 * - `admin`: HelpWell's admin API, signed in with the admin token's cookie,
 *   the way a deployed install's admins sign in. Tests read results back
 *   through it rather than trusting what the page says.
 * - Settings are photographed before each test and put back after it, so a
 *   test can switch the bot check on, or replace every engagement, and the
 *   next test still starts from the same install. Tests run one at a time
 *   (playwright.config.ts), so nothing sees the change but the test making it.
 * - The browser cannot leave the machine. Every request to another host is
 *   refused, except Cloudflare's Turnstile script, which is answered with a
 *   stand-in that behaves the way Cloudflare's published test site keys do.
 *   The server side has its own guard (support/offline-guard.mjs).
 * - No page or frame may break its Content Security Policy: a violation
 *   anywhere fails the test (`csp`). The dashboard's own policy is
 *   `script-src 'self'`, so this is what keeps it free of inline scripts.
 */

import {
  type APIRequestContext,
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { API_PATH, E2E_ADMIN_TOKEN, PLAYGROUND } from './support/ports.mjs';

export {
  API_PATH,
  DASHBOARD_PATH,
  HELP_PATH,
  HOST_ORIGIN,
  PLAYGROUND,
  WORK_DIR,
} from './support/ports.mjs';
export { expect };

/**
 * The admin token's cookie, as the dashboard's sign-in page sets it. The
 * suite runs a production build, which ignores the playground's demo cookie
 * (examples/playground/lib/admin.ts); serve-playground.mjs starts it with
 * this token.
 */
export const ADMIN_COOKIE = { name: 'hw_admin', value: E2E_ADMIN_TOKEN } as const;

/** Cloudflare's published Turnstile test site keys. */
export const TURNSTILE_SITE_KEYS = {
  alwaysPasses: '1x00000000000000000000AA',
  alwaysBlocks: '2x00000000000000000000AB',
} as const;

/** The token Cloudflare's test site keys hand out. */
export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/* ------------------------------------------------------------ admin API */

export class AdminApi {
  constructor(private readonly request: APIRequestContext) {}

  async get<T = unknown>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PATCH', path, body);
  }

  async post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.request.fetch(`${API_PATH}${path}`, {
      method,
      ...(body === undefined ? {} : { data: body }),
    });
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`${method} ${path} answered ${response.status()}: ${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** Anything a Settings patch can hold: nested objects merge, arrays replace. */
export type SettingsPatch = Record<string, unknown>;

export class SettingsControl {
  constructor(private readonly admin: AdminApi) {}

  /** Deep-merges `patch` into the install's Settings, as the dashboard does. */
  async patch(patch: SettingsPatch): Promise<Record<string, unknown>> {
    return this.admin.patch('/admin/settings', patch);
  }

  async read(): Promise<Record<string, unknown>> {
    return this.admin.get('/admin/settings');
  }
}

/* ------------------------------------------------------ offline browser */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `window.turnstile`, as Cloudflare's test site keys behave: a 1x… key
 * passes with the dummy token, a 2x… key always fails. The widget code that
 * loads it, renders it and sends its token is the real thing.
 */
const FAKE_TURNSTILE = `(() => {
  const widgets = new Map();
  let next = 0;
  function run(id) {
    const widget = widgets.get(id);
    if (!widget) return;
    const key = String(widget.options.sitekey || '');
    setTimeout(() => {
      if (key.startsWith('2x')) widget.options['error-callback'] && widget.options['error-callback']('110200');
      else widget.options.callback && widget.options.callback(${JSON.stringify(TURNSTILE_DUMMY_TOKEN)});
    }, 50);
  }
  window.turnstile = {
    render(container, options) {
      const id = 'e2e-turnstile-' + ++next;
      widgets.set(id, { container, options });
      run(id);
      return id;
    },
    reset(id) { run(id); },
    remove(id) { widgets.delete(id); },
    getResponse() { return ${JSON.stringify(TURNSTILE_DUMMY_TOKEN)}; },
  };
})();`;

/**
 * Content Security Policy violations seen during the current test, in every
 * page and frame of every context `keepOffline` prepared: the
 * `securitypolicyviolation` event, and Chromium's console line as a second
 * witness. The `csp` fixture fails the test on any. The dashboard runs under
 * `script-src 'self'`, so an inline script or handler anywhere in it is one.
 */
export const cspViolations: string[] = [];

interface CspReport {
  directive: string;
  blocked: string;
  document: string;
  sample: string;
  line: number;
}

async function watchCsp(context: BrowserContext): Promise<void> {
  await context.exposeBinding('__hwCspViolation', (_source, report: CspReport) => {
    cspViolations.push(
      `${report.directive} blocked ${report.blocked || '(inline)'} on ${report.document}${
        report.line ? `:${report.line}` : ''
      }${report.sample ? ` "${report.sample}"` : ''}`,
    );
  });
  // Every frame, before any of its own scripts run.
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __hwCspViolation?: (r: unknown) => void })
        .__hwCspViolation;
      report?.({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        document: event.documentURI,
        sample: event.sample,
        line: event.lineNumber,
      });
    });
  });
  context.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      cspViolations.push(`console: ${message.text()}`);
    }
  });
}

/**
 * Refuse the internet, stand in for Turnstile, and watch for Content Security
 * Policy violations. Returns what was refused.
 */
export async function keepOffline(context: BrowserContext): Promise<string[]> {
  await watchCsp(context);
  const refused: string[] = [];
  await context.route(
    (url) => !LOCAL_HOSTS.has(url.hostname),
    (route) => {
      refused.push(route.request().url());
      return route.abort('blockedbyclient');
    },
  );
  // Registered last, so it wins over the refusal above.
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }),
  );
  return refused;
}

/* --------------------------------------------------------------- widget */

/** The support widget on a page, driven the way a visitor would. */
export class Widget {
  readonly host: Locator;
  readonly launcher: Locator;
  readonly panel: Locator;
  /** Every answer the agent has given in the open thread. */
  readonly answers: Locator;
  /** Everything the visitor has said in it (not the loading placeholders). */
  readonly questions: Locator;

  constructor(readonly page: Page) {
    this.host = page.locator('helpwell-widget');
    this.launcher = this.host.locator('button.launcher');
    this.panel = page.locator('#hw-panel');
    this.answers = this.panel.locator('.msgGroup--agent');
    this.questions = this.panel.locator('.msgGroup > .bubble--customer');
  }

  async open(): Promise<void> {
    await this.launcher.click();
    await expect(this.panel).toHaveAttribute('data-open', 'true');
  }

  /** From Home, a new conversation. */
  async newConversation(): Promise<void> {
    await this.panel.getByRole('button', { name: /^(Ask a question|Ask something else)$/ }).click();
  }

  /**
   * Asks a question and waits for the answer. The first question of a new
   * conversation may go through the pre-chat form, as it does for an
   * anonymous visitor under Ridgeline's settings.
   */
  async ask(question: string): Promise<{ answer: Locator; reply: ChatReply }> {
    const start = this.panel.getByRole('button', { name: 'Start the conversation' });
    const composer = this.panel.getByRole('textbox', { name: 'Your message' });
    await expect(start.or(composer).first()).toBeVisible();
    const before = await this.answers.count();
    const sent = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(`${API_PATH}/chat`),
    );

    if (await start.isVisible()) {
      await this.panel.getByRole('textbox', { name: 'Your question' }).fill(question);
      await start.click();
    } else {
      await composer.fill(question);
      await composer.press('Enter');
    }

    const reply = (await (await sent).json()) as ChatReply;
    await expect(this.answers).toHaveCount(before + 1);
    await expect(this.panel.getByText('Writing a reply…')).toHaveCount(0);
    return { answer: this.answers.nth(before), reply };
  }
}

/** What `POST /chat` answers, as far as the journeys look at it. */
export interface ChatReply {
  conversationId: string;
  messageId: string;
  text: string;
  citations: { slug: string; title: string }[];
  unresolved: boolean;
  smallTalk?: boolean;
  askForEmail?: unknown;
}

/** Whether the element right after `locator`, in the same parent, has `className`. */
export async function nextSiblingHasClass(locator: Locator, className: string): Promise<boolean> {
  return locator.evaluate(
    (element, name) => element.nextElementSibling?.classList.contains(name) === true,
    className,
  );
}

/* ------------------------------------------------------------- fixtures */

interface Fixtures {
  admin: AdminApi;
  settings: SettingsControl;
  widget: Widget;
  /** Requests the browser tried to make off this machine, and was refused. */
  refused: string[];
  /** Content Security Policy violations so far in this test, in any frame. */
  csp: string[];
}

export const test = base.extend<Fixtures>({
  admin: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({
      baseURL: PLAYGROUND,
      extraHTTPHeaders: { cookie: `${ADMIN_COOKIE.name}=${ADMIN_COOKIE.value}` },
    });
    await use(new AdminApi(request));
    await request.dispose();
  },

  settings: [
    async ({ admin }, use) => {
      const before = await admin.get('/admin/settings');
      await use(new SettingsControl(admin));
      // Always, rather than only when a read says something changed: one
      // PATCH is cheaper than comparing, and a test may have saved through
      // the dashboard as well as through this API.
      await admin.patch('/admin/settings', before);
    },
    { auto: true },
  ],

  refused: [
    async ({ context }, use) => {
      const refused = await keepOffline(context);
      await use(refused);
      // Refused is not enough: a page that reaches for another host (a font,
      // an analytics tag) is telling that host about every visitor.
      expect(refused, 'requests the pages made to other hosts').toEqual([]);
    },
    { auto: true },
  ],

  // After `refused`, which prepares the context this watches.
  csp: [
    async ({ refused: _refused }, use) => {
      cspViolations.length = 0;
      await use(cspViolations);
      expect(cspViolations, 'Content Security Policy violations, in any frame').toEqual([]);
    },
    { auto: true },
  ],

  widget: async ({ page }, use) => {
    await use(new Widget(page));
  },
});

/** Signs the browser in as a Ridgeline admin, so the dashboard opens. */
export async function signInAsAdmin(context: BrowserContext): Promise<void> {
  await context.addCookies([{ ...ADMIN_COOKIE, url: PLAYGROUND }]);
}

/** A unique email for this run, so repeat submissions never collide. */
export function uniqueEmail(label: string, project: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `e2e-${label}-${project}-${stamp}@northwind.example`;
}
