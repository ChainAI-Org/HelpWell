/**
 * The order a survey's questions are asked in, given the answers so far.
 *
 * Pure, so branching can be tested on its own. A question's branches are
 * tried in order and the first that matches the answer decides where to go;
 * with none, its `next` does, and with no `next`, the following question.
 * A branch may only go forward (the dashboard refuses anything else), and a
 * target that does not exist is treated as the end, so a survey always ends.
 */

import type { QuestionKind, SurveyQuestion } from './types.js';

export interface Answer {
  score?: number;
  choice?: string;
  choices?: string[];
  comment?: string;
}

const SCALES: Partial<Record<QuestionKind, [number, number]>> = {
  nps: [0, 10],
  csat: [1, 5],
  stars: [1, 5],
};

export function scaleOf(kind: QuestionKind): [number, number] | null {
  return SCALES[kind] ?? null;
}

/** A score low enough for the detractor follow-up: NPS 0-6, CSAT and stars 1-2. */
export function isDetractor(kind: QuestionKind, score: number): boolean {
  if (kind === 'nps') return score <= 6;
  if (kind === 'csat' || kind === 'stars') return score <= 2;
  return false;
}

/** Whether to ask the follow-up comment after this answer. */
export function wantsFollowUp(question: SurveyQuestion, answer: Answer): boolean {
  if (!question.followUp.enabled || question.kind === 'text') return false;
  if (question.followUp.when === 'always') return true;
  return typeof answer.score === 'number' && isDetractor(question.kind, answer.score);
}

/**
 * The index of the question after `index`, or `'end'`. `answer` is null
 * when the visitor skipped an optional question: only `next` then applies.
 */
export function nextQuestion(
  questions: readonly SurveyQuestion[],
  index: number,
  answer: Answer | null,
): number | 'end' {
  const question = questions[index];
  if (!question) return 'end';
  const target = (answer && matchingBranch(question, answer)) ?? question.next;
  if (!target) return index + 1 < questions.length ? index + 1 : 'end';
  if (target === 'end') return 'end';
  const at = questions.findIndex((q) => q.id === target);
  return at > index ? at : 'end';
}

function matchingBranch(question: SurveyQuestion, answer: Answer): string | null {
  const picked = answer.choices ?? (answer.choice ? [answer.choice] : []);
  for (const branch of question.branches) {
    if (typeof answer.score === 'number') {
      const [low, high] = scaleOf(question.kind) ?? [
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      ];
      const min = branch.min ?? low;
      const max = branch.max ?? high;
      if (answer.score >= min && answer.score <= max) return branch.goto || 'end';
    } else if (picked.length > 0 && branch.choices.some((c) => picked.includes(c))) {
      return branch.goto || 'end';
    }
  }
  return null;
}
