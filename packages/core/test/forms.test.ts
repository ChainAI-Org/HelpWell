/**
 * Forms against a real database and the real HTTP handler: saving and
 * versioning, drawing through the engage targeting engine and cap, every
 * anti-abuse check and the stored verdict, custom fields reaching the field
 * registry, each success action, A/B attribution, giveaways and their draws,
 * analytics, the extension hook and the webhooks.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashIp } from '../src/agent/guards.js';
import type { SupportExtension } from '../src/api/support-extension.js';
import { pendingRetries } from '../src/api/support-retries.js';
import { createHelpWellHandler, type HelpWellConfig } from '../src/api.js';
import type { ContentSource } from '../src/content/source.js';
import { rowsOf } from '../src/db/rows.js';
import type { Db } from '../src/db.js';
import type { VisitContext } from '../src/engage/targeting.js';
import { listFields } from '../src/fields/registry.js';
import { formAnalytics } from '../src/forms/analytics.js';
import { checkForm } from '../src/forms/check.js';
import { claimForm, formsForVisit } from '../src/forms/display.js';
import { storeFormFile } from '../src/forms/files.js';
import { drawWinners, listWinners, redrawWinner, weightedPicks } from '../src/forms/giveaway.js';
import { parseFormDefinition } from '../src/forms/schema.js';
import {
  signRenderToken,
  verifyDownload,
  verifyEntryKey,
  verifyRenderToken,
} from '../src/forms/tokens.js';
import { assignVariant, compareVariants, zTestConfidence } from '../src/forms/variants.js';
import { createContact, deleteContact, getContact } from '../src/repos/contacts.js';
import { withinLimits } from '../src/repos/engage.js';
import {
  createForm,
  exportForm,
  getForm,
  getFormVersion,
  importForm,
  listFormVersions,
  restoreFormVersion,
  saveForm,
} from '../src/repos/forms.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const ADMIN = 'forms-admin-token';
const START = new Date('2026-10-01T12:00:00Z');

let t: TestDb;
let db: Db;
let clock: Date;

const resolveMx = async (domain: string) => (domain.startsWith('nomx.') ? [] : [`mx.${domain}`]);

function handler(extra: Partial<HelpWellConfig> = {}) {
  return createHelpWellHandler({
    db,
    adminToken: ADMIN,
    support: false,
    now: () => clock,
    forms: { resolveMx },
    ...extra,
  });
}

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  clock = new Date(START);
  for (const table of [
    'forms',
    'form_views',
    'form_viewers',
    'form_submissions',
    'giveaway_entries',
    'giveaway_referrals',
    'giveaway_winners',
    'engage_impressions',
    'rate_counters',
    'support_retries',
    'webhook_deliveries',
    'contact_tags',
  ]) {
    await db.execute(sql.raw(`DELETE FROM helpwell.${table}`));
  }
  await db.execute(sql`DELETE FROM helpwell.contacts`);
  await db.execute(sql`DELETE FROM helpwell.contact_fields WHERE source <> 'helpwell'`);
  await new SettingsStore(db).update({
    webhooks: [],
    engage: { engagements: [], limits: {} },
    agent: {
      abuse: { blockDisposableEmail: true, blockedDomains: [], blockedIps: [], botCheck: 'off' },
    },
  });
});

const later = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

async function live(input: Record<string, unknown> = {}, definition: Record<string, unknown> = {}) {
  return createForm(
    db,
    { id: 'news', name: 'Newsletter', enabled: true, definition, ...input },
    { now: clock },
  );
}

async function render(c: Client, id: string, body: Record<string, unknown> = {}) {
  const res = await c.call(`/forms/${id}/render`, {
    body: { placement: 'inline', page: { path: '/blog', url: 'https://acme.test/blog' }, ...body },
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown> & { token?: string },
  };
}

async function submit(
  c: Client,
  id: string,
  token: string | undefined,
  answers: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const res = await c.call(`/forms/${id}/submit`, {
    body: { token, answers, page: { path: '/blog', url: 'https://acme.test/blog' }, ...extra },
  });
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON shapes
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** Draw, wait like a person, submit. */
async function fill(
  c: Client,
  id: string,
  answers: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const drawn = await render(c, id);
  expect(drawn.body.shown).toBe(true);
  later(6);
  return submit(c, id, drawn.body.token, answers, extra);
}

async function submissions() {
  return rowsOf<{
    id: string;
    status: string;
    trusted: boolean;
    reasons: string[];
    verdict: Record<string, unknown>;
    contact_id: string | null;
    variant: string;
    email: string;
    fields: Record<string, unknown>;
  }>(await db.execute(sql`SELECT * FROM helpwell.form_submissions ORDER BY id`));
}

/* ------------------------------------------------------------------ builder */

describe('saving and versions', () => {
  it('creates version 1 and saves each change as the next version', async () => {
    const form = await live();
    expect(form.version).toBe(1);
    expect(form.definition.fields[0]).toMatchObject({ kind: 'email', required: true });

    const changed = await saveForm(db, form.id, {
      definition: { ...form.definition, style: { ...form.definition.style, buttonLabel: 'Join' } },
    });
    expect(changed.changed).toBe(true);
    expect(changed.form.version).toBe(2);

    const same = await saveForm(db, form.id, { definition: changed.form.definition });
    expect(same.changed).toBe(false);
    expect((await listFormVersions(db, form.id)).map((v) => v.version)).toEqual([2, 1]);
    expect((await getFormVersion(db, form.id, 1))?.definition.style.buttonLabel).toBe('Subscribe');
  });

  it('refuses a save made from an older copy', async () => {
    const form = await live();
    await saveForm(db, form.id, { definition: { ...form.definition, priority: 5 } });
    await expect(
      saveForm(db, form.id, {
        definition: { ...form.definition, priority: 9 },
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses an incomplete form, naming the field', async () => {
    await expect(
      live({}, { fields: [{ id: 'name', kind: 'name', label: 'Name' }] }),
    ).rejects.toMatchObject({
      details: { problems: [expect.objectContaining({ path: 'fields' })] },
    });
    const problems = checkForm(
      parseFormDefinition({
        type: 'giveaway',
        success: { action: 'coupon' },
        fields: [
          { id: 'email', kind: 'email', label: 'Email', required: true },
          { id: 'pick', kind: 'dropdown', label: 'Pick' },
        ],
      }),
    );
    expect(problems.map((p) => p.path)).toEqual(
      expect.arrayContaining([
        'fields.1.options',
        'success.coupon.code',
        'giveaway.prize',
        'giveaway.rulesUrl',
      ]),
    );
  });

  it('round-trips through export and import, and restores an old version as a new one', async () => {
    const form = await live({ template: 'waitlist' });
    const exported = await exportForm(db, form.id);
    expect(exported).toMatchObject({ helpwell: 'form', id: 'news', formatVersion: 1 });
    await expect(importForm(db, exported)).rejects.toMatchObject({ code: 'conflict' });

    const copy = await importForm(db, { ...exported, id: 'news-copy' });
    expect(copy.created).toBe(true);
    expect(copy.form.definition).toEqual(form.definition);

    await saveForm(db, form.id, { definition: { ...form.definition, priority: 3 } });
    const overwritten = await importForm(db, exported, { overwrite: true });
    expect(overwritten.form.version).toBe(3);
    expect(overwritten.form.definition.priority).toBe(0);

    const restored = await restoreFormVersion(db, form.id, 2);
    expect(restored?.form.version).toBe(4);
    expect(restored?.form.definition.priority).toBe(3);
  });

  it('serves the admin API: create from a template, list, patch, export', async () => {
    const admin = client(handler(), { adminToken: ADMIN });
    const created = await admin.call('/admin/forms', { body: { template: 'coupon' } });
    expect(created.status).toBe(201);
    const form = (await created.json()) as { id: string; version: number };
    expect(form.id).toBe('welcome-discount');

    const patched = await admin.call(`/admin/forms/${form.id}`, {
      method: 'PATCH',
      body: { enabled: true, name: 'Ten off' },
    });
    expect(await patched.json()).toMatchObject({ enabled: true, name: 'Ten off', version: 1 });

    const list = (await (await admin.call('/admin/forms')).json()) as { items: { id: string }[] };
    expect(list.items.map((i) => i.id)).toEqual(['welcome-discount']);
    const exported = await admin.call(`/admin/forms/${form.id}/export`);
    expect(exported.headers.get('content-disposition')).toContain('form-welcome-discount.json');

    const prompts = (await (await admin.call(`/admin/forms/${form.id}/prompts`)).json()) as {
      embed: Record<string, string>;
      button: string;
    };
    expect(prompts.embed.html).toContain('data-helpwell-form="welcome-discount"');
    expect(prompts.embed.wordpress).toContain('Custom HTML');
    expect(prompts.button).toContain('data-helpwell-form-open="welcome-discount"');
    expect(prompts.button).toContain('Forms');
  });
});

/* ---------------------------------------------------------------- targeting */

function visit(patch: Partial<VisitContext> = {}): VisitContext {
  return {
    path: '/pricing',
    referrer: '',
    utm: {},
    device: 'desktop',
    language: 'en',
    contactId: null,
    identified: false,
    now: clock,
    ...patch,
  };
}

describe('triggers, through the engage engine', () => {
  it('offers a popup only where its page and audience rules match', async () => {
    const form = await live(
      {},
      {
        placements: { display: 'popup' },
        targeting: { pages: { include: ['/pricing'] }, audience: 'anonymous' },
      },
    );
    expect((await formsForVisit(db, [form], visit())).map((f) => f.id)).toEqual(['news']);
    expect(await formsForVisit(db, [form], visit({ path: '/docs' }))).toEqual([]);
    expect(await formsForVisit(db, [form], visit({ identified: true }))).toEqual([]);
    // An embed is where the page asked for it: its pages rule does not apply.
    expect(
      await claimForm(db, form, 'inline', visit({ path: '/docs' }), {
        engage: { engagements: [], limits: { perSession: 0, perDay: 0, minMinutesBetween: 0 } },
      }),
    ).toEqual({ shown: true });
  });

  it('claims a popup once, and shares the global cap with engagements', async () => {
    const contactId = await createContact(db, { source: 'widget' });
    const form = await live({}, { placements: { display: 'popup' }, frequency: 'once' });
    const engage = { engagements: [], limits: { perSession: 0, perDay: 1, minMinutesBetween: 0 } };
    const at = visit({ contactId });
    expect(await claimForm(db, form, 'popup', at, { engage })).toEqual({ shown: true });
    // Once per person: frequency, read from the impressions table.
    const again = await live({ id: 'other' }, { placements: { display: 'popup' } });
    expect(
      await claimForm(db, form, 'popup', at, {
        engage: { ...engage, limits: { perSession: 0, perDay: 0, minMinutesBetween: 0 } },
      }),
    ).toEqual({ shown: false, reason: 'frequency' });
    // One a day: the second form is over the cap.
    expect(await claimForm(db, again, 'popup', at, { engage })).toEqual({
      shown: false,
      reason: 'limit',
    });
    // And an engagement asking counts the form too.
    expect(
      await withinLimits(db, engage.limits, {
        contactId,
        sessionId: null,
        engagementIds: ['modal-1'],
        now: clock,
      }),
    ).toBe(false);
    // Asked for by the page (a two-step button), the cap does not apply.
    expect(await claimForm(db, again, 'popup', at, { engage, manual: true })).toEqual({
      shown: true,
    });
  });

  it('lists popups over HTTP, and keeps them from people who already subscribed', async () => {
    await live({}, { placements: { display: 'popup' }, suppressSubscribed: true });
    const visitor = client(handler());
    const listed = await visitor.call('/forms/display?path=/pricing&device=desktop');
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(1);
    const config = (await (await visitor.call('/config')).json()) as {
      forms: { triggered: boolean };
    };
    expect(config.forms.triggered).toBe(true);

    expect((await fill(visitor, 'news', { email: 'ada@acme.test' })).status).toBe(201);
    const after = await visitor.call('/forms/display?path=/pricing&device=desktop');
    expect(((await after.json()) as { items: unknown[] }).items).toHaveLength(0);
    const popup = await render(visitor, 'news', { placement: 'popup' });
    expect(popup.body).toEqual({ shown: false, reason: 'subscribed' });
    // An embed shows them the thank-you state instead.
    const inline = await render(visitor, 'news');
    expect(inline.body.state).toMatchObject({ submitted: true });
  });

  it('remembers a dismissed popup', async () => {
    await live({}, { placements: { display: 'popup' }, frequency: 'always' });
    const visitor = client(handler());
    expect((await render(visitor, 'news', { placement: 'popup' })).body.shown).toBe(true);
    await visitor.call('/forms/news/dismiss', { body: { url: '/pricing' } });
    expect((await render(visitor, 'news', { placement: 'popup' })).body).toEqual({
      shown: false,
      reason: 'frequency',
    });
  });
});

/* --------------------------------------------------------------- anti-abuse */

describe('anti-abuse and the verdict', () => {
  it('refuses a submission with no render token, and counts it as blocked', async () => {
    await live();
    const visitor = client(handler());
    const none = await submit(visitor, 'news', undefined, { email: 'ada@acme.test' });
    expect(none.status).toBe(403);
    expect(none.body.error.details.formToken).toBe('missing');
    const forged = await submit(visitor, 'news', 'v1.eyJmIjoibmV3cyJ9.bm9wZQ', {
      email: 'ada@acme.test',
    });
    expect(forged.body.error.details.formToken).toBe('signature');
    // A real token for another form does not carry over.
    const other = await signRenderToken(db, {
      formId: 'else',
      version: 1,
      variant: 'a',
      placement: 'inline',
      page: '/',
    });
    expect(
      (await submit(visitor, 'news', other, { email: 'ada@acme.test' })).body.error.details
        .formToken,
    ).toBe('wrong_form');
    expect(await submissions()).toEqual([]);
    const analytics = await formAnalytics(db, (await getForm(db, 'news'))!, {
      from: new Date(0),
      to: clock,
    });
    expect(analytics.totals.blocked).toBe(3);
    expect(analytics.rejections).toContainEqual(
      expect.objectContaining({ reason: 'no_token', count: 3 }),
    );
  });

  it('refuses an expired token', async () => {
    await live();
    const visitor = client(handler());
    const drawn = await render(visitor, 'news');
    later(25 * 3600);
    const late = await submit(visitor, 'news', drawn.body.token, { email: 'ada@acme.test' });
    expect(late.status).toBe(403);
    expect(late.body.error.details.formToken).toBe('expired');
  });

  it('accepts a clean submission as trusted, and stores the verdict', async () => {
    await live();
    const visitor = client(handler());
    const done = await fill(visitor, 'news', { email: 'Ada@Acme.test' });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ ok: true, status: 'accepted' });
    const [row] = await submissions();
    expect(row).toMatchObject({ status: 'accepted', trusted: true, email: 'ada@acme.test' });
    expect(row!.verdict).toMatchObject({
      turnstile: 'off',
      honeypot: false,
      fillMs: 6000,
      tooFast: false,
      rateLimited: false,
      disposable: false,
      mx: 'ok',
      duplicate: false,
      trusted: true,
      reasons: [],
    });
    expect(visitor.jar.some((c) => c.startsWith('hw_visitor='))).toBe(true);
  });

  it('rejects the honeypot and a too-fast fill silently, touching no contact', async () => {
    await live();
    const bot = client(handler());
    const trapped = await fill(
      bot,
      'news',
      { email: 'bot@acme.test' },
      { honeypot: 'http://spam' },
    );
    expect(trapped.status).toBe(201);
    expect(trapped.body.status).toBe('received');

    const drawn = await render(bot, 'news');
    later(1);
    const fast = await submit(bot, 'news', drawn.body.token, { email: 'fast@acme.test' });
    expect(fast.body.status).toBe('received');
    expect(fast.body.success.coupon).toBeUndefined();

    const rows = await submissions();
    expect(rows.map((r) => [r.status, r.trusted, r.reasons])).toEqual([
      ['rejected', false, ['honeypot']],
      ['rejected', false, ['too_fast']],
    ]);
    expect(rows.every((r) => r.contact_id === null)).toBe(true);
    expect(rowsOf(await db.execute(sql`SELECT id FROM helpwell.contacts`))).toEqual([]);
  });

  it('tells a person about a throwaway address, a blocked domain and a domain with no mail server', async () => {
    await new SettingsStore(db).update({
      agent: { abuse: { blockDisposableEmail: true, blockedDomains: ['spam.test'] } },
    });
    await live();
    const visitor = client(handler());
    const throwaway = await fill(visitor, 'news', { email: 'x@mailinator.com' });
    expect(throwaway.status).toBe(400);
    expect(throwaway.body.error.details.fields.email).toMatch(/keep/);
    const blocked = await fill(visitor, 'news', { email: 'x@spam.test' });
    expect(blocked.status).toBe(400);
    const noMx = await fill(visitor, 'news', { email: 'x@nomx.test' });
    expect(noMx.body.error.message).toMatch(/cannot receive mail/);
    expect((await submissions()).map((r) => r.reasons)).toEqual([
      ['disposable'],
      ['blocked_domain'],
      ['no_mx'],
    ]);
  });

  it('accepts a throwaway address when they are allowed, but never trusts it', async () => {
    await new SettingsStore(db).update({ agent: { abuse: { blockDisposableEmail: false } } });
    await live();
    const done = await fill(client(handler()), 'news', { email: 'x@mailinator.com' });
    expect(done.body.status).toBe('accepted');
    expect((await submissions())[0]).toMatchObject({ status: 'accepted', trusted: false });
  });

  it('rejects a blocked address, and rate limits one address then refuses a flood', async () => {
    await live({}, { abuse: { perIpPerHour: 2, minFillSeconds: 0 } });
    await new SettingsStore(db).update({ agent: { abuse: { blockedIps: ['203.0.113.'] } } });
    const blockedIp = await fill(client(handler(), { ip: '203.0.113.9' }), 'news', {
      email: 'a@acme.test',
    });
    expect(blockedIp.status).toBe(400);
    expect((await submissions())[0]?.reasons).toEqual(['blocked_ip']);

    const busy = client(handler(), { ip: '198.51.100.7' });
    const statuses: (string | number)[] = [];
    for (let i = 0; i < 7; i++) {
      const result = await fill(busy, 'news', { email: `p${i}@acme.test` });
      statuses.push(result.status === 201 ? result.body.status : result.status);
    }
    // Two accepted, then soft-limited (stored, rejected), then refused outright.
    expect(statuses).toEqual([
      'accepted',
      'accepted',
      'received',
      'received',
      'received',
      'received',
      429,
    ]);
    const reasons = (await submissions()).filter((r) => r.reasons.includes('rate_limited'));
    expect(reasons).toHaveLength(4);
  });

  it('needs the bot check when it is on', async () => {
    await live();
    const verify = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    const guarded = handler({
      turnstile: {
        enabled: true,
        secret: 'secret',
        siteKey: 'site',
        fetch: verify as unknown as typeof fetch,
      },
    });
    const visitor = client(guarded);
    const missing = await fill(visitor, 'news', { email: 'a@acme.test' });
    expect(missing.status).toBe(403);
    expect(missing.body.error.details.humanCheck).toBe('missing');
    const passed = await fill(visitor, 'news', { email: 'a@acme.test' }, { turnstileToken: 'ok' });
    expect(passed.status).toBe(201);
    expect((await submissions())[0]?.verdict.turnstile).toBe('passed');
  });

  it('marks a repeat as a duplicate, and answers a replayed token with the first result', async () => {
    await live({}, { success: { action: 'coupon', coupon: { code: 'TEN' } } });
    const visitor = client(handler());
    const drawn = await render(visitor, 'news');
    later(5);
    const first = await submit(visitor, 'news', drawn.body.token, { email: 'ada@acme.test' });
    const replay = await submit(visitor, 'news', drawn.body.token, { email: 'ada@acme.test' });
    expect(replay.body.submissionId).toBe(first.body.submissionId);
    expect(replay.body.success.coupon.code).toBe('TEN');

    const again = await fill(client(handler()), 'news', { email: 'ADA@acme.test' });
    expect(again.body.status).toBe('duplicate');
    expect((await submissions()).map((r) => r.status)).toEqual(['accepted', 'duplicate']);
  });

  it('checks the answers against the fields', async () => {
    await live(
      {},
      {
        fields: [
          { id: 'email', kind: 'email', label: 'Email', required: true },
          { id: 'plan', kind: 'dropdown', label: 'Plan', options: ['Free', 'Pro'], required: true },
          { id: 'agree', kind: 'consent', label: 'I agree', required: true, save: false },
        ],
      },
    );
    const wrong = await fill(client(handler()), 'news', { email: 'nope', plan: 'Gold' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.fields).toEqual({
      email: expect.any(String),
      plan: 'Pick one of the options.',
      agree: 'Tick this box to continue.',
    });
    expect(await submissions()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ contacts */

describe('contacts and the field registry', () => {
  it('saves answers on the contact as typed custom fields', async () => {
    await live(
      {},
      {
        fields: [
          { id: 'email', kind: 'email', label: 'Email', required: true },
          { id: 'first_name', kind: 'first_name', label: 'First name' },
          { id: 'last_name', kind: 'last_name', label: 'Last name' },
          { id: 'seats', kind: 'number', label: 'Seats' },
          { id: 'starts', kind: 'date', label: 'Start date' },
          { id: 'topics', kind: 'checkbox', label: 'Topics', options: ['Billing', 'API'] },
          { id: 'beta', kind: 'checkbox', label: 'Join the beta' },
          {
            id: 'role',
            kind: 'radio',
            label: 'Role',
            options: ['Dev', 'PM'],
            attribute: 'job_role',
          },
          { id: 'campaign', kind: 'hidden', capture: 'utm_campaign' },
          { id: 'agree', kind: 'consent', label: 'Email me updates', save: false },
        ],
        tags: ['newsletter'],
      },
    );
    const done = await fill(
      client(handler()),
      'news',
      {
        email: 'ada@acme.test',
        first_name: 'Ada',
        last_name: 'Lovelace',
        seats: '12',
        starts: '2026-11-01',
        topics: ['API', 'Other'],
        beta: true,
        role: 'Dev',
        agree: true,
      },
      { page: { path: '/blog', utm: { campaign: 'launch' } } },
    );
    expect(done.status).toBe(201);
    const [row] = await submissions();
    const contact = (await getContact(db, row!.contact_id!))!;
    expect(contact).toMatchObject({
      email: 'ada@acme.test',
      name: 'Ada Lovelace',
      consent: 'granted',
      source: 'form',
    });
    expect(contact.attributes).toMatchObject({
      first_name: 'Ada',
      seats: 12,
      starts: '2026-11-01',
      topics: ['API'],
      beta: true,
      job_role: 'Dev',
      campaign: 'launch',
    });
    expect(contact.tags).toContain('newsletter');
    const types = Object.fromEntries(
      (await listFields(db)).map((f) => [f.key, [f.type, f.source]]),
    );
    expect(types).toMatchObject({
      seats: ['number', 'form'],
      starts: ['date', 'form'],
      topics: ['list', 'form'],
      beta: ['boolean', 'form'],
      job_role: ['text', 'form'],
    });
  });

  it('never rewrites someone else’s contact from a stranger’s browser', async () => {
    const victim = await createContact(db, {
      source: 'identify',
      email: 'owner@acme.test',
      identified: true,
      attributes: { plan: 'pro' },
    });
    await live(
      {},
      {
        fields: [
          { id: 'email', kind: 'email', label: 'Email', required: true },
          { id: 'plan', kind: 'text', label: 'Plan' },
          { id: 'agree', kind: 'consent', label: 'Yes', save: false },
        ],
      },
    );
    const stranger = client(handler());
    const done = await fill(stranger, 'news', {
      email: 'owner@acme.test',
      plan: 'free',
      agree: true,
    });
    expect(done.status).toBe(201);
    const contact = (await getContact(db, victim))!;
    expect(contact.attributes.plan).toBe('pro');
    expect(contact.consent).toBe('unknown');
    expect((await submissions())[0]?.contact_id).toBe(victim);
    // And the stranger's browser is not handed the owner's visitor cookie.
    expect(stranger.jar.some((c) => c === `hw_visitor=${victim}`)).toBe(false);
  });

  it('erases a person’s submissions and entries with them', async () => {
    await live();
    await fill(client(handler()), 'news', { email: 'gone@acme.test' });
    const [row] = await submissions();
    await deleteContact(db, row!.contact_id!);
    expect(await submissions()).toEqual([]);
  });

  it('counts a person’s forms and giveaway entries in the contacts CSV, and exports the rows', async () => {
    await live();
    await live({ id: 'win', name: 'Win a year' }, giveaway);
    const visitor = client(handler(), { ip: '192.0.2.10' });
    await fill(visitor, 'news', { email: 'ada@acme.test' });
    const entered = await fill(visitor, 'win', { email: 'ada@acme.test' });
    await visitor.call('/forms/win/giveaway/action', {
      body: { entryKey: entered.body.giveaway.entryKey, actionId: 'follow' },
    });
    // A repeat is a duplicate and a trapped bot is rejected: neither counts.
    expect((await fill(client(handler()), 'news', { email: 'ada@acme.test' })).body.status).toBe(
      'duplicate',
    );
    await fill(client(handler()), 'news', { email: 'Ada@acme.test' }, { honeypot: 'x' });
    // Someone else, to show the counts are per person.
    await fill(client(handler()), 'news', { email: 'bea@acme.test' });

    const ada = (await submissions()).find((r) => r.email === 'ada@acme.test')!.contact_id!;
    const [lastAccepted] = rowsOf<{ at: string | Date }>(
      await db.execute(sql`
        SELECT max(created_at) AS at FROM helpwell.form_submissions
        WHERE contact_id = ${ada} AND status = 'accepted'
      `),
    );
    const csv = await (
      await client(handler(), { adminToken: ADMIN }).call('/admin/contacts.csv')
    ).text();
    const [header, ...lines] = csv.trim().split('\n');
    expect(header!.split(',').slice(-4)).toEqual([
      'forms_submitted',
      'last_form_submitted_at',
      'giveaways_entered',
      'giveaway_entries',
    ]);
    expect(lines.find((line) => line.startsWith(`${ada},`))).toMatch(
      new RegExp(`,2,${new Date(lastAccepted!.at).toISOString()},1,2$`),
    );
    expect(lines.find((line) => line.includes('bea@acme.test'))).toMatch(/,1,[^,]+,0,0$/);

    const dump = (await (
      await client(handler(), { adminToken: ADMIN }).call(`/admin/contacts/${ada}/export`)
    ).json()) as {
      notes: Record<string, string>;
      formSubmissions: Record<string, unknown>[];
      giveawayEntries: Record<string, unknown>[];
    };
    // Everything erasure would remove, including the rejected one typed with their address.
    expect(dump.formSubmissions.map((s) => [s.form_id, s.status])).toEqual([
      ['news', 'accepted'],
      ['win', 'accepted'],
      ['news', 'duplicate'],
      ['news', 'rejected'],
    ]);
    expect(dump.formSubmissions[1]).toMatchObject({ form_name: 'Win a year' });
    // The hashed IP is still held about them, so it is in the export, and
    // the export says what it is. The raw address never was stored.
    expect(dump.formSubmissions[0]?.ip_address_hash).toBe(await hashIp(db, '192.0.2.10'));
    expect(dump.formSubmissions[0]?.ip_address_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(dump)).not.toContain('192.0.2.10');
    expect(dump.notes['formSubmissions.ip_address_hash']).toBe(
      "A keyed one-way hash of the IP address the form was sent from, kept to spot repeated abuse; it cannot be reversed without this install's secret. The address itself is never stored.",
    );
    expect(dump.formSubmissions[0]).not.toHaveProperty('ip_hash');
    expect(dump.formSubmissions[0]).not.toHaveProperty('verdict');
    expect(dump.formSubmissions[0]).not.toHaveProperty('token_nonce');
    expect(dump.giveawayEntries).toHaveLength(1);
    expect(dump.giveawayEntries[0]).toMatchObject({
      form_id: 'win',
      email: 'ada@acme.test',
      entries: 2,
      won: false,
    });
  });
});

/* ------------------------------------------------------------ success actions */

describe('success actions', () => {
  it('sends the message, a redirect, a chat or the next form', async () => {
    const visitor = client(handler());
    await live(
      { id: 'msg' },
      { success: { action: 'message', blocks: [{ type: 'text', markdown: 'Thanks!' }] } },
    );
    expect((await fill(visitor, 'msg', { email: 'a@acme.test' })).body.success).toEqual({
      action: 'message',
      blocks: [{ type: 'text', markdown: 'Thanks!' }],
    });
    await live({ id: 'go' }, { success: { action: 'redirect', redirectUrl: '/welcome' } });
    expect((await fill(visitor, 'go', { email: 'b@acme.test' })).body.success.redirectUrl).toBe(
      '/welcome',
    );
    await live({ id: 'talk' }, { success: { action: 'chat' } });
    expect((await fill(visitor, 'talk', { email: 'c@acme.test' })).body.success.action).toBe(
      'chat',
    );
    await live({ id: 'next' }, { success: { action: 'form', formId: 'msg' } });
    expect((await fill(visitor, 'next', { email: 'd@acme.test' })).body.success.formId).toBe('msg');
  });

  it('reveals a coupon code only after an accepted submission', async () => {
    await live({}, { success: { action: 'coupon', coupon: { code: 'WELCOME15' } } });
    const visitor = client(handler());
    const drawn = await render(visitor, 'news');
    expect(JSON.stringify(drawn.body)).not.toContain('WELCOME15');
    later(5);
    const done = await submit(visitor, 'news', drawn.body.token, { email: 'a@acme.test' });
    expect(done.body.success.coupon).toEqual({ code: 'WELCOME15', label: 'Your code' });
  });

  it('hands out a signed download link that expires', async () => {
    await live(
      {},
      {
        success: {
          action: 'download',
          download: { url: 'https://files.acme.test/guide.pdf', expiresHours: 2 },
        },
      },
    );
    const visitor = client(handler());
    const drawn = await render(visitor, 'news');
    expect(JSON.stringify(drawn.body)).not.toContain('guide.pdf');
    later(5);
    const done = await submit(visitor, 'news', drawn.body.token, { email: 'a@acme.test' });
    const path = done.body.success.download.path as string;
    expect(path).toMatch(/^\/forms\/news\/download\/fsb_[^?]+\?exp=\d+&sig=/);

    const followed = await visitor.call(path);
    expect(followed.status).toBe(302);
    expect(followed.headers.get('location')).toBe('https://files.acme.test/guide.pdf');

    const tampered = await visitor.call(path.replace(/sig=.{4}/, 'sig=AAAA'));
    expect(tampered.status).toBe(404);
    later(3 * 3600);
    expect((await visitor.call(path)).status).toBe(403);
    const url = new URL(`http://x${path}`);
    expect(
      await verifyDownload(
        db,
        {
          formId: 'news',
          submissionId: path.split('/')[4]!.split('?')[0]!,
          exp: url.searchParams.get('exp'),
          sig: url.searchParams.get('sig'),
        },
        START.getTime(),
      ),
    ).toBe('ok');
  });

  it('keeps an uploaded lead magnet in the content source, and hands it out only by the signed link', async () => {
    const files = new Map<string, Uint8Array>();
    const content: ContentSource = {
      list: async () => [],
      read: async (path) => files.get(path) ?? null,
      readText: async () => null,
      write: async (path, data) => {
        files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
      },
      stat: async () => null,
    };
    const pdf = new TextEncoder().encode('%PDF-1.7\nthe guide\n%%EOF');
    const stored = await storeFormFile(new Blob([pdf]), { content });
    expect(stored).toMatchObject({ ok: true, type: 'application/pdf' });
    const ref = (stored as { ref: string }).ref;
    expect(ref).toMatch(/^upload:_forms\/[a-f0-9]{24}\.pdf$/);
    expect([...files.keys()]).toEqual([ref.slice('upload:'.length)]);
    // The same bytes twice are one file.
    expect(await storeFormFile(new Blob([pdf]), { content })).toMatchObject({ ref });
    expect(await storeFormFile(new Blob(['<svg onload="x()"></svg>']), { content })).toMatchObject({
      ok: false,
      status: 415,
    });

    const definition = parseFormDefinition({
      success: { action: 'download', download: { url: ref, label: 'The guide' } },
    });
    expect(checkForm(definition).filter((p) => p.path.startsWith('success'))).toEqual([]);
    await live({}, { success: { action: 'download', download: { url: ref, label: 'The guide' } } });

    const visitor = client(handler({ content }));
    const drawn = await render(visitor, 'news');
    expect(JSON.stringify(drawn.body)).not.toContain('_forms');
    later(5);
    const done = await submit(visitor, 'news', drawn.body.token, { email: 'a@acme.test' });
    const got = await visitor.call(done.body.success.download.path as string);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(got.headers.get('content-disposition')).toBe('attachment; filename="The guide.pdf"');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(pdf);
    // Not served anywhere else.
    expect((await visitor.call(`/media/${ref.slice('upload:'.length)}`)).status).toBe(404);
  });
});

/* ------------------------------------------------------------------------ A/B */

describe('A/B variants', () => {
  it('splits traffic by weight, keeps each visitor on one variant, and attributes submissions', async () => {
    const definition = parseFormDefinition({
      variants: [
        { id: 'a', weight: 75 },
        { id: 'b', weight: 25, content: { blocks: [{ type: 'text', markdown: 'B wins' }] } },
      ],
    });
    const counts = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 4000; i++) counts[assignVariant(definition, 'news', `visitor-${i}`)]!++;
    expect(counts.a! / 4000).toBeGreaterThan(0.7);
    expect(counts.a! / 4000).toBeLessThan(0.8);
    expect(assignVariant(definition, 'news', 'visitor-9')).toBe(
      assignVariant(definition, 'news', 'visitor-9'),
    );

    await live({}, definition);
    const people = Array.from({ length: 12 }, (_, i) => `browser-${String(i).padStart(4, '0')}`);
    for (const [i, person] of people.entries()) {
      const c = client(handler());
      const drawn = await render(c, 'news', { visitor: person });
      const expected = assignVariant(definition, 'news', `b:${person}`);
      expect(drawn.body.variant).toBe(expected);
      if (expected === 'b') expect(JSON.stringify(drawn.body.form)).toContain('B wins');
      if (i % 2 === 0) {
        later(5);
        await submit(c, 'news', drawn.body.token, { email: `p${i}@acme.test` });
      }
    }
    const rows = await submissions();
    for (const row of rows) expect(['a', 'b']).toContain(row.variant);
    const analytics = await formAnalytics(db, (await getForm(db, 'news'))!, {
      from: new Date(0),
      to: clock,
    });
    const total = analytics.variants.reduce((sum, v) => sum + v.uniques, 0);
    expect(total).toBe(12);
    expect(analytics.variants.reduce((sum, v) => sum + v.submissions, 0)).toBe(6);
    expect(analytics.verdict?.note).toBeTruthy();
  });

  it('only calls a winner with enough data and a real difference', () => {
    const early = compareVariants([
      { variant: 'a', name: '', views: 10, uniques: 10, submissions: 2, conversionRate: 0.2 },
      { variant: 'b', name: '', views: 10, uniques: 10, submissions: 4, conversionRate: 0.4 },
    ]);
    expect(early).toMatchObject({ leader: 'b', significant: false });
    expect(early.note).toMatch(/too early/);
    const clear = compareVariants([
      {
        variant: 'a',
        name: 'Control',
        views: 1000,
        uniques: 1000,
        submissions: 50,
        conversionRate: 0.05,
      },
      {
        variant: 'b',
        name: 'Bold',
        views: 1000,
        uniques: 1000,
        submissions: 90,
        conversionRate: 0.09,
      },
    ]);
    expect(clear).toMatchObject({ leader: 'b', significant: true });
    expect(clear.note).toMatch(/Bold converts better than Control by 80%/);
    expect(zTestConfidence(50, 1000, 50, 1000)).toBeCloseTo(0, 5);
  });
});

/* ------------------------------------------------------------------ giveaways */

const giveaway = {
  type: 'giveaway',
  fields: [{ id: 'email', kind: 'email', label: 'Email', required: true }],
  giveaway: {
    prize: 'A year of Pro',
    rulesUrl: 'https://acme.test/rules',
    maxEntries: 5,
    referralEntries: 2,
    actions: [
      { id: 'follow', kind: 'follow', label: 'Follow us', url: 'https://x.com/acme', entries: 1 },
    ],
  },
};

describe('giveaways', () => {
  it('credits a referrer only for trusted entries, up to the cap', async () => {
    await new SettingsStore(db).update({ agent: { abuse: { blockDisposableEmail: false } } });
    await live({ id: 'win' }, giveaway);
    const referrer = await fill(client(handler()), 'win', { email: 'host@acme.test' });
    const code = referrer.body.giveaway.referralCode as string;
    expect(referrer.body.giveaway).toMatchObject({ entries: 1, maxEntries: 5, referrals: 0 });

    // A throwaway address is accepted, but untrusted: no credit.
    await fill(client(handler()), 'win', { email: 'x@mailinator.com' }, { ref: code });
    const one = await fill(client(handler()), 'win', { email: 'friend1@acme.test' }, { ref: code });
    expect(one.body.giveaway.entries).toBe(1);
    await fill(client(handler()), 'win', { email: 'friend2@acme.test' }, { ref: code });
    await fill(client(handler()), 'win', { email: 'friend3@acme.test' }, { ref: code });
    // Self-referral earns nothing.
    await fill(client(handler()), 'win', { email: 'host@acme.test' }, { ref: code });

    const [host] = rowsOf<{ entries: number; bonus_referrals: number }>(
      await db.execute(
        sql`SELECT entries, bonus_referrals FROM helpwell.giveaway_entries WHERE email = 'host@acme.test'`,
      ),
    );
    expect(host).toEqual({ entries: 5, bonus_referrals: 3 });
    const referrals = rowsOf<{ credited: boolean }>(
      await db.execute(
        sql`SELECT credited FROM helpwell.giveaway_referrals ORDER BY created_at, id`,
      ),
    );
    expect(referrals.map((r) => r.credited).sort()).toEqual([false, true, true, true]);

    const analytics = await formAnalytics(db, (await getForm(db, 'win'))!, {
      from: new Date(0),
      to: clock,
    });
    expect(analytics.giveaway).toMatchObject({
      entrants: 5,
      trustedEntrants: 4,
      referrals: 4,
      creditedReferrals: 3,
    });
    expect(analytics.giveaway?.viralCoefficient).toBeCloseTo(0.75);
  });

  it('lets an entrant claim a bonus action once, with their entry key', async () => {
    await live({ id: 'win' }, giveaway);
    const visitor = client(handler());
    const entered = await fill(visitor, 'win', { email: 'ada@acme.test' });
    const key = entered.body.giveaway.entryKey as string;
    expect(await verifyEntryKey(db, key)).toBe(entered.body.giveaway.entryId);
    const claim = () =>
      visitor.call('/forms/win/giveaway/action', { body: { entryKey: key, actionId: 'follow' } });
    // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON shapes
    expect(((await (await claim()).json()) as any).giveaway).toMatchObject({ entries: 2 });
    // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON shapes
    expect(((await (await claim()).json()) as any).giveaway).toMatchObject({ entries: 2 });
    const forged = await visitor.call('/forms/win/giveaway/action', {
      body: { entryKey: `${entered.body.giveaway.entryId}.forged`, actionId: 'follow' },
    });
    expect(forged.status).toBe(403);
  });

  it('refuses entries outside the giveaway’s dates', async () => {
    await live(
      { id: 'win' },
      { ...giveaway, giveaway: { ...giveaway.giveaway, endsAt: '2026-09-30T00:00:00Z' } },
    );
    const late = await fill(client(handler()), 'win', { email: 'ada@acme.test' });
    expect(late.status).toBe(400);
    expect(late.body.error.message).toMatch(/ended/);
  });

  it('draws deterministically from the seed and weights, and audits a redraw', async () => {
    const form = await live({ id: 'win' }, giveaway);
    for (let i = 0; i < 8; i++) await fill(client(handler()), 'win', { email: `p${i}@acme.test` });
    await db.execute(
      sql`UPDATE helpwell.giveaway_entries SET entries = 5 WHERE email = 'p3@acme.test'`,
    );
    await db.execute(
      sql`UPDATE helpwell.giveaway_entries SET trusted = false WHERE email = 'p5@acme.test'`,
    );

    const candidates = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 5 },
      { id: 'c', weight: 1 },
    ];
    const once = await weightedPicks(candidates, 2, 'seed-1');
    expect(await weightedPicks(candidates, 2, 'seed-1')).toEqual(once);
    let heavy = 0;
    for (let i = 0; i < 300; i++)
      if ((await weightedPicks(candidates, 1, `s${i}`))[0]!.id === 'b') heavy++;
    expect(heavy / 300).toBeGreaterThan(0.6);

    const draw = await drawWinners(db, form, { count: 2, seed: 'fixed-seed' });
    expect(draw.snapshotSize).toBe(7); // the untrusted entry is not in the draw
    expect(draw.totalWeight).toBe(11);
    expect(draw.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(draw.winners.map((w) => w.email)).not.toContain('p5@acme.test');

    // The same seed over the same entries picks the same people.
    await db.execute(sql`DELETE FROM helpwell.giveaway_winners`);
    const repeat = await drawWinners(db, form, { count: 2, seed: 'fixed-seed' });
    expect(repeat.winners.map((w) => w.entryId)).toEqual(draw.winners.map((w) => w.entryId));
    expect(repeat.snapshotHash).toBe(draw.snapshotHash);

    const first = repeat.winners[0]!;
    const { redrawn, replacement } = await redrawWinner(
      db,
      form,
      first.id,
      'Did not reply in 7 days',
    );
    expect(redrawn).toMatchObject({
      status: 'redrawn',
      reason: 'Did not reply in 7 days',
      replacedBy: replacement.id,
    });
    expect(replacement).toMatchObject({
      status: 'selected',
      replaces: first.id,
      position: first.position,
    });
    expect(replacement.entryId).not.toBe(first.entryId);
    expect((await listWinners(db, 'win')).map((w) => w.status).sort()).toEqual([
      'redrawn',
      'selected',
      'selected',
    ]);
    await expect(redrawWinner(db, form, first.id, 'again')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('exports entrants and winners as CSV over the admin API', async () => {
    await live({ id: 'win' }, giveaway);
    await fill(client(handler()), 'win', { email: '=cmd@acme.test' });
    const admin = client(handler(), { adminToken: ADMIN });
    await admin.call('/admin/forms/win/giveaway/draw', { body: { count: 1, seed: 's' } });
    const entrants = await (await admin.call('/admin/forms/win/giveaway/entrants.csv')).text();
    expect(entrants.split('\n')[0]).toContain('entries,referrals');
    expect(entrants).toContain("'=cmd@acme.test");
    const winners = await (await admin.call('/admin/forms/win/giveaway/winners.csv')).text();
    expect(winners).toContain('snapshot_hash');
    expect(winners.split('\n').filter(Boolean)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ analytics */

describe('analytics', () => {
  it('counts views, uniques, conversion, pages, referrers and rejections', async () => {
    await live();
    const a = client(handler());
    await render(a, 'news', { visitor: 'browser-aaaa1' });
    await render(a, 'news', { visitor: 'browser-aaaa1' });
    const b = client(handler());
    const drawn = await render(b, 'news', { visitor: 'browser-bbbb2', page: { path: '/pricing' } });
    later(5);
    await submit(
      b,
      'news',
      drawn.body.token,
      { email: 'b@acme.test' },
      {
        page: { path: '/pricing', referrer: 'https://news.example/post' },
      },
    );
    await fill(client(handler()), 'news', { email: 'c@acme.test' }, { honeypot: 'x' });

    const analytics = await formAnalytics(db, (await getForm(db, 'news'))!, {
      from: new Date(0),
      to: clock,
    });
    expect(analytics.totals).toMatchObject({
      views: 4,
      uniques: 3,
      trusted: 1,
      rejected: 1,
      accepted: 1,
    });
    expect(analytics.totals.conversionRate).toBeCloseTo(1 / 3);
    expect(analytics.pages.find((p) => p.page === '/pricing')).toMatchObject({
      views: 1,
      trusted: 1,
    });
    expect(analytics.placements).toEqual([
      expect.objectContaining({ placement: 'inline', views: 4 }),
    ]);
    expect(analytics.referrers).toContainEqual({
      referrer: 'news.example',
      submissions: 1,
      trusted: 1,
    });
    expect(analytics.rejections).toEqual([
      expect.objectContaining({ reason: 'honeypot', count: 1 }),
    ]);
    expect(analytics.daily).toEqual([
      expect.objectContaining({ day: '2026-10-01', views: 4, uniques: 3, trusted: 1 }),
    ]);

    const admin = client(handler(), { adminToken: ADMIN });
    const listed = (await (
      await admin.call('/admin/forms/news/submissions?status=rejected')
    ).json()) as {
      items: { reasons: string[] }[];
    };
    expect(listed.items.map((i) => i.reasons)).toEqual([['honeypot']]);
    const csv = await (await admin.call('/admin/forms/news/submissions.csv')).text();
    expect(csv.split('\n')[0]).toContain('field:email');
    expect(csv).toContain('b@acme.test');
  });
});

/* ---------------------------------------------------------- hook and webhooks */

describe('the extension hook', () => {
  it('fires only for trusted submissions, from the durable queue, and retries a failure', async () => {
    let healthy = false;
    const formSubmitted = vi.fn(async (_submission: unknown) => {
      if (!healthy) throw new Error('down');
    });
    const extension = {
      afterReply: async () => {},
      handleMessage: async () => null,
      handoff: async () => {},
      thread: async () => null,
      formSubmitted,
    } satisfies SupportExtension;
    const silent = { warn: () => {} };
    await live();
    const withHook = handler({ support: extension });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fill(client(withHook), 'news', { email: 'bot@acme.test' }, { honeypot: 'yes' });
    await fill(client(withHook), 'news', { email: 'ada@acme.test' });
    await vi.waitFor(() => expect(formSubmitted).toHaveBeenCalledTimes(1));
    // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON shapes
    const event = formSubmitted.mock.calls[0]![0] as unknown as Record<string, any>;
    expect(event).toMatchObject({
      formId: 'news',
      formType: 'custom',
      email: 'ada@acme.test',
      placement: 'inline',
      variant: 'a',
      consent: { state: 'none' },
      verdict: { trusted: true },
      page: { path: '/blog' },
    });
    expect(event.contactId).toMatch(/^con_/);
    // It failed, so it waits in the queue, keyed on the submission.
    await vi.waitFor(async () =>
      expect((await pendingRetries(db)).map((r) => r.key)).toEqual([event.id]),
    );

    healthy = true;
    clock = new Date(clock.getTime() + 10 * 60_000);
    const { failOpenSupport } = await import('../src/api/fail-open.js');
    const replayer = failOpenSupport(extension, { db, logger: silent, now: () => clock });
    expect(await replayer.drainRetries()).toBe(1);
    expect(formSubmitted).toHaveBeenLastCalledWith(expect.objectContaining({ id: event.id }));
    expect(await pendingRetries(db)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('never keeps the visitor waiting for the extension', async () => {
    let resolved = false;
    const extension = {
      afterReply: async () => {},
      handleMessage: async () => null,
      handoff: async () => {},
      thread: async () => null,
      formSubmitted: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 8000),
        ),
    } satisfies SupportExtension;
    await live();
    const done = await fill(client(handler({ support: extension })), 'news', {
      email: 'ada@acme.test',
    });
    expect(done.status).toBe(201);
    expect(resolved).toBe(false);
  });
});

describe('webhooks', () => {
  it('sends form.submitted and giveaway.entered', async () => {
    const sent: { event: string; data: Record<string, unknown> }[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(String((init as RequestInit).body)));
      return new Response('ok');
    });
    await new SettingsStore(db).update({
      webhooks: [
        { url: 'https://hooks.acme.test/in', events: ['form.submitted', 'giveaway.entered'] },
      ],
    });
    await live({ id: 'win' }, giveaway);
    // Caught on the stand-in global fetch: the webhook guard is off, as for local development.
    await fill(client(handler({ webhookFetch: false })), 'win', { email: 'ada@acme.test' });
    fetchSpy.mockRestore();
    expect(sent.map((s) => s.event)).toEqual(['form.submitted', 'giveaway.entered']);
    expect(sent[0]!.data).toMatchObject({ formId: 'win', email: 'ada@acme.test', trusted: true });
    expect(sent[1]!.data).toMatchObject({ formId: 'win', entries: 1, trusted: true });
  });
});

describe('render tokens', () => {
  it('sign what was drawn and refuse any change to it', async () => {
    const token = await signRenderToken(db, {
      formId: 'news',
      version: 2,
      variant: 'b',
      placement: 'popup',
      page: '/pricing',
      issuedAt: START.getTime(),
    });
    const ok = await verifyRenderToken(db, token, { formId: 'news', now: START.getTime() + 1000 });
    expect(ok).toMatchObject({
      ok: true,
      claims: { version: 2, variant: 'b', placement: 'popup', page: '/pricing' },
    });
    const [v, body, sig] = token.split('.');
    const altered = Buffer.from(body!, 'base64url').toString().replace('"b"', '"a"');
    const forged = `${v}.${Buffer.from(altered).toString('base64url')}.${sig}`;
    expect(await verifyRenderToken(db, forged, { formId: 'news' })).toEqual({
      ok: false,
      problem: 'signature',
    });
  });
});
