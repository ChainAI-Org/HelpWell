/**
 * Gap to draft: the writing model drafts the article a gap asks for, and the
 * draft opens in the article editor for a person to check and save.
 *
 * Drafting is WP1's `draftArticleFromGap`, which writes nothing: it reads
 * every way the question was asked, what the agent said, and the closest
 * articles, and leaves `[TODO: …]` wherever a fact is missing. Saving is the
 * editor's ordinary Save, through the host's `writeArticle` hook, so a draft
 * reaches the repo exactly as a hand-written article does. The gap is marked
 * drafted, with the article's slug, only once that save succeeds.
 */

import { isHelpWellError } from '@helpwell/core';
import { draftArticleFromGap } from '@helpwell/core/agent';
import { type Db, schema } from '@helpwell/core/db';
import type { Settings } from '@helpwell/core/settings';
import { html, join, type RawHtml } from '@helpwell/ui';
import { sql } from 'drizzle-orm';
import { editorResponse } from '../articles.js';
import { button, card, empty, formatDate, notice, relativeTime } from '../components.js';
import type { DashboardContext } from '../layout.js';
import { dashboardModel, type ModelConfig } from '../model.js';
import { htmlPage } from '../respond.js';
import type { DashboardConfig } from '../server.js';
import type { EditorState } from './knowledge.js';

/** The gap an editor is writing for, shown beside the draft. */
export interface GapContext {
  id: string;
  question: string;
  variants: string[];
  asks: number;
  firstAskedAt: Date;
  lastAskedAt: Date;
  suggestedTitle: string | null;
  suggestedCollection: string | null;
  /** Conversations where it came up, newest first, for reading the real wording. */
  conversations: string[];
}

export async function gapContext(db: Db, id: string): Promise<GapContext | null> {
  if (!id) return null;
  const [gap] = await db.select().from(schema.gaps).where(sql`id = ${id}`).limit(1);
  if (!gap) return null;
  const linked = await db
    .select({ id: schema.gapConversations.conversationId })
    .from(schema.gapConversations)
    .where(sql`gap_id = ${id}`)
    .orderBy(sql`created_at DESC`)
    .limit(5);
  return {
    id: gap.id,
    question: gap.question,
    variants: gap.variants,
    asks: gap.asks,
    firstAskedAt: gap.firstAskedAt,
    lastAskedAt: gap.lastAskedAt,
    suggestedTitle: gap.suggestedTitle,
    suggestedCollection: gap.suggestedCollection,
    conversations: linked.map((row) => row.id),
  };
}

export type DraftOutcome =
  | { kind: 'missing' }
  | {
      kind: 'drafted' | 'no-key' | 'failed';
      gap: GapContext;
      state: EditorState;
      /** Shown above the editor: who drafted it, or why it could not be drafted. */
      message: RawHtml;
    };

/**
 * Draft the article for gap `id`. Always ends in an editor: with the model's
 * draft, or, when there is no key or the model let us down, with the gap's
 * question as the title so the person can write it themselves.
 */
export async function draftForGap(
  db: Db,
  id: string,
  options: { config: ModelConfig; settings: Settings; docsDir: string },
): Promise<DraftOutcome> {
  const gap = await gapContext(db, id);
  if (!gap) return { kind: 'missing' };

  const blank: EditorState = {
    slug: null,
    path: null,
    title: gap.suggestedTitle ?? gap.question,
    description: '',
    collection: gap.suggestedCollection ?? '',
    status: 'draft',
    body: '',
  };

  const model = dashboardModel(options.config, options.settings, 'docs');
  if (!model) {
    return {
      kind: 'no-key',
      gap,
      state: blank,
      message: notice(
        'warn',
        'Drafting needs a model key, and none is set. Write it yourself below, or add OPENROUTER_API_KEY from the Get set up page and draft it again.',
      ),
    };
  }

  try {
    const draft = await draftArticleFromGap(db, id, {
      model,
      settings: options.settings,
      docsDir: options.docsDir,
    });
    const todos = (draft.body.match(/\[TODO:/g) ?? []).length;
    return {
      kind: 'drafted',
      gap,
      state: {
        slug: null,
        path: `${draft.slug}.md`,
        title: draft.title,
        description: draft.description,
        collection: draft.collection,
        status: 'draft',
        body: draft.body,
      },
      message: notice(
        'info',
        html`Drafted by <code>${draft.model}</code> from ${String(gap.asks)} ${
          gap.asks === 1 ? 'ask' : 'asks'
        } of this question. Nothing is saved yet. ${
          todos > 0
            ? html`Fill in the ${String(todos)} <code>[TODO: …]</code> ${todos === 1 ? 'placeholder' : 'placeholders'}: the model left them where a fact is not written down anywhere.`
            : 'Check every fact before you publish it.'
        }${draft.newCollection ? html` It goes in a new collection, <code>${draft.collection}</code>.` : null}`,
      ),
    };
  } catch (error) {
    if (!isHelpWellError(error)) throw error;
    return {
      kind: 'failed',
      gap,
      state: blank,
      message: notice(
        'bad',
        `${error.publicMessage} You can write it yourself below, or go back and draft it again.`,
      ),
    };
  }
}

/** POST `/gaps/:id/draft`: draft it, and open the draft in the article editor. */
export async function gapDraftPost(
  config: DashboardConfig,
  context: DashboardContext,
  id: string,
  settings: Settings,
): Promise<Response> {
  const outcome = await draftForGap(config.db, id, {
    config,
    settings,
    docsDir: config.docsDir ?? 'docs',
  });
  if (outcome.kind === 'missing') {
    return htmlPage(
      context,
      'gaps',
      { title: 'Gap' },
      empty(
        'alert',
        'That gap is not here',
        'It may have been drafted or dismissed already.',
        button('All gaps', { href: `${context.basePath}/gaps`, glyph: 'back' }),
      ),
      404,
    );
  }
  return editorResponse(
    config,
    context,
    outcome.kind === 'drafted' ? `Draft: ${outcome.state.title}` : 'New article',
    outcome.state,
    { gap: outcome.gap, intro: outcome.message },
  );
}

/** The card beside the editor: what customers actually asked. */
export function gapCard(context: DashboardContext, gap: GapContext): RawHtml {
  return card(
    'What customers asked',
    `${String(gap.asks)} ${gap.asks === 1 ? 'time' : 'times'}, first ${formatDate(gap.firstAskedAt, context)}, last ${relativeTime(gap.lastAskedAt, context)}.`,
    html`<p class="db-gap__question">${gap.question}</p>
    ${
      gap.variants.length > 0
        ? html`<p class="db-field__label" style="margin-top:12px">Also asked as</p>
      <ul class="db-gap__variants">${join(gap.variants.slice(0, 10).map((variant) => html`<li>${variant}</li>`))}</ul>`
        : null
    }
    ${
      gap.conversations.length > 0
        ? html`<p class="db-field__label" style="margin-top:12px">Where it came up</p>
      <ul class="db-gap__variants">${join(
        gap.conversations.map(
          (id, index) =>
            html`<li><a href="${context.basePath}/conversations/${encodeURIComponent(id)}">Conversation ${String(index + 1)}</a></li>`,
        ),
      )}</ul>`
        : null
    }
    <input type="hidden" name="gap" value="${gap.id}" form="db-editor">
    <p class="db-field__hint" style="margin-top:12px">Saving marks this gap drafted.</p>`,
  );
}
