/**
 * `helpwell init` — install HelpWell into a repo.
 *
 * It writes files and nothing else: no database, no account, and no network
 * but one read-only question to GitHub when the repo's origin is there (does
 * it publish releases, to draft the changelog from?). The point is that
 * someone can run it, read the diff, and understand exactly what they have
 * agreed to before anything talks to a model (DX-01).
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { defaultSettings } from '@helpwell/core/settings';
import type { ProjectConfig } from '../project.js';
import { pathsFor, saveConfig, writeFile } from '../project.js';
import {
  DOCS_WORKFLOW_PATH,
  docsReadme,
  docsWorkflowTemplate,
  EVALS_WORKFLOW_PATH,
  envExample,
  evalsTemplate,
  evalsWorkflowTemplate,
  firstArticle,
  gitignoreAdditions,
  instructionsTemplate,
  mountSnippet,
  playbookTemplate,
  widgetSnippet,
} from '../templates.js';
import { detail, heading, list, ok, say, step, style, table, warn } from '../ui.js';
import { initialChangelogSource } from './changelog.js';

export interface InitOptions {
  cwd: string;
  /** Product name. Defaults to the directory name. */
  name?: string;
  docs?: string;
  appUrl?: string;
  framework?: 'next' | 'remix' | 'node' | 'hono';
  /** Write over files that already exist. */
  force?: boolean;
  /** Say what would happen and change nothing. */
  dryRun?: boolean;
  /**
   * Also write GitHub Actions workflows: `helpwell eval --threshold` on pull requests, and
   * `helpwell docs update` on pushes to main, opening a pull request. Off by default.
   */
  ci?: boolean;
  /** How GitHub is asked whether the repo publishes releases. Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Where GITHUB_TOKEN is read from for that question. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface InitResult {
  written: string[];
  skipped: string[];
  root: string;
}

export async function init(options: InitOptions): Promise<InitResult> {
  const root = options.cwd;
  const productName = options.name ?? guessName(root);
  const docs = options.docs ?? 'docs';

  const settings = defaultSettings();
  settings.product.name = productName;
  // Two URLs for two jobs. `settings.product.appUrl` is the public address
  // customers use (shown in the help centre, sent to OpenRouter as the
  // referer) and stays empty until someone knows it. `config.appUrl` is where
  // `capture` and `dev` find the *running* app, so localhost is the right
  // default. An explicit --app-url is the public one, so it fills both.
  settings.product.appUrl = options.appUrl ?? '';
  // Written out rather than left to be worked out on every run, so the
  // config says where changelog entries will be drafted from, and a person
  // can see it and change it.
  settings.changelog.source = await initialChangelogSource(root, {
    fetch: options.fetch,
    env: options.env,
  });

  const config: ProjectConfig = {
    settings,
    docs,
    screenshots: { dir: `${docs}/_screenshots`, shots: [] },
    appUrl: options.appUrl ?? 'http://localhost:3000',
    evalFile: 'helpwell/evals.json',
  };

  const paths = pathsFor(root, config);
  const written: string[] = [];
  const skipped: string[] = [];

  // Paths are printed with forward slashes on every platform: they end up in
  // README instructions and commit messages, where a backslash looks wrong.
  const show = (path: string) => relative(root, path).split(sep).join('/');

  const put = (path: string, contents: string) => {
    if (existsSync(path) && !options.force) {
      skipped.push(show(path));
      return;
    }
    written.push(show(path));
    if (!options.dryRun) writeFile(path, contents);
  };

  heading(`Installing HelpWell into ${style.bold(productName)}`);

  put(paths.instructionsPath, instructionsTemplate(productName));
  put(paths.playbookPath, playbookTemplate(productName));
  put(join(root, config.evalFile), evalsTemplate(productName));
  put(join(paths.docsDir, 'README.md'), docsReadme(productName));
  put(join(paths.docsDir, 'getting-started', 'welcome.md'), firstArticle(productName));
  put(join(root, '.env.example'), envExample);
  if (options.ci) {
    put(join(root, EVALS_WORKFLOW_PATH), evalsWorkflowTemplate(docs));
    put(join(root, DOCS_WORKFLOW_PATH), docsWorkflowTemplate(docs));
  }

  // The config is written last so a half-finished install is not mistaken for
  // a complete one by `findRoot`.
  if (existsSync(paths.configPath) && !options.force) {
    skipped.push(show(paths.configPath));
  } else {
    written.push(show(paths.configPath));
    if (!options.dryRun) saveConfig(paths, config);
  }

  appendGitignore(root, options.dryRun ?? false, written);

  say();
  if (written.length > 0) {
    ok(
      options.dryRun ? `${written.length} files would be written` : `Wrote ${written.length} files`,
    );
    list(written);
  }
  if (skipped.length > 0) {
    warn(`${skipped.length} already existed and were left alone`);
    list(skipped);
    detail('Pass --force to overwrite them.');
  }

  heading('Two things left');

  say();
  step('1. Mount HelpWell in your app');
  say();
  say(indent(mountSnippet(options.framework ?? 'next', docs)));
  say();
  // The one line in there that must change before a deploy, said outright.
  detail(
    "isAdmin fails closed. Until you replace it with your app's own admin check (see the TODO), the dashboard lets in only someone who enters HELPWELL_ADMIN_TOKEN (32+ characters), and nobody while it is unset.",
  );

  say();
  step('2. Add the widget to your layout');
  say();
  say(indent(widgetSnippet('/api/helpwell')));

  heading('Then');
  table([
    ['helpwell doctor', 'check the install'],
    ['helpwell sync', 'index your docs'],
    ['helpwell docs generate', 'draft articles from your code'],
    ['helpwell dev', 'try the agent in the terminal'],
  ]);

  say();
  detail('An OpenRouter key goes in OPENROUTER_API_KEY. Without one, search still works.');
  if (!options.ci) {
    detail(
      `\`helpwell eval\` scores the agent against ${config.evalFile}. \`helpwell init --ci\` adds GitHub Actions workflows that run it on every pull request, and that run \`helpwell docs update\` on every push to main and open a pull request with the articles it rewrote.`,
    );
  }
  say();

  return { written, skipped, root };
}

function guessName(root: string): string {
  // The package name is a better guess than the folder, and the folder is a
  // better guess than nothing.
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) {
      return pkg.name
        .replace(/^@[^/]+\//, '')
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    }
  } catch {
    // No package.json, or not JSON. The folder name will do.
  }
  const folder = basename(root);
  return folder.charAt(0).toUpperCase() + folder.slice(1);
}

/** Keep the local database out of git, without clobbering their .gitignore. */
function appendGitignore(root: string, dryRun: boolean, written: string[]): void {
  const path = join(root, '.gitignore');
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    // No .gitignore yet; one will be created with just our entry.
  }
  if (current.includes('helpwell/data')) return;
  written.push('.gitignore');
  if (!dryRun) writeFile(path, current + gitignoreAdditions);
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${style.dim(line)}`)
    .join('\n');
}
