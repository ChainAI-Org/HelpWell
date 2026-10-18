/**
 * Spend caps, rate limits and abuse checks (AG-20, AG-21).
 *
 * These run before the model does, because the customer is paying for every
 * call with their own key. The design goal is that a scripted flood costs a few
 * cents and then stops, and that hitting a cap degrades the product rather than
 * breaking it: Fern keeps answering from search, it just stops thinking.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { firstRow } from '../db/rows.js';
import { blockedAttempts, rateCounters, spendLedger } from '../db/schema.js';
import { idPrefix, newId } from '../ids.js';
import { hashIp } from '../ip-hash.js';
import type { Usage } from './model.js';
import type { AbuseSettings, SpendCaps } from './types.js';

/* ------------------------------------------------------------------ spend */

export interface SpendStatus {
  /** false once today's spend has passed the cap */
  allowed: boolean;
  spentTodayUsd: number;
  capUsd: number;
  /** true past the warn-at percentage, so the dashboard can say so early */
  warning: boolean;
  percentUsed: number;
}

/**
 * "Today" for the ledger is the UTC date, computed here and bound into both
 * the write and the read. Asking the database for CURRENT_DATE instead would
 * use its session time zone, and a ledger written in UTC but read in, say,
 * America/Los_Angeles would miss up to eight hours of spend either side of
 * midnight.
 */
function ledgerDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function spendStatus(
  db: Db,
  caps: SpendCaps,
  now: Date = new Date(),
): Promise<SpendStatus> {
  const result = await db.execute<{ total: string | null }>(
    sql`SELECT COALESCE(SUM(cost_usd), 0)::text AS total
        FROM helpwell.spend_ledger
        WHERE day = ${ledgerDay(now)}::date`,
  );
  const spent = Number(firstRow<{ total: string | null }>(result)?.total ?? 0);
  const cap = caps.dailyCapUsd;
  // A cap of 0 means "no cap", which is a deliberate opt-out rather than a
  // configuration that silently blocks everything.
  const percentUsed = cap > 0 ? (spent / cap) * 100 : 0;
  return {
    allowed: cap === 0 || spent < cap,
    spentTodayUsd: Number(spent.toFixed(6)),
    capUsd: cap,
    warning: cap > 0 && percentUsed >= caps.warnAtPct,
    percentUsed: Number(percentUsed.toFixed(1)),
  };
}

export async function recordSpend(
  db: Db,
  entry: { kind: 'chat' | 'docs' | 'embedding' | 'eval' | 'image'; model: string; usage: Usage },
  now: Date = new Date(),
): Promise<void> {
  await db.insert(spendLedger).values({
    id: newId(idPrefix.spend),
    day: ledgerDay(now),
    kind: entry.kind,
    model: entry.model,
    tokensIn: entry.usage.tokensIn,
    tokensOut: entry.usage.tokensOut,
    costUsd: entry.usage.costUsd.toFixed(6),
  });
}

/* ------------------------------------------------------------ rate limits */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * A fixed window counter in the database.
 *
 * In the database rather than in memory because the API runs on serverless
 * platforms where every request may be a new process, and a limit that resets
 * on cold start is not a limit.
 */
export async function rateLimit(
  db: Db,
  bucket: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  const result = await db
    .insert(rateCounters)
    .values({ bucket, windowAt: windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateCounters.bucket, rateCounters.windowAt],
      set: { count: sql`${rateCounters.count} + 1` },
    })
    .returning({ count: rateCounters.count });

  const count = result[0]?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

/** Housekeeping for old counters; called by the daily maintenance job. */
export async function pruneRateCounters(db: Db, olderThanMs = 86_400_000): Promise<number> {
  // An ISO string, not a Date: postgres.js rejects a Date inside a raw sql template.
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = await db
    .delete(rateCounters)
    .where(sql`window_at < ${cutoff}`)
    .returning({ bucket: rateCounters.bucket });
  return rows.length;
}

/* ------------------------------------------------------------------ abuse */

export type BlockReason =
  | 'signed_in_only'
  | 'blocked_domain'
  | 'blocked_ip'
  | 'disposable_email'
  | 'message_too_long'
  | 'repeated_message'
  | 'honeypot';

export interface AbuseCheck {
  allowed: boolean;
  reason?: BlockReason;
  /** What the visitor sees. Never says which rule caught them. */
  message?: string;
}

export interface AbuseContext {
  settings: AbuseSettings;
  maxMessageLength: number;
  message: string;
  identified: boolean;
  email?: string | null;
  ip?: string | null;
  /** The visitor's last few messages, newest first, for repeat throttling. */
  recentMessages?: string[];
  /** A hidden form field: only a bot fills it in. */
  honeypot?: string | null;
}

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'throwawaymail.com',
  'yopmail.com',
  'sharklasers.com',
  'trashmail.com',
  'getnada.com',
  'temp-mail.org',
]);

export function checkAbuse(context: AbuseContext): AbuseCheck {
  const { settings } = context;

  if (context.honeypot) {
    return { allowed: false, reason: 'honeypot', message: 'That did not go through.' };
  }

  if (settings.signedInOnly && !context.identified) {
    return {
      allowed: false,
      reason: 'signed_in_only',
      message: 'Sign in to start a chat. You can still search and read the help center.',
    };
  }

  if (context.message.length > context.maxMessageLength) {
    return {
      allowed: false,
      reason: 'message_too_long',
      message: `That message is too long. Keep it under ${context.maxMessageLength} characters.`,
    };
  }

  const email = context.email?.trim().toLowerCase();
  if (email) {
    const domain = email.split('@')[1] ?? '';
    if (settings.blockedDomains.some((d) => matchesDomain(domain, d))) {
      return { allowed: false, reason: 'blocked_domain', message: 'That did not go through.' };
    }
    if (settings.blockDisposableEmail && DISPOSABLE_DOMAINS.has(domain)) {
      return {
        allowed: false,
        reason: 'disposable_email',
        message: 'Please use an address we can reply to.',
      };
    }
  }

  if (context.ip && settings.blockedIps.some((range) => matchesIp(context.ip!, range))) {
    return { allowed: false, reason: 'blocked_ip', message: 'That did not go through.' };
  }

  if (settings.throttleRepeats && context.recentMessages && context.recentMessages.length >= 2) {
    const normalised = normalise(context.message);
    const sameAsLastTwo = context.recentMessages
      .slice(0, 2)
      .every((m) => normalise(m) === normalised);
    if (sameAsLastTwo && normalised.length > 0) {
      return {
        allowed: false,
        reason: 'repeated_message',
        message: 'You have sent that a few times. Try rephrasing it.',
      };
    }
  }

  return { allowed: true };
}

/** Blocked attempts are counted, never stored as conversations (AG-21). */
export async function recordBlocked(
  db: Db,
  params: { reason: BlockReason; ip?: string | null; detail?: string },
): Promise<void> {
  await db.insert(blockedAttempts).values({
    id: newId(idPrefix.block),
    reason: params.reason,
    ipHash: params.ip ? await hashIp(db, params.ip) : null,
    detail: params.detail ?? null,
  });
}

function normalise(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesDomain(domain: string, rule: string): boolean {
  const clean = rule.trim().toLowerCase().replace(/^@/, '');
  if (!clean) return false;
  return domain === clean || domain.endsWith(`.${clean}`);
}

/**
 * One blocked-IP rule against one address. A rule is an exact address, a
 * dotted prefix ("203.0.113." matches the whole block), or an IPv4 CIDR range
 * ("10.0.0.0/8"). IPv6 rules are exact addresses only: an IPv6 prefix or
 * range is not supported and never matches anything.
 */
export function matchesIp(ip: string, rule: string): boolean {
  const clean = rule.trim();
  const address = ip.trim();
  if (!clean || !address) return false;
  if (clean.endsWith('.')) return address.startsWith(clean);

  const slash = clean.indexOf('/');
  if (slash === -1) return address.toLowerCase() === clean.toLowerCase();

  const network = ipv4ToInt(clean.slice(0, slash));
  const bits = Number(clean.slice(slash + 1));
  const candidate = ipv4ToInt(address);
  if (network === null || candidate === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (candidate & mask) >>> 0 === (network & mask) >>> 0;
}

/** Dotted quad -> unsigned 32-bit integer, or null when it is not one. */
function ipv4ToInt(value: string): number | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    out = out * 256 + octet;
  }
  return out >>> 0;
}

/**
 * IP addresses are personal data, so only a keyed hash is kept: enough to
 * count repeat offenders, not enough to identify anyone (PRD privacy). The
 * key is this install's own (ip-hash.ts); it is re-exported here, where the
 * abuse guards have always kept it.
 */
export { hashIp };
