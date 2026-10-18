/**
 * Telling a support extension about a trusted submission.
 *
 * `SupportExtension.formSubmitted` is how a hosted service learns of a lead:
 * it can confirm the address, enrich it, and follow up, none of which the
 * open-source build does. It is only told about trusted submissions, and it
 * must never slow down or fail the visitor's submit.
 *
 * So the call is never made in the request. The submission goes into the
 * durable retry queue (api/support-retries.ts) due at once, and the queue is
 * drained in the background; the fail-open wrapper replays it from there,
 * with backoff, until the extension takes it. A restart or a serverless
 * instance freezing mid-call loses nothing: the row is still there for the
 * next drain. The submission id is the queue key, so it is sent once.
 */

import { isFailOpen } from '../api/fail-open.js';
import type { SupportExtension } from '../api/support-extension.js';
import { enqueueRetry, retryDelay } from '../api/support-retries.js';
import type { Db } from '../db/client.js';
import type { UtmKey } from '../engage/rules.js';
import type { FormVerdict } from './abuse.js';
import type { FormPlacement, FormType } from './schema.js';

/**
 * One trusted submission, as the extension receives it. JSON all the way
 * down (dates as ISO strings), because it may be stored in the retry queue
 * and replayed later, or sent over HTTP by a remote extension.
 */
export interface FormSubmissionEvent {
  /** The submission id: stable, and the key a replay is deduplicated on. */
  id: string;
  formId: string;
  formName: string;
  formType: FormType;
  formVersion: number;
  variant: string;
  placement: FormPlacement;
  submittedAt: string;
  contactId: string;
  email: string;
  name: string | null;
  /** Every answer by field id, typed: numbers, `YYYY-MM-DD` dates, lists, booleans. */
  fields: Record<string, unknown>;
  /** What was saved on the contact, by custom field key. */
  attributes: Record<string, unknown>;
  consent: {
    state: 'granted' | 'denied' | 'none';
    /** The words beside the box they ticked, exactly as shown. */
    text: string | null;
  };
  verdict: FormVerdict;
  page: { url: string | null; path: string | null };
  referrer: string | null;
  utm: Partial<Record<UtmKey, string>>;
  /** For a giveaway entry. */
  giveaway: {
    entryId: string;
    entries: number;
    referralCode: string;
    /** The entry whose referral link brought them, if one did. */
    referredBy: string | null;
  } | null;
}

/**
 * Hand a trusted submission to the extension, in the background. Resolves
 * once it is safely queued; never rejects.
 */
export async function notifyFormSubmitted(
  db: Db,
  support: SupportExtension | undefined,
  event: FormSubmissionEvent,
  onError: (error: unknown) => void = () => {},
  now: Date = new Date(),
): Promise<void> {
  if (!support?.formSubmitted) return;
  try {
    if (isFailOpen(support)) {
      // Due now: enqueueRetry dates a new row one first delay after `now`.
      await enqueueRetry(
        db,
        { kind: 'form_submitted', key: event.id, payload: { submission: event } },
        new Date(now.getTime() - retryDelay(0)),
      );
      void support.drainRetries().catch(onError);
      return;
    }
    // An extension handed over without the wrapper (a test, say): no queue.
    void support.formSubmitted(event).catch(onError);
  } catch (error) {
    onError(error);
  }
}
