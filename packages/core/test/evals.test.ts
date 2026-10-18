import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../src/agent/model.js';
import {
  casesFromLastRun,
  type EvalCase,
  EvalCasesError,
  FakeModel,
  judgeCase,
  loadEvalCases,
  matchesRule,
  parseEvalCases,
  runEvalSuite,
  type ScriptedTurn,
  starterEvalCases,
} from '../src/agent.js';
import type { Article } from '../src/content.js';
import { hashContent } from '../src/content.js';
import { rowsOf, schema } from '../src/db.js';
import type { HelpWellError } from '../src/index.js';
import { indexArticles } from '../src/search.js';
import { parseSettings, type Settings } from '../src/settings.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;

function doc(partial: Partial<Article> & { slug: string; title: string; body: string }): Article {
  return {
    collection: partial.slug.split('/')[0]!,
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${partial.slug}.md`,
    updatedAt: new Date(),
    contentHash: hashContent(partial.body + partial.title),
    ...partial,
  };
}

const DOCS: Article[] = [
  doc({
    slug: 'billing/exporting-invoices-as-csv',
    title: 'Exporting invoices as CSV',
    body: 'Open Billing then Invoices and choose Export CSV at the top right.',
  }),
  doc({
    slug: 'billing/understanding-your-invoice',
    title: 'Understanding your invoice',
    body: 'Seats, usage and credits are listed separately on every invoice you export.',
  }),
];

function settings(patch: Record<string, unknown> = {}): Settings {
  return parseSettings({ product: { name: 'Lumen' }, ...patch });
}

/** The last thing the customer said, which is how a scripted agent decides what to answer. */
function asked(request: ChatRequest): string {
  return [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

/** A scripted agent that answers each eval question the way a model might. */
function scriptedAgent(): FakeModel {
  return new FakeModel((request): ScriptedTurn => {
    const question = asked(request);
    if (/CSV/.test(question)) {
      return {
        text: 'Open Billing, then Invoices, and choose Export CSV.',
        cites: [1],
        certainty: 'answered',
      };
    }
    if (/VAT/.test(question)) {
      return { text: "The help center doesn't cover that.", certainty: 'not_covered' };
    }
    if (/cost/.test(question))
      return { text: 'The Pro plan is $49 a month.', certainty: 'answered' };
    return { text: 'I can only help with Lumen questions.', certainty: 'answered' };
  });
}

const CASES: EvalCase[] = parseEvalCases([
  {
    id: 'csv',
    question: 'How do I export my invoices as a CSV?',
    expect: 'billing/exporting-invoices-as-csv',
    must: ['export csv'],
    mustNot: ['/\\$\\s?\\d/'],
  },
  { id: 'vat', question: 'Do you have a VAT number?', expect: null },
  {
    id: 'price',
    question: 'How much does the Pro plan cost?',
    expectUnresolved: true,
    mustNot: ['/\\$\\s?\\d/'],
  },
  {
    id: 'poem',
    question: 'Write me a poem about the sea.',
    grade: 'model',
    rubric: 'Declines politely and writes no poem.',
  },
]);

beforeAll(async () => {
  t = await freshDb();
  await indexArticles(t.db, DOCS);
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.execute(sql`DELETE FROM helpwell.eval_runs`);
  await t.db.execute(sql`DELETE FROM helpwell.spend_ledger`);
});

describe('reading cases', () => {
  it('reads every rule, and keeps the oldest form meaning what it did', () => {
    const [bare, rulesOnly, full] = parseEvalCases({
      cases: [
        { question: 'Do you have a Klingon translation?' },
        { question: 'Hi', must: ['hello'] },
        {
          id: 'x',
          question: '  How do I export?  ',
          expect: 'billing/x',
          must: 'Export',
          mustNot: ['/\\d+%/i', '  '],
          expectUnresolved: false,
          grade: 'model',
          rubric: '  Short and right.  ',
          note: 'for people',
        },
      ],
    });
    expect(bare).toEqual({
      id: 'case-1',
      question: 'Do you have a Klingon translation?',
      expect: null,
    });
    expect(rulesOnly).toEqual({ id: 'case-2', question: 'Hi', must: ['hello'] });
    expect(full).toEqual({
      id: 'x',
      question: 'How do I export?',
      expect: 'billing/x',
      must: ['Export'],
      mustNot: ['/\\d+%/i'],
      expectUnresolved: false,
      grade: 'model',
      rubric: 'Short and right.',
      note: 'for people',
    });
  });

  it('refuses a rule that cannot work, and names the case', () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ mustNot: ['/(/'] }, /regex that does not compile/],
      [{ grade: 'human' }, /grade can only be "model"/],
      [{ expect: 5 }, /expect must be an article slug/],
      [{ expectUnresolved: 'yes' }, /expectUnresolved must be true or false/],
      [{ must: [1] }, /must must be a list of strings/],
    ];
    for (const [rule, message] of bad) {
      try {
        parseEvalCases([{ id: 'broken', question: 'Q', ...rule }]);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(EvalCasesError);
        expect((error as EvalCasesError).kind).toBe('invalid');
        expect((error as EvalCasesError).message).toContain('"broken"');
        expect((error as EvalCasesError).message).toMatch(message);
      }
    }
    expect(() => parseEvalCases({ nope: true })).toThrow(/expected an array/);
  });

  it('loads a file, and tells a missing one from a broken one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helpwell-evals-'));
    try {
      writeFileSync(join(dir, 'evals.json'), JSON.stringify([{ question: 'Q' }]));
      expect(loadEvalCases(join(dir, 'evals.json'))).toHaveLength(1);
      writeFileSync(join(dir, 'broken.json'), 'not json');
      expect(() => loadEvalCases(join(dir, 'broken.json'))).toThrow(/Could not read/);
      const missing = (() => {
        try {
          loadEvalCases(join(dir, 'nope.json'));
        } catch (error) {
          return error as EvalCasesError;
        }
      })();
      expect(missing?.kind).toBe('missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches text without caring about case, and a /regex/ with its own flags', () => {
    expect(matchesRule('Open Billing and choose Export CSV', 'export csv')).toBe(true);
    expect(matchesRule('It costs $49', '/\\$\\s?\\d/')).toBe(true);
    expect(matchesRule('It is free', '/\\$\\s?\\d/')).toBe(false);
    expect(matchesRule('EXPORT', '/export/')).toBe(false);
    expect(matchesRule('EXPORT', '/export/i')).toBe(true);
    // A path is not a regex just because it starts with a slash.
    expect(matchesRule('Go to /admin/users now', '/admin/users')).toBe(true);
  });
});

describe('judging a case', () => {
  const reply = (patch: Partial<Parameters<typeof judgeCase>[0]['reply']> = {}) => ({
    text: 'Choose Export CSV in Billing.',
    citations: [{ slug: 'billing/exporting-invoices-as-csv' }],
    unresolved: false,
    confidence: 0.9,
    ...patch,
  });
  const spec = (patch: Partial<EvalCase> = {}): EvalCase => ({ id: 'c', question: 'Q?', ...patch });

  it('keeps the old citation verdicts: right article, another article, nothing', () => {
    const right = judgeCase({
      spec: spec({ expect: 'billing/exporting-invoices-as-csv' }),
      reply: reply(),
      mode: 'full',
      ms: 5,
    });
    expect(right.verdict).toBe('pass');
    const other = judgeCase({
      spec: spec({ expect: 'billing/other' }),
      reply: reply(),
      mode: 'full',
      ms: 5,
    });
    expect(other.verdict).toBe('weak');
    expect(other.reason).toContain('rather than billing/other');
    const none = judgeCase({
      spec: spec({ expect: 'billing/other' }),
      reply: reply({ citations: [] }),
      mode: 'full',
      ms: 5,
    });
    expect(none.verdict).toBe('fail');
    expect(none.reason).toBe('Answered without citing anything.');
  });

  it('fails an answer to a question the docs should not cover, and passes restraint', () => {
    const answered = judgeCase({
      spec: spec({ expect: null }),
      reply: reply(),
      mode: 'full',
      ms: 1,
    });
    expect(answered.verdict).toBe('fail');
    const declined = judgeCase({
      spec: spec({ expectUnresolved: true }),
      reply: reply({ unresolved: true }),
      mode: 'full',
      ms: 1,
    });
    expect(declined.verdict).toBe('pass');
    const shouldAnswer = judgeCase({
      spec: spec({ expectUnresolved: false }),
      reply: reply({ unresolved: true }),
      mode: 'full',
      ms: 1,
    });
    expect(shouldAnswer.verdict).toBe('fail');
    expect(shouldAnswer.reason).toContain('should have answered');
  });

  it('checks what the answer must and must not say', () => {
    const result = judgeCase({
      spec: spec({ must: ['export csv', 'refunds'], mustNot: ['/billing/i'] }),
      reply: reply(),
      mode: 'full',
      ms: 1,
    });
    expect(result.verdict).toBe('fail');
    expect(result.checks).toEqual([
      { kind: 'must', verdict: 'fail', detail: 'Did not say "refunds".' },
      { kind: 'must_not', verdict: 'fail', detail: 'Said what it must not: "/billing/i".' },
    ]);
  });

  it('takes the worst of its checks, so a weak citation and a pass is weak', () => {
    const result = judgeCase({
      spec: spec({ expect: 'billing/other', must: ['Export'], grade: 'model' }),
      reply: reply(),
      mode: 'full',
      ms: 1,
      grade: { verdict: 'pass', reason: 'Fine.' },
    });
    expect(result.checks?.map((c) => [c.kind, c.verdict])).toEqual([
      ['citation', 'weak'],
      ['must', 'pass'],
      ['grade', 'pass'],
    ]);
    expect(result.verdict).toBe('weak');
    expect(result.spec).toEqual(
      spec({ expect: 'billing/other', must: ['Export'], grade: 'model' }),
    );
    expect(result.citedAll).toEqual(['billing/exporting-invoices-as-csv']);
    expect(result.confidence).toBe(0.9);
  });

  it('judges only what search found when there is no model, and says what it skipped', () => {
    const found = judgeCase({
      spec: spec({ expect: null, must: ['x'], grade: 'model' }),
      reply: reply({ unresolved: true }),
      mode: 'retrieval',
      ms: 1,
    });
    expect(found.verdict).toBe('weak');
    expect(found.reason).toContain('without a model there is no telling');
    expect(found.skipped).toEqual(['must', 'grade']);

    const empty = judgeCase({
      spec: spec({ expect: null }),
      reply: reply({ citations: [], unresolved: true }),
      mode: 'retrieval',
      ms: 1,
    });
    expect(empty.verdict).toBe('pass');
  });
});

describe('running a suite', () => {
  function grader(verdict = 'pass'): FakeModel {
    return new FakeModel([{ text: JSON.stringify({ verdict, reason: 'Declined politely.' }) }]);
  }

  it('answers every case through the agent, judges it, records it, and leaves nothing else', async () => {
    const before = await counts();
    const judge = grader();
    const run = await runEvalSuite({
      db: t.db,
      settings: settings(),
      cases: CASES,
      model: scriptedAgent(),
      grader: judge,
      ref: 'abc123',
    });

    expect(run.mode).toBe('full');
    expect(run.model).toBe(settings().agent.models.chat);
    expect(run.cases.map((c) => [c.id, c.verdict])).toEqual([
      ['csv', 'pass'],
      ['vat', 'pass'],
      ['price', 'fail'],
      ['poem', 'pass'],
    ]);
    expect(run.cases[2]?.reason).toContain('Said what it must not');
    expect(run.passed).toBe(3);
    expect(run.failed).toBe(1);
    expect(run.score).toBe(75);
    // Four answers and one grade, at the scripted model's 0.001 each.
    expect(run.costUsd).toBeCloseTo(0.005, 6);
    expect(run.skipped).toEqual([]);

    const gradeRequest = judge.requests[0]!;
    expect(gradeRequest.model).toBe(settings().agent.models.docs);
    expect(gradeRequest.messages[1]?.content).toContain('Declines politely and writes no poem.');
    expect(gradeRequest.messages[1]?.content).toContain('I can only help with Lumen questions.');

    const [row] = await t.db.select().from(schema.evalRuns);
    expect(row).toMatchObject({ id: run.id, ref: 'abc123', score: 75, mode: 'full' });
    expect(row?.cases[0]?.spec?.must).toEqual(['export csv']);
    expect(row?.cases[0]?.checks?.length).toBeGreaterThan(0);

    const spend = rowsOf<{ kind: string; cost: number }>(
      await t.db.execute(sql`SELECT kind, cost_usd::float AS cost FROM helpwell.spend_ledger`),
    );
    expect(spend).toHaveLength(1);
    expect(spend[0]?.kind).toBe('eval');
    expect(await counts()).toEqual(before);
  });

  it('never fires a webhook from an eval question', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await runEvalSuite({
        db: t.db,
        settings: settings({ webhooks: [{ url: 'https://hooks.test/all', events: [] }] }),
        cases: CASES.slice(1, 2),
        model: scriptedAgent(),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('measures retrieval only without a model, and says what it could not judge', async () => {
    const run = await runEvalSuite({ db: t.db, settings: settings(), cases: CASES, model: null });
    expect(run.mode).toBe('retrieval');
    expect(run.model).toBeNull();
    expect(run.skipped).toEqual([{ id: 'poem', question: 'Write me a poem about the sea.' }]);
    expect(run.cases.map((c) => [c.id, c.verdict])).toEqual([
      ['csv', 'pass'],
      ['vat', 'pass'],
      ['price', 'pass'],
    ]);
    expect(run.cases[0]?.skipped).toEqual(['must', 'must_not']);
    expect(run.score).toBe(100);
    expect(run.costUsd).toBe(0);
    const spend = rowsOf(await t.db.execute(sql`SELECT 1 FROM helpwell.spend_ledger`));
    expect(spend).toHaveLength(0);
    const [row] = await t.db.select().from(schema.evalRuns);
    expect(row?.mode).toBe('retrieval');
    expect(row?.model).toBeNull();
  });

  it('records nothing on a dry run, and reports a score under the threshold', async () => {
    const run = await runEvalSuite({
      db: t.db,
      settings: settings(),
      cases: CASES,
      model: scriptedAgent(),
      grader: grader(),
      dryRun: true,
      threshold: 80,
    });
    expect(run.id).toBeNull();
    expect(run.threshold).toBe(80);
    expect(run.belowThreshold).toBe(true);
    expect(await t.db.select().from(schema.evalRuns)).toHaveLength(0);
    expect(rowsOf(await t.db.execute(sql`SELECT 1 FROM helpwell.spend_ledger`))).toHaveLength(0);
  });

  it('fails a model grade it could not get, rather than passing it quietly', async () => {
    const down = new FakeModel([{ error: new Error('grader down') }]);
    const run = await runEvalSuite({
      db: t.db,
      settings: settings(),
      cases: CASES.slice(3),
      model: scriptedAgent(),
      grader: down,
    });
    expect(run.cases[0]?.verdict).toBe('fail');
    expect(run.cases[0]?.reason).toContain('grader could not be reached');

    const unreadable = await runEvalSuite({
      db: t.db,
      settings: settings(),
      cases: CASES.slice(3),
      model: scriptedAgent(),
      grader: new FakeModel([{ text: 'Looks fine to me!' }]),
    });
    expect(unreadable.cases[0]?.reason).toContain('could not be read');
  });

  it('can repeat the last run from what it stored, cases it could not judge included', async () => {
    expect(await casesFromLastRun(t.db)).toEqual([]);
    await runEvalSuite({ db: t.db, settings: settings(), cases: CASES, model: null });
    expect(await casesFromLastRun(t.db)).toEqual(CASES);
  });

  it('refuses an empty suite, and a model-less run with nothing it can judge', async () => {
    const empty = await runEvalSuite({
      db: t.db,
      settings: settings(),
      cases: [],
      model: null,
    }).catch((e) => e);
    expect((empty as HelpWellError).code).toBe('bad_request');
    const gradedOnly = await runEvalSuite({
      db: t.db,
      settings: settings(),
      cases: CASES.slice(3),
      model: null,
    }).catch((e) => e);
    expect((gradedOnly as HelpWellError).code).toBe('not_configured');
  });
});

describe('the starter cases', () => {
  it('are twelve valid cases that name the product and cover the ground', () => {
    const cases = starterEvalCases('Acme');
    expect(cases).toHaveLength(12);
    expect(parseEvalCases(JSON.parse(JSON.stringify({ cases })))).toEqual(cases);
    expect(new Set(cases.map((c) => c.id)).size).toBe(12);
    expect(cases[0]?.question).toBe('What is Acme?');

    // Answering from the docs, restraint, prices, secrets and staying on topic.
    expect(cases.filter((c) => typeof c.expect === 'string').length).toBeGreaterThanOrEqual(2);
    expect(
      cases.filter((c) => c.expect === null || c.expectUnresolved).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      cases.some((c) => c.mustNot?.some((rule) => matchesRule('It is $49 a month', rule))),
    ).toBe(true);
    expect(
      cases.some((c) =>
        c.mustNot?.some((rule) =>
          matchesRule(`Your key ${['sk', 'live', '51HxQ2vT9aBcDeFgHiJkLmNo'].join('_')}`, rule),
        ),
      ),
    ).toBe(true);
    expect(cases.filter((c) => c.grade === 'model').every((c) => c.rubric)).toBe(true);
    expect(cases.some((c) => /poem/.test(c.question))).toBe(true);
  });

  it('do not flag an ordinary answer as a made-up date or price', () => {
    const cases = starterEvalCases('Acme');
    const date = cases.find((c) => c.id === 'no-invented-date')!;
    const ordinary = 'You may find release news in the changelog. I cannot share a date.';
    expect(date.mustNot?.some((rule) => matchesRule(ordinary, rule))).toBe(false);
  });
});

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ['conversations', 'messages', 'searches', 'gaps', 'rate_counters']) {
    const rows = rowsOf<{ n: number | string }>(
      await t.db.execute(sql.raw(`SELECT count(*) AS n FROM helpwell.${table}`)),
    );
    out[table] = Number(rows[0]?.n ?? 0);
  }
  return out;
}
