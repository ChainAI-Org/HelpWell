/**
 * Judging one eval case.
 *
 * Every rule a case has becomes a check with its own verdict, and the case
 * gets the worst of them: one failed rule fails the case, and a weak one makes
 * it weak. The run's score keeps the meaning it always had, passes plus half
 * the weak cases over all of them, so scores from before and after these
 * rules existed stay comparable for a case file that only uses `expect`.
 *
 * What each check means:
 *
 *   citation    pass: cited the expected article. weak: cited something else,
 *               which is relevant but not right. fail: cited nothing.
 *   unresolved  the agent marked it unresolved when it should have, or
 *               answered when it should have.
 *   must        every `must` rule matched the answer.
 *   must_not    no `mustNot` rule matched it.
 *   grade       the writing model's verdict against the rubric.
 *
 * A retrieval-only run (no model configured) has no answer to read, only what
 * search found, so the wording checks are skipped and the restraint check asks
 * the weaker question "did search come back empty?". It cannot tell whether a
 * model would have declined, so a search that found something is weak, not
 * failed.
 */

import type { EvalCaseResult, EvalCheck } from '../db/schema.js';
import type { EvalCase } from './cases.js';
import { matchesRule } from './cases.js';

export type EvalMode = 'full' | 'retrieval';

export interface JudgedReply {
  text: string;
  citations: { slug: string }[];
  unresolved: boolean;
  confidence?: number | null;
}

export interface JudgeInput {
  spec: EvalCase;
  reply: JudgedReply;
  mode: EvalMode;
  /** How long the answer took. */
  ms: number;
  /** The model grade, when the case asked for one and the run could give it. */
  grade?: { verdict: EvalCheck['verdict']; reason: string } | null;
}

/** How much of an answer is kept with the result. Enough to see what went wrong. */
const ANSWER_CHARS = 800;

const RANK: Record<EvalCheck['verdict'], number> = { fail: 0, weak: 1, pass: 2 };

export function judgeCase(input: JudgeInput): EvalCaseResult {
  const { spec, reply, mode } = input;
  const cited = reply.citations.map((c) => c.slug);
  const checks: EvalCheck[] = [];
  const skipped: EvalCheck['kind'][] = [];

  if (typeof spec.expect === 'string') {
    checks.push(citationCheck(spec.expect, cited, reply.unresolved, mode));
  }

  if (spec.expect === null || spec.expectUnresolved === true) {
    checks.push(restraintCheck(cited, reply.unresolved, mode));
  } else if (spec.expectUnresolved === false) {
    checks.push(answeredCheck(cited, reply.unresolved, mode));
  }

  if (spec.must?.length) {
    if (mode === 'retrieval') skipped.push('must');
    else {
      const missing = spec.must.filter((rule) => !matchesRule(reply.text, rule));
      checks.push(
        missing.length === 0
          ? { kind: 'must', verdict: 'pass' }
          : { kind: 'must', verdict: 'fail', detail: `Did not say ${quoted(missing)}.` },
      );
    }
  }

  if (spec.mustNot?.length) {
    if (mode === 'retrieval') skipped.push('must_not');
    else {
      const said = spec.mustNot.filter((rule) => matchesRule(reply.text, rule));
      checks.push(
        said.length === 0
          ? { kind: 'must_not', verdict: 'pass' }
          : {
              kind: 'must_not',
              verdict: 'fail',
              detail: `Said what it must not: ${quoted(said)}.`,
            },
      );
    }
  }

  if (spec.grade === 'model') {
    if (mode === 'retrieval' || !input.grade) skipped.push('grade');
    else {
      checks.push({
        kind: 'grade',
        verdict: input.grade.verdict,
        ...(input.grade.reason ? { detail: `Grader: ${input.grade.reason}` } : {}),
      });
    }
  }

  const verdict = checks.reduce<EvalCheck['verdict']>(
    (worst, check) => (RANK[check.verdict] < RANK[worst] ? check.verdict : worst),
    'pass',
  );
  const reason = checks
    .filter((check) => check.verdict !== 'pass' && check.detail)
    .map((check) => check.detail)
    .join(' ');

  return {
    id: spec.id,
    question: spec.question,
    verdict,
    answer: reply.text.slice(0, ANSWER_CHARS),
    cited: cited[0] ?? null,
    expected: typeof spec.expect === 'string' ? spec.expect : null,
    ms: input.ms,
    ...(reason ? { reason } : {}),
    citedAll: cited,
    unresolved: reply.unresolved,
    confidence: reply.confidence ?? null,
    checks,
    ...(skipped.length > 0 ? { skipped } : {}),
    spec,
  };
}

/** Whether a retrieval-only run can judge the case at all. */
export function judgeableWithoutModel(spec: EvalCase): boolean {
  return (
    typeof spec.expect === 'string' || spec.expect === null || spec.expectUnresolved !== undefined
  );
}

function citationCheck(
  expected: string,
  cited: string[],
  unresolved: boolean,
  mode: EvalMode,
): EvalCheck {
  if (cited.includes(expected)) return { kind: 'citation', verdict: 'pass' };
  if (cited.length > 0) {
    return {
      kind: 'citation',
      verdict: 'weak',
      detail: `Cited ${cited.join(', ')} rather than ${expected}.`,
    };
  }
  return {
    kind: 'citation',
    verdict: 'fail',
    detail:
      mode === 'retrieval'
        ? `Search found nothing, but ${expected} should answer it.`
        : unresolved
          ? 'Said it did not know, but the article exists.'
          : 'Answered without citing anything.',
  };
}

function restraintCheck(cited: string[], unresolved: boolean, mode: EvalMode): EvalCheck {
  if (mode === 'retrieval') {
    return cited.length === 0
      ? { kind: 'unresolved', verdict: 'pass' }
      : {
          kind: 'unresolved',
          verdict: 'weak',
          detail: `Search found ${cited[0]}; without a model there is no telling whether the agent would have declined.`,
        };
  }
  return unresolved
    ? { kind: 'unresolved', verdict: 'pass' }
    : {
        kind: 'unresolved',
        verdict: 'fail',
        detail: 'Answered a question the docs do not cover instead of saying so.',
      };
}

function answeredCheck(cited: string[], unresolved: boolean, mode: EvalMode): EvalCheck {
  if (mode === 'retrieval') {
    return cited.length > 0
      ? { kind: 'unresolved', verdict: 'pass' }
      : { kind: 'unresolved', verdict: 'fail', detail: 'Search found nothing to answer from.' };
  }
  return unresolved
    ? {
        kind: 'unresolved',
        verdict: 'fail',
        detail: 'Marked it unresolved, but it should have answered.',
      }
    : { kind: 'unresolved', verdict: 'pass' };
}

function quoted(rules: string[]): string {
  return rules.map((rule) => `"${rule}"`).join(', ');
}
