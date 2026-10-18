/**
 * What the widget's own route modules share: the ownership test, the rate
 * limit that refuses, and what the widget is told a support extension can do.
 *
 * The same rules as `public.ts`, kept here so the widget modules do not reach
 * into that file's private helpers. Every route in them writes to or reads
 * one conversation, so every one starts with `ownConversation`.
 */

import { rateLimit } from '../../agent/guards.js';
import { HelpWellError } from '../../errors.js';
import { conversationOwner } from '../../repos/conversations.js';
import type { RequestContext } from '../context.js';
import type { SupportExtension } from '../support-extension.js';

/** Refuse once `bucket` has been hit `limit` times in the window. */
export async function enforce(
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

/**
 * The caller's contact id, once it is proven to own the conversation. 404 when
 * there is no such conversation, 403 when it is someone else's: an id is
 * guessable enough that ownership, not existence, is the test.
 */
export async function ownConversation(
  context: RequestContext,
  conversationId: string,
): Promise<string> {
  const owner = await conversationOwner(context.db, conversationId);
  if (!owner) throw new HelpWellError('not_found', 'No such conversation');
  const contactId = context.peekContactId();
  if (!contactId || owner.contactId !== contactId) {
    throw new HelpWellError('forbidden', 'Conversation belongs to another contact', {
      publicMessage: 'That conversation is not available.',
    });
  }
  return contactId;
}

/** Media types a visitor can never attach, whatever an extension allows. */
const NEVER_UPLOADED =
  /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript)$/i;

export interface UploadPolicy {
  maxBytes: number;
  types: string[];
}

/** The extension's upload policy, cleaned up, or null when uploads are off. */
export function uploadPolicy(support: SupportExtension | undefined): UploadPolicy | null {
  if (!support?.uploads || typeof support.upload !== 'function') return null;
  const maxBytes = Math.floor(Number(support.uploads.maxBytes));
  const types = (support.uploads.types ?? [])
    .map((type) => String(type).trim().toLowerCase())
    .filter((type) => /^[a-z0-9.+-]+\/(\*|[a-z0-9.+-]+)$/.test(type) && !NEVER_UPLOADED.test(type));
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || types.length === 0) return null;
  return { maxBytes, types };
}

export function typeAllowed(type: string, policy: UploadPolicy): boolean {
  if (NEVER_UPLOADED.test(type)) return false;
  const [family] = type.split('/');
  return policy.types.some((allowed) => allowed === type || allowed === `${family}/*`);
}

/**
 * What `/config` and the thread tell the widget about human support. Only
 * the switches, never how the extension works.
 */
export function supportCapabilities(support: SupportExtension | undefined):
  | {
      human: true;
      uploads: UploadPolicy | null;
      typing: boolean;
      presence: boolean;
      /** The widget asks `GET /proactive` for messages and engagements to show. */
      proactive: boolean;
    }
  | undefined {
  if (!support) return undefined;
  return {
    human: true,
    uploads: uploadPolicy(support),
    typing: typeof support.typing === 'function',
    presence: typeof support.presence === 'function',
    proactive: typeof support.proactive === 'function',
  };
}
