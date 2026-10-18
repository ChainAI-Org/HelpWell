/**
 * Eval cases: what `helpwell/evals.json` may say, and how it is read.
 *
 * A case is a question and the rules its answer is held to. Every rule is
 * optional except the question, and a case is judged on the rules it has:
 *
 *   expect            the slug the answer should cite, or null when the docs
 *                     should not cover it (the agent must then say so and
 *                     mark it unresolved). Leave it out to not check citations.
 *   must              text the answer has to contain
 *   mustNot           text the answer must never contain: a price the docs do
 *                     not state, a secret the customer pasted
 *   expectUnresolved  true when the agent should mark it unresolved, false when
 *                     it should answer
 *   grade: "model"    have the writing model score the answer against `rubric`
 *   note              for people; never read by the runner
 *
 * A rule in `must` or `mustNot` is a case-insensitive substring, or a regular
 * expression written `/like this/i` with whatever flags it needs.
 *
 * A case with a question and nothing else is the oldest form of all, from
 * before any rule but `expect` existed, and keeps its old meaning: the docs
 * should not cover it.
 */

import { readFileSync } from 'node:fs';
import type { EvalCaseSpec } from '../db/schema.js';

export type EvalCase = EvalCaseSpec;

/** The cases could not be read: the file is missing, or it is not what it should be. */
export class EvalCasesError extends Error {
  constructor(
    readonly kind: 'missing' | 'invalid',
    /** The file, when they came from one. */
    readonly path: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'EvalCasesError';
  }
}

/** Read and check a cases file. Throws `EvalCasesError` for a missing or broken one. */
export function loadEvalCases(path: string): EvalCase[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new EvalCasesError('missing', path, `No eval cases file at ${path}.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EvalCasesError('invalid', path, `Could not read ${path}: ${reason}`);
  }
  return parseEvalCases(raw, path);
}

/**
 * Cases from parsed JSON: an array of cases, or `{"cases": [...]}`. Entries
 * without a question are skipped; a rule that cannot work (a regex that does
 * not compile, a `grade` other than "model") is an error naming the case.
 */
export function parseEvalCases(raw: unknown, source: string | null = null): EvalCase[] {
  const where = source ?? 'the eval cases';
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { cases?: unknown }).cases)
      ? (raw as { cases: unknown[] }).cases
      : null;
  if (!list) {
    throw new EvalCasesError(
      'invalid',
      source,
      `Could not read ${where}: expected an array of cases, or {"cases": [...]}.`,
    );
  }

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.question === 'string' && item.question.trim() !== '')
    .map((item, index) => readCase(item, index, source));
}

function readCase(item: Record<string, unknown>, index: number, source: string | null): EvalCase {
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `case-${index + 1}`;
  const bad = (message: string) =>
    new EvalCasesError(
      'invalid',
      source,
      `Case "${id}" in ${source ?? 'the eval cases'}: ${message}`,
    );

  const spec: EvalCase = { id, question: String(item.question).trim() };

  const must = rules(item.must, 'must', bad);
  const mustNot = rules(item.mustNot, 'mustNot', bad);
  if (must.length > 0) spec.must = must;
  if (mustNot.length > 0) spec.mustNot = mustNot;

  if (item.expectUnresolved !== undefined) {
    if (typeof item.expectUnresolved !== 'boolean')
      throw bad('expectUnresolved must be true or false.');
    spec.expectUnresolved = item.expectUnresolved;
  }

  if (item.grade !== undefined) {
    if (item.grade !== 'model') throw bad('grade can only be "model".');
    spec.grade = 'model';
  }
  if (typeof item.rubric === 'string' && item.rubric.trim()) spec.rubric = item.rubric.trim();
  if (typeof item.note === 'string') spec.note = item.note;

  if ('expect' in item) {
    if (item.expect === null) spec.expect = null;
    else if (typeof item.expect === 'string' && item.expect.trim())
      spec.expect = item.expect.trim();
    else throw bad('expect must be an article slug, or null when the docs should not cover it.');
  } else if (!hasRules(spec)) {
    // The original form: a bare question is one the docs should not answer.
    spec.expect = null;
  }

  return spec;
}

function hasRules(spec: EvalCase): boolean {
  return Boolean(
    spec.must?.length || spec.mustNot?.length || spec.expectUnresolved !== undefined || spec.grade,
  );
}

function rules(value: unknown, name: string, bad: (message: string) => Error): string[] {
  if (value === undefined || value === null) return [];
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || !list.every((rule) => typeof rule === 'string')) {
    throw bad(`${name} must be a list of strings.`);
  }
  const out = list.map((rule) => rule.trim()).filter(Boolean);
  for (const rule of out) {
    if (looksLikeRegex(rule) && !toRegex(rule))
      throw bad(`${name} has a regex that does not compile: ${rule}`);
  }
  return out;
}

/** `/body/flags`: a slash, something, a slash, then only regex flags. */
const REGEX_RULE = /^\/(.+)\/([dgimsuy]*)$/s;

function looksLikeRegex(rule: string): boolean {
  return REGEX_RULE.test(rule);
}

function toRegex(rule: string): RegExp | null {
  const match = REGEX_RULE.exec(rule);
  if (!match) return null;
  try {
    // Never global or sticky: a shared lastIndex would make test() alternate.
    return new RegExp(match[1]!, (match[2] ?? '').replace(/[gy]/g, ''));
  } catch {
    return null;
  }
}

/** Whether `text` satisfies one `must`/`mustNot` rule. */
export function matchesRule(text: string, rule: string): boolean {
  const regex = looksLikeRegex(rule) ? toRegex(rule) : null;
  if (regex) return regex.test(text);
  return text.toLowerCase().includes(rule.toLowerCase());
}
