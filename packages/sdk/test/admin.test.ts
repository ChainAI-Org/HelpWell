import { beforeEach, describe, expect, it } from 'vitest';
import { HelpWellApiError, HelpWellClient } from '../src/index.js';
import type { Recorder } from './helpers/recorder.js';
import { BASE, recorder } from './helpers/recorder.js';

const TOKEN = 'admin-token-for-tests';

let http: Recorder;
let client: HelpWellClient;

beforeEach(() => {
  http = recorder();
  client = new HelpWellClient({ baseUrl: BASE, adminToken: TOKEN, fetch: http.fetch });
});

describe('the admin token guard', () => {
  it('refuses every admin call when no token was configured', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    const attempts = [
      () => bare.admin.conversations(),
      () => bare.admin.conversation('c_1'),
      () => bare.admin.updateConversation('c_1', { status: 'resolved' }),
      () => bare.admin.addConversationTag('c_1', 'vip'),
      () => bare.admin.removeConversationTag('c_1', 'vip'),
      () => bare.admin.gaps(),
      () => bare.admin.updateGap('g_1', 'drafted'),
      () => bare.admin.contacts(),
      () => bare.admin.contact('ct_1'),
      () => bare.admin.addContactTag('ct_1', 'vip'),
      () => bare.admin.removeContactTag('ct_1', 'vip'),
      () => bare.admin.deleteContact('ct_1'),
      () => bare.admin.exportContact('ct_1'),
      () => bare.admin.articles(),
      () => bare.admin.searchArticles('x'),
      () => bare.admin.reports(),
      () => bare.admin.exportReport(),
      () => bare.admin.engageReport(),
      () => bare.admin.settings(),
      () => bare.admin.updateSettings({}),
      () => bare.admin.changelog(),
      () => bare.admin.changelogEntry('cl_1'),
      () => bare.admin.createChangelogEntry({ title: 'x' }),
      () => bare.admin.updateChangelogEntry('cl_1', {}),
      () => bare.admin.deleteChangelogEntry('cl_1'),
      () => bare.admin.roadmap(),
      () => bare.admin.updateRoadmapItem('rm_1', { status: 'planned' }),
      () => bare.admin.deleteRoadmapItem('rm_1'),
      () => bare.admin.spend(),
      () => bare.admin.blocked(),
      () => bare.admin.evals(),
      () => bare.admin.evalRun('ev_1'),
      () => bare.admin.maintenance(),
    ];

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(HelpWellApiError);
    }
    expect(http.calls).toHaveLength(0);
  });

  it('fails before the request rather than letting the server answer 401', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    await expect(bare.admin.spend()).rejects.toMatchObject({
      code: 'no_admin_token',
      status: 401,
    });
    expect(http.calls).toHaveLength(0);
  });

  it('names the constructor option so the fix is obvious', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    await expect(bare.admin.spend()).rejects.toThrow(/adminToken/);
  });

  it('sends the bearer token on every admin call', async () => {
    await client.admin.conversations();
    await client.admin.gaps();
    await client.admin.contacts();
    await client.admin.articles();
    await client.admin.reports();
    await client.admin.settings();
    await client.admin.changelog();
    await client.admin.roadmap();
    await client.admin.spend();
    await client.admin.blocked();
    await client.admin.evals();
    http.reply(null, 204);
    await client.admin.maintenance();

    expect(http.calls).toHaveLength(12);
    for (const call of http.calls) {
      expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }
  });
});

describe('conversations', () => {
  it('passes every filter the list route understands', async () => {
    http.reply({ items: [], nextCursor: null });
    await client.admin.conversations({
      status: 'unresolved',
      topic: 'billing',
      q: 'refund',
      contactId: 'ct_1',
      cursor: 'conv_9',
      limit: 10,
    });
    const { url, method } = http.only();
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/api/helpwell/admin/conversations');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'unresolved',
      topic: 'billing',
      q: 'refund',
      contactId: 'ct_1',
      cursor: 'conv_9',
      limit: '10',
    });
  });

  it('sends no query string at all when no filters were given', async () => {
    http.reply({ items: [], nextCursor: null });
    await client.admin.conversations();
    expect(http.only().url.search).toBe('');
  });

  it('reads one thread by id', async () => {
    http.reply({ id: 'conv_1', messages: [] });
    const thread = await client.admin.conversation('conv_1');
    expect(thread.id).toBe('conv_1');
    expect(http.only().path).toBe('/admin/conversations/conv_1');
  });

  it('patches a thread and returns the updated one', async () => {
    http.reply({ id: 'conv_1', status: 'resolved', messages: [] });
    const updated = await client.admin.updateConversation('conv_1', {
      status: 'resolved',
      reviewed: true,
      topic: null,
    });
    const call = http.only();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/admin/conversations/conv_1');
    expect(call.body).toEqual({ status: 'resolved', reviewed: true, topic: null });
    expect(updated.status).toBe('resolved');
  });

  it('adds a tag with a POST body and removes it from the path', async () => {
    http.reply(null, 204);
    http.reply(null, 204);
    await client.admin.addConversationTag('conv_1', 'VIP');
    await client.admin.removeConversationTag('conv_1', 'needs review');
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      path: '/admin/conversations/conv_1/tags',
      body: { tag: 'VIP' },
    });
    expect(http.calls[1]).toMatchObject({
      method: 'DELETE',
      path: '/admin/conversations/conv_1/tags/needs%20review',
      body: undefined,
    });
  });
});

describe('gaps', () => {
  it('unwraps the list and filters by status', async () => {
    http.reply({ items: [{ id: 'gap_1', question: 'How do I cancel?' }] });
    const gaps = await client.admin.gaps({ status: 'new', limit: 5 });
    expect(gaps[0]?.question).toBe('How do I cancel?');
    const { url } = http.only();
    expect(url.searchParams.get('status')).toBe('new');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('resolves a gap against the article that answers it', async () => {
    http.reply(null, 204);
    await client.admin.updateGap('gap_1', 'drafted', 'billing/cancelling');
    const call = http.only();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/admin/gaps/gap_1');
    expect(call.body).toEqual({ status: 'drafted', articleSlug: 'billing/cancelling' });
  });

  it('dismisses a gap without naming an article', async () => {
    http.reply(null, 204);
    await client.admin.updateGap('gap_1', 'dismissed');
    expect(http.only().body).toEqual({ status: 'dismissed' });
  });
});

describe('contacts', () => {
  it('sends the identified filter as a real boolean, including false', async () => {
    http.reply({ items: [], nextCursor: null });
    await client.admin.contacts({ identified: false, q: 'ada' });
    const { url } = http.only();
    expect(url.searchParams.get('identified')).toBe('false');
    expect(url.searchParams.get('q')).toBe('ada');
  });

  it('reads one contact', async () => {
    http.reply({ id: 'ct_1', email: 'ada@example.com' });
    const contact = await client.admin.contact('ct_1');
    expect(contact.email).toBe('ada@example.com');
    expect(http.only().path).toBe('/admin/contacts/ct_1');
  });

  it('tags and untags a contact', async () => {
    http.reply(null, 204);
    http.reply(null, 204);
    await client.admin.addContactTag('ct_1', 'beta');
    await client.admin.removeContactTag('ct_1', 'beta');
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      path: '/admin/contacts/ct_1/tags',
      body: { tag: 'beta' },
    });
    expect(http.calls[1]).toMatchObject({
      method: 'DELETE',
      path: '/admin/contacts/ct_1/tags/beta',
    });
  });

  it('deletes a contact with a DELETE and resolves on the 204', async () => {
    http.reply(null, 204);
    await expect(client.admin.deleteContact('ct_1')).resolves.toBeUndefined();
    const call = http.only();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/admin/contacts/ct_1');
  });

  it('exports a contact from the export route, not the detail route', async () => {
    http.reply({ contact: {}, conversations: [], activity: [] });
    await client.admin.exportContact('ct_1');
    expect(http.only().path).toBe('/admin/contacts/ct_1/export');
  });

  it('updates a contact by your own user id, from the client or from admin', async () => {
    http.reply({ id: 'con_1' });
    http.reply({ id: 'con_1' });
    await client.contacts.update('usr_8412', { attributes: { seats: 4 } });
    await client.admin.contacts.update('usr 8412', { tags: { add: ['vip'] }, consent: 'granted' });
    expect(http.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/admin/contacts/usr_8412',
      body: { attributes: { seats: 4 } },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(http.calls[1]).toMatchObject({
      path: '/admin/contacts/usr%208412',
      body: { tags: { add: ['vip'] }, consent: 'granted' },
    });
  });

  it('filters the list by a segment or by conditions sent as JSON', async () => {
    http.reply({ items: [], nextCursor: null });
    http.reply({ items: [], nextCursor: null });
    await client.admin.contacts({ segment: 'seg_1' });
    await client.admin.contacts.list({ conditions: { field: 'plan', op: 'is', value: 'pro' } });
    expect(http.calls[0]!.url.searchParams.get('segment')).toBe('seg_1');
    expect(JSON.parse(http.calls[1]!.url.searchParams.get('conditions')!)).toEqual({
      field: 'plan',
      op: 'is',
      value: 'pro',
    });
  });

  it('tracks, reads events and exports CSV for one contact', async () => {
    http.reply({ id: 'evt_1', contactId: 'con_1' }, 201);
    http.reply({ items: [], nextCursor: null });
    http.replyText('id,external_id\n');
    await client.contacts.track(
      'usr_1',
      'exported_csv',
      { rows: 3 },
      { at: '2026-01-01T00:00:00Z' },
    );
    await client.contacts.events('usr_1', { name: 'exported_csv' });
    const csv = await client.contacts.csv({ segment: 'seg_1' });
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      path: '/admin/events',
      body: {
        contact: 'usr_1',
        name: 'exported_csv',
        props: { rows: 3 },
        at: '2026-01-01T00:00:00Z',
      },
    });
    expect(http.calls[1]!.path).toBe('/admin/contacts/usr_1/events?name=exported_csv');
    expect(http.calls[2]!.path).toBe('/admin/contacts.csv?segment=seg_1');
    expect(csv).toBe('id,external_id\n');
  });

  it('refuses the contacts namespace without a token, before any request', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    await expect(bare.contacts.update('usr_1', {})).rejects.toThrow(HelpWellApiError);
    expect(http.calls).toHaveLength(0);
  });
});

describe('fields, events and segments', () => {
  it('lists and edits fields', async () => {
    http.reply({ items: [{ key: 'email' }] });
    http.reply({ key: 'seats', type: 'number' });
    expect(await client.admin.fields()).toEqual([{ key: 'email' }]);
    await client.admin.updateField('attributes.tags', { type: 'list', hidden: true });
    expect(http.calls[1]).toMatchObject({
      method: 'PATCH',
      path: '/admin/fields/attributes.tags',
      body: { type: 'list', hidden: true },
    });
  });

  it('reads events and their counts', async () => {
    http.reply({ items: [], nextCursor: null });
    http.reply({ items: [{ name: 'x', count: 2 }] });
    await client.admin.events({ name: 'x', limit: 5 });
    expect(await client.admin.eventCounts({ days: 7 })).toEqual([{ name: 'x', count: 2 }]);
    expect(http.calls[0]!.path).toBe('/admin/events?name=x&limit=5');
    expect(http.calls[1]!.path).toBe('/admin/events/counts?days=7');
  });

  it('creates, previews, counts, pages and deletes segments', async () => {
    const rules = { all: [{ field: 'seats', op: 'gte' as const, value: 4 }] };
    http.reply({ id: 'seg_1', count: 2 }, 201);
    http.reply({ count: 5 });
    http.reply({ count: 2 });
    http.reply({ items: [], nextCursor: null });
    http.reply({ items: [{ id: 'seg_1' }] });
    http.reply(null, 204);
    await client.admin.createSegment({ name: 'Big teams', rules });
    expect(await client.admin.previewSegment(rules)).toBe(5);
    expect(await client.admin.countSegment('seg_1')).toBe(2);
    await client.admin.segmentMembers('seg_1', { limit: 10 });
    expect(await client.admin.segments()).toEqual([{ id: 'seg_1' }]);
    await client.admin.deleteSegment('seg_1');
    expect(http.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /admin/segments',
      'POST /admin/segments/preview',
      'GET /admin/segments/seg_1/count',
      'GET /admin/segments/seg_1/members?limit=10',
      'GET /admin/segments',
      'DELETE /admin/segments/seg_1',
    ]);
    expect(http.calls[0]!.body).toEqual({ name: 'Big teams', rules });
  });
});

describe('webhooks', () => {
  it('reads deliveries, retries and sends a test', async () => {
    http.reply({ items: [] });
    http.reply({ attempted: 1, delivered: 1, failed: 0, gaveUp: 0, deliveries: [] });
    http.reply({ items: [{ status: 'delivered' }] });
    await client.admin.webhookDeliveries({ status: 'retrying' });
    await client.admin.retryWebhooks({ force: true });
    expect(await client.admin.testWebhook('https://hooks.example.com')).toEqual([
      { status: 'delivered' },
    ]);
    expect(http.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/admin/webhooks/deliveries?status=retrying', undefined],
      ['POST', '/admin/webhooks/retry', { force: true }],
      ['POST', '/admin/webhooks/test', { url: 'https://hooks.example.com' }],
    ]);
  });
});

describe('articles', () => {
  it('lists every article, drafts included, and unwraps the envelope', async () => {
    http.reply({ items: [{ slug: 'billing/refunds', status: 'draft', embedded: false }] });
    const articles = await client.admin.articles();
    expect(articles[0]?.status).toBe('draft');
    const { url } = http.only();
    expect(url.pathname).toBe('/api/helpwell/admin/articles');
    expect(url.search).toBe('');
  });

  it('searches with q on the same route', async () => {
    http.reply({ items: [{ slug: 'billing/refunds', snippet: '<mark>refund</mark>' }] });
    const hits = await client.admin.searchArticles('refund');
    expect(hits[0]?.snippet).toContain('<mark>');
    expect(http.only().url.searchParams.get('q')).toBe('refund');
  });
});

describe('reports, spend and evals', () => {
  it('asks for a preset range', async () => {
    http.reply({ range: { from: '', to: '' }, headline: {} });
    await client.admin.reports({ range: '7d' });
    expect(http.only().url.searchParams.get('range')).toBe('7d');
  });

  it('asks for an explicit window when given one', async () => {
    http.reply({ range: { from: '', to: '' }, headline: {} });
    await client.admin.reports({ from: '2026-01-01', to: '2026-02-01' });
    const { url } = http.only();
    expect(url.searchParams.get('from')).toBe('2026-01-01');
    expect(url.searchParams.get('to')).toBe('2026-02-01');
  });

  it('returns the CSV export as text rather than trying to parse it', async () => {
    http.replyText('day,conversations,resolved,cost_usd\n2026-01-01,3,2,0.000400\n');
    const csv = await client.admin.exportReport({ range: '7d' });
    expect(csv.startsWith('day,conversations')).toBe(true);
    const { url } = http.only();
    expect(url.pathname).toBe('/api/helpwell/admin/reports/export');
    expect(url.searchParams.get('range')).toBe('7d');
  });

  it('reads the engage report, with a survey id when asked for NPS', async () => {
    http.reply({ engagements: [], nps: { responses: 0, score: null } });
    const report = await client.admin.engageReport({ range: '30d', surveyId: 'nps_q3' });
    expect(report.nps?.score).toBeNull();
    const { url } = http.only();
    expect(url.pathname).toBe('/api/helpwell/admin/reports/engage');
    expect(url.searchParams.get('surveyId')).toBe('nps_q3');
  });

  it('reads the spend status', async () => {
    http.reply({ allowed: true, spentTodayUsd: 1.5, capUsd: 10, warning: false, percentUsed: 15 });
    const spend = await client.admin.spend();
    expect(spend.spentTodayUsd).toBe(1.5);
    expect(http.only().path).toBe('/admin/spend');
  });

  it('unwraps the blocked attempts', async () => {
    http.reply({ items: [{ id: 'blk_1', reason: 'honeypot' }] });
    const blocked = await client.admin.blocked();
    expect(blocked[0]?.reason).toBe('honeypot');
    expect(http.only().path).toBe('/admin/blocked');
  });

  it('unwraps the eval runs', async () => {
    http.reply({ items: [{ id: 'ev_1', score: 92 }] });
    const runs = await client.admin.evals();
    expect(runs[0]?.score).toBe(92);
    expect(http.only().path).toBe('/admin/evals');
  });

  it('reads one eval run with its cases', async () => {
    http.reply({ id: 'ev_1', score: 92, cases: [{ id: 'c1', verdict: 'pass' }] });
    const run = await client.admin.evalRun('ev_1');
    expect(run.cases[0]?.verdict).toBe('pass');
    expect(http.only().path).toBe('/admin/evals/ev_1');
  });
});

describe('settings', () => {
  it('reads the whole settings object', async () => {
    http.reply({ product: { name: 'Acme' } });
    await client.admin.settings();
    const call = http.only();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/admin/settings');
  });

  it('patches settings with exactly what it was given, so the merge stays server-side', async () => {
    http.reply({ product: { name: 'Acme' } });
    await client.admin.updateSettings({ widget: { position: 'bottom-left' } });
    const call = http.only();
    expect(call.method).toBe('PATCH');
    expect(call.body).toEqual({ widget: { position: 'bottom-left' } });
  });
});

describe('changelog CRUD', () => {
  it('lists drafts as well as published entries, from the admin route', async () => {
    http.reply({ items: [], nextCursor: null });
    await client.admin.changelog({ limit: 5, cursor: 'cl_9' });
    const { url } = http.only();
    expect(url.pathname).toBe('/api/helpwell/admin/changelog');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('cursor')).toBe('cl_9');
  });

  it('reads one entry', async () => {
    http.reply({ id: 'cl_1', title: 'Shipped', status: 'draft' });
    const entry = await client.admin.changelogEntry('cl_1');
    expect(entry.status).toBe('draft');
    expect(http.only().path).toBe('/admin/changelog/cl_1');
  });

  it('creates an entry and returns its id', async () => {
    http.reply({ id: 'cl_2' }, 201);
    const created = await client.admin.createChangelogEntry({
      title: 'Faster search',
      tags: ['improvement'],
      status: 'draft',
    });
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/changelog');
    expect(call.body).toEqual({
      title: 'Faster search',
      tags: ['improvement'],
      status: 'draft',
    });
    expect(created.id).toBe('cl_2');
  });

  it('updates an entry with a PATCH', async () => {
    http.reply({ id: 'cl_2', status: 'published' });
    const updated = await client.admin.updateChangelogEntry('cl_2', { status: 'published' });
    const call = http.only();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/admin/changelog/cl_2');
    expect(call.body).toEqual({ status: 'published' });
    expect(updated.status).toBe('published');
  });

  it('deletes an entry', async () => {
    http.reply(null, 204);
    await client.admin.deleteChangelogEntry('cl_2');
    const call = http.only();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/admin/changelog/cl_2');
  });
});

describe('roadmap', () => {
  it('reads the admin board, which is not capped per column like the public one', async () => {
    http.reply({ under_review: [], planned: [], in_progress: [], shipped: [] });
    await client.admin.roadmap();
    expect(http.only().path).toBe('/admin/roadmap');
  });

  it('ships an item and links the entry that announced it', async () => {
    http.reply(null, 204);
    await client.admin.updateRoadmapItem('rm_1', { status: 'shipped', changelogEntryId: 'cl_3' });
    const call = http.only();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/admin/roadmap/rm_1');
    expect(call.body).toEqual({ status: 'shipped', changelogEntryId: 'cl_3' });
  });

  it('deletes an item', async () => {
    http.reply(null, 204);
    await client.admin.deleteRoadmapItem('rm_1');
    const call = http.only();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/admin/roadmap/rm_1');
  });
});

describe('maintenance', () => {
  it('posts to the sweep route and reports what it pruned', async () => {
    http.reply({ conversationsPruned: 4, countersPruned: 12 });
    const result = await client.admin.maintenance();
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/maintenance');
    expect(result).toEqual({ conversationsPruned: 4, countersPruned: 12 });
  });
});
