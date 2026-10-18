/**
 * Which articles a code change might have made wrong, and which part of the
 * diff to show the model for each. Pure functions over a unified diff and the
 * articles, shared by `helpwell docs update` and hosts that check articles on
 * every change.
 */

import { clip } from './context.js';

/** Words that say nothing about which article a change touches. */
const STOP = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'will',
  'your',
  'when',
  'then',
  'else',
  'return',
  'const',
  'function',
  'import',
  'export',
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'async',
  'await',
  'class',
  'interface',
  'type',
  'default',
  'extends',
  'implements',
  'public',
  'private',
  'static',
  'void',
  'throw',
  'catch',
  'finally',
  'while',
  'break',
  'continue',
  'switch',
  'case',
  'delete',
  'typeof',
  'instanceof',
  'also',
  'into',
  'than',
  'them',
  'they',
  'there',
  'their',
  'what',
  'which',
  'where',
  'about',
  'after',
  'before',
  'other',
  'some',
  'more',
  'most',
  'only',
  'such',
  'each',
  'been',
  'were',
  'does',
  'done',
  'just',
  'like',
  'make',
  'made',
  'need',
  'over',
  'same',
  'want',
  'uses',
  'used',
  'using',
  'here',
  'file',
  'files',
  'line',
  'lines',
  'index',
  'diff',
  'name',
  'value',
  'values',
  'data',
  'item',
  'items',
  'list',
  'text',
  'page',
  'error',
  'errors',
  'options',
  'option',
  'result',
  'results',
  'args',
  'params',
  'props',
  'state',
  'self',
  'none',
  'print',
  'module',
  'require',
  'package',
  'json',
  'http',
  'https',
  'path',
  'test',
  'tests',
  'should',
  'would',
  'could',
  'these',
  'those',
  'through',
  'because',
  'every',
  'first',
  'last',
  'next',
  'back',
  'open',
  'click',
  'press',
  'select',
  'button',
]);

/**
 * The identifier-ish words in a text, four letters or more, with camelCase
 * and snake_case split into their parts and a trailing s dropped. Both the
 * diff and the articles go through this, so `exportInvoice` in code meets
 * "export an invoice" in prose.
 */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) {
    const word = match[0];
    const parts = word
      .split(/_+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
      .filter((part) => part.length >= 4);
    for (const part of [word, ...parts]) {
      let lower = part.toLowerCase();
      if (lower.length >= 5 && lower.endsWith('s')) lower = lower.slice(0, -1);
      if (!STOP.has(lower)) out.add(lower);
    }
  }
  return out;
}

/** Shared words an article needs before it is worth a model call. */
export const MIN_SHARED = 3;

/**
 * Every article with the meaningful words it shares with the diff. One model
 * call per article carrying a 40k diff is expensive, and most articles have
 * nothing to do with most changes, so only those sharing `MIN_SHARED` or more
 * are sent. The words themselves are what `--verbose` shows for each decision.
 */
export function scoreArticles<
  T extends { title: string; body: string; headings: { text: string }[] },
>(articles: T[], diff: string): { article: T; shared: string[] }[] {
  const inDiff = tokens(diff);
  const perArticle = articles.map((article) =>
    tokens(`${article.title}\n${article.headings.map((h) => h.text).join('\n')}\n${article.body}`),
  );

  // A word most articles use ("account", "settings") says nothing about which
  // one a change touches. Only a large knowledge base has enough articles for
  // that to be measurable, hence the floor.
  const frequency = new Map<string, number>();
  for (const set of perArticle) {
    for (const token of set) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  const ceiling = Math.max(4, Math.floor(articles.length / 2));

  return articles.map((article, index) => ({
    article,
    shared: [...(perArticle[index] ?? [])].filter(
      (token) => inDiff.has(token) && (frequency.get(token) ?? 0) <= ceiling,
    ),
  }));
}

/** The articles worth sending to the model. */
export function relevantArticles<
  T extends { title: string; body: string; headings: { text: string }[] },
>(articles: T[], diff: string, minShared = MIN_SHARED): T[] {
  return scoreArticles(articles, diff)
    .filter(({ shared }) => shared.length >= minShared)
    .map(({ article }) => article);
}

/** One file's worth of a unified diff, with the words it carries. */
export interface DiffChunk {
  path: string;
  text: string;
  words: Set<string>;
}

/** A file whose diff is this long is data, not a change anyone typed. */
const MAX_CHUNK_CHARS = 150_000;
/** What one file may take of the diff an article is judged against. */
const CHUNK_BUDGET = 12_000;
export const DIFF_BUDGET = 40_000;

/**
 * The diff split per file. Oversized files are dropped outright: a committed
 * export, a fixture or a bundle says nothing about the product, and it would
 * match every article because it quotes them.
 */
export function splitDiff(
  diff: string,
  onDropped?: (path: string, chars: number) => void,
): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  for (const part of diff.split(/^(?=diff --git )/m)) {
    if (!part.trim()) continue;
    const path = /^diff --git a\/(.+?) b\//.exec(part)?.[1] ?? '';
    if (part.length > MAX_CHUNK_CHARS) {
      onDropped?.(path, part.length);
      continue;
    }
    chunks.push({ path, text: part, words: tokens(part) });
  }
  return chunks;
}

/**
 * The diff to show the model for one article: every file's changes, the files
 * sharing words with the article first, each clipped so one large file cannot
 * push the hunk that matters past the end. Cutting the whole diff at a fixed
 * length in path order, as this once did, let a generated file that sorted
 * early hide a two-line change to the code the article describes.
 */
export function diffFor(
  article: { title: string; body: string; headings: { text: string }[] },
  chunks: DiffChunk[],
  budget = DIFF_BUDGET,
): string {
  const words = tokens(
    `${article.title}\n${article.headings.map((h) => h.text).join('\n')}\n${article.body}`,
  );
  const ranked = chunks
    .map((chunk, index) => {
      let shared = 0;
      for (const word of chunk.words) if (words.has(word)) shared++;
      return { chunk, shared, index };
    })
    .sort((a, b) => b.shared - a.shared || a.index - b.index);

  let out = '';
  for (const { chunk } of ranked) {
    const room = budget - out.length;
    if (room < 500) break;
    const piece = clip(chunk.text, Math.min(CHUNK_BUDGET, room));
    out += piece.endsWith('\n') ? piece : `${piece}\n`;
  }
  return out;
}
