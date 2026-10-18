/**
 * Redirects for a help centre whose knowledge base comes from a content
 * source, as a hosted install's does: the map is `_redirects.json` among
 * the install's content (the dashboard's Redirects screen and importer write
 * it), read through the source, picked up as soon as it changes, and held to
 * the same rules as the file in a repo, so it can never send anyone off the
 * help centre.
 */

import {
  CONTENT_REDIRECTS_PATH,
  createMemoryContentSource,
  writeContentRedirects,
} from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHelpCenter } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'https://help.acme.test';
const OLD = 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds';

let db: Db;

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
});

async function hosted() {
  const content = createMemoryContentSource({
    'billing/refunds.md': '---\ntitle: Issuing a refund\n---\n\nWithin 30 days.\n',
  });
  await syncContent(db, content);
  const help = createHelpCenter({ db, basePath: '/help', origin: ORIGIN, content });
  const get = (path: string) => help(new Request(`${ORIGIN}${path}`));
  return { content, get };
}

describe('redirects from a content source', () => {
  it('sends an old URL on to its article, and picks up a change without a restart', async () => {
    const { content, get } = await hosted();
    expect((await get('/hc/en-us/articles/11-Refunds')).status).toBe(404);

    await writeContentRedirects(content, [{ from: OLD, to: '/help/billing/refunds' }]);
    const moved = await get('/hc/en-us/articles/11-Refunds?utm=x');
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/help/billing/refunds?utm=x');

    await writeContentRedirects(content, []);
    expect((await get('/hc/en-us/articles/11-Refunds')).status).toBe(404);
  });

  it('never redirects off the help centre, whatever the map says', async () => {
    const { content, get } = await hosted();
    await content.write!(
      CONTENT_REDIRECTS_PATH,
      JSON.stringify({
        redirects: [
          { from: '/a', to: 'https://evil.test/' },
          { from: '/b', to: '//evil.test/x' },
          { from: '/c', to: '/\\evil.test' },
          { from: '/d', to: '/help/billing/refunds?next=https://evil.test' },
          { from: '/e', to: 'javascript:alert(1)' },
          { from: '/f', to: '/elsewhere/entirely' },
        ],
      }),
    );
    for (const path of ['/a', '/b', '/c', '/d', '/e', '/f']) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it('serves nothing from a map that is not one, and answers pages as before', async () => {
    const { content, get } = await hosted();
    await content.write!(CONTENT_REDIRECTS_PATH, 'not json');
    expect((await get('/hc/en-us/articles/11-Refunds')).status).toBe(404);
    expect((await get('/help/billing/refunds')).status).toBe(200);
  });

  it('follows the help centre to wherever it is mounted, as a repo map does', async () => {
    const { content } = await hosted();
    await writeContentRedirects(content, [{ from: OLD, to: '/help/billing/refunds' }]);
    const moved = createHelpCenter({ db, basePath: '/support', origin: ORIGIN, content });
    const response = await moved(new Request(`${ORIGIN}/hc/en-us/articles/11-Refunds`));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/support/billing/refunds');
  });
});
