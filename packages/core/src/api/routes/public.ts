/**
 * Public routes: everything the widget and the help centre call.
 *
 * These are reachable by anyone who can load the page, so each one either
 * needs no identity at all, or is rate limited and scoped to the caller's own
 * contact record. Anything that writes to a conversation or a message checks
 * that the caller owns it first: an id is guessable enough that ownership,
 * not existence, is the test.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ReplyInput } from '../../agent/agent.js';
import { unresolvedScore } from '../../agent/confidence.js';
import { rateLimit } from '../../agent/guards.js';
import { isSmallTalk } from '../../agent/small-talk.js';
import { rowsOf } from '../../db/rows.js';
import { articleRatings, contacts } from '../../db/schema.js';
import { personalFields } from '../../engage/personalize.js';
import { HelpWellError } from '../../errors.js';
import { idPrefix, newId } from '../../ids.js';
import {
  getChangelogEntry,
  listChangelog,
  markAllChangelogRead,
  markChangelogRead,
  unreadCount,
} from '../../repos/changelog.js';
import { getCollection, listCollections, visibleArticles } from '../../repos/collections.js';
import { isIdentified } from '../../repos/contacts.js';
import {
  conversationOwner,
  getConversation,
  messageOwner,
  rateConversation,
  setMessageFeedback,
} from '../../repos/conversations.js';
import { noteWidgetSeen } from '../../repos/install-state.js';
import { getRoadmap, submitIdea, toggleVote } from '../../repos/roadmap.js';
import { recordSearch, searchArticles } from '../../search/search.js';
import { publicSupportEmail } from '../../settings/support-email.js';
import { webhookOptionsFor } from '../../webhook-guard.js';
import { announceChatTurn, emitWebhooks } from '../../webhooks.js';
import { applyNameOverride } from '../agent-overrides.js';
import { envOf, type RequestContext } from '../context.js';
import { publicBotCheck, requireHumanForConversation } from '../human-check.js';
import {
  cookieHeader,
  upsertIdentifiedContact,
  VISITOR_COOKIE,
  verifyIdentity,
} from '../identity.js';
import { startProactiveConversation } from '../proactive.js';
import {
  absoluteMarkdownMedia,
  absoluteOptionalUrl,
  absoluteWidgetSettings,
  publicBaseFor,
} from '../public-urls.js';
import { dateParam, intParam, json, noContent, oneOf, type Router, readJson } from '../router.js';
import { engageRoutes } from './engage.js';
import { formsPublicRoutes, hasTriggeredForms } from './forms-public.js';
import { proactiveRoutes } from './proactive.js';
import { widgetContactRoutes, widgetThreadState } from './widget-contact.js';
import { widgetLiveRoutes } from './widget-live.js';
import { supportCapabilities } from './widget-shared.js';
import { widgetStatusRoutes } from './widget-status.js';

const RATINGS = ['sad', 'indifferent', 'happy', 'love'] as const;
const FEEDBACK = ['helpful', 'not_helpful'] as const;

export function publicRoutes(router: Router<RequestContext>): Router<RequestContext> {
  // The widget's email card, live human state and attachments, and status.
  widgetContactRoutes(router);
  widgetLiveRoutes(router);
  widgetStatusRoutes(router);
  // Messages and engagements a support extension wants shown: routes/proactive.ts.
  proactiveRoutes(router);

  /* ------------------------------------------------------------- identity */

  router.post('/identify', async ({ context }) => {
    const body = await readJson<{ token?: string }>(context.request);
    if (!body.token) throw new HelpWellError('bad_request', 'identify needs a token');

    const secret =
      context.config.identitySecret ?? envOf(context.config).HELPWELL_IDENTITY_SECRET ?? '';
    const claims = await verifyIdentity(body.token, secret);
    const { contactId } = await upsertIdentifiedContact(context.db, claims, {
      visitorId: context.peekContactId(),
    });
    // What the widget greets them by, from what the host app told us: never
    // shown to anyone but the person the signed token is for.
    const { first_name: firstName } = await personalFields(context.db, contactId, ['first_name']);

    setVisitorCookie(context, contactId);
    return json({ contactId, identified: true, ...(firstName ? { firstName } : {}) });
  });

  /** An anonymous visitor id, so the widget can keep one thread across reloads. */
  router.post('/visitor', async ({ context }) => {
    const contactId = await context.contactId();
    setVisitorCookie(context, contactId);
    return json({ contactId, identified: false });
  });

  /**
   * Forget this browser. The host app calls it on sign-out, so the next
   * person at a shared computer does not open the widget onto someone else's
   * conversations.
   */
  router.post('/visitor/reset', async ({ context }) => {
    context.clearVisitor();
    return noContent();
  });

  router.post('/track', async ({ context }) => {
    const body = await readJson<{ name?: string; props?: Record<string, unknown>; url?: string }>(
      context.request,
    );
    if (!body.name) throw new HelpWellError('bad_request', 'An event needs a name');

    await enforce(context, `track:${context.visitorKey()}`, 120, 60);
    const contactId = await context.contactId();
    await context.db.execute(sql`
      INSERT INTO helpwell.events (id, contact_id, name, props, url)
      VALUES (${newId(idPrefix.event)}, ${contactId}, ${body.name.slice(0, 120)},
              ${JSON.stringify(body.props ?? {}).slice(0, 8000)}::jsonb, ${body.url?.slice(0, 2000) ?? null})
    `);
    setVisitorCookie(context, contactId);
    return noContent();
  });

  /* ----------------------------------------------------------------- chat */

  router.post('/chat', async ({ context }) => {
    const body = await readJson<{
      message?: string;
      conversationId?: string;
      pageUrl?: string;
      honeypot?: string;
      email?: string;
      name?: string;
      turnstileToken?: unknown;
      requestId?: unknown;
      proactiveId?: unknown;
    }>(context.request);

    if (!body.message?.trim()) {
      throw new HelpWellError('bad_request', 'Empty message', {
        publicMessage: 'Type a message first.',
      });
    }

    const contactId = await context.contactId();

    // Continuing a thread means proving it is yours. A stranger's message
    // must not land in someone else's conversation, nor read its history.
    if (body.conversationId) {
      await assertOwnsConversation(context, body.conversationId, contactId);
    }

    // The bot check, when it is on: a conversation's first message carries a
    // challenge token, and passing marks the conversation so the rest of it
    // goes straight through. Before anything is written.
    const passedBotCheck = await requireHumanForConversation(
      context,
      body.conversationId,
      body.turnstileToken,
    );

    // Pre-chat form (WG-07): attach the details before the agent runs so the
    // answer can use them and the conversation is not orphaned. Only an
    // unidentified record takes a typed email; a signed-in one has a real one.
    if (body.email || body.name) {
      await context.db
        .update(contacts)
        .set({
          email: body.email?.trim().toLowerCase().slice(0, 254) || undefined,
          name: body.name?.trim().slice(0, 120) || undefined,
          updatedAt: new Date(),
        })
        .where(sql`id = ${contactId} AND identified = false`);
    }

    // `visitorKey` is the rate-limit key: the presented cookie or the IP,
    // never the contact minted a moment ago for a first-time caller.
    const input: ReplyInput = {
      message: body.message,
      conversationId: body.conversationId ?? null,
      contactId,
      visitorKey: context.visitorKey(),
      pageUrl: body.pageUrl ?? null,
      ip: context.clientIp(),
      honeypot: body.honeypot ?? null,
      // The widget's id for this send, the same on a retry, so an extension
      // can tell a resent message from a new one.
      requestId: requestIdFrom(body.requestId),
    };
    const support = context.config.support;
    // Human-mode requests retain the public API's identity and rate-limit boundary.
    if (support) await enforce(context, `human-chat:${context.visitorKey()}`, 120, 3600);
    // A reply to a proactive chat message starts that message's conversation
    // (api/proactive.ts), but only for a message this visitor was shown.
    let proactiveContext: string | undefined;
    if (support?.proactive && !body.conversationId && typeof body.proactiveId === 'string') {
      const started = await startProactiveConversation(context.db, {
        contactId,
        itemId: body.proactiveId,
        pageUrl: body.pageUrl ?? null,
        appUrl: context.settings.product.appUrl,
        now: context.config.now?.() ?? new Date(),
      });
      if (started) {
        input.conversationId = started.conversationId;
        input.proactiveId = body.proactiveId;
        proactiveContext = started.context;
      }
    }
    const handled = support ? await support.handleMessage(input) : null;
    const extraPlaybook = handled
      ? undefined
      : [support?.playbook ? await support.playbook() : '', proactiveContext ?? '']
          .filter(Boolean)
          .join('\n\n') || undefined;
    // Tools a support extension switched off, and instructions it adds after
    // the install's own (api/agent-overrides.ts). Never more than Settings allow.
    const overrides = handled ? null : ((await support?.agentOverrides?.()) ?? null);
    const reply = handled ?? (await context.agent(extraPlaybook, overrides).reply(input));
    await passedBotCheck(reply.conversationId);
    if (support && !handled) await support.afterReply(reply.conversationId);
    await announceChatTurn(
      context.db,
      context.settings,
      {
        conversationId: reply.conversationId,
        opened: !body.conversationId,
        contactId,
        pageUrl: body.pageUrl ?? null,
        question: body.message,
        reply,
      },
      webhookOptionsFor(context.config),
    );

    setVisitorCookie(context, contactId);
    // Token counts and cost are the customer's business, not the visitor's,
    // and so is how sure the agent was: that is for the conversation review.
    const {
      usage: _usage,
      confidence: _confidence,
      confidenceReason: _confidenceReason,
      certainty: _certainty,
      ...visible
    } = reply;
    // An answer that shows a screenshot shows it on the customer's site too.
    return json({ ...visible, text: absoluteMarkdownMedia(visible.text, publicBaseFor(context)) });
  });

  router.post('/conversations/:id/handoff', async ({ params, context }) => {
    await readJson(context.request);
    if (!context.config.support)
      throw new HelpWellError('not_found', 'Human support is not enabled');
    const contactId = context.peekContactId();
    if (!contactId) throw notYours();
    await assertOwnsConversation(context, params.id!, contactId);
    await enforce(context, 'handoff', 20, 3600);
    await context.config.support.handoff(params.id!, contactId);
    return json({ ok: true });
  });

  /** The thread, for restoring an open conversation on reload. */
  router.get('/conversations/:id', async ({ params, context }) => {
    const contactId = context.peekContactId();
    const conversation = await getConversation(context.db, params.id!);
    if (!conversation) throw new HelpWellError('not_found', 'No such conversation');

    if (!contactId || conversation.contact.id !== contactId) throw notYours();

    // The email card, the bot check and attachments, for the widget.
    const widgetState = await widgetThreadState(context, conversation);
    // Images in answers load on the customer's site too: absolute URLs.
    const base = publicBaseFor(context);
    const supportThread = await context.config.support?.thread(conversation.id);
    if (supportThread) {
      const messages = Array.isArray(supportThread.messages)
        ? supportThread.messages.map((m) =>
            m.role === 'customer' || typeof m.body !== 'string'
              ? m
              : { ...m, body: absoluteMarkdownMedia(m.body, base) },
          )
        : supportThread.messages;
      return json({ ...supportThread, messages, ...widgetState });
    }

    // What each answer was an answer to, to tell small talk from a question.
    let asked = '';
    return json({
      id: conversation.id,
      status: conversation.status,
      messages: conversation.messages.map((m) => {
        if (m.role === 'customer') asked = m.body;
        const answer = m.role === 'agent';
        return {
          id: m.id,
          role: m.role,
          body: answer ? absoluteMarkdownMedia(m.body, base) : m.body,
          citations: m.citations,
          feedback: m.feedback,
          createdAt: m.createdAt,
          // Each answer's own verdict, as `/chat` gave it, so a reloaded
          // widget offers the support email under the latest answer to a
          // real question that was left open, and never over small talk,
          // whatever the conversation's own status. Only the flags: the
          // score stays in the conversation review.
          ...(answer && unresolvedScore(m.confidence) ? { unresolved: true } : {}),
          ...(answer && isSmallTalk(asked) ? { smallTalk: true } : {}),
        };
      }),
      ...widgetState,
    });
  });

  /** A read receipt is explicit: fetching a thread in a hidden widget does not count. */
  router.post('/conversations/:id/seen', async ({ params, context }) => {
    const support = context.config.support;
    if (!support?.markSeen) throw new HelpWellError('not_found', 'Human support is not enabled');
    const contactId = context.peekContactId();
    if (!contactId) throw notYours();
    await assertOwnsConversation(context, params.id!, contactId);
    const body = z
      .object({ messageIds: z.array(z.string().uuid()).min(1).max(100) })
      .strict()
      .parse(await readJson(context.request));
    await support.markSeen(params.id!, contactId, body.messageIds);
    return json({ ok: true });
  });

  /** My conversations, for the widget's Messages tab. */
  router.get('/conversations', async ({ context }) => {
    const contactId = context.peekContactId();
    if (!contactId) return json({ items: [] });

    const result = await context.db.execute(sql`
      SELECT c.id, c.status, c.topic, c.last_message_at,
        (SELECT m.body FROM helpwell.messages m
          WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS snippet
      FROM helpwell.conversations c
      WHERE c.contact_id = ${contactId} AND c.deleted_at IS NULL
      ORDER BY c.last_message_at DESC
      LIMIT 20
    `);

    return json({
      items: rowsOf<{
        id: string;
        status: string;
        topic: string | null;
        last_message_at: string | Date;
        snippet: string | null;
      }>(result).map((row) => ({
        id: row.id,
        status: row.status,
        topic: row.topic,
        lastMessageAt: row.last_message_at,
        snippet: row.snippet ?? '',
      })),
    });
  });

  router.post('/messages/:id/feedback', async ({ params, context }) => {
    const body = await readJson<{ feedback?: unknown; comment?: string }>(context.request);
    const feedback =
      body.feedback === null || body.feedback === undefined
        ? null
        : oneOf(body.feedback, FEEDBACK, 'feedback');

    const owner = await messageOwner(context.db, params.id!);
    if (!owner) throw new HelpWellError('not_found', 'No such message');
    const contactId = context.peekContactId();
    if (!contactId || owner.contactId !== contactId) throw notYours();

    await enforce(context, `feedback:${context.visitorKey()}`, 60, 3600);
    await setMessageFeedback(context.db, params.id!, feedback, body.comment);
    await context.config.support?.afterReply(owner.conversationId);
    if (feedback) {
      await emitWebhooks(
        context.db,
        context.settings,
        'feedback.created',
        {
          kind: 'message',
          messageId: params.id,
          conversationId: owner.conversationId,
          value: feedback,
          comment: body.comment?.slice(0, 2000) ?? null,
          contactId,
        },
        webhookOptionsFor(context.config),
      );
    }
    return noContent();
  });

  router.post('/conversations/:id/rating', async ({ params, context }) => {
    const body = await readJson<{ rating?: unknown; comment?: string }>(context.request);
    const rating = oneOf(body.rating, RATINGS, 'rating');

    const contactId = context.peekContactId();
    await assertOwnsConversation(context, params.id!, contactId);

    await enforce(context, `rating:${context.visitorKey()}`, 30, 3600);
    await rateConversation(context.db, params.id!, rating, body.comment);
    await emitWebhooks(
      context.db,
      context.settings,
      'feedback.created',
      {
        kind: 'conversation',
        conversationId: params.id,
        value: rating,
        comment: body.comment?.slice(0, 2000) ?? null,
        contactId,
      },
      webhookOptionsFor(context.config),
    );
    return noContent();
  });

  /* --------------------------------------------------------------- search */

  router.get('/search', async ({ query, context }) => {
    const q = query.get('q')?.trim().slice(0, 500) ?? '';
    if (!q) return json({ query: '', results: [] });

    await enforce(context, `search:${context.visitorKey()}`, 120, 60);
    const results = await searchArticles(context.db, q, {
      limit: intParam(query, 'limit', { default: 8, max: 20 }),
      // Collections reserved for signed-in customers stay out of an anonymous
      // visitor's results, so a title never confirms what the article says.
      identified: await isIdentified(context.db, context.peekContactId()),
    });
    await recordSearch(context.db, {
      query: q,
      resultsCount: results.length,
      source: query.get('source') === 'widget' ? 'widget' : 'help_center',
      contactId: context.peekContactId(),
    });
    return json({ query: q, results });
  });

  /* ------------------------------------------------------------- articles */

  router.get('/collections', async ({ context }) => {
    // `collection` is kept alongside `id` so an older widget build, cached in
    // someone's browser, does not lose its labels the day this deploys.
    const items = await listCollections(context.db, {
      contactId: context.peekContactId(),
    });
    return json({ items: items.map((item) => ({ ...item, collection: item.id })) });
  });

  router.get('/articles', async ({ query, context }) => {
    const collection = query.get('collection');
    const filter = collection
      ? sql`a.status = 'published' AND a.collection = ${collection}`
      : sql`a.status = 'published'`;
    const result = await context.db.execute<{
      slug: string;
      title: string;
      description: string | null;
      collection: string;
      reading_minutes: number;
      updated_at: string | Date;
    }>(sql`
      SELECT a.slug, a.title, a.description, a.collection, a.reading_minutes, a.updated_at
      FROM helpwell.article_index a
      WHERE ${filter}${visibleArticles({ contactId: context.peekContactId() })}
      ORDER BY a.order_index, a.title
    `);
    return json({ items: rowsOf(result) });
  });

  // "*slug" so "billing/exporting-invoices" arrives as one parameter.
  router.get('/articles/*slug', async ({ params, context }) => {
    // Resolved once: the article read and the related-articles search both
    // depend on whether this visitor may see reserved collections.
    const identified = await isIdentified(context.db, context.peekContactId());
    const result = await context.db.execute(sql`
      SELECT a.slug, a.title, a.description, a.collection, a.body, a.headings,
             a.reading_minutes, a.applies_to, a.updated_at, a.path
      FROM helpwell.article_index a
      WHERE a.slug = ${params.slug!} AND a.status = 'published'
        ${visibleArticles({ includeIdentified: identified })}
      LIMIT 1
    `);
    const found = rowsOf<{
      slug: string;
      title: string;
      description: string | null;
      collection: string;
      body: string;
      headings: unknown;
      reading_minutes: number;
      applies_to: string | null;
      updated_at: string | Date;
      path: string | null;
    }>(result)[0];

    if (!found) throw new HelpWellError('not_found', `No article ${params.slug}`);
    // The file's path is only for resolving its relative images; the
    // widget on another site gets every image as an absolute URL.
    const { path, ...article } = found;
    const row = {
      ...article,
      body: absoluteMarkdownMedia(article.body, publicBaseFor(context), path ?? undefined),
    };

    const [related, collection] = await Promise.all([
      searchArticles(context.db, `${row.title} ${row.description ?? ''}`, {
        limit: 4,
        identified,
      }),
      getCollection(context.db, row.collection, { includeIdentified: true }),
    ]);

    return json({
      // `collection_title` rides alongside the folder id so the widget can
      // show the collection's name without a second request for it.
      article: { ...row, collection_title: collection?.title ?? row.collection },
      related: related.filter((r) => r.slug !== row.slug).slice(0, 3),
    });
  });

  router.post('/articles/*slug/rating', async ({ params, context }) => {
    const body = await readJson<{ value?: string; comment?: string }>(context.request);
    if (body.value !== 'up' && body.value !== 'down') {
      throw new HelpWellError('bad_request', 'Rating must be up or down');
    }
    await enforce(context, `rate:${context.visitorKey()}`, 30, 3600);
    const contactId = await context.contactId();
    await context.db.insert(articleRatings).values({
      id: newId(idPrefix.rating),
      slug: params.slug!,
      contactId,
      value: body.value,
      comment: body.comment?.slice(0, 2000) ?? null,
    });
    await emitWebhooks(
      context.db,
      context.settings,
      'feedback.created',
      {
        kind: 'article',
        slug: params.slug,
        value: body.value,
        comment: body.comment?.slice(0, 2000) ?? null,
        contactId,
      },
      webhookOptionsFor(context.config),
    );
    setVisitorCookie(context, contactId);
    return noContent();
  });

  /* ------------------------------------------------------------ changelog */

  router.get('/changelog', async ({ query, context }) => {
    const cursor = dateParam(query, 'cursor');
    const page = await listChangelog(context.db, {
      limit: intParam(query, 'limit', { default: context.settings.changelog.pageSize, max: 50 }),
      cursor: cursor?.toISOString(),
      tag: query.get('tag') ?? undefined,
      contactId: context.peekContactId(),
    });
    const base = publicBaseFor(context);
    return json({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        coverUrl: absoluteOptionalUrl(item.coverUrl, base),
      })),
    });
  });

  router.get('/changelog/unread', async ({ context }) => {
    return json({ count: await unreadCount(context.db, context.peekContactId()) });
  });

  router.get('/changelog/:id', async ({ params, context }) => {
    const entry = await getChangelogEntry(context.db, params.id!);
    if (!entry) throw new HelpWellError('not_found', 'No such changelog entry');
    const base = publicBaseFor(context);
    return json({
      ...entry,
      body: absoluteMarkdownMedia(entry.body, base),
      coverUrl: absoluteOptionalUrl(entry.coverUrl, base),
    });
  });

  router.post('/changelog/:id/read', async ({ params, context }) => {
    const entry = await getChangelogEntry(context.db, params.id!);
    if (!entry) throw new HelpWellError('not_found', 'No such changelog entry');
    await enforce(context, `read:${context.visitorKey()}`, 120, 60);
    const contactId = await context.contactId();
    await markChangelogRead(context.db, params.id!, contactId);
    setVisitorCookie(context, contactId);
    return noContent();
  });

  router.post('/changelog/read-all', async ({ context }) => {
    await enforce(context, `read:${context.visitorKey()}`, 120, 60);
    const contactId = await context.contactId();
    const marked = await markAllChangelogRead(context.db, contactId);
    setVisitorCookie(context, contactId);
    return json({ marked });
  });

  /* -------------------------------------------------------------- roadmap */

  router.get('/roadmap', async ({ context }) => {
    if (!context.settings.changelog.roadmap.enabled) {
      throw new HelpWellError('not_found', 'Roadmap is switched off');
    }
    return json(await getRoadmap(context.db, { contactId: context.peekContactId() }));
  });

  router.post('/roadmap/:id/vote', async ({ params, context }) => {
    if (!context.settings.changelog.roadmap.enabled) {
      throw new HelpWellError('not_found', 'Roadmap is switched off');
    }
    await enforce(context, `vote:${context.visitorKey()}`, 60, 3600);
    const contactId = await context.contactId();
    const result = await toggleVote(context.db, params.id!, contactId);
    setVisitorCookie(context, contactId);
    return json(result);
  });

  router.post('/roadmap', async ({ context }) => {
    const roadmap = context.settings.changelog.roadmap;
    if (!roadmap.enabled) throw new HelpWellError('not_found', 'Roadmap is switched off');

    const body = await readJson<{ title?: string; body?: string }>(context.request);
    const title = body.title?.trim() ?? '';
    if (!title || title.length > 200) {
      throw new HelpWellError('bad_request', 'An idea needs a title of up to 200 characters', {
        publicMessage: 'Give the idea a short title.',
      });
    }

    const contactId = await context.contactId();
    const [row] = await context.db
      .select({ identified: contacts.identified })
      .from(contacts)
      .where(sql`id = ${contactId}`)
      .limit(1);

    if (roadmap.whoCanSubmit === 'identified' && !row?.identified) {
      throw new HelpWellError('forbidden', 'Anonymous submission while identified-only', {
        publicMessage: 'Sign in to suggest an idea.',
      });
    }

    await enforce(context, `idea:${context.visitorKey()}`, 5, 3600);
    const id = await submitIdea(context.db, {
      title,
      body: body.body?.slice(0, 4000),
      contactId,
    });
    await emitWebhooks(
      context.db,
      context.settings,
      'roadmap.idea',
      { id, title, body: body.body?.slice(0, 4000) ?? null, contactId },
      webhookOptionsFor(context.config),
    );
    setVisitorCookie(context, contactId);
    return json({ id }, { status: 201 });
  });

  /* --------------------------------------------------------------- engage */

  // Engagements, claims, impressions and survey answers: routes/engage.ts.
  engageRoutes(router);
  // Forms: drawing, submitting, giveaway bonuses, downloads: routes/forms-public.ts.
  formsPublicRoutes(router);

  /* --------------------------------------------------------------- config */

  /**
   * Everything the widget needs to render before it talks to anyone: tabs,
   * appearance, display rules, pre-chat copy. No secrets, so it is safe to
   * serve to any origin the customer allows.
   */
  router.get('/config', async ({ context }) => {
    // A support extension may rename the agent (api/agent-overrides.ts). The
    // wrapper caches its answer for a minute and never throws.
    const settings = applyNameOverride(
      context.settings,
      (await context.config.support?.agentOverrides?.()) ?? null,
    );
    // The setup checklist's "widget installed" step. Cheap, and never throws.
    await noteWidgetSeen(context.db, context.request, {
      helpCenterPath: settings.helpCenter.subpath,
    });
    // Images the widget draws (the avatar, the launcher, the Home tab's
    // cards) load from this API on the customer's site: absolute URLs.
    const base = publicBaseFor(context);
    return json({
      product: {
        name: settings.product.name,
        locale: settings.product.locale,
        // Where people can write when the agent cannot help, as a mailto
        // link. Left out when a support extension handles human replies:
        // its own flow is how people reach a person then.
        supportEmail: publicSupportEmail(settings, {
          humanSupport: Boolean(context.config.support),
        }),
      },
      // Who answers: drawn beside every reply and in the chat header. No
      // avatar means the HelpWell mark.
      agent: {
        name: settings.agent.name,
        avatarUrl: absoluteOptionalUrl(settings.agent.avatarUrl, base),
      },
      support: supportCapabilities(context.config.support),
      // Set only when a challenge can actually run: the site key, never the secret.
      botCheck: publicBotCheck(context),
      widget: absoluteWidgetSettings(settings.widget, base),
      helpCenter: {
        subpath: settings.helpCenter.subpath,
        domain: settings.helpCenter.domain,
        theme: settings.helpCenter.theme,
        search: settings.helpCenter.search,
        askAgent: settings.helpCenter.askAgent,
        ratings: settings.helpCenter.ratings,
        readingTime: settings.helpCenter.readingTime,
        poweredBy: settings.helpCenter.poweredBy,
      },
      changelog: {
        widgetTab: settings.changelog.widgetTab,
        notification: settings.changelog.notification,
        groupBy: settings.changelog.groupBy,
        roadmapEnabled: settings.changelog.roadmap.enabled,
        whoCanSubmit: settings.changelog.roadmap.whoCanSubmit,
      },
      unread: await unreadCount(context.db, context.peekContactId()),
      // Whether any live form pops up on a trigger, so a page with none never asks.
      forms: { triggered: await hasTriggeredForms(context.db) },
    });
  });

  return router;
}

/* ---------------------------------------------------------------- helpers */

/**
 * rateLimit() reports; this decides. Kept here rather than in the guard so the
 * agent can choose to degrade where the HTTP layer chooses to refuse.
 */
async function enforce(
  context: RequestContext,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await rateLimit(context.db, bucket, limit, windowSeconds * 1000);
  if (!result.allowed) {
    throw new HelpWellError('rate_limited', `Rate limit hit on ${bucket}`, {
      publicMessage: 'That is a bit too fast. Try again shortly.',
      details: { resetAt: result.resetAt.toISOString() },
    });
  }
}

/** 404 when the conversation does not exist, 403 when it is someone else's. */
async function assertOwnsConversation(
  context: RequestContext,
  conversationId: string,
  contactId: string | null,
): Promise<void> {
  const owner = await conversationOwner(context.db, conversationId);
  if (!owner) throw new HelpWellError('not_found', 'No such conversation');
  if (!contactId || owner.contactId !== contactId) throw notYours();
}

/** A client's id for one send: short and plain, or nothing. Never trusted for more than dedupe. */
function requestIdFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[A-Za-z0-9_.:-]{8,100}$/.test(id) ? id : null;
}

function notYours(): HelpWellError {
  return new HelpWellError('forbidden', 'Conversation belongs to another contact', {
    publicMessage: 'That conversation is not available.',
  });
}

function setVisitorCookie(context: RequestContext, contactId: string): void {
  // Replace rather than append: the context may already have queued an
  // expiry for a stale cookie, and the last Set-Cookie for a name wins.
  const kept = context.cookies.filter((c) => !c.startsWith(`${VISITOR_COOKIE}=`));
  context.cookies.length = 0;
  context.cookies.push(
    ...kept,
    cookieHeader(VISITOR_COOKIE, contactId, {
      secure: context.config.secureCookies ?? isHttps(context.request),
    }),
  );
}

function isHttps(request: Request): boolean {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}
