/**
 * `client.admin.forms`: the requests it makes, the shapes it promises, and a
 * round trip against a real handler (create, a visitor's submission, the
 * submissions list, analytics, export and import, delete).
 */

import { createHelpWellHandler, type HelpWellHandler } from '@helpwell/core/api';
import { createDb, type DbHandle, migrate } from '@helpwell/core/db';
import type {
  Draw as CoreDraw,
  Form as CoreForm,
  FormExport as CoreFormExport,
  FormSubmission as CoreFormSubmission,
  FormVersionSummary as CoreFormVersionSummary,
  GiveawayEntry as CoreGiveawayEntry,
  GiveawayWinner as CoreGiveawayWinner,
} from '@helpwell/core/repos';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import {
  type Form,
  type FormExport,
  type FormSubmission,
  type FormVersionSummary,
  type GiveawayDraw,
  type GiveawayEntry,
  type GiveawayWinner,
  HelpWellApiError,
  HelpWellClient,
} from '../src/index.js';
import { BASE, type Recorder, recorder } from './helpers/recorder.js';

/** What JSON.stringify does to a repo result: every Date becomes a string. */
type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

describe('form response types', () => {
  it('match core with dates as strings', () => {
    // A definition holds no dates, and its recursive conditions defeat
    // Jsonified, so it is compared as it is.
    expectTypeOf<Omit<Form, 'definition'>>().toEqualTypeOf<
      Jsonified<Omit<CoreForm, 'definition'>>
    >();
    expectTypeOf<Form['definition']>().toEqualTypeOf<CoreForm['definition']>();
    expectTypeOf<Omit<FormExport, 'definition'>>().toEqualTypeOf<
      Jsonified<Omit<CoreFormExport, 'definition'>>
    >();
    expectTypeOf<FormExport['definition']>().toEqualTypeOf<CoreFormExport['definition']>();
    expectTypeOf<FormVersionSummary>().toEqualTypeOf<Jsonified<CoreFormVersionSummary>>();
    expectTypeOf<FormSubmission>().toEqualTypeOf<Jsonified<CoreFormSubmission>>();
    expectTypeOf<GiveawayEntry>().toEqualTypeOf<Jsonified<CoreGiveawayEntry>>();
    expectTypeOf<GiveawayWinner>().toEqualTypeOf<Jsonified<CoreGiveawayWinner>>();
    expectTypeOf<GiveawayDraw>().toEqualTypeOf<Jsonified<CoreDraw>>();
  });
});

/* ---------------------------------------------------------------- requests */

const TOKEN = 'admin-token-for-tests';
let http: Recorder;
let client: HelpWellClient;

beforeEach(() => {
  http = recorder();
  client = new HelpWellClient({ baseUrl: BASE, adminToken: TOKEN, fetch: http.fetch });
});

describe('admin.forms requests', () => {
  it('refuses without an admin token, before any request', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    await expect(bare.admin.forms()).rejects.toThrow(HelpWellApiError);
    await expect(bare.admin.forms.get('news')).rejects.toThrow(HelpWellApiError);
    await expect(bare.admin.forms.draw('win')).rejects.toThrow(HelpWellApiError);
    expect(http.calls).toHaveLength(0);
  });

  it('lists with a range, archived as 1, and unwraps the items', async () => {
    http.reply({ items: [{ id: 'news' }] });
    const forms = await client.admin.forms({ range: '7d', archived: true });
    expect(forms).toEqual([{ id: 'news' }]);
    const call = http.only();
    expect(call.url.pathname).toBe('/api/helpwell/admin/forms');
    expect(call.url.searchParams.get('range')).toBe('7d');
    expect(call.url.searchParams.get('archived')).toBe('1');
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('creates, saves with the expected version, and deletes', async () => {
    http.reply({ id: 'news' }, 201);
    http.reply({ id: 'news' });
    http.reply({ result: 'archived' });
    await client.admin.forms.create({ template: 'newsletter', name: 'News' });
    await client.admin.forms.update('news', { enabled: true, expectedVersion: 3, note: 'copy' });
    expect(await client.admin.forms.delete('news')).toBe('archived');
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      path: '/admin/forms',
      body: { template: 'newsletter', name: 'News' },
    });
    expect(http.calls[1]).toMatchObject({
      method: 'PATCH',
      path: '/admin/forms/news',
      body: { enabled: true, expectedVersion: 3, note: 'copy' },
    });
    expect(http.calls[2]).toMatchObject({ method: 'DELETE', path: '/admin/forms/news' });
  });

  it('reaches versions, restore, export and import', async () => {
    http.reply({ items: [{ version: 2 }] });
    http.reply({ version: 1 });
    http.reply({ id: 'news' });
    http.reply({ helpwell: 'form' });
    http.reply({ form: { id: 'news' }, created: false });
    expect(await client.admin.forms.versions('news')).toEqual([{ version: 2 }]);
    await client.admin.forms.version('news', 1);
    await client.admin.forms.restore('news', 1);
    await client.admin.forms.export('news');
    await client.admin.forms.import(
      {
        helpwell: 'form',
        formatVersion: 1,
        id: 'news',
        name: 'News',
        enabled: false,
        definition: {} as never,
      },
      { overwrite: true },
    );
    expect(http.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /admin/forms/news/versions',
      'GET /admin/forms/news/versions/1',
      'POST /admin/forms/news/versions/1/restore',
      'GET /admin/forms/news/export',
      'POST /admin/forms/import',
    ]);
    expect(http.calls[4]!.body).toMatchObject({ id: 'news', overwrite: true });
  });

  it('filters submissions and fetches the CSV as text', async () => {
    http.reply({ items: [], nextCursor: null });
    http.replyText('id,email\n');
    await client.admin.forms.submissions('news', { status: 'trusted', q: 'ada', limit: 20 });
    const csv = await client.admin.forms.submissionsCsv('news', { status: 'rejected' });
    expect(csv).toBe('id,email\n');
    expect(http.calls[0]!.url.searchParams.get('status')).toBe('trusted');
    expect(http.calls[0]!.url.searchParams.get('limit')).toBe('20');
    expect(http.calls[1]!.url.pathname).toBe('/api/helpwell/admin/forms/news/submissions.csv');
  });

  it('draws, redraws and disqualifies on a giveaway', async () => {
    http.reply({ winners: [] }, 201);
    http.reply({ redrawn: {}, replacement: {} });
    http.reply({ id: 'gve_1' });
    await client.admin.forms.draw('win', { count: 3, seed: 'launch' });
    await client.admin.forms.redraw('win', 'gvw_1', 'Did not reply');
    await client.admin.forms.disqualify('win', 'gve_1');
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      path: '/admin/forms/win/giveaway/draw',
      body: { count: 3, seed: 'launch' },
    });
    expect(http.calls[1]).toMatchObject({
      path: '/admin/forms/win/giveaway/winners/gvw_1/redraw',
      body: { reason: 'Did not reply' },
    });
    expect(http.calls[2]).toMatchObject({
      method: 'PATCH',
      path: '/admin/forms/win/giveaway/entries/gve_1',
      body: { disqualified: true },
    });
  });

  it('asks for one platform’s prompt', async () => {
    http.reply({ embed: { nextjs: '…' }, button: '…' });
    await client.admin.forms.prompts('news', { platform: 'nextjs' });
    expect(http.only().path).toBe('/admin/forms/news/prompts?platform=nextjs');
  });
});

/* ------------------------------------------------------------------- live */

const LIVE = 'http://helpwell.test/api/helpwell';
const ADMIN = 'live-forms-admin-token';
let handle: DbHandle;
let handler: HelpWellHandler;
let clock = new Date('2026-09-01T12:00:00Z');

beforeAll(async () => {
  handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
  handler = createHelpWellHandler({
    db: handle.db,
    basePath: '/api/helpwell',
    identitySecret: 'live-forms-identity-secret',
    adminToken: ADMIN,
    secureCookies: false,
    now: () => clock,
    forms: { resolveMx: async () => ['mx.example.com'] },
  });
});

afterAll(async () => {
  await handle.close();
});

function visitorCall(path: string, body: unknown): Promise<Response> {
  return handler(
    new Request(`${LIVE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://helpwell.test' },
      body: JSON.stringify(body),
    }),
  );
}

describe('admin.forms against a real handler', () => {
  it('creates a form, sees a visitor’s submission, and moves it between installs', async () => {
    const admin = new HelpWellClient({
      baseUrl: LIVE,
      adminToken: ADMIN,
      fetch: (input, init) => handler(new Request(input, init)),
    }).admin;

    const templates = await admin.forms.templates();
    expect(templates.map((t) => t.key)).toContain('newsletter');

    const created = await admin.forms.create({ template: 'newsletter', id: 'news', enabled: true });
    expect(created).toMatchObject({ id: 'news', type: 'newsletter', enabled: true, version: 1 });
    expect(typeof created.createdAt).toBe('string');

    const drawn = (await (
      await visitorCall('/forms/news/render', { placement: 'inline', page: { path: '/blog' } })
    ).json()) as { shown: boolean; token: string };
    expect(drawn.shown).toBe(true);
    clock = new Date(clock.getTime() + 8000);
    const sent = await visitorCall('/forms/news/submit', {
      token: drawn.token,
      answers: { email: 'ada@lovelace.dev' },
      page: { path: '/blog', url: 'http://helpwell.test/blog' },
    });
    expect(sent.status).toBe(201);

    const page = await admin.forms.submissions('news', { status: 'trusted' });
    expect(page.items).toHaveLength(1);
    const [row] = page.items;
    expect(row).toMatchObject({ email: 'ada@lovelace.dev', status: 'accepted', trusted: true });
    expect(typeof row!.createdAt).toBe('string');
    expect(row!.verdict).toMatchObject({ honeypot: false, tooFast: false, trusted: true });
    expect(await admin.forms.submission('news', row!.id)).toMatchObject({ id: row!.id });
    expect(await admin.forms.submissionsCsv('news')).toContain('ada@lovelace.dev');

    const [listed] = await admin.forms();
    expect(listed).toMatchObject({ id: 'news', stats: { uniques: 1, trusted: 1 } });
    const analytics = await admin.forms.analytics('news');
    expect(analytics.totals).toMatchObject({ uniques: 1, trusted: 1, conversionRate: 1 });

    const saved = await admin.forms.update('news', {
      definition: { ...created.definition, tags: ['launch'] },
      expectedVersion: 1,
    });
    expect(saved.version).toBe(2);
    await expect(
      admin.forms.update('news', { definition: created.definition, expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await admin.forms.versions('news')).map((v) => v.version)).toEqual([2, 1]);

    const exported = await admin.forms.export('news');
    await expect(admin.forms.import(exported)).rejects.toMatchObject({ status: 409 });
    const copy = await admin.forms.import({ ...exported, id: 'news-copy' });
    expect(copy).toMatchObject({ created: true, form: { id: 'news-copy' } });

    expect(await admin.forms.delete('news-copy')).toBe('deleted');
    expect(await admin.forms.delete('news')).toBe('archived');
    const prompts = await admin.forms.prompts('news', { platform: 'html' });
    expect(prompts.embed.html).toContain('data-helpwell-form="news"');
    expect(prompts.button).toContain('data-helpwell-form-open="news"');
  });
});
