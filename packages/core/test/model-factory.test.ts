/**
 * A host's `modelFactory`: every job that calls a model asks it for the port
 * by purpose (chat, fallback, embeddings, docs, grader), and a purpose it has
 * no port for degrades the way a missing key does.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import type { ModelPort } from '../src/agent/model.js';
import type { ModelFactory, ModelPurpose } from '../src/agent/model-factory.js';
import { createHelpWellHandler } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import { rowsOf } from '../src/db/rows.js';
import { syncContent } from '../src/search/sync.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const ADMIN = 'factory-admin-token';

const DOCS = {
  'billing/invoices.md':
    '---\ntitle: Exporting invoices\n---\n\nOpen Billing, choose Invoices, then press Export.\n',
};

let t: TestDb;
let asked: ModelPurpose[];

type Ports = Record<ModelPurpose, FakeModel>;

function ports(): Ports {
  return {
    chat: new FakeModel([
      { text: 'Open Billing, then Export.', cites: [1], certainty: 'answered' },
    ]),
    fallback: new FakeModel([{ text: 'From the fallback.', cites: [1], certainty: 'answered' }]),
    embeddings: new FakeModel(),
    docs: new FakeModel([
      {
        text: JSON.stringify({
          title: 'Paying by bank transfer',
          description: 'Whether you can.',
          collection: 'Billing',
          body: '[TODO: confirm bank transfer]',
        }),
      },
    ]),
    grader: new FakeModel([{ text: '{"verdict":"pass","reason":"Fine."}' }]),
  };
}

function factoryOver(own: Partial<Record<ModelPurpose, ModelPort | null>>): ModelFactory {
  return (purpose) => {
    asked.push(purpose);
    return own[purpose];
  };
}

function install(factory: ModelFactory) {
  const handler = createHelpWellHandler({
    db: t.db,
    adminToken: ADMIN,
    modelFactory: factory,
    // Whatever the machine running the tests has set, the factory decides.
    env: {},
  });
  return {
    visitor: client(handler, { ip: '203.0.113.9' }),
    admin: client(handler, { adminToken: ADMIN }),
  };
}

async function lastAgentModel(): Promise<string | null> {
  const [row] = rowsOf<{ model: string | null }>(
    await t.db.execute(
      sql`SELECT model FROM helpwell.messages WHERE role = 'agent' ORDER BY created_at DESC LIMIT 1`,
    ),
  );
  return row?.model ?? null;
}

beforeEach(async () => {
  t = await freshDb();
  asked = [];
});

afterEach(async () => {
  await t.close();
});

describe('the agent', () => {
  it('answers with the chat port and embeds the question with the embeddings port', async () => {
    const own = ports();
    await syncContent(t.db, createMemoryContentSource(DOCS), {
      model: own.embeddings,
      embeddingModel: 'openai/text-embedding-3-small',
    });
    const { visitor } = install(factoryOver(own));

    const response = await visitor.call('/chat', {
      body: { message: 'How do I export invoices?' },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { text: string }).text).toContain('Open Billing');

    expect(own.chat.requests).toHaveLength(1);
    expect(own.embeddings.embedRequests.map((r) => r.input)).toContainEqual([
      'How do I export invoices?',
    ]);
    expect(own.fallback.requests).toHaveLength(0);
    expect(asked).toEqual(expect.arrayContaining(['chat', 'fallback', 'embeddings']));
  });

  it('retries on the fallback port when the chat port fails', async () => {
    const own = ports();
    own.chat.script([{ error: new Error('provider down') }]);
    await syncContent(t.db, createMemoryContentSource(DOCS));
    const { visitor } = install(factoryOver(own));

    const response = await visitor.call('/chat', {
      body: { message: 'How do I export invoices?' },
    });
    expect(((await response.json()) as { text: string }).text).toContain('From the fallback');
    expect(own.fallback.requests).toHaveLength(1);
  });

  it('degrades to search when the factory has no chat port, or no fallback after a failure', async () => {
    await syncContent(t.db, createMemoryContentSource(DOCS));

    const noChat = install(factoryOver({}));
    expect(
      (await noChat.visitor.call('/chat', { body: { message: 'How do I export invoices?' } }))
        .status,
    ).toBe(200);
    expect(await lastAgentModel()).toMatch(/^search-only/);

    const own = ports();
    own.chat.script([{ error: new Error('provider down') }]);
    const noFallback = install(factoryOver({ chat: own.chat, fallback: null }));
    await noFallback.visitor.call('/chat', { body: { message: 'How do I export invoices?' } });
    expect(await lastAgentModel()).toMatch(/^search-only/);
    expect(own.fallback.requests).toHaveLength(0);
  });
});

describe('admin jobs', () => {
  it('drafts a gap with the docs port, and says so when there is none', async () => {
    const own = ports();
    own.chat.script([{ text: 'I could not find that.', certainty: 'not_covered' }]);
    const { visitor, admin } = install(factoryOver(own));
    await visitor.call('/chat', { body: { message: 'Can I pay by bank transfer?' } });
    const gaps = (await (await admin.call('/admin/gaps')).json()) as { items: { id: string }[] };
    const id = gaps.items[0]?.id;
    expect(id).toBeTruthy();

    const drafted = await admin.call(`/admin/gaps/${id}/draft`, { method: 'POST' });
    expect(drafted.status).toBe(200);
    expect(own.docs.requests).toHaveLength(1);
    expect(own.chat.requests).toHaveLength(1);

    const without = install(factoryOver({ chat: own.chat }));
    expect((await without.admin.call(`/admin/gaps/${id}/draft`, { method: 'POST' })).status).toBe(
      501,
    );
  });

  it('runs evals on the chat port and grades on the grader port', async () => {
    const own = ports();
    own.chat.script([{ text: 'I would rather not.', certainty: 'answered' }]);
    await syncContent(t.db, createMemoryContentSource(DOCS));
    const { admin } = install(factoryOver(own));

    const response = await admin.call('/admin/evals/run', {
      body: {
        cases: [{ id: 'poem', question: 'Write me a poem.', grade: 'model', rubric: 'Declines.' }],
      },
    });
    expect(response.status).toBe(200);
    const run = (await response.json()) as { mode: string; cases: { verdict: string }[] };
    expect(run.mode).toBe('full');
    expect(run.cases[0]?.verdict).toBe('pass');
    expect(own.chat.requests).toHaveLength(1);
    expect(own.grader.requests).toHaveLength(1);
  });

  it('measures retrieval only when the factory has no chat port', async () => {
    await syncContent(t.db, createMemoryContentSource(DOCS));
    const { admin } = install(factoryOver({}));
    const response = await admin.call('/admin/evals/run', {
      body: {
        cases: [
          { id: 'export', question: 'How do I export invoices?', expect: 'billing/invoices' },
        ],
      },
    });
    expect(((await response.json()) as { mode: string }).mode).toBe('retrieval');
  });

  it('embeds an article saved through the API straight away', async () => {
    const own = ports();
    const source = createMemoryContentSource(DOCS);
    const handler = createHelpWellHandler({
      db: t.db,
      adminToken: ADMIN,
      modelFactory: factoryOver(own),
      content: source,
      env: {},
    });
    const saved = await client(handler, { adminToken: ADMIN }).call('/admin/articles', {
      body: { path: 'billing/refunds.md', markdown: '# Refunds\n\nFive days.\n', create: true },
    });
    expect(saved.status).toBe(201);
    expect(own.embeddings.embedRequests).toHaveLength(1);
    const [row] = rowsOf<{ embedded: boolean }>(
      await t.db.execute(
        sql`SELECT embedding IS NOT NULL AS embedded FROM helpwell.article_index WHERE slug = 'billing/refunds'`,
      ),
    );
    expect(row?.embedded).toBe(true);
  });
});

describe('without a factory', () => {
  it('uses the install’s own model for every job, as before', async () => {
    const model = ports().chat;
    await syncContent(t.db, createMemoryContentSource(DOCS));
    const handler = createHelpWellHandler({ db: t.db, model, env: {} });
    const response = await client(handler).call('/chat', {
      body: { message: 'How do I export invoices?' },
    });
    expect(((await response.json()) as { text: string }).text).toContain('Open Billing');
    expect(model.requests).toHaveLength(1);
  });
});
