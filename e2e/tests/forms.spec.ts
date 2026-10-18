/**
 * The giveaway form Ridgeline embeds on /pricing with one
 * `<div data-helpwell-form="business-giveaway">`: an entry, the verdict the
 * server reaches on it, the dashboard that shows it, and a referral that earns
 * the first entrant more chances.
 */

import type { Page } from '@playwright/test';
import { DASHBOARD_PATH, expect, keepOffline, signInAsAdmin, test, uniqueEmail } from '../fixtures';

const FORM = 'business-giveaway';

interface Submitted {
  submissionId: string;
  status: string;
  giveaway?: { entries: number; referralCode: string };
}

/**
 * Enters the giveaway on the page already open at /pricing, at a person's
 * pace: a form sent within two seconds of appearing is taken for a bot and
 * quietly dropped, so the entry waits that long, as anyone typing would.
 */
async function enter(page: Page, firstName: string, email: string): Promise<Submitted> {
  const form = page.locator(`.hwf[data-form="${FORM}"]`);
  await expect(form.getByRole('button', { name: 'Enter the giveaway' })).toBeVisible();
  const shownAt = Date.now();

  await form.getByRole('textbox', { name: 'First name' }).fill(firstName);
  await form.getByRole('textbox', { name: /^Email/ }).fill(email);
  await page.waitForTimeout(Math.max(0, 2_500 - (Date.now() - shownAt)));

  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' && candidate.url().endsWith(`/forms/${FORM}/submit`),
  );
  await form.getByRole('button', { name: 'Enter the giveaway' }).click();
  const submitted = (await (await response).json()) as Submitted;
  await expect(form.getByText("You're in")).toBeVisible();
  return submitted;
}

test('an embedded form takes an entry, trusts it, and shows it in the dashboard', async ({
  admin,
  context,
  page,
}, testInfo) => {
  const email = uniqueEmail('entry', testInfo.project.name);
  await page.goto('/pricing');
  const submitted = await enter(page, 'Grace', email);
  expect(submitted.status).toBe('accepted');

  const form = page.locator(`.hwf[data-form="${FORM}"]`);
  await expect(form.locator('.hwf__entries strong')).toHaveText('1');
  await expect(form.getByRole('textbox', { name: 'Your referral link' })).toHaveValue(
    new RegExp(`/pricing\\?ref=${submitted.giveaway?.referralCode}$`),
  );

  const submission = await admin.get<{ trusted: boolean; status: string; email: string }>(
    `/admin/forms/${FORM}/submissions/${submitted.submissionId}`,
  );
  expect(submission).toMatchObject({ trusted: true, status: 'accepted', email });

  await signInAsAdmin(context);
  await page.goto(`${DASHBOARD_PATH}/forms/${FORM}/submissions`);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Trusted');
});

test('a colleague who enters through the referral link earns the entrant three more entries', async ({
  admin,
  browser,
  page,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const first = uniqueEmail('referrer', testInfo.project.name);
  const second = uniqueEmail('referred', testInfo.project.name);

  await page.goto('/pricing');
  const entered = await enter(page, 'Ada', first);
  const link = await page
    .locator(`.hwf[data-form="${FORM}"]`)
    .getByRole('textbox', { name: 'Your referral link' })
    .inputValue();

  // The colleague is somebody else, in their own browser.
  const colleague = await browser.newContext({
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  });
  try {
    await keepOffline(colleague);
    const theirs = await colleague.newPage();
    await theirs.goto(link);
    const referred = await enter(theirs, 'Tom', second);
    expect(referred.status).toBe('accepted');
  } finally {
    await colleague.close();
  }

  const { entries } = await admin.get<{
    entries: {
      id: string;
      email: string;
      referralCode: string;
      entries: number;
      referrals: number;
      referredBy: string | null;
    }[];
  }>(`/admin/forms/${FORM}/giveaway`);
  const referrer = entries.find((entry) => entry.email === first);
  const newcomer = entries.find((entry) => entry.email === second);
  expect(referrer).toMatchObject({
    referralCode: entered.giveaway?.referralCode,
    entries: 4,
    referrals: 1,
  });
  expect(newcomer).toMatchObject({ entries: 1, referredBy: referrer?.id });
});
