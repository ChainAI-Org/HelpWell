/**
 * Engage in the dashboard: the list, the template gallery, the editor (its
 * form round-tripping through settings, errors inline, structural edits),
 * the preview's draft endpoint, uploads, and results.
 *
 * The round trip reads the editor's own HTML back into a form and posts it,
 * the way a browser would, so a field the editor draws and the parser cannot
 * read (or the other way round) fails here.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModel } from '@helpwell/core/agent';
import { createMemoryContentSource } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import {
  createContact,
  parseEngagement,
  recordImpression,
  recordSurveyResponse,
} from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENGAGE_JS } from '../src/client/engage.js';
import { clientScriptFile } from '../src/client/index.js';
import { applyOp } from '../src/engage/draft.js';
import { formToObject, isoToZoned, zonedToIso } from '../src/engage/form.js';
import { TEMPLATES } from '../src/engage/templates.js';
import { createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';

let db: Db;
let dashboard: DashboardHandler;
let docs: string;

beforeEach(async () => {
  const handle = await freshDb();
  db = handle.db;
  docs = await mkdtemp(join(tmpdir(), 'hw-engage-'));
  dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    docsDir: docs,
  });
  await new SettingsStore(db).update({ product: { name: 'Acme', timezone: 'Europe/London' } });
});

afterEach(async () => {
  await rm(docs, { recursive: true, force: true });
});

const get = (path: string) =>
  dashboard(new Request(`${ORIGIN}${BASE}${path}`, { headers: { 'x-admin': 'yes' } }));

const page = async (path: string) => (await get(path)).text();

function post(path: string, fields: [string, string][] | FormData): Promise<Response> {
  const body = fields instanceof FormData ? fields : new URLSearchParams(fields);
  return dashboard(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'x-admin': 'yes', origin: ORIGIN },
      body,
    }),
  );
}

async function engagements() {
  return (await new SettingsStore(db).get()).engage.engagements;
}

async function seed(...items: Record<string, unknown>[]) {
  await new SettingsStore(db).update({ engage: { engagements: items } });
}

/* ------------------------------------------------- reading the editor back */

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
    out[match[1]!] = decode(match[2] ?? '');
  }
  return out;
}

/** The editor form's fields, as a browser would submit them. */
function formFrom(html: string): [string, string][] {
  const start = html.indexOf('<form method="post"');
  const form = html.slice(start, html.indexOf('</form>', start));
  const fields: [string, string][] = [];
  const pattern = /<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g;
  for (const match of form.matchAll(pattern)) {
    const tag = match[2] ?? 'input';
    const a = attrs((match[1] ?? match[3]) || '');
    const inner = match[4] ?? '';
    if (!a.name) continue;
    if (tag === 'input') {
      if (a.type === 'file') continue;
      if ((a.type === 'checkbox' || a.type === 'radio') && !('checked' in a)) continue;
      if (a.type === 'submit') continue;
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

/* ------------------------------------------------------------------- list */

describe('the list', () => {
  it('explains where engagements come from when there are none, and edits the global settings', async () => {
    const html = await page('/engage');
    expect(html).toContain('Nothing set up yet');
    expect(html).toContain('helpwell.config.json');
    expect(html).toContain('data-patch="engage.enabled"');
    expect(html).toContain('data-patch="engage.limits.perSession"');
    expect(html).toContain('data-patch="engage.limits.perDay"');
    expect(html).toContain('data-patch="engage.limits.minMinutesBetween"');
    expect(html).toContain('data-setting="engage.engagements"');
  });

  it('lists a first-version config, upgraded, with its type, schedule and stats', async () => {
    await seed(
      { id: 'welcome-tour', kind: 'tour', title: 'Welcome', steps: [{ target: '#nav' }] },
      { id: 'pulse', kind: 'survey', name: 'Pulse', enabled: false },
    );
    await recordImpression(db, {
      engagementId: 'welcome-tour',
      contactId: null,
      state: 'seen',
      step: 1,
    });
    const html = await page('/engage');
    expect(html).toContain('Welcome');
    expect(html).toContain('welcome-tour');
    expect(html).toContain('Tour');
    expect(html).toContain('Always');

    const tours = await page('/engage?kind=tour');
    expect(tours).toContain('welcome-tour');
    expect(tours).not.toContain('Pulse');
    expect(await page('/engage?q=puls')).not.toContain('welcome-tour');
  });

  it('says so when engage is switched off', async () => {
    await new SettingsStore(db).update({ engage: { enabled: false } });
    expect(await page('/engage')).toContain('Engage is switched off');
  });

  it('switches one on and off, duplicates it switched off, and deletes it', async () => {
    await seed({ id: 'hello', kind: 'modal', name: 'Hello', title: 'Hi' });

    const off = await post('/engage/hello', [['action', 'toggle']]);
    expect(off.status).toBe(303);
    expect((await engagements())[0]?.enabled).toBe(false);
    await post('/engage/hello', [
      ['action', 'toggle'],
      ['enabled', 'true'],
    ]);
    expect((await engagements())[0]?.enabled).toBe(true);

    const copy = await post('/engage/hello', [['action', 'duplicate']]);
    expect(copy.headers.get('location')).toBe(`${BASE}/engage/hello-copy?saved=copy`);
    expect((await engagements()).map((e) => [e.id, e.name, e.enabled])).toEqual([
      ['hello', 'Hello', true],
      ['hello-copy', 'Copy of Hello', false],
    ]);

    await post('/engage/hello', [['action', 'delete']]);
    expect((await engagements()).map((e) => e.id)).toEqual(['hello-copy']);
  });
});

/* ---------------------------------------------------------------- gallery */

describe('creating from a template', () => {
  it('offers a template for every type, and a blank one', async () => {
    const html = await page('/engage/new');
    for (const key of [
      'announcement',
      'feature-launch',
      'nps',
      'onboarding-tour',
      'maintenance-banner',
      'new-feature-hotspot',
    ]) {
      expect(html).toContain(`template=${key}`);
    }
    for (const kind of ['modal', 'banner', 'hotspot', 'tour', 'survey']) {
      expect(html).toContain(`template=blank-${kind}`);
    }
  });

  it.each(TEMPLATES.map((t) => [t.key]))(
    'saves the %s template through its own form, and saves it again unchanged',
    async (key) => {
      const created = await page(`/engage/new?template=${key}`);
      const form = set(formFrom(created), 'id', `made-${key}`);
      const saved = await post('/engage/new', [...form, ['action', 'save']]);
      expect(saved.status, await saved.clone().text()).toBe(303);
      expect(saved.headers.get('location')).toBe(`${BASE}/engage/made-${key}?saved=1`);

      const [first] = await engagements();
      const template = TEMPLATES.find((t) => t.key === key)!;
      expect(first).toEqual(
        parseEngagement({ ...template.definition, kind: template.kind, id: `made-${key}` }),
      );

      // The editor for the saved one posts back exactly what is stored.
      const editor = await page(`/engage/made-${key}`);
      expect(editor).toContain('Saved');
      const again = await post(`/engage/made-${key}`, [...formFrom(editor), ['action', 'save']]);
      expect(again.status).toBe(303);
      expect((await engagements())[0]).toEqual(first);
    },
  );
});

/* ----------------------------------------------------------------- editor */

describe('the editor', () => {
  it('saves targeting, trigger, schedule and frequency from the form', async () => {
    const form = formFrom(await page('/engage/new?template=announcement'));
    const edited = [
      ...set(
        set(
          set(
            set(set(form, 'id', 'launch'), 'triggers.0.type', 'delay'),
            'triggers.0.seconds:num',
            '3',
          ),
          'frequencyMode',
          'every',
        ),
        'frequencyDays:num',
        '14',
      ).filter(([name]) => !name.startsWith('targeting.rules.0') && name !== 'schedule.start'),
      ['targeting.rules.0.field', 'plan'],
      ['targeting.rules.0.op', 'is'],
      ['targeting.rules.0.value', 'pro'],
      ['targeting.rules.0.window', ''],
      ['schedule.start', '2026-07-01T09:00'],
      ['action', 'save'],
    ] as [string, string][];
    const response = await post('/engage/new', edited);
    expect(response.status, await response.clone().text()).toBe(303);

    const [saved] = await engagements();
    expect(saved?.triggers).toEqual([{ type: 'delay', seconds: 3 }]);
    expect(saved?.frequency).toEqual({ everyDays: 14 });
    expect(saved?.targeting.conditions).toEqual({
      all: [{ field: 'plan', op: 'is', value: 'pro' }],
    });
    // 09:00 in London in July is 08:00 UTC.
    expect(saved?.schedule.start).toBe('2026-07-01T08:00:00.000Z');
    expect(await page('/engage/launch')).toContain('value="2026-07-01T09:00"');
  });

  it('shows problems next to their fields, keeps what was typed, and saves nothing', async () => {
    const form = formFrom(await page('/engage/new?template=announcement'));
    const broken = set(
      set(
        set(form, 'id', 'broken'),
        'modal.slides.0.blocks.1.buttons.0.value',
        'javascript:alert(1)',
      ),
      'priority:num',
      'lots',
    );
    const response = await post('/engage/new', [...broken, ['action', 'save']]);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('things need fixing before this can be saved');
    expect(html).toMatch(
      /data-invalid="true">[\s\S]*?name="modal\.slides\.0\.blocks\.1\.buttons\.0\.value" value="javascript:alert\(1\)"[\s\S]*?Use an https:\/\/ address/,
    );
    expect(html).toMatch(/name="priority:num" value="lots"[\s\S]*?Enter a number\./);
    expect(await engagements()).toEqual([]);
  });

  it('refuses an id that is taken', async () => {
    await seed({ id: 'taken', kind: 'banner', title: 'x' });
    const form = set(formFrom(await page('/engage/new?template=announcement')), 'id', 'taken');
    const response = await post('/engage/new', [...form, ['action', 'save']]);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Another engagement already uses this id.');
  });

  it('adds, moves and removes blocks and slides without saving', async () => {
    const form = set(formFrom(await page('/engage/new?template=announcement')), 'id', 'draft');
    const added = await post('/engage/new', [
      ...form,
      ['op', 'add-block|modal.slides.0.blocks|image'],
    ]);
    expect(added.status).toBe(200);
    const html = await added.text();
    expect(html).toContain('Not saved yet.');
    expect(html).toContain('name="modal.slides.0.blocks.2.url"');
    expect(html).toContain('data-focus="en-modal.slides.0.blocks.2"');

    const moved = await post('/engage/new', [
      ...formFrom(html),
      ['op', 'up|modal.slides.0.blocks.2'],
    ]);
    expect(await moved.clone().text()).toMatch(
      /name="modal\.slides\.0\.blocks\.1\.type" value="image"/,
    );

    const slide = await post('/engage/new', [
      ...formFrom(await moved.text()),
      ['op', 'add-slide|modal.slides'],
    ]);
    const withSlide = await slide.text();
    expect(withSlide).toContain('Slide 2');
    const removed = await post('/engage/new', [
      ...formFrom(withSlide),
      ['op', 'remove|modal.slides.1'],
    ]);
    expect(await removed.text()).not.toContain('Slide 2');
    expect(await engagements()).toEqual([]);
  });

  it('builds a branching survey with the question and branch buttons', async () => {
    let html = await page('/engage/new?template=blank-survey');
    html = await (
      await post('/engage/new', [...formFrom(html), ['op', 'add-question|survey.questions|single']])
    ).text();
    html = await (
      await post('/engage/new', [
        ...formFrom(html),
        ['op', 'add-branch|survey.questions.0.branches'],
      ])
    ).text();
    let form = set(
      set(formFrom(html), 'id', 'branchy'),
      'survey.questions.0.prompt',
      'Recommend us?',
    );
    form = set(
      set(form, 'survey.questions.0.branches.0.min:num', '0'),
      'survey.questions.0.branches.0.max:num',
      '6',
    );
    form = set(
      set(form, 'survey.questions.0.branches.0.goto', 'q2'),
      'survey.questions.1.prompt',
      'Why?',
    );
    const response = await post('/engage/new', [...form, ['action', 'save']]);
    expect(response.status, await response.clone().text()).toBe(303);
    const [survey] = await engagements();
    expect(survey?.kind === 'survey' && survey.survey.questions).toMatchObject([
      {
        id: 'q1',
        kind: 'nps',
        prompt: 'Recommend us?',
        branches: [{ min: 0, max: 6, goto: 'q2' }],
      },
      { id: 'q2', kind: 'single', prompt: 'Why?', choices: ['Option 1', 'Option 2'] },
    ]);
  });

  it('offers the AI-assistant prompt for code triggers', async () => {
    const html = await page('/engage/new?template=announcement');
    expect(html).toContain('data-for-trigger="event"');
    expect(html).toContain('Set this up with an AI assistant');
    expect(html).toContain('helpwell.engage.show');
  });
});

/* ---------------------------------------------------------------- preview */

describe('the layout', () => {
  const order = (html: string, ...marks: string[]) =>
    marks.map((mark) => {
      const at = html.indexOf(mark);
      if (at === -1) throw new Error(`not on the page: ${mark}`);
      return at;
    });

  it('puts the type first, then its look, then its content, then who sees it and when, then the preview', async () => {
    const html = await page('/engage/new?template=announcement');
    const at = order(
      html,
      'class="ek-types"',
      '>Layout and size<',
      '>Slides<',
      'Who sees it, and when',
      'aria-label="Live preview"',
    );
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(html).toMatch(/aria-current="true"[^>]*>[\s\S]*?Modal/);
    // Every look option is one click away, and posts like a select.
    expect(html).toContain('name="modal.mediaPosition" value="top" checked');
    expect(html).toContain('name="modal.progress" value="dots" checked');
    for (const key of ['audience', 'trigger', 'frequency', 'goal']) {
      expect(html).toContain(`data-summary="${key}"`);
    }
    expect(html).toContain('Anything left closed keeps its setting.');
    // Who can see it: one click away, as a segmented control.
    expect(html).toMatch(
      /name="targeting\.audience" value="all" checked[^>]*><span class="ek-seg__label">Everyone</,
    );
    expect(html).toMatch(
      /name="targeting\.audience" value="identified"[^>]*><span class="ek-seg__label">Signed in</,
    );
    expect(html).toMatch(
      /name="targeting\.audience" value="anonymous"[^>]*><span class="ek-seg__label">Anonymous</,
    );
    // Save sits in the header too, outside the form it submits.
    expect(html).toMatch(/<button[^>]*form="en-editor"[^>]*name="action" value="save"/);
  });

  it('keeps a tour step to its own tooltip and how it moves on, under the tour’s look', async () => {
    const html = await page('/engage/new?template=onboarding-tour');
    const at = order(html, '>Look and placement<', 'Tooltips sit', '>Steps<');
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(html).toContain('name="tour.placement" value="auto" checked');
    expect(html).toContain('This step’s tooltip');
    // The welcome step has no placement of its own; the next one does.
    expect(html).toContain('name="tour.steps.0.placement" value="tour" checked');
    expect(html).toContain('name="tour.steps.1.placement" value="right" checked');
    expect(html).toContain('name="tour.steps.2.advance" value="click" checked');
  });

  it('saves the look options: a bar survey in dark, and a counted carousel', async () => {
    const survey = set(
      set(
        set(formFrom(await page('/engage/new?template=nps')), 'id', 'look-s'),
        'survey.placement',
        'bar',
      ),
      'survey.theme',
      'dark',
    );
    expect((await post('/engage/new', [...survey, ['action', 'save']])).status).toBe(303);
    const modal = set(
      set(formFrom(await page('/engage/new?template=feature-launch')), 'id', 'look-m'),
      'modal.progress',
      'count',
    );
    expect((await post('/engage/new', [...modal, ['action', 'save']])).status).toBe(303);
    const [s, m] = await engagements();
    expect(s).toMatchObject({ survey: { placement: 'bar', theme: 'dark' } });
    expect(m).toMatchObject({ modal: { progress: 'count' } });
  });

  it('sums each rule up in a line, counts who matches now, and shows how it is doing', async () => {
    await createContact(db, { source: 'identify', identified: true, attributes: { plan: 'pro' } });
    await createContact(db, { source: 'identify', identified: true, attributes: { plan: 'free' } });
    await createContact(db, { source: 'widget' });
    await seed({
      id: 'pricing',
      kind: 'banner',
      banner: { blocks: [{ type: 'text', markdown: 'Hi' }] },
      targeting: {
        audience: 'identified',
        pages: { include: ['/pricing'] },
        devices: ['desktop'],
      },
      trigger: { type: 'scroll', percent: 60 },
      frequency: { everyDays: 7 },
    });
    await recordImpression(db, { engagementId: 'pricing', state: 'seen', contactId: null });
    await new SettingsStore(db).update({ engage: { limits: { perSession: 1 } } });

    const html = await page('/engage/pricing');
    expect(html).toContain('Signed-in people on /pricing, on desktop');
    expect(html).toContain('2 match now');
    expect(html).toContain('At 60% scroll');
    expect(html).toContain('Again every 7 days');
    expect(html).toContain('at most 1 per visit');
    expect(html).toContain('Performance · last 30 days');
    // Closed until something in it needs fixing.
    expect(html).not.toMatch(/id="en-rule-audience" open/);
  });

  it('sends the summaries back with every preview draft', async () => {
    const form = set(
      set(
        set(formFrom(await page('/engage/new?template=announcement')), 'id', 'sum'),
        'triggers.0.type',
        'scroll',
      ),
      'triggers.0.percent:num',
      '40',
    );
    const data = (await (await post('/engage/_draft', form)).json()) as {
      summaries: Record<string, string>;
    };
    expect(data.summaries.trigger).toBe('at 40% scroll');
    expect(data.summaries.audience).toBe('Everyone');
  });
});

describe('the live preview', () => {
  it('serves the frame page with the widget renderer and a stand-in element', async () => {
    const response = await get('/engage/_preview');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const html = await response.text();
    expect(html).toContain('src="/api/helpwell/assets/engage-preview.js"');
    expect(html).toContain('data-helpwell-stand-in');
  });

  it('turns the form into the definition the frame draws, without the targeting', async () => {
    const form = set(formFrom(await page('/engage/new?template=announcement')), 'id', 'preview-me');
    const response = await post(
      '/engage/_draft',
      set(form, 'modal.slides.0.blocks.0.markdown', 'Draft text'),
    );
    expect(response.headers.get('content-type')).toContain('application/json');
    const { definition, problems } = (await response.json()) as {
      definition: Record<string, unknown>;
      problems: number;
    };
    expect(problems).toBe(0);
    expect(definition).toMatchObject({
      id: 'preview-me',
      kind: 'modal',
      modal: {
        slides: [{ blocks: [{ type: 'text', markdown: 'Draft text' }, { type: 'buttons' }] }],
      },
    });
    expect(definition).not.toHaveProperty('targeting');
  });

  it('refuses a draft from another site', async () => {
    const response = await dashboard(
      new Request(`${ORIGIN}${BASE}/engage/_draft`, {
        method: 'POST',
        headers: { 'x-admin': 'yes', origin: 'https://evil.example' },
        body: new URLSearchParams({ kind: 'modal' }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

/* ---------------------------------------------------------------- uploads */

describe('uploads', () => {
  it('stores an image with the docs, named by its bytes, and gives back its media URL', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const body = new FormData();
    body.append('file', new Blob([png], { type: 'image/png' }), 'launch.png');
    const response = await post('/engage/_upload', body);
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(/^\/api\/helpwell\/media\/_engage\/[0-9a-f]{24}\.png$/);
    expect(await readdir(join(docs, '_engage'))).toEqual([url.split('/').pop()]);
  });

  it('refuses what is not an image or video, whatever it is called', async () => {
    const body = new FormData();
    body.append('file', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/png' }), 'x.png');
    const response = await post('/engage/_upload', body);
    expect(response.status).toBe(415);
  });
});

/* ---------------------------------------------------------------- results */

describe('results', () => {
  it('shows counts, the survey breakdown and responses, and exports them', async () => {
    await seed({
      id: 'pulse',
      kind: 'survey',
      name: 'Pulse',
      survey: { questions: [{ id: 'score', kind: 'nps', prompt: 'Recommend us?' }] },
    });
    await recordImpression(db, { engagementId: 'pulse', contactId: null, state: 'seen' });
    await recordImpression(db, { engagementId: 'pulse', contactId: null, state: 'completed' });
    await recordSurveyResponse(db, {
      surveyId: 'pulse',
      sessionId: 's1',
      questionId: 'score',
      kind: 'nps',
      score: 10,
      comment: 'Lovely',
    });

    const html = await page('/engage/pulse/results?range=7d');
    expect(html).toContain('Impressions');
    expect(html).toContain('100.0%');
    expect(html).toContain('Promoters');
    expect(html).toContain('Lovely');
    expect(html).toContain('/engage/pulse/responses.csv?range=7d');

    const csv = await get('/engage/pulse/responses.csv');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('s1,');
  });

  it('shows where people leave a tour', async () => {
    await seed({ id: 'walk', kind: 'tour', steps: [{ target: '#a' }, { target: '#b' }] });
    await recordImpression(db, { engagementId: 'walk', contactId: null, state: 'seen', step: 1 });
    const html = await page('/engage/walk/results');
    expect(html).toContain('Drop-off by step');
    expect(html).toContain('Step 2');
  });
});

/* ------------------------------------------------------------- the parser */

describe('reading the form', () => {
  it('builds nested objects and arrays from typed names', () => {
    const form = new FormData();
    form.append('name', 'Hi');
    form.append('priority:num', '5');
    form.append('frequencyDays:num', '');
    form.append('enabled:bool', 'false');
    form.append('enabled:bool', 'true');
    form.append('targeting.pages.include:lines', '/app/**\n\n/pricing');
    form.append('targeting.devices:arr', '');
    form.append('targeting.devices:arr', 'mobile');
    form.append('modal.slides.0.blocks.0.markdown', 'Hello');
    form.append('__proto__.polluted', 'yes');
    expect(formToObject(form)).toEqual({
      name: 'Hi',
      priority: 5,
      enabled: true,
      targeting: { pages: { include: ['/app/**', '/pricing'] }, devices: ['mobile'] },
      modal: { slides: [{ blocks: [{ markdown: 'Hello' }] }] },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps the line endings a browser posts out of what it stores', () => {
    // A form sends a textarea's line breaks as CRLF. Settings are synced to
    // a repo, so a Windows ending on every edit would be churn in every diff.
    const form = new FormData();
    form.set('modal.slides.0.blocks.0.markdown', '## Title\r\n\r\nFirst line.\r\nSecond.');
    form.set('targeting.pages.include:lines', '/app/**\r\n/pricing');
    expect(formToObject(form)).toEqual({
      modal: { slides: [{ blocks: [{ markdown: '## Title\n\nFirst line.\nSecond.' }] }] },
      targeting: { pages: { include: ['/app/**', '/pricing'] } },
    });
  });

  it('converts a date-time box in the product’s zone, both ways', () => {
    expect(zonedToIso('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
    expect(isoToZoned('2026-01-15T14:00:00.000Z', 'America/New_York')).toBe('2026-01-15T09:00');
    expect(zonedToIso('2026-01-15T09:00', undefined)).toBe('2026-01-15T09:00:00.000Z');
  });

  it('applies structural edits and ignores unknown ones', () => {
    const raw: Record<string, unknown> = { tour: { steps: [{ target: '#a' }, { target: '#b' }] } };
    expect(applyOp(raw, 'down|tour.steps.0')).toBe('tour.steps.1');
    expect((raw.tour as { steps: { target: string }[] }).steps.map((s) => s.target)).toEqual([
      '#b',
      '#a',
    ]);
    expect(applyOp(raw, 'remove|tour.steps.0')).toBe('tour.steps');
    expect(applyOp(raw, 'explode|tour')).toBeNull();
  });
});

/* ------------------------------------------------ the editor, as designed */

describe('the editor, drawn with the editor kit', () => {
  it('draws the top bar, the icon header cards, the composer and media blocks', async () => {
    await seed({
      id: 'hello',
      kind: 'modal',
      name: 'Hello',
      modal: {
        slides: [
          {
            blocks: [
              { type: 'image', url: '/api/helpwell/media/_engage/a.png', alt: 'A picture' },
              { type: 'text', markdown: '### Hi\n\nWelcome **in**.' },
            ],
          },
        ],
      },
    });
    const html = await page('/engage/hello');
    // The top bar: where it is, whether it is live, and its buttons.
    expect(html).toContain('<h1 class="ek-crumb__title">Hello</h1>');
    expect(html).toMatch(/class="ek-state ek-state--good">Live</);
    expect(html).toMatch(/<button[^>]*form="en-editor"[^>]*name="action" value="pause"/);
    expect(html).toContain('window.helpwell?.engage?.show(&#39;hello&#39;)');
    // Cards with the design's icon headers.
    expect(html).toMatch(
      /ek-glyph ek-tone--peach[\s\S]*?<h2 class="ek-card__title">Layout and size<\/h2>/,
    );
    // Text in the composer, over its Markdown; the image as a media block.
    expect(html).toContain(
      '<textarea class="ek-composer__source" name="modal.slides.0.blocks.1.markdown"',
    );
    expect(html).toContain('<h3>Hi</h3><p>Welcome <strong>in</strong>.</p>');
    expect(html).toContain('<img src="/api/helpwell/media/_engage/a.png"');
    expect(html).toMatch(/data-ek-okdot/);
    // Switches, not checkboxes.
    expect(html).toMatch(
      /class="ek-toggle"[^>]*><input type="hidden" name="enabled:bool" value="false">/,
    );
    // The preview, loading until the widget says it is ready, and how it is doing.
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('Performance · last 30 days');
  });

  it('pauses and puts live again from the header, saving the form as it goes', async () => {
    await seed({ id: 'hello', kind: 'modal', name: 'Hello', title: 'Hi' });
    const form = formFrom(await page('/engage/hello'));
    const paused = await post('/engage/hello', [
      ...set(form, 'name', 'Renamed'),
      ['action', 'pause'],
    ]);
    expect(paused.headers.get('location')).toBe(`${BASE}/engage/hello?saved=paused`);
    expect((await engagements())[0]).toMatchObject({ enabled: false, name: 'Renamed' });
    const after = await page('/engage/hello?saved=paused');
    expect(after).toMatch(/ek-state--neutral">Paused</);
    expect(after).toContain('value="resume"');

    const live = await post('/engage/hello', [...formFrom(after), ['action', 'resume']]);
    expect(live.headers.get('location')).toBe(`${BASE}/engage/hello?saved=live`);
    expect((await engagements())[0]?.enabled).toBe(true);
  });

  it('saves a banner’s position and style from the one tile that sets both', async () => {
    const form = set(
      set(formFrom(await page('/engage/new?template=maintenance-banner')), 'id', 'placed'),
      'bannerPlacement',
      'bottom|floating',
    );
    expect((await post('/engage/new', [...form, ['action', 'save']])).status).toBe(303);
    expect((await engagements())[0]).toMatchObject({
      banner: { position: 'bottom', style: 'floating' },
    });
    expect(await page('/engage/placed')).toContain(
      'name="bannerPlacement" value="bottom|floating" checked',
    );
  });

  it('comes back to where a re-drawing choice was made', async () => {
    const form = set(formFrom(await page('/engage/new?template=nps')), 'id', 'redraw');
    const response = await post('/engage/new', [...form, ['op', 'refresh|survey.questions.1']]);
    expect(await response.text()).toContain('data-focus="en-survey.questions.1"');
  });

  it('says whether a draft has anything to draw', async () => {
    const blank = formFrom(await page('/engage/new?template=blank-modal'));
    const empty = (await (await post('/engage/_draft', blank)).json()) as { empty: boolean };
    expect(empty.empty).toBe(true);
    const full = formFrom(await page('/engage/new?template=announcement'));
    const drawn = (await (await post('/engage/_draft', full)).json()) as { empty: boolean };
    expect(drawn.empty).toBe(false);
  });
});

describe('writing with AI', () => {
  it('says where to add a key when there is none, and asks nothing of a model', async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const response = await post('/engage/_write', [
        ['markdown', 'Hello'],
        ['instruction', 'Make it shorter.'],
      ]);
      expect(response.status).toBe(501);
      expect(((await response.json()) as { error: string }).error).toContain('OPENROUTER_API_KEY');
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it('rewrites the text with the writing model, and records what it cost', async () => {
    const model = new FakeModel([{ text: '```markdown\n### Shorter\n\nOne line.\n```' }]);
    const writer = createDashboard({
      db,
      basePath: BASE,
      apiPath: '/api/helpwell',
      isAdmin: () => true,
      docsDir: docs,
      model,
    });
    const response = await writer(
      new Request(`${ORIGIN}${BASE}/engage/_write`, {
        method: 'POST',
        headers: { origin: ORIGIN },
        body: new URLSearchParams({
          markdown: 'A much longer welcome than it needs to be.',
          instruction: 'Make it shorter.',
          context: 'A modal shown inside Acme.',
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ markdown: '### Shorter\n\nOne line.' });
    const prompt = model.requests[0]?.messages.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain('A modal shown inside Acme.');
    expect(prompt).toContain('A much longer welcome');
    const spend = await db.execute('SELECT kind FROM helpwell.spend_ledger');
    expect(JSON.stringify(spend)).toContain('docs');
  });

  it('asks for an instruction', async () => {
    const response = await post('/engage/_write', [['markdown', 'Hello']]);
    expect(response.status).toBe(400);
  });
});

describe('list edits from the kit', () => {
  it('moves an item to a new place, as a drag does', () => {
    const raw: Record<string, unknown> = {
      tour: { steps: [{ target: '#a' }, { target: '#b' }, { target: '#c' }] },
    };
    expect(applyOp(raw, 'move|tour.steps.0|2')).toBe('tour.steps.2');
    expect((raw.tour as { steps: { target: string }[] }).steps.map((s) => s.target)).toEqual([
      '#b',
      '#c',
      '#a',
    ]);
    expect(applyOp(raw, 'move|tour.steps.0|9')).toBe('tour.steps.0');
  });

  it('duplicates an item after itself, giving a copied question its own id', () => {
    const raw: Record<string, unknown> = {
      survey: {
        questions: [
          { id: 'q1', prompt: 'One' },
          { id: 'q2', prompt: 'Two' },
        ],
      },
    };
    expect(applyOp(raw, 'duplicate|survey.questions.0')).toBe('survey.questions.1');
    const questions = (raw.survey as { questions: { id: string; prompt: string }[] }).questions;
    expect(questions.map((q) => q.prompt)).toEqual(['One', 'One', 'Two']);
    expect(new Set(questions.map((q) => q.id)).size).toBe(3);
  });
});

describe('a host that keeps the docs elsewhere, and brings its own models', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
  const hosted = (content: ReturnType<typeof createMemoryContentSource> | undefined, extra = {}) =>
    createDashboard({
      db,
      basePath: BASE,
      apiPath: '/api/helpwell',
      isAdmin: () => true,
      docsDir: docs,
      content,
      ...extra,
    });
  const upload = (handler: DashboardHandler) => {
    const body = new FormData();
    body.append('file', new Blob([png], { type: 'image/png' }), 'shot.png');
    return handler(
      new Request(`${ORIGIN}${BASE}/engage/_upload`, {
        method: 'POST',
        headers: { origin: ORIGIN },
        body,
      }),
    );
  };

  it('writes an upload through the content source, at the path the API serves it from', async () => {
    const content = createMemoryContentSource();
    const response = await upload(hosted(content));
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const name = url.split('/').pop() ?? '';
    expect(url).toBe(`/api/helpwell/media/_engage/${name}`);
    expect(content.files.has(`_engage/${name}`)).toBe(true);
    // Nothing went to this server's disk.
    await expect(readdir(join(docs, '_engage'))).rejects.toThrow();
  });

  it('takes no uploads into a source that cannot be written, and offers links instead', async () => {
    await seed({
      id: 'pic',
      kind: 'modal',
      modal: { slides: [{ blocks: [{ type: 'image', url: '' }] }] },
    });
    const readOnly = { ...createMemoryContentSource(), write: undefined };
    const handler = hosted(readOnly as never);
    expect((await upload(handler)).status).toBe(501);
    const editor = await (
      await handler(new Request(`${ORIGIN}${BASE}/engage/pic`, { headers: { 'x-admin': 'yes' } }))
    ).text();
    expect(editor).toContain('name="modal.slides.0.blocks.0.url"');
    expect(editor).not.toMatch(/<input type="file"/);
  });

  it('writes with the host’s own model for writing', async () => {
    const writing = new FakeModel([{ text: 'Short.' }]);
    const asked: string[] = [];
    const handler = hosted(undefined, {
      modelFactory: (purpose: string) => {
        asked.push(purpose);
        return purpose === 'docs' ? writing : null;
      },
    });
    const response = await handler(
      new Request(`${ORIGIN}${BASE}/engage/_write`, {
        method: 'POST',
        headers: { origin: ORIGIN },
        body: new URLSearchParams({ markdown: 'Long.', instruction: 'Shorter.' }),
      }),
    );
    expect(await response.json()).toEqual({ markdown: 'Short.' });
    expect(asked).toEqual(['docs']);
    expect(writing.requests).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- WP10a */

describe('several triggers', () => {
  it('adds one more as an "or", saves them all, and says them all', async () => {
    const form = set(formFrom(await page('/engage/new?template=announcement')), 'id', 'either');
    const added = await post('/engage/new', [...form, ['op', 'add-trigger|triggers']]);
    const html = await added.text();
    expect(html).toContain('data-focus="en-triggers.1"');
    expect(html).toContain('id="en-triggers.1"');
    // The next likely one is offered: exit intent.
    expect(html).toMatch(/name="triggers\.1\.type"[^>]*>[\s\S]*?<option value="exit" selected>/);
    // The rules section opens on it.
    expect(html).toMatch(/id="en-rule-trigger" open/);

    const saved = await post('/engage/new', [
      ...set(formFrom(html), 'triggers.0.type', 'scroll'),
      ['action', 'save'],
    ]);
    expect(saved.status, await saved.clone().text()).toBe(303);
    const [either] = await engagements();
    expect(either?.triggers).toEqual([{ type: 'scroll', percent: 50 }, { type: 'exit' }]);

    const editor = await page('/engage/either');
    expect(editor).toContain('At 50% scroll, or when they go to leave, on desktop');
    expect(editor).toContain('whichever of 2 comes first');
  });

  it('removes one, but never the last', async () => {
    await seed({
      id: 'two',
      kind: 'modal',
      triggers: [{ type: 'load' }, { type: 'exit' }],
      modal: { slides: [{ blocks: [{ type: 'text', markdown: 'Hi' }] }] },
    });
    const html = await page('/engage/two');
    expect(html).toContain('value="remove|triggers.1"');
    expect(html).not.toContain('value="remove|triggers.0"');
    const removed = await post('/engage/two', [...formFrom(html), ['op', 'remove|triggers.1']]);
    expect(await removed.text()).not.toContain('id="en-triggers.1"');
  });

  it('still reads a form that names the one trigger the old way', async () => {
    const form: [string, string][] = [
      ...set(formFrom(await page('/engage/new?template=announcement')), 'id', 'old-form').filter(
        ([name]) => !name.startsWith('triggers.'),
      ),
      ['trigger.type', 'exit'],
    ];
    const data = (await (await post('/engage/_draft', form)).json()) as {
      definition: { triggers: unknown };
    };
    expect(data.definition.triggers).toEqual([{ type: 'exit' }]);
  });
});

describe('personalising the text', () => {
  it('offers the contact fields in the composer, first name with a fallback', async () => {
    await createContact(db, {
      source: 'api',
      identified: true,
      attributes: { plan: 'Pro', company: 'Acme' },
    });
    const html = await page('/engage/new?template=announcement');
    expect(html).toContain('data-ek-merge-insert="first_name|there"');
    expect(html).toContain('data-ek-merge-insert="email"');
    expect(html).toContain('data-ek-merge-insert="plan"');
    // The preview is sent sample values for them.
    const sample = /data-sample-fields="([^"]*)"/.exec(html)?.[1] ?? '{}';
    expect(JSON.parse(decode(sample))).toMatchObject({ first_name: 'Jane', plan: 'Pro' });
  });

  it('keeps a field and its fallback as it was written', async () => {
    const form = set(
      set(formFrom(await page('/engage/new?template=announcement')), 'id', 'hello-name'),
      'modal.slides.0.blocks.0.markdown',
      '## Hi {{first_name|there}}',
    );
    expect((await post('/engage/new', [...form, ['action', 'save']])).status).toBe(303);
    const html = await page('/engage/hello-name');
    expect(html).toContain('data-ek-merge="first_name|there" title="If empty: there">@first_name');
    const again = await post('/engage/hello-name', [...formFrom(html), ['action', 'save']]);
    expect(again.status).toBe(303);
    const [saved] = await engagements();
    expect(JSON.stringify(saved)).toContain('## Hi {{first_name|there}}');
  });
});

describe('banner scrolling and countdown', () => {
  it('saves whether it stays in view, and a countdown in the product’s time zone', async () => {
    const form = set(
      set(
        set(formFrom(await page('/engage/new?template=maintenance-banner')), 'id', 'sale'),
        'banner.countdown.until',
        '2026-07-01T09:00',
      ),
      'banner.countdown.onEnd',
      'keep',
    );
    const unstuck = [
      ...form.filter(([name]) => name !== 'banner.sticky:bool'),
      ['banner.sticky:bool', 'false'],
    ] as [string, string][];
    const response = await post('/engage/new', [...unstuck, ['action', 'save']]);
    expect(response.status, await response.clone().text()).toBe(303);
    const [sale] = await engagements();
    expect(sale).toMatchObject({
      banner: {
        sticky: false,
        // 09:00 in London in July is 08:00 UTC.
        countdown: { until: '2026-07-01T08:00:00.000Z', onEnd: 'keep' },
      },
    });
    const html = await page('/engage/sale');
    expect(html).toContain('name="banner.countdown.until" value="2026-07-01T09:00"');
    expect(html).toContain('Stays in view while scrolling');
  });

  it('leaves the countdown off when the box is empty', async () => {
    const form = set(
      formFrom(await page('/engage/new?template=maintenance-banner')),
      'id',
      'plain',
    );
    expect((await post('/engage/new', [...form, ['action', 'save']])).status).toBe(303);
    const [plain] = await engagements();
    expect(plain).toMatchObject({ banner: { sticky: true, countdown: { until: null } } });
  });
});

describe('the preview, at the slide being edited', () => {
  it('knows each slide by its number, and sends the one being edited', async () => {
    const html = await page('/engage/new?template=announcement');
    expect(html).toContain('data-slide-index="0"');
    expect(html).toContain(`src="${BASE}/_assets/${clientScriptFile('engage')}"`);
    expect(ENGAGE_JS).toContain("'[data-step-index], [data-slide-index]'");
    expect(ENGAGE_JS).toContain('startAt: startAt, fields: sample');
  });
});
