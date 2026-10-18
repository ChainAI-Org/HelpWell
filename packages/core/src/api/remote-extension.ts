/**
 * A support extension that lives on another server, reached over HTTPS.
 *
 * `SupportExtension` is how a host plugs human support into HelpWell, and a
 * host that writes its own passes it in-process. This is the other way: point
 * HelpWell at any service that implements the remote support extension
 * protocol (docs/support-extension.md) and it becomes the extension, with no
 * code. Three values configure it: the service's URL, a product id, and a
 * bearer token that stays in the server's environment.
 *
 * Every action is `POST {url}/bridge/{product}/{action}` with a JSON body
 * (a visitor's file, `upload`, is the one sent as raw bytes), and every
 * answer carries `handled`. What this client adds is the discipline the
 * protocol asks of a client:
 *
 *   - HTTPS, except on localhost, and never following a redirect, so the
 *     token only ever goes where it was configured to go;
 *   - short timeouts: 10 seconds to mirror a conversation, hand it off, pass
 *     on a form submission or push content, 30 for a file, 5 for the rest;
 *   - a circuit breaker: after three failures in a row (a timeout, a network
 *     error, a 5xx, a body that is not JSON) it stops calling for a minute,
 *     so an outage costs the widget nothing;
 *   - a refusal (4xx) is not an outage: it is logged, it does not trip the
 *     breaker, and it is never retried;
 *   - except a 429, the service's request limit: every call to it waits out
 *     the `Retry-After` (at most five minutes, a minute when it names no
 *     wait), failing open meanwhile exactly as in an outage, with one log
 *     line per pause. It is not a failure, so the breaker's count is kept.
 *
 * It throws when the service cannot be reached, and leaves the consequences
 * to the fail-open wrapper every extension is called through (fail-open.ts):
 * that is where a failed mirror is queued for later and a failed message
 * becomes an AI answer. The one error meant for the visitor is ownership,
 * which is checked here, locally, before anything is sent.
 */

import { sql } from 'drizzle-orm';
import type { AgentReply } from '../agent/agent.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { Citation } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { conversationOwner } from '../repos/conversations.js';
import type { SetupPromptSpec } from '../setup-prompt.js';
import { cleanAgentOverrides } from './agent-overrides.js';
import { consoleSupportLogger, type SupportLogger } from './fail-open.js';
import type {
  SupportAttachment,
  SupportExtension,
  SupportPresence,
  SupportThread,
  SupportThreadMessage,
} from './support-extension.js';

/** The environment variables the handler reads when no `support` is passed. */
export const SUPPORT_URL_ENV = 'HELPWELL_SUPPORT_URL';
export const SUPPORT_PRODUCT_ENV = 'HELPWELL_SUPPORT_PRODUCT';
export const SUPPORT_TOKEN_ENV = 'HELPWELL_SUPPORT_TOKEN';

/** What identifies one connection. The token is a secret: environment only. */
export interface RemoteSupportOptions {
  /** The service's base URL, e.g. `https://support.example.com/api`. */
  url: string;
  /** Which product on that service this install is. */
  product: string;
  token: string;
}

export interface RemoteSupportTimeouts {
  /** A visitor's message while a person has the conversation. Default 5,000 ms. */
  message?: number;
  thread?: number;
  seen?: number;
  playbook?: number;
  proactive?: number;
  typing?: number;
  presence?: number;
  agentOverrides?: number;
  /** Mirroring a conversation. Default 10,000 ms. */
  sync?: number;
  handoff?: number;
  formSubmitted?: number;
  contentSync?: number;
  /** A visitor's file. Default 30,000 ms. */
  upload?: number;
}

/** Which files the widget offers to send, and the largest. */
export interface RemoteUploadLimits {
  maxBytes: number;
  /** Media types; `image/*` style wildcards work. */
  types: string[];
}

/**
 * What the protocol lets a visitor attach unless the connection says
 * otherwise: images, PDF, plain text, CSV, JSON, zip, MP4, WebM and QuickTime
 * video and Office documents, up to 10 MB. HelpWell never sends HTML, SVG,
 * XML or script, whatever this says.
 */
export const REMOTE_UPLOAD_LIMITS: Readonly<RemoteUploadLimits> = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  types: [
    'image/*',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json',
    'application/zip',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
});

export interface RemoteSupportExtensionOptions extends RemoteSupportOptions {
  /** HelpWell's database: conversations are mirrored from it and ownership checked against it. */
  db: Db;
  fetch?: typeof fetch;
  timeouts?: RemoteSupportTimeouts;
  /**
   * The files visitors may attach, sent with `upload`. Defaults to the
   * protocol's (`REMOTE_UPLOAD_LIMITS`); `false` turns attachments off. A
   * service that answers `upload` with 404 turns them off by itself.
   */
  uploads?: RemoteUploadLimits | false;
  /** Consecutive failures that open the circuit (default 3), and how long it stays open (60 s). */
  circuit?: { failures?: number; cooldownMs?: number };
  logger?: SupportLogger;
  /** The clock for the circuit breaker and caches, in milliseconds. For tests. */
  now?: () => number;
}

export interface RemoteSupportExtension extends SupportExtension {
  /** Whether the circuit breaker is skipping the service right now. */
  readonly circuitOpen: boolean;
  /** Whether a 429 from the service has paused every call to it right now. */
  readonly rateLimited: boolean;
  /** Try the connection: the same check `helpwell link` runs. Never throws. */
  ping(): Promise<RemoteSupportCheck>;
}

/**
 * The service could not be reached, took too long, answered 5xx or with no
 * JSON, or asked this server to slow down (429); or the circuit is open.
 */
export class SupportUnavailableError extends Error {
  /** The HTTP status, when the service answered 5xx or 429 (also set while a 429's pause lasts). */
  readonly status?: number;
  /** True when no request was made because the circuit breaker is open. */
  readonly circuitOpen: boolean;
  /**
   * True when the service answered 429, or no request was made because an
   * earlier 429's pause is not over. Not held against the work: the retry
   * queue waits `retryInMs` and costs it no attempt.
   */
  readonly rateLimited: boolean;
  /** When the circuit breaker, or a 429's pause, will let a call through again. */
  readonly retryInMs?: number;

  constructor(
    message: string,
    options: {
      status?: number;
      circuitOpen?: boolean;
      rateLimited?: boolean;
      retryInMs?: number;
    } = {},
  ) {
    super(message);
    this.name = 'SupportUnavailableError';
    this.status = options.status;
    this.circuitOpen = options.circuitOpen === true;
    this.rateLimited = options.rateLimited === true;
    this.retryInMs = options.retryInMs;
  }
}

/** The service refused the request (4xx): a wrong token, a malformed body, an action it lacks. */
export class SupportRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SupportRefusedError';
  }
}

const DEFAULT_TIMEOUTS: Required<RemoteSupportTimeouts> = {
  message: 5_000,
  thread: 5_000,
  seen: 5_000,
  playbook: 5_000,
  proactive: 5_000,
  typing: 5_000,
  presence: 5_000,
  agentOverrides: 5_000,
  sync: 10_000,
  handoff: 10_000,
  formSubmitted: 10_000,
  contentSync: 10_000,
  upload: 30_000,
};

/** The longest one 429 pauses the client, whatever its `Retry-After` says. */
export const MAX_RATE_LIMIT_PAUSE_MS = 5 * 60_000;
/** The pause after a 429 whose `Retry-After` is missing or unreadable. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
/** The shortest, so `Retry-After: 0` is a pause rather than a loop. */
const MIN_RATE_LIMIT_PAUSE_MS = 1_000;

/**
 * How long a 429 asks the client to wait, in milliseconds: `Retry-After` as
 * seconds or as an HTTP date (RFC 9110), kept between a second and five
 * minutes, so a bad header can neither loop nor stall the client for good.
 */
export function rateLimitPause(retryAfter: string | null | undefined, now: number): number {
  const value = (retryAfter ?? '').trim();
  let ms = Number.NaN;
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else if (value) ms = Date.parse(value) - now;
  if (!Number.isFinite(ms)) ms = DEFAULT_RATE_LIMIT_PAUSE_MS;
  return Math.min(MAX_RATE_LIMIT_PAUSE_MS, Math.max(MIN_RATE_LIMIT_PAUSE_MS, ms));
}

/** How long the playbook is reused before it is asked for again. */
const PLAYBOOK_TTL_MS = 60_000;
/** How long an action the service said it does not have (404) is not asked for again. */
const UNSUPPORTED_TTL_MS = 10 * 60_000;
/** The most messages one mirror carries: the newest ones. */
const SNAPSHOT_LIMIT = 500;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The base URL, checked: https, or http on this machine only. Throws with a
 * message that says what to fix. Never echoes a token.
 */
export function supportBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('The remote support extension URL is not a URL. Use https://…');
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error(
      'The remote support extension URL must use https:// (http:// only on localhost).',
    );
  }
  if (url.username || url.password) {
    throw new Error('Put the token in HELPWELL_SUPPORT_TOKEN, not in the URL.');
  }
  url.search = '';
  url.hash = '';
  return url;
}

function actionUrl(base: URL, product: string, action: string): string {
  return `${base.href.replace(/\/+$/, '')}/bridge/${encodeURIComponent(product)}/${action}`;
}

/* ------------------------------------------------------------ connection */

export interface RemoteSupportCheck {
  ok: boolean;
  /** The HTTP status, or 0 when nothing answered. */
  status: number;
  /** One line for a person: what happened and, when it failed, what to do. */
  message: string;
  latencyMs: number;
}

/**
 * Is the connection right? Asks for the playbook, which every service
 * answers and which changes nothing, and says in plain words what a failure
 * most likely means. Used by `helpwell link` and `ping()`.
 */
export async function checkRemoteSupport(
  options: RemoteSupportOptions & { fetch?: typeof fetch; timeoutMs?: number },
): Promise<RemoteSupportCheck> {
  const started = Date.now();
  const done = (ok: boolean, status: number, message: string): RemoteSupportCheck => ({
    ok,
    status,
    message,
    latencyMs: Date.now() - started,
  });

  let base: URL;
  try {
    base = supportBaseUrl(options.url);
  } catch (error) {
    return done(false, 0, (error as Error).message);
  }
  if (!options.product?.trim()) return done(false, 0, 'No product id is set.');
  if (!options.token?.trim()) return done(false, 0, `${SUPPORT_TOKEN_ENV} is not set.`);

  const controller = new AbortController();
  const ms = options.timeoutMs ?? DEFAULT_TIMEOUTS.playbook;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await (options.fetch ?? fetch)(
      actionUrl(base, options.product.trim(), 'playbook'),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token.trim()}`,
          'content-type': 'application/json',
        },
        body: '{}',
        signal: controller.signal,
        redirect: 'error',
      },
    );
    const status = response.status;
    const body = (await response.json().catch(() => null)) as {
      handled?: unknown;
      error?: { message?: unknown };
    } | null;
    if (status === 401 || status === 403) {
      return done(
        false,
        status,
        'The token was refused. It may be wrong, or replaced by a newer one.',
      );
    }
    if (status === 404) {
      return done(false, status, 'No such product at that URL. Check the URL and the product id.');
    }
    if (status >= 500) return done(false, status, 'The service is unavailable right now.');
    if (status === 429) {
      const wait = rateLimitPause(response.headers.get('retry-after'), Date.now());
      return done(
        false,
        status,
        `The service is limiting requests from this product right now. Try again in ${Math.ceil(wait / 1000)} seconds.`,
      );
    }
    if (!response.ok) {
      const detail = typeof body?.error?.message === 'string' ? `: ${body.error.message}` : '.';
      return done(false, status, `The service refused the request${detail}`.slice(0, 300));
    }
    if (!body || typeof body.handled !== 'boolean') {
      return done(false, status, 'Something answered, but not the remote support protocol.');
    }
    return done(true, status, 'Connected.');
  } catch (error) {
    const name = (error as Error)?.name;
    return done(
      false,
      0,
      name === 'AbortError' || name === 'TimeoutError'
        ? `No answer within ${Math.round(ms / 1000)} seconds.`
        : 'Could not reach the service. Check the URL, and that this server can reach it.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------- snapshot */

/** One message of a mirror, as the protocol's `sync` takes it. */
export interface SupportSnapshotMessage {
  sourceId: string;
  kind: 'customer' | 'ai' | 'event';
  body: string;
  citations: Citation[];
  metadata: Record<string, unknown>;
  /** AI answers: HelpWell's confidence score (0-1) and why, so the service can apply its own threshold. */
  confidence?: number;
  confidenceReason?: string | null;
  createdAt: string;
}

/** The body of a `sync`: the whole conversation, so any one that arrives repairs what went missing. */
export interface SupportSnapshot {
  sourceId: string;
  subject: string;
  pageUrl: string | null;
  unresolved: boolean;
  contact: {
    sourceId: string;
    name: string | null;
    email: string | null;
    attributes: Record<string, unknown>;
    /** An IANA time zone such as `Europe/London`, when the host app or browser said. */
    timezone: string | null;
    /** A BCP 47 tag such as `en-GB`, when known. */
    locale: string | null;
  };
  /** Set when the conversation began as a reply to a proactive chat message. */
  proactiveId?: string;
  messages: SupportSnapshotMessage[];
}

/** A conversation as the protocol mirrors it, or null when it is gone or has no contact. */
export async function supportSnapshot(
  db: Db,
  conversationId: string,
): Promise<SupportSnapshot | null> {
  const [conversation] = rowsOf<{
    id: string;
    status: string;
    page_url: string | null;
    contact_id: string | null;
    name: string | null;
    email: string | null;
    attributes: unknown;
    timezone: string | null;
    locale: string | null;
    proactive_id: string | null;
  }>(
    await db.execute(sql`
      SELECT c.id, c.status, c.page_url, c.contact_id, ct.name, ct.email, ct.attributes,
        ct.timezone, ct.locale,
        (SELECT d.item_id FROM helpwell.proactive_deliveries d
          WHERE d.conversation_id = c.id LIMIT 1) AS proactive_id
      FROM helpwell.conversations c
      LEFT JOIN helpwell.contacts ct ON ct.id = c.contact_id
      WHERE c.id = ${conversationId} AND c.deleted_at IS NULL
    `),
  );
  if (!conversation?.contact_id) return null;

  const rows = rowsOf<{
    id: string;
    role: string;
    body: string;
    citations: unknown;
    feedback: string | null;
    model: string | null;
    confidence: number | null;
    confidence_reason: string | null;
    created_at: string | Date;
  }>(
    await db.execute(sql`
      SELECT id, role, body, citations, feedback, model, confidence, confidence_reason, created_at
      FROM helpwell.messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${SNAPSHOT_LIMIT}
    `),
  ).reverse();

  const messages: SupportSnapshotMessage[] = [];
  for (const row of rows) {
    const kind = row.role === 'agent' ? 'ai' : row.role;
    if (kind !== 'customer' && kind !== 'ai' && kind !== 'event') continue;
    const confidence = row.confidence === null ? null : Number(row.confidence);
    messages.push({
      sourceId: row.id,
      kind,
      body: String(row.body ?? '').slice(0, 20_000),
      citations: citationsOf(row.citations).slice(0, 30),
      metadata: {
        feedback: row.feedback ?? null,
        // The opening message of a proactive conversation, which the service
        // may already hold as its own: this is how it tells the two apart.
        ...(row.model === PROACTIVE_MODEL ? { proactive: true } : {}),
      },
      ...(kind === 'ai' && confidence !== null && Number.isFinite(confidence)
        ? {
            confidence: Math.min(1, Math.max(0, confidence)),
            confidenceReason: row.confidence_reason?.slice(0, 500) ?? null,
          }
        : {}),
      createdAt: new Date(row.created_at).toISOString(),
    });
  }

  const firstQuestion = messages.find((m) => m.kind === 'customer' && m.body.trim());
  const email = conversation.email?.trim() ?? '';
  return {
    sourceId: conversation.id,
    subject: (firstQuestion?.body.trim() || 'New conversation').slice(0, 200),
    pageUrl: conversation.page_url?.slice(0, 2048) ?? null,
    unresolved: conversation.status !== 'resolved',
    contact: {
      sourceId: conversation.contact_id,
      name: conversation.name?.slice(0, 200) ?? null,
      // An address the service would refuse would block every mirror of this
      // conversation; it is left out instead.
      email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : null,
      attributes: isRecord(conversation.attributes) ? conversation.attributes : {},
      timezone: shortTag(conversation.timezone, 64),
      locale: shortTag(conversation.locale, 35),
    },
    ...(conversation.proactive_id ? { proactiveId: conversation.proactive_id } : {}),
    messages,
  };
}

/** The `model` HelpWell records on the opening message of a proactive conversation. */
export const PROACTIVE_MODEL = 'proactive';

/** A time zone or language tag as stored, or null when it is empty or not one. */
function shortTag(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= max && /^[A-Za-z0-9_+\-/]+$/.test(trimmed) ? trimmed : null;
}

/** The reply that tells the chat route a person has the conversation: the AI stays quiet. */
export function pendingHumanReply(conversationId: string, messageId: string): AgentReply {
  return {
    pendingHuman: true,
    conversationId,
    messageId,
    text: '',
    citations: [],
    unresolved: true,
    degraded: false,
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
  };
}

/* ---------------------------------------------------------------- client */

export function createRemoteSupportExtension(
  options: RemoteSupportExtensionOptions,
): RemoteSupportExtension {
  const base = supportBaseUrl(options.url);
  const product = options.product?.trim();
  const token = options.token?.trim();
  if (!product) throw new Error('The remote support extension needs a product id.');
  if (!token) throw new Error(`The remote support extension needs a token (${SUPPORT_TOKEN_ENV}).`);

  const { db } = options;
  const doFetch = options.fetch ?? fetch;
  const clock = options.now ?? Date.now;
  const logger = options.logger ?? consoleSupportLogger;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const threshold = Math.max(1, options.circuit?.failures ?? 3);
  const cooldown = Math.max(0, options.circuit?.cooldownMs ?? 60_000);

  const uploadLimits = options.uploads === false ? null : (options.uploads ?? REMOTE_UPLOAD_LIMITS);

  let failures = 0;
  let openUntil = 0;
  /** Until when a 429 holds every call back. Per client, as the service counts per product. */
  let pausedUntil = 0;
  let playbookCache: { text: string; at: number } | null = null;
  const unsupported = new Map<string, number>();
  const refusalLogged = new Map<string, number>();
  /** Whether the service said, not long ago, that it does not have this action. */
  const lacks = (action: string) => {
    const until = unsupported.get(action);
    return until !== undefined && clock() < until;
  };

  const failed = (message: string, status?: number) => {
    failures++;
    if (failures >= threshold) openUntil = clock() + cooldown;
    return new SupportUnavailableError(message, { status });
  };

  /**
   * A 429: hold every call back for `ms`. Answers that arrive while a pause
   * is on (calls already in flight) can only lengthen it, and only the one
   * that starts it is logged.
   */
  const pause = (action: string, ms: number) => {
    const at = clock();
    const starting = at >= pausedUntil;
    pausedUntil = Math.max(pausedUntil, at + ms);
    if (starting) {
      logger.warn(
        `the remote support extension asked this server to slow down (429 to ${action}); no calls for ${Math.ceil(ms / 1000)} seconds.`,
      );
    }
  };

  /** A refusal is a configuration problem worth one line a minute, not one per request. */
  const noteRefusal = (action: string, error: SupportRefusedError) => {
    const at = clock();
    if (at - (refusalLogged.get(action) ?? Number.NEGATIVE_INFINITY) < 60_000) return;
    refusalLogged.set(action, at);
    logger.warn(`the remote support extension refused ${action} (${error.status}).`, {
      error: error.message,
    });
  };

  async function request(
    action: string,
    body: unknown,
    timeoutMs: number,
    /** A file goes as its raw bytes, with what it is in headers (the `upload` action). */
    file?: { bytes: Uint8Array; headers: Record<string, string> },
  ): Promise<Record<string, unknown>> {
    if (clock() < pausedUntil) {
      throw new SupportUnavailableError(
        'The remote support extension is paused: the service asked this server to slow down.',
        { status: 429, rateLimited: true, retryInMs: pausedUntil - clock() },
      );
    }
    if (clock() < openUntil) {
      throw new SupportUnavailableError('The remote support extension is paused after failures.', {
        circuitOpen: true,
        retryInMs: openUntil - clock(),
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let text: string;
    try {
      try {
        response = await doFetch(actionUrl(base, product!, action), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file ? 'application/octet-stream' : 'application/json',
            ...file?.headers,
          },
          body: file ? new Uint8Array(file.bytes) : JSON.stringify(body ?? {}),
          signal: controller.signal,
          // A redirect would carry the token somewhere it was not configured to go.
          redirect: 'error',
        });
      } catch {
        throw failed(
          controller.signal.aborted
            ? `The remote support extension did not answer ${action} within ${timeoutMs / 1000} seconds.`
            : `The remote support extension could not be reached for ${action}.`,
        );
      }
      if (response.status >= 500) {
        throw failed(
          `The remote support extension answered ${action} with ${response.status}.`,
          response.status,
        );
      }
      // Over the service's request limit: not an outage and not a refusal.
      // Nothing is sent until the wait is over; what the queue keeps is kept.
      if (response.status === 429) {
        const wait = rateLimitPause(response.headers.get('retry-after'), clock());
        pause(action, wait);
        void response.body?.cancel().catch(() => {});
        throw new SupportUnavailableError(
          `The remote support extension answered ${action} with 429.`,
          { status: 429, rateLimited: true, retryInMs: wait },
        );
      }
      try {
        text = await response.text();
      } catch {
        throw failed(`The remote support extension's answer to ${action} was cut off.`);
      }
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      // A refusal is not an outage: it does not trip the breaker, and it will
      // not change on a resend.
      const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
      throw new SupportRefusedError(
        typeof error.message === 'string'
          ? error.message.slice(0, 300)
          : `The remote support extension refused ${action} (${response.status}).`,
        response.status,
        typeof error.code === 'string' ? error.code : undefined,
      );
    }
    if (!isRecord(parsed)) {
      throw failed(
        `The remote support extension answered ${action} with something that is not JSON.`,
      );
    }
    failures = 0;
    openUntil = 0;
    return parsed;
  }

  /** For actions a service may not implement: a 404 means "not here", remembered for a while. */
  async function optional(
    action: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    if (lacks(action)) return null;
    try {
      return await request(action, body, timeoutMs);
    } catch (error) {
      if (error instanceof SupportRefusedError) {
        if (error.status === 404) unsupported.set(action, clock() + UNSUPPORTED_TTL_MS);
        noteRefusal(action, error);
        return null;
      }
      throw error;
    }
  }

  const owned = async (conversationId: string, contactId: string | null | undefined) => {
    const owner = await conversationOwner(db, conversationId);
    if (!owner || !contactId || owner.contactId !== contactId) {
      throw new HelpWellError('forbidden', 'Conversation belongs to another contact', {
        publicMessage: 'That conversation is not available.',
      });
    }
  };

  /** Mirror one conversation. A refusal is logged and dropped; an outage throws, to be queued. */
  const sync = async (conversationId: string, refusalThrows = false) => {
    const snapshot = await supportSnapshot(db, conversationId);
    if (!snapshot) return;
    try {
      await request('sync', snapshot, timeouts.sync);
    } catch (error) {
      if (error instanceof SupportRefusedError && !refusalThrows) {
        noteRefusal('sync', error);
        return;
      }
      throw error;
    }
  };

  const extension: RemoteSupportExtension = {
    get circuitOpen() {
      return clock() < openUntil;
    },

    get rateLimited() {
      return clock() < pausedUntil;
    },

    async ping() {
      // A pause holds back the check too: it is a call like any other.
      const wait = pausedUntil - clock();
      if (wait > 0) {
        return {
          ok: false,
          status: 429,
          message: `The service asked this server to slow down. Calls resume in ${Math.ceil(wait / 1000)} seconds.`,
          latencyMs: 0,
        };
      }
      return checkRemoteSupport({
        url: base.href,
        product: product!,
        token: token!,
        fetch: doFetch,
        timeoutMs: timeouts.playbook,
      });
    },

    async afterReply(conversationId) {
      await sync(conversationId);
    },

    async handleMessage(input) {
      // A new conversation has nobody on it yet: the AI takes the first message.
      if (!input.conversationId) return null;
      await owned(input.conversationId, input.contactId);
      // A filled honeypot is HelpWell's to refuse; its abuse check does that.
      if (input.honeypot?.trim()) return null;
      // A reply to a proactive message: the service hears about the
      // conversation first, so it can route the reply to whoever wrote it.
      if (input.proactiveId) await sync(input.conversationId, true);

      let result: Record<string, unknown>;
      try {
        result = await request(
          'message',
          {
            sourceId: input.conversationId,
            message: input.message.slice(0, 12_000),
            ...(input.requestId ? { requestId: input.requestId } : {}),
            ...(input.proactiveId ? { proactiveId: input.proactiveId } : {}),
          },
          timeouts.message,
        );
      } catch (error) {
        if (error instanceof SupportRefusedError) {
          noteRefusal('message', error);
          return null;
        }
        throw error;
      }
      const message = isRecord(result.message) ? result.message : null;
      if (result.handled !== true || typeof message?.id !== 'string') return null;
      return pendingHumanReply(input.conversationId, message.id);
    },

    async handoff(conversationId, contactId) {
      await owned(conversationId, contactId);
      await sync(conversationId, true);
      const result = await request('handoff', { sourceId: conversationId }, timeouts.handoff);
      if (result.handled === true || result.queued === true) return;
      throw new SupportRefusedError(
        `The remote support extension did not take the handoff (${String(result.reason ?? 'no reason')}).`,
        409,
        typeof result.reason === 'string' ? result.reason : undefined,
      );
    },

    async markSeen(conversationId, contactId, messageIds) {
      await owned(conversationId, contactId);
      try {
        await request('seen', { sourceId: conversationId, messageIds }, timeouts.seen);
      } catch (error) {
        if (error instanceof SupportRefusedError) {
          noteRefusal('seen', error);
          return;
        }
        throw error;
      }
    },

    async thread(conversationId) {
      let result: Record<string, unknown>;
      try {
        result = await request('thread', { sourceId: conversationId }, timeouts.thread);
      } catch (error) {
        if (error instanceof SupportRefusedError) {
          noteRefusal('thread', error);
          return null;
        }
        throw error;
      }
      const ticket = isRecord(result.ticket) ? result.ticket : null;
      if (result.handled !== true || !ticket || !Array.isArray(result.messages)) return null;
      return threadFrom(db, conversationId, ticket, result.messages);
    },

    async playbook() {
      const at = clock();
      if (playbookCache && at - playbookCache.at < PLAYBOOK_TTL_MS) return playbookCache.text;
      try {
        const result = await request('playbook', {}, timeouts.playbook);
        const text = typeof result.text === 'string' ? result.text.slice(0, 40_000) : '';
        playbookCache = { text, at };
        return text;
      } catch (error) {
        if (error instanceof SupportRefusedError) {
          noteRefusal('playbook', error);
          return '';
        }
        // The last good playbook beats none while the service is away.
        if (playbookCache) return playbookCache.text;
        throw error;
      }
    },

    async contactCaptured(conversationId) {
      // The mirror carries the contact's address, so a new mirror is the news.
      await sync(conversationId);
    },

    async proactive(context) {
      const utm = Object.fromEntries(
        Object.entries(context.utm ?? {}).filter(([, value]) => typeof value === 'string' && value),
      );
      const result = await optional(
        'proactive',
        {
          contactSourceId: context.contactId,
          anonymousId: context.anonymousId,
          path: context.path,
          identified: context.identified,
          // Additive: a service that does not read them ignores them.
          ...(context.device ? { device: context.device } : {}),
          ...(context.referrer ? { referrer: context.referrer.slice(0, 2000) } : {}),
          ...(Object.keys(utm).length > 0 ? { utm } : {}),
          ...(context.locale ? { locale: context.locale.slice(0, 35) } : {}),
        },
        timeouts.proactive,
      );
      if (result?.handled !== true || !Array.isArray(result.items)) return [];
      // Checked item by item by the route that shows them (api/proactive.ts).
      return result.items as never[];
    },

    async proactiveEvent(id, event, context) {
      await optional(
        'proactive-event',
        { id, event, contactSourceId: context.contactId, anonymousId: context.anonymousId },
        timeouts.proactive,
      );
    },

    /* ------------------------------------------------ live human support */

    async typing(conversationId, contactId, isTyping) {
      await owned(conversationId, contactId);
      // Nothing is queued: typing that could not be delivered is simply not shown.
      await optional('typing', { sourceId: conversationId, typing: isTyping }, timeouts.typing);
    },

    async presence(conversationId) {
      const result = await optional('presence', { sourceId: conversationId }, timeouts.presence);
      if (result?.handled !== true) return { typing: null };
      return presenceFrom(result.presence);
    },

    // Offered while the service takes files: a 404 to `upload` takes the
    // paperclip away for a while, rather than leaving one that always fails.
    get uploads() {
      return uploadLimits && !lacks('upload')
        ? { maxBytes: uploadLimits.maxBytes, types: [...uploadLimits.types] }
        : undefined;
    },

    async upload(conversationId, contactId, file) {
      await owned(conversationId, contactId);
      if (!uploadLimits || lacks('upload')) throw uploadRefused('Attachments are not available.');
      // The service may not have this conversation yet; a mirror first is
      // harmless when it does.
      await sync(conversationId);
      let result: Record<string, unknown>;
      try {
        result = await request('upload', null, timeouts.upload, {
          bytes: file.bytes,
          headers: {
            'x-helpwell-source-id': encodeURIComponent(conversationId),
            'x-helpwell-filename': encodeURIComponent(file.name.slice(0, 200)),
            'x-helpwell-type': file.type,
          },
        });
      } catch (error) {
        if (error instanceof SupportRefusedError) {
          if (error.status === 404) unsupported.set('upload', clock() + UNSUPPORTED_TTL_MS);
          noteRefusal('upload', error);
          // A refused file (too big, a type it does not take) keeps the
          // service's reason, for the visitor.
          throw uploadRefused(
            error.status === 404 ? 'Attachments are not available.' : error.message,
          );
        }
        throw error;
      }
      const [attachment] = result.handled === true ? attachmentsOf([result.attachment]) : [];
      if (!attachment) {
        throw new Error(
          `The remote support extension did not take the file (${String(result.reason ?? 'no reason')}).`,
        );
      }
      return attachment;
    },

    /* --------------------------------------------------- forms and agent */

    async formSubmitted(submission) {
      // An outage throws, and the fail-open queue sends it again; a service
      // that does not take submissions (404) is not asked for a while.
      await optional('form-submitted', submission, timeouts.formSubmitted);
    },

    async agentOverrides() {
      const result = await optional('agent-overrides', {}, timeouts.agentOverrides);
      if (result?.handled !== true) return null;
      return cleanAgentOverrides(result);
    },

    async contentSync(manifest) {
      await optional('content-sync', manifest, timeouts.contentSync);
    },
  };
  return extension;
}

/** The service's `presence`, as the widget can show it. Anything else is nobody typing. */
function presenceFrom(value: unknown): SupportPresence {
  if (!isRecord(value)) return { typing: null };
  const typing =
    isRecord(value.typing) && typeof value.typing.name === 'string' && value.typing.name.trim()
      ? { name: value.typing.name.trim().slice(0, 60) }
      : null;
  const out: SupportPresence = { typing };
  if (typeof value.seenUpTo === 'string' && value.seenUpTo) {
    out.seenUpTo = value.seenUpTo.slice(0, 100);
  }
  if (isRecord(value.notice) && typeof value.notice.text === 'string' && value.notice.text.trim()) {
    out.notice = {
      text: value.notice.text.trim().slice(0, 300),
      ...(value.notice.askEmail === true ? { askEmail: true } : {}),
    };
  }
  return out;
}

/** A file the service would not take: a refusal the visitor reads, with its reason. */
function uploadRefused(message: string): HelpWellError {
  return new HelpWellError('bad_request', message.slice(0, 300), {
    publicMessage: message.slice(0, 300),
  });
}

/** The service's transcript as the widget draws it. AI answers keep HelpWell's id, so feedback works. */
async function threadFrom(
  db: Db,
  conversationId: string,
  ticket: Record<string, unknown>,
  raw: unknown[],
): Promise<SupportThread> {
  const feedback = new Map<string, 'helpful' | 'not_helpful' | null>();
  for (const row of rowsOf<{ id: string; feedback: string | null }>(
    await db.execute(sql`
      SELECT id, feedback FROM helpwell.messages WHERE conversation_id = ${conversationId}
    `),
  )) {
    feedback.set(
      row.id,
      row.feedback === 'helpful' || row.feedback === 'not_helpful' ? row.feedback : null,
    );
  }

  const messages: SupportThreadMessage[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const kind = entry.kind;
    if (kind !== 'customer' && kind !== 'ai' && kind !== 'human' && kind !== 'event') continue;
    const sourceId =
      typeof entry.source_id === 'string' && entry.source_id ? entry.source_id : null;
    const id = kind === 'ai' && sourceId ? sourceId : String(entry.id ?? '');
    if (!id) continue;
    const created = new Date(String(entry.created_at ?? ''));
    const attachments = attachmentsOf(entry.attachments);
    messages.push({
      id,
      role: kind === 'ai' ? 'agent' : kind,
      body: typeof entry.body === 'string' ? entry.body : '',
      citations: citationsOf(entry.citations),
      feedback: sourceId ? (feedback.get(sourceId) ?? null) : null,
      createdAt: Number.isNaN(created.getTime())
        ? new Date(0).toISOString()
        : created.toISOString(),
      authorName: typeof entry.author_name === 'string' ? entry.author_name.slice(0, 120) : null,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  const status = String(ticket.status ?? '');
  return {
    id: conversationId,
    status: status === 'closed' || status === 'resolved' ? 'resolved' : 'unresolved',
    mode: ticket.mode === 'human' ? 'human' : 'ai',
    messages,
  };
}

function citationsOf(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const out: Citation[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.slug !== 'string' || typeof item.title !== 'string')
      continue;
    out.push({
      slug: item.slug,
      title: item.title,
      collection: typeof item.collection === 'string' ? item.collection : '',
    });
  }
  return out;
}

/** Files on a service's message: kept only with an https URL or a path on this origin. */
function attachmentsOf(value: unknown): SupportAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: SupportAttachment[] = [];
  for (const item of value.slice(0, 20)) {
    if (!isRecord(item) || typeof item.url !== 'string') continue;
    const url = item.url;
    const safe = /^https:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'));
    if (!safe) continue;
    out.push({
      id: String(item.id ?? url),
      url,
      name: String(item.name ?? '').slice(0, 120),
      type: String(item.type ?? ''),
      size: Number(item.size) || 0,
    });
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* --------------------------------------------------------- configuration */

/**
 * The connection the environment describes, if it describes one. All three
 * variables together, or nothing: `problem` says which is missing when only
 * some are set, so a half-configured server says so rather than quietly
 * running without human support.
 */
export function remoteSupportFromEnv(env: Record<string, string | undefined> = process.env): {
  options: RemoteSupportOptions | null;
  problem?: string;
} {
  const url = env[SUPPORT_URL_ENV]?.trim() ?? '';
  const product = env[SUPPORT_PRODUCT_ENV]?.trim() ?? '';
  const token = env[SUPPORT_TOKEN_ENV]?.trim() ?? '';
  if (!url && !product && !token) return { options: null };
  const missing = [
    !url && SUPPORT_URL_ENV,
    !product && SUPPORT_PRODUCT_ENV,
    !token && SUPPORT_TOKEN_ENV,
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      options: null,
      problem: `the remote support extension is not connected: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.`,
    };
  }
  return { options: { url, product, token } };
}

/** Whether a `support` value is connection details rather than an extension object. */
export function isRemoteSupportOptions(value: unknown): value is RemoteSupportOptions {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.product === 'string' &&
    typeof (value as { handleMessage?: unknown }).handleMessage !== 'function'
  );
}

/* ------------------------------------------------------------ setup prompt */

export interface RemoteSupportPromptOptions {
  productName?: string;
  /** The service's base URL and product id, when known. */
  url?: string;
  product?: string;
  /** Where the host app mounts the API. */
  apiPath?: string;
}

/**
 * Connect this install to a remote support extension: the environment on
 * the server, a restart, and a check that it answers. The token is the
 * person's to paste; the prompt only says where.
 */
export function remoteSupportPromptSpec(options: RemoteSupportPromptOptions = {}): SetupPromptSpec {
  const product = options.productName || 'my app';
  const url = options.url || 'https://YOUR-SERVICE.example.com/api';
  const productId = options.product || 'YOUR-PRODUCT-ID';
  const apiPath = options.apiPath || '/api/helpwell';
  return {
    task: `the remote support extension for ${product}'s HelpWell server`,
    goal: 'HelpWell hands conversations to the connected support service when a visitor asks for a person, mirrors every conversation to it, and shows its replies in the widget. If the service is ever unreachable, the AI keeps answering as before.',
    context: [
      `HelpWell is mounted at ${apiPath} with createHelpWellHandler from @helpwell/core.`,
      `When no \`support\` option is passed to createHelpWellHandler, it connects using the three environment variables ${SUPPORT_URL_ENV}, ${SUPPORT_PRODUCT_ENV} and ${SUPPORT_TOKEN_ENV}. All three must be set.`,
      `The token is a secret. I set ${SUPPORT_TOKEN_ENV} myself, on the server only.`,
      'The connection fails open: short timeouts, and a circuit breaker that skips the service for a minute after three failures, so it can never break the widget.',
    ],
    steps: [
      `Find where the server's environment variables are set (a .env file, the hosting provider's settings, or the deployment config).`,
      `Set ${SUPPORT_URL_ENV} and ${SUPPORT_PRODUCT_ENV} to the values below.`,
      `Tell me where to paste the token as ${SUPPORT_TOKEN_ENV}. Do not ask me for it.`,
      'Check that createHelpWellHandler is not already passed a `support` option. If it is, stop and ask me.',
      'Restart or redeploy the server.',
      'Run the connection check below on the server, where the token is set.',
    ],
    tables: [
      {
        title: 'Server environment variables',
        rows: [
          { Variable: SUPPORT_URL_ENV, Value: url },
          { Variable: SUPPORT_PRODUCT_ENV, Value: productId },
          { Variable: SUPPORT_TOKEN_ENV, Value: null },
        ],
      },
    ],
    blocks: [
      {
        caption:
          'Connection check. It prints 200; 401 means the token is wrong or was replaced, 404 that the URL or product id is wrong:',
        language: 'bash',
        content: `curl -s -o /dev/null -w "%{http_code}\\n" -X POST "${url.replace(/\/+$/, '')}/bridge/${productId}/playbook" -H "Authorization: Bearer $${SUPPORT_TOKEN_ENV}" -H "content-type: application/json" -d '{}'`,
      },
      {
        caption: 'Or, from the repo, with the token set in that shell:',
        language: 'bash',
        content: 'npx helpwell link --status',
      },
    ],
    rules: [
      `Keep ${SUPPORT_TOKEN_ENV} in the server environment only: never in browser code, the repository, helpwell.config.json or a log.`,
      'Do not change or remove any other option passed to createHelpWellHandler.',
    ],
    verify: [
      'The connection check prints 200.',
      `GET ${apiPath}/config returns a "support" object with "human": true.`,
      'In the widget, ask a question and choose "Talk to a person": the conversation reaches the support service.',
    ],
  };
}
