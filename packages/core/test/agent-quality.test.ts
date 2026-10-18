/**
 * The admin routes that judge the agent (evals, gap drafts), and where the
 * confidence score shows up on the wire and where it must not.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel, type ScriptedTurn } from '../src/agent/fake-model.js';
import type { ChatRequest } from '../src/agent/model.js';
import type { HelpWellHandler } from '../src/api.js';
import { createHelpWellHandler } from '../src/api.js';
import type { Article } from '../src/content/articles.js';
import type { Db } from '../src/db/client.js';
import { indexArticles } from '../src/search/indexer.js';
import { freshDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const ADMIN = 'test-admin-token';

let db: Db;
let handler: HelpWellHandler;
let admin: Client;
let visitor: Client;
let savedKey: string | undefined;

/** One model for everything the install does, told apart by its system prompt. */
function installModel(): FakeModel {
  return new FakeModel((request: ChatRequest): ScriptedTurn => {
    const system = request.messages[0]?.content ?? '';
    if (system.startsWith('You write help-centre articles')) {
      return {
        text: JSON.stringify({
          title: 'Paying by bank transfer',
          description: 'Whether you can.',
          collection: 'Billing',
          body: '[TODO: confirm bank transfer]',
        }),
      };
    }
    if (system.includes('You grade answers')) {
      return { text: '{"verdict":"pass","reason":"Fine."}' };
    }
    const asked = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (/invoice/i.test(asked)) {
      return {
        text: 'Open Billing, choose Invoices, then press Export.',
        cites: [1],
        certainty: 'answered',
      };
    }
    return { text: 'I could not find that in the help center.', certainty: 'not_covered' };
  });
}

function article(partial: Pick<Article, 'slug' | 'collection' | 'title' | 'body'>): Article {
  return {
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${partial.slug}.md`,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: `hash-${partial.slug}`,
    ...partial,
  };
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function handlerWith(model?: FakeModel): HelpWellHandler {
  return createHelpWellHandler({
    db,
    basePath: '/api/helpwell',
    adminToken: ADMIN,
    secureCookies: false,
    ...(model ? { model } : {}),
  });
}

beforeEach(async () => {
  savedKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  db = (await freshDb()).db;
  handler = handlerWith(installModel());
  admin = client(handler, { adminToken: ADMIN });
  visitor = client(handler);
  await indexArticles(db, [
    article({
      slug: 'billing/invoices',
      collection: 'billing',
      title: 'Exporting invoices',
      body: 'Open Billing, choose Invoices, then press Export. A PDF downloads.',
    }),
  ]);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
});

const CASES = [
  { id: 'export', question: 'How do I export invoices?', expect: 'billing/invoices' },
  { id: 'vat', question: 'Do you have a VAT number?', expect: null },
  { id: 'poem', question: 'Write me a poem.', grade: 'model', rubric: 'Declines.' },
];

type Run = {
  id: string | null;
  mode: string;
  score: number;
  cases: { id: string; verdict: string }[];
  skipped: { id: string }[];
  belowThreshold: boolean;
};

describe('POST /admin/evals/run', () => {
  it('runs the cases with the configured model and records the run', async () => {
    const response = await admin.call('/admin/evals/run', {
      body: { cases: CASES, ref: 'abc123', threshold: 50 },
    });
    expect(response.status).toBe(200);
    const run = await body<Run>(response);
    expect(run.mode).toBe('full');
    expect(run.cases.map((c) => [c.id, c.verdict])).toEqual([
      ['export', 'pass'],
      ['vat', 'pass'],
      ['poem', 'pass'],
    ]);
    expect(run.score).toBe(100);
    expect(run.belowThreshold).toBe(false);

    const list = await body<{ items: { id: string; ref: string; mode: string }[] }>(
      await admin.call('/admin/evals'),
    );
    expect(list.items[0]).toMatchObject({ id: run.id, ref: 'abc123', mode: 'full' });
  });

  it('repeats the last run when no cases are sent, and says so when there is none', async () => {
    const none = await admin.call('/admin/evals/run', { body: {} });
    expect(none.status).toBe(400);

    await admin.call('/admin/evals/run', { body: { cases: CASES } });
    const again = await body<Run>(await admin.call('/admin/evals/run', { method: 'POST' }));
    expect(again.cases.map((c) => c.id)).toEqual(['export', 'vat', 'poem']);
  });

  it('measures retrieval only when no key is set', async () => {
    const bare = client(handlerWith(), { adminToken: ADMIN });
    const run = await body<Run>(await bare.call('/admin/evals/run', { body: { cases: CASES } }));
    expect(run.mode).toBe('retrieval');
    expect(run.skipped.map((s) => s.id)).toEqual(['poem']);
  });

  it('refuses bad input and callers who are not admins', async () => {
    expect(
      (await admin.call('/admin/evals/run', { body: { cases: CASES, threshold: 'high' } })).status,
    ).toBe(400);
    expect(
      (
        await admin.call('/admin/evals/run', {
          body: { cases: [{ question: 'Q', grade: 'human' }] },
        })
      ).status,
    ).toBe(400);
    expect((await visitor.call('/admin/evals/run', { body: { cases: CASES } })).status).toBe(401);
  });
});

describe('POST /admin/gaps/:id/draft', () => {
  async function aGap(): Promise<string> {
    await visitor.call('/chat', { body: { message: 'Can I pay by bank transfer?' } });
    const gaps = await body<{ items: { id: string; suggestedTitle: string | null }[] }>(
      await admin.call('/admin/gaps'),
    );
    expect(gaps.items[0]?.suggestedTitle).toBe('Can I pay by bank transfer?');
    return gaps.items[0]!.id;
  }

  it('returns a draft and leaves the gap as it was', async () => {
    const id = await aGap();
    const response = await admin.call(`/admin/gaps/${id}/draft`, { method: 'POST' });
    expect(response.status).toBe(200);
    const draft = await body<{ slug: string; path: string; markdown: string; collection: string }>(
      response,
    );
    expect(draft).toMatchObject({
      slug: 'billing/paying-by-bank-transfer',
      path: 'docs/billing/paying-by-bank-transfer.md',
      collection: 'billing',
    });
    expect(draft.markdown).toContain('status: draft');

    const gaps = await body<{ items: { id: string; status: string }[] }>(
      await admin.call('/admin/gaps'),
    );
    expect(gaps.items.find((g) => g.id === id)?.status).toBe('new');
  });

  it('404s an unknown gap, 501s without a key, and 401s a visitor', async () => {
    expect((await admin.call('/admin/gaps/gap_nope/draft', { method: 'POST' })).status).toBe(404);
    const id = await aGap();
    const bare = client(handlerWith(), { adminToken: ADMIN });
    expect((await bare.call(`/admin/gaps/${id}/draft`, { method: 'POST' })).status).toBe(501);
    expect((await visitor.call(`/admin/gaps/${id}/draft`, { method: 'POST' })).status).toBe(401);
  });
});

describe('confidence on the wire', () => {
  it('is in the admin thread, read-only, and never in what the visitor gets', async () => {
    const response = await visitor.call('/chat', {
      body: { message: 'How do I export invoices?' },
    });
    const reply = await body<Record<string, unknown>>(response);
    expect(reply).not.toHaveProperty('confidence');
    expect(reply).not.toHaveProperty('confidenceReason');
    expect(reply).not.toHaveProperty('certainty');
    expect(reply.citations).toEqual([
      { slug: 'billing/invoices', title: 'Exporting invoices', collection: 'billing' },
    ]);

    const thread = await body<{
      messages: {
        role: string;
        confidence: number | null;
        confidenceReason: string | null;
        latencyMs: number | null;
      }[];
    }>(await admin.call(`/admin/conversations/${reply.conversationId}`));
    const [question, answer] = thread.messages;
    expect(question).toMatchObject({ role: 'customer', confidence: null, confidenceReason: null });
    expect(answer?.role).toBe('agent');
    expect(answer?.confidence).toBeGreaterThan(0.5);
    expect(answer?.confidenceReason).toMatch(/^High\./);
    expect(answer?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
