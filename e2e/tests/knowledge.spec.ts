/**
 * The knowledge base, from the repo to the reader: a screenshot captured with
 * annotations and rendered in a help-centre article, and an article edited in
 * the dashboard and saved back into the docs folder.
 *
 * The server runs from a scratch copy of the playground's helpwell/ folder
 * (support/serve-playground.mjs), so both write there, never into the repo.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, chromium } from '@playwright/test';
// The CLI's real `helpwell capture`, from its build: the config, the
// annotations and the shot are its code, not the suite's.
import { capture } from '../../packages/cli/dist/index.js';
import {
  DASHBOARD_PATH,
  expect,
  HELP_PATH,
  keepOffline,
  PLAYGROUND,
  signInAsAdmin,
  test,
  WORK_DIR,
} from '../fixtures';

const DOCS = join(WORK_DIR, 'helpwell', 'docs');
const SHOT = 'e2e-expenses-page';
/** Nothing in Ridgeline's own UI is this colour, so any of it in the shot is annotation. */
const MARK = '#FF00FF';

/** What `capture` is handed to launch a browser with. */
type CaptureChromium = NonNullable<NonNullable<Parameters<typeof capture>[0]>['chromium']>;

/**
 * Chromium for `capture`, with every context it opens kept off the network
 * the way the suite's own are. Cast the way the CLI casts the Playwright it
 * imports itself: its type is the slice of Playwright's surface it uses.
 */
const offlineChromium = {
  async launch(options?: Parameters<typeof chromium.launch>[0]) {
    const browser = await chromium.launch(options);
    const open = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context: BrowserContext = await open(contextOptions);
      await keepOffline(context);
      return context;
    };
    return browser;
  },
} as unknown as Awaited<ReturnType<CaptureChromium>>;

test('a screenshot captured with annotations renders in its help-centre article', async ({
  page,
}) => {
  // helpwell.config.json names the shot and what to draw on it, anchored to
  // the page's own elements.
  writeFileSync(
    join(WORK_DIR, 'helpwell', 'helpwell.config.json'),
    JSON.stringify({
      appUrl: PLAYGROUND,
      docs: 'helpwell/docs',
      screenshots: {
        dir: 'helpwell/docs/_screenshots',
        shots: [
          {
            name: SHOT,
            path: '/',
            width: 1280,
            height: 800,
            annotate: [
              { type: 'rect', target: '[data-tour="new-expense"]', color: MARK, padding: 6 },
              { type: 'step', target: '[data-tour="status"]', color: MARK },
              {
                type: 'label',
                target: '[data-tour="export"]',
                text: 'Closes the month',
                color: MARK,
              },
            ],
          },
        ],
      },
    }),
  );

  const result = await capture({ cwd: WORK_DIR, chromium: async () => offlineChromium });
  expect(result.ok).toBe(true);
  expect(result.warnings).toEqual([]);
  expect(result.written.map((path) => path.replace(/\\/g, '/'))).toEqual([
    `helpwell/docs/_screenshots/${SHOT}.png`,
  ]);

  await page.goto(`${HELP_PATH}/getting-started/find-your-way-around`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Find your way around']);

  const image = page.locator('.hc-body img');
  await expect(image).toHaveAttribute('src', `${HELP_PATH}/_screenshots/${SHOT}.png`);
  await expect(image).toHaveAttribute('alt', /New expense, the Status column and Export period/);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(2560);

  // The annotations are in the picture the reader sees.
  const marked = await image.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return -1;
    context.drawImage(img, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 200 && data[i + 1]! < 80 && data[i + 2]! > 200) count++;
    }
    return count;
  });
  expect(marked).toBeGreaterThan(1000);
});

test('an article edited in the dashboard is saved to the docs folder and published', async ({
  context,
  page,
}, testInfo) => {
  await signInAsAdmin(context);
  const file = join(DOCS, 'getting-started', 'invite-your-team.md');
  const line = `Checked by the end-to-end suite on ${testInfo.project.name}, run ${Date.now()}.`;

  await page.goto(`${DASHBOARD_PATH}/knowledge/getting-started/invite-your-team?edit=1`);
  const editor = page.locator('form#db-editor');
  await expect(editor.locator('select[name=status]')).toHaveValue('published');
  const body = editor.locator('textarea[name=body]');
  await body.fill(`${await body.inputValue()}\n\n${line}\n`);

  // The preview is rendered by the same code as the help centre.
  await expect(page.locator('#db-preview')).toContainText(line);

  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/getting-started\/invite-your-team\?saved=1/);
  await expect(page.getByRole('status').filter({ hasText: 'Saved to the repo' })).toContainText(
    're-indexed for text search',
  );

  // Written into the docs folder, front matter kept.
  const saved = readFileSync(file, 'utf8');
  expect(saved).toContain(line);
  expect(saved).toMatch(/^---\n[\s\S]*title: Invite your team[\s\S]*\n---\n/);

  // And live in the help centre straight away.
  await page.goto(`${HELP_PATH}/getting-started/invite-your-team`);
  await expect(page.locator('.hc-body')).toContainText(line);
});

/** A real one-pixel PNG, which the upload checks by its bytes. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('an image picked in the editor is uploaded and put where the cursor is', async ({
  context,
  page,
}) => {
  await signInAsAdmin(context);
  await page.goto(`${DASHBOARD_PATH}/knowledge/getting-started/invite-your-team?edit=1`);
  const editor = page.locator('form#db-editor');
  const body = editor.locator('textarea[name=body]');
  const before = await body.inputValue();

  // The button is drawn by the script, which only runs where uploads are kept.
  const picker = editor.locator('[data-image-tools]');
  await expect(picker).toBeVisible();
  // A slow upload must not let Save or a server-side preview remove the
  // editor before the image reference has been inserted.
  let finishUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  await page.route('**/knowledge/_upload', async (route) => {
    await uploadGate;
    await route.continue();
  });
  const uploading = page.waitForRequest('**/knowledge/_upload');
  await editor
    .locator('input[data-image-picker]')
    .setInputFiles({ name: 'team-page.png', mimeType: 'image/png', buffer: PIXEL });
  await uploading;
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Refresh preview', exact: true })).toBeDisabled();
  await expect(editor).toHaveAttribute('data-helpwell-dirty', '');
  finishUpload();

  await expect(body).toHaveValue(/!\[team page\]\(\.\.\/_media\/[0-9a-f]{24}\.png\)/);
  expect((await body.inputValue()).length).toBeGreaterThan(before.length);
  await expect(editor.locator('[data-image-status]')).toContainText('Added');
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  // The preview shows it from the API, which serves it like a screenshot.
  const image = page.locator('#db-preview img[src*="/media/_media/"]');
  await expect(image).toHaveCount(1);
  const src = (await image.getAttribute('src')) ?? '';
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
});

test('article annotations preserve pixels through undo, retry and saving the uploaded copy', async ({
  context,
  page,
}, testInfo) => {
  await signInAsAdmin(context);
  await page.goto(`${DASHBOARD_PATH}/knowledge/getting-started/invite-your-team?edit=1`);
  const editor = page.locator('form#db-editor');
  const filename = `article-annotation-${testInfo.project.name}.png`;
  const alt = `article annotation ${testInfo.project.name} annotated`;
  const original = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 320;
    image.height = 200;
    const paint = image.getContext('2d')!;
    paint.fillStyle = '#ffffff';
    paint.fillRect(0, 0, 320, 200);
    paint.fillStyle = '#f0eafe';
    paint.fillRect(20, 20, 280, 80);
    return image.toDataURL('image/png');
  });
  await editor.locator('[data-annotate-picker]').setInputFiles({
    name: filename,
    mimeType: 'image/png',
    buffer: Buffer.from(original.split(',')[1]!, 'base64'),
  });
  const dialog = page.getByRole('dialog', { name: `Image: ${filename}`, exact: true });
  const canvas = dialog.locator('canvas');
  await expect(canvas).toBeVisible();
  const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'));
  expect(await pixels()).toBe(original);
  await dialog.getByLabel('Annotation tool', { exact: true }).selectOption('rectangle');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.7);
  await page.mouse.up();
  const marked = await pixels();
  expect(marked).not.toBe(original);
  await expect(editor).toHaveAttribute('data-helpwell-dirty', '');
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await pixels()).toBe(original);
  const insert = dialog.getByRole('button', { name: 'Insert annotated copy', exact: true });
  await expect(insert).toBeDisabled();
  await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await pixels()).toBe(marked);
  await page.route(
    '**/knowledge/_upload',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Try again.' }),
      }),
    { times: 1 },
  );
  await insert.click();
  await expect(dialog.locator('.ibx-media-footer [role="status"]')).toContainText(
    'Your annotations are still here',
  );
  expect(await pixels()).toBe(marked);
  await insert.click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.locator('textarea[name=body]')).toHaveValue(new RegExp(alt));
  const preview = page.locator(`#db-preview img[alt="${alt}"]`);
  await expect(preview).toBeVisible();
  const savedPixels = await preview.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const copy = document.createElement('canvas');
    copy.width = img.naturalWidth;
    copy.height = img.naturalHeight;
    copy.getContext('2d')!.drawImage(img, 0, 0);
    return copy.toDataURL('image/png');
  });
  expect(savedPixels).toBe(marked);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\?saved=1/);
  await page.goto(`${HELP_PATH}/getting-started/invite-your-team`);
  await expect(page.locator(`.hc-body img[alt="${alt}"]`)).toBeVisible();
});
