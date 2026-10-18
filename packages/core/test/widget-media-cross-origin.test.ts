// @vitest-environment happy-dom
/**
 * The widget on a customer's site, reading an article from the API on
 * another origin. The article's screenshot is indexed as a path on the API
 * (`/api/helpwell/screenshots/…`); drawn as it was, the customer's page
 * would resolve it against its own domain and show a broken image. The
 * widget is the real one, from its source, in happy-dom, and the API is the
 * real handler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../../widget/src/widget.js';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler, type HelpWellHandler } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import { createDb, type DbHandle, migrate } from '../src/db.js';
import { syncContent } from '../src/search/sync.js';

const API_ORIGIN = 'https://help.acme-hosted.example';
const API = `${API_ORIGIN}/api/helpwell`;
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

let handle: DbHandle;
let handler: HelpWellHandler;
let widget: Widget | null = null;

beforeEach(async () => {
  vi.stubGlobal('localStorage', undefined);
  handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
  const content = createMemoryContentSource({
    'billing/invoices.md':
      '---\ntitle: Exporting invoices\n---\n\nOpen Billing, then Export.\n\n![The export button](../_screenshots/export.png)\n\n![A receipt](./receipt.png)\n',
    'billing/receipt.png': PNG,
    '_screenshots/export.png': PNG,
  });
  await syncContent(handle.db, content);
  handler = createHelpWellHandler({
    db: handle.db,
    content,
    model: new FakeModel(),
    corsOrigins: [window.location.origin],
    env: {},
  });
});

afterEach(async () => {
  widget?.destroy();
  widget = null;
  vi.unstubAllGlobals();
  await handle.close();
});

/** The customer's page calling the API on its own origin: no cookies arrive. */
const crossSite: typeof globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.delete('cookie');
  headers.set('origin', window.location.origin);
  return handler(new Request(String(input), { ...init, headers }));
};

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('an article image in the widget on the customer’s site', () => {
  it('loads from the API, not from the customer’s page', async () => {
    expect(window.location.origin).not.toBe(API_ORIGIN);
    widget = new Widget({ apiUrl: API, fetch: crossSite });
    await widget.mount();
    widget.open({ name: 'article', slug: 'billing/invoices', from: { name: 'help' } });
    await settle();

    const root = widget.shadowRoot;
    expect(root?.querySelector('.article h1')?.textContent?.trim()).toBe('Exporting invoices');
    const images = [...(root?.querySelectorAll<HTMLImageElement>('.article__body img') ?? [])];
    const sources = images.map((image) => image.getAttribute('src') ?? '');
    expect(sources).toEqual([`${API}/screenshots/export.png`, `${API}/media/billing/receipt.png`]);

    // Resolved the way the browser resolves them on the customer's page,
    // each still points at the API, and the API serves the picture.
    for (const src of sources) {
      const resolved = new URL(src, window.location.href);
      expect(resolved.origin).toBe(API_ORIGIN);
      const response = await crossSite(resolved.href);
      expect(response.status, src).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
    }
  });
});
