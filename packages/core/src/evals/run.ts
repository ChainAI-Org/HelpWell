/**
 * Running an eval suite: every case through the real agent, judged, scored
 * and recorded where the dashboard's Evals page reads it (`eval_runs`).
 *
 * The CLI (`helpwell eval`), the admin API (`POST /admin/evals/run`) and
 * anything else that wants a score call this, so a run means the same thing
 * wherever it started.
 *
 * Each case runs inside a transaction that is rolled back on purpose. The
 * agent writes a conversation, messages, a search, a spend row and sometimes
 * a gap for every reply; forty eval questions must not show up as forty
 * customers on the reports page, nor drain the daily spend cap or the
 * per-visitor hourly limit that gate real ones. Webhooks are switched off for
 * the run as well, because a rolled-back row cannot un-send a request: an
 * eval question the docs do not cover must not page anyone. What survives is
 * one `eval_runs` row and one spend row of kind `eval` for the whole run.
 *
 * With no model the run measures retrieval only: every answer is what search
 * alone would give, the checks that need an answer or a grader are skipped,
 * and cases with nothing else to check are left out of the score and listed.
 * The run records which it was, because the two scores are not comparable.
 */

import { sql } from 'drizzle-orm';
import { Agent, type AgentReply } from '../agent/agent.js';
import { recordSpend } from '../agent/guards.js';
import type { ChatResponse, EmbedResponse, ModelPort, Usage } from '../agent/model.js';
import type { AgentModels } from '../agent/model-factory.js';
import type { Db } from '../db/client.js';
import type { EvalCaseResult } from '../db/schema.js';
import { evalRuns } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';
import type { Settings } from '../settings/schema.js';
import { type EvalCase, parseEvalCases } from './cases.js';
import { DEFAULT_RUBRIC, gradeAnswer } from './grade.js';
import { type EvalMode, judgeableWithoutModel, judgeCase } from './judge.js';

export interface EvalRunOptions {
  db: Db;
  settings: Settings;
  cases: EvalCase[];
  /**
   * The model the agent answers with. Null runs retrieval only: no model is
   * called and nothing is spent.
   */
  model: ModelPort | null;
  /** Grades `grade: "model"` cases with `settings.agent.models.docs`. Defaults to `model`. */
  grader?: ModelPort | null;
  /** The agent's fallback and embeddings ports, when a host's `modelFactory` supplies them. */
  models?: AgentModels;
  /** instructions.md and playbook.md, as the agent would have them. */
  instructions?: string;
  playbook?: string;
  /** A label stored with the run, e.g. the commit SHA, so runs can be told apart. */
  ref?: string | null;
  /** Judge and score, but record nothing. */
  dryRun?: boolean;
  /** The score a CI run needs; `belowThreshold` says whether it fell short. */
  threshold?: number;
  /** Called before each case, for a progress bar. */
  onProgress?: (progress: { index: number; total: number; case: EvalCase }) => void;
}

export interface EvalRunResult {
  /** The `eval_runs` row, or null on a dry run. */
  id: string | null;
  ref: string | null;
  mode: EvalMode;
  /** The chat model that answered; null for a retrieval-only run. */
  model: string | null;
  /** 0-100: passes plus half the weak cases, over every case judged. */
  score: number;
  passed: number;
  weak: number;
  failed: number;
  /** What the answers and the grading cost. 0 for a retrieval-only run. */
  costUsd: number;
  medianMs: number | null;
  cases: EvalCaseResult[];
  /** Cases a retrieval-only run could not judge, because every rule they have needs a model. */
  skipped: { id: string; question: string }[];
  threshold: number | null;
  belowThreshold: boolean;
  createdAt: Date;
}

/** Thrown on purpose at the end of each case so its transaction rolls back. */
class EvalRollback extends Error {
  constructor(
    readonly reply: AgentReply,
    readonly ms: number,
  ) {
    super('eval case complete');
    this.name = 'EvalRollback';
  }
}

/** What a retrieval-only run answers with: nothing, so the agent falls back to search. */
class NoModel implements ModelPort {
  async chat(): Promise<ChatResponse> {
    throw new HelpWellError('not_configured', 'This eval run has no model.');
  }

  async embed(): Promise<EmbedResponse> {
    throw new HelpWellError('not_configured', 'This eval run has no model.');
  }
}

export async function runEvalSuite(options: EvalRunOptions): Promise<EvalRunResult> {
  if (options.cases.length === 0) {
    throw new HelpWellError('bad_request', 'There are no eval cases to run.');
  }

  const mode: EvalMode = options.model ? 'full' : 'retrieval';
  const model = options.model ?? new NoModel();
  const grader = options.grader === undefined ? options.model : options.grader;
  const settings: Settings = { ...options.settings, webhooks: [] };

  const runnable =
    mode === 'full' ? options.cases : options.cases.filter((spec) => judgeableWithoutModel(spec));
  const skipped = options.cases
    .filter((spec) => !runnable.includes(spec))
    .map((spec) => ({ id: spec.id, question: spec.question }));
  if (runnable.length === 0) {
    throw new HelpWellError(
      'not_configured',
      'Every case needs a model to judge it, and this run has none. Set an OpenRouter key, or add cases with "expect".',
    );
  }

  const usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const results: EvalCaseResult[] = [];

  for (const [index, spec] of runnable.entries()) {
    options.onProgress?.({ index, total: runnable.length, case: spec });

    const { reply, ms } = await answerAndRollBack(options.db, spec.question, (tx) => {
      return new Agent({
        db: tx,
        settings,
        model,
        // A retrieval-only run calls no model at all, embeddings included.
        models: mode === 'full' ? options.models : undefined,
        instructions: options.instructions,
        playbook: options.playbook,
      });
    });
    accumulate(usage, reply.usage);

    let grade: { verdict: 'pass' | 'weak' | 'fail'; reason: string } | null = null;
    if (mode === 'full' && spec.grade === 'model' && grader) {
      const graded = await gradeAnswer({
        model: grader,
        modelName: settings.agent.models.docs,
        productName: settings.product.name || 'the product',
        question: spec.question,
        answer: reply.text,
        rubric: spec.rubric ?? spec.note ?? DEFAULT_RUBRIC,
        citations: reply.citations,
        unresolved: reply.unresolved,
      });
      accumulate(usage, graded.usage);
      grade = { verdict: graded.verdict, reason: graded.reason };
    }

    results.push(
      judgeCase({
        spec,
        reply: {
          text: reply.text,
          citations: reply.citations,
          unresolved: reply.unresolved,
          confidence: reply.confidence ?? null,
        },
        mode,
        ms,
        grade,
      }),
    );
  }

  const passed = results.filter((r) => r.verdict === 'pass').length;
  const weak = results.filter((r) => r.verdict === 'weak').length;
  const failed = results.filter((r) => r.verdict === 'fail').length;
  // Weak counts half: relevant but not right is better than nothing and worse
  // than right. The same rule the score has always had.
  const score = Math.round(((passed + weak * 0.5) / results.length) * 100);
  const medianMs = median(results.map((r) => r.ms));
  const createdAt = new Date();
  const costUsd = Number(usage.costUsd.toFixed(6));
  const chatModel = mode === 'full' ? settings.agent.models.chat : null;

  let id: string | null = null;
  if (!options.dryRun) {
    id = newId(idPrefix.evalRun);
    await options.db.insert(evalRuns).values({
      id,
      ref: options.ref ?? null,
      score,
      passed,
      weak,
      failed,
      costUsd: costUsd.toFixed(6),
      medianMs,
      cases: results,
      mode,
      model: chatModel,
      suite: options.cases,
      createdAt,
    });
    // One ledger row for the whole run: the cost shows on the reports page
    // without a single conversation being left behind.
    if (usage.tokensIn > 0 || usage.tokensOut > 0 || usage.costUsd > 0) {
      await recordSpend(options.db, {
        kind: 'eval',
        model: settings.agent.models.chat,
        usage,
      });
    }
  }

  const threshold = options.threshold ?? null;
  return {
    id,
    ref: options.ref ?? null,
    mode,
    model: chatModel,
    score,
    passed,
    weak,
    failed,
    costUsd,
    medianMs,
    cases: results,
    skipped,
    threshold,
    belowThreshold: threshold !== null && score < threshold,
    createdAt,
  };
}

/**
 * The cases the most recent run was given, including any it could not judge,
 * so a run can be repeated from the dashboard, which cannot read
 * `helpwell/evals.json`. Empty when there is no run, or it predates the suite
 * being stored.
 */
export async function casesFromLastRun(db: Db): Promise<EvalCase[]> {
  const [latest] = await db
    .select({ suite: evalRuns.suite })
    .from(evalRuns)
    .orderBy(sql`created_at DESC`)
    .limit(1);
  return latest ? parseEvalCases(latest.suite) : [];
}

/** One answer, in a transaction that is then rolled back. */
async function answerAndRollBack(
  db: Db,
  question: string,
  agentFor: (tx: Db) => Agent,
): Promise<{ reply: AgentReply; ms: number }> {
  try {
    await db.transaction(async (tx) => {
      const started = Date.now();
      const reply = await agentFor(tx).reply({ message: question });
      throw new EvalRollback(reply, Date.now() - started);
    });
  } catch (error) {
    if (error instanceof EvalRollback) return { reply: error.reply, ms: error.ms };
    throw error;
  }
  throw new Error('An eval case finished without rolling back.');
}

function accumulate(total: Usage, add: Usage): void {
  total.tokensIn += add.tokensIn;
  total.tokensOut += add.tokensOut;
  total.costUsd += add.costUsd;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? null);
}
