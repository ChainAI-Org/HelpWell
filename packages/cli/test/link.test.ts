/**
 * `helpwell link`: the remote support extension's URL and product go in the
 * config, the token never does, and the connection check says in plain words
 * whether it works.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/commands/init.js';
import { link, linkStatus, unlink } from '../src/commands/link.js';
import { loadProject, saveConfig } from '../src/project.js';
import { run } from '../src/run.js';

const URL_BASE = 'https://support.example.com/api';
const TOKEN = 'tok_do_not_write_me';

let dir: string;
let output: string[];

function printed(): string {
  return output.join('');
}

function configFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'helpwell', 'helpwell.config.json'), 'utf8'));
}

/** A service that answers the connection check the way `status` says. */
function service(status = 200, body: unknown = { handled: true, text: '' }) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), auth: new Headers(init.headers).get('authorization') });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-link-'));
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
  output = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('helpwell link', () => {
  it('saves the URL and product, never the token, and checks the connection', async () => {
    const remote = service();
    const result = await link({
      cwd: dir,
      url: `${URL_BASE}/`,
      product: 'prod_42',
      interactive: false,
      env: { HELPWELL_SUPPORT_TOKEN: TOKEN },
      fetch: remote.fetch,
    });

    expect(configFile().support).toEqual({ url: URL_BASE, product: 'prod_42' });
    expect(readFileSync(join(dir, 'helpwell', 'helpwell.config.json'), 'utf8')).not.toContain(
      TOKEN,
    );
    expect(result).toMatchObject({ url: URL_BASE, product: 'prod_42', tokenSet: true });
    expect(result.check).toMatchObject({ ok: true, status: 200 });
    expect(result.environment.map((e) => e.name)).toEqual([
      'HELPWELL_SUPPORT_URL',
      'HELPWELL_SUPPORT_PRODUCT',
      'HELPWELL_SUPPORT_TOKEN',
    ]);
    expect(remote.calls).toEqual([
      { url: `${URL_BASE}/bridge/prod_42/playbook`, auth: `Bearer ${TOKEN}` },
    ]);
    expect(printed()).toContain('HELPWELL_SUPPORT_TOKEN');
    expect(printed()).not.toContain(TOKEN);
    // The rest of the config is as it was, and loads with the link on it.
    expect(loadProject(dir).config.support).toEqual({ url: URL_BASE, product: 'prod_42' });
    expect(loadProject(dir).config.settings.product.name).toBe('Acme');
  });

  it('says so, rather than failing, when this shell has no token to check with', async () => {
    const result = await link({
      cwd: dir,
      url: URL_BASE,
      product: 'p',
      interactive: false,
      env: {},
    });
    expect(result.check).toBeNull();
    expect(printed()).toContain('was not checked');
  });

  it('refuses a token on the command line, and an insecure URL', async () => {
    await expect(
      link({ cwd: dir, url: URL_BASE, product: 'p', token: TOKEN, interactive: false, env: {} }),
    ).rejects.toThrow(/never goes in helpwell.config.json/);
    await expect(
      link({
        cwd: dir,
        url: 'http://support.example.com',
        product: 'p',
        interactive: false,
        env: {},
      }),
    ).rejects.toThrow(/https/);
    expect(configFile().support).toBeUndefined();
  });

  it('asks for what is missing when someone is at the keyboard', async () => {
    const answers = [URL_BASE, 'prod_7'];
    const ask = vi.fn(async () => answers.shift() ?? '');
    await link({ cwd: dir, interactive: true, ask, env: {} });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(configFile().support).toEqual({ url: URL_BASE, product: 'prod_7' });
  });

  it('prints a setup prompt for an AI assistant with the real values', async () => {
    const result = await link({
      cwd: dir,
      url: URL_BASE,
      product: 'prod_42',
      prompt: true,
      interactive: false,
      env: { HELPWELL_SUPPORT_TOKEN: TOKEN },
      fetch: service().fetch,
    });
    expect(result.prompt).toContain('HELPWELL_SUPPORT_PRODUCT');
    expect(result.prompt).toContain('prod_42');
    expect(result.prompt).toContain("Acme's HelpWell server");
    expect(result.prompt).not.toContain(TOKEN);
  });

  it('survives other commands saving the config', async () => {
    await link({ cwd: dir, url: URL_BASE, product: 'prod_42', interactive: false, env: {} });
    const project = loadProject(dir);
    saveConfig(project.paths, project.config);
    expect(configFile().support).toEqual({ url: URL_BASE, product: 'prod_42' });
  });
});

describe('helpwell link --status and unlink', () => {
  it('reports where it points and whether it answers, preferring the environment', async () => {
    await link({ cwd: dir, url: URL_BASE, product: 'prod_42', interactive: false, env: {} });

    const refused = await linkStatus({
      cwd: dir,
      env: { HELPWELL_SUPPORT_TOKEN: TOKEN },
      fetch: service(401, { error: { code: 'unauthorized' } }).fetch,
    });
    expect(refused).toMatchObject({
      linked: true,
      url: URL_BASE,
      product: 'prod_42',
      tokenSet: true,
    });
    expect(refused.check).toMatchObject({ ok: false, status: 401 });
    expect(printed()).toContain('token was refused');

    const fromEnv = await linkStatus({
      cwd: dir,
      env: { HELPWELL_SUPPORT_PRODUCT: 'prod_env', HELPWELL_SUPPORT_TOKEN: TOKEN },
      fetch: service().fetch,
    });
    expect(fromEnv).toMatchObject({
      product: 'prod_env',
      source: { url: 'config', product: 'env' },
    });
    expect(fromEnv.check?.ok).toBe(true);
    expect(printed()).not.toContain(TOKEN);
  });

  it('says it is not linked, and unlink forgets the connection', async () => {
    expect((await linkStatus({ cwd: dir, env: {} })).linked).toBe(false);
    await link({ cwd: dir, url: URL_BASE, product: 'prod_42', interactive: false, env: {} });
    expect(unlink({ cwd: dir })).toEqual({ removed: true });
    expect(configFile().support).toBeUndefined();
    expect(unlink({ cwd: dir })).toEqual({ removed: false });
  });

  it('is on the command line, with --json, and exits non-zero until it connects', async () => {
    const saved = process.env.HELPWELL_SUPPORT_TOKEN;
    delete process.env.HELPWELL_SUPPORT_TOKEN;
    try {
      const linked = await run(['link', '--url', URL_BASE, '--product', 'prod_42', '--json'], dir);
      expect(linked.exitCode).toBe(0);
      const document = JSON.parse(printed().slice(printed().lastIndexOf('{\n  "ok"')));
      expect(document).toMatchObject({ ok: true, command: 'link', result: { product: 'prod_42' } });

      output = [];
      expect((await run(['link', '--status'], dir)).exitCode).toBe(1);
      expect((await run(['link', '--token', 'abc'], dir)).exitCode).toBe(1);
      expect((await run(['unlink'], dir)).exitCode).toBe(0);

      output = [];
      await run(['link', '--help'], dir);
      expect(printed()).toContain('HELPWELL_SUPPORT_TOKEN');
    } finally {
      if (saved !== undefined) process.env.HELPWELL_SUPPORT_TOKEN = saved;
    }
  });

  it('ignores anything but a URL and product under support in the file', async () => {
    const path = join(dir, 'helpwell', 'helpwell.config.json');
    writeFileSync(
      path,
      JSON.stringify({ ...configFile(), support: { url: URL_BASE, product: 'p', token: 'x' } }),
    );
    expect(loadProject(dir).config.support).toEqual({ url: URL_BASE, product: 'p' });
  });
});
