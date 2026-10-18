/**
 * Proving a visitor is a person before what they send costs anything.
 *
 * The bot check is Cloudflare Turnstile: the widget runs a managed challenge
 * and sends the token it gets, and this module asks Cloudflare's siteverify
 * whether the token is good. It is off unless Settings (or the host's
 * config) turn it on AND both halves of the key are present: a site key the
 * widget can see, and a secret that only ever comes from the host's config or
 * the HELPWELL_TURNSTILE_SECRET environment variable, never from Settings,
 * because Settings are served to the dashboard and synced from a repo.
 *
 * A conversation proves itself once. The first message of a conversation
 * needs a token; when it passes, `bot_verified_at` is set on the conversation
 * and later messages (and the email card on the same thread) go through
 * without another challenge.
 *
 * `requireHuman` is the reusable half, for any public write that wants the
 * same check: forms, sign-ups, anything a script would flood.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import type { Settings } from '../settings/schema.js';

export interface TurnstileConfig {
  /** The Turnstile secret key. Falls back to HELPWELL_TURNSTILE_SECRET. */
  secret?: string;
  /** The public site key. Settings win when both are set. */
  siteKey?: string;
  /** Turn the check on from code, whatever Settings say. */
  enabled?: boolean;
  /** Reaches siteverify. For tests, and runtimes with a wrapped fetch. */
  fetch?: typeof globalThis.fetch;
}

export const TURNSTILE_SECRET_ENV = 'HELPWELL_TURNSTILE_SECRET';
/** The script the widget loads, and only when the check is on. */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
/** What a host page's Content-Security-Policy has to allow for the challenge to run. */
export const TURNSTILE_CSP = {
  'script-src': ['https://challenges.cloudflare.com'],
  'frame-src': ['https://challenges.cloudflare.com'],
} as const;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Turnstile tokens are at most 2048 characters. */
const MAX_TOKEN = 2048;
const VERIFY_TIMEOUT_MS = 8000;

/** Enough of the request context to run a check; forms can build one by hand. */
export interface HumanCheckContext {
  /** `env` is where the secret falls back to; `process.env` when unset. */
  config: { turnstile?: TurnstileConfig; env?: Record<string, string | undefined> };
  settings: Settings;
  clientIp(): string | null;
}

export interface BotCheckStatus {
  /** Settings or the host's config ask for a check. */
  requested: boolean;
  provider: 'turnstile' | null;
  /** Public: the widget renders the challenge with it. */
  siteKey: string;
  secretSet: boolean;
  /** Where the secret came from, for the dashboard's "set in environment" line. */
  secretSource: 'config' | 'environment' | null;
  /** Requested, with both keys present: challenges are actually required. */
  active: boolean;
}

/**
 * Whether the bot check is on, and whether it can work. Safe to show an admin
 * (it never includes the secret), and the source of what the widget is told.
 */
export function botCheckStatus(
  context: Pick<HumanCheckContext, 'config' | 'settings'>,
  env: Record<string, string | undefined> = context.config.env ?? process.env,
): BotCheckStatus {
  const own = context.config.turnstile ?? {};
  const abuse = context.settings.agent.abuse;
  const requested = abuse.botCheck === 'turnstile' || own.enabled === true;
  const siteKey = (abuse.turnstileSiteKey || own.siteKey || '').trim();
  const fromConfig = own.secret?.trim() ?? '';
  const fromEnv = env[TURNSTILE_SECRET_ENV]?.trim() ?? '';
  const secretSource = fromConfig ? 'config' : fromEnv ? 'environment' : null;
  return {
    requested,
    provider: requested ? 'turnstile' : null,
    siteKey,
    secretSet: secretSource !== null,
    secretSource,
    active: requested && siteKey.length > 0 && secretSource !== null,
  };
}

/** What `/config` tells the widget: run a challenge with this key, or nothing. */
export function publicBotCheck(
  context: Pick<HumanCheckContext, 'config' | 'settings'>,
): { provider: 'turnstile'; siteKey: string } | undefined {
  const status = botCheckStatus(context);
  return status.active ? { provider: 'turnstile', siteKey: status.siteKey } : undefined;
}

export interface TurnstileResult {
  success: boolean;
  /** Cloudflare's codes, e.g. `invalid-input-response`, `timeout-or-duplicate`. */
  errorCodes: string[];
  hostname?: string;
  action?: string;
}

/**
 * One siteverify call. A network failure or a non-JSON answer is thrown as
 * `upstream_failed`, which the widget treats as retryable; a token Cloudflare
 * rejects comes back as `success: false`.
 */
export async function verifyTurnstile(input: {
  secret: string;
  token: string;
  remoteIp?: string | null;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<TurnstileResult> {
  const doFetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const form = new URLSearchParams({ secret: input.secret, response: input.token });
  if (input.remoteIp) form.set('remoteip', input.remoteIp);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), input.timeoutMs ?? VERIFY_TIMEOUT_MS);
  try {
    const response = await doFetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: abort.signal,
    });
    const payload = (await response.json()) as {
      success?: unknown;
      'error-codes'?: unknown;
      hostname?: unknown;
      action?: unknown;
    };
    return {
      success: payload.success === true,
      errorCodes: Array.isArray(payload['error-codes'])
        ? payload['error-codes'].filter((code): code is string => typeof code === 'string')
        : [],
      hostname: typeof payload.hostname === 'string' ? payload.hostname : undefined,
      action: typeof payload.action === 'string' ? payload.action : undefined,
    };
  } catch (cause) {
    throw new HelpWellError('upstream_failed', 'Turnstile siteverify could not be reached', {
      publicMessage: 'We could not check you are human just now. Try again in a moment.',
      details: { humanCheck: 'unavailable' },
      cause,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Throws unless `token` proves a person, when the bot check is on.
 *
 * Resolves `true` when a check ran and passed, `false` when the check is off
 * and nothing was asked. A missing token and a rejected one are both 403s
 * with `details.humanCheck` set (`missing` or `failed`), which is how the
 * widget knows to run a fresh challenge and try again.
 */
export async function requireHuman(token: unknown, context: HumanCheckContext): Promise<boolean> {
  const status = botCheckStatus(context);
  if (!status.active) return false;

  if (typeof token !== 'string' || !token.trim() || token.length > MAX_TOKEN) {
    throw new HelpWellError('forbidden', 'Bot check token missing', {
      publicMessage: 'Please confirm you are human, then try again.',
      details: { humanCheck: 'missing' },
    });
  }

  const own = context.config.turnstile ?? {};
  const env = context.config.env ?? process.env;
  const secret = own.secret?.trim() || env[TURNSTILE_SECRET_ENV]?.trim() || '';
  const result = await verifyTurnstile({
    secret,
    token: token.trim(),
    remoteIp: context.clientIp(),
    fetch: own.fetch,
  });
  if (!result.success) {
    throw new HelpWellError('forbidden', `Bot check failed: ${result.errorCodes.join(', ')}`, {
      publicMessage: 'We could not confirm you are human. Please try again.',
      details: { humanCheck: 'failed' },
    });
  }
  return true;
}

/**
 * The check for a conversation, which only has to pass once.
 *
 * Call it before the conversation is written to. It returns what to call once
 * the conversation exists (a first message creates it), which records the
 * pass so the next message skips the challenge. With the check off, or on a
 * conversation that already passed, it asks for nothing.
 */
export async function requireHumanForConversation(
  context: HumanCheckContext & { db: Db },
  conversationId: string | null | undefined,
  token: unknown,
): Promise<(conversationId: string) => Promise<void>> {
  const nothing = async () => {};
  if (!botCheckStatus(context).active) return nothing;
  if (conversationId && (await conversationVerified(context.db, conversationId))) return nothing;

  await requireHuman(token, context);
  return async (id: string) => {
    await context.db.execute(sql`
      UPDATE helpwell.conversations SET bot_verified_at = now()
      WHERE id = ${id} AND bot_verified_at IS NULL
    `);
  };
}

/** Whether this conversation has already passed the bot check. */
export async function conversationVerified(db: Db, conversationId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT bot_verified_at IS NOT NULL AS verified
    FROM helpwell.conversations WHERE id = ${conversationId}
  `);
  return rowsOf<{ verified: boolean }>(result)[0]?.verified === true;
}
