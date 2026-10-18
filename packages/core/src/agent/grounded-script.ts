/**
 * The replies `FakeModel.grounded()` writes: a scripted answer made from what
 * search found, for `helpwell ask --offline`, `helpwell dev --offline` and a
 * playground with no key.
 *
 * An empty scripted reply reads as a model that failed: every answer came
 * back degraded and unresolved, and logged a gap, however well search had
 * matched. So the reply is written from the passages the agent put in front
 * of the model, in the form a real model is asked to use (grounding.ts): it
 * quotes the sentence of the top passage closest to the question, cites it,
 * and ends with how sure it is.
 *
 * How sure is the one judgement a model makes that a script cannot, so it is
 * read off the search itself. A match on every word of the question is
 * answered; a match on most of them is partial; a match on a stray word or
 * two ("pay" in "can I pay in bitcoin?") is not covered, with no citation, as
 * a model would say. Otherwise a question the docs miss would quote whatever
 * article shares one word with it and call itself resolved.
 *
 * Only the wording is canned, and a caller can supply its own. The search,
 * the citation, the confidence score, the conversation that is saved and the
 * gap a miss records all run through the real code.
 *
 * The CLI and the playground each carried a copy of this; it lives here so
 * both answer the same way.
 */

import type { RetrievalSignals } from '../search/search.js';
import type { ScriptedTurn } from './fake-model.js';
import type { Certainty } from './grounding.js';
import type { ChatRequest } from './model.js';

/** A passage the agent numbered in its system prompt. */
export interface PromptPassage {
  /** The number the answer cites it by. */
  ref: number;
  slug: string;
  title: string;
  /** The snippet search found, as plain text. */
  text: string;
}

/** How much of the question search matched, as `searchWithSignals` reports it. */
export type GroundedMatch = Pick<RetrievalSignals, 'text' | 'textCoverage'>;

/** What a scripted reply is written from. */
export interface GroundedFinding {
  /** How sure the reply is: read off how much of the question search matched. */
  level: Certainty;
  /** The passage the agent numbered first, or null when search found none. */
  top: PromptPassage | null;
  /** A sentence or two of `top`, the closest to the question. Empty when not answering. */
  quote: string;
  /** What the customer asked this turn. */
  question: string;
  /** The share of the question's words search matched, 0-1, or null when not known. */
  coverage: number | null;
  /** Which reply this is, from 0, across every conversation the model has answered. */
  turn: number;
}

/** Turns a finding into the reply's text. The citation and certainty line are added after. */
export type GroundedWording = (finding: GroundedFinding) => string;

/** Below this share of the question's words, a loose match does not count as an answer. */
const PARTIAL_COVERAGE = 0.6;

/**
 * The prompt lists each passage as `<article index="1" slug="…" title="…">`,
 * then its text, then `</article>` on its own line (prompt.ts). A passage's
 * own text cannot close the tag early: the prompt escapes any `<article`
 * inside it.
 */
const ARTICLE = /<article index="(\d+)" slug="([^"]*)" title="([^"]*)">\n([\s\S]*?)\n<\/article>/g;

/** The passages the agent put in front of the model, in the order it numbered them. */
export function promptPassages(request: ChatRequest): PromptPassage[] {
  const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
  return [...system.matchAll(ARTICLE)].map((match) => ({
    ref: Number(match[1]),
    slug: unescapeAttr(match[2] ?? ''),
    title: unescapeAttr(match[3] ?? ''),
    text: match[4] ?? '',
  }));
}

/** What the customer asked this turn: the last message they sent. */
export function questionOf(request: ChatRequest): string {
  return [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

/** What the finding comes to, before any wording: the level, the passage and the quote. */
export function groundedFinding(
  request: ChatRequest,
  options: { match?: GroundedMatch; turn?: number } = {},
): GroundedFinding {
  const { match } = options;
  const top = promptPassages(request)[0] ?? null;
  const question = questionOf(request);
  const level: Certainty = !top
    ? 'not_covered'
    : !match || match.text === 'strict'
      ? 'answered'
      : match.text === 'loose' && match.textCoverage >= PARTIAL_COVERAGE
        ? 'partial'
        : 'not_covered';
  return {
    level,
    top,
    quote: top && level !== 'not_covered' ? excerpt(top.text, { question, title: top.title }) : '',
    question,
    coverage: match ? match.textCoverage : null,
    turn: options.turn ?? 0,
  };
}

/**
 * The default wording: plain, for a terminal. A caller with a voice of its
 * own (a playground's sample agent) passes `wording` instead.
 */
export const plainWording: GroundedWording = ({ level, top, quote }) => {
  if (!top) {
    return 'Nothing in the docs matched that, so there is no answer to give. Offline mode only quotes what search finds.';
  }
  if (level === 'not_covered') {
    return `Nothing in the docs answers that. The closest article, "${top.title}", shares only a word or two with the question.`;
  }
  return quote
    ? `From "${top.title}" in your docs: ${quote}`
    : `The closest article in your docs is "${top.title}".`;
};

/**
 * One scripted reply. With `match` left out, any passage counts as an
 * answer, which is what a caller that has not searched can say.
 */
export function groundedReply(
  request: ChatRequest,
  options: { match?: GroundedMatch; turn?: number; wording?: GroundedWording } = {},
): ScriptedTurn {
  const finding = groundedFinding(request, options);
  const text = (options.wording ?? plainWording)(finding);
  const { level, top } = finding;

  if (!top) {
    return { text, certainty: { level, reason: 'offline: search found no passage' } };
  }
  if (level === 'not_covered') {
    return {
      text,
      certainty: {
        level,
        reason: `offline: the top result matched ${percent(finding.coverage)} of the question's words`,
      },
    };
  }
  return {
    text,
    cites: [top.ref],
    certainty: {
      level,
      reason:
        level === 'answered'
          ? 'offline: quoted the top search result'
          : `offline: quoted the top search result, which matched ${percent(finding.coverage)} of the question's words`,
    },
  };
}

function percent(coverage: number | null): string {
  return `${Math.round((coverage ?? 0) * 100)}%`;
}

/** Ends like a sentence: a full stop, question or exclamation mark, then any closing marks. */
const ENDED = /[.!?]["')\]*_]*$/;

/**
 * A sentence or two of a passage, as one line: the one that shares the most
 * words with the question, and the one after it if that is short.
 *
 * A passage is the article's own Markdown (passages.ts), so the section comes
 * first: the one whose heading and words share the most with the question,
 * scored as passages.ts scores them, then the sentence within it. Otherwise a
 * sentence in the introduction that happens to mention "forwarded by email"
 * beats the section headed "Forwarding by email" that answers the question.
 *
 * A passage can also be a snippet, a window search cut out of the article, so
 * it can start or stop mid-sentence, and it often opens on the article's title
 * run into the first line; the title goes, and an ellipsis marks a cut rather
 * than passing a fragment off as the whole thought. Headings, list bullets and
 * quote marks go too, because the quote is run into a sentence.
 */
export function excerpt(
  text: string,
  options: { question?: string; title?: string; max?: number } = {},
): string {
  const max = options.max ?? 280;
  const asked = keyWords(options.question ?? '');
  let flat = bestSection(text, asked)
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+|>\s?)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = options.title?.trim();
  if (title && flat.toLowerCase().startsWith(title.toLowerCase())) {
    flat = flat.slice(title.length).trim();
  }
  if (!flat) return '';

  // A sentence ends at a full stop with a space after it, so an address like
  // receipts@acme.com or a version like 4.12 stays in one piece. A piece with
  // no ending is the window's cut-off tail, and is left out.
  const sentences = flat.split(/(?<=[.!?]["')\]*_]*)\s+/).filter((piece) => ENDED.test(piece));
  let start = 0;
  let best = 0;
  sentences.forEach((sentence, i) => {
    let shared = 0;
    for (const word of keyWords(sentence)) if (asked.has(word)) shared++;
    if (shared > best) {
      best = shared;
      start = i;
    }
  });

  let quote = '';
  let taken = 0;
  for (const sentence of sentences.slice(start)) {
    const next = `${quote} ${sentence}`.trim();
    if (quote && (taken >= 2 || next.length > max || quote.length >= 120)) break;
    quote = next;
    taken++;
  }
  // No sentence ends inside the window: quote the window itself.
  if (!quote) quote = flat;
  if (quote.length > max) quote = `${quote.slice(0, max - 1).trimEnd()}…`;
  else if (quote === flat && !ENDED.test(quote)) quote = `${quote}…`;

  return /^[a-z]/.test(quote) ? `…${quote}` : quote;
}

/**
 * The body of the section that shares the most words with the question, its
 * heading's words counted twice, the first on a tie; headings themselves are
 * left out. Text with no heading is one section, all of it.
 */
function bestSection(text: string, asked: ReadonlySet<string>): string {
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }];
  for (const line of text.split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) sections.push({ heading: heading[1] ?? '', lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }
  const shared = (words: string) => {
    let count = 0;
    for (const word of keyWords(words)) if (asked.has(word)) count++;
    return count;
  };
  let best: { body: string; score: number } | null = null;
  for (const section of sections) {
    const body = section.lines.join('\n');
    if (!body.trim()) continue;
    const score = shared(`${section.heading} ${body}`) + shared(section.heading);
    if (!best || score > best.score) best = { body, score };
  }
  return best?.body ?? '';
}

const COMMON = new Set(
  'the and are you your can could would does did how what when where why who which this that there their them then than from into with for not but all any our was were have has had its'.split(
    ' ',
  ),
);

/** A sentence's words for comparing with the question: lower case, the start of each. */
function keyWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 3 && !COMMON.has(word)) out.add(word.slice(0, 5));
  }
  return out;
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
