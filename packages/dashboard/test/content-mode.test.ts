/**
 * `contentMode`: what the pages say about saving, for an install whose
 * content lives in a repo (the default) and for one whose content is managed
 * for it, with no repo, config file or command line behind the dashboard.
 * Every page that talks about saving is drawn both ways; the managed one must
 * never send anyone to a repo, a config file or a CLI command.
 *
 * Also here: the dashboard's own webhook sends (tests, retries, and what a
 * save publishes) go through `webhookFetch`, or the built-in guard.
 */

import { createMemoryContentSource } from '@helpwell/core/content';
import { type Db, rowsOf } from '@helpwell/core/db';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ContentMode, createDashboard, type DashboardConfig } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';

let db: Db;

/** Phrases that only make sense with a repo, a config file or the CLI to hand. */
const REPO_ONLY = [
  /helpwell sync/i,
  /your repo/i,
  /in the repo/i,
  /source of truth/i,
  /settings pull/i,
  /helpwell\.config/i,
  /npx helpwell/i,
  /helpwell (capture|init|eval|import|changelog|docs|webhooks)\b/i,
  /helpwell\/(instructions|playbook)\.md/i,
  /helpwell\/evals\.json/i,
];

function mount(mode: ContentMode | undefined, extra: Partial<DashboardConfig> = {}) {
  let instructions = '';
  let playbook = '';
  const content = createMemoryContentSource({
    'billing/invoices.md': '---\ntitle: Exporting invoices\n---\n\nOpen Billing, then Export.\n',
  });
  const dashboard = createDashboard({
    db,
    basePath: BASE,
    isAdmin: () => true,
    env: {},
    content,
    contentMode: mode,
    readInstructions: () => instructions,
    writeInstructions: (value) => {
      instructions = value;
    },
    readPlaybook: () => playbook,
    writePlaybook: (value) => {
      playbook = value;
    },
    ...extra,
  });
  const request = (path: string, init?: RequestInit) =>
    dashboard(new Request(`${ORIGIN}${BASE}${path}`, init));
  return {
    content,
    get: async (path: string) => {
      const response = await request(path);
      return { status: response.status, text: visibleText(await response.text()) };
    },
    post: (path: string, fields: Record<string, string>) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      }),
  };
}

/** What a person reads: the page without its scripts and styles. */
function visibleText(page: string): string {
  return page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
}

/** The prompts for an AI assistant are for a person to copy elsewhere, not page copy. */
function withoutPrompts(page: string): string {
  return page.replace(/<section class="db-prompt[\s\S]*?<\/section>/g, '');
}

function repoOnly(page: string): string[] {
  const text = withoutPrompts(page);
  return REPO_ONLY.filter((pattern) => pattern.test(text)).map(String);
}

/** Every page that says anything about saving, reading or where content lives. */
async function pages(app: ReturnType<typeof mount>): Promise<Record<string, string>> {
  const created = await app.post('/forms/new', { template: 'newsletter' });
  const builder = created.headers.get('location') ?? `${BASE}/forms`;
  const out: Record<string, string> = {};
  for (const path of [
    '/home',
    '/knowledge',
    '/knowledge/billing/invoices',
    '/knowledge/billing/invoices?edit=1',
    '/knowledge/new',
    '/knowledge/_redirects',
    '/knowledge/_import',
    '/playbook',
    '/playbook?file=playbook',
    '/playbook?saved=1',
    '/evals',
    '/changelog',
    '/engage',
    '/engage/new',
    '/engage/new?template=blank-modal',
    '/forms',
    builder.slice(BASE.length),
    '/contacts',
    '/settings?tab=agent',
    '/settings?tab=data',
    '/settings?tab=knowledge',
    '/settings?tab=changelog',
    '/connections',
    '/webhooks',
    '/reports',
  ]) {
    const page = await app.get(path);
    expect(page.status, path).toBe(200);
    out[path] = page.text;
  }
  return out;
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contentMode: 'managed'", () => {
  it('never sends anyone to a repo, a config file or a command', async () => {
    const app = mount('managed');
    await syncContent(db, app.content);
    const found: Record<string, string[]> = {};
    for (const [path, page] of Object.entries(await pages(app))) {
      const hits = repoOnly(page);
      if (hits.length > 0) found[path] = hits;
    }
    expect(found).toEqual({});
  });

  it('says what saving does instead: saved here, live once indexed', async () => {
    const app = mount('managed');
    await syncContent(db, app.content);
    expect((await app.get('/knowledge')).text).toContain('Articles are saved here.');
    const article = (await app.get('/knowledge/billing/invoices')).text;
    expect(article).toContain('A save goes live once the article is indexed.');
    expect((await app.get('/playbook?saved=1')).text).toContain(
      'Saved. The agent uses it from the next answer.',
    );
    expect((await app.get('/changelog')).text).toContain(
      'It goes live on your changelog as soon as you publish it.',
    );
    // Entries are written here: no command drafts them, so nothing asks where from.
    const changelogSettings = (await app.get('/settings?tab=changelog')).text;
    expect(changelogSettings).toContain(
      'Entries are written and published here, in the dashboard.',
    );
    expect(changelogSettings).not.toContain('data-patch="changelog.source"');
    expect(changelogSettings).not.toContain('GITHUB_TOKEN');
    const home = (await app.get('/home')).text;
    expect(home).toContain('saving an article indexes it');
    // No editor to connect to a managed install, so no step for it.
    expect(home).not.toContain('data-step="mcp"');
  });

  it('saves an article to the content source and says it is live', async () => {
    const app = mount('managed');
    await syncContent(db, app.content);
    const saved = await app.post('/knowledge/new', {
      title: 'Refunds',
      description: '',
      collection: 'billing',
      status: 'published',
      body: 'Pro rata, to the day.',
      action: 'save',
    });
    expect(saved.status).toBe(303);
    expect(await app.content.readText('billing/refunds.md')).toContain('Pro rata');
    const page = (await app.get(`${saved.headers.get('location')?.slice(BASE.length)}`)).text;
    expect(page).toContain('Saved and indexed: live for text search.');
    expect(repoOnly(page)).toEqual([]);
  });

  it('draws the knowledge base empty state without the CLI', async () => {
    const empty = (await mount('managed').get('/knowledge')).text;
    expect(empty).toContain('Write the first one here.');
    expect(repoOnly(empty)).toEqual([]);
  });

  it('says eval cases could not be read without naming a file in a repo', async () => {
    for (const cases of ['{"nope": true}', '[{"id": "x", "question": "Hi?", "expect": 3}]']) {
      const app = mount('managed', { readEvalCases: () => cases });
      const page = (await app.get('/evals')).text;
      expect(page).toContain('could not be read');
      expect(page).not.toContain('helpwell/evals.json');

      const run = await app.post('/evals/run', {});
      const error = new URL(run.headers.get('location') ?? '', ORIGIN).searchParams.get('error');
      expect(error).toContain('the saved eval cases');
      expect(error).not.toContain('helpwell/evals.json');
    }
    // The repo wording still names the file, which is where the fix goes.
    const repo = mount('repo', { readEvalCases: () => '{"nope": true}' });
    expect((await repo.get('/evals')).text).toContain('helpwell/evals.json');
  });
});

describe("contentMode: 'repo', the default", () => {
  it('keeps the repo wording, with the commands', async () => {
    for (const app of [mount(undefined), mount('repo')]) {
      await syncContent(db, app.content);
      expect((await app.get('/knowledge')).text).toContain('Your repo is the source of truth.');
      expect((await app.get('/knowledge/billing/invoices')).text).toContain(
        'Edit it here, or edit the file and run helpwell sync.',
      );
      expect((await app.get('/playbook?saved=1')).text).toContain(
        'Saved to helpwell/instructions.md.',
      );
      expect((await app.get('/engage/new?template=blank-modal')).text).toContain(
        'helpwell settings pull',
      );
      expect((await app.get('/changelog')).text).toContain('helpwell changelog');
      expect((await app.get('/settings?tab=changelog')).text).toContain(
        'data-patch="changelog.source"',
      );
      expect((await app.get('/evals')).text).toContain('helpwell init');
      const home = (await app.get('/home')).text;
      expect(home).toContain('npx helpwell sync');
      expect(home).toContain('data-step="mcp"');
      expect((await app.get('/connections')).text).toContain('Your repo');
      expect((await app.get('/contacts')).text).toContain('npx helpwell import contacts');
    }
  });
});

describe('the dashboard and webhookFetch', () => {
  const hook = { url: 'https://hooks.acme.invalid/in', events: [], secret: 's', active: true };

  it('sends tests, retries and what a save publishes through it', async () => {
    const sent: string[] = [];
    const own = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push((JSON.parse(String(init?.body)) as { event: string }).event);
      return new Response('nope', { status: 500 });
    });
    const global = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', global);
    await new SettingsStore(db).update({ webhooks: [hook] });
    const app = mount('managed', { webhookFetch: own as unknown as typeof fetch });
    await syncContent(db, app.content);

    await app.post('/changelog/new', { title: 'Faster exports', status: 'published', body: 'x' });
    await app.post('/knowledge/new', {
      title: 'Refunds',
      description: '',
      collection: 'billing',
      status: 'published',
      body: 'Pro rata.',
      action: 'save',
    });
    await app.post('/connections', { action: 'webhook-test' });
    await app.post('/connections', { action: 'webhook-retry' });

    expect(sent).toEqual(
      expect.arrayContaining(['changelog.published', 'article.published', 'webhook.test']),
    );
    const [row] = rowsOf<{ n: number }>(
      await db.execute(sql`SELECT count(*)::int AS n FROM helpwell.webhook_deliveries`),
    );
    // The retry went through it too: more sends than deliveries.
    expect(sent.length).toBeGreaterThan(row?.n ?? 0);
    expect(global).not.toHaveBeenCalled();
  });

  it('is the built-in guard by default, which refuses a private address', async () => {
    const global = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', global);
    await new SettingsStore(db).update({
      webhooks: [{ ...hook, url: 'http://localhost:4000/in' }],
    });
    const app = mount(undefined);
    const response = await app.post('/connections', { action: 'webhook-test' });
    expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain(
      '0 delivered, 1 failed',
    );
    const [row] = rowsOf<{ error: string }>(
      await db.execute(sql`SELECT error FROM helpwell.webhook_deliveries`),
    );
    expect(row?.error).toContain('Webhook guard');
    expect(global).not.toHaveBeenCalled();
  });
});
