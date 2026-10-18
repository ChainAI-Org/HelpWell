/**
 * Where the repo is, for the tools that work on files or run the CLI.
 *
 * The read tools only need the database. Writing an article needs the docs
 * folder, and drafting a changelog or retaking screenshots needs the
 * `helpwell` CLI installed in the repo, so those tools look for the install
 * the same way the CLI does: walk up from the working directory to
 * `helpwell/helpwell.config.json`. A client that starts the server somewhere
 * else (Claude Desktop does) sets HELPWELL_PROJECT_DIR.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { HelpWellError } from '@helpwell/core';
import type { ModelPort } from '@helpwell/core/agent';
import { findProjectRoot } from '@helpwell/core/db';

/** What one `helpwell <command> --json` run printed. */
export interface CliOutcome {
  ok: boolean;
  command?: string;
  result?: unknown;
  error?: { code: string; message: string };
}

export type CliRunner = (args: string[]) => Promise<CliOutcome>;

export interface McpEnvironment {
  /** The repo root, or null when the server is not running inside an install. */
  root: string | null;
  /** The docs folder from the config, absolute. */
  docsDir: string | null;
  /** Runs the repo's own `helpwell` CLI with `--json`. */
  runCli: CliRunner;
  /**
   * What a saved article is embedded with, so semantic search has it as
   * saved. Left out: OpenRouter with OPENROUTER_API_KEY from the server's
   * environment, when it is set. Null: never; the article is indexed as text
   * and the next sync with a key embeds it.
   */
  model?: ModelPort | null;
}

/** Find the install from HELPWELL_PROJECT_DIR or the working directory. */
export function resolveEnvironment(
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): McpEnvironment {
  const env = options.env ?? process.env;
  const explicit = env.HELPWELL_PROJECT_DIR?.trim();
  const root = explicit ? resolve(explicit) : findProjectRoot(options.cwd ?? process.cwd());
  return {
    root,
    docsDir: root ? docsDirOf(root) : null,
    runCli: root ? cliRunner(root) : notInstalled,
  };
}

function docsDirOf(root: string): string {
  try {
    const config = JSON.parse(
      readFileSync(join(root, 'helpwell', 'helpwell.config.json'), 'utf8'),
    ) as { docs?: unknown };
    const docs = typeof config.docs === 'string' ? config.docs : 'docs';
    return isAbsolute(docs) ? docs : join(root, docs);
  } catch {
    return join(root, 'docs');
  }
}

async function notInstalled(): Promise<CliOutcome> {
  throw new HelpWellError(
    'not_configured',
    'No HelpWell install found. Start this server from the repo HelpWell is installed in, or set HELPWELL_PROJECT_DIR to that repo.',
  );
}

/** The CLI's entry point, found the way Node would find the package from the repo. */
export function findCliBin(root: string): string | null {
  for (let dir = root; ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', 'helpwell', 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
          bin?: string | Record<string, string>;
        };
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.helpwell;
        if (bin) return join(dirname(manifest), bin);
      } catch {
        return null;
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

/** How long a CLI run may take. Capture drives a browser; a changelog calls a model. */
const CLI_TIMEOUT_MS = 10 * 60_000;

export function cliRunner(root: string): CliRunner {
  return (args) =>
    new Promise((done, fail) => {
      const bin = findCliBin(root);
      if (!bin) {
        fail(
          new HelpWellError(
            'not_configured',
            'The helpwell CLI is not installed in this repo. Run `npm install -D helpwell` there.',
          ),
        );
        return;
      }
      const child = spawn(process.execPath, [bin, ...args, '--json'], {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
      child.on('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          done(JSON.parse(stdout) as CliOutcome);
        } catch {
          const tail = stderr.trim().split('\n').slice(-5).join('\n');
          fail(
            new HelpWellError(
              'upstream_failed',
              `helpwell ${args[0]} failed: ${tail || 'no output'}`,
            ),
          );
        }
      });
    });
}
