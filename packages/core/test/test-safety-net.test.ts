/**
 * The shared test setup (`vitest.setup.ts` at the repo root) that keeps real
 * keys and real services out of every test run.
 *
 * It lives in core's suite because core is always run; what it checks covers
 * every package: each one's config registers the file, and the file does what
 * it says.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
const SETUP = fileURLToPath(new URL('../../../vitest.setup.ts', import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the shared test setup', () => {
  it('is registered by every package', () => {
    const configs = readdirSync(PACKAGES)
      .map((name) => join(PACKAGES, name, 'vitest.config.ts'))
      .filter((path) => existsSync(path));
    expect(configs.length).toBeGreaterThanOrEqual(9);
    for (const config of configs) {
      expect(readFileSync(config, 'utf8'), config).toContain(
        "setupFiles: ['../../vitest.setup.ts']",
      );
    }
  });

  it('has already taken real keys out of the environment', () => {
    for (const name of Object.keys(process.env)) {
      expect(name).not.toMatch(/_(API_KEY|TOKEN)$/i);
    }
    for (const name of ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'STRIPE_SECRET_KEY']) {
      expect(process.env[name], name).toBeUndefined();
    }
  });

  it('removes keys and tokens, and leaves everything else', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-real-looking');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_real_looking');
    vi.stubEnv('LEADFUZE_API_KEY', 'lfz_real_looking');
    vi.stubEnv('SOME_VENDOR_API_KEY', 'real');
    vi.stubEnv('npm_config_auth_token', 'real');
    vi.stubEnv('HELPWELL_DATABASE_URL', 'postgres://prod.internal/app');
    vi.stubEnv('HELPWELL_TEST_KEEP_ME', 'kept');
    const fetchBefore = globalThis.fetch;
    try {
      vi.resetModules();
      await import(`${SETUP}?rerun=${Date.now()}`);
    } finally {
      globalThis.fetch = fetchBefore;
    }
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(process.env.LEADFUZE_API_KEY).toBeUndefined();
    expect(process.env.SOME_VENDOR_API_KEY).toBeUndefined();
    expect(process.env.npm_config_auth_token).toBeUndefined();
    expect(process.env.HELPWELL_DATABASE_URL).toBeUndefined();
    expect(process.env.HELPWELL_TEST_KEEP_ME).toBe('kept');
  });

  it('lets a test set a fake key of its own afterwards', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-fake-for-this-test');
    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-fake-for-this-test');
  });

  it('refuses a real call to OpenRouter or GitHub, in so many words', async () => {
    for (const url of [
      'https://openrouter.ai/api/v1/chat/completions',
      'https://api.github.com/repos/acme/app/releases/latest',
      new URL('https://openrouter.ai/api/v1/embeddings'),
      new Request('https://api.github.com/repos/acme/app'),
    ]) {
      await expect(fetch(url), String(url)).rejects.toThrow(/a real service\. Pass a fake/);
    }
  });

  it('lets every other request through', async () => {
    const response = await fetch('data:text/plain,still%20works');
    expect(await response.text()).toBe('still works');
  });
});
