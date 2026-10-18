import type { Article } from '@helpwell/core/content';
import { type Db, schema } from '@helpwell/core/db';
import { updateChecklistState } from '@helpwell/core/repos';
import { indexArticles } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_JS } from '../src/client/shell.js';
import { bucketSeries, createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';

let db: Db;
let dashboard: DashboardHandler;
let instructions = '# Instructions\n\nAnswer only from the docs.';

function article(
  partial: Pick<Article, 'slug' | 'collection' | 'title' | 'body'> & Partial<Article>,
): Article {
  return {
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 2,
    path: `${partial.slug}.md`,
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    contentHash: `hash-${partial.slug}`,
    ...partial,
  };
}

async function get(path: string, options: { admin?: boolean } = {}): Promise<Response> {
  return dashboard(
    new Request(`${ORIGIN}${BASE}${path}`, {
      headers: options.admin === false ? {} : { 'x-admin': 'yes' },
    }),
  );
}

async function post(path: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(fields);
  return dashboard(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'x-admin': 'yes', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  );
}

async function body(path: string): Promise<string> {
  return (await get(path)).text();
}

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  instructions = '# Instructions\n\nAnswer only from the docs.';

  dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    // The host app owns auth; this stands in for a real session check.
    isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    readInstructions: () => instructions,
    writeInstructions: (value) => {
      instructions = value;
    },
    repoUrlTemplate: 'https://github.com/acme/app/blob/main/docs/{path}',
    docsDir: 'docs/',
  });

  await new SettingsStore(db).update({ product: { name: 'Acme' } });
});

describe('access', () => {
  it('shows nothing without an admin check passing', async () => {
    const response = await get('/conversations', { admin: false });
    expect(response.status).toBe(401);
    const page = await response.text();
    expect(page).toContain('This dashboard is closed');
    // It explains how to wire auth rather than offering a login form.
    expect(page).toContain('isAdmin');
    expect(page).not.toContain('type="password"');
  });

  it('is closed by default when no check is configured at all', async () => {
    const locked = createDashboard({ db, basePath: BASE });
    const response = await locked(new Request(`${ORIGIN}${BASE}/conversations`));
    expect(response.status).toBe(401);
  });

  it('404s outside its base path', async () => {
    const response = await dashboard(new Request(`${ORIGIN}/somewhere-else`));
    expect(response.status).toBe(404);
  });

  it('sends the root to the setup checklist, then to conversations once it is put away', async () => {
    const response = await get('');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/home`);

    await updateChecklistState(db, { dismissed: true });
    const later = await get('');
    expect(later.headers.get('location')).toBe(`${BASE}/conversations`);
  });

  it('never lets a dashboard page be indexed or cached', async () => {
    const response = await get('/conversations');
    expect(await response.text()).toContain('name="robots" content="noindex"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('shell', () => {
  it('draws the wordmark alone in the rail, with no mark beside it', async () => {
    const page = await body('/conversations');
    expect(page).toContain('db-lockup');
    expect(page).toContain('viewBox="24 24 776 171"');
  });

  it('marks the current section, and does not mark the others', async () => {
    const page = await body('/reports');
    const railLinks = page.match(/<a class="db-nav"[^>]*>/g) ?? [];
    const marked = railLinks.filter((link) => link.includes('aria-current="page"'));
    expect(marked).toHaveLength(1);
    expect(page).toContain('/reports" aria-current="page"');
  });

  it('badges the rail with work waiting', async () => {
    await db.insert(schema.conversations).values({
      id: 'cnv_1',
      status: 'unresolved',
      messageCount: 2,
    });
    await db.insert(schema.gaps).values({ id: 'gap_1', question: 'Do you support SSO?', asks: 3 });

    const page = await body('/conversations');
    expect(page).toContain('db-nav__count');
  });

  it('carries the accent from settings into the stylesheet', async () => {
    await new SettingsStore(db).update({ widget: { appearance: { accent: '#0EA5E9' } } });
    expect(await body('/conversations')).toContain('--hw-accent: #0EA5E9');
  });
});

describe('conversations', () => {
  beforeEach(async () => {
    await db.insert(schema.contacts).values({
      id: 'con_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      identified: true,
    });
    await db.insert(schema.conversations).values({
      id: 'cnv_1',
      contactId: 'con_1',
      status: 'unresolved',
      messageCount: 2,
      topic: 'Billing',
    });
    await db.insert(schema.messages).values([
      {
        id: 'msg_1',
        conversationId: 'cnv_1',
        role: 'customer',
        body: 'How do I export invoices?',
      },
      {
        id: 'msg_2',
        conversationId: 'cnv_1',
        role: 'agent',
        body: 'Open **Billing**, then Invoices.',
        citations: [
          { slug: 'billing/invoices', title: 'Exporting invoices', collection: 'Billing' },
        ],
        model: 'anthropic/claude-sonnet-4.5',
        latencyMs: 820,
        feedback: 'helpful',
      },
    ]);
  });

  it('lists conversations with who asked and what they asked', async () => {
    const page = await body('/conversations');
    expect(page).toContain('Ada Lovelace');
    expect(page).toContain('How do I export invoices?');
    expect(page).toContain('Unresolved');
  });

  it('filters by status', async () => {
    expect(await body('/conversations?status=resolved')).toContain('Nothing matches those filters');
    expect(await body('/conversations?status=unresolved')).toContain('Ada Lovelace');
  });

  it('searches the message bodies', async () => {
    expect(await body('/conversations?q=invoices')).toContain('Ada Lovelace');
    expect(await body('/conversations?q=zzzz')).toContain('Nothing matches those filters');
  });

  it('shows the thread with citations, model and latency', async () => {
    const page = await body('/conversations/cnv_1');
    expect(page).toContain('How do I export invoices?');
    expect(page).toContain('<strong>Billing</strong>');
    expect(page).toContain('Exporting invoices');
    expect(page).toContain('anthropic/claude-sonnet-4.5');
    expect(page).toContain('820ms');
    expect(page).toContain('Helpful');
  });

  it('saves a topic, a status and a review mark', async () => {
    const response = await post('/conversations/cnv_1', {
      topic: 'Invoicing',
      status: 'resolved',
      reviewed: '1',
    });
    expect(response.status).toBe(303);

    const page = await body('/conversations/cnv_1');
    expect(page).toContain('value="Invoicing"');
    expect(page).toContain('<option value="resolved" selected>');
    expect(page).toContain('Marked');
  });

  it('adds and removes a tag', async () => {
    await post('/conversations/cnv_1', { topic: 'Billing', status: 'unresolved', tag: 'Refunds' });
    expect(await body('/conversations/cnv_1')).toContain('refunds');

    await post('/conversations/cnv_1', { removeTag: 'refunds' });
    const page = await body('/conversations/cnv_1');
    expect(page).not.toContain('>refunds');
  });

  it('404s a conversation that is not there', async () => {
    expect((await get('/conversations/cnv_nope')).status).toBe(404);
  });
});

describe('contacts', () => {
  beforeEach(async () => {
    await db.insert(schema.contacts).values({
      id: 'con_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      identified: true,
      attributes: { plan: 'Pro', seats: 12 },
    });
    await db.insert(schema.conversations).values({
      id: 'cnv_1',
      contactId: 'con_1',
      status: 'resolved',
      messageCount: 2,
    });
    await db.insert(schema.searches).values({
      id: 'sch_1',
      query: 'invoices',
      resultsCount: 3,
      contactId: 'con_1',
    });
  });

  it('lists people', async () => {
    const page = await body('/contacts');
    expect(page).toContain('Ada Lovelace');
    expect(page).toContain('ada@example.com');
  });

  it('never invents a revenue column', async () => {
    const page = await body('/contacts');
    expect(page).not.toMatch(/\bMRR\b/);
    expect(page).not.toMatch(/Revenue/i);
  });

  it('shows identify attributes, conversations and help centre activity', async () => {
    const page = await body('/contacts/con_1');
    expect(page).toContain('Pro');
    expect(page).toContain('12');
    expect(page).toContain('Conversations');
    expect(page).toContain('Help center activity');
    expect(page).toContain('Searched');
  });

  it('erases a person and everything they said', async () => {
    const response = await post('/contacts/con_1', { action: 'delete' });
    expect(response.status).toBe(303);

    expect((await get('/contacts/con_1')).status).toBe(404);
    const conversations = await db.select().from(schema.conversations);
    expect(conversations).toHaveLength(0);
  });

  it('shows source and consent labels, typed attributes and tracked events', async () => {
    await db.insert(schema.contacts).values({
      id: 'con_2',
      externalId: 'usr_2',
      name: 'Grace Hopper',
      identified: true,
      source: 'import',
      consent: 'granted',
      consentSource: 'api',
      consentAt: new Date('2026-03-04T10:00:00Z'),
      attributes: { trial_ends_at: '2026-10-01', beta: true },
    });
    await db
      .insert(schema.events)
      .values({ id: 'evt_1', contactId: 'con_2', name: 'exported_csv' });
    await db.insert(schema.contactFields).values([
      { key: 'trial_ends_at', label: 'Trial ends', type: 'date' },
      { key: 'beta', label: 'Beta', type: 'boolean' },
    ]);

    const page = await body('/contacts/usr_2');
    expect(page).toContain('Grace Hopper');
    expect(page).toContain('Import');
    expect(page).toContain('via api');
    expect(page).toContain('Trial ends');
    expect(page).toContain('Yes');
    expect(page).toContain('Tracked events');
    expect(page).toContain('exported_csv');

    const list = await body('/contacts');
    expect(list).toContain('Segments');
    expect(list).toContain('Given');
  });

  it('adds and removes a tag from the contact page', async () => {
    expect((await post('/contacts/con_1', { tag: 'VIP' })).status).toBe(303);
    expect(await body('/contacts/con_1')).toContain('vip');
    await post('/contacts/con_1', { removeTag: 'vip' });
    const tags = await db.select().from(schema.contactTags);
    expect(tags).toHaveLength(0);
  });

  it('filters by conditions, saves the filter as a segment and deletes it', async () => {
    await db.insert(schema.contacts).values({
      id: 'con_3',
      name: 'Solo Seat',
      identified: true,
      attributes: { plan: 'Free', seats: 1 },
    });

    const filtered = await body('/contacts?match=all&f1=seats&o1=gte&v1=10');
    expect(filtered).toContain('Ada Lovelace');
    expect(filtered).not.toContain('Solo Seat');
    expect(filtered).toContain('Save as segment');

    const saved = await post('/contacts/segments', {
      name: 'Big teams',
      match: 'all',
      f1: 'seats',
      o1: 'gte',
      v1: '10',
    });
    expect(saved.status).toBe(303);
    const location = saved.headers.get('location') ?? '';
    expect(location).toMatch(/\/contacts\?segment=seg_/);

    const segmentPage = await body(location.replace(BASE, ''));
    expect(segmentPage).toContain('Big teams');
    expect(segmentPage).toContain('Ada Lovelace');
    expect(segmentPage).not.toContain('Solo Seat');
    expect(segmentPage).toContain('Seats ≥ 10');

    const id = new URL(location, ORIGIN).searchParams.get('segment') ?? '';
    await post(`/contacts/segments/${id}`, { action: 'delete' });
    expect(await db.select().from(schema.segments)).toHaveLength(0);
  });

  it('explains a filter it cannot run rather than ignoring it', async () => {
    const page = await body('/contacts?match=all&f1=seats&o1=between&v1=lots');
    expect(page).toContain('needs two numbers');
    const refused = await post('/contacts/segments', { name: 'Nothing' });
    expect(refused.headers.get('location')).toContain('error=');
  });

  it('lists fields and locks a type a person chose', async () => {
    await db.insert(schema.contactFields).values({ key: 'seats', label: 'Seats', type: 'text' });
    const page = await body('/contacts/fields');
    expect(page).toContain('signed_up');
    expect(page).toContain('Built in');

    const saved = await post('/contacts/fields', {
      key: 'seats',
      label: 'Seat count',
      type: 'number',
    });
    expect(saved.headers.get('location')).toContain('saved=seats');
    const [field] = await db.select().from(schema.contactFields).where(sql`key = 'seats'`);
    expect(field).toMatchObject({ label: 'Seat count', type: 'number', locked: true });

    const refused = await post('/contacts/fields', { key: 'seats', label: 'Seats', type: 'text' });
    expect(decodeURIComponent(refused.headers.get('location') ?? '')).toContain('locked');
  });
});

describe('knowledge base', () => {
  beforeEach(async () => {
    await indexArticles(db, [
      article({
        slug: 'billing/invoices',
        collection: 'Billing',
        title: 'Exporting invoices',
        description: 'Download a PDF.',
        body: 'Open Billing, then Invoices.',
      }),
      article({
        slug: 'setup/secret',
        collection: 'Setup',
        title: 'Not ready',
        body: 'Draft.',
        status: 'draft',
      }),
    ]);
  });

  it('lists articles grouped by collection, drafts included', async () => {
    const page = await body('/knowledge');
    expect(page).toContain('Billing');
    expect(page).toContain('Exporting invoices');
    expect(page).toContain('Not ready');
    expect(page).toContain('Draft');
  });

  it('says the repo is the source of truth, and that the editor writes to it', async () => {
    const page = await body('/knowledge');
    expect(page).toContain('source of truth');
    expect(page).toContain('helpwell sync');
    expect(page).toContain(`href="${BASE}/knowledge/new"`);
  });

  it('shows one article with a link into the repo', async () => {
    const page = await body('/knowledge/billing/invoices');
    expect(page).toContain('Exporting invoices');
    expect(page).toContain('https://github.com/acme/app/blob/main/docs/billing/invoices.md');
  });

  it('searches by title', async () => {
    expect(await body('/knowledge?q=invoice')).toContain('Exporting invoices');
    expect(await body('/knowledge?q=zzzz')).toContain('Nothing matches that');
  });
});

describe('gaps', () => {
  beforeEach(async () => {
    await db.insert(schema.gaps).values([
      {
        id: 'gap_1',
        question: 'Do you support SAML SSO?',
        variants: ['Is there SSO?'],
        asks: 7,
        status: 'new',
        suggestedCollection: 'Security',
      },
      { id: 'gap_2', question: 'Old one', asks: 1, status: 'dismissed' },
    ]);
  });

  it('shows open gaps with how often they are asked', async () => {
    const page = await body('/gaps');
    expect(page).toContain('Do you support SAML SSO?');
    expect(page).toContain('>7<');
    expect(page).toContain('Security');
    expect(page).toContain('also asked as');
    expect(page).not.toContain('Old one');
  });

  it('filters to dismissed', async () => {
    const page = await body('/gaps?status=dismissed');
    expect(page).toContain('Old one');
    expect(page).not.toContain('SAML');
  });

  it('marks a gap drafted', async () => {
    const response = await post('/gaps', { id: 'gap_1', status: 'drafted' });
    expect(response.status).toBe(303);
    expect(await body('/gaps')).toContain('No gaps right now');
    expect(await body('/gaps?status=drafted')).toContain('SAML');
  });

  it('says where a dismissed gap went, counts each tab, and undoes it', async () => {
    const response = await post('/gaps', { id: 'gap_1', status: 'dismissed', from: 'new' });
    const location = response.headers.get('location')!;
    expect(location).toContain('done=dismissed');
    const page = await body(location.replace(BASE, ''));
    expect(page).toContain('Dismissed “Do you support SAML SSO?”. It is under Dismissed now.');
    expect(page).toContain('Dismissed · 2');
    expect(page).toContain('name="status" value="new"');
    await post('/gaps', { id: 'gap_1', status: 'new', from: 'new' });
    expect(await body('/gaps')).toContain('SAML');
  });
});

describe('changelog', () => {
  it('writes, publishes and deletes an entry', async () => {
    const created = await post('/changelog/new', {
      title: 'Faster exports',
      summary: 'Half the time.',
      version: '2.1.0',
      body: '## Why\n\nIt streams now.',
      tags: 'Improved, Performance',
      status: 'published',
    });
    expect(created.status).toBe(303);
    const location = created.headers.get('location') ?? '';
    expect(location).toContain(`${BASE}/changelog/chg_`);

    const list = await body('/changelog');
    expect(list).toContain('Faster exports');
    expect(list).toContain('2.1.0');
    expect(list).toContain('Published');

    const id = location.split('/').pop() as string;
    const deleted = await post(`/changelog/${id}`, { action: 'delete' });
    expect(deleted.status).toBe(303);
    expect(await body('/changelog')).toContain('No entries yet');
  });

  it('refuses an entry with no title, and keeps what was typed', async () => {
    const response = await post('/changelog/new', { title: '  ', body: 'Something I wrote' });
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('An entry needs a title.');
    expect(page).toContain('Something I wrote');
  });
});

describe('roadmap', () => {
  it('adds an item and moves it between lanes', async () => {
    const created = await post('/roadmap/new', {
      title: 'Bulk export',
      body: 'For big accounts.',
      status: 'planned',
    });
    expect(created.status).toBe(303);

    let page = await body('/roadmap');
    expect(page).toContain('Bulk export');
    expect(page).toContain('Planned');

    const id = (await db.select().from(schema.roadmapItems))[0]?.id as string;
    await post('/roadmap', { id, status: 'shipped' });

    page = await body('/roadmap');
    expect(page).toContain('Shipped');
  });

  it('refuses an item with no title without losing its detail or selected lane', async () => {
    const response = await post('/roadmap/new', {
      title: '',
      body: 'Keep this proposal <detail>.',
      status: 'in_progress',
    });
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('Give it a title.');
    expect(page).toContain('Keep this proposal &lt;detail&gt;.');
    expect(page).toContain('<option value="in_progress" selected>');
    expect(page).toContain('data-helpwell-dirty');
  });
});

describe('reports', () => {
  beforeEach(async () => {
    await db.insert(schema.conversations).values([
      { id: 'cnv_1', status: 'resolved', messageCount: 2, costUsd: '0.004' },
      { id: 'cnv_2', status: 'unresolved', messageCount: 3, costUsd: '0.006' },
    ]);
    await db.insert(schema.searches).values({
      id: 'sch_1',
      query: 'sso',
      resultsCount: 0,
    });
  });

  it('shows the headline numbers', async () => {
    const page = await body('/reports');
    expect(page).toContain('Conversations');
    expect(page).toContain('>2<');
    expect(page).toContain('50%');
  });

  it('flags a search that found nothing', async () => {
    const page = await body('/reports');
    expect(page).toContain('sso');
    expect(page).toContain('No results');
  });

  it('offers a CSV export the dashboard serves itself, for the range on show', async () => {
    expect(await body('/reports')).toContain(`${BASE}/reports/export?range=30d`);
    const csv = await get('/reports/export?range=7d');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toContain('helpwell-report.csv');
    expect((await csv.text()).split('\n')[0]).toBe('day,conversations,resolved,cost_usd');
    // Behind the dashboard's own check, like every page.
    expect((await get('/reports/export', { admin: false })).status).toBe(401);
  });

  it('changes the range', async () => {
    const page = await body('/reports?range=7d');
    expect(page).toContain('href="/admin/helpwell/reports?range=7d" aria-current="page"');
  });

  it('warns when the spend cap has been reached', async () => {
    await new SettingsStore(db).update({ agent: { spend: { dailyCapUsd: 0.001 } } });
    await db.insert(schema.spendLedger).values({
      id: 'spn_1',
      day: new Date().toISOString().slice(0, 10),
      kind: 'chat',
      model: 'test',
      costUsd: '5.00',
    });
    const page = await body('/reports');
    expect(page).toContain('daily spend cap');
    expect(page).toContain('from search alone');
  });
});

describe('settings', () => {
  it('shows the general tab by default, with values from the database', async () => {
    const page = await body('/settings');
    expect(page).toContain('value="Acme"');
    expect(page).toContain('data-patch="product.name"');
  });

  it('says plainly that the open source build sends no email', async () => {
    expect(await body('/settings')).toContain('sends no email at all');
  });

  it('says exactly where the support email is shown, and that it is only a link', async () => {
    const page = await body('/settings');
    expect(page).toContain('data-patch="product.supportEmail"');
    expect(page).toContain('under an answer the agent could not give and on its Home tab');
    expect(page).toContain('Contact support');
    expect(page).toContain('mailto link');
  });

  it('has no telemetry switch, because nothing phones home', async () => {
    const page = await body('/settings?tab=data');
    expect(page).not.toContain('data.telemetry');
    expect(page).not.toMatch(/usage stats/i);
    expect(page).toContain('Nothing is sent anywhere except to the model provider you configured.');
  });

  it('offers the GitHub token setup only while the changelog drafts from GitHub releases', async () => {
    expect(await body('/settings?tab=changelog')).toContain('id="setup-prompt-github-token"');
    await new SettingsStore(db).update({ changelog: { source: 'tags' } });
    // A fresh handler: the one above cached the settings it read a moment ago.
    dashboard = createDashboard({
      db,
      basePath: BASE,
      apiPath: '/api/helpwell',
      isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    });
    expect(await body('/settings?tab=changelog')).not.toContain('setup-prompt-github-token');
  });

  it('detects the changelog source until one is chosen, and can go back to detecting', async () => {
    const page = await body('/settings?tab=changelog');
    expect(page).toContain('<option value="" selected>Detect it</option>');
    expect(page).toContain('<option value="commits">Commits since the last entry</option>');
    expect(page).not.toContain('since the previous tag</option>');
    expect(page).toContain('Commits since the last entry: the commits since the newest published');

    const store = new SettingsStore(db);
    expect((await store.update({ changelog: { source: 'commits' } })).changelog.source).toBe(
      'commits',
    );
    // What the select sends for "Detect it".
    const cleared = await store.update({ changelog: { source: '' } });
    expect(cleared.changelog.source).toBeUndefined();
    expect((await new SettingsStore(db).get()).changelog.source).toBeUndefined();
  });

  it('shows the instructions as the system prompt, with no separate guardrails screen', async () => {
    const page = await body('/playbook');
    expect(page).toContain('Answer only from the docs.');
    expect(page).toContain('system prompt');
    expect(page).not.toContain('Guardrails');
    expect(await body('/settings?tab=agent')).toContain(`href="${BASE}/playbook"`);
  });

  it('saves edited instructions back to the repo', async () => {
    const response = await post('/settings', {
      action: 'instructions',
      instructions: '# New rules\n\nBe brief.',
    });
    expect(response.status).toBe(303);
    expect(instructions).toBe('# New rules\n\nBe brief.');
    expect(await body('/playbook')).toContain('Be brief.');
  });

  it('lists the six agent tools', async () => {
    const page = await body('/settings?tab=agent');
    for (const tool of [
      'agent.tools.searchDocs',
      'agent.tools.readChangelog',
      'agent.tools.lookUpUser',
      'agent.tools.collectEmail',
      'agent.tools.markUnresolved',
      'agent.tools.suggestArticle',
    ]) {
      expect(page).toContain(`data-patch="${tool}"`);
    }
  });

  it('shows widget display rules with an exclude list', async () => {
    const page = await body('/settings?tab=widget');
    expect(page).toContain('Never show on');
    expect(page).toContain('data-patch="widget.displayRules.exclude"');
  });

  it('runs housekeeping', async () => {
    const response = await post('/settings', { action: 'maintenance' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('tab=data');
  });
});

describe('connections', () => {
  it('shows OpenRouter and the repo, and nothing else', async () => {
    const page = await body('/connections');
    expect(page).toContain('OpenRouter');
    expect(page).toContain('Your repo');
    expect(page).toContain('OPENROUTER_API_KEY');
    // No Stripe, no Slack, no marketplace: there are exactly two connections.
    expect(page).not.toMatch(/Stripe/i);
    expect(page).not.toMatch(/Slack/i);
  });

  it('says when no key is configured', async () => {
    const page = await body('/connections');
    expect(page).toMatch(/Not set|Connected/);
  });

  it('shows the install snippet, pointing at the API-served loader', async () => {
    const page = await body('/connections');
    expect(page).toContain('&lt;script');
    expect(page).toContain('src="/api/helpwell/assets/loader.js"');
  });
});

// Engage has its own suite: test/engage.test.ts.

describe('evals', () => {
  it('explains what an eval is when there are none', async () => {
    const page = await body('/evals');
    expect(page).toContain('No eval runs yet');
    expect(page).toContain('helpwell eval');
  });

  it('lists runs and opens one', async () => {
    await db.insert(schema.evalRuns).values({
      id: 'evl_1',
      ref: 'main',
      score: 82,
      passed: 9,
      weak: 1,
      failed: 1,
      medianMs: 900,
      costUsd: '0.12',
      cases: [
        {
          id: 'c1',
          question: 'How do I export invoices?',
          verdict: 'pass',
          answer: 'Open Billing.',
          cited: 'billing/invoices',
          expected: 'billing/invoices',
          ms: 800,
        },
        {
          id: 'c2',
          question: 'Do you support SSO?',
          verdict: 'fail',
          answer: 'I am not sure.',
          cited: null,
          expected: 'security/sso',
          ms: 1100,
        },
      ],
    });

    const list = await body('/evals');
    expect(list).toContain('82%');
    expect(list).toContain('main');

    const run = await body('/evals/evl_1');
    // Failures are listed first, because those are the docs to fix.
    expect(run.indexOf('Do you support SSO?')).toBeLessThan(
      run.indexOf('How do I export invoices?'),
    );
    expect(run).toContain('expected security/sso');
  });
});

describe('safety', () => {
  it('escapes a topic that contains markup', async () => {
    await db.insert(schema.conversations).values({
      id: 'cnv_x',
      status: 'unresolved',
      topic: '<img src=x onerror=alert(1)>',
      messageCount: 1,
    });
    const page = await body('/conversations');
    expect(page).not.toMatch(/<img src=x onerror/);
    expect(page).toContain('&lt;img');
  });

  it('escapes a product name that contains markup', async () => {
    await new SettingsStore(db).update({ product: { name: '</title><script>x</script>' } });
    const page = await body('/conversations');
    expect(page).not.toContain('<script>x</script>');
  });

  it('renders an agent message through the strict Markdown path', async () => {
    await db
      .insert(schema.conversations)
      .values({ id: 'cnv_y', status: 'resolved', messageCount: 1 });
    await db.insert(schema.messages).values({
      id: 'msg_y',
      conversationId: 'cnv_y',
      role: 'agent',
      body: '<script>alert(1)</script> and [a link](javascript:alert(1))',
    });
    const page = await body('/conversations/cnv_y');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).not.toContain('javascript:alert');
  });

  it('encodes an article slug in every link to it', async () => {
    await indexArticles(db, [
      article({ slug: 'weird/x" y', collection: 'Weird', title: 'Odd slug', body: 'Body.' }),
    ]);
    const list = await body('/knowledge');
    expect(list).toContain(`href="${BASE}/knowledge/weird/x%22%20y"`);
    expect(list).not.toContain('knowledge/weird/x" y');

    const page = await body('/knowledge/weird/x%22%20y');
    expect(page).toContain('https://github.com/acme/app/blob/main/docs/weird/x%22%20y.md');
    expect(page).not.toContain('docs/weird/x" y');
  });
});

describe('cross-site requests', () => {
  async function postFrom(
    path: string,
    fields: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Response> {
    return dashboard(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: {
          'x-admin': 'yes',
          'content-type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        body: new URLSearchParams(fields),
      }),
    );
  }

  beforeEach(async () => {
    await db.insert(schema.gaps).values({ id: 'gap_1', question: 'SSO?', asks: 1, status: 'new' });
  });

  it('refuses a POST from another origin and changes nothing', async () => {
    const response = await postFrom(
      '/gaps',
      { id: 'gap_1', status: 'dismissed' },
      { origin: 'https://evil.example' },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('did not come from this site');
    const [gap] = await db.select().from(schema.gaps);
    expect(gap?.status).toBe('new');
  });

  it('refuses a POST the browser marks as cross-site', async () => {
    const response = await postFrom(
      '/gaps',
      { id: 'gap_1', status: 'dismissed' },
      { 'sec-fetch-site': 'cross-site' },
    );
    expect(response.status).toBe(403);
    const [gap] = await db.select().from(schema.gaps);
    expect(gap?.status).toBe('new');
  });

  it('accepts a POST from its own origin', async () => {
    const response = await postFrom(
      '/gaps',
      { id: 'gap_1', status: 'dismissed' },
      { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
    );
    expect(response.status).toBe(303);
    const [gap] = await db.select().from(schema.gaps);
    expect(gap?.status).toBe('dismissed');
  });
});

describe('hardening', () => {
  it('404s a path that cannot be decoded rather than crashing', async () => {
    const response = await get('/knowledge/%zz');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('That is not here');
  });

  it('ignores a changelog cursor that is not a date', async () => {
    await post('/changelog/new', { title: 'Cursor test', status: 'draft' });
    const response = await get('/changelog?cursor=nope');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Cursor test');
  });

  it('shows the first settings tab for an unknown one', async () => {
    const page = await body('/settings?tab=nope');
    expect(page).toContain('data-patch="product.name"');
    expect(page).toContain('?tab=general" aria-current="page"');
  });

  it('refuses a roadmap lane that does not exist', async () => {
    const created = await post('/roadmap/new', { title: 'Bulk export', status: 'whatever' });
    expect(created.status).toBe(400);
    expect(await created.text()).toContain('Pick a lane from the list.');
    expect(await db.select().from(schema.roadmapItems)).toHaveLength(0);

    await post('/roadmap/new', { title: 'Bulk export', status: 'planned' });
    const id = (await db.select().from(schema.roadmapItems))[0]?.id as string;
    const moved = await post('/roadmap', { id, status: 'whatever' });
    expect(moved.status).toBe(400);
    expect((await db.select().from(schema.roadmapItems))[0]?.status).toBe('planned');
  });

  it('refuses a changelog status that does not exist', async () => {
    const response = await post('/changelog/new', { title: 'Odd', status: 'bogus' });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Pick a status from the list.');
    expect(await db.select().from(schema.changelogEntries)).toHaveLength(0);
  });

  it('shows an archived entry as archived, not published', async () => {
    await db.insert(schema.changelogEntries).values({
      id: 'chg_old',
      title: 'Retired feature',
      body: 'x',
      status: 'archived',
      publishedAt: new Date('2025-01-01T00:00:00Z'),
    });
    const page = await body('/changelog');
    expect(page).toContain('db-pill--neutral">Archived</span>');
    expect(page).not.toContain('db-pill--good">Published</span>');
  });

  it('shows the locked-out page bare, without the rail or the island', async () => {
    const response = await get('/conversations', { admin: false });
    expect(response.status).toBe(401);
    const page = await response.text();
    expect(page).toContain('This dashboard is closed');
    expect(page).not.toContain('<nav class="db-rail"');
    expect(page).not.toContain('/admin/settings');
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('Conversations');
  });

  it('has a main landmark, a skip link and a modal palette', async () => {
    const page = await body('/conversations');
    expect(page).toContain('<a class="db-skip" href="#main">');
    expect(page).toContain('<main id="main" class="db-main">');
    // The palette is the island's, a served file rather than an inline script.
    expect(page).toMatch(/<script src="\/admin\/helpwell\/_assets\/shell\.[0-9a-f]{12}\.js"/);
    expect(SHELL_JS).toContain('aria-modal="true"');
    expect(SHELL_JS).toContain('restoreFocus.focus()');
    expect(SHELL_JS).toContain('.db-nav__label');
  });

  it('describes the chart in a table for screen readers', async () => {
    await db
      .insert(schema.conversations)
      .values({ id: 'cnv_1', status: 'resolved', messageCount: 1 });
    const page = await body('/reports?range=7d');
    expect(page).toContain('<table class="db-visually-hidden">');
    expect(page).toContain('<caption>Conversations by day</caption>');
    expect(page).toContain('<div class="db-chart" aria-hidden="true">');
  });

  it('sets the page language from the product locale', async () => {
    await new SettingsStore(db).update({ product: { locale: 'de-DE' } });
    expect(await body('/conversations')).toContain('<html lang="de-DE">');
  });
});

describe('settings controls', () => {
  it('sends list settings as arrays', async () => {
    expect(await body('/settings?tab=agent')).toContain(
      'data-patch="agent.abuse.blockedDomains" data-patch-type="list"',
    );
    const widget = await body('/settings?tab=widget');
    expect(widget).toContain('data-patch="widget.displayRules.include" data-patch-type="list"');
    expect(widget).toContain('data-patch="widget.displayRules.exclude" data-patch-type="list"');
    expect(await body('/settings?tab=changelog')).toContain(
      'data-patch="changelog.categories" data-patch-type="list"',
    );
    // The island does the splitting, and leaves an emptied number box alone.
    expect(SHELL_JS).toContain("getAttribute('data-patch-type') === 'list'");
    expect(SHELL_JS).toContain("if (String(value).trim() === '') return;");
  });

  it('keeps the embedding model on Connections only', async () => {
    expect(await body('/settings?tab=agent')).not.toContain('data-patch="agent.models.embeddings"');
    expect(await body('/connections')).toContain('data-patch="agent.models.embeddings"');
  });

  it('offers every header pattern and a place for the image', async () => {
    const page = await body('/settings?tab=widget');
    for (const pattern of [
      'none',
      'waves',
      'dots',
      'grid',
      'diagonal',
      'noise',
      'confetti',
      'image',
    ]) {
      expect(page).toContain(`<option value="${pattern}"`);
    }
    expect(page).toContain('data-patch="widget.appearance.patternImageUrl"');
  });

  it('edits the public address and the whole help centre theme', async () => {
    const page = await body('/settings?tab=knowledge');
    // The help centre reads the domain on every request, so it is a real control.
    expect(page).toContain('data-patch="helpCenter.domain"');
    expect(page).not.toContain('data-config-only="helpCenter.domain"');
    for (const path of ['hero', 'underCards', 'tints', 'defaultTheme', 'faviconUrl']) {
      expect(page).toContain(`data-patch="helpCenter.theme.${path}"`);
    }
    expect(page).toContain('data-patch="helpCenter.subpath"');
    expect(page).toContain('data-patch="helpCenter.sitemap"');
    expect(page).toContain('data-patch="helpCenter.theme.background"');
    expect(page).toContain('data-patch="helpCenter.theme.headlineFont"');
  });
});

describe('conversation topics', () => {
  beforeEach(async () => {
    await db.insert(schema.conversations).values([
      { id: 'cnv_a', status: 'resolved', messageCount: 1, topic: 'Zebra' },
      { id: 'cnv_b', status: 'resolved', messageCount: 1, topic: 'Yak' },
    ]);
  });

  it('filters by topic from the pill on a row', async () => {
    const all = await body('/conversations');
    expect(all).toContain(`href="${BASE}/conversations?topic=Zebra"`);
    const filtered = await body('/conversations?topic=Zebra');
    expect(filtered).toContain('Zebra');
    expect(filtered).not.toContain('Yak');
    expect(filtered).toContain('Clear the topic filter');
  });
});

describe('webhook deliveries', () => {
  it('lists recent deliveries with their status, and the events a hook can subscribe to', async () => {
    await db.insert(schema.webhookDeliveries).values([
      {
        id: 'whd_1',
        event: 'conversation.unresolved',
        url: 'https://hooks.example/in/secret-token',
        payload: {},
        status: 'delivered',
        attempts: 1,
        responseCode: 200,
        deliveredAt: new Date(),
      },
      {
        id: 'whd_2',
        event: 'gap.created',
        url: 'https://hooks.example/in/secret-token',
        payload: {},
        status: 'failed',
        attempts: 3,
        error: 'connect ECONNREFUSED 10.0.0.1:443 <details>',
      },
    ]);
    const page = await body('/webhooks');
    expect(page).toContain('Recent deliveries');
    expect(page).toContain('<code>conversation.unresolved</code>');
    expect(page).toContain('<code>gap.created</code>');
    expect(page).toContain('db-pill--good">Delivered</span>');
    expect(page).toContain('db-pill--bad">Failed</span>');
    expect(page).toContain('>200<');
    expect(page).toContain('connect ECONNREFUSED 10.0.0.1:443 &lt;details&gt;');
    // Host only: the path could carry a token.
    expect(page).toContain('hooks.example');
    expect(page).not.toContain('secret-token');
    for (const event of [
      'conversation.unresolved',
      'gap.created',
      'roadmap.idea',
      'survey.response',
    ]) {
      expect(page).toContain(`<code>${event}</code>`);
    }
  });

  it('says so when nothing has been delivered', async () => {
    expect(await body('/webhooks')).toContain('No deliveries yet.');
    // Connections says it in brief, and points to the page.
    const connections = await body('/connections');
    expect(connections).toContain('none yet');
    expect(connections).toContain(`href="${BASE}/webhooks"`);
  });

  it('lists every event, offers a receiver prompt, and sends a test delivery', async () => {
    const before = await body('/webhooks');
    for (const event of ['conversation.created', 'message.created', 'article.published']) {
      expect(before).toContain(`<code>${event}</code>`);
    }
    expect(before).toContain('Set this up with an AI assistant');
    expect(before).toContain('HELPWELL_WEBHOOK_SECRET');
    expect(before).not.toContain('value="webhook-test"');

    await new SettingsStore(db).update({
      webhooks: [{ url: 'https://hooks.example/in', events: ['gap.created'], secret: 's' }],
    });
    // A fresh handler: the one above cached the settings it read a moment ago.
    dashboard = createDashboard({
      db,
      basePath: BASE,
      apiPath: '/api/helpwell',
      isAdmin: (request) => request.headers.get('x-admin') === 'yes',
      // Caught on the stand-in global fetch below: the guard is off, as for local development.
      webhookFetch: false,
    });
    const sent: string[] = [];
    vi.stubGlobal('fetch', (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response('ok');
    }) as typeof fetch);
    try {
      expect(await body('/webhooks')).toContain('value="webhook-test"');
      const response = await post('/webhooks', { action: 'webhook-test' });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toContain('1%20delivered');
      expect(JSON.parse(sent[0]!)).toMatchObject({ event: 'webhook.test' });
      expect(await body('/webhooks')).toContain('<code>webhook.test</code>');
      // What the button did is said on the page it lands on, in its own words only.
      const landed = await body(response.headers.get('location')!.slice(BASE.length));
      expect(landed).toContain('1 delivered, 0 failed');
      expect(await body('/webhooks?webhooks=Call%20us%20on%20555')).not.toContain('Call us on 555');
      // Connections still takes the button, where it used to be.
      const old = await post('/connections', { action: 'webhook-test' });
      expect(old.headers.get('location')).toContain(`${BASE}/webhooks?webhooks=`);

      const retry = await post('/connections', { action: 'webhook-retry' });
      expect(decodeURIComponent(retry.headers.get('location') ?? '')).toContain('Nothing to retry');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('chart bucketing', () => {
  const days = (count: number, from = '2026-01-05') =>
    Array.from({ length: count }, (_, i) => {
      const date = new Date(`${from}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + i);
      return { day: date.toISOString().slice(0, 10), conversations: 1, resolved: 0, costUsd: 0 };
    });

  it('keeps one bar per day up to 120 points', () => {
    const points = bucketSeries(days(120));
    expect(points).toHaveLength(120);
    expect(points[0]).toEqual({ label: '2026-01-05', value: 1 });
  });

  it('folds into weeks above 120 points', () => {
    const points = bucketSeries(days(121));
    expect(points).toHaveLength(18);
    // 2026-01-05 is a Monday, so the first bucket is that week.
    expect(points[0]).toEqual({ label: '2026-01-05', value: 7 });
    expect(points[17]).toEqual({ label: '2026-05-04', value: 2 });
    expect(points.reduce((sum, point) => sum + point.value, 0)).toBe(121);
  });

  it('folds into months above 520 points', () => {
    const points = bucketSeries(days(521));
    expect(points).toHaveLength(18);
    expect(points[0]).toEqual({ label: '2026-01', value: 27 });
    expect(points.reduce((sum, point) => sum + point.value, 0)).toBe(521);
    expect(points.every((point) => /^\d{4}-\d{2}$/.test(point.label))).toBe(true);
  });
});
