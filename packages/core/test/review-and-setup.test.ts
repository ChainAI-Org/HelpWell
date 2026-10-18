/**
 * What the dashboard's conversation review and setup checklist read from
 * core (migration 0010): the passages each reply was shown, with similarity;
 * the widget's first sighting; the checklist's own state; and the setup
 * prompts for the first-run steps.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, FakeModel } from '../src/agent.js';
import { createHelpWellHandler } from '../src/api.js';
import type { Article } from '../src/content.js';
import { hashContent } from '../src/content.js';
import { schema } from '../src/db.js';
import {
  formatSetupPrompt,
  identitySigningPromptSpec,
  loaderUrls,
  modelKeyPromptSpec,
  WIDGET_FRAMEWORKS,
  widgetInstallPromptSpec,
} from '../src/index.js';
import {
  checklistState,
  getConversation,
  noteWidgetSeen,
  updateChecklistState,
  widgetSighting,
} from '../src/repos.js';
import { indexArticles } from '../src/search.js';
import { parseSettings } from '../src/settings.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;

function doc(slug: string, title: string, body: string): Article {
  return {
    slug,
    title,
    body,
    collection: slug.split('/')[0]!,
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${slug}.md`,
    updatedAt: new Date(),
    contentHash: hashContent(body + title),
  };
}

const DOCS = [
  doc(
    'billing/exporting-invoices-as-csv',
    'Exporting invoices as CSV',
    'Open Billing then Invoices and choose Export CSV at the top right.',
  ),
  doc(
    'billing/invoice-emails',
    'Invoice emails',
    'Invoices are emailed monthly. Export them any time from Billing.',
  ),
];

beforeAll(async () => {
  t = await freshDb();
  await indexArticles(t.db, DOCS, { model: new FakeModel() });
});

afterAll(async () => {
  await t.close();
});

describe('what a reply was shown', () => {
  it('keeps every passage with how it matched, its similarity, and whether it was cited', async () => {
    const model = new FakeModel([{ text: 'Billing, then Invoices, then Export CSV.', cites: [1] }]);
    const agent = new Agent({
      db: t.db,
      settings: parseSettings({ product: { name: 'Acme' } }),
      model,
    });
    const reply = await agent.reply({ message: 'How do I export my invoices as a CSV?' });

    const thread = await getConversation(t.db, reply.conversationId);
    const answer = thread?.messages.find((m) => m.role === 'agent');
    expect(answer).toBeDefined();
    const sources = answer?.sources ?? [];
    expect(sources.length).toBeGreaterThan(0);

    const first = sources[0]!;
    expect(first.ref).toBe(1);
    expect(first.slug).toBe('billing/exporting-invoices-as-csv');
    expect(first.cited).toBe(true);
    expect(first.matchedBy).toContain('semantic');
    expect(first.similarity).toBeGreaterThan(0);
    expect(first.similarity).toBeLessThanOrEqual(1);
    // Only what the answer cited is marked cited.
    expect(sources.filter((s) => s.cited).map((s) => s.slug)).toEqual([
      'billing/exporting-invoices-as-csv',
    ]);

    // The review also gets the reply's own cost, tokens and the model's certainty.
    expect(answer?.costUsd).not.toBeNull();
    expect(answer?.tokensIn).not.toBeNull();
    expect(answer?.certainty === null || typeof answer?.certainty === 'string').toBe(true);

    // The visitor's copy of the reply carries citations, never the sources.
    expect(Object.keys(reply)).not.toContain('sources');
    expect(JSON.stringify(reply.citations)).not.toContain('similarity');
  });

  it('marks nothing cited, and keeps the passages, when the model falls back to search', async () => {
    const model = new FakeModel([{ error: new Error('down') }, { error: new Error('down') }]);
    const agent = new Agent({
      db: t.db,
      settings: parseSettings({ product: { name: 'Acme' } }),
      model,
    });
    const reply = await agent.reply({ message: 'How do I export my invoices as a CSV?' });
    expect(reply.degraded).toBe(true);
    const [row] = await t.db
      .select({ sources: schema.messages.sources })
      .from(schema.messages)
      .where(sql`id = ${reply.messageId}`);
    expect(row?.sources[0]?.cited).toBe(true);
    expect(row?.sources.slice(1).every((s) => !s.cited)).toBe(true);
  });

  it('leaves customer messages with no sources', async () => {
    const rows = await t.db
      .select({ sources: schema.messages.sources })
      .from(schema.messages)
      .where(sql`role = 'customer'`);
    expect(rows.every((row) => row.sources.length === 0)).toBe(true);
  });
});

describe('the widget sighting', () => {
  const request = (referer?: string) =>
    new Request('http://localhost/api/helpwell/config', {
      headers: referer ? { referer } : {},
    });

  it('ignores the help centre, then records the first real page without its query', async () => {
    const db = (await freshDb()).db;
    await noteWidgetSeen(db, request('https://acme.test/help/billing'), {
      helpCenterPath: '/help',
    });
    expect(await widgetSighting(db)).toBeNull();

    await noteWidgetSeen(db, request('https://acme.test/app/settings?token=secret'), {
      helpCenterPath: '/help',
    });
    const seen = await widgetSighting(db);
    expect(seen?.firstPage).toBe('https://acme.test/app/settings');
    expect(seen?.firstSeenAt).toBeInstanceOf(Date);

    // Within the hour, a second page costs nothing and changes nothing.
    await noteWidgetSeen(db, request('https://acme.test/app/other'), { helpCenterPath: '/help' });
    expect((await widgetSighting(db))?.lastPage).toBe('https://acme.test/app/settings');

    // An hour later the latest sighting moves; the first one stays.
    await noteWidgetSeen(db, request('https://acme.test/app/other'), {
      helpCenterPath: '/help',
      now: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    const later = await widgetSighting(db);
    expect(later?.firstPage).toBe('https://acme.test/app/settings');
    expect(later?.lastPage).toBe('https://acme.test/app/other');
  });

  it('is recorded when the widget asks the API for its config', async () => {
    const db = (await freshDb()).db;
    const api = createHelpWellHandler({ db, basePath: '/api/helpwell' });
    const response = await api(request('https://acme.test/pricing'));
    expect(response.status).toBe(200);
    expect((await widgetSighting(db))?.firstPage).toBe('https://acme.test/pricing');
  });

  it('never breaks the config request, even without the table', async () => {
    const db = (await freshDb()).db;
    await db.execute(sql`DROP TABLE helpwell.install_state`);
    await expect(noteWidgetSeen(db, request('https://acme.test/'))).resolves.toBeUndefined();
  });
});

describe('the checklist state', () => {
  it('starts empty, remembers a dismissal and optional steps marked done', async () => {
    const db = (await freshDb()).db;
    expect(await checklistState(db)).toEqual({ dismissedAt: null, done: [] });

    await updateChecklistState(db, { done: { key: 'mcp', value: true } });
    await updateChecklistState(db, { dismissed: true });
    const state = await checklistState(db);
    expect(state.done).toEqual(['mcp']);
    expect(state.dismissedAt).toBeInstanceOf(Date);

    await updateChecklistState(db, { dismissed: false, done: { key: 'mcp', value: false } });
    expect(await checklistState(db)).toEqual({ dismissedAt: null, done: [] });
  });
});

describe('first-run setup prompts', () => {
  const options = { apiPath: '/api/support', origin: 'https://app.acme.test', productName: 'Acme' };

  it('build an absolute loader URL only from a real origin', () => {
    expect(loaderUrls({ apiPath: '/api/support/', origin: 'https://app.acme.test' })).toEqual({
      path: '/api/support/assets/loader.js',
      absolute: 'https://app.acme.test/api/support/assets/loader.js',
    });
    expect(
      loaderUrls({ apiPath: '/api/support', origin: 'javascript:alert(1)' }).absolute,
    ).toBeNull();
  });

  it('give every framework the real loader path, where it goes, and how to check it', () => {
    expect(WIDGET_FRAMEWORKS.map((f) => f.key)).toEqual([
      'html',
      'nextjs',
      'react-vite',
      'vue',
      'sveltekit',
      'rails',
      'django',
    ]);
    for (const { key } of WIDGET_FRAMEWORKS) {
      const prompt = formatSetupPrompt(widgetInstallPromptSpec(key, options));
      expect(prompt).toContain('/api/support/assets/loader.js');
      expect(prompt).toContain('launcher appears');
      expect(prompt).toContain('HELPWELL_IDENTITY_SECRET');
      expect(prompt).toContain('Never ask me to paste');
    }
    // Rails and Django cannot serve HelpWell themselves, so they get the absolute URL.
    expect(formatSetupPrompt(widgetInstallPromptSpec('rails', options))).toContain(
      'src="https://app.acme.test/api/support/assets/loader.js"',
    );
    expect(formatSetupPrompt(widgetInstallPromptSpec('nextjs', options))).toContain(
      "import Script from 'next/script'",
    );
  });

  it('list the CSP the widget needs, for what is switched on', () => {
    const plain = formatSetupPrompt(widgetInstallPromptSpec('html', options));
    expect(plain).toContain('Content-Security-Policy additions');
    expect(plain).toContain("'self'");
    expect(plain).not.toContain('challenges.cloudflare.com');

    const both = formatSetupPrompt(
      widgetInstallPromptSpec('rails', { ...options, inlineVideo: true, botCheck: true }),
    );
    expect(both).toContain('with inline video and the bot check switched on');
    expect(both).toContain('https://challenges.cloudflare.com');
    expect(both).toContain('https://player.vimeo.com');
    // Rails loads the widget from HelpWell's own origin, so that is what the CSP allows.
    expect(both).toContain('https://app.acme.test https://challenges.cloudflare.com');
  });

  it('sign identity tokens in four languages, from the environment, never inline', () => {
    const prompt = formatSetupPrompt(identitySigningPromptSpec(options));
    expect(prompt).toContain('HS256');
    expect(prompt).toContain('"sub"');
    for (const marker of ["from '@helpwell/core'", 'import jwt', 'require "jwt"', 'JWT::encode']) {
      expect(prompt).toContain(marker);
    }
    expect(prompt).toContain('/api/support/identify');
    expect(prompt.match(/HELPWELL_IDENTITY_SECRET/g)?.length).toBeGreaterThan(4);
  });

  it('tell the person to paste the model key themselves', () => {
    const prompt = formatSetupPrompt(modelKeyPromptSpec(options));
    expect(prompt).toContain('OPENROUTER_API_KEY');
    expect(prompt).toContain('/api/support');
    expect(prompt).toContain('npx helpwell doctor');
    expect(prompt).not.toMatch(/sk-or-v1-[a-z0-9]/i);
  });
});
