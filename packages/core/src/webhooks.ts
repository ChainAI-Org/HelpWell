/**
 * Webhooks: telling the host app's other systems what just happened.
 *
 * A webhook is a POST of one JSON event to a URL the customer configured,
 * signed with the secret they set, with the delivery recorded whether it
 * worked or not. The payload carries ids, so a consumer can fetch the current
 * state rather than trusting the event.
 *
 * Failed deliveries are retried with exponential backoff, up to five attempts,
 * without a worker: HelpWell runs inside somebody else's request handler and
 * cannot keep a queue running. A failure records the exact bytes it sent and
 * when to try again, and whatever runs next picks up what is due — the next
 * webhook emitted, `POST /admin/webhooks/retry`, or `helpwell webhooks retry`
 * on a cron.
 *
 * `emitWebhooks` never throws. A support tool's side channel must not be able
 * to break the answer the customer is waiting for.
 *
 * Every send, first try or retry or test, goes through one fetch: the
 * install's `webhookFetch`, or the built-in guard that refuses private and
 * non-https addresses when it connects (webhook-guard.ts).
 */

import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { rowsOf } from './db/rows.js';
import { webhookDeliveries } from './db/schema.js';
import { idPrefix, newId } from './ids.js';
import type { Settings } from './settings/schema.js';
import { SettingsStore } from './settings/store.js';
import { defaultWebhookFetch, WebhookRefusedError } from './webhook-guard.js';

export type WebhookEvent =
  | 'conversation.created'
  | 'conversation.unresolved'
  | 'message.created'
  | 'feedback.created'
  | 'gap.created'
  | 'roadmap.idea'
  | 'survey.response'
  | 'changelog.published'
  | 'article.published'
  | 'form.submitted'
  | 'giveaway.entered';

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  'conversation.created',
  'conversation.unresolved',
  'message.created',
  'feedback.created',
  'gap.created',
  'roadmap.idea',
  'survey.response',
  'changelog.published',
  'article.published',
  'form.submitted',
  'giveaway.entered',
];

/** What each event means, for the dashboard, the docs and setup prompts. */
export const WEBHOOK_EVENT_DESCRIPTIONS: Readonly<Record<WebhookEvent, string>> = {
  'conversation.created': 'A visitor started a new conversation.',
  'conversation.unresolved': 'The agent could not answer from the docs.',
  'message.created': 'A message was added to a conversation, by the visitor or the agent.',
  'feedback.created': 'Someone rated an answer, a conversation or an article (`kind` says which).',
  'gap.created': 'A question the docs do not answer was logged for the first time.',
  'roadmap.idea': 'Someone suggested a roadmap idea.',
  'survey.response':
    'Someone answered a survey question. A multi-question survey sends one per answer, with the same `sessionId`.',
  'changelog.published': 'A changelog entry was published.',
  'article.published': 'An article went live in the help center after a sync.',
  'form.submitted':
    'Someone submitted a form and it was accepted. `trusted` says whether it passed every anti-abuse check.',
  'giveaway.entered': 'Someone entered a giveaway for the first time.',
};

/** Sent only when someone asks for a test delivery. Nobody subscribes to it. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

/** A delivery is tried at most this many times in all. */
export const MAX_ATTEMPTS = 5;

/** How long a subscriber gets before the delivery is marked failed. */
const TIMEOUT_MS = 5_000;

/** How many due retries ride along with each emission, so no request waits long. */
const RETRIES_PER_EMIT = 2;

/**
 * The wait before the next try, after `attempts` failures: one minute, then
 * four, sixteen and sixty-four. Five attempts span about an hour and a half,
 * long enough to ride out a deploy, short enough that nobody is surprised by
 * an event arriving a day late.
 */
export function retryDelayMs(attempts: number): number {
  return 60_000 * 4 ** Math.max(0, attempts - 1);
}

/** One subscriber for one event: where to send it and how to sign it. */
interface Target {
  url: string;
  secret: string;
}

export interface WebhookOptions {
  /**
   * What deliveries are sent with. Left out, the built-in guard
   * (webhook-guard.ts): https only, public addresses only, checked on the
   * connection, redirects never followed; or the plain fetch when
   * HELPWELL_WEBHOOK_GUARD=off. A fetch passed here is used as it is, which is
   * how a host's own guard (`HelpWellConfig.webhookFetch`) takes over.
   */
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * Everything configured to receive `event`.
 *
 * A webhook with an empty `events` list gets everything, which is what a
 * freshly added URL should do until someone narrows it.
 */
export function targetsFor(settings: Settings, event: WebhookEvent): Target[] {
  const targets: Target[] = [];

  for (const hook of settings.webhooks) {
    if (!hook.active || !hook.url) continue;
    if (hook.events.length > 0 && !hook.events.includes(event)) continue;
    targets.push({ url: hook.url, secret: hook.secret });
  }

  return targets;
}

/**
 * Deliver one event to every subscriber, recording each attempt, then retry
 * a couple of earlier failures that are due.
 *
 * Deliveries run one after another rather than all at once: a customer with
 * three webhooks is not a customer who wants three parallel outbound
 * connections opened from inside every unresolved chat.
 */
export async function emitWebhooks(
  db: Db,
  settings: Settings,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  options: WebhookOptions = {},
): Promise<void> {
  const configured = settings.webhooks.some((hook) => hook.active && hook.url);
  if (!configured) return;

  const now = options.now ?? (() => new Date());
  const targets = targetsFor(settings, event);
  if (targets.length > 0) {
    const body = JSON.stringify({ event, at: now().toISOString(), data: payload });
    for (const target of targets) {
      try {
        await deliverNew(db, target, event, body, payload, options, true);
      } catch {
        // deliver records its own failures; anything that escapes it is a
        // database error, and that is not worth failing the caller for either.
      }
    }
  }

  try {
    await retryWebhooks(db, settings, { ...options, limit: RETRIES_PER_EMIT });
  } catch {
    // Same reasoning: a retry is a courtesy to an earlier event.
  }
}

/**
 * `emitWebhooks` for code that has a database but no settings in hand: the
 * changelog repo, the indexer. Reads the settings the running app uses.
 */
export async function emitStoredWebhooks(
  db: Db,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  options: WebhookOptions = {},
): Promise<void> {
  let settings: Settings;
  try {
    settings = await new SettingsStore(db).get();
  } catch {
    return;
  }
  await emitWebhooks(db, settings, event, payload, options);
}

/**
 * The events one chat turn raises: `conversation.created` when it opened a
 * thread, then `message.created` for the visitor's message and for the reply.
 * Called by the chat route after the answer is saved, so a slow endpoint
 * delays nothing but its own delivery.
 */
export async function announceChatTurn(
  db: Db,
  settings: Settings,
  turn: {
    conversationId: string;
    /** True when this message opened the conversation. */
    opened: boolean;
    contactId: string | null;
    pageUrl: string | null;
    question: string;
    reply: { messageId: string; text: string; pendingHuman?: boolean; unresolved?: boolean };
  },
  options: WebhookOptions = {},
): Promise<void> {
  if (!settings.webhooks.some((hook) => hook.active && hook.url)) return;
  if (turn.opened) {
    await emitWebhooks(
      db,
      settings,
      'conversation.created',
      { conversationId: turn.conversationId, contactId: turn.contactId, pageUrl: turn.pageUrl },
      options,
    );
  }
  if (targetsFor(settings, 'message.created').length === 0) return;

  const customer = rowsOf<{ id: string; created_at: string | Date }>(
    await db.execute(sql`
      SELECT id, created_at FROM helpwell.messages
      WHERE conversation_id = ${turn.conversationId} AND role = 'customer'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `),
  )[0];
  if (customer) {
    await emitWebhooks(
      db,
      settings,
      'message.created',
      {
        id: customer.id,
        conversationId: turn.conversationId,
        role: 'customer',
        body: turn.question,
        contactId: turn.contactId,
      },
      options,
    );
  }
  if (turn.reply.messageId && !turn.reply.pendingHuman) {
    await emitWebhooks(
      db,
      settings,
      'message.created',
      {
        id: turn.reply.messageId,
        conversationId: turn.conversationId,
        role: 'agent',
        body: turn.reply.text,
        unresolved: Boolean(turn.reply.unresolved),
        contactId: turn.contactId,
      },
      options,
    );
  }
}

async function deliverNew(
  db: Db,
  target: Target,
  event: string,
  body: string,
  payload: Record<string, unknown>,
  options: WebhookOptions,
  retryable: boolean,
): Promise<DeliveryOutcome> {
  const id = newId(idPrefix.webhook);
  await db.insert(webhookDeliveries).values({
    id,
    event,
    url: target.url,
    payload,
    body,
    status: 'pending',
    attempts: 0,
  });
  return attempt(db, { id, event, url: target.url, body, attempts: 0 }, target, options, retryable);
}

export interface DeliveryOutcome {
  id: string;
  url: string;
  event: string;
  status: 'delivered' | 'failed';
  responseCode: number | null;
  error: string | null;
  attempts: number;
  /** When it will be tried again, or null when it was delivered or given up on. */
  nextAttemptAt: Date | null;
}

/** One POST, and the row updated with how it went. */
async function attempt(
  db: Db,
  row: { id: string; event: string; url: string; body: string; attempts: number },
  target: Target,
  options: WebhookOptions,
  retryable: boolean,
): Promise<DeliveryOutcome> {
  const attempts = row.attempts + 1;
  const now = (options.now ?? (() => new Date()))();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'HelpWell-Webhooks/1',
    'x-helpwell-event': row.event,
    'x-helpwell-delivery': row.id,
    'x-helpwell-attempt': String(attempts),
  };
  if (target.secret) {
    headers['x-helpwell-signature'] = `sha256=${await sign(target.secret, row.body)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let responseCode: number | null = null;
  let error: string | null = null;
  let refused = false;
  try {
    const response = await (options.fetch ?? defaultWebhookFetch())(row.url, {
      method: 'POST',
      headers,
      body: row.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    responseCode = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message.slice(0, 500) : String(cause).slice(0, 500);
    // The guard would refuse the same URL the same way next time.
    refused = cause instanceof WebhookRefusedError;
  } finally {
    clearTimeout(timer);
  }

  const delivered = error === null;
  const nextAttemptAt =
    !delivered && retryable && !refused && attempts < MAX_ATTEMPTS
      ? new Date(now.getTime() + retryDelayMs(attempts))
      : null;
  await db
    .update(webhookDeliveries)
    .set({
      status: delivered ? 'delivered' : 'failed',
      attempts,
      responseCode,
      error,
      deliveredAt: delivered ? now : null,
      lastAttemptAt: now,
      nextAttemptAt,
    })
    .where(sql`id = ${row.id}`);

  return {
    id: row.id,
    url: row.url,
    event: row.event,
    status: delivered ? 'delivered' : 'failed',
    responseCode,
    error,
    attempts,
    nextAttemptAt,
  };
}

export interface RetryResult {
  attempted: number;
  delivered: number;
  /** Failed again, and scheduled for another try. */
  failed: number;
  /** Failed for the last time, or the webhook was removed from settings. */
  gaveUp: number;
  deliveries: DeliveryOutcome[];
}

/**
 * Retry failed deliveries that are due. `force` retries every failure that
 * still has attempts left, due or not, which is what a person wants after
 * fixing their endpoint.
 *
 * Rows are claimed before they are sent (their next attempt is pushed five
 * minutes out, under SKIP LOCKED), so two requests retrying at once never
 * send the same delivery twice, and a process that dies mid-send leaves the
 * row to be picked up again later.
 */
export async function retryWebhooks(
  db: Db,
  settings: Settings,
  options: WebhookOptions & { limit?: number; force?: boolean } = {},
): Promise<RetryResult> {
  const now = (options.now ?? (() => new Date()))();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
  const lease = new Date(now.getTime() + 5 * 60_000);

  const claimed = rowsOf<{
    id: string;
    event: string;
    url: string;
    body: string | null;
    payload: Record<string, unknown>;
    attempts: number;
    created_at: string | Date;
  }>(
    await db.execute(sql`
      UPDATE helpwell.webhook_deliveries AS d
      SET next_attempt_at = ${lease.toISOString()}::timestamptz
      WHERE d.id IN (
        SELECT id FROM helpwell.webhook_deliveries
        WHERE status = 'failed' AND next_attempt_at IS NOT NULL
          ${options.force ? sql`` : sql`AND next_attempt_at <= ${now.toISOString()}::timestamptz`}
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING d.id, d.event, d.url, d.body, d.payload, d.attempts, d.created_at
    `),
  );

  const result: RetryResult = { attempted: 0, delivered: 0, failed: 0, gaveUp: 0, deliveries: [] };
  for (const row of claimed) {
    const hook = settings.webhooks.find((h) => h.active && h.url === row.url);
    if (!hook) {
      await db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: null, error: 'Webhook is no longer configured; not retried' })
        .where(sql`id = ${row.id}`);
      result.gaveUp++;
      continue;
    }
    const body =
      row.body ??
      JSON.stringify({
        event: row.event,
        at: new Date(row.created_at).toISOString(),
        data: row.payload,
      });
    const outcome = await attempt(
      db,
      { id: row.id, event: row.event, url: row.url, body, attempts: Number(row.attempts) },
      { url: hook.url, secret: hook.secret },
      { ...options, now: () => now },
      true,
    );
    result.attempted++;
    result.deliveries.push(outcome);
    if (outcome.status === 'delivered') result.delivered++;
    else if (outcome.nextAttemptAt) result.failed++;
    else result.gaveUp++;
  }
  return result;
}

/**
 * Send a `webhook.test` event to every active webhook (or the one at `url`),
 * whatever events it subscribes to, and report how each went. Test deliveries
 * are recorded but never retried.
 */
export async function sendTestWebhook(
  db: Db,
  settings: Settings,
  options: WebhookOptions & { url?: string } = {},
): Promise<DeliveryOutcome[]> {
  const now = (options.now ?? (() => new Date()))();
  const hooks = settings.webhooks.filter(
    (hook) => hook.active && hook.url && (!options.url || hook.url === options.url),
  );
  const payload = {
    message: 'This is a test delivery from HelpWell. Nothing happened; your endpoint works.',
    product: settings.product.name,
  };
  const body = JSON.stringify({ event: WEBHOOK_TEST_EVENT, at: now.toISOString(), data: payload });
  const out: DeliveryOutcome[] = [];
  for (const hook of hooks) {
    out.push(
      await deliverNew(
        db,
        { url: hook.url, secret: hook.secret },
        WEBHOOK_TEST_EVENT,
        body,
        payload,
        options,
        false,
      ),
    );
  }
  return out;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
}

/** The delivery log, newest first. `status: 'retrying'` is failures with a try left. */
export async function listDeliveries(
  db: Db,
  options: { status?: 'pending' | 'delivered' | 'failed' | 'retrying'; limit?: number } = {},
): Promise<WebhookDelivery[]> {
  const filter =
    options.status === 'retrying'
      ? sql`status = 'failed' AND next_attempt_at IS NOT NULL`
      : options.status
        ? sql`status = ${options.status}`
        : sql`TRUE`;
  const rows = rowsOf<{
    id: string;
    event: string;
    url: string;
    status: WebhookDelivery['status'];
    attempts: number | string;
    response_code: number | string | null;
    error: string | null;
    created_at: string | Date;
    delivered_at: string | Date | null;
    last_attempt_at: string | Date | null;
    next_attempt_at: string | Date | null;
  }>(
    await db.execute(sql`
      SELECT id, event, url, status, attempts, response_code, error, created_at,
             delivered_at, last_attempt_at, next_attempt_at
      FROM helpwell.webhook_deliveries
      WHERE ${filter}
      ORDER BY created_at DESC, id DESC
      LIMIT ${Math.max(1, Math.min(options.limit ?? 50, 200))}
    `),
  );
  const date = (value: string | Date | null) => (value ? new Date(value) : null);
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    url: row.url,
    status: row.status,
    attempts: Number(row.attempts),
    responseCode: row.response_code === null ? null : Number(row.response_code),
    error: row.error,
    createdAt: new Date(row.created_at),
    deliveredAt: date(row.delivered_at),
    lastAttemptAt: date(row.last_attempt_at),
    nextAttemptAt: date(row.next_attempt_at),
  }));
}

/**
 * HMAC-SHA256 of the exact bytes sent, hex-encoded, the way GitHub and Stripe
 * sign theirs. A receiver recomputes it over the raw body and compares.
 */
export async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a signature the way a receiver should: constant-time, over the raw
 * body. Exported so a customer's endpoint can use it rather than write it.
 */
export async function verifySignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const expected = await sign(secret, body);
  const presented = header.slice('sha256='.length);
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
