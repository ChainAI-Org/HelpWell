/**
 * The dashboard under its own Content Security Policy, `script-src 'self'`,
 * in a real browser: every screen the suite visits, each with its scripts
 * working, and the preview frames drawing. The `csp` fixture (fixtures.ts)
 * fails a test on a violation in any page or frame; here each screen is also
 * checked on its own, so a failure names the screen.
 *
 * The policy is the dashboard's own header, so this is also what a host that
 * frames the dashboard under `script-src 'self'` gets: nothing inline to
 * allow.
 */

import type { Page } from '@playwright/test';
import { DASHBOARD_PATH, expect, signInAsAdmin, test } from '../fixtures';

/** Every screen in the rail, each Settings tab, and the pages that start something new. */
const SCREENS = [
  '/home',
  '/conversations',
  '/contacts',
  '/knowledge',
  '/knowledge/new',
  '/knowledge/getting-started/invite-your-team?edit=1',
  '/gaps',
  '/changelog',
  '/changelog/new',
  '/roadmap',
  '/roadmap/new',
  '/engage',
  '/engage/new',
  '/engage/new?template=announcement',
  '/engage/modal-whats-new',
  '/forms',
  '/forms/new',
  '/forms/business-giveaway',
  '/forms/business-giveaway/submissions',
  '/reports',
  '/evals',
  '/settings?tab=general',
  '/settings?tab=agent',
  '/settings?tab=widget',
  '/settings?tab=knowledge',
  '/settings?tab=changelog',
  '/settings?tab=data',
  '/playbook',
  '/playbook?file=playbook',
  '/connections',
];

test.beforeEach(async ({ context }, testInfo) => {
  // The policy is the same at any size, so the walk runs once. Every other
  // journey is still watched for violations on both.
  test.skip(testInfo.project.name !== 'desktop', 'The same policy at every size.');
  await signInAsAdmin(context);
});

/** A preview frame said it was ready: its own script, and the renderer from the API, both ran. */
async function previewReady(page: Page): Promise<void> {
  await expect(page.locator('.ek-frame')).toHaveAttribute('data-state', /^(ready|empty)$/);
  await expect(page.locator('.ek-frame iframe')).toBeVisible();
}

test('the violation watcher sees an inline script, so a clean walk means something', async ({
  page,
  csp,
}) => {
  await page.goto(`${DASHBOARD_PATH}/conversations`);
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inline = true';
    document.body.append(script);
  });
  await expect.poll(() => csp.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as { __inline?: boolean }).__inline)).toBeUndefined();
  csp.length = 0;
});

test("every screen runs under script-src 'self', with nothing blocked", async ({ page, csp }) => {
  for (const screen of SCREENS) {
    const response = await page.goto(`${DASHBOARD_PATH}${screen}`);
    expect(response?.status(), screen).toBe(200);
    expect(response?.headers()['content-security-policy'], screen).toContain("script-src 'self'");
    // Every script on it is a served file, loaded from this origin.
    const inline = await page.locator('script:not([src]):not([type="application/json"])').count();
    expect(inline, `${screen}: inline scripts`).toBe(0);
    if (screen.startsWith('/engage/') && screen !== '/engage/new') await previewReady(page);
    if (screen === '/forms/business-giveaway') await previewReady(page);
    expect(csp, screen).toEqual([]);
  }
});

test('the scripts do their work: the palette, the editors, previews and the block list', async ({
  page,
  csp,
}) => {
  // The shell's island: the command palette.
  await page.goto(`${DASHBOARD_PATH}/conversations`);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Rep');
  await expect(palette.getByRole('link', { name: 'Reports' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  // The editor kit marks the page before the editor is drawn, and the engage
  // script feeds the preview frame, whose own script and renderer ran.
  await page.goto(`${DASHBOARD_PATH}/engage/new?template=announcement`);
  await expect(page.locator('html')).toHaveClass(/\bek-js\b/);
  await previewReady(page);
  await expect(page.frameLocator('.ek-frame iframe').locator('helpwell-engage')).toHaveCount(1);

  // The playbook's live preview, rendered on the server as it is typed.
  await page.goto(`${DASHBOARD_PATH}/playbook?file=playbook`);
  const line = `Checked under the dashboard's CSP ${Date.now()}.`;
  const content = page.locator('form#db-playbook textarea[name=content]');
  await content.fill(`${await content.inputValue()}\n\n${line}\n`);
  await expect(page.locator('#db-preview')).toContainText(line);

  // The Home tab's block list keeps its JSON in step, and the island saves it.
  await page.goto(`${DASHBOARD_PATH}/settings?tab=widget`);
  const blocks = page.locator('.db-blocks__list > *');
  const before = await blocks.count();
  await page.locator('[data-block-add]').click();
  await expect(blocks).toHaveCount(before + 1);
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  expect(csp).toEqual([]);
});
