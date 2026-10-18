/**
 * The widget on another site: a page on 127.0.0.1 (support/host-site.mjs)
 * embedding the widget from Ridgeline's API on localhost.
 *
 * To the browser those are different sites, so the API's visitor cookie is
 * third-party. It is never stored (SameSite=Lax refuses it on a cross-site
 * response, and third-party cookies are blocked outright here as well), and
 * the widget has to carry its visitor in the X-HelpWell-Visitor header. The
 * test is that a visitor who reloads still finds their conversation.
 *
 * The first journey's tag names the API with `data-api`; the last leaves it
 * out, so the loader has to find the API from its own address, host included.
 * Between them, an article's image has to load from the API too, which it
 * only does because the API sends it as an absolute URL.
 */

import { API_PATH, expect, HOST_ORIGIN, PLAYGROUND, test } from '../fixtures';

// Chromium's third-party cookie blocking, as a browser that blocks them by
// default would behave.
test.use({ launchOptions: { args: ['--test-third-party-cookie-phaseout'] } });

const QUESTION = 'How do I forward a receipt by email?';
const TOKEN_KEY = `helpwell:visitor:${PLAYGROUND}${API_PATH}`;

/** The contact a visitor token names: `v1.<contact>.<expiry>.<signature>`. */
function visitorIn(token: string | null | undefined): string | undefined {
  return token?.split('.')[1];
}

test('a visitor on another site keeps their conversation across a reload, without cookies', async ({
  admin,
  context,
  page,
  widget,
}) => {
  // In the order the page made them. The full headers (the cookie among
  // them) arrive later, so they are filled into each call's own slot.
  const calls: { visitor: string | undefined; cookie?: string }[] = [];
  const issued = new Set<string>();
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(`${PLAYGROUND}${API_PATH}/`) || url.includes('/assets/')) return;
    if (request.method() === 'OPTIONS') return;
    const call: (typeof calls)[number] = { visitor: request.headers()['x-helpwell-visitor'] };
    calls.push(call);
    void request.allHeaders().then((headers) => {
      call.cookie = headers.cookie;
    });
  });
  page.on('response', (response) => {
    const token = response.headers()['x-helpwell-visitor'];
    if (token) issued.add(token);
  });

  await page.goto(`${HOST_ORIGIN}/`);
  await expect(page.getByRole('heading', { name: 'Another site' })).toBeVisible();
  await widget.open();
  await widget.newConversation();
  const { reply } = await widget.ask(QUESTION);
  expect(reply.unresolved).toBe(false);

  // No cookie for the API was kept; the visitor lives in the page's storage.
  expect(await context.cookies(PLAYGROUND)).toEqual([]);
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token).toMatch(/^v1\./);

  await page.reload();
  await widget.open();
  await widget.panel.getByRole('tab', { name: 'Messages' }).click();
  const rows = widget.panel.locator('.rowlist button.row');
  await expect(rows).toHaveCount(1);
  await rows.first().click();

  // The same thread, not a form asking them to start again.
  await expect(widget.questions).toHaveText([QUESTION]);
  await expect(widget.answers).toHaveCount(1);
  await expect(widget.answers.first().locator('.citation')).toHaveText('Attach and match receipts');

  // "new" until the first message made the visitor, then that visitor on
  // every call, reload included; never a cookie; and only ever one visitor
  // issued. (The token itself is re-signed as it goes, so its expiry slides.)
  const visitor = visitorIn(token);
  const first = calls.findIndex((call) => call.visitor !== 'new');
  expect(first).toBeGreaterThan(0);
  expect(calls.slice(0, first).every((call) => call.visitor === 'new')).toBe(true);
  expect(calls.slice(first).every((call) => visitorIn(call.visitor) === visitor)).toBe(true);
  expect(calls.every((call) => call.cookie === undefined)).toBe(true);
  expect(new Set([...issued].map(visitorIn))).toEqual(new Set([visitor]));

  // One visitor and one conversation, as the server saw it.
  const conversation = await admin.get<{ messageCount: number; contact: { id: string } }>(
    `/admin/conversations/${reply.conversationId}`,
  );
  expect(conversation.messageCount).toBe(2);
  expect(conversation.contact.id).toBe(visitor);
});

test('an article image in the widget loads from the API, not from the page', async ({
  page,
  widget,
}) => {
  // The article's picture sits beside it in the docs (e2e/fixtures/docs), and
  // is indexed as a path on the API. Drawn as a path, the page on 127.0.0.1
  // would ask itself for it and show a broken image.
  const pictures: { url: string; status: number }[] = [];
  page.on('response', (response) => {
    if (response.url().includes('e2e-profile-photo')) {
      pictures.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto(`${HOST_ORIGIN}/`);
  await expect(page.getByRole('heading', { name: 'Another site' })).toBeVisible();
  await widget.open();
  await widget.panel.getByRole('tab', { name: 'Help' }).click();
  await widget.panel.getByRole('button', { name: /Getting started/ }).click();
  await widget.panel.getByRole('button', { name: /Change your profile photo/ }).click();
  await expect(widget.panel.locator('.article h1')).toHaveText('Change your profile photo');

  const image = widget.panel.locator('.article__body img');
  await expect(image).toHaveAttribute(
    'src',
    `${PLAYGROUND}${API_PATH}/media/getting-started/e2e-profile-photo.png`,
  );
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(24);
  // Asked for once, from the API; never from the page's own host.
  expect(pictures).toEqual([
    { url: `${PLAYGROUND}${API_PATH}/media/getting-started/e2e-profile-photo.png`, status: 200 },
  ]);
});

test('a tag without data-api still calls the API it was loaded from, not the page', async ({
  page,
  widget,
}) => {
  // Every call that looks like HelpWell's, wherever it went.
  const calls: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(`${API_PATH}/`)) calls.push(url);
  });

  await page.goto(`${HOST_ORIGIN}/plain`);
  await expect(page.getByRole('heading', { name: 'Another site' })).toBeVisible();
  const tag = page.locator(`script[src="${PLAYGROUND}${API_PATH}/assets/loader.js"]`);
  expect(await tag.getAttribute('data-api')).toBeNull();

  await widget.open();
  await widget.newConversation();
  const { reply } = await widget.ask(QUESTION);
  expect(reply.unresolved).toBe(false);
  await expect(widget.answers.first().locator('.citation')).toHaveText('Attach and match receipts');

  // The bundle, the config and the chat all went to the API's host. The page's
  // own host serves nothing under /api, so a single stray call there would
  // have been a widget that never appeared.
  const paths = calls.map((url) => url.pathname);
  expect(paths).toEqual(
    expect.arrayContaining([
      `${API_PATH}/assets/widget.js`,
      `${API_PATH}/config`,
      `${API_PATH}/chat`,
    ]),
  );
  expect(calls.filter((url) => url.origin !== PLAYGROUND).map(String)).toEqual([]);

  // And the widget knows it is on another site: the visitor is kept under the
  // API's full address, the same key the data-api tag uses.
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token).toMatch(/^v1\./);
});
