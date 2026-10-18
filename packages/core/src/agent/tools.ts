/**
 * The agent's tools (AG-04).
 *
 * Six of them, each with a stated scope. Read tools look things up; the two
 * write tools only touch HelpWell's own records, never the customer's app.
 * Every tool is a toggle in Settings. A disabled tool is absent from the list
 * the model sees, and refused if the model calls it anyway: a model that
 * remembers a tool from an earlier turn, or invents one, gets an error back
 * rather than a result.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { changelogEntries, contacts } from '../db/schema.js';
import { type RetrievalSignals, searchWithSignals } from '../search/search.js';
import type { ModelPort, ToolSpec } from './model.js';
import { loadPassages, SEARCH_TOOL_TOKEN_BUDGET } from './passages.js';
import type { AgentTools } from './types.js';

export type ToolName =
  | 'search_docs'
  | 'read_changelog'
  | 'look_up_user'
  | 'collect_email'
  | 'mark_unresolved'
  | 'suggest_article';

/** The most a read tool returns in one call, whatever the model asks for. */
const MAX_LIMIT = 20;

/** How much of a tool's result, as JSON, goes back to the model. */
export const MAX_TOOL_RESULT_CHARS = 8000;

const SPECS: Record<ToolName, ToolSpec> = {
  search_docs: {
    name: 'search_docs',
    description:
      'Search the help center for passages that answer the question. Use this before answering anything factual. Each result has a ref number: cite it in square brackets, like [6], after a sentence that uses it.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in the customer’s words.' },
        collection: { type: 'string', description: 'Optional collection to search inside.' },
        limit: { type: 'number', description: 'How many results, at most 20. Default 5.' },
      },
      required: ['query'],
    },
  },
  read_changelog: {
    name: 'read_changelog',
    description:
      'Read recent published releases. Use it when someone asks what changed, or whether something shipped.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many entries, newest first. At most 20.' },
      },
    },
  },
  look_up_user: {
    name: 'look_up_user',
    description:
      'Read what the app already told us about this person. Read only, and never asks them for anything.',
    parameters: { type: 'object', properties: {} },
  },
  collect_email: {
    name: 'collect_email',
    description:
      'Ask an unidentified visitor for an email address so a human can follow up. Never call this for someone the app already identified.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you need it, in one short line.' },
      },
    },
  },
  mark_unresolved: {
    name: 'mark_unresolved',
    description:
      'Flag this conversation for the team, and record the question as a gap when the docs did not cover it.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question in one canonical sentence.' },
        reason: { type: 'string', description: 'Why you could not answer.' },
      },
      required: ['question'],
    },
  },
  suggest_article: {
    name: 'suggest_article',
    description: 'Attach an article card to your answer so they can read the whole thing.',
    parameters: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'The slug from a search result.' } },
      required: ['slug'],
    },
  },
};

const SETTING_BY_TOOL: Record<ToolName, keyof AgentTools> = {
  search_docs: 'searchDocs',
  read_changelog: 'readChangelog',
  look_up_user: 'lookUpUser',
  collect_email: 'collectEmail',
  mark_unresolved: 'markUnresolved',
  suggest_article: 'suggestArticle',
};

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(SPECS, name);
}

/**
 * The tools this conversation may use.
 *
 * `collect_email` drops out for identified visitors whatever the setting says,
 * because the app already told us who they are and asking again is the thing
 * WG-07 exists to prevent.
 */
export function toolsFor(settings: AgentTools, context: { identified: boolean }): ToolSpec[] {
  return (Object.keys(SPECS) as ToolName[])
    .filter((name) => settings[SETTING_BY_TOOL[name]])
    .filter((name) => !(name === 'collect_email' && context.identified))
    .map((name) => SPECS[name]);
}

export interface ToolContext {
  db: Db;
  conversationId: string;
  contactId: string | null;
  identified: boolean;
  /** The Settings toggles. A tool switched off here is refused even when called. */
  tools: AgentTools;
  model?: ModelPort;
  embeddingModel?: string;
  /**
   * Makes a search result citable and returns the number the model cites it
   * by. The agent numbers the passages in the prompt 1..n, so results from a
   * search the model runs itself continue from there. Without it, results
   * carry no ref.
   */
  cite?: (passage: {
    slug: string;
    title: string;
    collection: string;
    text: string;
    /** How search found it, for the conversation review (MessageSource). */
    matchedBy?: ('text' | 'semantic')[];
    similarity?: number;
  }) => number;
}

export interface ToolOutcome {
  /** What goes back to the model. */
  result: unknown;
  /** Side effects the agent loop needs to know about. */
  effects?: {
    /** Articles the model attached on purpose. Search results are only citable, not cited. */
    citations?: { slug: string; title: string; collection: string }[];
    askForEmail?: { reason?: string };
    unresolved?: { question: string; reason?: string };
    /** How the model's own search went, for the confidence score. */
    retrieval?: { signals: RetrievalSignals; passages: number };
  };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  if (!isToolName(name)) return { result: { error: `Unknown tool: ${name}` } };
  if (!context.tools[SETTING_BY_TOOL[name]]) return { result: { error: 'tool disabled' } };
  const input: Record<string, unknown> = args && typeof args === 'object' ? args : {};

  switch (name) {
    case 'search_docs': {
      const query = typeof input.query === 'string' ? input.query : '';
      const { hits, signals } = await searchWithSignals(context.db, query, {
        limit: boundedLimit(input.limit, 5),
        collection: typeof input.collection === 'string' ? input.collection : undefined,
        identified: context.identified,
        forAgent: true,
        model: context.model,
        embeddingModel: context.embeddingModel,
      });
      // The matching sections of each article, as the prompt's passages are,
      // on a smaller budget, because the result goes back to the model as JSON
      // cut at MAX_TOOL_RESULT_CHARS. Twenty results with long titles, or code
      // full of quotes to escape, can still pass that, and JSON cut short is
      // not JSON, so the budget halves until the result fits.
      let budget = SEARCH_TOOL_TOKEN_BUDGET;
      let passages = await loadPassages(context.db, query, hits, { budget });
      const size = () =>
        JSON.stringify(
          passages.map((h) => ({
            ref: 99,
            slug: h.slug,
            title: h.title,
            collection: h.collection,
            text: h.text,
          })),
        ).length;
      while (budget > 0 && size() > MAX_TOOL_RESULT_CHARS) {
        budget = Math.floor(budget / 2);
        passages = await loadPassages(context.db, query, hits, { budget });
      }
      // Finding an article is not using it: none of these is a citation until
      // the answer cites it by its ref.
      return {
        result: passages.map((h) => {
          const ref = context.cite?.({
            slug: h.slug,
            title: h.title,
            collection: h.collection,
            text: h.text,
            matchedBy: h.matchedBy,
            similarity: h.similarity,
          });
          return {
            ...(ref === undefined ? {} : { ref }),
            slug: h.slug,
            title: h.title,
            collection: h.collection,
            text: h.text,
          };
        }),
        effects: { retrieval: { signals, passages: hits.length } },
      };
    }

    case 'read_changelog': {
      const rows = await context.db
        .select({
          version: changelogEntries.version,
          title: changelogEntries.title,
          summary: changelogEntries.summary,
          publishedAt: changelogEntries.publishedAt,
        })
        .from(changelogEntries)
        .where(sql`status = 'published'`)
        .orderBy(sql`published_at DESC NULLS LAST`)
        .limit(boundedLimit(input.limit, 5));
      return { result: rows };
    }

    case 'look_up_user': {
      if (!context.contactId) return { result: { identified: false } };
      const [row] = await context.db
        .select({
          name: contacts.name,
          email: contacts.email,
          identified: contacts.identified,
          attributes: contacts.attributes,
          firstSeenAt: contacts.firstSeenAt,
        })
        .from(contacts)
        .where(sql`id = ${context.contactId}`);
      return { result: row ?? { identified: false } };
    }

    case 'collect_email': {
      if (context.identified) {
        // Defence in depth: the tool is not offered to identified visitors, but
        // if a model hallucinates the call it must not produce a form.
        return { result: { asked: false, reason: 'already identified' } };
      }
      // An address left earlier, on the widget's email card or the pre-chat
      // form, is the one the team follows up on. Asking again would put the
      // card back in front of someone who already filled it in.
      if (context.contactId) {
        const [row] = await context.db
          .select({ email: contacts.email })
          .from(contacts)
          .where(sql`id = ${context.contactId}`);
        if (row?.email) return { result: { asked: false, reason: 'email already on file' } };
      }
      // The reason is shown to the visitor on the email card, so it stays short.
      const reason =
        typeof input.reason === 'string' && input.reason.trim()
          ? input.reason.trim().slice(0, 200)
          : undefined;
      return { result: { asked: true }, effects: { askForEmail: { reason } } };
    }

    case 'mark_unresolved': {
      const question = typeof input.question === 'string' ? input.question : '';
      const reason = typeof input.reason === 'string' ? input.reason : undefined;
      return {
        result: { marked: true },
        effects: { unresolved: { question, reason } },
      };
    }

    case 'suggest_article': {
      // The slug is looked up as written. Searching for it instead meant an
      // invented slug cited whatever article was nearest, with a straight face.
      const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
      const match = slug ? await findArticle(context, slug) : null;
      if (!match) return { result: { error: 'no such article' } };
      return {
        result: { slug: match.slug, title: match.title },
        effects: {
          citations: [{ slug: match.slug, title: match.title, collection: match.collection }],
        },
      };
    }

    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

/** A limit the model asked for, or the fallback. Never unbounded, never negative. */
function boundedLimit(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0
    ? Math.min(raw, MAX_LIMIT)
    : fallback;
}

/** One published article by slug, subject to the same collection rules as search. */
async function findArticle(
  context: ToolContext,
  slug: string,
): Promise<{ slug: string; title: string; collection: string } | null> {
  const hidden = context.identified
    ? sql`c.ask_agent = false`
    : sql`c.ask_agent = false OR c.visibility = 'identified'`;
  const result = await context.db.execute<{ slug: string; title: string; collection: string }>(sql`
    SELECT a.slug, a.title, a.collection
    FROM helpwell.article_index a
    WHERE a.slug = ${slug} AND a.status = 'published'
      AND NOT EXISTS (
        SELECT 1 FROM helpwell.collection_index c WHERE c.id = a.collection AND (${hidden})
      )
    LIMIT 1
  `);
  return rowsOf<{ slug: string; title: string; collection: string }>(result)[0] ?? null;
}
