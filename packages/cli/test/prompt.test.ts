/**
 * `helpwell prompt <topic>`: every setup step as a prompt for an AI
 * assistant, filled in with what the CLI can read (the config, the framework
 * package.json points at, the lockfile), never with a secret, and working
 * before `init` as well as after.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatSetupPrompt, STANDARD_SETUP_RULES, WEBHOOK_EVENTS } from '@helpwell/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/args.js';
import { init } from '../src/commands/init.js';
import {
  detectFramework,
  detectPackageManager,
  findTopic,
  PROMPT_TOPICS,
  prompt,
  readPromptFacts,
} from '../src/commands/prompt.js';
import { installPromptSpec } from '../src/install-prompt.js';
import { run } from '../src/run.js';

let dir: string;
let stdout: string[];
let stderr: string[];

/** Values that must never reach a prompt, set in the environment while it is built. */
const SECRETS = {
  OPENROUTER_API_KEY: 'sk-or-v1-not-for-any-prompt',
  HELPWELL_IDENTITY_SECRET: 'identity-secret-not-for-any-prompt',
  HELPWELL_SUPPORT_TOKEN: 'support-token-not-for-any-prompt',
  GITHUB_TOKEN: 'ghp_not_for_any_prompt',
  HELPWELL_DATABASE_URL: 'postgres://helpwell:hunter2@db.internal:5432/app',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-prompt-'));
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of Object.keys(SECRETS)) delete process.env[name];
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const path = join(dir, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

/** The parts of helpwell.config.json these tests change. */
interface ConfigFile {
  apiPath?: string;
  appUrl?: string;
  support?: { url: string; product: string };
  settings: { product: { appUrl: string }; changelog: { repo: string } };
}

function editConfig(change: (config: ConfigFile) => void): void {
  const path = join(dir, 'helpwell', 'helpwell.config.json');
  const config = JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
  change(config);
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function printedJson() {
  const text = stdout.join('');
  return JSON.parse(text.slice(text.lastIndexOf('{\n  "ok"')));
}

/** The prompt a topic prints, straight from the command. */
function textOf(topic: string, extra: Record<string, string> = {}): string {
  const result = prompt({ cwd: dir, topic, quiet: true, ...extra });
  if (result.kind !== 'prompt') throw new Error('expected a prompt');
  return result.prompt;
}

describe('helpwell prompt', () => {
  it('lists every topic when none is given', async () => {
    const result = await run(['prompt'], dir);
    expect(result.exitCode).toBe(0);
    const listed = stdout.join('');
    for (const topic of PROMPT_TOPICS) expect(listed).toContain(topic.name);
    expect(listed).toContain('--copy');
  });

  it('has every topic the setup steps need', () => {
    const names = PROMPT_TOPICS.map((topic) => topic.name);
    for (const required of [
      'install',
      'widget',
      'identity',
      'webhooks',
      'mcp',
      'import',
      'turnstile',
      'capture-login',
      'forms-embed',
      'changelog-token',
      'link',
    ]) {
      expect(names).toContain(required);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('builds every topic before init and after, and none of them carries a secret', async () => {
    Object.assign(process.env, SECRETS);
    const check = (topic: string) => {
      const text = textOf(topic);
      for (const rule of STANDARD_SETUP_RULES) expect(text, topic).toContain(rule);
      for (const secret of Object.values(SECRETS)) expect(text, topic).not.toContain(secret);
      expect(text, topic).not.toContain('hunter2');
    };
    for (const topic of PROMPT_TOPICS) check(topic.name);

    await init({ cwd: dir, name: 'Acme' });
    editConfig((config) => {
      config.support = { url: 'https://support.example.com/api', product: 'prod_1' };
    });
    for (const topic of PROMPT_TOPICS) check(topic.name);
  });

  it('prints the prompt alone on stdout, with the heading on stderr', async () => {
    const result = await run(['prompt', 'mcp'], dir);
    expect(result.exitCode).toBe(0);
    const text = stdout.join('');
    expect(text.startsWith('You are helping me set up')).toBe(true);
    expect(text).toBe(textOf('mcp'));
    expect(stderr.join('')).toContain('Set this up with an AI assistant');
  });

  it('fills in the project: product name, API path, docs folder and app URL', async () => {
    await init({ cwd: dir, name: 'Acme' });
    editConfig((config) => {
      config.apiPath = '/support/api';
      config.appUrl = 'http://localhost:4100';
      config.settings.product.appUrl = 'https://app.acme.com';
    });

    const widget = textOf('widget');
    expect(widget).toContain("Acme's Plain HTML site");
    expect(widget).toContain('<script src="/support/api/assets/loader.js" defer></script>');
    expect(textOf('capture')).toContain('http://localhost:4100');
    expect(textOf('first-answer')).toContain('http://localhost:4100/support/api/chat');
    expect(textOf('identity')).toContain('/support/api');
    expect(textOf('turnstile')).toContain('app.acme.com');
    expect(textOf('mcp')).toContain(dir);
    expect(readPromptFacts(dir)).toMatchObject({ installed: true, productName: 'Acme' });
  });

  it('says where its values came from', async () => {
    expect(prompt({ cwd: dir, topic: 'widget', quiet: true })).toMatchObject({ from: 'defaults' });
    await init({ cwd: dir, name: 'Acme' });
    expect(prompt({ cwd: dir, topic: 'widget', quiet: true })).toMatchObject({ from: 'project' });
  });

  it('prints the spec and the prompt with --json', async () => {
    const result = await run(['prompt', 'webhooks', '--json'], dir);
    expect(result.exitCode).toBe(0);
    const document = printedJson();
    expect(document).toMatchObject({ ok: true, command: 'prompt' });
    expect(document.result.topic).toBe('webhooks');
    expect(document.result.prompt).toBe(formatSetupPrompt(document.result.spec));
    // Every event the code sends is in the receiver prompt.
    for (const event of WEBHOOK_EVENTS) expect(document.result.prompt).toContain(event);
  });

  it('lists the topics as JSON too', async () => {
    await run(['prompt', '--json'], dir);
    const document = printedJson();
    expect(document.result.kind).toBe('topics');
    expect(document.result.topics.map((t: { name: string }) => t.name)).toContain('forms-embed');
  });

  it('refuses a topic it does not have, and names the ones it does', async () => {
    const result = await run(['prompt', 'dns', '--json'], dir);
    expect(result.exitCode).toBe(1);
    const document = printedJson();
    expect(document.error.code).toBe('bad_request');
    expect(document.error.message).toContain('install');
  });

  it('answers to the older names', () => {
    expect(findTopic('contacts-import')?.name).toBe('import');
    expect(findTopic('sync')?.name).toBe('search-index');
  });

  it('copies to the clipboard with --copy, and prints instead when there is none', () => {
    let copied = '';
    const result = prompt({
      cwd: dir,
      topic: 'identity',
      copy: true,
      clipboard: (text) => {
        copied = text;
        return true;
      },
    });
    expect(result).toMatchObject({ kind: 'prompt', copied: true });
    expect(copied).toBe(textOf('identity'));
    expect(stdout.join('')).toContain('Copied the identity prompt');
    expect(stdout.join('')).not.toContain('## Goal');

    stdout.length = 0;
    const fallback = prompt({ cwd: dir, topic: 'identity', copy: true, clipboard: () => false });
    expect(fallback).toMatchObject({ copied: false });
    expect(stdout.join('')).toContain('## Goal');
    expect(stdout.join('')).toContain('No clipboard here');
  });

  it('keeps the topic when --copy comes first', () => {
    expect(parseArgs(['prompt', '--copy', 'install']).positionals).toEqual(['prompt', 'install']);
  });
});

describe('framework detection', () => {
  it('reads package.json, most specific first', () => {
    write('package.json', JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }));
    expect(detectFramework(dir)).toEqual({
      mount: 'next',
      site: 'nextjs',
      detected: 'next in package.json',
    });
    write('package.json', JSON.stringify({ dependencies: { express: '5.0.0' } }));
    expect(detectFramework(dir)).toMatchObject({ mount: 'node', site: 'html' });
    write('package.json', JSON.stringify({ devDependencies: { vite: '6', react: '19' } }));
    expect(detectFramework(dir)).toMatchObject({ mount: null, site: 'react-vite' });
    write('package.json', JSON.stringify({ dependencies: { '@sveltejs/kit': '2' } }));
    expect(detectFramework(dir)).toMatchObject({ site: 'sveltekit' });
  });

  it('recognises Rails and Django, which are not Node apps', () => {
    write('Gemfile', "source 'https://rubygems.org'\ngem 'rails', '~> 8.0'\n");
    expect(detectFramework(dir)).toMatchObject({ mount: null, site: 'rails' });
    rmSync(join(dir, 'Gemfile'));
    write('manage.py', '#!/usr/bin/env python\n');
    expect(detectFramework(dir)).toMatchObject({ mount: null, site: 'django' });
  });

  it('falls back to plain HTML when nothing says otherwise', () => {
    expect(detectFramework(dir)).toEqual({ mount: null, site: 'html', detected: null });
  });

  it('reads the package manager from the lockfile', () => {
    expect(detectPackageManager(dir)).toBe('npm');
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('fills the widget and install prompts in for the framework it found', () => {
    write('package.json', JSON.stringify({ name: 'ridgeline', dependencies: { next: '15' } }));
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    expect(textOf('widget')).toContain('app/layout.tsx');
    const install = textOf('install');
    expect(install).toContain('Next.js (next in package.json)');
    expect(install).toContain('pnpm add helpwell @helpwell/core');
    expect(install).toContain('npx helpwell init --framework next');
    expect(install).toContain("Ridgeline's existing app");
    // And a flag wins over what was found.
    expect(textOf('widget', { framework: 'vue' })).toContain('Vue site');
  });

  it('refuses a framework the topic does not know', async () => {
    const result = await run(['prompt', 'widget', '--framework', 'cobol', '--json'], dir);
    expect(result.exitCode).toBe(1);
    expect(printedJson().error.message).toContain('html, nextjs');
  });
});

describe('the topics that take flags', () => {
  it('forms-embed: the form id, and the platform (Next.js when the app is one)', () => {
    const wordpress = textOf('forms-embed', { form: 'newsletter', platform: 'wordpress' });
    expect(wordpress).toContain('data-helpwell-form="newsletter"');
    expect(wordpress).toContain('Custom HTML');
    expect(textOf('forms-embed')).toContain('YOUR-FORM-ID');
    expect(textOf('forms-embed', { form: 'waitlist', platform: 'button' })).toContain('waitlist');
    write('package.json', JSON.stringify({ dependencies: { next: '15' } }));
    expect(textOf('forms-embed', { form: 'newsletter' })).toContain('next/script');
  });

  it('engage-code: an event by default, a manual show with --engagement', () => {
    expect(textOf('engage-code', { event: 'project_created' })).toContain('project_created');
    const manual = textOf('engage-code', { engagement: 'spring-sale' });
    expect(manual).toContain('spring-sale');
    expect(manual).toContain('helpwell.engage.show');
  });

  it('changelog-token: the repo from the config', async () => {
    await init({ cwd: dir, name: 'Acme' });
    editConfig((config) => {
      config.settings.changelog.repo = 'acme/ridgeline';
    });
    expect(textOf('changelog-token')).toContain('acme/ridgeline');
    expect(textOf('changelog-token', { repo: 'acme/other' })).toContain('acme/other');
  });

  it('link: the URL and product `helpwell link` saved, never the token', async () => {
    process.env.HELPWELL_SUPPORT_TOKEN = SECRETS.HELPWELL_SUPPORT_TOKEN;
    await init({ cwd: dir, name: 'Acme' });
    editConfig((config) => {
      config.support = { url: 'https://support.example.com/api', product: 'prod_42' };
    });
    const text = textOf('link');
    expect(text).toContain('https://support.example.com/api');
    expect(text).toContain('prod_42');
    expect(text).toContain('HELPWELL_SUPPORT_TOKEN');
    expect(text).not.toContain(SECRETS.HELPWELL_SUPPORT_TOKEN);
  });

  it('import: names the tool the contacts come from', () => {
    expect(textOf('import', { tool: 'Intercom' })).toContain('from Intercom into HelpWell');
  });
});

describe('the install prompt', () => {
  it('covers every step: packages, init, mount, env, widget, content, index, checks', () => {
    const text = formatSetupPrompt(installPromptSpec({ productName: 'Acme' }));
    for (const part of [
      'npm install helpwell @helpwell/core @helpwell/helpcenter @helpwell/dashboard @helpwell/widget',
      'npx helpwell init --framework <next | remix | hono | node>',
      'createHelpWellHandler',
      'app/help/[[...slug]]/route.ts',
      'app/admin/helpwell/[[...route]]/route.ts',
      'OPENROUTER_API_KEY',
      'HELPWELL_IDENTITY_SECRET',
      'HELPWELL_DATABASE_URL',
      '<script src="/api/helpwell/assets/loader.js" defer></script>',
      'npx helpwell sync',
      'npx helpwell doctor',
      '/api/helpwell/config',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('shows the routes for the framework it was given', () => {
    const hono = formatSetupPrompt(installPromptSpec({ framework: 'hono' }));
    expect(hono).toContain("app.all('/api/helpwell/*'");
    expect(hono).not.toContain('app/help/[[...slug]]/route.ts');
    const remix = formatSetupPrompt(installPromptSpec({ framework: 'remix' }));
    expect(remix).toContain('app/routes/admin.helpwell.$.tsx');
  });

  it('refuses --framework values init does not take', async () => {
    const result = await run(['prompt', 'install', '--framework', 'django', '--json'], dir);
    expect(result.exitCode).toBe(1);
    expect(printedJson().error.message).toContain('next, remix, hono, node');
  });
});

describe('helpwell webhooks --help', () => {
  it('names the development-only guard switch', async () => {
    await run(['webhooks', 'test', '--help'], dir);
    expect(stdout.join('')).toContain('HELPWELL_WEBHOOK_GUARD=off');
    stdout.length = 0;
    await run(['webhooks', '--help'], dir);
    expect(stdout.join('')).toContain('HELPWELL_WEBHOOK_GUARD=off');
  });
});
