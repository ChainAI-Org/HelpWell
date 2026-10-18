/**
 * `helpwell eval` — replay a set of real questions and score the answers.
 *
 * This is the thing that makes a docs change measurable. Each case in
 * `helpwell/evals.json` is a question and the rules its answer is held to: the
 * article it should cite, text it must or must not contain, whether it should
 * be marked unresolved, and optionally a rubric the writing model grades it
 * against. A run records its verdicts, so two runs either side of a change are
 * comparable and a regression shows up as a number rather than a feeling
 * (EV-01..EV-06).
 *
 * The engine is core's (`runEvalSuite`), shared with the dashboard's admin
 * API, so a run means the same thing wherever it started. This file reads the
 * cases, picks the model, and prints. Each case runs in a rolled-back
 * transaction there: nothing but the run itself, and one spend row for it, is
 * left behind.
 *
 * Without OPENROUTER_API_KEY the run measures retrieval only: what search
 * alone finds for each question. It says so, records it as such, and leaves
 * out the cases only a model could judge.
 */

import { join, relative, sep } from 'node:path';
import { HelpWellError } from '@helpwell/core';
import {
  type EvalCase,
  EvalCasesError,
  type EvalRunResult,
  loadEvalCases,
  type ModelPort,
  OpenRouterModel,
  runEvalSuite,
} from '@helpwell/core/agent';
import type { EvalCaseResult } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { loadProject, openDb } from '../project.js';
import { traced } from '../traced.js';
import { detail, fail, heading, ok, progress, say, style, table, warn } from '../ui.js';

export type { EvalCaseResult } from '@helpwell/core/db';
export type { EvalCase, EvalRunResult };
export { EvalCasesError };

export type Verdict = EvalCaseResult['verdict'];

export interface EvalOptions {
  cwd: string;
  url?: string;
  /** A label stored with the run, e.g. the commit SHA, so runs can be told apart. */
  ref?: string;
  /** Do not write the run to the database. */
  dryRun?: boolean;
  /** Report failure when the score drops below this. For CI. */
  threshold?: number;
  /** The model to answer and grade with. Defaults to OpenRouter with OPENROUTER_API_KEY. */
  model?: ModelPort;
}

/** Read and check a cases file. Kept under its old name for scripts that import it. */
export function loadCases(path: string): EvalCase[] {
  return loadEvalCases(path);
}

const empty = (threshold?: number): EvalRunResult => ({
  id: null,
  ref: null,
  mode: 'full',
  model: null,
  score: 0,
  passed: 0,
  weak: 0,
  failed: 0,
  costUsd: 0,
  medianMs: null,
  cases: [],
  skipped: [],
  threshold: threshold ?? null,
  belowThreshold: false,
  createdAt: new Date(),
});

export async function runEvals(options: EvalOptions): Promise<EvalRunResult> {
  const project = loadProject(options.cwd);
  const file = join(project.paths.root, project.config.evalFile);
  const shown = relative(project.paths.root, file).split(sep).join('/');

  let cases: EvalCase[];
  try {
    cases = loadEvalCases(file);
  } catch (error) {
    if (!(error instanceof EvalCasesError)) throw error;
    // A broken file is always an error. A missing one is only an error when
    // somebody asked for a score: "no cases" must not read as "100%" in CI.
    if (error.kind === 'invalid') throw new HelpWellError('bad_request', error.message);
    if (options.threshold !== undefined) {
      throw new HelpWellError(
        'not_configured',
        `${error.message} With --threshold set, that is a failure.`,
      );
    }
    warn(error.message);
    detail(`Add some to ${shown}, or run \`helpwell init\` for a starter set.`);
    return empty();
  }

  if (cases.length === 0) {
    if (options.threshold !== undefined) {
      throw new HelpWellError(
        'not_configured',
        `No eval cases in ${shown}. With --threshold set, that is a failure.`,
      );
    }
    warn(`No eval cases in ${shown}.`);
    detail('Add some: each needs a question and the rules its answer is held to.');
    return empty();
  }

  const handle = await openDb(project.paths, { url: options.url });

  try {
    const settings = await new SettingsStore(handle.db).get();
    const apiKey = process.env.OPENROUTER_API_KEY ?? '';
    const model: ModelPort | null =
      options.model ??
      (apiKey ? traced(new OpenRouterModel({ apiKey, appName: settings.product.name })) : null);

    if (!model) {
      warn('No OPENROUTER_API_KEY, so this run measures retrieval only.');
      detail('Checks on what the answer says, and model grades, are skipped.');
    }

    heading(`Running ${cases.length} cases`);
    const bar = progress('asking');

    const result = await runEvalSuite({
      db: handle.db,
      settings,
      cases,
      model,
      instructions: project.instructions,
      playbook: project.playbook,
      ref: options.ref,
      dryRun: options.dryRun,
      threshold: options.threshold,
      onProgress: ({ index, total, case: testCase }) =>
        bar.update(`${index + 1}/${total} ${testCase.question.slice(0, 40)}`),
    });

    bar.done(`Ran ${result.cases.length} cases`);
    print(result, options.dryRun ?? false);

    if (result.belowThreshold) {
      fail(`Score ${result.score} is below the threshold of ${options.threshold}.`);
    }

    return result;
  } finally {
    await handle.close();
  }
}

/* ------------------------------------------------------------- reporting */

function print(result: EvalRunResult, dryRun: boolean): void {
  const withModel = result.mode === 'full';
  say();
  table([
    ['Score', `${result.score}%${withModel ? '' : style.dim(' (retrieval only)')}`],
    ['Passed', String(result.passed)],
    ['Weak', String(result.weak)],
    ['Failed', String(result.failed)],
    ['Median', result.medianMs === null ? '—' : `${result.medianMs}ms`],
    ['Cost', withModel ? `$${result.costUsd.toFixed(4)}` : '— (no model)'],
  ]);

  if (result.skipped.length > 0) {
    say();
    detail(
      `${result.skipped.length} ${result.skipped.length === 1 ? 'case needs' : 'cases need'} a model to judge and ${result.skipped.length === 1 ? 'was' : 'were'} left out: ${result.skipped.map((s) => s.id).join(', ')}`,
    );
  }

  const problems = result.cases.filter((c) => c.verdict !== 'pass');
  if (problems.length > 0) {
    heading('Worth looking at');
    for (const item of problems) {
      const mark = item.verdict === 'fail' ? style.red('✗') : style.yellow('!');
      say(`  ${mark} ${item.question}`);
      if (item.reason) say(`    ${style.dim(item.reason)}`);
    }
  }

  say();
  if (result.failed === 0 && result.weak === 0) ok('Every case passed.');
  if (dryRun) detail('Dry run: nothing was recorded.');
  say();
}
