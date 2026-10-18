/**
 * The durable retry queue behind the fail-open wrapper (fail-open.ts).
 *
 * Most support extension calls can simply be dropped when the extension is
 * down: the AI answers instead, and the widget polls again. A few cannot. A
 * conversation that is never mirrored after a reply is missing from the
 * team's view for good if nothing else happens on it, and a form submission
 * that never reaches the extension is a lead lost. Those are written here and
 * replayed once the extension answers again.
 *
 * It lives in the database rather than in memory so a restart, a deploy or a
 * serverless instance going cold loses nothing. A row is claimed by moving
 * its `next_attempt_at` forward (a lease) in one statement, never by holding
 * a transaction open across the call: the call can take seconds, and the
 * embedded database has a single connection that everything else is waiting
 * on. One row per piece of work, keyed, so a conversation that fails ten
 * times is still one row, and the replay of a mirror always sends the latest
 * snapshot rather than an old one.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';

/** What can wait in the queue, and what replaying each one calls. */
export type SupportRetryKind = 'after_reply' | 'seen' | 'form_submitted';

export interface SupportRetry {
  kind: SupportRetryKind | string;
  key: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Waits between attempts: quick at first, then settling at six hours. */
const DELAYS_MS = [
  30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000,
  21_600_000,
];
/** About three and a half days of trying, after which a later reply re-mirrors anyway. */
export const MAX_RETRY_ATTEMPTS = 20;
/** Rows kept at most. Beyond this the oldest work goes first; a mirror is repaired by the next reply. */
export const MAX_RETRY_ROWS = 5_000;
/** How long a claimed row stays out of other drains' reach while its call runs. */
const LEASE_MS = 120_000;

/** How long to wait after `attempts` failed replays: the first wait is the one a new row gets. */
export function retryDelay(attempts: number): number {
  const index = Math.min(Math.max(Math.floor(attempts), 0), DELAYS_MS.length - 1);
  return DELAYS_MS[index]!;
}

/**
 * Park one piece of work. Queued again while it is already waiting, it keeps
 * its place and its attempt count and takes the newer payload.
 */
export async function enqueueRetry(
  db: Db,
  input: { kind: SupportRetryKind; key: string; payload?: Record<string, unknown>; error?: string },
  now: Date = new Date(),
): Promise<void> {
  const payload = JSON.stringify(input.payload ?? {});
  const due = new Date(now.getTime() + retryDelay(0)).toISOString();
  await db.execute(sql`
    INSERT INTO helpwell.support_retries
      (kind, key, payload, attempts, last_error, next_attempt_at, created_at, updated_at)
    VALUES (${input.kind}, ${input.key.slice(0, 300)}, ${payload}::jsonb, 0,
            ${input.error?.slice(0, 500) ?? null}, ${due}::timestamptz,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    ON CONFLICT (kind, key) DO UPDATE SET
      payload = EXCLUDED.payload,
      last_error = EXCLUDED.last_error,
      updated_at = EXCLUDED.updated_at
  `);
  // Bounded: an extension that is gone for good must not grow this forever.
  await db.execute(sql`
    DELETE FROM helpwell.support_retries
    WHERE (kind, key) IN (
      SELECT kind, key FROM helpwell.support_retries
      ORDER BY created_at DESC, kind, key
      OFFSET ${MAX_RETRY_ROWS}
    )
  `);
}

/** Take up to `limit` rows that are due, leasing them so a second drain skips them. */
export async function claimDueRetries(
  db: Db,
  options: { now?: Date; limit?: number } = {},
): Promise<SupportRetry[]> {
  const now = options.now ?? new Date();
  const lease = new Date(now.getTime() + LEASE_MS).toISOString();
  const result = await db.execute(sql`
    UPDATE helpwell.support_retries
    SET next_attempt_at = ${lease}::timestamptz
    WHERE (kind, key) IN (
      SELECT kind, key FROM helpwell.support_retries
      WHERE next_attempt_at <= ${now.toISOString()}::timestamptz
      ORDER BY next_attempt_at, kind, key
      LIMIT ${options.limit ?? 20}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING kind, key, payload, attempts
  `);
  return rowsOf<{ kind: string; key: string; payload: unknown; attempts: number }>(result).map(
    (row) => ({
      kind: row.kind,
      key: row.key,
      payload: asRecord(row.payload),
      attempts: Number(row.attempts) || 0,
    }),
  );
}

export async function completeRetry(
  db: Db,
  row: Pick<SupportRetry, 'kind' | 'key'>,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM helpwell.support_retries WHERE kind = ${row.kind} AND key = ${row.key}
  `);
}

/**
 * Put a row back after a failed replay. `counted: false` is for a replay that
 * never reached the extension (its circuit breaker was open), which is no
 * evidence against it and so costs no attempt. Resolves to true when the row
 * was given up on.
 */
export async function failRetry(
  db: Db,
  row: SupportRetry,
  options: { error?: string; now?: Date; counted?: boolean; retryInMs?: number } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const attempts = row.attempts + (options.counted === false ? 0 : 1);
  if (attempts >= MAX_RETRY_ATTEMPTS) {
    await completeRetry(db, row);
    return true;
  }
  const wait = options.retryInMs ?? retryDelay(attempts);
  await db.execute(sql`
    UPDATE helpwell.support_retries
    SET attempts = ${attempts},
        last_error = ${options.error?.slice(0, 500) ?? null},
        next_attempt_at = ${new Date(now.getTime() + wait).toISOString()}::timestamptz,
        updated_at = ${now.toISOString()}::timestamptz
    WHERE kind = ${row.kind} AND key = ${row.key}
  `);
  return false;
}

/** Everything waiting, oldest first, for a status check or a test. */
export async function pendingRetries(db: Db): Promise<(SupportRetry & { nextAttemptAt: Date })[]> {
  const result = await db.execute(sql`
    SELECT kind, key, payload, attempts, next_attempt_at
    FROM helpwell.support_retries
    ORDER BY created_at, kind, key
  `);
  return rowsOf<{
    kind: string;
    key: string;
    payload: unknown;
    attempts: number;
    next_attempt_at: string | Date;
  }>(result).map((row) => ({
    kind: row.kind,
    key: row.key,
    payload: asRecord(row.payload),
    attempts: Number(row.attempts) || 0,
    nextAttemptAt: new Date(row.next_attempt_at),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A jsonb column as an object, whichever way the driver hands it over. */
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
