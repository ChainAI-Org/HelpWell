/**
 * The tools that write: articles into a real temporary repo, settings into
 * the database and the config file, and the CLI-backed tools through a fake
 * runner, so no test spawns a process or touches the network.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModel } from '@helpwell/core/agent';
import { EMPTY_ARTICLE_MESSAGE } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { schema } from '@helpwell/core/db';
import { createSegment } from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { sql as sqlTag } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mcpSetupPrompt } from '../src/index.js';
import type { CliRunner, McpEnvironment } from '../src/project.js';
import { resolveEnvironment } from '../src/project.js';
import { callTool } from '../src/server.js';
import { runTool } from '../src/tools.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;
let db: Db;
let root: string;
let cliCalls: string[][];
let env: McpEnvironment;

const fakeCli: CliRunner = async (args) => {
  cliCalls.push(args);
  if (args[0] === 'changelog') {
    return { ok: true, command: 'changelog', result: { title: 'Dark mode', version: 'v2.0.0' } };
  }
  if (args[0] === 'capture')
    return { ok: false, error: { code: 'failed', message: 'Playwright is not installed' } };
  return { ok: true, result: { args } };
};

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
});

afterAll(async () => {
  await t.close();
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'helpwell-mcp-'));
  mkdirSync(join(root, 'helpwell'), { recursive: true });
  writeFileSync(
    join(root, 'helpwell', 'helpwell.config.json'),
    JSON.stringify({ docs: 'content/docs', settings: { product: { name: 'Acme' } } }, null, 2),
  );
  mkdirSync(join(root, 'content', 'docs', 'billing'), { recursive: true });
  writeFileSync(
    join(root, 'content', 'docs', 'billing', 'invoices.md'),
    '---\ntitle: Invoices\nstatus: published\n---\n\nOpen Billing.',
  );
  cliCalls = [];
  env = { ...resolveEnvironment({ env: { HELPWELL_PROJECT_DIR: root } }), runCli: fakeCli };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('finding the repo', () => {
  it('reads the docs folder from the config, and says plainly when there is no repo', async () => {
    expect(env.root).toBe(root);
    expect(env.docsDir).toBe(join(root, 'content', 'docs'));
    const nowhere = resolveEnvironment({ cwd: tmpdir(), env: {} });
    await expect(
      runTool(db, 'create_article', { collection: 'x', title: 'T', body: 'B' }, nowhere),
    ).rejects.toThrow(/HELPWELL_PROJECT_DIR/);
  });
});

describe('articles', () => {
  it('writes a new article as a draft and indexes it', async () => {
    const written = await runTool(
      db,
      'create_article',
      {
        collection: 'billing',
        title: 'Refunds',
        body: 'Within 30 days.',
        description: 'Money back',
      },
      env,
    );
    expect(written).toEqual({
      slug: 'billing/refunds',
      path: 'content/docs/billing/refunds.md',
      status: 'draft',
      indexed: true,
      // No key in the environment: text search only until a sync embeds it.
      embedded: false,
    });
    const file = readFileSync(join(root, 'content', 'docs', 'billing', 'refunds.md'), 'utf8');
    expect(file).toContain('status: draft');
    const [row] = await db.select().from(schema.articleIndex).where(sqlSlug('billing/refunds'));
    expect(row).toMatchObject({ title: 'Refunds', status: 'draft' });

    await expect(
      runTool(
        db,
        'create_article',
        { collection: 'billing', title: 'Refunds', body: 'Again.' },
        env,
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      runTool(db, 'create_article', { collection: 'Bad Name', title: 'X', body: 'Y' }, env),
    ).rejects.toThrow(/folder name/);
  });

  it('updates an article in place, keeping the frontmatter it was not asked to change', async () => {
    const updated = await runTool(
      db,
      'update_article',
      { slug: 'billing/invoices', body: 'Open Billing, then Invoices.' },
      env,
    );
    expect(updated).toMatchObject({ slug: 'billing/invoices', status: 'published' });
    const file = readFileSync(join(root, 'content', 'docs', 'billing', 'invoices.md'), 'utf8');
    expect(file).toContain('title: Invoices');
    expect(file).toContain('Open Billing, then Invoices.');
    await expect(runTool(db, 'update_article', { slug: 'billing/nope' }, env)).rejects.toThrow(
      /No article/,
    );
  });
});

describe('articles with nothing in them', () => {
  const docs = () => join(root, 'content', 'docs', 'billing');

  it('refuses to create a published article with an empty body, and writes nothing', async () => {
    for (const body of ['', '   \n\n ', '# Late fees']) {
      await expect(
        runTool(
          db,
          'create_article',
          { collection: 'billing', title: 'Late fees', body, status: 'published' },
          env,
        ),
      ).rejects.toThrow(EMPTY_ARTICLE_MESSAGE);
    }
    expect(existsSync(join(docs(), 'late-fees.md'))).toBe(false);
    const rows = await db.select().from(schema.articleIndex).where(sqlSlug('billing/late-fees'));
    expect(rows).toHaveLength(0);
  });

  it('still creates an empty draft, the default', async () => {
    const written = await runTool(
      db,
      'create_article',
      { collection: 'billing', title: 'Payment plans', body: '' },
      env,
    );
    expect(written).toMatchObject({ slug: 'billing/payment-plans', status: 'draft' });
    expect(readFileSync(join(docs(), 'payment-plans.md'), 'utf8')).toContain('status: draft');
    // A missing body is still a mistake, not an empty draft.
    await expect(
      runTool(db, 'create_article', { collection: 'billing', title: 'Disputes' }, env),
    ).rejects.toThrow(/"body" is required/);
  });

  it('refuses to empty a published article, or to publish an empty draft, on update', async () => {
    const invoices = join(docs(), 'invoices.md');
    const before = readFileSync(invoices, 'utf8');
    await expect(
      runTool(db, 'update_article', { slug: 'billing/invoices', body: '' }, env),
    ).rejects.toThrow(EMPTY_ARTICLE_MESSAGE);
    await expect(
      runTool(db, 'update_article', { slug: 'billing/invoices', body: '# Invoices' }, env),
    ).rejects.toThrow(EMPTY_ARTICLE_MESSAGE);
    expect(readFileSync(invoices, 'utf8')).toBe(before);

    // Emptied as a draft is fine; publishing that draft as it stands is not.
    await expect(
      runTool(db, 'update_article', { slug: 'billing/invoices', body: '', status: 'draft' }, env),
    ).resolves.toMatchObject({ status: 'draft' });
    await expect(
      runTool(db, 'update_article', { slug: 'billing/invoices', status: 'published' }, env),
    ).rejects.toThrow(EMPTY_ARTICLE_MESSAGE);
    expect(readFileSync(invoices, 'utf8')).toContain('status: draft');

    // With words in it, it publishes.
    await expect(
      runTool(
        db,
        'update_article',
        { slug: 'billing/invoices', body: 'Open Billing.', status: 'published' },
        env,
      ),
    ).resolves.toMatchObject({ status: 'published' });
  });

  it('reaches the assistant as a tool error it can act on', async () => {
    const result = await callTool(
      async () => db,
      'create_article',
      { collection: 'billing', title: 'Late fees', body: '', status: 'published' },
      env,
    );
    expect(result.isError).toBe(true);
    const [first] = result.content;
    expect(first?.type === 'text' ? first.text : '').toBe(EMPTY_ARTICLE_MESSAGE);
  });
});

describe('articles and semantic search', () => {
  /** What the index holds for one slug: whether it has a vector. */
  async function vectorOf(slug: string): Promise<unknown> {
    const [row] = await db
      .select({ embedding: schema.articleIndex.embedding })
      .from(schema.articleIndex)
      .where(sqlSlug(slug));
    return row?.embedding ?? null;
  }

  it('embeds a new article and an edit on save, as the dashboard and the API do', async () => {
    const model = new FakeModel();
    const withModel: McpEnvironment = { ...env, model };

    const created = await runTool(
      db,
      'create_article',
      {
        collection: 'billing',
        title: 'Refunds',
        body: 'Within 30 days, to the card you paid with.',
      },
      withModel,
    );
    expect(created).toMatchObject({ slug: 'billing/refunds', embedded: true });
    expect(model.embedRequests).toHaveLength(1);
    const settings = await new SettingsStore(db).get();
    expect(model.embedRequests[0]?.model).toBe(settings.agent.models.embeddings);
    expect(model.embedRequests[0]?.input[0]).toContain('Within 30 days');
    const before = await vectorOf('billing/refunds');
    expect(Array.isArray(before)).toBe(true);

    const updated = await runTool(
      db,
      'update_article',
      { slug: 'billing/refunds', body: 'Within 60 days now, to the card you paid with.' },
      withModel,
    );
    expect(updated).toMatchObject({ slug: 'billing/refunds', embedded: true });
    expect(model.embedRequests).toHaveLength(2);
    expect(model.embedRequests[1]?.input[0]).toContain('Within 60 days');
    expect(await vectorOf('billing/refunds')).not.toEqual(before);
  });

  it('still saves, as text, when the provider fails', async () => {
    const model = new FakeModel();
    model.embed = async () => {
      throw new Error('502 from provider');
    };
    const written = await runTool(
      db,
      'create_article',
      { collection: 'billing', title: 'Chargebacks', body: 'Tell us first.' },
      { ...env, model },
    );
    expect(written).toMatchObject({ slug: 'billing/chargebacks', indexed: true, embedded: false });
    expect(
      readFileSync(join(root, 'content', 'docs', 'billing', 'chargebacks.md'), 'utf8'),
    ).toContain('Tell us first.');
    expect(await vectorOf('billing/chargebacks')).toBeNull();
  });

  it('indexes as text when the model is switched off', async () => {
    const written = await runTool(
      db,
      'update_article',
      { slug: 'billing/invoices', body: 'Open Billing, then Invoices.' },
      { ...env, model: null },
    );
    expect(written).toMatchObject({ slug: 'billing/invoices', embedded: false });
  });
});

describe('settings', () => {
  it('changes one setting in the database and in the config file', async () => {
    const result = await runTool(
      db,
      'update_setting',
      { path: 'widget.appearance.accent', value: '#0EA5E9' },
      env,
    );
    expect(result).toEqual({
      path: 'widget.appearance.accent',
      value: '#0EA5E9',
      configFile: 'helpwell/helpwell.config.json',
    });
    expect((await new SettingsStore(db).get()).widget.appearance.accent).toBe('#0EA5E9');
    const config = JSON.parse(readFileSync(join(root, 'helpwell', 'helpwell.config.json'), 'utf8'));
    expect(config.settings.widget.appearance.accent).toBe('#0EA5E9');
    expect(config.settings.product.name).toBe('Acme');
  });

  it('refuses webhooks and secrets, and values the schema does not accept', async () => {
    await expect(
      runTool(
        db,
        'update_setting',
        { path: 'webhooks', value: [{ url: 'https://evil.test' }] },
        env,
      ),
    ).rejects.toThrow(/person/);
    await expect(
      runTool(db, 'update_setting', { path: 'agent.spend.dailyCapUsd', value: 'lots' }, env),
    ).rejects.toThrow(/not valid/);
  });
});

describe('segments and conversations', () => {
  it('lists and counts segments, saved or not', async () => {
    await db.insert(schema.contacts).values([
      { id: 'con_s1', identified: true, attributes: { plan: 'pro' } },
      { id: 'con_s2', identified: false, attributes: { plan: 'free' } },
    ]);
    const saved = await createSegment(db, {
      name: 'Pro',
      rules: { field: 'plan', op: 'is', value: 'pro' },
    });
    const list = (await runTool(db, 'list_segments', {}, env)) as { id: string; count: number }[];
    expect(list).toEqual([expect.objectContaining({ id: saved.id, count: 1 })]);
    expect(await runTool(db, 'count_segment', { id: saved.id }, env)).toEqual({ count: 1 });
    expect(
      await runTool(db, 'count_segment', { rules: { field: 'identified', op: 'is_false' } }, env),
    ).toEqual({ count: 1 });
    await expect(runTool(db, 'count_segment', {}, env)).rejects.toThrow(/rules/);
  });

  it('reads a conversation without the contact, emails or tool results', async () => {
    await db
      .insert(schema.contacts)
      .values({ id: 'con_c1', email: 'ada@example.com', name: 'Ada' });
    await db.insert(schema.conversations).values({ id: 'cnv_c1', contactId: 'con_c1' });
    await db.insert(schema.messages).values([
      {
        id: 'msg_c1',
        conversationId: 'cnv_c1',
        role: 'customer',
        body: 'I am ada@example.com, help',
      },
      {
        id: 'msg_c2',
        conversationId: 'cnv_c1',
        role: 'agent',
        body: 'Done.',
        toolCalls: [
          { name: 'lookUpUser', arguments: {}, result: { plan: 'pro', email: 'ada@example.com' } },
        ],
      },
    ]);
    const transcript = await runTool(db, 'read_conversation', { id: 'cnv_c1' }, env);
    const text = JSON.stringify(transcript);
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('Ada');
    expect(transcript).toMatchObject({
      messages: [
        { role: 'customer', body: 'I am [email], help' },
        { role: 'agent', tools: ['lookUpUser'] },
      ],
    });
  });
});

describe('through the CLI', () => {
  it('drafts a changelog, never with --publish, and reports a CLI failure as an error', async () => {
    const draft = await runTool(db, 'generate_changelog', { since: 'v1.0.0', dryRun: true }, env);
    expect(draft).toEqual({ title: 'Dark mode', version: 'v2.0.0' });
    expect(cliCalls[0]).toEqual(['changelog', '--since', 'v1.0.0', '--dry-run']);
    await expect(runTool(db, 'capture_screenshots', { only: 'widget' }, env)).rejects.toThrow(
      /Playwright/,
    );
  });

  it('imports docs but not contacts', async () => {
    await runTool(db, 'import_docs', { source: 'zendesk', subdomain: 'acme', draft: true }, env);
    expect(cliCalls[0]).toEqual(['import', 'zendesk', '--subdomain', 'acme', '--draft']);
    await expect(runTool(db, 'import_docs', { source: 'contacts' }, env)).rejects.toThrow(
      /personal data/,
    );
  });
});

describe('evals', () => {
  it('runs the repo’s eval cases retrieval-only without a key, failures first', async () => {
    delete process.env.OPENROUTER_API_KEY;
    writeFileSync(
      join(root, 'helpwell', 'evals.json'),
      JSON.stringify([
        { id: 'c1', question: 'How do I open billing?', expect: 'billing/invoices' },
      ]),
    );
    const summary = (await runTool(db, 'run_evals', { dryRun: true }, env)) as {
      mode: string;
      recorded: boolean;
    };
    expect(summary.mode).toBe('retrieval');
    expect(summary.recorded).toBe(false);
  });
});

describe('the setup prompt', () => {
  it('covers the three clients and never carries a secret', () => {
    const prompt = mcpSetupPrompt({ projectDir: '/work/acme' });
    expect(prompt).toContain('claude mcp add helpwell --scope project -- npx -y @helpwell/mcp');
    expect(prompt).toContain('claude_desktop_config.json');
    expect(prompt).toContain('.cursor/mcp.json');
    expect(prompt).toContain('"HELPWELL_PROJECT_DIR": "/work/acme"');
    expect(prompt).toContain('<paste yourself');
    expect(prompt).not.toMatch(/sk-or-/);
  });
});

function sqlSlug(slug: string) {
  return sqlTag`slug = ${slug}`;
}
