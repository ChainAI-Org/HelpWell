/**
 * Forms in the dashboard: the list and gallery, the builder (its form read
 * back and posted the way a browser would, structural edits, errors inline,
 * saving as a new version), the preview draft, results, submissions,
 * giveaways, versions, export and import.
 */

import { createHelpWellHandler } from '@helpwell/core/api';
import type { ContentSource } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { createForm, getForm, listFormVersions } from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';

let db: Db;
let dashboard: DashboardHandler;

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: (request) => request.headers.get('x-admin') === 'yes',
  });
  await new SettingsStore(db).update({ product: { name: 'Acme', timezone: 'Europe/London' } });
});

const get = (path: string) =>
  dashboard(new Request(`${ORIGIN}${BASE}${path}`, { headers: { 'x-admin': 'yes' } }));
const page = async (path: string) => (await get(path)).text();

function post(path: string, fields: [string, string][]): Promise<Response> {
  return dashboard(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'x-admin': 'yes', origin: ORIGIN },
      body: new URLSearchParams(fields),
    }),
  );
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)(?:="([^"]*)")?/g))
    out[match[1]!] = decode(match[2] ?? '');
  return out;
}

/** The builder's fields, as a browser would submit them. */
function formFrom(html: string): [string, string][] {
  const start = html.indexOf('id="en-editor"');
  const from = html.lastIndexOf('<form', start);
  const form = html.slice(from, html.indexOf('</form>', start));
  const fields: [string, string][] = [];
  const pattern = /<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g;
  for (const match of form.matchAll(pattern)) {
    const tag = match[2] ?? 'input';
    const a = attrs((match[1] ?? match[3]) || '');
    const inner = match[4] ?? '';
    if (!a.name) continue;
    if (tag === 'input') {
      if (a.type === 'file' || a.type === 'submit') continue;
      if ((a.type === 'checkbox' || a.type === 'radio') && !('checked' in a)) continue;
      fields.push([a.name, a.value ?? '']);
    } else if (tag === 'textarea') {
      fields.push([a.name, decode(inner)]);
    } else {
      const options = [...inner.matchAll(/<option\b([^>]*)>/g)].map((o) => attrs(o[1] ?? ''));
      const chosen = options.find((o) => 'selected' in o) ?? options[0];
      fields.push([a.name, chosen?.value ?? '']);
    }
  }
  return fields;
}

const set = (fields: [string, string][], name: string, value: string): [string, string][] =>
  fields.map(([n, v]) => [n, n === name ? value : v]);

async function newForm(template = 'newsletter'): Promise<string> {
  const res = await post('/forms/new', [['template', template]]);
  expect(res.status).toBe(303);
  const location = res.headers.get('location') ?? '';
  return decodeURIComponent(location.split('/forms/')[1]!.split('?')[0]!);
}

describe('the list and the gallery', () => {
  it('is on the rail, explains itself when empty, and offers every template', async () => {
    const list = await page('/forms');
    expect(list).toContain(`href="${BASE}/forms"`);
    expect(list).toContain('No forms yet');
    const gallery = await page('/forms/new');
    for (const title of [
      'Newsletter signup',
      'Lead magnet download',
      'Discount code reveal',
      'Giveaway',
      'Waitlist',
      'Webinar signup',
      'Feedback plus email',
      'Exit-intent offer',
      'Blank form',
    ]) {
      expect(gallery).toContain(title);
    }
  });

  it('creates from a template switched off, then lists, switches on and archives it', async () => {
    const id = await newForm('waitlist');
    expect(id).toBe('waitlist');
    expect((await getForm(db, id))?.enabled).toBe(false);
    const list = await page('/forms');
    expect(list).toContain('Waitlist');
    expect(
      (
        await post(`/forms/${id}`, [
          ['action', 'toggle'],
          ['enabled', 'true'],
        ])
      ).status,
    ).toBe(303);
    expect((await getForm(db, id))?.enabled).toBe(true);
    await post(`/forms/${id}`, [['action', 'duplicate']]);
    expect(await getForm(db, 'waitlist-copy')).toMatchObject({ enabled: false });
    await post(`/forms/waitlist-copy`, [['action', 'delete']]);
    expect(await getForm(db, 'waitlist-copy')).toBeNull();
  });
});

describe('the builder', () => {
  it('lays out the form, who sees it and when, and the live preview', async () => {
    const id = await newForm('newsletter');
    const html = await page(`/forms/${id}`);
    for (const part of [
      'class="ek-editor fb-editor"',
      'class="ek-topbar"',
      'ek-types fb-types',
      'Placement',
      'Layout and style',
      'Content',
      'Fields',
      'Save changes',
      'After they submit',
      'A/B test',
      'Who sees it, and when',
      'en-rule-audience',
      'en-rule-trigger',
      'en-rule-frequency',
      'en-rule-goal',
      `src="${BASE}/forms/_preview"`,
      'data-helpwell-form=&quot;newsletter&quot;',
      'Set this up with an AI assistant',
    ]) {
      expect(html).toContain(part);
    }
    expect(await page('/forms/_preview')).toContain('/api/helpwell/assets/forms-preview.js');
  });

  it('round-trips unchanged, saves a change as a new version, and switches it on', async () => {
    const id = await newForm('newsletter');
    const fields = formFrom(await page(`/forms/${id}`));
    const before = (await getForm(db, id))!;

    const same = await post(`/forms/${id}`, [...fields, ['action', 'save']]);
    expect(same.status).toBe(303);
    expect((await getForm(db, id))?.definition).toEqual(before.definition);

    const changed = set(set(fields, 'style.buttonLabel', 'Sign me up'), 'enabled:bool', 'true');
    const saved = await post(`/forms/${id}`, [
      ...changed,
      ['enabled:bool', 'true'],
      ['action', 'save'],
    ]);
    expect(saved.status).toBe(303);
    const after = (await getForm(db, id))!;
    expect(after.definition.style.buttonLabel).toBe('Sign me up');
    expect(after.enabled).toBe(true);
    expect((await listFormVersions(db, id)).map((v) => v.version)).toEqual([2, 1]);
  });

  it('goes live and switches off from the header, saving the form as it is', async () => {
    const id = await newForm('newsletter');
    const fields = set(formFrom(await page(`/forms/${id}`)), 'style.buttonLabel', 'Count me in');
    const live = await post(`/forms/${id}`, [...fields, ['action', 'resume']]);
    expect(live.headers.get('location')).toContain('saved=live');
    expect(await getForm(db, id)).toMatchObject({
      enabled: true,
      definition: { style: { buttonLabel: 'Count me in' } },
    });
    const html = await page(`/forms/${id}?saved=live`);
    expect(html).toContain('Live for new page views now.');
    expect(html).toContain('value="pause"');

    const off = await post(`/forms/${id}`, [...formFrom(html), ['action', 'pause']]);
    expect(off.headers.get('location')).toContain('saved=paused');
    expect((await getForm(db, id))?.enabled).toBe(false);
  });

  it('re-draws after a choice that changes the fields, and comes back to it', async () => {
    const id = await newForm('newsletter');
    const fields = set(formFrom(await page(`/forms/${id}`)), 'success.action', 'download');
    const html = await (await post(`/forms/${id}`, [...fields, ['op', 'refresh|success']])).text();
    expect(html).toContain('name="success.download.url"');
    expect(html).toContain('data-focus="en-success"');
    expect(html).toContain('Not saved yet.');
  });

  it('adds a field without saving, and shows what needs fixing inline', async () => {
    const id = await newForm('newsletter');
    const fields = formFrom(await page(`/forms/${id}`));
    const added = await post(`/forms/${id}`, [...fields, ['op', 'add-field|fields|dropdown']]);
    const html = await added.text();
    expect(html).toContain('Not saved yet.');
    expect(html).toContain('name="fields.1.options:lines"');
    expect((await getForm(db, id))?.definition.fields).toHaveLength(1);

    const coupon = set(formFrom(html), 'success.action', 'coupon');
    const refused = await post(`/forms/${id}`, [...coupon, ['action', 'save']]);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Give the code to reveal.');
  });

  it('answers the preview with a draft, its summaries and the success section', async () => {
    const id = await newForm('coupon');
    const fields = formFrom(await page(`/forms/${id}`));
    const res = await post('/forms/_draft', [...set(fields, 'preview.state', 'done')]);
    const body = (await res.json()) as {
      definition: {
        id: string;
        success: { coupon: { code: string } };
        preview: { placement: string; state: string };
      };
      summaries: Record<string, string>;
      problems: number;
    };
    expect(body.definition.id).toBe(id);
    expect(body.definition.success.coupon.code).toBe('WELCOME15');
    expect(body.definition.preview).toEqual({ placement: 'popup', state: 'done' });
    expect(body.summaries.trigger).toMatch(/Pop-up/);
    expect(body.problems).toBe(0);
  });

  it('adds the form to the widget’s Home tab', async () => {
    const id = await newForm('waitlist');
    await post(`/forms/${id}`, [['action', 'add-home']]);
    const blocks = (await new SettingsStore(db).get()).widget.home.blocks;
    expect(blocks).toContainEqual({ type: 'form', formId: id });
    expect(await page(`/forms/${id}`)).toContain('This form is a block on it');
  });
});

describe('what a form collected', () => {
  async function submitted(id: string, email: string) {
    const api = createHelpWellHandler({
      db,
      support: false,
      forms: { resolveMx: async () => ['mx'] },
    });
    const call = (path: string, body: unknown) =>
      api(
        new Request(`${ORIGIN}/api/helpwell${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    const drawn = (await (
      await call(`/forms/${id}/render`, { placement: 'inline', page: { path: '/' } })
    ).json()) as { token: string };
    // A person takes a few seconds, and the token says when it was drawn.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    return call(`/forms/${id}/submit`, {
      token: drawn.token,
      answers: { email },
      page: { path: '/pricing' },
    });
  }

  it('shows results, submissions with their verdict, and a CSV', async () => {
    const form = await createForm(db, { id: 'news', name: 'News', enabled: true, definition: {} });
    expect((await submitted(form.id, 'ada@acme.test')).status).toBe(201);
    expect(await page('/forms/news/results')).toContain('Trusted sign-ups');
    const list = await page('/forms/news/submissions');
    expect(list).toContain('ada@acme.test');
    expect(list).toContain('Trusted');
    const id = /submissions\/(fsb_[a-z0-9]+)/.exec(list)?.[1];
    const detail = await page(`/forms/news/submissions/${id}`);
    expect(detail).toContain('The verdict');
    expect(detail).toContain('Time to fill in');
    const csv = await (await get('/forms/news/submissions.csv')).text();
    expect(csv).toContain('ada@acme.test');
  }, 20_000);

  it('draws giveaway winners with their record, and redraws with a reason', async () => {
    await createForm(db, {
      id: 'win',
      name: 'Win',
      enabled: true,
      definition: { type: 'giveaway', giveaway: { prize: 'Pro', rulesUrl: '/rules' } },
    });
    await submitted('win', 'one@acme.test');
    await submitted('win', 'two@acme.test');
    const drawn = await post('/forms/win/giveaway', [
      ['action', 'draw'],
      ['count', '1'],
      ['seed', 'abc'],
    ]);
    expect(drawn.status).toBe(303);
    const html = await page('/forms/win/giveaway?done=draw');
    expect(html).toContain('seed abc');
    const winner = /name="winner" value="(gvw_[a-z0-9]+)"/.exec(html)?.[1];
    await post('/forms/win/giveaway', [
      ['action', 'redraw'],
      ['winner', winner!],
      ['reason', 'No reply'],
    ]);
    const after = await page('/forms/win/giveaway');
    expect(after).toContain('Redrawn: No reply');
    expect(await (await get('/forms/win/giveaway/winners.csv')).text()).toContain('No reply');
  }, 30_000);
});

describe('uploads', () => {
  it('keeps a lead magnet and block media in the host’s content source when it has one', async () => {
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
    const hosted = createDashboard({
      db,
      basePath: BASE,
      apiPath: '/api/helpwell',
      isAdmin: () => true,
      content,
    });
    const send = async (query: string, bytes: Uint8Array, name: string) => {
      const body = new FormData();
      body.append('file', new Blob([bytes as BlobPart]), name);
      const res = await hosted(
        new Request(`${ORIGIN}${BASE}/forms/_upload${query}`, {
          method: 'POST',
          headers: { origin: ORIGIN },
          body,
        }),
      );
      return { status: res.status, body: (await res.json()) as { url?: string; error?: string } };
    };

    const guide = await send(
      '?for=download',
      new TextEncoder().encode('%PDF-1.4 guide'),
      'guide.pdf',
    );
    expect(guide.status).toBe(200);
    expect(guide.body.url).toMatch(/^upload:_forms\/[a-f0-9]{24}\.pdf$/);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const picture = await send('', png, 'hero.png');
    expect(picture.body.url).toMatch(/^\/api\/helpwell\/media\/_engage\/[a-f0-9]{24}\.png$/);
    expect([...files.keys()].sort()).toEqual(
      [
        guide.body.url!.slice('upload:'.length),
        picture.body.url!.slice('/api/helpwell/media/'.length),
      ].sort(),
    );
    expect((await send('?for=download', new TextEncoder().encode('<html>'), 'x.html')).status).toBe(
      415,
    );
  });

  it('offers an upload for the download, and saves a form that hands out an uploaded file', async () => {
    const id = await newForm('lead_magnet');
    const html = await page(`/forms/${id}`);
    expect(html).toContain(`data-ek-upload-url="${BASE}/forms/_upload?for=download"`);
    expect(html).toContain('data-ek-upload-for="success.download.url"');
    const fields = set(
      formFrom(html),
      'success.download.url',
      `upload:_forms/${'a'.repeat(24)}.pdf`,
    );
    const saved = await post(`/forms/${id}`, [...fields, ['action', 'save']]);
    expect(saved.status).toBe(303);
    expect((await getForm(db, id))?.definition.success.download.url).toBe(
      `upload:_forms/${'a'.repeat(24)}.pdf`,
    );
  });
});

describe('versions, export and import', () => {
  it('brings back an old version, exports JSON and imports it again', async () => {
    const id = await newForm('newsletter');
    const fields = formFrom(await page(`/forms/${id}`));
    await post(`/forms/${id}`, [...set(fields, 'style.buttonLabel', 'Two'), ['action', 'save']]);
    expect(await page(`/forms/${id}/versions`)).toContain('Bring back');
    await post(`/forms/${id}`, [
      ['action', 'restore'],
      ['version', '1'],
    ]);
    const restored = (await getForm(db, id))!;
    expect(restored.version).toBe(3);
    expect(restored.definition.style.buttonLabel).toBe('Subscribe');

    const exported = await (await get(`/forms/${id}/export`)).text();
    expect(JSON.parse(exported)).toMatchObject({ helpwell: 'form', id });
    const copy = exported.replace(`"id": "${id}"`, '"id": "imported"');
    const res = await post('/forms/import', [['json', copy]]);
    expect(res.headers.get('location')).toContain('/forms/imported');
    expect(await getForm(db, 'imported')).not.toBeNull();
    const again = await post('/forms/import', [['json', copy]]);
    expect(decodeURIComponent(again.headers.get('location') ?? '')).toContain('already exists');
  });
});
