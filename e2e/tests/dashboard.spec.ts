/**
 * The admin dashboard at /admin/helpwell, signed in the way Ridgeline signs
 * admins in: every setting reachable, an engagement edited against its live
 * preview, and the setup checklist with its prompt for an AI assistant.
 */

import type { Page } from '@playwright/test';
import {
  DASHBOARD_PATH,
  expect,
  PLAYGROUND,
  signInAsAdmin,
  TURNSTILE_SITE_KEYS,
  test,
} from '../fixtures';
import { TURNSTILE_TEST_SECRET } from '../support/ports.mjs';

test.beforeEach(async ({ context }) => {
  await signInAsAdmin(context);
});

/** Every screen that edits Settings, as the coverage unit test lists them. */
const SCREENS = [
  '/settings?tab=general',
  '/settings?tab=agent',
  '/settings?tab=widget',
  '/settings?tab=knowledge',
  '/settings?tab=changelog',
  '/settings?tab=data',
  '/connections',
  '/webhooks',
  '/engage',
];

/** Each leaf of the Settings JSON: objects are walked, anything else is a setting. */
function leaves(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

async function attributes(page: Page, name: string): Promise<string[]> {
  return page
    .locator(`[${name}]`)
    .evaluateAll(
      (elements, attribute) => elements.map((el) => el.getAttribute(attribute) ?? ''),
      name,
    );
}

test('every setting has a control on some screen, or says it is config-only', async ({
  page,
  settings,
}) => {
  const bound = new Set<string>();
  const configOnly = new Set<string>();
  for (const screen of SCREENS) {
    const response = await page.goto(`${DASHBOARD_PATH}${screen}`);
    expect(response?.status(), screen).toBe(200);
    for (const path of await attributes(page, 'data-patch')) bound.add(path);
    for (const path of await attributes(page, 'data-setting')) bound.add(path);
    for (const path of await attributes(page, 'data-config-only')) configOnly.add(path);
  }

  const all = leaves(await settings.read());
  expect(all.length).toBeGreaterThan(80);
  const uncovered = all.filter((path) => !bound.has(path) && !configOnly.has(path));
  expect(uncovered, 'settings with no control and not marked config-only').toEqual([]);
  expect([...configOnly].filter((path) => bound.has(path))).toEqual([]);

  // Config-only is said in words, where the setting would otherwise be.
  await page.goto(`${DASHBOARD_PATH}/settings?tab=changelog`);
  const card = page.locator('[data-config-only="changelog.roadmap.statuses"]');
  await expect(card).toContainText('Set in helpwell.config / environment');
});

test('a setting changed on its screen is saved, and secrets only say whether they are set', async ({
  page,
  settings,
}) => {
  // Keys come from the environment and are never shown. This run has no
  // model key (it was stripped) and the always-pass Turnstile test secret.
  await page.goto(`${DASHBOARD_PATH}/connections`);
  const keys = page.locator('section.db-card', { hasText: 'Keys and secrets' });
  await expect(keys.locator('[data-secret-env="OPENROUTER_API_KEY"]')).toContainText('Set: no');
  await expect(keys.locator('[data-secret-env="HELPWELL_TURNSTILE_SECRET"]')).toContainText(
    'Set: yes',
  );
  await expect(page.locator('body')).not.toContainText(TURNSTILE_TEST_SECRET);

  await page.goto(`${DASHBOARD_PATH}/settings?tab=agent`);
  const siteKey = page.locator('[data-patch="agent.abuse.turnstileSiteKey"]');
  await siteKey.fill(TURNSTILE_SITE_KEYS.alwaysPasses);
  await siteKey.blur();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const saved = (await settings.read()) as { agent: { abuse: { turnstileSiteKey: string } } };
  expect(saved.agent.abuse.turnstileSiteKey).toBe(TURNSTILE_SITE_KEYS.alwaysPasses);
});

test('editing an engagement updates its live preview, and saving keeps the edit', async ({
  page,
  settings,
}) => {
  await page.goto(`${DASHBOARD_PATH}/engage/modal-whats-new`);
  const preview = page.frameLocator('.ek-frame iframe');
  await expect(page.locator('.ek-frame')).toHaveAttribute('data-state', 'ready');
  const { controlContrast } = await import('../support/contrast');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => controlContrast(page.getByRole('button', { name: 'Save changes' })))
      .toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(preview.locator('helpwell-engage .modal .eg-text').first()).toContainText(
    'Tiered mileage rates',
  );

  const firstSlide = page.locator('[id="en-modal.slides.0"]');
  await firstSlide.getByRole('button', { name: 'Edit as Markdown' }).click();
  const source = firstSlide.locator('textarea[name="modal.slides.0.blocks.0.markdown"]');
  await expect(source).toBeVisible();
  const edited = '## Mileage, tiered\n\nOne rate up to the threshold, a lower one after it.';
  await source.fill(edited);

  // The preview is the real widget renderer, fed the draft as it changes.
  await expect(preview.locator('helpwell-engage .modal .eg-text').first()).toContainText(
    'Mileage, tiered',
  );

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/engage\/modal-whats-new\?saved=1/);
  await expect(page.locator('[data-ek-status]')).toHaveText('Saved just now');

  // Read straight back through the API, which the widget reads too: the
  // dashboard's save is what its very next request sees, with no wait.
  const saved = (await settings.read()) as {
    engage: {
      engagements: { id: string; modal?: { slides: { blocks: { markdown?: string }[] }[] } }[];
    };
  };
  const modal = saved.engage.engagements.find((item) => item.id === 'modal-whats-new');
  expect(modal?.modal?.slides[0]?.blocks[0]?.markdown).toBe(edited);
});

test('the setup checklist checks the install, and hands each step to an AI assistant', async ({
  context,
  page,
}) => {
  // A page with the widget on it, so "Install the widget" has something to see.
  const seen = page.waitForResponse((response) => response.url().endsWith('/api/helpwell/config'));
  await page.goto('/');
  await seen;

  await page.goto(`${DASHBOARD_PATH}/home`);
  await expect(page.getByRole('heading', { level: 1, name: 'Get set up' })).toBeVisible();
  const step = (title: string) =>
    page.locator('li.db-step').filter({ has: page.getByRole('heading', { name: title }) });

  // The playground has articles, a text index and the widget, and no model
  // key: so the index is only nearly there, and says what finishes it.
  await expect(step('Write your first articles')).toHaveAttribute('data-status', 'done');
  await expect(step('Build the search index')).toHaveAttribute('data-status', 'partial');
  await expect(step('Build the search index')).toContainText(
    'Run npx helpwell sync with the model key set.',
  );
  await expect(step('Install the widget')).toHaveAttribute('data-status', 'done');
  await expect(step('Add your model key')).toHaveAttribute('data-status', 'todo');

  const modelKey = step('Add your model key');
  await modelKey.getByText('Set this up with an AI assistant').click();
  const prompt = modelKey.locator('pre.db-prompt__text');
  await expect(prompt).toBeVisible();
  const text = await prompt.innerText();
  expect(text).toContain('OPENROUTER_API_KEY');
  expect(text).toContain('Never ask me to paste a password, API key, token or other secret');
  // A prompt never carries a secret, even one the install has.
  expect(text).not.toContain(TURNSTILE_TEST_SECRET);
  expect(text).not.toContain('ridgeline-playground-identity-secret');

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PLAYGROUND });
  await modelKey.getByRole('button', { name: 'Agent Instruction' }).click();
  await expect(
    modelKey.getByRole('button', { name: 'Copied! Paste to your agent', exact: true }),
  ).toBeVisible();
  // Windows' clipboard hands text back with CRLF line breaks.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, '\n').trim()).toBe(text.replace(/\r\n/g, '\n').trim());
});
