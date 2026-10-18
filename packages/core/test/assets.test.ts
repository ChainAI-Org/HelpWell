/**
 * Static assets under the API: how the widget reaches the page.
 *
 * These never touch the database, which is the point — the loader is the
 * hottest URL HelpWell serves, and it must answer even when settings cannot be
 * read.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHelpWellHandler, type HelpWellHandler } from '../src/api.js';
import { createDb, type DbHandle, migrate } from '../src/db.js';

let handle: DbHandle;
let handler: HelpWellHandler;

beforeAll(async () => {
  handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
  handler = createHelpWellHandler({
    db: handle.db,
    basePath: '/api/helpwell',
    assets: {
      'loader.js': { body: 'console.log("loader")', type: 'text/javascript; charset=utf-8' },
      'widget.js': { body: new TextEncoder().encode('/* bundle */'), type: 'text/javascript' },
    },
  });
});

afterAll(async () => {
  await handle.close();
});

const get = (path: string, method = 'GET') =>
  handler(new Request(`http://localhost${path}`, { method }));

describe('assets', () => {
  it('serves a string body with its content type and a day of cache', async () => {
    const response = await get('/api/helpwell/assets/loader.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('console.log("loader")');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('serves a byte body too, so a built bundle need not be decoded first', async () => {
    const response = await get('/api/helpwell/assets/widget.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/* bundle */');
  });

  it('404s an unknown file and names the ones that exist', async () => {
    const response = await get('/api/helpwell/assets/nope.js');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('assets/loader.js');
  });

  it('answers HEAD, which is what a CDN warms a cache with', async () => {
    const response = await get('/api/helpwell/assets/loader.js', 'HEAD');
    expect(response.status).toBe(200);
  });

  it('does not let a POST reach the asset path', async () => {
    const response = await get('/api/helpwell/assets/loader.js', 'POST');
    expect(response.status).toBe(404);
  });

  it('serves nothing when no assets were configured', async () => {
    const bare = createHelpWellHandler({ db: handle.db, basePath: '/api/helpwell' });
    const response = await bare(new Request('http://localhost/api/helpwell/assets/loader.js'));
    expect(response.status).toBe(404);
  });
});
