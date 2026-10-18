/**
 * The dashboard's agent review surfaces and first-run page: confidence and
 * citations read-only in a conversation, the playbook editor, a gap drafted
 * into the article editor, eval runs with graded results and a diff between
 * runs, and the "Get set up" checklist with its setup prompts.
 */

import { FakeModel, type ScriptFn } from '@helpwell/core/agent';
import type { Article } from '@helpwell/core/content';
import { type Db, schema } from '@helpwell/core/db';
import { updateChecklistState } from '@helpwell/core/repos';
import { indexArticles } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { checklistComplete, checklistSteps, type SetupFacts } from '../src/checklist.js';
import { clientScriptFile } from '../src/client/index.js';
import { SHELL_JS } from '../src/client/shell.js';
import { createDashboard, type DashboardConfig, type DashboardHandler } from '../src/index.js';
import { compareRuns, type EvalRunRow } from '../src/pages/evals.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';
const API = '/api/support';

let db: Db;
let files: Record<'instructions' | 'playbook', string>;
let written: Map<string, string>;
let evalCases: unknown;

function article(slug: string, title: string, body: string): Article {
  return {
    slug,
    collection: slug.split('/')[0]!,
    title,
    body,
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${slug.split('/')[1]}.md`,
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    contentHash: `hash-${slug}`,
  };
}

/** Answers every question from passage 1, and grades as "weak" when asked to grade. */
const answering: ScriptFn = (request) => {
  const system = String(request.messages[0]?.content ?? '');
  if (system.includes('You grade answers')) {
    return { text: '{"verdict":"weak","reason":"Right place, but it skips the Export button."}' };
  }
  if (system.includes('You write help-centre articles')) {
    return {
      text: JSON.stringify({
        title: 'Signing in with SAML',
        description: 'Set up single sign-on for your team.',
        collection: 'Security',
        body: '## Turn it on\n\nOpen Settings, then Security. [TODO: which plans include SAML]',
      }),
    };
  }
  return {
    text: 'Open Billing, then Invoices, and choose Export CSV.',
    cites: [1],
    certainty: { level: 'answered', reason: 'passage 1 has the steps' },
  };
};

function mount(overrides: Partial<DashboardConfig> = {}): DashboardHandler {
  return createDashboard({
    db,
    basePath: BASE,
    apiPath: API,
    isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    docsDir: 'no-such-docs-folder',
    model: new FakeModel(answering),
    readInstructions: () => files.instructions,
    writeInstructions: (value) => {
      files.instructions = value;
    },
    readPlaybook: () => files.playbook,
    writePlaybook: (value) => {
      files.playbook = value;
    },
    writeArticle: (path, markdown) => {
      written.set(path, markdown);
    },
    readEvalCases: () => evalCases,
    ...overrides,
  });
}

let dashboard: DashboardHandler;

async function get(path: string, handler = dashboard): Promise<Response> {
  return handler(new Request(`${ORIGIN}${BASE}${path}`, { headers: { 'x-admin': 'yes' } }));
}

async function body(path: string, handler = dashboard): Promise<string> {
  return (await get(path, handler)).text();
}

async function post(
  path: string,
  fields: Record<string, string>,
  options: { handler?: DashboardHandler; accept?: string } = {},
): Promise<Response> {
  return (options.handler ?? dashboard)(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: {
        'x-admin': 'yes',
        'content-type': 'application/x-www-form-urlencoded',
        ...(options.accept ? { accept: options.accept } : {}),
      },
      body: new URLSearchParams(fields),
    }),
  );
}

beforeEach(async () => {
  db = (await freshDb()).db;
  await new SettingsStore(db).update({
    product: { name: 'Acme' },
    agent: { name: 'Fern', tone: 'Brisk and kind' },
  });
  await indexArticles(db, [
    article(
      'billing/invoices',
      'Exporting invoices',
      'Open Billing, then Invoices, then Export CSV.',
    ),
    article('billing/refunds', 'Refunds', 'Refunds are pro rata, to the day.'),
  ]);
  files = { instructions: '# Instructions\n\nYou are {{agent}} for {{product}}.', playbook: '' };
  written = new Map();
  evalCases = [
    { id: 'export', question: 'How do I export invoices?', expect: 'billing/invoices' },
    {
      id: 'tone',
      question: 'How do I export invoices as CSV?',
      grade: 'model',
      rubric: 'Names the Export button.',
    },
  ];
  dashboard = mount();
});

/* ------------------------------------------------------------ the review */

describe('conversation review', () => {
  beforeEach(async () => {
    await db
      .insert(schema.conversations)
      .values({ id: 'cnv_1', status: 'resolved', messageCount: 2 });
    await db.insert(schema.messages).values([
      { id: 'msg_1', conversationId: 'cnv_1', role: 'customer', body: 'How do I export invoices?' },
      {
        id: 'msg_2',
        conversationId: 'cnv_1',
        role: 'agent',
        body: 'Open **Billing**, then Invoices.',
        citations: [
          { slug: 'billing/invoices', title: 'Exporting invoices', collection: 'billing' },
        ],
        model: 'anthropic/claude-sonnet-4.5',
        latencyMs: 1840,
        costUsd: '0.004210',
        tokensIn: 1520,
        tokensOut: 88,
        confidence: 0.82,
        confidenceReason:
          'High. The docs matched <every> word; the answer cited the article it used.',
        certainty: 'answered',
        sources: [
          {
            ref: 1,
            slug: 'billing/invoices',
            title: 'Exporting invoices',
            matchedBy: ['text', 'semantic'],
            similarity: 0.642,
            cited: true,
          },
          {
            ref: 2,
            slug: 'billing/refunds',
            title: 'Refunds',
            matchedBy: ['semantic'],
            similarity: 0.31,
            cited: false,
          },
        ],
      },
    ]);
  });

  it('shows confidence, its reason, and every citation with its similarity, read-only', async () => {
    const page = await body('/conversations/cnv_1');
    expect(page).toContain('aria-label="Confidence: 0.82 out of 1"');
    // The reason is text the model helped write, so it is escaped.
    expect(page).toContain('The docs matched &lt;every&gt; word');
    expect(page).not.toContain('<every>');
    expect(page).toContain('Model said: answered');
    // The chip says how close the cited article was; the table lists every passage.
    expect(page).toContain('0.64 similar');
    expect(page).toContain('Words and meaning');
    expect(page).toMatch(/<tr data-cited="true">[\s\S]*?Exporting invoices[\s\S]*?Cited/);
    expect(page).toContain('Refunds');
    expect(page).toContain('Not used');
    // Latency, model, cost and tokens per reply.
    expect(page).toContain('1.8s');
    expect(page).toContain('anthropic/claude-sonnet-4.5');
    expect(page).toContain('$0.0042');
    expect(page).toContain('1,520 in · 88 out');
    // Read-only: nothing to set, nothing about thresholds.
    const review = page.slice(page.indexOf('class="db-review"'), page.lastIndexOf('</details>'));
    expect(review.length).toBeGreaterThan(100);
    expect(review).not.toMatch(/<input|<select|data-patch/);
    expect(page).not.toMatch(/threshold/i);
  });

  it('draws a rendered answer without blank lines, and keeps what the visitor typed as typed', async () => {
    await db.insert(schema.messages).values([
      {
        id: 'msg_3',
        conversationId: 'cnv_1',
        role: 'customer',
        body: 'Two lines\nof question',
      },
      {
        id: 'msg_4',
        conversationId: 'cnv_1',
        role: 'agent',
        body: 'You can export:\n\n- Invoices\n- Customers\n\nPut it in the `<head>`.',
      },
    ]);
    const page = await body('/conversations/cnv_1');
    expect(page).toContain(
      '<div class="db-msg__bubble db-msg__bubble--rich"><p>You can export:</p>\n<ul><li>Invoices</li><li>Customers</li></ul>',
    );
    expect(page).toContain('<code>&lt;head&gt;</code>');
    expect(page).toContain('<div class="db-msg__bubble">Two lines\nof question</div>');
    // Plain text keeps its line breaks; rendered HTML is spaced by its blocks.
    expect(page).toMatch(/\.db-msg__bubble \{[^}]*white-space: pre-wrap;/);
    expect(page).toContain('.db-msg__bubble--rich { white-space: normal; }');
  });

  it('shows nothing to review on an older reply that has no score', async () => {
    await db.insert(schema.messages).values({
      id: 'msg_3',
      conversationId: 'cnv_1',
      role: 'agent',
      body: 'Older answer.',
    });
    const page = await body('/conversations/cnv_1');
    expect(page.match(/class="db-review"/g)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- playbook */

describe('playbook editor', () => {
  it('shows each file with a preview as the agent reads it', async () => {
    const page = await body('/playbook');
    expect(page).toContain('helpwell/instructions.md');
    expect(page).toContain('You are {{agent}} for {{product}}.');
    // The preview fills the placeholders from Settings.
    expect(page).toContain('You are Fern for Acme.');
    expect(await body('/playbook?file=playbook')).toContain('helpwell/playbook.md');
  });

  it('saves the instructions and the playbook through their hooks, and reads them back', async () => {
    const saved = await post('/playbook', {
      file: 'playbook',
      content: '# House rules\r\n\r\n- Say "workspace".',
      action: 'save',
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe(`${BASE}/playbook?file=playbook&saved=1`);
    expect(files.playbook).toBe('# House rules\n\n- Say "workspace".');
    const page = await body('/playbook?file=playbook&saved=1');
    expect(page).toContain('Saved to helpwell/playbook.md');
    expect(page).toContain('Say &quot;workspace&quot;.');

    await post('/playbook', { file: 'instructions', content: 'Be {{tone}}.', action: 'save' });
    expect(files.instructions).toBe('Be {{tone}}.');
    expect(await body('/playbook')).toContain('Be Brisk and kind.');
  });

  it('previews as someone types, and hands the file back when there is no write hook', async () => {
    const preview = await dashboard(
      new Request(`${ORIGIN}${BASE}/playbook/_preview`, {
        method: 'POST',
        headers: { 'x-admin': 'yes', 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'instructions', markdown: '**{{agent}}** helps.' }),
      }),
    );
    expect(await preview.json()).toEqual({
      html: expect.stringContaining('<strong>Fern</strong>'),
    });

    const readOnly = mount({ writePlaybook: undefined });
    const response = await post(
      '/playbook',
      { file: 'playbook', content: 'Rules.', action: 'save' },
      { handler: readOnly },
    );
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('Nothing was saved');
    expect(page).toContain('Set this up with an AI assistant');
    expect(files.playbook).toBe('');
  });
});

/* ------------------------------------------------------------ gap → draft */

describe('gap to draft', () => {
  beforeEach(async () => {
    await db.insert(schema.gaps).values({
      id: 'gap_1',
      question: 'Do you support SAML SSO?',
      variants: ['Is there single sign-on?', 'Can we use Okta?'],
      asks: 4,
      status: 'new',
      suggestedCollection: 'security',
    });
  });

  it('offers a draft on the gaps list', async () => {
    const page = await body('/gaps');
    expect(page).toContain(`action="${BASE}/gaps/gap_1/draft"`);
    expect(page).toContain('Draft an article');
    expect(page).toContain('data-busy="Drafting…"');
  });

  it('drafts with the model, opens it in the editor beside the questions, and saves through writeArticle', async () => {
    const response = await post('/gaps/gap_1/draft', {});
    expect(response.status).toBe(200);
    const page = await response.text();
    // The draft, in the article editor, posting to the ordinary save.
    expect(page).toContain(`action="${BASE}/knowledge/new"`);
    expect(page).toContain('value="Signing in with SAML"');
    expect(page).toContain('[TODO: which plans include SAML]');
    expect(page).toContain('Fill in the 1 <code>[TODO: …]</code> placeholder');
    // What customers asked, beside it.
    expect(page).toContain('What customers asked');
    expect(page).toContain('Do you support SAML SSO?');
    expect(page).toContain('Can we use Okta?');
    expect(page).toContain('name="gap" value="gap_1"');
    // Nothing is saved, and the gap is untouched, until someone presses Save.
    expect(written.size).toBe(0);

    const saved = await post('/knowledge/new', {
      title: 'Signing in with SAML',
      description: 'Set up single sign-on for your team.',
      collection: 'security',
      status: 'draft',
      body: '## Turn it on\n\nOpen Settings, then Security. SAML is on the Business plan.',
      gap: 'gap_1',
      action: 'save',
    });
    expect(saved.status).toBe(303);
    expect(written.get('security/signing-in-with-saml.md')).toContain(
      'SAML is on the Business plan.',
    );
    const [gap] = await db.select().from(schema.gaps).where(sql`id = 'gap_1'`);
    expect(gap?.status).toBe('drafted');
    expect(gap?.articleSlug).toBe('security/signing-in-with-saml');
  });

  it('opens an empty article with the question when there is no model key', async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const keyless = mount({ model: undefined });
      expect(await body('/gaps', keyless)).not.toContain('Draft an article');
      const page = await (await post('/gaps/gap_1/draft', {}, { handler: keyless })).text();
      expect(page).toContain('Drafting needs a model key');
      expect(page).toContain('value="Do you support SAML SSO?"');
      expect(page).toContain('What customers asked');
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it('says so when the model does not return a usable draft', async () => {
    const broken = mount({ model: new FakeModel([{ text: 'not json at all' }]) });
    const page = await (await post('/gaps/gap_1/draft', {}, { handler: broken })).text();
    expect(page).toContain('did not return a usable draft');
    expect(page).toContain('value="Do you support SAML SSO?"');
  });

  it('404s a gap that is not there', async () => {
    expect((await post('/gaps/gap_nope/draft', {})).status).toBe(404);
  });
});

/* ------------------------------------------------------------------ evals */

describe('evals', () => {
  it('says where the cases come from before a run', async () => {
    const page = await body('/evals');
    expect(page).toContain('No eval runs yet');
    expect(page).toContain('the 2 cases in <code>helpwell/evals.json</code>');
    expect(page).toContain('Run 2 cases');
    expect(page).toContain('data-eval-run');
    // Where cases live, how to add one, and a prompt for an assistant.
    expect(page).toContain('Where eval cases live');
    expect(page).toContain('Set this up with an AI assistant');
    expect(page).toContain('npx helpwell eval');
  });

  it('runs from the dashboard and shows each graded case: verdict, grader notes, answer and citations', async () => {
    const response = await post('/evals/run', { ref: 'docs change' });
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toMatch(new RegExp(`^${BASE}/evals/evl_`));

    const page = await body(location.replace(BASE, ''));
    expect(page).toContain('Full: every question answered by the agent');
    expect(page).toContain('docs change');
    expect(page).toContain('How do I export invoices?');
    expect(page).toContain('Cited the right article');
    expect(page).toContain('Grader: Right place, but it skips the Export button.');
    // The answer, rendered, and what it cited.
    expect(page).toContain('Open Billing, then Invoices, and choose Export CSV.');
    expect(page).toContain('db-cite db-cite--expected">billing/invoices<');
    // Weak before pass: the grader called the second one weak.
    expect(page.indexOf('How do I export invoices as CSV?')).toBeLessThan(
      page.indexOf('How do I export invoices?</strong>'),
    );

    const list = await body('/evals');
    expect(list).toContain('docs change');
    expect(list).toContain('Full');
  });

  it('streams progress, one line per case, then where the result is', async () => {
    const response = await post('/evals/run', {}, { accept: 'application/x-ndjson' });
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter((line) => line.type === 'progress')).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: 'progress', index: 0, total: 2 });
    const done = lines.at(-1);
    expect(done).toMatchObject({ type: 'done' });
    expect(String(done?.location)).toMatch(new RegExp(`^${BASE}/evals/evl_`));
  });

  it('streams an error line when the cases cannot be read', async () => {
    evalCases = '{ not json';
    const response = await post('/evals/run', {}, { accept: 'application/x-ndjson' });
    const [line] = (await response.text()).trim().split('\n');
    expect(JSON.parse(line!)).toMatchObject({ type: 'error' });
    expect((await post('/evals/run', {})).headers.get('location')).toContain('/evals?error=');
  });

  it('runs a run again with its own cases', async () => {
    const first = (await post('/evals/run', {})).headers.get('location') ?? '';
    const id = first.split('/').pop() ?? '';
    evalCases = [{ id: 'other', question: 'Something else entirely?' }];
    const again = await post('/evals/run', { repeat: id });
    const page = await body((again.headers.get('location') ?? '').replace(BASE, ''));
    expect(page).toContain('How do I export invoices?');
    expect(page).not.toContain('Something else entirely?');
  });

  it('compares two runs case by case, with how each answer changed', async () => {
    const run = (id: string, at: string, cases: EvalRunRow['cases']) =>
      db.insert(schema.evalRuns).values({
        id,
        score: 50,
        passed: 1,
        weak: 0,
        failed: 1,
        costUsd: '0',
        mode: 'full',
        createdAt: new Date(at),
        cases: cases ?? [],
      });
    await run('evl_a', '2026-09-01T00:00:00Z', [
      {
        id: 'c1',
        question: 'Export?',
        verdict: 'pass',
        answer: 'Use Export CSV.',
        cited: 'billing/invoices',
        expected: null,
        ms: 10,
      },
      {
        id: 'c2',
        question: 'Refunds?',
        verdict: 'fail',
        answer: 'I am not sure.',
        cited: null,
        expected: null,
        ms: 10,
      },
      {
        id: 'c4',
        question: 'Gone?',
        verdict: 'pass',
        answer: 'x',
        cited: null,
        expected: null,
        ms: 10,
      },
    ]);
    await run('evl_b', '2026-09-02T00:00:00Z', [
      {
        id: 'c1',
        question: 'Export?',
        verdict: 'fail',
        answer: 'Ask support.',
        cited: null,
        expected: null,
        ms: 10,
      },
      {
        id: 'c2',
        question: 'Refunds?',
        verdict: 'pass',
        answer: 'Refunds are pro rata.',
        cited: 'billing/refunds',
        expected: null,
        ms: 10,
      },
      {
        id: 'c3',
        question: 'New one?',
        verdict: 'weak',
        answer: 'y',
        cited: null,
        expected: null,
        ms: 10,
      },
    ]);

    // Picked the wrong way round, it still puts the older run first.
    const page = await body('/evals/compare?a=evl_b&b=evl_a');
    expect(page).toContain('db-pill--bad">Regressed</span>');
    expect(page).toContain('db-pill--good">Fixed</span>');
    expect(page).toContain('New case');
    expect(page).toContain('Not in this run');
    // Worst news first.
    expect(page.indexOf('data-change="regressed"')).toBeLessThan(
      page.indexOf('data-change="fixed"'),
    );
    // How the answer changed, as a diff.
    expect(page).toMatch(/db-diff__line--add[\s\S]*?Refunds are pro rata\./);
    expect(page).toMatch(/db-diff__line--remove[\s\S]*?I am not sure\./);

    const runs = await body('/evals/evl_b');
    expect(runs).toContain(`href="${BASE}/evals/compare?a=evl_a&amp;b=evl_b"`);
    expect((await get('/evals/compare?a=evl_a&b=evl_nope')).status).toBe(404);
  });

  it('classifies every kind of change', () => {
    const row = (verdict: 'pass' | 'weak' | 'fail', id = 'c') => ({
      id,
      question: id,
      verdict,
      answer: '',
      cited: null,
      expected: null,
      ms: 1,
    });
    const before = {
      cases: [
        row('pass', 'a'),
        row('fail', 'b'),
        row('weak', 'c'),
        row('weak', 'd'),
        row('pass', 'e'),
        row('fail', 'f'),
      ],
    } as EvalRunRow;
    const after = {
      cases: [
        row('weak', 'a'),
        row('weak', 'b'),
        row('fail', 'c'),
        row('pass', 'd'),
        row('pass', 'e'),
        row('pass', 'g'),
      ],
    } as EvalRunRow;
    const changes = Object.fromEntries(compareRuns(before, after).map((c) => [c.id, c.change]));
    expect(changes).toEqual({
      a: 'regressed',
      b: 'better',
      c: 'worse',
      d: 'fixed',
      e: 'same',
      f: 'removed',
      g: 'added',
    });
  });
});

/* -------------------------------------------------------------- checklist */

function facts(patch: Partial<SetupFacts> = {}): SetupFacts {
  return {
    modelKey: false,
    chatModel: 'anthropic/claude-sonnet-4.5',
    docFiles: null,
    docsDir: 'docs',
    indexed: 0,
    published: 0,
    collections: 0,
    embedded: 0,
    embeddingModel: 'openai/text-embedding-3-small',
    widget: null,
    identitySecret: false,
    identified: 0,
    answered: 0,
    searchOnly: 0,
    webhooksConfigured: 0,
    webhooksDelivered: 0,
    markedDone: [],
    dismissedAt: null,
    ...patch,
  };
}

function status(f: SetupFacts, key: string): string | undefined {
  return checklistSteps(f).find((step) => step.key === key)?.status;
}

describe('setup checklist status', () => {
  it('model key: set or not', () => {
    expect(status(facts(), 'model-key')).toBe('todo');
    expect(status(facts({ modelKey: true }), 'model-key')).toBe('done');
  });

  it('content: files in the docs folder, or the index when the folder is not on this disk', () => {
    expect(status(facts({ docFiles: 0 }), 'content')).toBe('todo');
    expect(status(facts({ docFiles: 3 }), 'content')).toBe('done');
    expect(status(facts({ docFiles: null, indexed: 0 }), 'content')).toBe('todo');
    expect(status(facts({ docFiles: null, indexed: 2 }), 'content')).toBe('done');
  });

  it('index: built, missing files, or missing embeddings', () => {
    expect(status(facts(), 'index')).toBe('todo');
    const built = { indexed: 4, published: 4, embedded: 4, collections: 2 };
    expect(status(facts(built), 'index')).toBe('done');
    expect(status(facts({ ...built, embedded: 1 }), 'index')).toBe('partial');
    expect(status(facts({ ...built, embedded: 0, embeddingModel: '' }), 'index')).toBe('done');
    expect(status(facts({ ...built, docFiles: 6 }), 'index')).toBe('partial');
  });

  it('widget: seen on a page or not', () => {
    expect(status(facts(), 'widget')).toBe('todo');
    const seen = new Date();
    const f = facts({
      widget: {
        firstSeenAt: seen,
        firstPage: 'https://acme.test/app',
        lastSeenAt: seen,
        lastPage: null,
      },
    });
    expect(status(f, 'widget')).toBe('done');
    expect(checklistSteps(f).find((s) => s.key === 'widget')?.detail).toContain(
      'https://acme.test/app',
    );
  });

  it('identity (optional): someone identified, the secret waiting, or neither', () => {
    expect(status(facts(), 'identity')).toBe('todo');
    expect(status(facts({ identitySecret: true }), 'identity')).toBe('partial');
    expect(status(facts({ identified: 2 }), 'identity')).toBe('done');
    expect(checklistSteps(facts()).find((s) => s.key === 'identity')?.optional).toBe(true);
  });

  it('first answer: written by the model, only from search, or none yet', () => {
    expect(status(facts(), 'answer')).toBe('todo');
    expect(status(facts({ searchOnly: 1 }), 'answer')).toBe('partial');
    expect(status(facts({ answered: 1 }), 'answer')).toBe('done');
  });

  it('webhooks (optional): delivered, configured, or none', () => {
    expect(status(facts(), 'webhooks')).toBe('todo');
    expect(status(facts({ webhooksConfigured: 1 }), 'webhooks')).toBe('partial');
    expect(status(facts({ webhooksDelivered: 3 }), 'webhooks')).toBe('done');
  });

  it('MCP (optional): only marked done by hand, as can any optional step', () => {
    expect(status(facts(), 'mcp')).toBe('todo');
    expect(status(facts({ markedDone: ['mcp', 'identity'] }), 'mcp')).toBe('done');
    expect(status(facts({ markedDone: ['identity'] }), 'identity')).toBe('done');
    // A required step cannot be ticked off by hand.
    expect(status(facts({ markedDone: ['widget'] }), 'widget')).toBe('todo');
  });

  it('is complete when every required step is done, whatever the optional ones say', () => {
    const now = new Date();
    const required = facts({
      modelKey: true,
      docFiles: 2,
      indexed: 2,
      published: 2,
      embedded: 2,
      collections: 1,
      widget: { firstSeenAt: now, firstPage: null, lastSeenAt: now, lastPage: null },
      answered: 1,
    });
    expect(checklistComplete(checklistSteps(required))).toBe(true);
    expect(checklistComplete(checklistSteps({ ...required, answered: 0 }))).toBe(false);
  });
});

describe('the get set up page', () => {
  it('lists every step with its status, and a prompt for each with the real API path', async () => {
    const page = await body('/home');
    for (const key of [
      'model-key',
      'content',
      'index',
      'widget',
      'identity',
      'answer',
      'webhooks',
      'mcp',
    ]) {
      expect(page).toContain(`data-step="${key}"`);
    }
    // The fake model counts as a key; the index was built in beforeEach.
    expect(page).toMatch(/data-step="model-key" data-status="done"/);
    expect(page).toMatch(/data-step="widget" data-status="todo"/);
    expect(page).toContain(
      '&lt;script src="/api/support/assets/loader.js" defer&gt;&lt;/script&gt;',
    );
    expect(page.match(/Set this up with an AI assistant/g)?.length).toBeGreaterThanOrEqual(8);
    expect(page).toContain('http://localhost/api/support/assets/loader.js');
  });

  it('has a widget prompt for each framework, with the loader, where it goes and how to check it', async () => {
    for (const [framework, marker] of [
      ['html', 'before </body>'],
      ['nextjs', "import Script from 'next/script'"],
      ['react-vite', 'index.html'],
      ['vue', 'src/main.ts'],
      ['sveltekit', 'src/app.html'],
      ['rails', 'application.html.erb'],
      ['django', 'base.html'],
    ] as const) {
      const page = await body(`/home?framework=${framework}`);
      const prompt = /id="setup-prompt-widget-[^"]+">([\s\S]*?)<\/pre>/.exec(page)?.[1] ?? '';
      expect(prompt, framework).toContain('/api/support/assets/loader.js');
      expect(prompt, framework).toContain(
        marker.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;'),
      );
      expect(prompt, framework).toContain('launcher appears');
      expect(prompt, framework).toContain('checklist');
    }
  });

  it('never puts a secret in a prompt, even when one is set', async () => {
    const before = process.env.OPENROUTER_API_KEY;
    process.env.HELPWELL_IDENTITY_SECRET = 'identity-secret-value-123';
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-real-looking-key-456';
    try {
      const page = await body('/home?framework=nextjs');
      expect(page).not.toContain('identity-secret-value-123');
      expect(page).not.toContain('sk-or-v1-real-looking-key-456');
      const prompts = [
        ...page.matchAll(/class="db-code db-prompt__text"[^>]*>([\s\S]*?)<\/pre>/g),
      ].map((match) => match[1] ?? '');
      expect(prompts.length).toBeGreaterThanOrEqual(8);
      for (const prompt of prompts) {
        expect(prompt).toContain(
          'Never ask me to paste a password, API key, token or other secret',
        );
      }
      expect(page).toMatch(/data-step="identity" data-status="partial"/);
    } finally {
      delete process.env.HELPWELL_IDENTITY_SECRET;
      if (before === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = before;
    }
  });

  it('marks an optional step done by hand, and takes it back', async () => {
    expect((await post('/home', { action: 'mark', step: 'mcp' })).status).toBe(303);
    expect(await body('/home')).toMatch(/data-step="mcp" data-status="done"/);
    await post('/home', { action: 'undo', step: 'mcp' });
    expect(await body('/home')).toMatch(/data-step="mcp" data-status="todo"/);
    // A required step cannot be marked by hand.
    await post('/home', { action: 'mark', step: 'widget' });
    expect(await body('/home')).toMatch(/data-step="widget" data-status="todo"/);
  });

  it('can only be put away once every required step is done, and the rail forgets it', async () => {
    expect((await post('/home', { action: 'dismiss' })).headers.get('location')).toBe(
      `${BASE}/home`,
    );
    expect(await body('/conversations')).toContain(`href="${BASE}/home"`);

    // Finish the required steps: the widget loads, and the agent answers.
    await db.execute(sql`
      INSERT INTO helpwell.install_state (key, value)
      VALUES ('widget_seen', ${JSON.stringify({ firstSeenAt: new Date().toISOString(), firstPage: 'https://acme.test/' })}::jsonb)
    `);
    await db
      .insert(schema.conversations)
      .values({ id: 'cnv_1', status: 'resolved', messageCount: 2 });
    await db.insert(schema.messages).values({
      id: 'msg_1',
      conversationId: 'cnv_1',
      role: 'agent',
      body: 'Answer.',
      model: 'anthropic/claude-sonnet-4.5',
    });
    const done = mount({ docsDir: 'no-such-docs-folder' });
    const settings = new SettingsStore(db);
    await settings.update({ agent: { models: { embeddings: '' } } });
    const page = await body('/home', done);
    expect(page).toContain('Put the checklist away');

    const dismissed = await post('/home', { action: 'dismiss' }, { handler: done });
    expect(dismissed.headers.get('location')).toBe(`${BASE}/conversations`);
    const after = await body('/conversations', done);
    expect(after).not.toContain(`href="${BASE}/home"`);
    expect((await get('', done)).headers.get('location')).toBe(`${BASE}/conversations`);
    // Still there to bring back.
    expect(await body('/home', done)).toContain('Bring it back');
    await updateChecklistState(db, { dismissed: false });
    expect(await body('/conversations', done)).toContain(`href="${BASE}/home"`);
  });
});

/* ---------------------------------------------------------- settings copy */

describe('settings copy and controls', () => {
  it('describes each agent tool by what it actually does', async () => {
    const page = await body('/settings?tab=agent');
    expect(page).not.toContain('Propose the doc that should exist');
    expect(page).not.toContain('The agent is useless without this');
    expect(page).not.toContain('off unless you turn them on');
    expect(page).toContain('Every answer already starts from a search of the question');
    expect(page).toContain('by its exact slug');
    expect(page).toContain('HelpWell sends nothing to it');
    expect(page).not.toMatch(/threshold|escalat/i);
  });

  it('edits the home blocks as an ordered list, and the status, media and bot check', async () => {
    const widget = await body('/settings?tab=widget');
    expect(widget).toContain('data-blocks="db-home-blocks"');
    expect(widget).toContain('data-block-move="up"');
    expect(widget).toContain('data-block-template="links"');
    expect(widget).toContain('data-patch="widget.status.mode"');
    expect(widget).toContain('data-patch="widget.status.message"');
    expect(widget).toContain('data-patch="widget.media.inlineVideo"');
    // The island saves JSON from the editor's hidden input; the editor's own
    // script keeps that input in step. Both are served files.
    expect(SHELL_JS).toContain("getAttribute('data-patch-type') === 'json'");
    expect(widget).toContain(`src="${BASE}/_assets/${clientScriptFile('home-blocks')}"`);

    const agent = await body('/settings?tab=agent');
    expect(agent).toContain('data-patch="agent.abuse.botCheck"');
    expect(agent).toContain('data-patch="agent.abuse.turnstileSiteKey"');
    expect(agent).toContain('data-patch="agent.abuse.blockedIps" data-patch-type="list"');
  });

  it('asks the API about the Turnstile secret and the status page, and shows its own guess first', async () => {
    const agent = await body('/settings?tab=agent');
    expect(agent).toContain('data-widget-checks="/api/support/admin/widget/checks"');
    expect(agent).toContain('data-secret-env="HELPWELL_TURNSTILE_SECRET"');
    expect(agent).toContain('data-check="botcheck"');
    expect(agent).toContain('Off: no challenge is shown.');
    const widget = await body('/settings?tab=widget');
    expect(widget).toContain('data-widget-checks="/api/support/admin/widget/checks"');
    expect(widget).toContain('data-check="status"');
  });

  it('adds the CSP the widget needs for what is switched on to the install prompt', async () => {
    await new SettingsStore(db).update({
      widget: { media: { inlineVideo: true } },
      agent: { abuse: { botCheck: 'turnstile' } },
    });
    const fresh = mount();
    const page = await body('/home?framework=html', fresh);
    const prompt = /id="setup-prompt-widget-html">([\s\S]*?)<\/pre>/.exec(page)?.[1] ?? '';
    expect(prompt).toContain(
      'Content-Security-Policy additions (with inline video and the bot check switched on)',
    );
    expect(prompt).toContain('https://www.youtube-nocookie.com');
    expect(prompt).toContain('https://challenges.cloudflare.com');
    expect(prompt).toContain('connect-src');
  });
});
