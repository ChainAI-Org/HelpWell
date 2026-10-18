/**
 * Evals: run the suite, read every graded case, and compare two runs.
 *
 * A run replays each question through the real agent, inside a transaction
 * that is rolled back (core's `runEvalSuite`), so running from here leaves one
 * `eval_runs` row and one spend row and nothing a customer could see. It is
 * slow on purpose, one model call per case at least, so the page streams its
 * progress: the Run button posts with JavaScript and reads one line per case.
 * Without JavaScript the same form runs the suite and lands on the result.
 *
 * The cases come from, in order: the run being repeated; the host's
 * `readEvalCases` hook (helpwell/evals.json); the cases the latest run used;
 * and on a fresh install the starter questions `helpwell init` writes. The
 * page says which, because a score only means something next to its cases.
 *
 * The comparison is the point of recording runs: after a docs change, which
 * cases got better, which got worse, and what the answer said before and after.
 */

import { evalCasesPromptSpec, isHelpWellError } from '@helpwell/core';
import {
  casesFromLastRun,
  type EvalCase,
  parseEvalCases,
  runEvalSuite,
  starterEvalCases,
} from '@helpwell/core/agent';
import { diffLines } from '@helpwell/core/content';
import {
  type Db,
  type EvalCaseResult,
  type EvalCaseSpec,
  type EvalCheck,
  rowsOf,
} from '@helpwell/core/db';
import type { Settings } from '@helpwell/core/settings';
import { html, join, type RawHtml, raw, renderMarkdown } from '@helpwell/ui';
import { sql } from 'drizzle-orm';
import { clientScript } from '../client/index.js';
import {
  button,
  card,
  duration,
  empty,
  formatDateTime,
  meter,
  money,
  notice,
  pill,
  select,
  stat,
} from '../components.js';
import { byMode, managedContent } from '../content-mode.js';
import type { DashboardContext } from '../layout.js';
import { dashboardModel, evalModels, hasModelKey, type ModelConfig } from '../model.js';
import { htmlPage, redirect } from '../respond.js';
import { setupPromptPanel } from '../setup-prompt.js';
import { diffView, previewStyles } from './knowledge.js';

export interface EvalRunRow {
  id: string;
  ref: string | null;
  score: number;
  passed: number;
  weak: number;
  failed: number;
  costUsd: string | number;
  medianMs: number | null;
  createdAt: Date | string;
  /** Null on runs recorded before migration 0004. */
  mode?: 'full' | 'retrieval' | null;
  model?: string | null;
  cases?: EvalCaseRow[];
  suite?: EvalCaseSpec[];
}

/** One case's result, as stored; older runs lack the fields after `reason`. */
export type EvalCaseRow = EvalCaseResult;

export type CasesSource = 'repo' | 'last-run' | 'starter';

export interface EvalsPageInfo {
  /** A model key is set, so a run answers; otherwise it measures retrieval only. */
  hasModel: boolean;
  source: CasesSource;
  caseCount: number;
  /** Why the last run from here did not happen, from the query string. */
  error?: string | null;
}

/* ------------------------------------------------------------------ list */

export function evalsPage(
  context: DashboardContext,
  runs: EvalRunRow[],
  info: EvalsPageInfo,
  settings: Settings,
): RawHtml {
  const latest = runs[0];
  return html`
${info.error ? notice('bad', info.error) : null}
${runCard(context, info)}
${
  latest
    ? html`<div class="db-grid db-grid--4" style="margin:16px 0">
  ${stat('Latest score', `${latest.score}%`)}
  ${stat('Passed', String(latest.passed))}
  ${stat('Weak', String(latest.weak))}
  ${stat('Failed', String(latest.failed))}
</div>

${card(
  'Runs',
  'Newest first. A retrieval-only run has no model, so its score is not comparable with a full run.',
  html`<div class="db-tablewrap" style="border:0">
    <table class="db-table">
      <thead><tr><th>When</th><th>Ref</th><th>Mode</th><th>Score</th><th>Pass</th><th>Weak</th><th>Fail</th><th>Median</th><th>Cost</th></tr></thead>
      <tbody>
        ${join(
          runs.map(
            (run) => html`
        <tr>
          <td><a href="${context.basePath}/evals/${encodeURIComponent(run.id)}">${formatDateTime(run.createdAt, context)}</a></td>
          <td class="db-muted">${run.ref ?? '—'}</td>
          <td>${modePill(run.mode)}</td>
          <td>${scorePill(run.score)}</td>
          <td class="db-nums">${String(run.passed)}</td>
          <td class="db-nums">${String(run.weak)}</td>
          <td class="db-nums">${String(run.failed)}</td>
          <td class="db-nums">${duration(run.medianMs)}</td>
          <td class="db-nums">${money(Number(run.costUsd))}</td>
        </tr>`,
          ),
        )}
      </tbody>
    </table>
  </div>`,
)}
${runs.length > 1 ? compareForm(context, runs, runs[1]?.id ?? '', latest.id) : null}`
    : empty(
        'evals',
        'No eval runs yet',
        `An eval replays a set of questions against your docs and scores the answers, so you can tell whether a docs change made the agent better or worse. Run one above${byMode(context, ', or run `helpwell eval` in your repo', '')}.`,
      )
}
${casesCard(context, settings)}
${runScript(context)}`;
}

function runCard(context: DashboardContext, info: EvalsPageInfo): RawHtml {
  const managed = managedContent(context);
  const from =
    info.source === 'repo'
      ? managed
        ? html`the ${String(info.caseCount)} saved cases`
        : html`the ${String(info.caseCount)} cases in <code>helpwell/evals.json</code>`
      : info.source === 'last-run'
        ? html`the ${String(info.caseCount)} cases the latest run used`
        : managed
          ? html`the ${String(info.caseCount)} starter questions, since there are no cases here yet`
          : html`the ${String(info.caseCount)} starter questions <code>helpwell init</code> writes, since there are no cases here yet`;
  return card(
    'Run the evals',
    null,
    html`<p style="margin:0 0 12px">Runs ${from}${
      info.hasModel
        ? ', each through the real agent with your model key. That costs a little and takes a minute or two.'
        : html`. There is no model key, so this measures what search finds and skips the checks that need an answer. <a href="${context.basePath}/home">Add the key</a> for a full run.`
    }</p>
    <form method="post" action="${context.basePath}/evals/run" data-eval-run>
      <div class="db-toolbar" style="margin:0">
        <label class="db-field" style="margin:0;min-width:220px">
          <span class="db-visually-hidden">Label for this run</span>
          <input class="db-input" name="ref" placeholder="${managed ? 'Label, e.g. what you changed' : 'Label, e.g. a commit or a change'}" maxlength="200">
        </label>
        ${button(`Run ${String(info.caseCount)} ${info.caseCount === 1 ? 'case' : 'cases'}`, { glyph: 'play', tone: 'primary' })}
      </div>
      <div class="db-evalprogress" hidden aria-live="polite">
        <progress max="${String(info.caseCount)}" value="0"></progress>
        <span class="db-evalprogress__text">Starting…</span>
      </div>
    </form>`,
  );
}

function compareForm(context: DashboardContext, runs: EvalRunRow[], a: string, b: string): RawHtml {
  const choices = runs.map((run) => ({
    value: run.id,
    label: `${formatDateTime(run.createdAt, context)} · ${run.score}%${run.ref ? ` · ${run.ref}` : ''}`,
  }));
  return card(
    'Compare two runs',
    'Which cases got better, which got worse, and how the answers changed.',
    html`<form method="get" action="${context.basePath}/evals/compare" class="db-toolbar" style="margin:0">
      <label class="db-field" style="margin:0"><span class="db-field__label">Before</span>${select('a', a, choices)}</label>
      <label class="db-field" style="margin:0"><span class="db-field__label">After</span>${select('b', b, choices)}</label>
      <div style="align-self:end">${button('Compare', { glyph: 'eye' })}</div>
    </form>`,
  );
}

function casesCard(context: DashboardContext, settings: Settings): RawHtml {
  const managed = managedContent(context);
  return card(
    managed ? 'What an eval case is' : 'Where eval cases live',
    null,
    html`<p style="margin:0 0 10px">${managed ? null : html`In your repo, in <code>helpwell/evals.json</code>, reviewed like code. `}Each case is a question and the rules a right answer meets: the article it should cite
      (<code>expect</code>), text it must or must not say (<code>must</code>, <code>mustNot</code>),
      whether it should be flagged as not covered (<code>expectUnresolved</code>), or a rubric the
      writing model grades it against (<code>grade: "model"</code>).</p>
    <pre class="db-code">${JSON.stringify(
      [
        {
          id: 'export-invoices',
          question: 'How do I export my invoices?',
          expect: 'billing/exporting-invoices',
          must: ['Export CSV'],
        },
        { id: 'no-sso', question: 'Do you support SAML?', expect: null },
      ],
      null,
      2,
    )}</pre>
    ${
      managed
        ? html`<p class="db-field__hint" style="margin-top:10px">With no saved cases, a run repeats the
      latest run's cases, or starts from the starter questions. Every gap is a good case once its
      article exists.</p>`
        : html`<p class="db-field__hint" style="margin-top:10px">To add one, edit the file and run <code>npx helpwell eval</code>,
      or run it from here: the dashboard reads the file when your app passes <code>readEvalCases</code> to
      <code>createDashboard</code>. Every gap is a good case to add once its article exists.</p>`
    }`,
    managed
      ? null
      : setupPromptPanel(
          'eval-cases',
          evalCasesPromptSpec({ apiPath: context.apiPath, productName: settings.product.name }),
        ),
  );
}

/**
 * Posts the run form with fetch and reads the progress stream, one JSON line
 * per case, into the progress bar; then opens the finished run. Anything it
 * cannot do (an old browser) falls back to the plain form post. The code is
 * client/evals.ts, served as a file.
 */
function runScript(context: DashboardContext): RawHtml {
  return clientScript(context, 'eval-run');
}

/* ------------------------------------------------------------------- run */

export function evalRunPage(
  context: DashboardContext,
  run: EvalRunRow,
  previous: EvalRunRow | null,
): RawHtml {
  const cases = run.cases ?? [];
  const judged = new Set(cases.map((c) => c.id));
  const skipped = (run.suite ?? []).filter((spec) => !judged.has(spec.id));

  return html`
<div class="db-toolbar">
  ${button('All runs', { href: `${context.basePath}/evals`, glyph: 'back' })}
  <form method="post" action="${context.basePath}/evals/run" data-busy="Running…" style="display:inline">
    <input type="hidden" name="repeat" value="${run.id}">
    ${button('Run again', { glyph: 'refresh' })}
  </form>
  ${
    previous
      ? button('Compare with the run before', {
          href: `${context.basePath}/evals/compare?a=${encodeURIComponent(previous.id)}&b=${encodeURIComponent(run.id)}`,
          glyph: 'eye',
        })
      : null
  }
</div>

<div class="db-grid db-grid--4" style="margin-bottom:16px">
  ${stat('Score', `${run.score}%`)}
  ${stat('Passed · weak · failed', `${run.passed} · ${run.weak} · ${run.failed}`)}
  ${stat('Median answer', duration(run.medianMs))}
  ${stat('Cost', money(Number(run.costUsd)))}
</div>

${card(
  'This run',
  null,
  html`<dl class="db-kv">
    <dt>When</dt><dd>${formatDateTime(run.createdAt, context)}</dd>
    <dt>Mode</dt><dd>${
      run.mode === 'retrieval'
        ? 'Retrieval only: no model answered, so only what search found was judged'
        : run.mode === 'full'
          ? 'Full: every question answered by the agent'
          : 'Recorded before modes existed'
    }</dd>
    ${run.model ? html`<dt>Model</dt><dd>${run.model}</dd>` : null}
    ${run.ref ? html`<dt>Label</dt><dd>${run.ref}</dd>` : null}
    <dt>Cases</dt><dd>${String(cases.length)} judged${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}</dd>
  </dl>`,
)}

${
  skipped.length > 0
    ? notice(
        'info',
        html`Skipped, because every rule they have needs a model to judge: ${join(
          skipped.map((spec) => html`<code>${spec.id}</code>`),
          ', ',
        )}.`,
      )
    : null
}

${card(
  'Every case',
  'Failures first: those are the docs to fix.',
  cases.length === 0
    ? html`<p class="db-muted">This run judged no cases.</p>`
    : join(
        [...cases].sort((a, b) => rank(a.verdict) - rank(b.verdict)).map((item) => caseBlock(item)),
      ),
)}
${previewStyles()}`;
}

function caseBlock(item: EvalCaseRow): RawHtml {
  const cited = item.citedAll ?? (item.cited ? [item.cited] : []);
  return html`<article class="db-evalcase" data-verdict="${item.verdict}">
  <header class="db-evalcase__head">
    ${verdictPill(item.verdict)}
    <strong>${item.question}</strong>
    <span class="db-muted db-evalcase__ms">${duration(item.ms)}</span>
  </header>
  ${
    item.checks && item.checks.length > 0
      ? html`<ul class="db-evalchecks">${join(item.checks.map(checkRow))}</ul>`
      : item.reason
        ? html`<p class="db-evalcase__reason">${item.reason}</p>`
        : null
  }
  ${
    item.skipped && item.skipped.length > 0
      ? html`<p class="db-field__hint">Not checked without a model: ${item.skipped.map(checkLabel).join(', ')}.</p>`
      : null
  }
  <div class="db-evalcase__answer">
    <p class="db-field__label">The answer</p>
    <div class="db-preview">${item.answer ? raw(renderMarkdown(item.answer).html) : html`<p class="db-muted">No answer.</p>`}</div>
  </div>
  <div class="db-tagrow" style="margin-top:8px">
    <span class="db-field__label" style="margin:0">Cited</span>
    ${
      cited.length > 0
        ? join(
            cited.map(
              (slug) =>
                html`<span class="db-cite${item.expected && slug === item.expected ? ' db-cite--expected' : ''}">${slug}</span>`,
            ),
          )
        : html`<span class="db-muted">nothing</span>`
    }
    ${
      item.expected && !cited.includes(item.expected)
        ? pill('warn', `expected ${item.expected}`)
        : null
    }
    ${item.unresolved ? pill('neutral', 'Flagged as not covered') : null}
    ${
      typeof item.confidence === 'number'
        ? html`<span class="db-field__label" style="margin:0 0 0 8px">Confidence</span>${meter('Confidence', item.confidence)}`
        : null
    }
  </div>
</article>`;
}

const CHECK_LABELS: Record<EvalCheck['kind'], string> = {
  citation: 'Cited the right article',
  unresolved: 'Flagged, or answered, as it should',
  must: 'Said what it must',
  must_not: 'Did not say what it must not',
  grade: 'Grader',
};

function checkLabel(kind: EvalCheck['kind']): string {
  return CHECK_LABELS[kind] ?? kind;
}

function checkRow(check: EvalCheck): RawHtml {
  return html`<li class="db-evalcheck">${verdictPill(check.verdict)}<span class="db-evalcheck__kind">${checkLabel(check.kind)}</span>${
    check.detail ? html`<span class="db-evalcheck__detail">${check.detail}</span>` : null
  }</li>`;
}

/* --------------------------------------------------------------- compare */

export type CaseChange = 'regressed' | 'fixed' | 'better' | 'worse' | 'same' | 'added' | 'removed';

export interface CaseComparison {
  id: string;
  question: string;
  before: EvalCaseRow | null;
  after: EvalCaseRow | null;
  change: CaseChange;
}

const VERDICT_RANK: Record<EvalCaseRow['verdict'], number> = { fail: 0, weak: 1, pass: 2 };

/**
 * Case by case, what changed between two runs. Cases are matched by id, so a
 * question reworded in evals.json keeps its history. Worst news first.
 */
export function compareRuns(before: EvalRunRow, after: EvalRunRow): CaseComparison[] {
  const a = new Map((before.cases ?? []).map((c) => [c.id, c]));
  const b = new Map((after.cases ?? []).map((c) => [c.id, c]));
  const ids = [...new Set([...b.keys(), ...a.keys()])];
  const order: Record<CaseChange, number> = {
    regressed: 0,
    worse: 1,
    fixed: 2,
    better: 3,
    added: 4,
    removed: 5,
    same: 6,
  };
  return ids
    .map((id): CaseComparison => {
      const was = a.get(id) ?? null;
      const now = b.get(id) ?? null;
      return {
        id,
        question: now?.question ?? was?.question ?? id,
        before: was,
        after: now,
        change: changeOf(was, now),
      };
    })
    .sort((x, y) => order[x.change] - order[y.change]);
}

function changeOf(was: EvalCaseRow | null, now: EvalCaseRow | null): CaseChange {
  if (!was) return 'added';
  if (!now) return 'removed';
  if (was.verdict === now.verdict) return 'same';
  if (now.verdict === 'pass') return 'fixed';
  if (was.verdict === 'pass') return 'regressed';
  return VERDICT_RANK[now.verdict] > VERDICT_RANK[was.verdict] ? 'better' : 'worse';
}

const CHANGE_LABEL: Record<
  CaseChange,
  { text: string; tone: 'good' | 'bad' | 'warn' | 'neutral' | 'info' }
> = {
  regressed: { text: 'Regressed', tone: 'bad' },
  worse: { text: 'Worse', tone: 'bad' },
  fixed: { text: 'Fixed', tone: 'good' },
  better: { text: 'Better', tone: 'good' },
  added: { text: 'New case', tone: 'info' },
  removed: { text: 'Not in this run', tone: 'neutral' },
  same: { text: 'Same', tone: 'neutral' },
};

export function evalComparePage(
  context: DashboardContext,
  before: EvalRunRow,
  after: EvalRunRow,
  runs: EvalRunRow[],
): RawHtml {
  const rows = compareRuns(before, after);
  const delta = after.score - before.score;
  const count = (change: CaseChange) => rows.filter((row) => row.change === change).length;
  const modesDiffer = (before.mode ?? null) !== (after.mode ?? null);

  return html`
<div class="db-toolbar">${button('All runs', { href: `${context.basePath}/evals`, glyph: 'back' })}</div>
${compareForm(context, runs, before.id, after.id)}
${
  modesDiffer
    ? notice(
        'warn',
        'One of these runs had no model, so it only measured retrieval. Their scores are not comparable; the case changes still are, check by check.',
      )
    : null
}
<div class="db-grid db-grid--4" style="margin:16px 0">
  ${stat('Score', `${before.score}% → ${after.score}%`)}
  ${stat('Change', `${delta > 0 ? '+' : ''}${delta} points`)}
  ${stat('Fixed or better', String(count('fixed') + count('better')))}
  ${stat('Regressed or worse', String(count('regressed') + count('worse')))}
</div>

${card(
  'Case by case',
  `${formatDateTime(before.createdAt, context)} against ${formatDateTime(after.createdAt, context)}. Worst news first.`,
  rows.length === 0
    ? html`<p class="db-muted">Neither run judged any cases.</p>`
    : html`<div class="db-tablewrap" style="border:0">
    <table class="db-table">
      <thead><tr><th>Case</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
      <tbody>${join(
        rows.map(
          (row) => html`<tr data-change="${row.change}">
        <td><strong>${row.question}</strong><div class="db-muted" style="font-size:12px"><code>${row.id}</code></div></td>
        <td>${row.before ? verdictPill(row.before.verdict) : html`<span class="db-muted">—</span>`}</td>
        <td>${row.after ? verdictPill(row.after.verdict) : html`<span class="db-muted">—</span>`}</td>
        <td>${pill(CHANGE_LABEL[row.change].tone, CHANGE_LABEL[row.change].text)}</td>
      </tr>`,
        ),
      )}</tbody>
    </table>
  </div>`,
)}

${join(
  rows
    .filter(
      (row) =>
        row.before &&
        row.after &&
        (row.change !== 'same' || row.before.answer !== row.after.answer),
    )
    .slice(0, 20)
    .map((row) => answerChange(row)),
)}
${previewStyles()}`;
}

function answerChange(row: CaseComparison): RawHtml {
  const before = row.before!;
  const after = row.after!;
  const citedBefore = before.citedAll ?? (before.cited ? [before.cited] : []);
  const citedAfter = after.citedAll ?? (after.cited ? [after.cited] : []);
  return card(
    row.question,
    `${CHANGE_LABEL[row.change].text}: ${before.verdict} to ${after.verdict}.`,
    html`<p class="db-field__hint" style="margin:0 0 8px">Cited before: ${citedBefore.join(', ') || 'nothing'}. After: ${citedAfter.join(', ') || 'nothing'}.</p>`,
    after.reason && after.verdict !== 'pass'
      ? html`<p class="db-evalcase__reason">${after.reason}</p>`
      : null,
    diffView(diffLines(before.answer, after.answer)),
  );
}

/* --------------------------------------------------------------- running */

/** Where this run's cases come from. See the module comment for the order. */
export async function casesToRun(
  db: Db,
  options: {
    repeat?: EvalRunRow | null;
    readEvalCases?: () => unknown;
    productName: string;
    /** Managed content has no repo, so an error must not name a file in one. */
    managed?: boolean;
  },
): Promise<{ cases: EvalCase[]; source: CasesSource }> {
  if (options.repeat) {
    const suite = options.repeat.suite?.length
      ? options.repeat.suite
      : (options.repeat.cases ?? []).map((c) => c.spec ?? { id: c.id, question: c.question });
    return { cases: parseEvalCases(suite, 'that run'), source: 'last-run' };
  }
  if (options.readEvalCases) {
    const raw = await options.readEvalCases();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const cases = parseEvalCases(
      parsed,
      options.managed ? 'the saved eval cases' : 'helpwell/evals.json',
    );
    if (cases.length > 0) return { cases, source: 'repo' };
  }
  const last = await casesFromLastRun(db);
  if (last.length > 0) return { cases: last, source: 'last-run' };
  return { cases: starterEvalCases(options.productName), source: 'starter' };
}

export interface RunRequest {
  db: Db;
  settings: Settings;
  config: ModelConfig & {
    readEvalCases?: () => unknown;
    readInstructions?: () => Promise<string> | string;
    readPlaybook?: () => Promise<string> | string;
  };
  repeat: EvalRunRow | null;
  ref: string | null;
}

/**
 * Run the suite. With `stream`, answer at once with one JSON line per case
 * and a last line saying where the result is; without it, run and redirect.
 */
export async function runEvals(
  context: DashboardContext,
  request: RunRequest,
  stream: boolean,
): Promise<Response> {
  const fail = (message: string) =>
    stream
      ? ndjson([{ type: 'error', message }])
      : redirect(`${context.basePath}/evals?error=${encodeURIComponent(message)}`);

  let cases: EvalCase[];
  try {
    ({ cases } = await casesToRun(request.db, {
      repeat: request.repeat,
      readEvalCases: request.config.readEvalCases,
      productName: request.settings.product.name,
      managed: managedContent(context),
    }));
  } catch (error) {
    return fail(
      `The eval cases could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const [instructions, playbook] = await Promise.all([
    request.config.readInstructions ? request.config.readInstructions() : undefined,
    request.config.readPlaybook ? request.config.readPlaybook() : undefined,
  ]);
  const run = (onProgress?: (line: Record<string, unknown>) => void) =>
    runEvalSuite({
      db: request.db,
      settings: request.settings,
      cases,
      model: dashboardModel(request.config, request.settings, 'chat'),
      ...evalModels(request.config, request.settings),
      instructions: instructions || undefined,
      playbook: playbook || undefined,
      ref: request.ref,
      onProgress: onProgress
        ? (progress) =>
            onProgress({
              type: 'progress',
              index: progress.index,
              total: progress.total,
              question: progress.case.question,
            })
        : undefined,
    });
  const failure = (error: unknown) => {
    if (isHelpWellError(error)) return error.publicMessage;
    throw error;
  };

  if (!stream) {
    try {
      const result = await run();
      return redirect(`${context.basePath}/evals/${encodeURIComponent(result.id ?? '')}`);
    } catch (error) {
      return fail(failure(error));
    }
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        const result = await run(send);
        send({
          type: 'done',
          id: result.id,
          location: `${context.basePath}/evals/${encodeURIComponent(result.id ?? '')}`,
        });
      } catch (error) {
        let message = 'The run did not finish. Try again.';
        try {
          message = failure(error);
        } catch {
          // An unexpected error still ends the stream with a line the page can show.
        }
        send({ type: 'error', message });
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/* ---------------------------------------------------------------- routes */

type EvalsConfig = RunRequest['config'] & { db: Db };

const HEADER = {
  title: 'Evals',
  subtitle: 'Replay questions against your docs and score the answers.',
};

/** GET `/evals`, `/evals/compare?a=&b=` and `/evals/:id`. */
export async function evalsScreen(
  config: EvalsConfig,
  context: DashboardContext,
  rest: string[],
  url: URL,
  settings: Settings,
): Promise<Response> {
  const notFound = () =>
    htmlPage(
      context,
      'evals',
      { title: 'Eval run' },
      empty(
        'alert',
        'That run is not here',
        'It may have been from another database.',
        button('All runs', { href: `${context.basePath}/evals`, glyph: 'back' }),
      ),
      404,
    );

  if (rest[0] === 'compare') {
    const [a, b, runs] = await Promise.all([
      getRun(config.db, url.searchParams.get('a') ?? ''),
      getRun(config.db, url.searchParams.get('b') ?? ''),
      listRuns(config.db, 50),
    ]);
    if (!a || !b) return notFound();
    // Older on the left, whichever way round they were picked.
    const [before, after] =
      new Date(a.createdAt).getTime() <= new Date(b.createdAt).getTime() ? [a, b] : [b, a];
    return htmlPage(
      context,
      'evals',
      { title: 'Compare runs', subtitle: HEADER.subtitle },
      evalComparePage(context, before, after, runs),
    );
  }

  if (rest[0]) {
    const run = await getRun(config.db, rest[0]);
    if (!run) return notFound();
    return htmlPage(
      context,
      'evals',
      { title: 'Eval run', subtitle: formatDateTime(run.createdAt, context) },
      evalRunPage(context, run, await previousRun(config.db, run)),
    );
  }

  const runs = await listRuns(config.db);
  let source: CasesSource = 'starter';
  let caseCount = 0;
  let error = url.searchParams.get('error');
  try {
    const found = await casesToRun(config.db, {
      readEvalCases: config.readEvalCases,
      productName: settings.product.name,
      managed: managedContent(context),
    });
    source = found.source;
    caseCount = found.cases.length;
  } catch (cause) {
    error ??= `${byMode(context, 'helpwell/evals.json', 'The saved eval cases')} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  return htmlPage(
    context,
    'evals',
    HEADER,
    evalsPage(
      context,
      runs,
      { hasModel: hasModelKey(config), source, caseCount, error: error?.slice(0, 500) ?? null },
      settings,
    ),
  );
}

/** POST `/evals/run`: run the suite, streamed when the page asks for it. */
export async function evalsPost(
  config: EvalsConfig,
  context: DashboardContext,
  rest: string[],
  request: Request,
  settings: Settings,
): Promise<Response> {
  if (rest[0] !== 'run') return redirect(`${context.basePath}/evals`);
  const form = await request.formData();
  const repeatId = String(form.get('repeat') ?? '');
  const repeat = repeatId ? await getRun(config.db, repeatId) : null;
  const ref =
    String(form.get('ref') ?? '')
      .trim()
      .slice(0, 200) ||
    repeat?.ref ||
    null;
  const stream = (request.headers.get('accept') ?? '').includes('application/x-ndjson');
  return runEvals(context, { db: config.db, settings, config, repeat, ref }, stream);
}

/* -------------------------------------------------------------- plumbing */

export async function listRuns(db: Db, limit = 20): Promise<EvalRunRow[]> {
  const rows = await db.execute(sql`
    SELECT id, ref, score, passed, weak, failed, cost_usd AS "costUsd", median_ms AS "medianMs",
           created_at AS "createdAt", mode, model
    FROM helpwell.eval_runs ORDER BY created_at DESC, id DESC LIMIT ${limit}
  `);
  return rowsOfRuns(rows);
}

export async function getRun(db: Db, id: string): Promise<EvalRunRow | null> {
  const rows = await db.execute(sql`
    SELECT id, ref, score, passed, weak, failed, cost_usd AS "costUsd", median_ms AS "medianMs",
           created_at AS "createdAt", mode, model, cases, suite
    FROM helpwell.eval_runs WHERE id = ${id} LIMIT 1
  `);
  return rowsOfRuns(rows)[0] ?? null;
}

/** The run recorded just before this one, for "compare with the run before". */
export async function previousRun(db: Db, run: EvalRunRow): Promise<EvalRunRow | null> {
  const rows = await db.execute(sql`
    SELECT id, ref, score, passed, weak, failed, cost_usd AS "costUsd", median_ms AS "medianMs",
           created_at AS "createdAt", mode, model
    FROM helpwell.eval_runs
    WHERE created_at < ${new Date(run.createdAt).toISOString()} AND id <> ${run.id}
    ORDER BY created_at DESC, id DESC LIMIT 1
  `);
  return rowsOfRuns(rows)[0] ?? null;
}

function rowsOfRuns(result: unknown): EvalRunRow[] {
  return rowsOf<Record<string, unknown>>(result).map((row) => ({
    id: String(row.id),
    ref: (row.ref as string | null) ?? null,
    score: Number(row.score),
    passed: Number(row.passed),
    weak: Number(row.weak),
    failed: Number(row.failed),
    costUsd: row.costUsd as string | number,
    medianMs: row.medianMs === null || row.medianMs === undefined ? null : Number(row.medianMs),
    createdAt: row.createdAt as Date | string,
    mode: (row.mode as EvalRunRow['mode']) ?? null,
    model: (row.model as string | null) ?? null,
    cases: jsonArray<EvalCaseRow>(row.cases),
    suite: jsonArray<EvalCaseSpec>(row.suite),
  }));
}

function jsonArray<T>(value: unknown): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as T[]) : [];
}

function ndjson(lines: Record<string, unknown>[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function rank(verdict: string): number {
  return verdict === 'fail' ? 0 : verdict === 'weak' ? 1 : 2;
}

function verdictPill(verdict: EvalCheck['verdict']): RawHtml {
  return pill(verdict === 'pass' ? 'good' : verdict === 'weak' ? 'warn' : 'bad', verdict);
}

function scorePill(score: number): RawHtml {
  return pill(score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad', `${score}%`);
}

function modePill(mode: EvalRunRow['mode']): RawHtml {
  if (mode === 'retrieval') return pill('neutral', 'Retrieval only');
  if (mode === 'full') return pill('accent', 'Full');
  return html`<span class="db-muted">—</span>`;
}
