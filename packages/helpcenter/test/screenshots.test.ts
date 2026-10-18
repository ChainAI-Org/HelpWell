/**
 * End to end: an article in a repo references a screenshot the way the init
 * template says to, it is indexed the way `helpwell sync` indexes it, and the
 * image then loads from the help centre page and from the widget's copy of
 * the article, byte for byte. Also the blocks as the help centre draws them,
 * and the policy that lets their videos play.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHelpWellHandler } from '@helpwell/core';
import { readKnowledgeBase } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { indexArticles, indexCollections } from '@helpwell/core/search';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHelpCenter, renderMarkdown, VIDEO_EMBED_ORIGINS } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'https://acme.test';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ARTICLE = `---
title: Welcome to Acme
description: Where everything is.
status: published
---

This is your dashboard.

![The dashboard](../_screenshots/dashboard.png)

> [!TIP]
> Pin the reports you read every week.

:::steps
### Open Settings
Click the gear.

![Settings](./settings.png)
### Invite your team
Press **Invite**.
:::

:::tabs
== macOS
Press Cmd+K.
== Windows
Press Ctrl+K.
:::

:::details What does it cost?
Nothing until you have ten seats.
:::

![A two-minute tour](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

See also [Billing](../billing/invoices.md).
`;

let dir: string;
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hw-helpcentre-media-'));
  mkdirSync(join(dir, 'docs', '_screenshots'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'getting-started'), { recursive: true });
  writeFileSync(join(dir, 'docs', '_screenshots', 'dashboard.png'), PNG);
  writeFileSync(join(dir, 'docs', 'getting-started', 'settings.png'), PNG);
  writeFileSync(join(dir, 'docs', 'getting-started', 'welcome.md'), ARTICLE);

  const handle = await freshDb();
  db = handle.db;
  close = handle.close;

  // What `helpwell sync` does, with the layout `helpwell init` writes.
  const kb = readKnowledgeBase(join(dir, 'docs'));
  await indexArticles(db, kb.articles);
  await indexCollections(db, kb.collections);
});

afterAll(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

function api() {
  return createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    media: { docs: join(dir, 'docs') },
  });
}

function help(options: { media?: false } = {}) {
  return createHelpCenter({
    db,
    basePath: '/help',
    origin: ORIGIN,
    apiPath: '/api/helpwell',
    editUrlTemplate: 'https://github.com/acme/app/edit/main/docs/{path}',
    media: options.media === false ? false : { docs: join(dir, 'docs') },
  });
}

async function fetchImage(handler: (r: Request) => Promise<Response>, src: string) {
  const response = await handler(new Request(`${ORIGIN}${src}`));
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}

describe('a screenshot referenced from an article', () => {
  it('loads on the help centre page, from the help centre', async () => {
    const page = await (await help()(new Request(`${ORIGIN}/help/getting-started/welcome`))).text();
    const sources = [...page.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(sources).toEqual([
      '/help/_screenshots/dashboard.png',
      '/help/_media/getting-started/settings.png',
    ]);

    for (const src of sources) {
      const { response, bytes } = await fetchImage(help(), src);
      expect(response.status, src).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(bytes.equals(PNG)).toBe(true);
    }
  });

  it('loads from the API when the help centre does not serve media itself', async () => {
    const page = await (
      await help({ media: false })(new Request(`${ORIGIN}/help/getting-started/welcome`))
    ).text();
    expect(page).toContain('<img src="/api/helpwell/screenshots/dashboard.png"');
    const { response, bytes } = await fetchImage(api(), '/api/helpwell/screenshots/dashboard.png');
    expect(response.status).toBe(200);
    expect(bytes.equals(PNG)).toBe(true);
    const off = await help({ media: false })(
      new Request(`${ORIGIN}/help/_screenshots/dashboard.png`),
    );
    expect(off.status).toBe(404);
  });

  it('loads in the widget, which renders the API copy of the article', async () => {
    const response = await api()(
      new Request(`${ORIGIN}/api/helpwell/articles/getting-started/welcome`),
    );
    expect(response.status).toBe(200);
    const { article } = (await response.json()) as { article: { body: string } };
    // Absolute, so it loads with the widget on the customer's own site too.
    expect(article.body).toContain(
      `![The dashboard](${ORIGIN}/api/helpwell/screenshots/dashboard.png)`,
    );
    // The file as written stays out of the public API.
    expect(JSON.stringify(article)).not.toContain('status: published');

    // The widget's renderer: the same one, for the panel.
    const html = renderMarkdown(article.body, { surface: 'panel' }).html;
    const src = /<img src="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(src).toBe(`${ORIGIN}/api/helpwell/screenshots/dashboard.png`);
    const image = await fetchImage(api(), src.slice(ORIGIN.length));
    expect(image.response.status).toBe(200);
    expect(image.bytes.equals(PNG)).toBe(true);
    // And in the panel the video is a link, never a frame.
    expect(html).not.toContain('<iframe');
    expect(html).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('cannot be used to read anything else from disk', async () => {
    for (const path of [
      '/help/_media/getting-started/welcome.md',
      '/help/_screenshots/..%2Fgetting-started%2Fwelcome.md',
      '/help/_media/..%2F..%2Fpackage.json',
    ]) {
      const response = await help()(new Request(`${ORIGIN}${path}`));
      expect(response.status, path).toBe(404);
    }
  });
});

describe('blocks on the help centre', () => {
  it('draws callouts, steps, tabs, accordions and an embedded video, with their styles', async () => {
    const page = await (await help()(new Request(`${ORIGIN}/help/getting-started/welcome`))).text();
    expect(page).toContain('class="hc-callout hc-callout--tip" role="note"');
    expect(page).toContain('<ol class="hc-steps">');
    expect(page).toContain('class="hc-tab__radio" type="radio"');
    expect(page).toContain('<summary>What does it cost?</summary>');
    expect(page).toContain(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="A two-minute tour"',
    );
    expect(page).toContain('.hc-body .hc-callout');
    // Step titles are real headings, so they are in the table of contents.
    expect(page).toContain('href="#open-settings"');
  });

  it('lets exactly the video players be framed', async () => {
    const response = await help()(new Request(`${ORIGIN}/help/getting-started/welcome`));
    const policy = response.headers.get('content-security-policy') ?? '';
    const frames = /frame-src ([^;]+)/.exec(policy)?.[1]?.split(' ') ?? [];
    expect(frames).toEqual(["'self'", ...VIDEO_EMBED_ORIGINS]);
    expect(policy).toContain("object-src 'none'");
  });

  it('lets a host replace the policy, or send none', async () => {
    const custom = createHelpCenter({
      db,
      basePath: '/help',
      contentSecurityPolicy: "default-src 'self'",
    });
    const replaced = await custom(new Request(`${ORIGIN}/help/getting-started/welcome`));
    expect(replaced.headers.get('content-security-policy')).toBe("default-src 'self'");
    const none = createHelpCenter({ db, basePath: '/help', contentSecurityPolicy: false });
    const bare = await none(new Request(`${ORIGIN}/help/getting-started/welcome`));
    expect(bare.headers.get('content-security-policy')).toBeNull();
  });

  it('sends a link to another article’s file to that article', async () => {
    const response = await help()(new Request(`${ORIGIN}/help/billing/invoices.md`));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/help/billing/invoices');
  });

  it('links "Edit this page" to the real file', async () => {
    const page = await (await help()(new Request(`${ORIGIN}/help/getting-started/welcome`))).text();
    expect(page).toContain('https://github.com/acme/app/edit/main/docs/getting-started/welcome.md');
  });
});
