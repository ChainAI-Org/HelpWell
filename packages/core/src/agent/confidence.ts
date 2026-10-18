/**
 * How sure HelpWell is of one answer, as a number from 0 to 1 and a sentence.
 *
 * Three things go in, because no one of them is enough on its own:
 *
 *   retrieval  how well search matched: every word or only some, how similar
 *              the closest article was, and whether both passes agreed
 *   grounding  whether the answer cited the passages it used, or at least
 *              plainly follows one
 *   certainty  what the model said about its own answer: answered, partial or
 *              not covered (agent/grounding.ts reads it out of the reply)
 *
 * Retrieval and grounding weigh 35% each and certainty 30%. A model that did
 * not report its certainty is scored on the other two, less 10%, so forgetting
 * the line never reads as confidence. Some answers are capped whatever the
 * sum: one the model said the docs do not cover, or flagged with
 * mark_unresolved, is at most 0.2, and one written by search because no model
 * answered is 0.
 *
 * A conversation turns unresolved below `CONFIDENCE_THRESHOLD`. That number
 * is deliberately not a setting: open source applies one sensible default, and
 * the score is stored on every agent message so a hosted install can apply
 * its own later.
 */

import type { RetrievalSignals } from '../search/search.js';
import type { CertaintyReport } from './grounding.js';

/** Below this, an answer does not resolve the conversation. Internal, not a setting. */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Whether a stored answer left its question unresolved, from the score kept
 * on the message. It draws the same line `Agent.reply()` does: every way an
 * answer can be unresolved (no model answered, the model gave up or said the
 * docs do not cover it, or a weak score on a real question) scores under the
 * threshold, and nothing else does. Null, for a message no agent scored (a
 * proactive message, an older row), is not unresolved.
 */
export function unresolvedScore(confidence: number | null | undefined): boolean {
  return typeof confidence === 'number' && confidence < CONFIDENCE_THRESHOLD;
}

/**
 * Where the semantic pass counts as fully confident. Similarity between the
 * floor (`MIN_SIMILARITY`) and this scales linearly from 0 to 1.
 */
const STRONG_SIMILARITY = 0.6;

/** The most an answer the model or the agent gave up on can score. */
const GAVE_UP_CAP = 0.2;

/**
 * How the answer relates to its sources.
 *
 *   cited     it cited passages by number, or attached an article with a tool
 *   inferred  it cited nothing, but plainly follows one passage's wording
 *   uncited   passages were there and it used none of them visibly
 *   none      there was nothing to cite
 */
export type Grounding = 'cited' | 'inferred' | 'uncited' | 'none';

export interface ConfidenceInput {
  /** How search went for this message. */
  retrieval: RetrievalSignals;
  /** How many passages search (and any search tool call) found. */
  passages: number;
  grounding: Grounding;
  /** How many articles the answer cited. */
  cited: number;
  certainty: CertaintyReport | null;
  /** The model called mark_unresolved, with the reason it gave. */
  markedUnresolved?: { reason?: string } | null;
  /** No model answered: search wrote the reply. */
  degraded?: 'spend_cap' | 'model_down' | null;
  /**
   * A follow-up search found nothing new for (a thank-you, or a question
   * about the answer just given), or small talk at any point. Retrieval says
   * nothing about those, so they are scored on the model's own report.
   */
  conversational?: boolean;
  /** The message was a greeting, a thanks or an "ok" (small-talk.ts), not a question. */
  smallTalk?: boolean;
}

export interface Confidence {
  /** 0-1, two decimal places. */
  score: number;
  /** One or two plain sentences a person reviewing the conversation can read. */
  reason: string;
}

export function scoreConfidence(input: ConfidenceInput): Confidence {
  if (input.degraded) {
    const why =
      input.degraded === 'spend_cap'
        ? 'the daily spend cap was reached'
        : 'the model could not be reached';
    return {
      score: 0,
      reason:
        input.passages > 0
          ? `No model answer: ${why}, so the reply is the closest article from search.`
          : `No model answer: ${why}, and nothing in the docs matched.`,
    };
  }

  const certaintyText = describeCertainty(input.certainty);

  if (input.conversational) {
    const byLevel = { answered: 0.8, partial: 0.5, not_covered: 0.1 } as const;
    let raw = input.certainty ? byLevel[input.certainty.level] : 0.6;
    if (input.markedUnresolved) raw = Math.min(raw, GAVE_UP_CAP);
    const score = round(raw);
    return {
      score,
      reason: `${label(score)}. ${
        input.smallTalk
          ? 'Small talk rather than a question, judged on the reply alone'
          : 'A follow-up the docs had nothing new for, judged on the conversation so far'
      }; ${certaintyText}.${flagged(input)}`,
    };
  }

  const r = retrievalStrength(input.retrieval, input.passages);
  const g = GROUNDING_WEIGHT[input.grounding];
  let raw = input.certainty
    ? 0.35 * r + 0.35 * g + 0.3 * CERTAINTY_WEIGHT[input.certainty.level]
    : ((0.35 * r + 0.35 * g) / 0.7) * 0.9;
  if (input.certainty?.level === 'not_covered' || input.markedUnresolved) {
    raw = Math.min(raw, GAVE_UP_CAP);
  }
  const score = round(raw);

  const parts = [
    capitalise(describeRetrieval(input.retrieval, input.passages)),
    describeGrounding(input.grounding, input.cited),
    certaintyText,
  ];
  return {
    score,
    reason: `${label(score)}. ${parts.join('; ')}.${flagged(input)}`,
  };
}

/**
 * The retrieval half on its own, 0-1.
 *
 * Full text counts 1 for a strict match and 0.3-0.8 for a loose one by how
 * many of the question's words it found. Similarity counts 0 at the floor and
 * 1 at `STRONG_SIMILARITY`. With both passes the two are averaged and
 * agreement on the top article adds 0.1; with full text alone the result is
 * scaled to 0.85, because matching words is not the same as matching meaning.
 */
export function retrievalStrength(signals: RetrievalSignals, passages: number): number {
  if (passages === 0) return 0;
  const text =
    signals.text === 'strict'
      ? 1
      : signals.text === 'loose'
        ? 0.3 + 0.5 * clamp(signals.textCoverage)
        : 0;
  if (!signals.semantic || signals.bestSimilarity === null) return round(0.85 * text);
  const similarity = clamp(
    (signals.bestSimilarity - signals.minSimilarity) /
      Math.max(STRONG_SIMILARITY - signals.minSimilarity, 0.01),
  );
  return round(Math.min(1, 0.45 * text + 0.45 * similarity + (signals.agreement ? 0.1 : 0)));
}

const GROUNDING_WEIGHT: Record<Grounding, number> = {
  cited: 1,
  inferred: 0.6,
  uncited: 0.2,
  none: 0,
};

const CERTAINTY_WEIGHT = { answered: 1, partial: 0.5, not_covered: 0 } as const;

/* ------------------------------------------------------------- the words */

function describeRetrieval(signals: RetrievalSignals, passages: number): string {
  if (passages === 0) return 'nothing in the docs matched';
  const parts: string[] = [];
  if (signals.text === 'strict') parts.push('the docs matched every word of the question');
  else if (signals.text === 'loose') {
    parts.push(
      `the docs matched only ${Math.round(clamp(signals.textCoverage) * 100)}% of the question's words`,
    );
  } else if (signals.semantic) parts.push('no words matched exactly');

  if (signals.semantic && signals.bestSimilarity !== null) {
    parts.push(
      signals.bestSimilarity >= signals.minSimilarity
        ? `the closest article was ${signals.bestSimilarity.toFixed(2)} similar`
        : `no article was close in meaning (best ${signals.bestSimilarity.toFixed(2)})`,
    );
  }
  if (signals.agreement) parts.push('both searches agreed on the top article');
  if (parts.length === 0) parts.push('search found a weak match');
  return parts.join(', ');
}

function describeGrounding(grounding: Grounding, cited: number): string {
  switch (grounding) {
    case 'cited':
      return cited === 1
        ? 'the answer cited the article it used'
        : `the answer cited ${cited} articles`;
    case 'inferred':
      return 'the answer cited nothing but closely follows one article';
    case 'uncited':
      return 'the answer cited none of the passages it was given';
    default:
      return 'there was nothing to cite';
  }
}

function describeCertainty(certainty: CertaintyReport | null): string {
  if (!certainty) return 'the model did not say how sure it was';
  const said =
    certainty.level === 'answered'
      ? 'the model said it answered fully'
      : certainty.level === 'partial'
        ? 'the model said it answered only part of it'
        : 'the model said the docs do not cover it';
  return certainty.reason ? `${said} (${clip(certainty.reason)})` : said;
}

function flagged(input: ConfidenceInput): string {
  if (!input.markedUnresolved) return '';
  const reason = input.markedUnresolved.reason?.trim();
  return reason
    ? ` The agent flagged it as unresolved: ${clip(reason)}.`
    : ' The agent flagged it as unresolved.';
}

function label(score: number): string {
  return score >= 0.75 ? 'High' : score >= CONFIDENCE_THRESHOLD ? 'Medium' : 'Low';
}

function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function round(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}
