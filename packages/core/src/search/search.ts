/**
 * Search (KB-09).
 *
 * Two passes over the same index. Full text answers "these words appear here"
 * and is exact about product nouns; embeddings answer "this means the same
 * thing" and rescue questions phrased nothing like the docs. Merging them with
 * reciprocal rank fusion avoids having to calibrate two incomparable scores.
 *
 * Full text is strict first: every meaningful word of the question has to
 * appear. A customer types "hi, how do I get my invoices out as a spreadsheet
 * for my accountant", though, and a strict match on that finds nothing even
 * when an article on exporting invoices exists. So when the strict query comes
 * back empty, a loose one runs: any of the words, ranked by how many of them
 * an article contains. Which of the two answered is reported, because a loose
 * match is weaker evidence than a strict one.
 *
 * The semantic pass has a floor. Cosine similarity is never zero between two
 * pieces of English, so without one every article is "a match" for every
 * question once anything is embedded, and the agent could never tell that the
 * docs had nothing to say. Candidates under `MIN_SIMILARITY` are dropped.
 *
 * Semantic search is optional: without an embedding model, full text alone
 * still works, which keeps a fresh install useful before any key is set. It is
 * also best effort: an embedding call that fails degrades the query to full
 * text rather than failing it.
 *
 * Snippets are HTML. An article body is customer-written Markdown and may
 * contain anything, including a script tag, so everything in a snippet is
 * escaped except the `<mark>` tags around the matched terms. The help centre
 * and the widget can insert a snippet as it is; `plainSnippet()` turns one back
 * into text.
 *
 * A snippet is cut from the article as a reader sees it, not from its
 * Markdown: no `**` or `##`, and a code span's words kept. Postgres picks the
 * window and marks the terms (its stemming is what matched them), but its
 * headline parser reads anything shaped like an HTML tag as a tag and drops
 * it, which turned "put it in the `<head>`" into "put it in the ` `". So the
 * text it is given has every `<` swapped for a marker, and put back after.
 * Only the hits a search returns get a snippet, rather than every candidate.
 */

import { type SQL, sql } from 'drizzle-orm';
import { recordSpend } from '../agent/guards.js';
import type { ModelPort } from '../agent/model.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { searches } from '../db/schema.js';
import { idPrefix, newId } from '../ids.js';
import { markdownToPlainText } from './plain-text.js';

export interface SearchHit {
  slug: string;
  title: string;
  collection: string;
  description: string | null;
  /**
   * The passage that matched, as HTML: the article's words as a reader sees
   * them, with no Markdown, and every character escaped except the `<mark>`
   * tags around the terms, so it is safe to insert raw. Use `plainSnippet()`
   * when text is wanted.
   */
  snippet: string;
  score: number;
  /** which pass found it, for debugging and for the "why" in reports */
  matchedBy: ('text' | 'semantic')[];
  /**
   * Cosine similarity to the query, when the semantic pass found it. `score`
   * is a rank fusion and means nothing on its own; this is the number the
   * conversation review shows beside a citation.
   */
  similarity?: number;
}

export interface SearchOptions {
  limit?: number;
  collection?: string;
  /** include drafts; the dashboard does, the public help center never does */
  includeDrafts?: boolean;
  /**
   * The visitor is someone the host app identified, so collections whose
   * `_meta.json` says `visibility: "identified"` are searchable. Defaults to
   * `includeDrafts`: an admin surface that sees drafts sees everything, and
   * every public surface sees only public collections until it says otherwise.
   */
  identified?: boolean;
  /** The agent is asking: collections marked `askAgent: false` are left out. */
  forAgent?: boolean;
  /** Set, together with a non-empty `embeddingModel`, to run the semantic pass. */
  model?: ModelPort;
  embeddingModel?: string;
  /**
   * The lowest cosine similarity the semantic pass counts as a match.
   * Defaults to `MIN_SIMILARITY`. Tests with toy embeddings set it lower.
   */
  minSimilarity?: number;
}

/**
 * How search went, beyond the list of hits. The agent turns this into the
 * retrieval half of its confidence score (agent/confidence.ts).
 */
export interface RetrievalSignals {
  /**
   * How the full-text pass matched: every word of the question (`strict`),
   * only some of them through the fallback (`loose`), or not at all.
   */
  text: 'strict' | 'loose' | 'none';
  /**
   * The share of the question's words the best full-text hit contains, 0-1.
   * 1 for a strict match, 0 when full text found nothing.
   */
  textCoverage: number;
  /** A semantic pass actually ran: the question was embedded and there were vectors to compare. */
  semantic: boolean;
  /**
   * The highest cosine similarity of any candidate, including ones under the
   * floor, or null when no semantic pass ran.
   */
  bestSimilarity: number | null;
  /** The floor that pass used. */
  minSimilarity: number;
  /** The top hit was found by both passes. */
  agreement: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  signals: RetrievalSignals;
}

/**
 * The semantic pass's floor. Calibrated for `openai/text-embedding-3-small`,
 * the default embedding model, where an unrelated question and article sit at
 * roughly 0.05-0.2 and a genuine match starts around 0.3. A model whose
 * similarities all sit higher (older OpenAI embeddings cluster near 0.7) makes
 * this floor too low to filter anything, which costs precision, not answers.
 */
export const MIN_SIMILARITY = 0.25;

/** Rank position -> contribution. 60 is the constant from the RRF paper. */
const RRF_K = 60;

/**
 * `ts_headline` wraps matched terms in these instead of `<mark>`, so the whole
 * snippet can be HTML-escaped first and the tags put back afterwards. Control
 * characters that no prose contains, and that are taken out of an article's
 * text before Postgres sees it, so an article cannot forge one.
 */
const MARK_START = '\x01';
const MARK_END = '\x02';
/** Stands in for `<` while Postgres reads the text, so nothing looks like a tag to it. */
const LESS_THAN = '\x03';
const HEADLINE_OPTIONS = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1`;

export async function searchArticles(
  db: Db,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  return (await searchWithSignals(db, query, options)).hits;
}

/** `searchArticles`, plus how strong the match was. */
export async function searchWithSignals(
  db: Db,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      hits: [],
      signals: {
        text: 'none',
        textCoverage: 0,
        semantic: false,
        bestSimilarity: null,
        minSimilarity,
        agreement: false,
      },
    };
  }
  const limit = options.limit ?? 8;

  const text = await textSearch(db, trimmed, options);
  // No embeddings model configured means no semantic pass, whatever the caller
  // passed as a model: there is no default model name to fall back on.
  const semantic =
    options.model && options.embeddingModel
      ? await semanticSearch(db, trimmed, options, minSimilarity)
      : { hits: [], ran: false, best: null };

  const merged = new Map<string, SearchHit>();
  const add = (hits: SearchHit[], by: 'text' | 'semantic') => {
    hits.forEach((hit, index) => {
      const existing = merged.get(hit.slug);
      const contribution = 1 / (RRF_K + index + 1);
      if (existing) {
        existing.score += contribution;
        if (!existing.matchedBy.includes(by)) existing.matchedBy.push(by);
        if (hit.similarity !== undefined) existing.similarity = hit.similarity;
      } else {
        merged.set(hit.slug, { ...hit, score: contribution, matchedBy: [by] });
      }
    });
  };
  add(text.hits, 'text');
  add(semantic.hits, 'semantic');

  const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  await addSnippets(db, hits, trimmed, text.mode === 'strict');
  return {
    hits,
    signals: {
      text: text.mode,
      textCoverage: text.coverage,
      semantic: semantic.ran,
      bestSimilarity: semantic.best,
      minSimilarity,
      agreement: (hits[0]?.matchedBy.length ?? 0) > 1,
    },
  };
}

/**
 * The WHERE clauses both passes share. Every clause starts with AND so it can
 * follow the pass's own condition. The table is aliased `a` in both queries.
 *
 * Collection rules come from `collection_index`, written by `helpwell sync`
 * from each folder's `_meta.json`. A folder with no row is public and open to
 * the agent, which is what a folder with no `_meta.json` means.
 */
function scopeFilter(options: SearchOptions): SQL {
  const clauses: SQL[] = [];
  if (!options.includeDrafts) clauses.push(sql`a.status = 'published'`);
  if (options.collection) clauses.push(sql`a.collection = ${options.collection}`);

  const hidden: SQL[] = [];
  if (!(options.identified ?? options.includeDrafts)) hidden.push(sql`c.visibility = 'identified'`);
  if (options.forAgent) hidden.push(sql`c.ask_agent = false`);
  if (hidden.length > 0) {
    const anyHidden = hidden.reduce((acc, clause) => sql`${acc} OR ${clause}`);
    clauses.push(
      sql`NOT EXISTS (SELECT 1 FROM helpwell.collection_index c WHERE c.id = a.collection AND (${anyHidden}))`,
    );
  }

  let out = sql``;
  for (const clause of clauses) out = sql`${out} AND ${clause}`;
  return out;
}

type TextRow = {
  slug: string;
  title: string;
  collection: string;
  description: string | null;
  rank: number | string;
  matched?: number | string;
  total?: number | string;
};

interface TextResult {
  hits: SearchHit[];
  mode: RetrievalSignals['text'];
  coverage: number;
}

async function textSearch(db: Db, query: string, options: SearchOptions): Promise<TextResult> {
  const strict = await db.execute<TextRow>(sql`
    SELECT
      a.slug,
      a.title,
      a.collection,
      a.description,
      ts_rank(a.search_tsv, websearch_to_tsquery('english', ${query})) AS rank
    FROM helpwell.article_index a
    WHERE a.search_tsv @@ websearch_to_tsquery('english', ${query})${scopeFilter(options)}
    ORDER BY rank DESC
    LIMIT ${(options.limit ?? 8) * 3}
  `);
  const strictRows = rowsOf<TextRow>(strict);
  if (strictRows.length > 0) {
    return { hits: strictRows.map(toTextHit), mode: 'strict', coverage: 1 };
  }

  // Any of the words, most of them first. plainto_tsquery joins the question's
  // lexemes with " & ", and a lexeme never contains a space, so swapping the
  // operator is safe whatever the question contained. `matched` counts how
  // many of the question's lexemes an article has, which ranks a broad match
  // over a single lucky word and becomes the coverage the agent scores.
  const loose = await db.execute<TextRow>(sql`
    WITH q AS (
      SELECT
        replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery AS any_word,
        tsvector_to_array(to_tsvector('english', ${query})) AS words
    )
    SELECT
      a.slug,
      a.title,
      a.collection,
      a.description,
      ts_rank(a.search_tsv, q.any_word) AS rank,
      (
        SELECT count(*) FROM unnest(q.words) AS w(lexeme)
        WHERE w.lexeme = ANY (tsvector_to_array(a.search_tsv))
      ) AS matched,
      cardinality(q.words) AS total
    FROM helpwell.article_index a, q
    WHERE a.search_tsv @@ q.any_word${scopeFilter(options)}
    ORDER BY matched DESC, rank DESC
    LIMIT ${(options.limit ?? 8) * 3}
  `);
  const looseRows = rowsOf<TextRow>(loose);
  if (looseRows.length === 0) return { hits: [], mode: 'none', coverage: 0 };

  const top = looseRows[0]!;
  const total = Number(top.total) || 0;
  const coverage = total > 0 ? Math.min(1, (Number(top.matched) || 0) / total) : 0;
  return { hits: looseRows.map(toTextHit), mode: 'loose', coverage };
}

function toTextHit(row: TextRow): SearchHit {
  return {
    slug: row.slug,
    title: row.title,
    collection: row.collection,
    description: row.description,
    snippet: '',
    score: Number(row.rank) || 0,
    matchedBy: ['text'],
  };
}

type SemanticRow = {
  slug: string;
  title: string;
  collection: string;
  description: string | null;
  embedding: number[] | string | null;
};

interface SemanticResult {
  hits: SearchHit[];
  /** The question was embedded and compared against at least one vector. */
  ran: boolean;
  /** The best similarity of any candidate, floor or not. */
  best: number | null;
}

async function semanticSearch(
  db: Db,
  query: string,
  options: SearchOptions,
  minSimilarity: number,
): Promise<SemanticResult> {
  const model = options.model!;
  const embeddingModel = options.embeddingModel!;
  const none: SemanticResult = { hits: [], ran: false, best: null };

  // Only what the cosine needs: the vector and the labels. Loading every full
  // body on every query was the slowest thing a help centre did; the few
  // that are returned get their snippets afterwards.
  const result = await db.execute<SemanticRow>(sql`
    SELECT a.slug, a.title, a.collection, a.description, a.embedding
    FROM helpwell.article_index a
    WHERE a.embedding IS NOT NULL AND jsonb_typeof(a.embedding) = 'array'${scopeFilter(options)}
  `);
  const candidates = rowsOf<SemanticRow>(result)
    .map((row) => ({ ...row, embedding: parseVector(row.embedding) }))
    .filter((row) => row.embedding.length > 0);
  if (candidates.length === 0) return none;

  let queryVector: number[] | undefined;
  try {
    const { vectors, usage } = await model.embed({ model: embeddingModel, input: [query] });
    queryVector = vectors[0];
    await recordSpend(db, { kind: 'embedding', model: embeddingModel, usage });
  } catch {
    // The provider is down, the key is wrong, or there is no key yet. Full
    // text has already answered; the visitor gets that rather than an error.
    return none;
  }
  if (!queryVector) return none;

  const scored = candidates
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      collection: row.collection,
      description: row.description,
      snippet: '',
      score: cosine(queryVector, row.embedding),
      matchedBy: ['semantic'] as ('text' | 'semantic')[],
    }))
    .map((hit) => ({ ...hit, similarity: hit.score }))
    .sort((a, b) => b.score - a.score);

  return {
    hits: scored.filter((hit) => hit.score >= minSimilarity).slice(0, (options.limit ?? 8) * 2),
    ran: true,
    best: scored[0]?.score ?? null,
  };
}

/** Both drivers hand jsonb back parsed; a string means one did not. */
function parseVector(value: number[] | string | null): number[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/* -------------------------------------------------------------- snippets */

/**
 * Give each hit its snippet: the passage of its article, as plain text, that
 * best matches the question, with the matched words marked.
 *
 * `strict` is how full text matched. A strict match marks the question's
 * words as it searched for them; otherwise (a loose match, or semantic hits
 * only) any word of the question is marked, and an article that shares none
 * opens its snippet at the start.
 */
async function addSnippets(
  db: Db,
  hits: SearchHit[],
  query: string,
  strict: boolean,
): Promise<void> {
  if (hits.length === 0) return;
  const bodies = rowsOf<{ slug: string; title: string; body: string | null }>(
    await db.execute(sql`
      SELECT slug, title, body FROM helpwell.article_index WHERE slug IN ${hits.map((hit) => hit.slug)}
    `),
  );
  // The title is shown above the snippet, so a first heading that repeats it
  // is not part of the snippet's text.
  const docs = bodies
    .map((row) => ({
      slug: row.slug,
      text: markdownToPlainText(row.body ?? '', { title: row.title }),
    }))
    .filter((doc) => doc.text.trim());
  if (docs.length === 0) return;

  const tsquery = strict
    ? sql`websearch_to_tsquery('english', ${query})`
    : sql`replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery`;
  const readable = JSON.stringify(
    docs.map((doc) => ({ slug: doc.slug, text: doc.text.replaceAll('<', LESS_THAN) })),
  );
  const headlines = rowsOf<{ slug: string; headline: string | null }>(
    await db.execute(sql`
      SELECT t.slug, ts_headline('english', t.text, ${tsquery}, ${HEADLINE_OPTIONS}::text) AS headline
      FROM jsonb_to_recordset(${readable}::jsonb) AS t(slug text, text text)
    `),
  );

  const texts = new Map(docs.map((doc) => [doc.slug, doc.text]));
  const snippets = new Map(
    headlines.map((row) => [row.slug, markSnippet(row.headline ?? '', texts.get(row.slug) ?? '')]),
  );
  for (const hit of hits) hit.snippet = snippets.get(hit.slug) ?? '';
}

/**
 * A headline as HTML: `<` restored, one line, an ellipsis wherever the
 * window cut the article short, everything escaped, then the markers become
 * `<mark>`.
 */
function markSnippet(headline: string, text: string): string {
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim();
  const shown = flat(headline.replaceAll(LESS_THAN, '<'));
  if (!shown) return '';
  const whole = flat(text);
  const words = shown.replaceAll(MARK_START, '').replaceAll(MARK_END, '');
  const at = whole.indexOf(words);
  const before = at === 0 ? '' : '…';
  // Postgres ends the window on a word, leaving off the full stop after it.
  // A sentence that ends there gets its stop back, and no ellipsis; a window
  // that stops mid-sentence says so.
  const rest = at < 0 ? '' : whole.slice(at + words.length);
  const stop = /^[.!?:;)"'\]]*(?=\s|$)/.exec(rest)?.[0] ?? '';
  const ended = at >= 0 && (rest === stop || /[.!?:]$/.test(words + stop));
  const cut = `${before}${shown}${stop}${ended ? '' : '…'}`;
  return escapeHtml(cut).replaceAll(MARK_START, '<mark>').replaceAll(MARK_END, '</mark>');
}

/** Written out rather than imported: core cannot depend on the UI package. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

/** A snippet as plain text: no `<mark>` tags and no entities. For the model. */
export function plainSnippet(snippet: string): string {
  return snippet
    .replace(/<\/?mark>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name] ?? '');
}

/* --------------------------------------------------------------- history */

/**
 * Record what someone searched for.
 *
 * A search with no results is the raw material for the gaps list (KB-25), so
 * this is written for every query, including the ones that found nothing.
 */
export async function recordSearch(
  db: Db,
  params: {
    query: string;
    resultsCount: number;
    source?: 'help_center' | 'widget';
    contactId?: string | null;
  },
): Promise<void> {
  await db.insert(searches).values({
    id: newId(idPrefix.search),
    query: params.query.trim().slice(0, 500),
    resultsCount: params.resultsCount,
    source: params.source ?? 'help_center',
    contactId: params.contactId ?? null,
  });
}
