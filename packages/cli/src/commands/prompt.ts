/**
 * `helpwell prompt <topic>` — any setup step, as a prompt for an AI assistant.
 *
 * Plenty of people hand setup to ChatGPT, Claude or a coding agent. The
 * dashboard shows a prompt beside each step; this prints the same prompt in a
 * terminal, which is where a coding agent is. The specs live in core, shared
 * with the dashboard and the docs, and this file only picks one and fills it
 * in with what the CLI can read here: helpwell.config.json (the product's
 * name, `apiPath`, the docs folder, `appUrl`, the linked support service), the
 * framework package.json points at, the lockfile, and the repo's GitHub
 * remote. It works before `init` too, with defaults, because the first prompt
 * anyone needs is the one that installs HelpWell.
 *
 * No prompt carries a secret: each names the environment variable and says
 * where the person pastes the value. The prompt alone goes to stdout (the
 * heading goes to stderr), so `helpwell prompt install > prompt.md` or a pipe
 * to the clipboard gets exactly the prompt.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  contactImportPromptSpec,
  docsPromptSpec,
  evalCasesPromptSpec,
  FORM_EMBED_PLATFORMS,
  type FormEmbedPlatform,
  firstAnswerPromptSpec,
  formatSetupPrompt,
  formEmbedPromptSpec,
  formPopupButtonPromptSpec,
  githubTokenPromptSpec,
  HelpWellError,
  identitySigningPromptSpec,
  mcpSetupPromptSpec,
  modelKeyPromptSpec,
  remoteSupportPromptSpec,
  type SetupPromptSpec,
  searchIndexPromptSpec,
  turnstilePromptSpec,
  WIDGET_FRAMEWORKS,
  type WidgetFramework,
  webhookReceiverPromptSpec,
  widgetCspPromptSpec,
  widgetInstallPromptSpec,
} from '@helpwell/core';
import {
  captureLoginSetupPrompt,
  captureSetupPrompt,
  DEFAULT_API_PATH,
  writeArticleSetupPrompt,
} from '@helpwell/core/content';
import { engageCodePromptSpec } from '@helpwell/core/repos';
import { parseGitHubRepo } from '../github-releases.js';
import { installPromptSpec, type MountFramework, type PackageManager } from '../install-prompt.js';
import { findRoot, loadProject, type SupportLink } from '../project.js';
import { ok, say, style, warn } from '../ui.js';

/* ------------------------------------------------------------------ facts */

/** What the CLI knows about the app it is run in, for filling in a prompt. */
export interface PromptFacts {
  /** The project root, or the working directory before `init`. */
  root: string;
  /** Whether helpwell/helpwell.config.json was found. */
  installed: boolean;
  productName: string;
  apiPath: string;
  /** The public origin, from `product.appUrl`, when it is set. */
  origin: string | null;
  /** Where the app runs for `capture` and `dev` (the config's `appUrl`). */
  appUrl: string;
  docs: string;
  screenshots: string;
  /** The framework to mount HelpWell in, for `init --framework`. */
  mount: MountFramework | null;
  /** The site's framework, for the widget install recipe. */
  site: WidgetFramework;
  /** How the framework was worked out, e.g. "next in package.json". */
  detected: string | null;
  packageManager: PackageManager;
  inlineVideo: boolean;
  botCheck: boolean;
  /** `owner/name` from `changelog.repo` or the origin remote. */
  repo: string | null;
  support: SupportLink | null;
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * The framework, from the dependencies package.json lists (and, for apps
 * that are not Node, the files that give Rails and Django away). The first
 * match wins, most specific first: a Next.js app also depends on React.
 */
export function detectFramework(root: string): {
  mount: MountFramework | null;
  site: WidgetFramework;
  detected: string | null;
} {
  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const has = (name: string) => Object.hasOwn(deps, name);
  const found = (name: string) => `${name} in package.json`;

  if (has('next')) return { mount: 'next', site: 'nextjs', detected: found('next') };
  for (const name of ['@remix-run/node', '@remix-run/react', '@react-router/node']) {
    if (has(name)) return { mount: 'remix', site: 'html', detected: found(name) };
  }
  if (has('@sveltejs/kit')) {
    return { mount: 'node', site: 'sveltekit', detected: found('@sveltejs/kit') };
  }
  if (has('nuxt')) return { mount: 'node', site: 'vue', detected: found('nuxt') };
  if (has('hono')) return { mount: 'hono', site: 'html', detected: found('hono') };
  for (const name of ['express', 'fastify', 'koa']) {
    if (has(name)) return { mount: 'node', site: 'html', detected: found(name) };
  }
  if (has('vue')) return { mount: null, site: 'vue', detected: found('vue') };
  if (has('react') && has('vite')) {
    return { mount: null, site: 'react-vite', detected: 'react and vite in package.json' };
  }
  if (!pkg) {
    const gemfile = readText(join(root, 'Gemfile'));
    if (/^\s*gem\s+['"]rails['"]/m.test(gemfile)) {
      return { mount: null, site: 'rails', detected: 'rails in the Gemfile' };
    }
    if (existsSync(join(root, 'manage.py'))) {
      return { mount: null, site: 'django', detected: 'manage.py' };
    }
  }
  return { mount: null, site: 'html', detected: null };
}

/** npm, unless a lockfile says the app uses something else. */
export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** `owner/name` from the origin remote, when it is on GitHub. No network. */
function githubRemote(root: string): string | null {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return url ? parseGitHubRepo(url) : null;
  } catch {
    return null;
  }
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * What a prompt is filled in with when nothing is known: no project, no
 * framework, and no product name, so each spec uses its own wording ("my
 * product"). The README's prompts are these, so they read the same for
 * everyone.
 */
export function defaultPromptFacts(root = ''): PromptFacts {
  return {
    root,
    installed: false,
    productName: '',
    apiPath: DEFAULT_API_PATH,
    origin: null,
    appUrl: 'http://localhost:3000',
    docs: 'docs',
    screenshots: 'docs/_screenshots',
    mount: null,
    site: 'html',
    detected: null,
    packageManager: 'npm',
    inlineVideo: false,
    botCheck: false,
    repo: null,
    support: null,
  };
}

/** Everything a prompt can be filled in with, from the project at `cwd` or its defaults. */
export function readPromptFacts(cwd: string): PromptFacts {
  const root = findRoot(cwd);
  const framework = detectFramework(root ?? cwd);
  const base = {
    mount: framework.mount,
    site: framework.site,
    detected: framework.detected,
    packageManager: detectPackageManager(root ?? cwd),
  };
  if (!root) {
    // The name `init` would give the product: the package name, else the folder.
    const name = (readPackageJson(cwd)?.name?.replace(/^@[^/]+\//, '') || basename(cwd))
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return { ...defaultPromptFacts(cwd), ...base, productName: name, repo: githubRemote(cwd) };
  }
  const { config } = loadProject(root);
  const { settings } = config;
  return {
    ...base,
    root,
    installed: true,
    productName: settings.product.name,
    apiPath: config.apiPath ?? DEFAULT_API_PATH,
    origin: settings.product.appUrl ? originOf(settings.product.appUrl) : null,
    appUrl: config.appUrl,
    docs: config.docs,
    screenshots: config.screenshots.dir,
    inlineVideo: settings.widget.media.inlineVideo,
    botCheck: settings.agent.abuse.botCheck === 'turnstile',
    repo: settings.changelog.repo.trim() || githubRemote(root),
    support: config.support ?? null,
  };
}

/* ----------------------------------------------------------------- topics */

/** What the flags can override, per topic. */
export interface PromptInput {
  /** Widget recipe (`widget`), or the framework to mount in (`install`). */
  framework?: string;
  /** Forms: html, nextjs, wordpress, or button. */
  platform?: string;
  /** Forms: the form's id. */
  form?: string;
  /** Engage: the tracked event that shows the engagement. */
  event?: string;
  /** Engage: the engagement's id, for a manual show. */
  engagement?: string;
  /** The API's public origin, e.g. https://app.acme.com. */
  origin?: string;
  /** Turnstile: every domain the widget is on, comma separated. */
  domains?: string;
  /** Webhooks: where the receiver lives. Link: the service's URL. */
  url?: string;
  /** Link: the product id the service gave. */
  product?: string;
  /** Changelog: `owner/name` on GitHub. */
  repo?: string;
  /** Contacts import: the tool the contacts come from. */
  tool?: string;
}

export interface PromptTopic {
  name: string;
  summary: string;
  /** Flags that change this topic's prompt, as [flag, what it does]. */
  flags?: [string, string][];
  spec(facts: PromptFacts, input: PromptInput): SetupPromptSpec;
}

const MOUNT_FRAMEWORKS: readonly MountFramework[] = ['next', 'remix', 'hono', 'node'];
const SITE_FRAMEWORKS = WIDGET_FRAMEWORKS.map((f) => f.key);
const FORM_PLATFORMS = [...FORM_EMBED_PLATFORMS, 'button'] as const;

function install(facts: PromptFacts, input: PromptInput): SetupPromptSpec {
  const given = input.framework;
  if (given !== undefined && !(MOUNT_FRAMEWORKS as readonly string[]).includes(given)) {
    throw new HelpWellError(
      'bad_request',
      `--framework for install is one of ${MOUNT_FRAMEWORKS.join(', ')}; "${given}" is not.`,
    );
  }
  return installPromptSpec({
    productName: facts.productName,
    framework: (given as MountFramework | undefined) ?? facts.mount,
    detected: given ? null : facts.detected,
    packageManager: facts.packageManager,
    apiPath: facts.apiPath,
    docs: facts.docs,
  });
}

function widgetFramework(facts: PromptFacts, input: PromptInput): WidgetFramework {
  const given = input.framework;
  if (given === undefined) return facts.site;
  if (!(SITE_FRAMEWORKS as readonly string[]).includes(given)) {
    throw new HelpWellError(
      'bad_request',
      `--framework for widget is one of ${SITE_FRAMEWORKS.join(', ')}; "${given}" is not.`,
    );
  }
  return given as WidgetFramework;
}

function formPlatform(facts: PromptFacts, input: PromptInput): FormEmbedPlatform | 'button' {
  const given = input.platform;
  if (given === undefined) return facts.site === 'nextjs' ? 'nextjs' : 'html';
  if (!(FORM_PLATFORMS as readonly string[]).includes(given)) {
    throw new HelpWellError(
      'bad_request',
      `--platform is one of ${FORM_PLATFORMS.join(', ')}; "${given}" is not.`,
    );
  }
  return given as FormEmbedPlatform | 'button';
}

/** The facts every install prompt in core takes. */
const installOptions = (facts: PromptFacts, input: PromptInput) => ({
  apiPath: facts.apiPath,
  origin: input.origin ?? facts.origin,
  productName: facts.productName,
  inlineVideo: facts.inlineVideo,
  botCheck: facts.botCheck,
});

/** In the order someone setting HelpWell up meets them. */
export const PROMPT_TOPICS: readonly PromptTopic[] = [
  {
    name: 'install',
    summary: 'Install HelpWell into this app: packages, mount, env, widget, first index',
    flags: [['--framework', `${MOUNT_FRAMEWORKS.join(' | ')}; detected from package.json`]],
    spec: install,
  },
  {
    name: 'model-key',
    summary: 'Set the OpenRouter key the agent answers with',
    spec: (facts, input) => modelKeyPromptSpec(installOptions(facts, input)),
  },
  {
    name: 'widget',
    summary: "Add the widget's script tag to the site's layout",
    flags: [
      ['--framework', `${SITE_FRAMEWORKS.join(' | ')}; detected from package.json`],
      ['--origin', 'the public origin of the API, for a site served from elsewhere'],
    ],
    spec: (facts, input) =>
      widgetInstallPromptSpec(widgetFramework(facts, input), installOptions(facts, input)),
  },
  {
    name: 'identity',
    summary: 'Sign identify tokens on the server, so signed-in people are known',
    spec: (facts, input) => identitySigningPromptSpec(installOptions(facts, input)),
  },
  {
    name: 'docs',
    summary: 'Write, draft or import the first help articles',
    spec: (facts, input) =>
      docsPromptSpec({ ...installOptions(facts, input), docsDir: facts.docs }),
  },
  {
    name: 'search-index',
    summary: 'Index the docs, and keep the index fresh on every deploy',
    spec: (facts, input) =>
      searchIndexPromptSpec({ ...installOptions(facts, input), docsDir: facts.docs }),
  },
  {
    name: 'first-answer',
    summary: 'Ask the agent a first question through the API and check the answer',
    flags: [['--origin', "where the app runs; defaults to the config's appUrl"]],
    spec: (facts, input) =>
      firstAnswerPromptSpec({
        ...installOptions(facts, input),
        origin: input.origin ?? originOf(facts.appUrl),
      }),
  },
  {
    name: 'evals',
    summary: 'Add eval cases to helpwell/evals.json and run them',
    spec: (facts, input) => evalCasesPromptSpec(installOptions(facts, input)),
  },
  {
    name: 'webhooks',
    summary: 'Build a webhook receiver that checks the signature',
    flags: [['--url', 'where the receiver will live, e.g. https://app.acme.com/hooks/helpwell']],
    spec: (facts, input) =>
      webhookReceiverPromptSpec({
        productName: facts.productName,
        url: input.url,
        stack: facts.detected ? facts.detected.replace(/ in package\.json$/, '') : undefined,
      }),
  },
  {
    name: 'mcp',
    summary: "Connect HelpWell's MCP server to Claude Code, Claude Desktop or Cursor",
    spec: (facts) => mcpSetupPromptSpec({ projectDir: facts.root }),
  },
  {
    name: 'import',
    summary: 'Prepare a contacts export from another tool and import it',
    flags: [['--tool', 'the tool the contacts come from, e.g. Intercom']],
    spec: (_facts, input) => contactImportPromptSpec({ tool: input.tool }),
  },
  {
    name: 'turnstile',
    summary: 'Turn on the Cloudflare Turnstile bot check',
    flags: [
      ['--domains', 'every domain the widget is on, comma separated'],
      ['--origin', 'the public origin of the API'],
    ],
    spec: (facts, input) => {
      const origin = input.origin ?? facts.origin ?? undefined;
      const domains = input.domains
        ? input.domains
            .split(',')
            .map((domain) => domain.trim())
            .filter(Boolean)
        : origin
          ? [new URL(origin).hostname]
          : undefined;
      return turnstilePromptSpec({
        productName: facts.productName,
        apiPath: facts.apiPath,
        origin,
        domains,
      });
    },
  },
  {
    name: 'csp',
    summary: "Allow the widget in the site's Content-Security-Policy",
    flags: [['--origin', 'the public origin of the API, when the site is on another one']],
    spec: (facts, input) =>
      widgetCspPromptSpec({
        productName: facts.productName,
        apiPath: facts.apiPath,
        apiOrigin: input.origin,
        inlineVideo: facts.inlineVideo,
        botCheck: facts.botCheck,
      }),
  },
  {
    name: 'capture',
    summary: 'Set up `helpwell capture` for the screenshots the articles use',
    spec: (facts) =>
      captureSetupPrompt({
        appUrl: facts.appUrl,
        docs: facts.docs,
        screenshots: facts.screenshots,
      }),
  },
  {
    name: 'capture-login',
    summary: 'Sign in before capturing, with credentials from the environment',
    spec: (facts) =>
      captureLoginSetupPrompt({
        appUrl: facts.appUrl,
        docs: facts.docs,
        screenshots: facts.screenshots,
      }),
  },
  {
    name: 'write-article',
    summary: "Let the dashboard's article editor save into the repo",
    spec: (facts) => writeArticleSetupPrompt({ docs: facts.docs }),
  },
  {
    name: 'forms-embed',
    summary: 'Put a form on a page, or a button that opens one',
    flags: [
      ['--form', "the form's id, from the dashboard's Forms page"],
      ['--platform', `${FORM_PLATFORMS.join(' | ')}; nextjs when package.json has next`],
    ],
    spec: (facts, input) => {
      const options = {
        formId: input.form?.trim() || 'YOUR-FORM-ID',
        productName: facts.productName,
        apiPath: facts.apiPath,
        origin: input.origin ?? facts.origin,
      };
      const platform = formPlatform(facts, input);
      return platform === 'button'
        ? formPopupButtonPromptSpec(options)
        : formEmbedPromptSpec({ ...options, platform });
    },
  },
  {
    name: 'engage-code',
    summary: 'Show an engagement from the app: on a tracked event, or by id',
    flags: [
      ['--event', 'the tracked event that shows it (the default trigger)'],
      ['--engagement', "the engagement's id, to show it from code instead"],
    ],
    spec: (facts, input) =>
      engageCodePromptSpec({
        productName: facts.productName,
        apiPath: facts.apiPath,
        engagementId: input.engagement,
        trigger: input.engagement && !input.event ? 'manual' : 'event',
        event: input.event,
      }),
  },
  {
    name: 'changelog-token',
    summary: 'A GitHub token so `helpwell changelog` can read releases',
    flags: [['--repo', 'owner/name; defaults to changelog.repo, then the origin remote']],
    spec: (facts, input) =>
      githubTokenPromptSpec({
        productName: facts.productName,
        repo: input.repo ?? facts.repo ?? undefined,
      }),
  },
  {
    name: 'link',
    summary: 'Connect a remote support extension, for human support from a service',
    flags: [
      ['--url', "the service's base URL; defaults to the one `helpwell link` saved"],
      ['--product', 'the product id the service gave you'],
    ],
    spec: (facts, input) =>
      remoteSupportPromptSpec({
        productName: facts.productName,
        url: input.url ?? facts.support?.url,
        product: input.product ?? facts.support?.product,
        apiPath: facts.apiPath,
      }),
  },
];

/** Older names that still work. */
const ALIASES: Record<string, string> = {
  'contacts-import': 'import',
  sync: 'search-index',
  'capture-auth': 'capture-login',
  forms: 'forms-embed',
  engage: 'engage-code',
  changelog: 'changelog-token',
  'support-extension': 'link',
};

export function findTopic(name: string): PromptTopic | undefined {
  const wanted = ALIASES[name] ?? name;
  return PROMPT_TOPICS.find((topic) => topic.name === wanted);
}

/* ---------------------------------------------------------------- command */

export interface PromptOptions extends PromptInput {
  cwd: string;
  topic?: string;
  /** Copy the prompt to the clipboard instead of printing it. */
  copy?: boolean;
  /** `--json`: print nothing; the result is the document. */
  quiet?: boolean;
  /** How the prompt reaches the clipboard. Defaults to the platform's own tool. */
  clipboard?: (text: string) => boolean;
}

export type PromptResult =
  | { kind: 'topics'; topics: { name: string; summary: string; flags: [string, string][] }[] }
  | {
      kind: 'prompt';
      topic: string;
      /** Where the values came from: the project's config, or defaults before `init`. */
      from: 'project' | 'defaults';
      copied: boolean;
      spec: SetupPromptSpec;
      prompt: string;
    };

export function prompt(options: PromptOptions): PromptResult {
  if (!options.topic) {
    const topics = PROMPT_TOPICS.map((topic) => ({
      name: topic.name,
      summary: topic.summary,
      flags: topic.flags ?? [],
    }));
    if (!options.quiet) printTopics();
    return { kind: 'topics', topics };
  }

  const topic = findTopic(options.topic);
  if (!topic) {
    throw new HelpWellError(
      'bad_request',
      `There is no prompt called "${options.topic}". Run \`helpwell prompt\` for the list: ${PROMPT_TOPICS.map((t) => t.name).join(', ')}.`,
    );
  }

  const facts = readPromptFacts(options.cwd);
  const spec = topic.spec(facts, options);
  const text = formatSetupPrompt(spec);
  const from = facts.installed ? 'project' : 'defaults';

  let copied = false;
  if (options.copy) {
    copied = (options.clipboard ?? copyToClipboard)(text);
  }
  if (!options.quiet) {
    const source = facts.installed
      ? 'filled in from helpwell/helpwell.config.json'
      : 'no HelpWell project here yet, so filled in with the defaults';
    if (copied) {
      ok(`Copied the ${topic.name} prompt to the clipboard ${style.dim(`(${source})`)}`);
      say(style.dim('  Paste it into ChatGPT, Claude or your coding agent. It holds no secrets.'));
    } else {
      if (options.copy) warn('No clipboard here, so the prompt is printed instead.');
      // The heading goes to stderr, so the prompt alone can be piped or saved.
      process.stderr.write(
        `${style.bold(`Set this up with an AI assistant: ${topic.summary.toLowerCase()}`)}\n` +
          `${style.dim(`Paste this into ChatGPT, Claude or your coding agent. It holds no secrets; ${source}.`)}\n\n`,
      );
      process.stdout.write(text);
    }
  }
  return { kind: 'prompt', topic: topic.name, from, copied, spec, prompt: text };
}

export function printTopics(): void {
  say();
  say(style.bold('Setup prompts for an AI assistant'));
  say(
    style.dim(
      '  helpwell prompt <topic> prints one, filled in with this project. None holds a secret.',
    ),
  );
  say();
  const width = PROMPT_TOPICS.reduce((max, topic) => Math.max(max, topic.name.length), 0);
  for (const topic of PROMPT_TOPICS) {
    say(`  ${style.dim(topic.name.padEnd(width))}  ${topic.summary}`);
  }
  say();
  say(
    style.dim(
      '  --copy puts it on the clipboard; --json prints the spec; --help lists every flag.',
    ),
  );
  say();
}

/**
 * The platform's clipboard tool, with the text on stdin. False when there is
 * none (a CI runner, a server over SSH), and the caller prints instead.
 */
export function copyToClipboard(text: string): boolean {
  const candidates: [string, string[]][] =
    process.platform === 'win32'
      ? [
          [
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
            ],
          ],
        ]
      : process.platform === 'darwin'
        ? [['pbcopy', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ];
  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}
