/**
 * Fail open: what HelpWell does when a support extension fails.
 *
 * An extension is somebody else's code, or somebody else's server, sitting in
 * the path of every chat message. Whatever it does, the visitor must still
 * get an answer. So every call HelpWell makes to one goes through this
 * wrapper, which decides, member by member, what a failure means:
 *
 *   handleMessage   the AI answers, as if there were no extension
 *   afterReply      queued and replayed later (support-retries.ts)
 *   markSeen        queued and replayed later
 *   formSubmitted   queued and replayed later
 *   thread          HelpWell shows its own transcript
 *   playbook        no extra guidance for this answer
 *   presence        nobody typing, nothing to say
 *   typing, contactCaptured, proactiveEvent, contentSync, catalog
 *                   ignored
 *   agentOverrides  no overrides; any answer is reused for a minute
 *   proactive       nothing to show
 *   handoff, upload a friendly error the widget can show; a deliberate
 *                   refusal the extension made (a 4xx HelpWellError) passes
 *                   through with its own message
 *
 * The one thing that always passes through is an ownership refusal ("that is
 * not your conversation"): hiding it would let a visitor believe a message
 * reached a conversation it never did. Every call also has a ceiling on how
 * long it may take, so an extension that hangs costs a few seconds, not the
 * conversation.
 *
 * Failures are logged, but not one line per request during an outage: each
 * member logs its first failure, then at most once a minute with a count.
 */

import type { Db } from '../db/client.js';
import { HelpWellError, isHelpWellError } from '../errors.js';
import { AGENT_OVERRIDES_TTL_MS, cleanAgentOverrides } from './agent-overrides.js';
import type { AgentOverrides, SupportExtension, SupportPresence } from './support-extension.js';
import {
  claimDueRetries,
  completeRetry,
  enqueueRetry,
  failRetry,
  type SupportRetry,
  type SupportRetryKind,
} from './support-retries.js';

/** Where the wrapper reports what it swallowed. Nothing it logs contains a secret. */
export interface SupportLogger {
  warn(message: string, detail?: Record<string, unknown>): void;
}

export const consoleSupportLogger: SupportLogger = {
  warn(message, detail) {
    if (detail) console.warn(`helpwell: ${message}`, detail);
    else console.warn(`helpwell: ${message}`);
  },
};

export interface FailOpenOptions {
  /** Where the retry queue lives. */
  db: Db;
  logger?: SupportLogger;
  now?: () => Date;
  /**
   * The longest HelpWell waits for any one call, in milliseconds. The remote
   * extension's own timeouts are shorter; this is the backstop for one
   * written in-process that hangs. Default 15 s, and 30 s for a handoff (a
   * remote one mirrors the conversation first) or an upload.
   */
  timeoutMs?: number;
}

/** A wrapped extension, plus the handle on its retry queue. */
export interface FailOpenSupport extends SupportExtension {
  /** The extension being wrapped. */
  readonly inner: SupportExtension;
  /**
   * Replay everything in the queue that is due, now. Resolves to how many
   * succeeded. A host with a scheduler can call this every few minutes; the
   * wrapper also starts one on its own after a call succeeds.
   */
  drainRetries(): Promise<number>;
}

/** What the visitor reads when the team cannot be reached. */
export const HANDOFF_UNAVAILABLE =
  "We couldn't reach the team just now. The assistant can keep helping, or try again in a minute.";
const UPLOAD_UNAVAILABLE = 'The file could not be stored. Try again.';

const DEFAULT_TIMEOUT_MS = 15_000;
/** A handoff mirrors the conversation first, and an upload carries a file. */
const SLOW_TIMEOUT_MS = 30_000;
/** How often a success may start a drain, and how often an idle queue is looked at again. */
const DRAIN_EVERY_MS = 5_000;
const IDLE_RECHECK_MS = 5 * 60_000;
const LOG_EVERY_MS = 60_000;

/**
 * Whether an error is the "not your conversation" refusal: a HelpWellError
 * with code `forbidden`, including one from another copy of this package.
 */
export function isOwnershipError(error: unknown): boolean {
  if (isHelpWellError(error)) return error.code === 'forbidden';
  const e = error as { name?: unknown; code?: unknown } | null;
  return Boolean(
    e && typeof e === 'object' && e.name === 'HelpWellError' && e.code === 'forbidden',
  );
}

/** A refusal the extension meant, with a message for the visitor: a 4xx HelpWellError. */
function isDeliberateRefusal(error: unknown): error is HelpWellError {
  return isHelpWellError(error) && error.status >= 400 && error.status < 500;
}

function ownershipError(): HelpWellError {
  return new HelpWellError('forbidden', 'Conversation belongs to another contact', {
    publicMessage: 'That conversation is not available.',
  });
}

/**
 * An extension's error that says nothing against the work: the call never
 * reached it (its circuit breaker is open), or it asked to be called less
 * (a 429, or the pause after one). A replay that fails this way costs no
 * attempt, and waits as long as the error says.
 */
function skipped(error: unknown): { retryInMs?: number } | null {
  const e = error as { circuitOpen?: unknown; rateLimited?: unknown; retryInMs?: unknown } | null;
  if (!e || typeof e !== 'object' || (e.circuitOpen !== true && e.rateLimited !== true)) {
    return null;
  }
  return typeof e.retryInMs === 'number' && e.retryInMs > 0 ? { retryInMs: e.retryInMs } : {};
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

class TimeoutError extends Error {
  constructor(member: string, ms: number) {
    super(`${member} took longer than ${Math.round(ms / 1000)} seconds`);
    this.name = 'TimeoutError';
  }
}

async function within<T>(member: string, ms: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(member, ms)), ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The shape `formSubmitted` has, whenever an extension provides it. */
type FormSubmittedHook = (submission: unknown) => Promise<void>;

export function failOpenSupport(
  inner: SupportExtension,
  options: FailOpenOptions,
): FailOpenSupport {
  const { db } = options;
  const logger = options.logger ?? consoleSupportLogger;
  const now = options.now ?? (() => new Date());
  const limit = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /* --------------------------------------------------------------- logging */

  const logged = new Map<string, { at: number; missed: number }>();
  const report = (member: string, error: unknown, extra: Record<string, unknown> = {}) => {
    const at = Date.now();
    const last = logged.get(member);
    if (last && at - last.at < LOG_EVERY_MS) {
      last.missed++;
      return;
    }
    logged.set(member, { at, missed: 0 });
    logger.warn(`the support extension's ${member} failed; carrying on without it.`, {
      error: describe(error),
      ...(last?.missed ? { alsoFailed: last.missed } : {}),
      ...extra,
    });
  };

  /* ----------------------------------------------------------------- queue */

  let draining: Promise<number> | null = null;
  let lastDrain = 0;
  /** True once a drain found nothing and nothing has been queued here since. */
  let idle = false;

  const park = async (
    member: string,
    kind: SupportRetryKind,
    key: string,
    payload: Record<string, unknown>,
    error: unknown,
  ) => {
    try {
      await enqueueRetry(db, { kind, key, payload, error: describe(error) }, now());
      idle = false;
    } catch (queueError) {
      // The database is the last line; if it is down too, there is nothing
      // left to do but say so.
      report(`${member} (queue)`, queueError);
    }
  };

  const replay = async (row: SupportRetry): Promise<void> => {
    const payload = row.payload;
    switch (row.kind) {
      case 'after_reply':
        await inner.afterReply(row.key);
        return;
      case 'seen': {
        const ids = Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : [];
        if (!inner.markSeen || ids.length === 0) return;
        await inner.markSeen(String(payload.conversationId), String(payload.contactId), ids);
        return;
      }
      case 'form_submitted': {
        const hook = (inner as { formSubmitted?: FormSubmittedHook }).formSubmitted;
        if (typeof hook === 'function') await hook.call(inner, payload.submission);
        return;
      }
      default:
        // Work a newer version queued and this one does not know: dropped.
        return;
    }
  };

  const drainRetries = (): Promise<number> => {
    draining ??= (async () => {
      let succeeded = 0;
      lastDrain = Date.now();
      try {
        for (;;) {
          const rows = await claimDueRetries(db, { now: now(), limit: 20 });
          if (rows.length === 0) {
            idle = true;
            break;
          }
          let stop = false;
          for (const row of rows) {
            if (stop) break;
            try {
              await within(`retry of ${row.kind}`, limit, () => replay(row));
              await completeRetry(db, row);
              succeeded++;
            } catch (error) {
              // Still down: put this one back and leave the rest leased, to
              // be tried after the lease rather than hammered now.
              const circuit = skipped(error);
              const gaveUp = await failRetry(db, row, {
                error: describe(error),
                now: now(),
                counted: !circuit,
                retryInMs: circuit?.retryInMs,
              });
              if (gaveUp) {
                logger.warn('gave up retrying a support extension call.', {
                  kind: row.kind,
                  key: row.key,
                  error: describe(error),
                });
              }
              stop = true;
            }
          }
          if (stop || rows.length < 20) break;
        }
      } catch (error) {
        report('retry queue', error);
      } finally {
        draining = null;
      }
      return succeeded;
    })();
    return draining;
  };

  /** A call just worked: the extension is up, so replay what waited, now and then. */
  const succeeded = () => {
    const at = Date.now();
    if (draining || at - lastDrain < DRAIN_EVERY_MS) return;
    if (idle && at - lastDrain < IDLE_RECHECK_MS) return;
    void drainRetries();
  };

  /** Run `work`, marking success; the caller decides what a failure means. */
  const call = async <T>(member: string, work: () => Promise<T>, ms = limit): Promise<T> => {
    const result = await within(member, ms, work);
    succeeded();
    return result;
  };

  /* --------------------------------------------------------------- members */

  const wrapped: FailOpenSupport = {
    inner,
    drainRetries,

    async handleMessage(input) {
      try {
        const reply = await call('handleMessage', () => inner.handleMessage(input));
        if (reply === null || reply === undefined) return null;
        // A reply that is not one is no reply: the AI answers.
        if (typeof reply.conversationId !== 'string' || typeof reply.messageId !== 'string') {
          report('handleMessage', new Error('returned something that is not a reply'));
          return null;
        }
        return reply;
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        report('handleMessage', error);
        return null;
      }
    },

    async afterReply(conversationId) {
      try {
        await call('afterReply', () => inner.afterReply(conversationId));
      } catch (error) {
        report('afterReply', error);
        await park('afterReply', 'after_reply', conversationId, {}, error);
      }
    },

    async handoff(conversationId, contactId) {
      try {
        await call(
          'handoff',
          () => inner.handoff(conversationId, contactId),
          Math.max(limit, SLOW_TIMEOUT_MS),
        );
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        if (isDeliberateRefusal(error)) throw error;
        report('handoff', error);
        throw new HelpWellError('upstream_failed', 'Support extension handoff failed', {
          publicMessage: HANDOFF_UNAVAILABLE,
          cause: error,
        });
      }
    },

    async thread(conversationId) {
      try {
        const thread = await call('thread', () => inner.thread(conversationId));
        if (thread === null || thread === undefined) return null;
        if (typeof thread !== 'object' || !Array.isArray(thread.messages)) {
          report('thread', new Error('returned something that is not a thread'));
          return null;
        }
        return thread;
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        report('thread', error);
        return null;
      }
    },
  };

  if (inner.markSeen) {
    const markSeen = inner.markSeen.bind(inner);
    wrapped.markSeen = async (conversationId, contactId, messageIds) => {
      try {
        await call('markSeen', () => markSeen(conversationId, contactId, messageIds));
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        report('markSeen', error);
        const last = messageIds[messageIds.length - 1] ?? '';
        await park(
          'markSeen',
          'seen',
          `${conversationId}:${last}`,
          { conversationId, contactId, messageIds: messageIds.slice(0, 100) },
          error,
        );
      }
    };
  }

  if (inner.playbook) {
    const playbook = inner.playbook.bind(inner);
    wrapped.playbook = async () => {
      try {
        const text = await call('playbook', () => playbook());
        return typeof text === 'string' ? text : '';
      } catch (error) {
        report('playbook', error);
        return '';
      }
    };
  }

  // Read through, not copied: an extension may stop offering uploads (a
  // remote one whose service turned out not to take files).
  if (inner.uploads !== undefined) {
    Object.defineProperty(wrapped, 'uploads', {
      get: () => inner.uploads,
      enumerable: true,
      configurable: true,
    });
  }
  if (inner.upload) {
    const upload = inner.upload.bind(inner);
    wrapped.upload = async (conversationId, contactId, file) => {
      try {
        return await call(
          'upload',
          () => upload(conversationId, contactId, file),
          Math.max(limit, SLOW_TIMEOUT_MS),
        );
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        if (isDeliberateRefusal(error)) throw error;
        report('upload', error);
        throw new HelpWellError('upstream_failed', 'Support extension upload failed', {
          publicMessage: UPLOAD_UNAVAILABLE,
          cause: error,
        });
      }
    };
  }

  if (inner.typing) {
    const typing = inner.typing.bind(inner);
    wrapped.typing = async (conversationId, contactId, isTyping) => {
      try {
        await call('typing', () => typing(conversationId, contactId, isTyping));
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        report('typing', error);
      }
    };
  }

  if (inner.presence) {
    const presence = inner.presence.bind(inner);
    wrapped.presence = async (conversationId) => {
      try {
        return await call('presence', () => presence(conversationId));
      } catch (error) {
        if (isOwnershipError(error)) throw ownershipError();
        report('presence', error);
        return { typing: null } satisfies SupportPresence;
      }
    };
  }

  if (inner.contactCaptured) {
    const captured = inner.contactCaptured.bind(inner);
    wrapped.contactCaptured = async (conversationId, contactId, details) => {
      try {
        await call('contactCaptured', () => captured(conversationId, contactId, details));
      } catch (error) {
        // The address is saved on the contact either way, and the next
        // mirror carries it.
        report('contactCaptured', error);
      }
    };
  }

  if (inner.proactive) {
    const proactive = inner.proactive.bind(inner);
    wrapped.proactive = async (context) => {
      try {
        const items = await call('proactive', () => proactive(context));
        return Array.isArray(items) ? items : [];
      } catch (error) {
        report('proactive', error);
        return [];
      }
    };
  }

  if (inner.proactiveEvent) {
    const proactiveEvent = inner.proactiveEvent.bind(inner);
    wrapped.proactiveEvent = async (id, event, context) => {
      try {
        await call('proactiveEvent', () => proactiveEvent(id, event, context));
      } catch (error) {
        report('proactiveEvent', error);
      }
    };
  }

  if (inner.agentOverrides) {
    const agentOverrides = inner.agentOverrides.bind(inner);
    // Asked before every answer the AI gives, so one answer, good or failed,
    // is reused for a minute rather than asked for each time.
    let cached: { value: AgentOverrides | null; at: number } | null = null;
    let pending: Promise<AgentOverrides | null> | null = null;
    wrapped.agentOverrides = () => {
      const at = now().getTime();
      if (cached && at - cached.at < AGENT_OVERRIDES_TTL_MS) return Promise.resolve(cached.value);
      pending ??= (async () => {
        let value: AgentOverrides | null = null;
        try {
          value = cleanAgentOverrides(await call('agentOverrides', () => agentOverrides()));
        } catch (error) {
          report('agentOverrides', error);
        }
        cached = { value, at: now().getTime() };
        pending = null;
        return value;
      })();
      return pending;
    };
  }

  if (inner.contentSync) {
    const contentSync = inner.contentSync.bind(inner);
    wrapped.contentSync = async (manifest) => {
      try {
        await call('contentSync', () => contentSync(manifest));
      } catch (error) {
        // The next push carries everything again.
        report('contentSync', error);
      }
    };
  }

  if (inner.catalog) {
    const catalog = inner.catalog.bind(inner);
    wrapped.catalog = async (value) => {
      try {
        await call('catalog', () => catalog(value));
      } catch (error) {
        report('catalog', error);
      }
    };
  }

  // `formSubmitted` is wrapped by name, so an extension that provides it
  // (forms, once they exist) gets the queue without this file changing.
  const formSubmitted = (inner as { formSubmitted?: FormSubmittedHook }).formSubmitted;
  if (typeof formSubmitted === 'function') {
    (wrapped as { formSubmitted?: FormSubmittedHook }).formSubmitted = async (submission) => {
      try {
        await call('formSubmitted', () => formSubmitted.call(inner, submission));
      } catch (error) {
        report('formSubmitted', error);
        const id = (submission as { id?: unknown } | null)?.id;
        await park(
          'formSubmitted',
          'form_submitted',
          typeof id === 'string' && id ? id : crypto.randomUUID(),
          { submission: submission as never },
          error,
        );
      }
    };
  }

  return wrapped;
}

/** True for an extension this module already wrapped, so it is never wrapped twice. */
export function isFailOpen(support: SupportExtension): support is FailOpenSupport {
  const candidate = support as Partial<FailOpenSupport>;
  return typeof candidate.drainRetries === 'function' && typeof candidate.inner === 'object';
}
