/**
 * The bot check, switched on the way an admin would: Cloudflare Turnstile
 * with Cloudflare's published test keys.
 *
 * The server's secret is the always-pass test secret (support/ports.mjs), and
 * the site key decides the visitor's fate: 1x… passes, 2x… is always blocked.
 * The Turnstile script and siteverify are stood in for locally, the way those
 * keys behave, so nothing reaches Cloudflare; the widget's challenge, the
 * token it sends and the server's check of it are the real code.
 */

import {
  API_PATH,
  expect,
  type SettingsControl,
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_SITE_KEYS,
  test,
} from '../fixtures';

function botCheck(settings: SettingsControl, siteKey: string) {
  return settings.patch({ agent: { abuse: { botCheck: 'turnstile', turnstileSiteKey: siteKey } } });
}

const isChat = (url: string, method: string) =>
  method === 'POST' && url.endsWith(`${API_PATH}/chat`);

test('a visitor the test key passes is answered, and proves it once per conversation', async ({
  page,
  settings,
  widget,
}) => {
  await botCheck(settings, TURNSTILE_SITE_KEYS.alwaysPasses);
  await page.goto('/');

  const tokens: unknown[] = [];
  page.on('request', (request) => {
    if (isChat(request.url(), request.method())) tokens.push(request.postDataJSON().turnstileToken);
  });

  await widget.open();
  await widget.newConversation();
  const first = await widget.ask('How do approvals work?');
  expect(first.reply.unresolved).toBe(false);
  await expect(first.answer.locator('.citation')).toHaveText('How approvals work');

  // The conversation passed, so the next message goes without a challenge.
  await widget.ask('How do I connect a card?');
  expect(tokens).toEqual([TURNSTILE_DUMMY_TOKEN, undefined]);
});

test('a visitor the test key blocks is told so, and nothing is sent', async ({
  page,
  settings,
  widget,
}) => {
  await botCheck(settings, TURNSTILE_SITE_KEYS.alwaysBlocks);
  await page.goto('/');

  let sent = 0;
  page.on('request', (request) => {
    if (isChat(request.url(), request.method())) sent++;
  });

  await widget.open();
  await widget.newConversation();
  await widget.panel.getByRole('textbox', { name: 'Your question' }).fill('How do approvals work?');
  await widget.panel.getByRole('button', { name: 'Start the conversation' }).click();

  await expect(
    widget.panel.getByText('We could not confirm you are human. Please try again.'),
  ).toBeVisible();
  await expect(widget.panel.getByText('That did not send.')).toBeVisible();
  await expect(widget.answers).toHaveCount(0);
  expect(sent).toBe(0);
});

test('the API refuses a first message that carries no token', async ({ request, settings }) => {
  await botCheck(settings, TURNSTILE_SITE_KEYS.alwaysPasses);

  const response = await request.post(`${API_PATH}/chat`, {
    data: { message: 'How do approvals work?' },
  });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body.error.details.humanCheck).toBe('missing');
});
