/**
 * The dashboard as a host runs it for one of many installs: embedded in the
 * host's own navigation, limited to some pages, in the host's accent, saving
 * to the host's content source, and on the host's models.
 */

import { FakeModel, type ModelFactory } from '@helpwell/core/agent';
import { createMemoryContentSource } from '@helpwell/core/content';
import { type Db, rowsOf } from '@helpwell/core/db';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHELL_JS } from '../src/client/shell.js';
import { createDashboard, type DashboardConfig } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/i/acme/admin';

let db: Db;

function mount(extra: Partial<DashboardConfig> = {}) {
  const dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/i/acme/api',
    isAdmin: () => true,
    env: {},
    ...extra,
  });
  return {
    get: (path: string) => dashboard(new Request(`${ORIGIN}${BASE}${path}`)),
    post: (path: string, fields: Record<string, string>) =>
      dashboard(
        new Request(`${ORIGIN}${BASE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields),
        }),
      ),
  };
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
});

describe('embedded', () => {
  it('draws the page without the rail or the shell, and keeps the island script', async () => {
    const { get } = mount({ embedded: true });
    const page = await (await get('/settings')).text();
    expect(page).toContain('<body class="db-embedded" data-page="settings">');
    expect(page).toContain('<main id="main" class="db-main">');
    expect(page).toContain('<h1>Settings</h1>');
    expect(page).not.toContain('class="db-rail"');
    expect(page).not.toContain('class="db-shell"');
    // The island still saves settings, to this install's API; the host owns
    // navigation, so no palette over it. Both are on the island's own tag,
    // which is a file under the mount path, not an inline script.
    const island =
      /<\/main>\s*<script src="\/i\/acme\/admin\/_assets\/shell\.[0-9a-f]{12}\.js" data-api="\/i\/acme\/api" data-palette="false"><\/script>/;
    expect(page).toMatch(island);
    expect(SHELL_JS).toContain("fetch(API + '/admin/settings'");
    expect(SHELL_JS).toContain("tag.getAttribute('data-api')");
    // Links stay under the mount path.
    expect(page).toContain(`href="${BASE}/`);

    // The island's file is served under the mount path too.
    const src = /src="\/i\/acme\/admin(\/_assets\/shell\.[0-9a-f]{12}\.js)"/.exec(page)?.[1];
    const script = await mount({ embedded: true }).get(src ?? '');
    expect(script.status).toBe(200);
    expect(await script.text()).toBe(SHELL_JS);
  });

  it('leaves out the page title when the host shows it, and keeps the action buttons', async () => {
    const withTitle = await (await mount({ embedded: true }).get('/knowledge')).text();
    expect(withTitle).toContain('<h1>Knowledge base</h1>');

    const page = await (await mount({ embedded: true, hideTitle: true }).get('/knowledge')).text();
    expect(page).not.toContain('<h1>');
    expect(page).toContain('class="db-top db-top--bare"');
    expect(page).toContain('class="db-btn db-btn--primary"');
    expect(page).toContain('<title>Knowledge base');

    // Standalone dashboards keep their heading.
    const standalone = await (await mount().get('/knowledge')).text();
    expect(standalone).toContain('<h1>Knowledge base</h1>');
  });

  it('is off by default: the rail and shell are there, and the palette', async () => {
    const page = await (await mount().get('/settings')).text();
    expect(page).toContain('<nav class="db-rail"');
    expect(page).toContain('<div class="db-shell">');
    expect(page).toContain('data-palette="true"');
  });
});

describe('a pages allow-list', () => {
  it('serves only those pages, for reads and writes, and the rail offers only them', async () => {
    const { get, post } = mount({ pages: ['knowledge', 'settings'] });
    expect((await get('/knowledge')).status).toBe(200);
    expect((await get('/settings')).status).toBe(200);
    expect((await get('/conversations')).status).toBe(404);
    expect((await get('/reports')).status).toBe(404);
    expect((await post('/gaps', { id: 'gap_x', status: 'dismissed' })).status).toBe(404);

    const page = await (await get('/knowledge')).text();
    const rail = /<nav class="db-rail"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? '';
    expect(rail).toContain(`href="${BASE}/knowledge"`);
    expect(rail).toContain(`href="${BASE}/settings"`);
    expect(rail).not.toContain(`href="${BASE}/conversations"`);
    expect(rail).not.toContain(`href="${BASE}/home"`);
  });

  it('sends the front door to the first allowed page', async () => {
    const response = await mount({ pages: ['knowledge', 'settings'] }).get('');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/knowledge`);
  });
});

describe('an accent override', () => {
  it('wins over the widget accent from Settings, and a bad one is ignored', async () => {
    const page = await (await mount({ accent: '#0F766E' }).get('/settings')).text();
    expect(page).toContain('--hw-accent: #0F766E');
    const unsafe = await (await mount({ accent: 'red;}</style>' }).get('/settings')).text();
    expect(unsafe).not.toContain('red;}</style>');
  });
});

describe('a content source', () => {
  it('lets the editor save into it when there is no writeArticle hook', async () => {
    const content = createMemoryContentSource({
      'billing/invoices.md': '---\ntitle: Exporting invoices\n---\n\nOpen Billing.\n',
    });
    await syncContent(db, content);
    const { get, post } = mount({ content });

    const editor = await (await get('/knowledge/new')).text();
    expect(editor).not.toContain('Save straight to the repo');

    const saved = await post('/knowledge/new', {
      title: 'Changing your plan',
      description: '',
      collection: 'billing',
      status: 'published',
      body: 'Open **Plans**.\n\n![Plans](../_screenshots/plans.png)',
      action: 'save',
    });
    expect(saved.status).toBe(303);
    expect(await content.readText('billing/changing-your-plan.md')).toContain('Open **Plans**.');

    const [row] = rowsOf<{ body: string }>(
      await db.execute(
        sql`SELECT body FROM helpwell.article_index WHERE slug = 'billing/changing-your-plan'`,
      ),
    );
    expect(row?.body).toContain('](/i/acme/api/screenshots/plans.png)');

    // The setup checklist counts what is in the source.
    const home = await (await get('/home')).text();
    expect(home).toContain('2 Markdown files');
  });
});

describe('a model factory', () => {
  it('decides whether the install has a model at all', async () => {
    const asked: string[] = [];
    const chat = new FakeModel();
    const factory: ModelFactory = (purpose) => {
      asked.push(purpose);
      return purpose === 'chat' ? chat : null;
    };
    const page = await (await mount({ modelFactory: factory }).get('/connections')).text();
    expect(asked).toContain('chat');
    expect(page).toContain('Answering with');

    const none = await (await mount({ modelFactory: () => null }).get('/connections')).text();
    expect(none).toContain('Without a key the agent answers from search alone.');
  });
});

describe('access', () => {
  it('hides the controls a host says the request may not use', async () => {
    const full = await (
      await mount({ embedded: true, contentMode: 'managed' }).get('/knowledge')
    ).text();
    expect(full).toContain('New article');
    expect(full).toContain('/knowledge/_import');

    const writer = mount({
      embedded: true,
      contentMode: 'managed',
      access: () => ({ content: true, configure: false }),
    });
    const list = await (await writer.get('/knowledge')).text();
    expect(list).toContain('New article');
    expect(list).not.toContain('/knowledge/_import');
    expect(list).not.toContain('/knowledge/_redirects');
    expect(await (await writer.get('/changelog')).text()).not.toContain('Write an entry');

    const reader = mount({
      embedded: true,
      contentMode: 'managed',
      access: () => ({ content: false, configure: false }),
    });
    expect(await (await reader.get('/knowledge')).text()).not.toContain('New article');
  });
});
