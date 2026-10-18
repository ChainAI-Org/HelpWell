/**
 * `helpwell link` — connect this install to a remote support extension.
 *
 * Human support comes from a service HelpWell reaches over HTTPS: any service
 * that implements the remote support extension protocol (see
 * docs/support-extension.md). Connecting one takes three values. The URL and
 * the product id are not secrets, so they are saved in helpwell.config.json
 * where the team can see them. The token is a secret, so it never touches the
 * file: the command says where it goes (HELPWELL_SUPPORT_TOKEN, in the
 * server's environment) and refuses a `--token` flag outright.
 *
 * The server reads all three from its environment, so the command also prints
 * the exact lines to set there, then checks the connection with the token
 * from this shell if it has one. `--status` repeats the check, `unlink`
 * forgets the connection, and `--prompt` prints the same setup as a prompt
 * for an AI assistant.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  checkRemoteSupport,
  formatSetupPrompt,
  remoteSupportPromptSpec,
  SUPPORT_PRODUCT_ENV,
  SUPPORT_TOKEN_ENV,
  SUPPORT_URL_ENV,
} from '@helpwell/core';
import { type RemoteSupportCheck, supportBaseUrl } from '@helpwell/core/api';
import { loadProject, type Project, readSupportLink, type SupportLink } from '../project.js';
import { detail, heading, ok, say, step, style, table, warn } from '../ui.js';

export interface LinkOptions {
  cwd: string;
  /** The service's base URL. Asked for when missing and a person is at the keyboard. */
  url?: string;
  product?: string;
  /** Refused: a token never goes in the config. Present only so the refusal can be explained. */
  token?: string;
  /** Print the AI-assistant prompt as well. */
  prompt?: boolean;
  /** Ask for what is missing. Defaults to whether stdin is a terminal. */
  interactive?: boolean;
  /** For tests: answers to the questions, and the environment and fetch the check uses. */
  ask?: (question: string) => Promise<string>;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface LinkResult {
  url: string;
  product: string;
  configPath: string;
  /** Whether HELPWELL_SUPPORT_TOKEN is set in this shell. Never its value. */
  tokenSet: boolean;
  /** The connection check, or null when there was no token to check with. */
  check: RemoteSupportCheck | null;
  /** What to set on the server, token last and empty. */
  environment: { name: string; value: string | null }[];
  prompt?: string;
}

export interface LinkStatus {
  linked: boolean;
  /** What the server will use: the environment first, then helpwell.config.json. */
  url: string | null;
  product: string | null;
  source: { url: 'env' | 'config' | null; product: 'env' | 'config' | null };
  tokenSet: boolean;
  check: RemoteSupportCheck | null;
}

/** Save the URL and product, say what to set on the server, and check the connection. */
export async function link(options: LinkOptions): Promise<LinkResult> {
  if (options.token !== undefined) {
    throw new Error(
      `The token never goes in helpwell.config.json or on a command line. Set ${SUPPORT_TOKEN_ENV} in the server's environment instead.`,
    );
  }
  const project = loadProject(options.cwd);
  const env = options.env ?? process.env;
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY);
  const current = project.config.support;

  let url = options.url?.trim() || '';
  let product = options.product?.trim() || '';
  if ((!url || !product) && interactive) {
    const ask = options.ask ?? terminalQuestion;
    if (!url) url = (await ask(question('Service URL', current?.url))).trim() || current?.url || '';
    if (!product) {
      product =
        (await ask(question('Product id', current?.product))).trim() || current?.product || '';
    }
  }
  if (!url || !product) {
    throw new Error('Say where to connect: helpwell link --url https://… --product <id>');
  }

  // The same check the server makes, so a URL it would refuse is refused here.
  const base = supportBaseUrl(url).href.replace(/\/+$/, '');
  writeSupportLink(project, { url: base, product });
  ok(`Linked to ${base} (product ${product})`);
  detail(`Saved in ${project.paths.configPath}. The token is not saved there, and never will be.`);

  const environment = [
    { name: SUPPORT_URL_ENV, value: base },
    { name: SUPPORT_PRODUCT_ENV, value: product },
    { name: SUPPORT_TOKEN_ENV, value: null },
  ];
  heading('Set these on the server that runs HelpWell');
  table(
    environment.map(({ name, value }) => [
      name,
      value ?? style.dim('paste the token here yourself; keep it out of the repo'),
    ]),
  );
  detail('Then restart the server. Nothing else in your code changes.');

  const token = env[SUPPORT_TOKEN_ENV]?.trim() ?? '';
  const check = token ? await runCheck({ url: base, product, token }, options.fetch) : null;
  if (!token) {
    say();
    warn(`${SUPPORT_TOKEN_ENV} is not set in this shell, so the connection was not checked.`);
    detail('Set it here too and run `helpwell link --status` to check.');
  }

  const prompt = options.prompt ? promptFor(project, { url: base, product }) : undefined;
  if (prompt) printPrompt(prompt);
  say();

  return {
    url: base,
    product,
    configPath: project.paths.configPath,
    tokenSet: Boolean(token),
    check,
    environment,
    ...(prompt ? { prompt } : {}),
  };
}

/** Where the connection points, whether a token is set, and whether it answers. */
export async function linkStatus(
  options: Pick<LinkOptions, 'cwd' | 'env' | 'fetch' | 'prompt'>,
): Promise<LinkStatus> {
  const project = loadProject(options.cwd);
  const env = options.env ?? process.env;
  const saved = project.config.support;
  const envUrl = env[SUPPORT_URL_ENV]?.trim() || '';
  const envProduct = env[SUPPORT_PRODUCT_ENV]?.trim() || '';
  const token = env[SUPPORT_TOKEN_ENV]?.trim() ?? '';

  const url = envUrl || saved?.url || null;
  const product = envProduct || saved?.product || null;
  const source = {
    url: envUrl ? ('env' as const) : saved?.url ? ('config' as const) : null,
    product: envProduct ? ('env' as const) : saved?.product ? ('config' as const) : null,
  };

  heading('Remote support extension');
  if (!url || !product) {
    warn('Not linked. Run `helpwell link --url https://… --product <id>`.');
    say();
    return { linked: false, url, product, source, tokenSet: Boolean(token), check: null };
  }
  table([
    [
      'URL',
      `${url} ${style.dim(`(${source.url === 'env' ? SUPPORT_URL_ENV : 'helpwell.config.json'})`)}`,
    ],
    [
      'Product',
      `${product} ${style.dim(`(${source.product === 'env' ? SUPPORT_PRODUCT_ENV : 'helpwell.config.json'})`)}`,
    ],
    [SUPPORT_TOKEN_ENV, token ? 'set' : style.yellow('not set in this shell')],
  ]);

  let check: RemoteSupportCheck | null = null;
  if (token) {
    say();
    check = await runCheck({ url, product, token }, options.fetch);
  } else {
    say();
    warn(`Set ${SUPPORT_TOKEN_ENV} in this shell to check the connection.`);
  }
  if (options.prompt) printPrompt(promptFor(project, { url, product }));
  say();
  return { linked: true, url, product, source, tokenSet: Boolean(token), check };
}

/** Forget the connection in helpwell.config.json. The server's environment is the person's to change. */
export function unlink(options: Pick<LinkOptions, 'cwd'>): { removed: boolean } {
  const project = loadProject(options.cwd);
  const removed = writeSupportLink(project, null);
  if (removed) ok('Unlinked: the remote support extension is no longer in helpwell.config.json.');
  else detail('Nothing to unlink: helpwell.config.json has no remote support extension.');
  detail(
    `Remove ${SUPPORT_URL_ENV}, ${SUPPORT_PRODUCT_ENV} and ${SUPPORT_TOKEN_ENV} from the server's environment and restart it to disconnect.`,
  );
  say();
  return { removed };
}

/* ---------------------------------------------------------------- helpers */

async function runCheck(
  connection: { url: string; product: string; token: string },
  fetchImpl?: typeof fetch,
): Promise<RemoteSupportCheck> {
  step('Checking the connection…');
  const check = await checkRemoteSupport({ ...connection, fetch: fetchImpl });
  if (check.ok) ok(`${check.message} ${style.dim(`(${check.latencyMs} ms)`)}`);
  else warn(`${check.message}${check.status ? ` ${style.dim(`(HTTP ${check.status})`)}` : ''}`);
  return check;
}

/**
 * Set or remove `support` in the config file, leaving every other byte of
 * it as the team wrote it rather than re-serialising the whole project.
 * Resolves to whether anything changed.
 */
function writeSupportLink(project: Project, next: SupportLink | null): boolean {
  const path = project.paths.configPath;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const before = readSupportLink(raw.support);
  if (next) {
    raw.support = { url: next.url, product: next.product };
  } else {
    if (raw.support === undefined) return false;
    delete raw.support;
  }
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return next ? before?.url !== next.url || before?.product !== next.product : true;
}

function promptFor(project: Project, connection: SupportLink): string {
  return formatSetupPrompt(
    remoteSupportPromptSpec({
      productName: project.config.settings.product.name,
      url: connection.url,
      product: connection.product,
      apiPath: project.config.apiPath,
    }),
  );
}

function printPrompt(prompt: string): void {
  heading('Set this up with an AI assistant');
  detail('Paste this into ChatGPT, Claude or your coding agent. It holds no token.');
  say();
  say(prompt);
}

function question(label: string, current?: string): string {
  return current ? `${label} [${current}]: ` : `${label}: `;
}

async function terminalQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}
