/**
 * What the model reads of each article search found.
 *
 * Search hands back a snippet: thirty-odd words around the match, cut
 * wherever the word count ran out. That suits a results list and fails an
 * answer. Asked "what can I export?", the model saw a sentence and three items
 * of a twelve-item list, and answered with three. So the model reads the
 * article's own Markdown instead: the sections that match the question, whole,
 * then as many of the others as fit. A section is a heading and everything up
 * to the next one.
 *
 * Nothing is cut mid-thought if it can be helped. A section too long to fit is
 * cut between blocks: a paragraph, a whole list, a whole code block. Only a
 * block too long on its own is cut inside, between list items, lines of code
 * or sentences, and only a sentence longer than the whole allowance is cut
 * between words. Every cut is marked with an ellipsis, so the model can tell
 * an excerpt from the whole.
 *
 * All of it sits inside one budget, in tokens (`PASSAGE_TOKEN_BUDGET`), so a
 * question that matches five long articles costs what one matching five short
 * ones does. Short passages are given whole. When they do not all fit, the
 * long ones are cut to an equal share of what is left, so every passage search
 * found is still there to cite, and the numbering the citations rely on never
 * changes.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { plainSnippet, type SearchHit } from '../search/search.js';

/**
 * Everything the passages in one system prompt may add up to, in estimated
 * tokens: about 12,000 characters of documentation.
 */
export const PASSAGE_TOKEN_BUDGET = 3000;

/** The most any one passage may take, however much of the budget is free. */
export const MAX_PASSAGE_TOKENS = 1200;

/**
 * What one `search_docs` call may return. Its result goes back to the model
 * as JSON capped at 8,000 characters (`MAX_TOOL_RESULT_CHARS`), with the
 * titles and slugs of up to twenty results beside the text; the tool shrinks
 * the budget further on the rare call where that is still too much.
 */
export const SEARCH_TOOL_TOKEN_BUDGET = 1000;

/**
 * The usual rule of thumb for English. It is an estimate: it keeps the
 * prompt to a predictable size, and is not what the provider bills.
 */
const CHARS_PER_TOKEN = 4;

/** Marks text left out, between sections or at a cut. */
const GAP = '…';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** A search hit and what the model reads of its article. */
export interface Passage extends SearchHit {
  /** The article's own Markdown: its matching sections, cut only between blocks or sentences. */
  text: string;
}

export interface PassageOptions {
  /** All the passages together, in estimated tokens. Defaults to `PASSAGE_TOKEN_BUDGET`. */
  budget?: number;
  /** Any one passage, in estimated tokens. Defaults to `MAX_PASSAGE_TOKENS`. */
  maxPerPassage?: number;
}

/**
 * The hits, in the order search ranked them, each with the part of its
 * article the question is about. An article with no body falls back to its
 * snippet, then its description.
 */
export async function loadPassages(
  db: Db,
  question: string,
  hits: SearchHit[],
  options: PassageOptions = {},
): Promise<Passage[]> {
  if (hits.length === 0) return [];
  const rows = rowsOf<{ slug: string; body: string | null }>(
    await db.execute(sql`
      SELECT slug, body FROM helpwell.article_index WHERE slug IN ${hits.map((hit) => hit.slug)}
    `),
  );
  const bodies = new Map(rows.map((row) => [row.slug, row.body ?? '']));
  const texts = fitPassages(
    hits.map((hit) => {
      const body = withoutTitle(bodies.get(hit.slug) ?? '', hit.title).trim();
      return {
        markdown: body || plainSnippet(hit.snippet) || hit.description || '',
        terms: termsOf(question, hit.snippet),
      };
    }),
    options,
  );
  return hits.map((hit, k) => ({ ...hit, text: texts[k] ?? '' }));
}

/**
 * The text of each article that fits the budget, in the order given.
 *
 * Each passage first gets as much as it wants, up to the per-passage limit.
 * If that adds up to more than the budget, a level is found at which every
 * passage under it keeps all it wanted and every passage over it is cut to
 * that level; the level is the largest for which the total still fits.
 */
export function fitPassages(
  articles: { markdown: string; terms: ReadonlySet<string> }[],
  options: PassageOptions = {},
): string[] {
  const budget = options.budget ?? PASSAGE_TOKEN_BUDGET;
  const max = Math.min(options.maxPerPassage ?? MAX_PASSAGE_TOKENS, budget);
  const parsed = articles.map((article) => sectionsOf(article.markdown));
  const wanted = parsed.map((sections, k) => passageOf(sections, articles[k]!.terms, max));
  const sizes = wanted.map(estimateTokens);
  if (sizes.reduce((sum, size) => sum + size, 0) <= budget) return wanted;

  const level = waterLevel(sizes, budget);
  return wanted.map((text, k) =>
    sizes[k]! <= level ? text : passageOf(parsed[k]!, articles[k]!.terms, level),
  );
}

/** The largest share for which the passages, each capped at it, fit the budget. */
function waterLevel(sizes: number[], budget: number): number {
  const sorted = [...sizes].sort((a, b) => a - b);
  let remaining = budget;
  for (let k = 0; k < sorted.length; k++) {
    const share = Math.floor(remaining / (sorted.length - k));
    if (sorted[k]! > share) return share;
    remaining -= sorted[k]!;
  }
  return remaining;
}

/* -------------------------------------------------------------- sections */

type BlockKind = 'heading' | 'code' | 'list' | 'text';

interface Block {
  kind: BlockKind;
  text: string;
}

/** A heading (when it has one) and the blocks under it. */
type Section = Block[];

const FENCE = /^ {0,3}(?:```|~~~)/;
const HEADING = /^ {0,3}#{1,6}[ \t]/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/** Split an article into sections, and each section into blocks. Fenced code is one block. */
function sectionsOf(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections: Section[] = [[]];
  let open: { kind: BlockKind; lines: string[] } | null = null;
  const current = () => sections[sections.length - 1]!;
  const close = () => {
    if (open) current().push({ kind: open.kind, text: open.lines.join('\n').trimEnd() });
    open = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trimEnd();

    if (FENCE.test(line)) {
      close();
      const code = [line];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) code.push(lines[i++] ?? '');
      if (i < lines.length) code.push((lines[i] ?? '').trimEnd());
      current().push({ kind: 'code', text: code.join('\n') });
      continue;
    }

    if (HEADING.test(line)) {
      close();
      sections.push([{ kind: 'heading', text: line.trim() }]);
      continue;
    }

    if (!line.trim()) {
      // A loose list keeps its blank lines: the list goes on while the next
      // line with anything on it is another item or indented under one.
      const block = open as { kind: BlockKind; lines: string[] } | null;
      if (block?.kind === 'list' && listContinues(lines, i)) block.lines.push('');
      else close();
      continue;
    }

    const item = LIST_ITEM.test(line);
    const block = open as { kind: BlockKind; lines: string[] } | null;
    if (block && (block.kind === 'list' ? item || /^\s/.test(line) : !item)) {
      block.lines.push(line);
      continue;
    }
    close();
    open = { kind: item ? 'list' : 'text', lines: [line] };
  }
  close();
  return sections.filter((section) => section.length > 0);
}

function listContinues(lines: string[], blank: number): boolean {
  for (let j = blank + 1; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (!line.trim()) continue;
    return LIST_ITEM.test(line) || /^\s/.test(line);
  }
  return false;
}

/* --------------------------------------------------------------- choosing */

/**
 * The part of an article that fits `allowance`: all of it when it fits,
 * otherwise whole sections, the best-matching first, set out in the order
 * the article has them.
 */
function passageOf(sections: Section[], terms: ReadonlySet<string>, allowance: number): string {
  if (allowance <= 0 || sections.length === 0) return '';
  const all = sections.map(sectionText);
  const whole = all.join('\n\n');
  if (estimateTokens(whole) <= allowance) return whole;

  const ranked = sections
    .map((section, index) => ({ index, score: sectionScore(section, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0]!.index;
  if (estimateTokens(all[best]!) > allowance) {
    return cutSection(sections[best]!, terms, allowance);
  }

  const chosen = new Set<number>();
  for (const { index } of ranked) {
    chosen.add(index);
    if (estimateTokens(joinSections(all, chosen)) > allowance) chosen.delete(index);
  }
  return joinSections(all, chosen);
}

/** The chosen sections in article order, with a gap marked wherever some were left out. */
function joinSections(all: string[], chosen: ReadonlySet<number>): string {
  const parts: string[] = [];
  const indices = [...chosen].sort((a, b) => a - b);
  indices.forEach((index, k) => {
    if (k === 0 ? index > 0 : index > indices[k - 1]! + 1) parts.push(GAP);
    parts.push(all[index]!);
  });
  if ((indices[indices.length - 1] ?? all.length - 1) < all.length - 1) parts.push(GAP);
  return parts.join('\n\n');
}

function sectionText(section: Section): string {
  return section.map((block) => block.text).join('\n\n');
}

/** Terms in the section, with the heading's counted twice: a heading says what a section is about. */
function sectionScore(section: Section, terms: ReadonlySet<string>): number {
  const heading = section[0]?.kind === 'heading' ? section[0].text : '';
  return overlap(sectionText(section), terms) + overlap(heading, terms);
}

/**
 * One section that does not fit whole: its heading, then its blocks in
 * order from the top, or from the best-matching block when the run from
 * the top to it would not fit. A block that does not fit is cut inside.
 */
function cutSection(section: Section, terms: ReadonlySet<string>, allowance: number): string {
  const heading = section[0]?.kind === 'heading' ? section[0] : null;
  const blocks = heading ? section.slice(1) : section;
  const parts: string[] = heading ? [heading.text] : [];

  let best = 0;
  let bestScore = 0;
  blocks.forEach((block, k) => {
    const score = overlap(block.text, terms);
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  });
  const leadIn = [...parts, ...blocks.slice(0, best + 1).map((block) => block.text)];
  let start = estimateTokens(leadIn.join('\n\n')) <= allowance ? 0 : best;
  if (start > 0) parts.push(GAP);
  if (blocks.length === 0) return capped(parts.join('\n\n'), allowance);

  let taken = 0;
  for (; start < blocks.length; start++) {
    const block = blocks[start]!;
    const next = [...parts, block.text].join('\n\n');
    if (estimateTokens(next) <= allowance) {
      parts.push(block.text);
      taken++;
      continue;
    }
    if (taken === 0) {
      // A heading alone says nothing, so the first block is taken even when
      // it has to be cut, leaving room for the separator and the gap mark.
      const cut = cutBlock(block, allowance - estimateTokens([...parts, GAP].join('\n\n')) - 1);
      if (cut) parts.push(cut);
    }
    break;
  }
  const cutShort = start < blocks.length && !parts[parts.length - 1]?.endsWith(GAP);
  if (cutShort && estimateTokens([...parts, GAP].join('\n\n')) <= allowance) parts.push(GAP);
  return capped(parts.join('\n\n'), allowance);
}

/** A block cut to `allowance` at the finest boundary it has: items, lines or sentences. */
function cutBlock(block: Block, allowance: number): string {
  if (allowance <= 0) return '';
  if (block.kind === 'code') {
    const [open, ...rest] = block.text.split('\n');
    const close = rest.length > 0 && FENCE.test(rest[rest.length - 1] ?? '') ? rest.pop()! : '```';
    const lines = [open ?? '```'];
    for (const line of rest) {
      if (estimateTokens([...lines, line, close].join('\n')) > allowance) break;
      lines.push(line);
    }
    return lines.length > 1 ? [...lines, close].join('\n') : '';
  }

  const pieces = block.kind === 'list' ? listItems(block.text) : sentences(block.text);
  const joiner = block.kind === 'list' ? '\n' : ' ';
  const taken: string[] = [];
  for (const piece of pieces) {
    if (estimateTokens([...taken, piece].join(joiner)) > allowance) break;
    taken.push(piece);
  }
  if (taken.length > 0) return taken.join(joiner);
  return hardCut(pieces[0] ?? block.text, allowance);
}

/** A list's items, each with the lines indented under it. */
function listItems(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split('\n')) {
    if (LIST_ITEM.test(line) && !/^\s/.test(line)) items.push(line);
    else if (items.length > 0) items[items.length - 1] += `\n${line}`;
    else items.push(line);
  }
  return items.map((item) => item.trimEnd());
}

/**
 * A paragraph's sentences. A sentence ends at a full stop, question or
 * exclamation mark with a space after it, so `receipts@acme.com` and
 * version 4.12 stay whole.
 */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?]["')\]*_]*)\s+/).filter(Boolean);
}

/** The last resort: cut between words, with the cut marked. */
function hardCut(text: string, allowance: number): string {
  const room = allowance * CHARS_PER_TOKEN - GAP.length;
  if (room <= 0) return '';
  if (text.length <= room) return text;
  const slice = text.slice(0, room);
  const space = slice.lastIndexOf(' ');
  return `${(space > room / 2 ? slice.slice(0, space) : slice).trimEnd()}${GAP}`;
}

/** Never over the allowance, whatever the pieces added up to. */
function capped(text: string, allowance: number): string {
  return estimateTokens(text) <= allowance ? text : hardCut(text, allowance);
}

/* ------------------------------------------------------------------ terms */

/**
 * The words that say what the question is about: its own content words, and
 * the words search marked in the snippet, which are the ones Postgres's
 * stemming matched in the article.
 */
function termsOf(question: string, snippet: string): Set<string> {
  const marked = [...snippet.matchAll(/<mark>([\s\S]*?)<\/mark>/g)].map((m) => m[1] ?? '');
  return wordsOf([question, ...marked].join(' '));
}

/** How many of `terms` appear in `text`. */
function overlap(text: string, terms: ReadonlySet<string>): number {
  if (terms.size === 0) return 0;
  const words = wordsOf(text);
  let count = 0;
  for (const term of terms) if (words.has(term)) count++;
  return count;
}

const COMMON = new Set(
  'the and are you your can could would should does did have has had how what when where why who which this that these those there their them then than from into with without for not but all any our out was were been its about just also only here some get got use using please thanks'.split(
    ' ',
  ),
);

function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3 || COMMON.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

/** The commonest English endings, so "exporting" and "exports" meet "export". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * The body without an opening `# Title` that only repeats the title the
 * prompt already gives the passage.
 */
function withoutTitle(markdown: string, title: string): string {
  const opening = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/.exec(markdown);
  const plain = (value: string) =>
    value.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!opening || plain(opening[1] ?? '') !== plain(title)) return markdown;
  return markdown.slice(opening[0].length);
}
