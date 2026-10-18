/**
 * The platform pieces of the dashboard: the model picker, the self-hosted
 * fonts, the security headers, and the settings that became controls.
 *
 * Every dashboard here gets `env: {}`, so a key in the machine's environment
 * never decides what a test sees, and nothing calls OpenRouter.
 */

import type { Db } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDashboard, type DashboardConfig } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const BASE = '/admin/helpwell';
let db: Db;

beforeAll(async () => {
  db = (await freshDb()).db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
});

function dashboard(config: Partial<DashboardConfig> = {}) {
  return createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: () => true,
    env: {},
    ...config,
  });
}

async function page(path: string, config: Partial<DashboardConfig> = {}): Promise<string> {
  const response = await dashboard(config)(new Request(`http://localhost${BASE}${path}`));
  expect(response.status).toBe(200);
  return response.text();
}

describe('model picker', () => {
  it('offers the live list for chat, fallback and docs when there is a key', async () => {
    const html = await page('/settings?tab=agent', { openRouterKey: 'sk-or-test' });
    for (const [name, patch] of [
      ['chat', 'agent.models.chat'],
      ['fallback', 'agent.models.fallback'],
      ['docs', 'agent.models.docs'],
    ]) {
      expect(html).toContain(`id="db-model-${name}" type="text" name="${name}"`);
      expect(html).toContain(`data-patch="${patch}"`);
    }
    expect(
      html.match(/data-model-picker="\/api\/helpwell\/admin\/models\?kind=chat"/g),
    ).toHaveLength(3);
    // The search box lives inside the dropdown, and the list is a listbox.
    expect(html).toMatch(/<div class="db-model__pop" hidden>\s*<div class="db-model__search">/);
    expect(html).toContain('role="listbox"');
    expect(html).toContain('<code class="db-model__id">anthropic/claude-sonnet-5</code>');
    // The key itself never reaches the page.
    expect(html).not.toContain('sk-or-test');
  });

  it('offers embedding models on Connections', async () => {
    const html = await page('/connections', { openRouterKey: 'sk-or-test' });
    expect(html).toContain('data-model-picker="/api/helpwell/admin/models?kind=embeddings"');
    expect(html).toContain('data-patch="agent.models.embeddings"');
  });

  it('is a plain text box without a key, and says why', async () => {
    const html = await page('/settings?tab=agent');
    expect(html).not.toContain('data-model-picker=');
    expect(html).toContain('data-patch="agent.models.chat"');
    expect(html).toContain('Set OPENROUTER_API_KEY to pick from OpenRouter');
  });
});

describe('settings that became controls', () => {
  it("edits the agent's avatar, showing the bare mark until one is set", async () => {
    const html = await page('/settings?tab=agent');
    expect(html).toContain('data-patch="agent.avatarUrl"');
    expect(html).toMatch(
      /<span class="db-avatarfield__preview" aria-hidden="true"><svg viewBox="24 11 104 131"/,
    );
  });

  it('groups the changelog by version or by month', async () => {
    const html = await page('/settings?tab=changelog');
    expect(html).toContain('data-patch="changelog.groupBy"');
    expect(html).toContain('<option value="date"');
  });
});

describe('fonts', () => {
  it('declares Plus Jakarta Sans from its own path, and serves it without sign-in', async () => {
    const html = await page('/settings');
    expect(html).toContain(`src: url("${BASE}/_fonts/plus-jakarta-sans-latin.woff2")`);
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);

    const locked = dashboard({ isAdmin: () => false });
    const font = await locked(
      new Request(`http://localhost${BASE}/_fonts/plus-jakarta-sans-latin.woff2`),
    );
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    const signIn = await (await locked(new Request(`http://localhost${BASE}/settings`))).text();
    expect(signIn).toContain(`${BASE}/_fonts/plus-jakarta-sans-latin.woff2`);

    const missing = await locked(new Request(`http://localhost${BASE}/_fonts/../server.ts`));
    expect(missing.status).not.toBe(200);
  });
});

describe('security headers', () => {
  it('sends nosniff, a same-origin referrer policy and frame-ancestors on every response', async () => {
    for (const handler of [dashboard(), dashboard({ isAdmin: () => false })]) {
      const response = await handler(new Request(`http://localhost${BASE}/settings`));
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('same-origin');
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
      expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    }
  });

  it('lets a host that embeds the dashboard name who may frame it', async () => {
    const embedded = dashboard({ frameAncestors: ["'self'", 'https://app.acme.com'] });
    const response = await embedded(new Request(`http://localhost${BASE}/settings`));
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'self' https://app.acme.com",
    );
    // X-Frame-Options cannot name another origin, so it is left off.
    expect(response.headers.get('x-frame-options')).toBeNull();

    const nobody = dashboard({ frameAncestors: [] });
    const denied = await nobody(new Request(`http://localhost${BASE}/settings`));
    expect(denied.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(denied.headers.get('x-frame-options')).toBe('DENY');

    const none = dashboard({ securityHeaders: false });
    const bare = await none(new Request(`http://localhost${BASE}/settings`));
    expect(bare.headers.get('content-security-policy')).toBeNull();
  });
});
