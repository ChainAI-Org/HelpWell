/**
 * Proactive items: what a support extension asks HelpWell to show a visitor
 * without being asked, and the record of what the visitor did with them.
 *
 * HelpWell has no outbound sender and keeps none. A service that decides a
 * visitor should see a message (a teammate saying hello, the agent offering
 * help on the billing page, a pop-up a journey step chose) answers the
 * extension's `proactive` hook, and the widget pulls from it. Everything here
 * is the part HelpWell will not leave to the extension:
 *
 *   - what it returns is checked item by item, in the engagement block format,
 *     with the same link and media rules as engagements; an item that fails is
 *     dropped, never half-shown;
 *   - each item shown is recorded against the visitor's contact, so a
 *     dismissed message stays dismissed, each event reaches the extension
 *     once, and a reply can prove it answers a message this visitor was
 *     actually shown;
 *   - replying to a chat item starts a conversation that already holds the
 *     message it answers, so the AI knows what "yes please" is agreeing to;
 *   - an engagement item is claimed under the same global cap as Settings
 *     engagements (`claimProactiveEngagement`), and a tour it started resumes
 *     after a reload like one of theirs (`resumableProactiveTours`).
 */

import { sql } from 'drizzle-orm';
import { parsePageUrl } from '../agent/prompt.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { engageImpressions } from '../db/schema.js';
import { isSafeLink, isSafeMediaUrl, videoProvider } from '../engage/media.js';
import { fillPlaceholders, personalFields, placeholderKeys } from '../engage/personalize.js';
import { type Trigger, triggerSchema } from '../engage/rules.js';
import {
  type ChatBlock,
  chatBlockSchema,
  countsTowardsLimits,
  type Engagement,
  type EngageSettings,
  engagementSchema,
  MAX_TRIGGERS,
} from '../engage/schema.js';
import { idPrefix, newId } from '../ids.js';
import { PROACTIVE_IMPRESSION_PREFIX, publicEngagement, withinLimits } from '../repos/engage.js';
import { PROACTIVE_MODEL } from './remote-extension.js';
import type { ProactiveEvent } from './support-extension.js';

/** An item id: short, and safe in a URL path and a database key. */
export const PROACTIVE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The widget's browser id. */
export const ANONYMOUS_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** What a proactive engagement is called in the impressions table, apart from Settings' own. */
export const PROACTIVE_ENGAGEMENT_PREFIX = PROACTIVE_IMPRESSION_PREFIX;
/** The most items one page view shows. */
const MAX_ITEMS = 10;
/** How long a chat item can still be replied to after it was shown. */
const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanProactiveChat {
  kind: 'chat';
  id: string;
  sender: { name: string; avatarUrl: string | null; isAgent: boolean };
  blocks: ChatBlock[];
  replyable: boolean;
  /**
   * `bubble`: an incoming bubble by the launcher. `messenger`: the widget's
   * panel opens on a chat holding the message, as if it had just arrived.
   */
  display: 'bubble' | 'messenger';
  /** When it appears: whichever happens first. Page load, when the extension named none. */
  triggers: Trigger[];
}

export interface CleanProactiveEngagement {
  kind: 'engagement';
  id: string;
  /** The parsed definition, its id namespaced, ready for `publicEngagement`. */
  engagement: Engagement;
}

export type CleanProactiveItem = CleanProactiveChat | CleanProactiveEngagement;

/** What the widget is sent for one item. */
export function publicProactiveItem(item: CleanProactiveItem): Record<string, unknown> {
  if (item.kind === 'chat') return { ...item };
  return { kind: 'engagement', id: item.id, engagement: publicEngagement(item.engagement) };
}

export interface CleanOptions {
  /** Engagements switched on in Settings. Off, pop-ups and the rest are dropped; chat stays. */
  engage: boolean;
  /**
   * The install's own tours, by id. A chat button that starts a tour must
   * name one of them. Left out, any id is let through.
   */
  tours?: ReadonlySet<string>;
}

/**
 * The items an extension returned that can be shown safely, in its order.
 * `engage` false (engagements switched off in Settings) drops pop-ups and
 * the rest but keeps chat messages, which are not engagements.
 */
export function cleanProactiveItems(raw: unknown, options: CleanOptions): CleanProactiveItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CleanProactiveItem[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_ITEMS) break;
    const item = cleanItem(entry, options);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function cleanItem(entry: unknown, options: CleanOptions): CleanProactiveItem | null {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !PROACTIVE_ID.test(entry.id)) return null;
  const id = entry.id;

  if (entry.kind === 'chat') {
    const sender = isRecord(entry.sender) ? entry.sender : {};
    const name = typeof sender.name === 'string' ? sender.name.trim().slice(0, 60) : '';
    if (!name) return null;
    const replyable = entry.replyable === true;
    const blocks = cleanChatBlocks(entry.blocks, { replyable, tours: options.tours });
    if (blocks.length === 0) return null;
    const triggers = chatTriggers(entry);
    if (!triggers) return null;
    const avatar = typeof sender.avatarUrl === 'string' ? sender.avatarUrl.trim() : '';
    return {
      kind: 'chat',
      id,
      sender: {
        name,
        avatarUrl: avatar && isAvatarUrl(avatar) ? avatar.slice(0, 2000) : null,
        isAgent: sender.isAgent === true,
      },
      blocks,
      replyable,
      display: entry.display === 'messenger' ? 'messenger' : 'bubble',
      triggers,
    };
  }

  if (entry.kind === 'engagement' && options.engage && isRecord(entry.definition)) {
    const parsed = engagementSchema.safeParse({
      ...entry.definition,
      id: `${PROACTIVE_ENGAGEMENT_PREFIX}${id}`,
      enabled: true,
    });
    if (!parsed.success) return null;
    return { kind: 'engagement', id, engagement: parsed.data };
  }
  return null;
}

/** https, or a path on this site: an avatar is an image the widget loads. */
function isAvatarUrl(value: string): boolean {
  return /^https:\/\/[^/\s]+/i.test(value) || (isSafeLink(value) && value.startsWith('/'));
}

/**
 * When a chat item appears: its `triggers`, or the single `trigger` the
 * protocol first described. Null when it named some and none of them can
 * be armed, so it is dropped rather than shown at the wrong moment. `manual`
 * is dropped: the page has no id to show a chat message by.
 */
function chatTriggers(entry: Record<string, unknown>): Trigger[] | null {
  const raw = Array.isArray(entry.triggers)
    ? entry.triggers
    : entry.trigger !== undefined && entry.trigger !== null
      ? [entry.trigger]
      : [];
  if (raw.length === 0) return [{ type: 'load' }];
  const out: Trigger[] = [];
  for (const candidate of raw.slice(0, MAX_TRIGGERS)) {
    const parsed = triggerSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const trigger = parsed.data;
    if (trigger.type === 'manual') continue;
    if (trigger.type === 'click' && !trigger.selector) continue;
    if (trigger.type === 'event' && !trigger.name) continue;
    out.push(trigger);
  }
  return out.length > 0 ? out : null;
}

/**
 * A chat message's blocks, each checked on its own. Buttons in a chat bubble
 * can open a link, the chat, an article or one of the install's tours, send
 * a quick reply, or close the bubble; a slide's "next" means nothing there,
 * and a quick reply means nothing on a message that takes no reply.
 */
function cleanChatBlocks(
  raw: unknown,
  options: { replyable: boolean; tours?: ReadonlySet<string> },
): ChatBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatBlock[] = [];
  for (const entry of raw.slice(0, 20)) {
    const parsed = chatBlockSchema.safeParse(entry);
    if (!parsed.success) continue;
    const block = parsed.data;
    switch (block.type) {
      case 'text':
        if (block.markdown.trim()) out.push(block);
        break;
      case 'image':
        if (isSafeMediaUrl(block.url)) {
          out.push({ ...block, link: block.link && isSafeLink(block.link) ? block.link : '' });
        }
        break;
      case 'gif':
        if (isSafeMediaUrl(block.url)) out.push(block);
        break;
      case 'video':
        if (videoProvider(block.url)) out.push(block);
        break;
      case 'buttons': {
        const buttons = block.buttons.filter((button) => {
          if (!button.label) return false;
          switch (button.action) {
            case 'dismiss':
            case 'chat':
              return true;
            case 'article':
              return Boolean(button.value);
            case 'url':
              return isSafeLink(button.value);
            case 'tour':
              return Boolean(button.value) && (!options.tours || options.tours.has(button.value));
            case 'reply':
              return options.replyable;
            default:
              return false;
          }
        });
        if (buttons.length > 0) out.push({ ...block, buttons });
        break;
      }
      case 'divider':
        out.push(block);
        break;
    }
  }
  return out;
}

/**
 * A chat message as Markdown: how it is stored as the opening message of the
 * conversation a reply starts, and what the AI reads. Buttons are left out;
 * they were for the bubble.
 */
export function blocksToMarkdown(blocks: readonly ChatBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.markdown.trim());
    else if (block.type === 'image' || block.type === 'gif')
      parts.push(`![${block.alt.replace(/[[\]]/g, '')}](${block.url})`);
    else if (block.type === 'video')
      parts.push(`![${block.title.replace(/[[\]]/g, '')}](${block.url})`);
  }
  return parts.filter(Boolean).join('\n\n').slice(0, 10_000);
}

/* ------------------------------------------------------------- deliveries */

/** Remember what this contact was shown. An item shown again keeps its history. */
export async function recordDeliveries(
  db: Db,
  contactId: string,
  items: readonly CleanProactiveItem[],
  now: Date,
): Promise<void> {
  for (const item of items) {
    const payload = JSON.stringify(item);
    await db.execute(sql`
      INSERT INTO helpwell.proactive_deliveries (contact_id, item_id, kind, payload, delivered_at)
      VALUES (${contactId}, ${item.id}, ${item.kind}, ${payload}::jsonb, ${now.toISOString()}::timestamptz)
      ON CONFLICT (contact_id, item_id) DO UPDATE SET
        kind = EXCLUDED.kind,
        payload = EXCLUDED.payload
    `);
  }
}

/**
 * Of these items, the ones this contact is done with: a chat message they
 * dismissed, opened or replied to, one that already opened the messenger for
 * them, and an engagement they dismissed or were already shown. The extension
 * may keep offering them; they are not shown twice.
 */
export async function finishedItems(
  db: Db,
  contactId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = rowsOf<{ item_id: string }>(
    await db.execute(sql`
      SELECT item_id FROM helpwell.proactive_deliveries
      WHERE contact_id = ${contactId} AND item_id IN (${list})
        AND (dismissed_at IS NOT NULL
          OR replied_at IS NOT NULL
          OR (kind = 'chat' AND clicked_at IS NOT NULL)
          OR (kind = 'chat' AND seen_at IS NOT NULL AND payload->>'display' = 'messenger')
          OR (kind = 'engagement' AND seen_at IS NOT NULL))
    `),
  );
  return new Set(rows.map((row) => row.item_id));
}

export interface DeliveryRow {
  kind: 'chat' | 'engagement';
  payload: Record<string, unknown>;
  deliveredAt: Date;
  seenAt: Date | null;
  dismissedAt: Date | null;
  repliedAt: Date | null;
}

export async function getDelivery(
  db: Db,
  contactId: string,
  itemId: string,
): Promise<DeliveryRow | null> {
  const [row] = rowsOf<{
    kind: 'chat' | 'engagement';
    payload: unknown;
    delivered_at: string | Date;
    seen_at: string | Date | null;
    dismissed_at: string | Date | null;
    replied_at: string | Date | null;
  }>(
    await db.execute(sql`
      SELECT kind, payload, delivered_at, seen_at, dismissed_at, replied_at
      FROM helpwell.proactive_deliveries
      WHERE contact_id = ${contactId} AND item_id = ${itemId}
    `),
  );
  if (!row) return null;
  return {
    kind: row.kind,
    payload: asRecord(row.payload),
    deliveredAt: new Date(row.delivered_at),
    seenAt: row.seen_at ? new Date(row.seen_at) : null,
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at) : null,
    repliedAt: row.replied_at ? new Date(row.replied_at) : null,
  };
}

const EVENT_COLUMN = {
  seen: sql.raw('seen_at'),
  clicked: sql.raw('clicked_at'),
  dismissed: sql.raw('dismissed_at'),
} as const;

/**
 * Record what the visitor did. `first` is true only the first time this
 * event happens to this item, which is when the extension hears about it.
 */
export async function markDelivery(
  db: Db,
  contactId: string,
  itemId: string,
  event: ProactiveEvent,
  now: Date,
): Promise<{ found: boolean; first: boolean }> {
  const column = EVENT_COLUMN[event];
  const updated = rowsOf<{ item_id: string }>(
    await db.execute(sql`
      UPDATE helpwell.proactive_deliveries
      SET ${column} = ${now.toISOString()}::timestamptz
      WHERE contact_id = ${contactId} AND item_id = ${itemId} AND ${column} IS NULL
      RETURNING item_id
    `),
  );
  if (updated.length > 0) return { found: true, first: true };
  const exists = await getDelivery(db, contactId, itemId);
  return { found: exists !== null, first: false };
}

/* -------------------------------------------------------------- replying */

export interface ProactiveStart {
  conversationId: string;
  /**
   * For the AI, when a teammate wrote the message: what the visitor is
   * replying to. An agent's message is in the conversation itself instead.
   */
  context?: string;
}

/**
 * The visitor replied to a chat item: start its conversation, holding the
 * message they are answering. Null, and nothing written, unless this contact
 * was shown that item, it takes replies, it is recent, and it has not been
 * replied to already; the caller then treats the message as an ordinary
 * first message.
 */
export async function startProactiveConversation(
  db: Db,
  input: {
    contactId: string;
    itemId: string;
    pageUrl?: string | null;
    appUrl?: string;
    now: Date;
  },
): Promise<ProactiveStart | null> {
  if (!PROACTIVE_ID.test(input.itemId)) return null;
  const delivery = await getDelivery(db, input.contactId, input.itemId);
  if (delivery?.kind !== 'chat' || delivery.repliedAt) return null;
  if (input.now.getTime() - delivery.deliveredAt.getTime() > REPLY_WINDOW_MS) return null;
  const item = delivery.payload as unknown as Partial<CleanProactiveChat>;
  if (item.replyable !== true || !Array.isArray(item.blocks) || !item.sender) return null;

  // Claimed first, so two tabs replying at once start one conversation.
  const claimed = rowsOf<{ item_id: string }>(
    await db.execute(sql`
      UPDATE helpwell.proactive_deliveries
      SET replied_at = ${input.now.toISOString()}::timestamptz
      WHERE contact_id = ${input.contactId} AND item_id = ${input.itemId} AND replied_at IS NULL
      RETURNING item_id
    `),
  );
  if (claimed.length === 0) return null;

  // Stored, and read by the AI, as the visitor saw it: their own name in it.
  const blocks = item.blocks as ChatBlock[];
  const fields = await personalFields(db, input.contactId, placeholderKeys(blocks));
  const text = fillPlaceholders(blocksToMarkdown(blocks), fields);
  const conversationId = newId(idPrefix.conversation, input.now.getTime());
  // Shown before the reply was typed, so it sorts first even when the clocks agree.
  const shownAt = new Date(
    Math.min((delivery.seenAt ?? delivery.deliveredAt).getTime(), input.now.getTime() - 1),
  );
  const agentWrote = item.sender.isAgent === true && Boolean(text);

  await db.execute(sql`
    INSERT INTO helpwell.conversations (id, contact_id, page_url, started_at, last_message_at, message_count)
    VALUES (${conversationId}, ${input.contactId}, ${parsePageUrl(input.pageUrl, input.appUrl)},
            ${shownAt.toISOString()}::timestamptz, ${shownAt.toISOString()}::timestamptz,
            ${agentWrote ? 1 : 0})
  `);
  if (agentWrote) {
    await db.execute(sql`
      INSERT INTO helpwell.messages (id, conversation_id, role, body, model, created_at)
      VALUES (${newId(idPrefix.message, shownAt.getTime())}, ${conversationId}, 'agent', ${text},
              ${PROACTIVE_MODEL}, ${shownAt.toISOString()}::timestamptz)
    `);
  }
  await db.execute(sql`
    UPDATE helpwell.proactive_deliveries
    SET conversation_id = ${conversationId}
    WHERE contact_id = ${input.contactId} AND item_id = ${input.itemId}
  `);

  return {
    conversationId,
    ...(agentWrote || !text
      ? {}
      : {
          context: `The visitor is replying to this message from ${String(item.sender.name).slice(0, 60)} on the team, shown to them before this conversation began:\n\n${text.slice(0, 2000)}`,
        }),
  };
}

/* ------------------------------------------------------------ engagements */

export type ProactiveClaim =
  | { shown: true; first: boolean }
  | { shown: false; reason: 'unavailable' | 'frequency' | 'limit' };

/**
 * May this engagement item go on screen now? The same rules as a Settings
 * engagement: once, and under the global cap, which counts both kinds. A
 * later step of a tour resuming is not a new interruption, so it skips both.
 * Recorded as a `proactive:<id>` impression and as seen, in one transaction,
 * behind the same per-contact lock `claimEngagement` takes. `first` says the
 * extension has not heard it was seen yet. Null when this contact was never
 * sent that engagement.
 */
export async function claimProactiveEngagement(
  db: Db,
  engage: Pick<EngageSettings, 'enabled' | 'engagements' | 'limits'>,
  input: {
    contactId: string;
    itemId: string;
    step?: number;
    sessionId?: string | null;
    url?: string | null;
    now: Date;
  },
): Promise<ProactiveClaim | null> {
  const { contactId, itemId, now } = input;
  const delivery = await getDelivery(db, contactId, itemId);
  if (delivery?.kind !== 'engagement') return null;
  const kind = (delivery.payload as { engagement?: Engagement }).engagement?.kind;
  if (!kind) return null;
  if (!engage.enabled) return { shown: false, reason: 'unavailable' };
  if (delivery.dismissedAt) return { shown: false, reason: 'frequency' };
  const step = input.step !== undefined && input.step > 1 ? input.step : 1;

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${contactId}))`);
    if (step === 1) {
      // Read again under the lock: a second tab may have just shown it.
      if ((await getDelivery(txDb, contactId, itemId))?.seenAt) {
        return { shown: false, reason: 'frequency' } as const;
      }
      if (countsTowardsLimits(kind)) {
        const within = await withinLimits(txDb, engage.limits, {
          contactId,
          sessionId: input.sessionId ?? null,
          engagementIds: engage.engagements
            .filter((e) => countsTowardsLimits(e.kind))
            .map((e) => e.id),
          now,
        });
        if (!within) return { shown: false, reason: 'limit' } as const;
      }
    }
    await tx.insert(engageImpressions).values({
      id: newId(idPrefix.impression),
      engagementId: `${PROACTIVE_ENGAGEMENT_PREFIX}${itemId}`,
      contactId,
      state: 'seen',
      step: kind === 'tour' ? step : null,
      url: input.url?.slice(0, 2000) ?? null,
      sessionId: input.sessionId?.slice(0, 80) ?? null,
      createdAt: now,
    });
    const marked = await markDelivery(txDb, contactId, itemId, 'seen', now);
    return { shown: true, first: marked.first } as const;
  });
}

/**
 * The extension's tours this browser has in progress (`proactive:<id>`, from
 * `GET /engage?resume=`), to pick up after a reload as a Settings tour does:
 * sent to this contact, started, and neither finished nor closed.
 */
export async function resumableProactiveTours(
  db: Db,
  contactId: string | null,
  ids: readonly string[],
): Promise<Engagement[]> {
  const items = ids
    .filter((id) => id.startsWith(PROACTIVE_ENGAGEMENT_PREFIX))
    .map((id) => id.slice(PROACTIVE_ENGAGEMENT_PREFIX.length))
    .filter((id) => PROACTIVE_ID.test(id));
  if (!contactId || items.length === 0) return [];
  const list = sql.join(
    items.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = rowsOf<{ payload: unknown }>(
    await db.execute(sql`
      SELECT d.payload FROM helpwell.proactive_deliveries d
      WHERE d.contact_id = ${contactId}
        AND d.item_id IN (${list})
        AND d.kind = 'engagement'
        AND d.seen_at IS NOT NULL
        AND d.dismissed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM helpwell.engage_impressions i
          WHERE i.contact_id = d.contact_id
            AND i.engagement_id = ${PROACTIVE_ENGAGEMENT_PREFIX}::text || d.item_id
            AND i.state IN ('completed', 'dismissed'))
    `),
  );
  const out: Engagement[] = [];
  for (const row of rows) {
    const parsed = engagementSchema.safeParse(asRecord(row.payload).engagement);
    if (parsed.success && parsed.data.kind === 'tour') out.push(parsed.data);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}
