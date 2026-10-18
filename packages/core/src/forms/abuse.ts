/**
 * The verdict: is this submission a real person, and can it be trusted?
 *
 * Every submission that came through a rendered form is judged on the same
 * signals, and the verdict is stored with it, so anyone can see later why a
 * lead was or was not counted:
 *
 *   turnstile    the bot check, when it is on (a failure never gets this far)
 *   honeypot     a field no person sees was filled in
 *   fillMs       how long since the form was drawn, by the server's clock
 *   rateLimited  too many from one address, or for one email
 *   disposable   a throwaway mail provider
 *   mx           whether the domain has a mail server
 *   duplicate    the same email already submitted this form
 *
 * Some of those reject the submission outright: it is stored, marked
 * rejected with its reasons, and touches no contact. Of those, the ones a
 * script trips (the honeypot, filling in too fast, a flood) are told nothing
 * went wrong, so they learn nothing; the ones a person can fix (a typo in the
 * domain, a throwaway address) are told what to change. A submission is
 * trusted when it was accepted on every signal and is not a throwaway
 * address. Only trusted submissions reach the extension hook, count in a
 * giveaway draw, or credit a referral.
 */

import { sql } from 'drizzle-orm';
import { checkAbuse, hashIp, matchesIp, rateLimit } from '../agent/guards.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { Settings } from '../settings/schema.js';
import { checkMx, type MxResolver, type MxResult } from './mx.js';
import type { FormDefinition } from './schema.js';

export type RejectReason =
  | 'honeypot'
  | 'too_fast'
  | 'rate_limited'
  | 'blocked_ip'
  | 'blocked_domain'
  | 'disposable'
  | 'no_mx';

export const REJECT_REASONS: readonly RejectReason[] = [
  'honeypot',
  'too_fast',
  'rate_limited',
  'blocked_ip',
  'blocked_domain',
  'disposable',
  'no_mx',
];

/** What each reason means, for the dashboard. */
export const REJECT_REASON_LABELS: Readonly<Record<RejectReason | 'no_token', string>> = {
  honeypot: 'Filled in the hidden field only bots see',
  too_fast: 'Submitted faster than a person can type',
  rate_limited: 'Too many from one address or for one email',
  blocked_ip: 'From a blocked IP address',
  blocked_domain: 'From a blocked email domain',
  disposable: 'A throwaway email address',
  no_mx: 'The email domain cannot receive mail',
  no_token: 'Not sent through a form HelpWell drew (no valid render token)',
};

/** Reasons a script trips: the visitor is shown the usual thank-you, and learns nothing. */
export const SILENT_REASONS: ReadonlySet<RejectReason> = new Set([
  'honeypot',
  'too_fast',
  'rate_limited',
]);

export interface FormVerdict {
  /** `passed` or `off`; a missing or failed challenge is refused before a verdict. */
  turnstile: 'passed' | 'off';
  /** True when the hidden field was filled in. */
  honeypot: boolean;
  /** Milliseconds from the form being drawn to it being submitted. */
  fillMs: number;
  tooFast: boolean;
  rateLimited: boolean;
  disposable: boolean;
  blockedDomain: boolean;
  blockedIp: boolean;
  mx: MxResult;
  duplicate: boolean;
  /** Accepted on every signal, and not a throwaway address. */
  trusted: boolean;
  reasons: RejectReason[];
}

/** How far over a rate limit a flood goes before it is refused without being stored. */
export const HARD_LIMIT_FACTOR = 3;

export interface JudgeInput {
  formId: string;
  definition: FormDefinition;
  settings: Settings;
  email: string;
  honeypot: unknown;
  /** When the render token was issued. */
  issuedAt: number;
  now: number;
  ip: string | null;
  turnstilePassed: boolean;
  resolveMx?: MxResolver | null;
}

export type Judged =
  | { refused: true }
  | {
      refused: false;
      verdict: FormVerdict;
      status: 'accepted' | 'rejected' | 'duplicate';
    };

/**
 * Judge one submission. `refused` means far over a rate limit: nothing is
 * stored and the caller answers 429.
 */
export async function judgeSubmission(db: Db, input: JudgeInput): Promise<Judged> {
  const reasons: RejectReason[] = [];
  const abuse = input.definition.abuse;
  const email = input.email.toLowerCase();
  const domain = email.split('@')[1] ?? '';

  const honeypot =
    typeof input.honeypot === 'string' ? input.honeypot.trim() !== '' : Boolean(input.honeypot);
  if (honeypot) reasons.push('honeypot');

  const fillMs = Math.max(0, input.now - input.issuedAt);
  const tooFast = fillMs < abuse.minFillSeconds * 1000;
  if (tooFast) reasons.push('too_fast');

  // Per address per form each hour, and per email per form each day. Over the
  // limit is a rejection that is still recorded; far over it, a refusal.
  // Keyed hashes (ip-hash.ts), so the counters hold neither the address nor
  // the email, and are stable for as long as this install's key is.
  const ipKey = input.ip ? await hashIp(db, input.ip) : 'unknown';
  const byIp = await counted(
    db,
    `form-ip:${input.formId}:${ipKey}`,
    abuse.perIpPerHour,
    3_600_000,
    input.now,
  );
  const byEmail = await counted(
    db,
    `form-email:${input.formId}:${await hashIp(db, email)}`,
    abuse.perEmailPerDay,
    86_400_000,
    input.now,
  );
  if (byIp === 'refused' || byEmail === 'refused') return { refused: true };
  const rateLimited = byIp === 'over' || byEmail === 'over';
  if (rateLimited) reasons.push('rate_limited');

  // The same list and rules the chat's abuse guard uses (agent.abuse).
  const rules = input.settings.agent.abuse;
  const blockedIp = Boolean(
    input.ip && rules.blockedIps.some((range) => matchesIp(input.ip!, range)),
  );
  if (blockedIp) reasons.push('blocked_ip');
  const domainCheck = checkAbuse({
    settings: {
      ...rules,
      signedInOnly: false,
      throttleRepeats: false,
      blockedIps: [],
      blockDisposableEmail: false,
    },
    maxMessageLength: Number.POSITIVE_INFINITY,
    message: '',
    identified: true,
    email,
  });
  const blockedDomain = domainCheck.reason === 'blocked_domain';
  if (blockedDomain) reasons.push('blocked_domain');
  const disposable = isDisposable(email, rules);
  if (disposable && rules.blockDisposableEmail) reasons.push('disposable');

  // A lookup is only worth making for a submission still in the running.
  let mx: MxResult = 'unchecked';
  if (abuse.checkMx && reasons.length === 0) {
    mx = await checkMx(domain, input.resolveMx);
    if (mx === 'none') reasons.push('no_mx');
  }

  const duplicate = reasons.length === 0 && (await alreadySubmitted(db, input.formId, email));
  const status = reasons.length > 0 ? 'rejected' : duplicate ? 'duplicate' : 'accepted';
  return {
    refused: false,
    status,
    verdict: {
      turnstile: input.turnstilePassed ? 'passed' : 'off',
      honeypot,
      fillMs,
      tooFast,
      rateLimited,
      disposable,
      blockedDomain,
      blockedIp,
      mx,
      duplicate,
      trusted: status !== 'rejected' && !disposable,
      reasons,
    },
  };
}

/** Over a limit, far over it, or within it. */
async function counted(
  db: Db,
  bucket: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<'ok' | 'over' | 'refused'> {
  const hard = limit * HARD_LIMIT_FACTOR;
  const result = await rateLimit(db, bucket, hard, windowMs, new Date(now));
  if (!result.allowed) return 'refused';
  const count = hard - result.remaining;
  return count > limit ? 'over' : 'ok';
}

/** Whether the chat's disposable-address list knows this domain, whatever the setting says. */
function isDisposable(email: string, rules: Settings['agent']['abuse']): boolean {
  const check = checkAbuse({
    settings: {
      ...rules,
      signedInOnly: false,
      throttleRepeats: false,
      blockedIps: [],
      blockedDomains: [],
      blockDisposableEmail: true,
    },
    maxMessageLength: Number.POSITIVE_INFINITY,
    message: '',
    identified: true,
    email,
  });
  return check.reason === 'disposable_email';
}

async function alreadySubmitted(db: Db, formId: string, email: string): Promise<boolean> {
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`
      SELECT id FROM helpwell.form_submissions
      WHERE form_id = ${formId} AND status = 'accepted' AND lower(email) = ${email}
      LIMIT 1
    `),
  );
  return rows.length > 0;
}

/** The message a person sees for a rejection they can fix. */
export function rejectionMessage(reason: RejectReason): string {
  switch (reason) {
    case 'disposable':
      return 'Please use an email address you will keep.';
    case 'no_mx':
      return 'That email domain cannot receive mail. Check the address for a typo.';
    default:
      return 'That did not go through.';
  }
}
