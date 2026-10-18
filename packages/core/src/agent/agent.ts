/**
 * The support agent.
 *
 * One method matters: `reply()`. It takes what a customer typed and returns
 * what Fern says, having written both to the database. The order of operations
 * is deliberate:
 *
 *   guards -> load history -> persist the question -> spend check -> ground in
 *   search -> model -> tools -> read citations and certainty -> score
 *   confidence -> persist the answer -> record spend -> update the
 *   conversation -> webhooks
 *
 * History is read before the question is written, so the question reaches the
 * model exactly once, as the last user message. The spend check comes before
 * grounding because a query embedding is a paid call too. Grounding happens
 * before the first model call rather than waiting for the model to ask for a
 * search, which saves a round trip and means every answer has passages
 * available even if the model decides not to use a tool.
 *
 * Finding a passage is not citing it. The passages are numbered in the prompt
 * and the answer cites the ones it used by number (agent/grounding.ts); those,
 * plus any article the model attached with suggest_article, are the
 * citations. Every answer then gets a confidence score from how well search
 * matched, whether the answer cited what it used, and what the model said
 * about its own answer (agent/confidence.ts). A score under the threshold, a
 * model that says the docs do not cover it, or a mark_unresolved call leaves
 * the conversation unresolved and records a gap.
 *
 * When the model fails twice, the answer degrades to the best search result
 * rather than an error (WG-21): a customer should always get something useful.
 * That answer scores 0 and is always unresolved.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { Citation, MessageSource, ToolCall } from '../db/schema.js';
import { contacts, conversations, messages } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';
import { hashIp } from '../ip-hash.js';
import {
  type RetrievalSignals,
  recordSearch,
  type SearchHit,
  searchWithSignals,
} from '../search/search.js';
import type { Settings } from '../settings/schema.js';
import { emitWebhooks, type WebhookOptions } from '../webhooks.js';
import {
  CONFIDENCE_THRESHOLD,
  type Confidence,
  type Grounding,
  retrievalStrength,
  scoreConfidence,
} from './confidence.js';
import { recordGap } from './gaps.js';
import {
  type Certainty,
  type CertaintyReport,
  type CitablePassage,
  inferCitation,
  parseAnswer,
} from './grounding.js';
import {
  type AbuseCheck,
  checkAbuse,
  rateLimit,
  recordBlocked,
  recordSpend,
  spendStatus,
} from './guards.js';
import type { ChatResponse, ModelMessage, ModelPort, Usage } from './model.js';
import type { AgentModels } from './model-factory.js';
import { loadPassages } from './passages.js';
import { buildSystemPrompt, parsePageUrl } from './prompt.js';
import { isSmallTalk } from './small-talk.js';
import {
  MAX_TOOL_RESULT_CHARS,
  runTool,
  type ToolContext,
  type ToolOutcome,
  toolsFor,
} from './tools.js';

export interface AgentDeps {
  db: Db;
  settings: Settings;
  model: ModelPort;
  /**
   * Separate ports for the fallback retry and for query embeddings, when a
   * host's `modelFactory` supplies them. Left out, `model` does all three.
   */
  models?: AgentModels;
  /** instructions.md from the repo, if present. */
  instructions?: string;
  /** playbook.md from the repo, if present. */
  playbook?: string;
  /** An open incident from the status page (WG-11). */
  incident?: { title: string; detail?: string } | null;
  now?: () => Date;
  /** How the webhooks a reply raises are sent: the install's fetch. Left out, the built-in guard. */
  webhooks?: WebhookOptions;
}

export interface ReplyInput {
  message: string;
  conversationId?: string | null;
  contactId?: string | null;
  /**
   * What the hourly message limit counts against. The API passes the visitor
   * cookie's contact id when one was presented and `ip:<keyed hash>` otherwise, so
   * clearing cookies does not hand out a fresh allowance. Without it the
   * contact id is used, then the IP.
   */
  visitorKey?: string | null;
  pageUrl?: string | null;
  ip?: string | null;
  honeypot?: string | null;
  /**
   * The widget's id for this one send, the same on a retry of it, so a
   * support extension can tell a resent message from a new one. The agent
   * itself does not use it.
   */
  requestId?: string | null;
  /**
   * The proactive chat message this starts a conversation in reply to. Only
   * ever set when HelpWell showed that message to this visitor. For a
   * support extension; the agent itself does not use it.
   */
  proactiveId?: string | null;
}

export interface AgentReply {
  /** A human is handling this thread. No AI answer was generated. */
  pendingHuman?: boolean;
  conversationId: string;
  messageId: string;
  text: string;
  /** The articles the answer used: the passages it cited, and any it attached. */
  citations: Citation[];
  /** Set when the agent needs an email from an unidentified visitor. */
  askForEmail?: { reason?: string };
  /** True when the docs did not cover it and a gap was logged. */
  unresolved: boolean;
  /** True when the answer came from search because the model was unavailable. */
  degraded: boolean;
  /**
   * Set when the message was small talk (a greeting, a thanks, an "ok"), not
   * a question (small-talk.ts). The widget offers the support email under
   * the latest answer to a real question that was left unresolved, and
   * skips these to find it.
   */
  smallTalk?: true;
  /**
   * 0-1: how sure HelpWell is that the answer is right and grounded
   * (agent/confidence.ts). Set on every answer the agent writes; absent only
   * on a reply a support extension produced instead. Internal: the public
   * chat route does not send it to the visitor.
   */
  confidence?: number;
  /** Why the score is what it is, in a sentence or two. */
  confidenceReason?: string;
  /** What the model said about its own answer, or null when it did not say. */
  certainty?: Certainty | null;
  usage: Usage;
}

const MAX_TOOL_ROUNDS = 3;
/** How many prior messages the model sees. The newest ones. */
const HISTORY_LIMIT = 20;
const NO_USAGE: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

type ConversationStatus = 'resolved' | 'unresolved';

export class Agent {
  constructor(private readonly deps: AgentDeps) {}

  /** The model this agent answers with, for callers that grade or draft on the same key. */
  get model(): ModelPort {
    return this.deps.model;
  }

  /** The port for query embeddings, or undefined for text search only. */
  #embedder(): ModelPort | undefined {
    const own = this.deps.models?.embeddings;
    return own === undefined ? this.deps.model : (own ?? undefined);
  }

  async reply(input: ReplyInput): Promise<AgentReply> {
    // Wall-clock, not `now()`: this is how long the customer waited, and a
    // test that pins the date still gets a real duration.
    const startedAt = Date.now();
    const { db, settings } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    // A NUL byte is nothing a person types on purpose, and Postgres refuses
    // it in text and jsonb alike. Dropped from everything that is stored, so
    // neither a visitor nor a model can make the answer fail as it is saved.
    const question = withoutNul(input.message).trim();
    if (!question) throw new HelpWellError('bad_request', 'Empty message');

    const contact = input.contactId ? await this.#loadContact(input.contactId) : null;
    const identified = Boolean(contact?.identified);
    const contactId = input.contactId ?? null;

    await this.#guard(input, question, identified, contact?.email ?? null);

    const pageUrl = parsePageUrl(input.pageUrl, settings.product.appUrl);
    const conversationId = await this.#ensureConversation(input, pageUrl, now);

    // History first, then the question: otherwise the question is both the
    // newest row of the transcript and the message appended after it.
    const history = await this.#history(conversationId);
    const followUp = history.length > 0;
    // A greeting or a thank-you is not a question the docs failed to answer,
    // even as the first message (small-talk.ts).
    const smallTalk = isSmallTalk(question);
    await this.#persistCustomerMessage(conversationId, question, now);

    // The cap is checked before grounding so a capped install pays for
    // nothing per message, not even the query embedding.
    const budget = await spendStatus(db, settings.agent.spend, now);
    const embeddingModel = settings.agent.models.embeddings;
    const search = await searchWithSignals(db, question, {
      limit: 5,
      identified,
      forAgent: true,
      model: budget.allowed && embeddingModel ? this.#embedder() : undefined,
      embeddingModel,
    });
    const passages = search.hits;
    // Recorded even when nothing matched: that is what turns "nothing
    // matched" into a gap even if the model never calls a tool.
    await recordSearch(db, {
      query: question,
      resultsCount: passages.length,
      source: 'widget',
      contactId,
    });

    if (!budget.allowed) {
      return this.#degradedReply({
        conversationId,
        passages,
        now,
        startedAt,
        reason: 'spend_cap',
        question,
        contactId,
      });
    }

    // What the model reads of each article: the sections the question is
    // about, whole, within a token budget (passages.ts), rather than the
    // snippet, which is thirty words cut wherever the count ran out.
    const read = await loadPassages(db, question, passages);

    const system = buildSystemPrompt({
      agent: settings.agent,
      productName: settings.product.name,
      appUrl: settings.product.appUrl,
      instructions: this.deps.instructions,
      playbook: this.deps.playbook,
      contact: contact
        ? {
            name: contact.name,
            email: contact.email,
            identified: contact.identified,
            attributes: contact.attributes,
          }
        : null,
      pageUrl,
      passages: read,
      followUp,
      smallTalk,
      incident: this.deps.incident,
      now,
    });

    const conversation: ModelMessage[] = [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: question },
    ];

    // The prompt numbers its passages 1..n; a search the model runs itself
    // continues the numbering, and an article already listed keeps its number.
    const citable: CitablePassage[] = read.map((passage, index) => ({
      ref: index + 1,
      slug: passage.slug,
      title: passage.title,
      collection: passage.collection,
      text: passage.text,
    }));
    // How search found each passage, kept for the conversation review only.
    const found = new Map<string, Pick<MessageSource, 'matchedBy' | 'similarity'>>(
      passages.map((hit) => [hit.slug, retrievalOf(hit)]),
    );
    const cite: ToolContext['cite'] = (passage) => {
      if (!found.has(passage.slug)) found.set(passage.slug, retrievalOf(passage));
      const known = citable.find((p) => p.slug === passage.slug);
      if (known) return known.ref;
      const ref = citable.length + 1;
      citable.push({
        ref,
        slug: passage.slug,
        title: passage.title,
        collection: passage.collection,
        text: passage.text,
      });
      return ref;
    };

    const toolContext: ToolContext = {
      db,
      conversationId,
      contactId,
      identified,
      tools: settings.agent.tools,
      model: this.#embedder(),
      embeddingModel,
      cite,
    };

    // The strongest search this turn, whichever of the two ran it.
    let retrieval = { signals: search.signals, passages: passages.length };
    const attached = new Map<string, Citation>();
    const toolCalls: ToolCall[] = [];
    let askForEmail: { reason?: string } | undefined;
    let unresolvedFrom: { question: string; reason?: string } | undefined;
    const usage: Usage = { ...NO_USAGE };

    let response: ChatResponse;
    let degraded = false;
    try {
      response = await this.#chatWithFallback(conversation, identified, usage);
    } catch {
      return this.#degradedReply({
        conversationId,
        passages,
        now,
        startedAt,
        reason: 'model_down',
        question,
        contactId,
      });
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS && response.wantsTools; round++) {
      conversation.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        const startedTool = Date.now();
        let outcome: ToolOutcome;
        try {
          outcome = await runTool(call.name, call.arguments, toolContext);
        } catch (error) {
          // The model call has already been paid for. A tool that throws
          // becomes an error result the model can read, and the turn goes on.
          outcome = { result: { error: errorMessage(error) } };
        }
        toolCalls.push({
          name: call.name,
          arguments: withoutNul(call.arguments),
          result: withoutNul(outcome.result),
          ms: Date.now() - startedTool,
        });
        for (const citation of outcome.effects?.citations ?? []) {
          attached.set(citation.slug, citation);
        }
        if (outcome.effects?.askForEmail) askForEmail = outcome.effects.askForEmail;
        if (outcome.effects?.unresolved) unresolvedFrom = withoutNul(outcome.effects.unresolved);
        const found = outcome.effects?.retrieval;
        if (
          found &&
          retrievalStrength(found.signals, found.passages) >
            retrievalStrength(retrieval.signals, retrieval.passages)
        ) {
          retrieval = found;
        }

        conversation.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(outcome.result).slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }

      try {
        response = await this.#chatWithFallback(conversation, identified, usage);
      } catch {
        degraded = true;
        response = {
          text: '',
          toolCalls: [],
          usage: { ...NO_USAGE },
          model: 'search-only',
          wantsTools: false,
        };
        break;
      }
    }

    const parsed = parseAnswer(
      withoutNul(response.text),
      new Set(citable.map((passage) => passage.ref)),
    );
    // A model that answers with nothing has not answered: the customer gets
    // the closest article, exactly as when the model is down.
    if (!parsed.text) degraded = true;
    const text = degraded ? fallbackText(passages) : parsed.text;
    const certainty = degraded ? null : parsed.certainty;

    const { citations, grounding } = degraded
      ? { citations: passages.slice(0, 1).map(toCitation), grounding: 'none' as const }
      : groundedCitations(parsed.cited, citable, attached, text, certainty?.level ?? null);

    // A follow-up search found nothing solid for ("thanks!", "and on mobile?"),
    // or small talk at any point ("hi"), is judged on what the model said
    // about it, not on retrieval: it neither flips a resolved conversation
    // nor becomes a gap called "thanks!", and the visitor is not offered the
    // support email for saying hello.
    const conversational =
      citations.length === 0 &&
      (smallTalk || (followUp && !solidMatch(retrieval.signals, retrieval.passages)));

    const confidence: Confidence = scoreConfidence({
      retrieval: retrieval.signals,
      passages: retrieval.passages,
      grounding,
      cited: citations.length,
      certainty,
      markedUnresolved: unresolvedFrom ? { reason: unresolvedFrom.reason } : null,
      degraded: degraded ? 'model_down' : null,
      conversational,
      smallTalk,
    });

    const unresolved =
      degraded ||
      Boolean(unresolvedFrom) ||
      certainty?.level === 'not_covered' ||
      (!conversational && confidence.score < CONFIDENCE_THRESHOLD);
    // A conversational turn leaves the status as the conversation's real
    // questions set it. When there have been none, only small talk, there is
    // nothing open: it is resolved, rather than left in the status every
    // conversation starts with, which would list "hi" under Unresolved.
    const status: ConversationStatus | null = unresolved
      ? 'unresolved'
      : !conversational
        ? 'resolved'
        : smallTalk && (await this.#onlySmallTalk(conversationId))
          ? 'resolved'
          : null;

    if (unresolved) {
      await recordGap(
        db,
        {
          question: unresolvedFrom?.question || question,
          conversationId,
          suggestedCollection: passages[0]?.collection ?? null,
        },
        settings,
        this.deps.webhooks,
      );
    }

    const messageId = await this.#persistAgentMessage({
      conversationId,
      text,
      citations,
      toolCalls,
      usage,
      model: response.model,
      now,
      latencyMs: Date.now() - startedAt,
      confidence,
      certainty,
      sources: sourcesFor(citable, found, citations, grounding === 'inferred'),
    });

    await recordSpend(db, { kind: 'chat', model: response.model, usage }, now);
    await this.#finishConversation({
      conversationId,
      status,
      usage,
      citations,
      now,
    });
    if (unresolved) {
      await this.#announceUnresolved({ conversationId, messageId, question, contactId });
    }

    return {
      conversationId,
      messageId,
      text,
      citations,
      askForEmail,
      unresolved,
      degraded,
      ...(smallTalk ? { smallTalk: true as const } : {}),
      confidence: confidence.score,
      confidenceReason: confidence.reason,
      certainty: certainty?.level ?? null,
      usage,
    };
  }

  /* ------------------------------------------------------------- internals */

  async #chatWithFallback(
    conversation: ModelMessage[],
    identified: boolean,
    usage: Usage,
  ): Promise<ChatResponse> {
    const { settings, model } = this.deps;
    const tools = toolsFor(settings.agent.tools, { identified });

    try {
      const response = await model.chat({
        model: settings.agent.models.chat,
        messages: conversation,
        tools,
      });
      accumulate(usage, response.usage);
      return response;
    } catch (primaryError) {
      const own = this.deps.models?.fallback;
      const fallback = own === undefined ? model : own;
      if (!settings.agent.models.fallback || !fallback) throw primaryError;
      // One retry on the fallback model, then we degrade. Two failures in a row
      // means the provider is down, not that this request was unlucky.
      const response = await fallback.chat({
        model: settings.agent.models.fallback,
        messages: conversation,
        tools,
      });
      accumulate(usage, response.usage);
      return response;
    }
  }

  async #guard(
    input: ReplyInput,
    question: string,
    identified: boolean,
    email: string | null,
  ): Promise<void> {
    const { db, settings } = this.deps;

    const recent = input.conversationId
      ? (
          await db
            .select({ body: messages.body })
            .from(messages)
            .where(sql`conversation_id = ${input.conversationId} AND role = 'customer'`)
            .orderBy(sql`created_at DESC`)
            .limit(2)
        ).map((r) => r.body)
      : [];

    const abuse: AbuseCheck = checkAbuse({
      settings: settings.agent.abuse,
      maxMessageLength: settings.agent.spend.maxMessageLength,
      message: question,
      identified,
      email,
      ip: input.ip,
      recentMessages: recent,
      honeypot: input.honeypot,
    });

    if (!abuse.allowed) {
      await recordBlocked(db, { reason: abuse.reason!, ip: input.ip, detail: abuse.reason });
      throw new HelpWellError('blocked', `Blocked: ${abuse.reason}`, {
        publicMessage: abuse.message ?? 'That did not go through.',
      });
    }

    // An address goes into the counter's name only as this install's keyed hash.
    const visitorKey =
      input.visitorKey ??
      input.contactId ??
      (input.ip ? `ip:${await hashIp(db, input.ip)}` : 'anonymous');
    const perHour = await rateLimit(
      db,
      `chat:${visitorKey}`,
      settings.agent.spend.messagesPerVisitorPerHour,
      3_600_000,
    );
    if (!perHour.allowed) {
      throw new HelpWellError('rate_limited', 'Too many messages this hour', {
        publicMessage: 'You have sent a lot of messages. Try again a little later.',
        details: { resetAt: perHour.resetAt.toISOString() },
      });
    }

    if (input.conversationId) {
      const [row] = await db
        .select({ count: conversations.messageCount })
        .from(conversations)
        .where(sql`id = ${input.conversationId}`);
      if ((row?.count ?? 0) >= settings.agent.spend.messagesPerConversation) {
        throw new HelpWellError('rate_limited', 'Conversation is too long', {
          publicMessage: 'This conversation has run long. Start a new one and we will pick it up.',
        });
      }
    }
  }

  async #loadContact(contactId: string) {
    const [row] = await this.deps.db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        identified: contacts.identified,
        attributes: contacts.attributes,
      })
      .from(contacts)
      .where(sql`id = ${contactId}`);
    return row ?? null;
  }

  async #ensureConversation(input: ReplyInput, pageUrl: string | null, now: Date): Promise<string> {
    if (input.conversationId) return input.conversationId;
    const id = newId(idPrefix.conversation, now.getTime());
    await this.deps.db.insert(conversations).values({
      id,
      contactId: input.contactId ?? null,
      pageUrl,
      startedAt: now,
      lastMessageAt: now,
    });
    return id;
  }

  /** Whether everything the visitor has said in this conversation is small talk. */
  async #onlySmallTalk(conversationId: string): Promise<boolean> {
    const said = await this.deps.db
      .select({ body: messages.body })
      .from(messages)
      .where(sql`conversation_id = ${conversationId} AND role = 'customer'`);
    return said.every((message) => isSmallTalk(message.body));
  }

  async #persistCustomerMessage(conversationId: string, body: string, now: Date): Promise<void> {
    await this.deps.db.insert(messages).values({
      id: newId(idPrefix.message, now.getTime()),
      conversationId,
      role: 'customer',
      body,
      createdAt: now,
    });
  }

  async #persistAgentMessage(params: {
    conversationId: string;
    text: string;
    citations: Citation[];
    toolCalls: ToolCall[];
    usage: Usage;
    model: string;
    now: Date;
    latencyMs: number;
    confidence: Confidence;
    certainty: CertaintyReport | null;
    sources: MessageSource[];
  }): Promise<string> {
    // One tick after the question, so the two ids sort in the order they were
    // said even though they share a timestamp.
    const id = newId(idPrefix.message, params.now.getTime() + 1);
    await this.deps.db.insert(messages).values({
      id,
      conversationId: params.conversationId,
      role: 'agent',
      body: params.text,
      citations: params.citations,
      toolCalls: params.toolCalls,
      model: params.model,
      tokensIn: params.usage.tokensIn,
      tokensOut: params.usage.tokensOut,
      costUsd: params.usage.costUsd.toFixed(6),
      latencyMs: Math.max(0, Math.round(params.latencyMs)),
      confidence: params.confidence.score,
      confidenceReason: withoutNul(params.confidence.reason),
      certainty: params.certainty?.level ?? null,
      sources: withoutNul(params.sources),
      createdAt: params.now,
    });
    return id;
  }

  /** `status: null` leaves the conversation's status as it was. */
  async #finishConversation(params: {
    conversationId: string;
    status: ConversationStatus | null;
    usage: Usage;
    citations: Citation[];
    now: Date;
  }): Promise<void> {
    // Topic comes from the collection the answer cited (AG-08). Deriving it
    // costs nothing, is right most of the time, and stays editable.
    const topic = params.citations[0]?.collection ?? null;

    await this.deps.db
      .update(conversations)
      .set({
        ...(params.status ? { status: params.status } : {}),
        lastMessageAt: params.now,
        messageCount: sql`${conversations.messageCount} + 2`,
        costUsd: sql`${conversations.costUsd} + ${params.usage.costUsd.toFixed(6)}`,
        ...(topic ? { topic: sql`COALESCE(${conversations.topic}, ${topic})` } : {}),
      })
      .where(sql`id = ${params.conversationId}`);
  }

  /** Tell the host app's other systems. Never throws; runs after the answer is saved. */
  async #announceUnresolved(params: {
    conversationId: string;
    messageId: string;
    question: string;
    contactId: string | null;
  }): Promise<void> {
    await emitWebhooks(
      this.deps.db,
      this.deps.settings,
      'conversation.unresolved',
      {
        conversationId: params.conversationId,
        messageId: params.messageId,
        question: params.question,
        contactId: params.contactId,
      },
      this.deps.webhooks,
    );
  }

  async #degradedReply(params: {
    conversationId: string;
    passages: SearchHit[];
    now: Date;
    startedAt: number;
    reason: 'spend_cap' | 'model_down';
    question: string;
    contactId: string | null;
  }): Promise<AgentReply> {
    const text = fallbackText(params.passages);
    const citations = params.passages.slice(0, 1).map(toCitation);
    const confidence = scoreConfidence({
      retrieval: EMPTY_SIGNALS,
      passages: params.passages.length,
      grounding: 'none',
      cited: citations.length,
      certainty: null,
      degraded: params.reason,
    });

    const messageId = await this.#persistAgentMessage({
      conversationId: params.conversationId,
      text,
      citations,
      toolCalls: [],
      usage: { ...NO_USAGE },
      model: params.reason === 'spend_cap' ? 'search-only (daily cap)' : 'search-only (model down)',
      now: params.now,
      latencyMs: Date.now() - params.startedAt,
      confidence,
      certainty: null,
      sources: params.passages.map((hit, index) => ({
        ref: index + 1,
        slug: hit.slug,
        title: hit.title,
        ...retrievalOf(hit),
        cited: index === 0,
      })),
    });

    await recordGap(
      this.deps.db,
      {
        question: params.question,
        conversationId: params.conversationId,
        suggestedCollection: params.passages[0]?.collection ?? null,
      },
      this.deps.settings,
      this.deps.webhooks,
    );

    await this.#finishConversation({
      conversationId: params.conversationId,
      status: 'unresolved',
      usage: { ...NO_USAGE },
      citations,
      now: params.now,
    });
    await this.#announceUnresolved({
      conversationId: params.conversationId,
      messageId,
      question: params.question,
      contactId: params.contactId,
    });

    return {
      conversationId: params.conversationId,
      messageId,
      text,
      citations,
      unresolved: true,
      degraded: true,
      ...(isSmallTalk(params.question) ? { smallTalk: true as const } : {}),
      confidence: confidence.score,
      confidenceReason: confidence.reason,
      certainty: null,
      usage: { ...NO_USAGE },
    };
  }

  /**
   * The newest messages, oldest first. Both messages of a turn share a
   * timestamp, so the id (minted one tick apart) breaks the tie.
   */
  async #history(conversationId: string): Promise<ModelMessage[]> {
    const rows = await this.deps.db
      .select({ role: messages.role, body: messages.body })
      .from(messages)
      .where(sql`conversation_id = ${conversationId} AND role IN ('customer', 'agent')`)
      .orderBy(sql`created_at DESC, id DESC`)
      .limit(HISTORY_LIMIT);

    return rows
      .reverse()
      .filter((row) => row.body.trim().length > 0)
      .map((row) => ({
        role: row.role === 'customer' ? ('user' as const) : ('assistant' as const),
        content: row.body,
      }));
  }
}

/** Signals for a reply no search judgement applies to: a degraded one scores 0 anyway. */
const EMPTY_SIGNALS: RetrievalSignals = {
  text: 'none',
  textCoverage: 0,
  semantic: false,
  bestSimilarity: null,
  minSimilarity: 0,
  agreement: false,
};

/**
 * The citations an answer earned, and how firmly.
 *
 * The passages it cited by number come first, in the order it used them, then
 * any article it attached with suggest_article. An answer that cited nothing
 * gets one inferred citation when it plainly follows a passage's wording, so a
 * model that forgets the markers still shows its source. Not when the model
 * says the docs do not cover the question: a refusal shares the question's
 * words with the passages without following any of them, and a source under
 * "I could not find that" tells the customer the opposite of the answer.
 */
function groundedCitations(
  cited: number[],
  citable: CitablePassage[],
  attached: Map<string, Citation>,
  text: string,
  certainty: Certainty | null,
): { citations: Citation[]; grounding: Grounding } {
  const citations = new Map<string, Citation>();
  for (const ref of cited) {
    const passage = citable.find((p) => p.ref === ref);
    if (passage) citations.set(passage.slug, toCitation(passage));
  }
  for (const [slug, citation] of attached) citations.set(slug, citation);
  if (citations.size > 0) return { citations: [...citations.values()], grounding: 'cited' };

  const inferred = certainty === 'not_covered' ? null : inferCitation(text, citable);
  if (inferred) return { citations: [toCitation(inferred)], grounding: 'inferred' };
  return { citations: [], grounding: citable.length > 0 ? 'uncited' : 'none' };
}

/** A match worth treating as a new question: every word, or close in meaning. */
function solidMatch(signals: RetrievalSignals, passages: number): boolean {
  if (passages === 0) return false;
  if (signals.text === 'strict') return true;
  return (
    signals.semantic &&
    signals.bestSimilarity !== null &&
    signals.bestSimilarity >= signals.minSimilarity
  );
}

function accumulate(total: Usage, add: Usage): void {
  total.tokensIn += add.tokensIn;
  total.tokensOut += add.tokensOut;
  total.costUsd += add.costUsd;
}

function toCitation(hit: { slug: string; title: string; collection: string }): Citation {
  return { slug: hit.slug, title: hit.title, collection: hit.collection };
}

/** How search found a passage, as the conversation review shows it. */
function retrievalOf(hit: {
  matchedBy?: ('text' | 'semantic')[];
  similarity?: number;
}): Pick<MessageSource, 'matchedBy' | 'similarity'> {
  return {
    matchedBy: [...(hit.matchedBy ?? [])],
    similarity:
      typeof hit.similarity === 'number' && Number.isFinite(hit.similarity)
        ? Math.round(hit.similarity * 1000) / 1000
        : null,
  };
}

/**
 * Every passage the reply was shown, in prompt order, each marked with
 * whether the answer used it. An article the model attached by slug without
 * search having shown it comes last, with ref 0.
 */
function sourcesFor(
  citable: CitablePassage[],
  found: Map<string, Pick<MessageSource, 'matchedBy' | 'similarity'>>,
  citations: Citation[],
  inferred: boolean,
): MessageSource[] {
  const cited = new Set(citations.map((c) => c.slug));
  const sources: MessageSource[] = citable.map((passage) => ({
    ref: passage.ref,
    slug: passage.slug,
    title: passage.title,
    ...(found.get(passage.slug) ?? { matchedBy: [], similarity: null }),
    cited: cited.has(passage.slug),
    ...(inferred && cited.has(passage.slug) ? { inferred: true } : {}),
  }));
  for (const citation of citations) {
    if (citable.some((passage) => passage.slug === citation.slug)) continue;
    sources.push({
      ref: 0,
      slug: citation.slug,
      title: citation.title,
      matchedBy: [],
      similarity: null,
      cited: true,
    });
  }
  return sources;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** The same value with NUL bytes removed from every string in it, keys included. */
function withoutNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\x00', '') as T;
  if (Array.isArray(value)) return value.map((item) => withoutNul(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        withoutNul(key),
        withoutNul(item),
      ]),
    ) as T;
  }
  return value;
}

/** What a customer sees when the model cannot answer. Never an error page. */
function fallbackText(passages: SearchHit[]): string {
  const best = passages[0];
  if (!best) {
    return "I couldn't find anything in the help center about that, so I don't want to guess. I've flagged it for the team.";
  }
  return `I can't write a proper answer right now, so here is the closest article: **${best.title}**. I've flagged this for the team as well.`;
}
