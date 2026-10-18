/**
 * The widget's inline email card: a visitor leaves an address on a
 * conversation without it becoming a chat message.
 *
 * The agent's `collect_email` tool, a support extension's notice and the
 * pre-chat "after" timing all end in the same card, and the card ends here.
 * Open source sends nothing to the address. It is stored on the visitor's
 * contact so the team can see who to follow up with, and handed to a support
 * extension, if there is one, which may.
 *
 * The checks are the chat route's: the caller must own the conversation, the
 * honeypot must be empty, the address goes through the same abuse rules as a
 * message (blocked domains, disposable addresses, blocked IPs), the body has
 * to be JSON, and a bot check applies when the conversation has not passed
 * one. An identified visitor's email is the host app's, and is never
 * overwritten from here.
 */

import { sql } from 'drizzle-orm';
import { checkAbuse, recordBlocked } from '../../agent/guards.js';
import { rowsOf } from '../../db/rows.js';
import type { ToolCall } from '../../db/schema.js';
import { HelpWellError } from '../../errors.js';
import type { RequestContext } from '../context.js';
import { conversationVerified, requireHumanForConversation } from '../human-check.js';
import { json, type Router, readJson } from '../router.js';
import { enforce, ownConversation, uploadPolicy } from './widget-shared.js';

/** What the widget needs, beyond the messages, to draw a thread. */
export interface WidgetThreadState {
  /** The visitor's own details, so the card can say which address it has. */
  contact: { email: string | null; name: string | null; identified: boolean };
  /** The newest agent message that asked for an email, if one did. */
  emailAsk: { messageId: string; reason?: string } | null;
  /** Whether this conversation already passed the bot check. */
  botVerified: boolean;
  /** Attachments, when a support extension takes them. */
  uploads: { maxBytes: number; types: string[] } | null;
}

export function widgetContactRoutes(router: Router<RequestContext>): Router<RequestContext> {
  router.post('/conversations/:id/contact', async ({ params, context }) => {
    const body = await readJson<{
      email?: unknown;
      name?: unknown;
      honeypot?: unknown;
      turnstileToken?: unknown;
    }>(context.request);
    const conversationId = params.id!;
    const contactId = await ownConversation(context, conversationId);
    await enforce(context, `contact:${context.visitorKey()}`, 10, 3600);

    const [contact] = rowsOf<{ identified: boolean; name: string | null }>(
      await context.db.execute(sql`
        SELECT identified, name FROM helpwell.contacts WHERE id = ${contactId}
      `),
    );
    if (contact?.identified) {
      throw new HelpWellError('conflict', 'Identified contacts keep the email the app sent', {
        publicMessage: 'Your account already has an email address.',
      });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const honeypot = typeof body.honeypot === 'string' ? body.honeypot : null;

    // The honeypot first, so a bot learns nothing from the address checks.
    const abuse = checkAbuse({
      settings: context.settings.agent.abuse,
      maxMessageLength: Number.POSITIVE_INFINITY,
      message: '',
      identified: false,
      email: isEmail(email) ? email : null,
      ip: context.clientIp(),
      honeypot,
    });
    if (!abuse.allowed) {
      await recordBlocked(context.db, {
        reason: abuse.reason!,
        ip: context.clientIp(),
        detail: `contact:${abuse.reason}`,
      });
      throw new HelpWellError('blocked', `Blocked: ${abuse.reason}`, {
        publicMessage: abuse.message ?? 'That did not go through.',
      });
    }
    if (!isEmail(email)) {
      throw new HelpWellError('bad_request', 'Not an email address', {
        publicMessage: 'That does not look like an email address.',
      });
    }

    const passed = await requireHumanForConversation(context, conversationId, body.turnstileToken);

    // `identified = false` again here: a sign-in between the read above and
    // this write must not have its email replaced.
    const saved = rowsOf<{ email: string; name: string | null }>(
      await context.db.execute(sql`
        UPDATE helpwell.contacts
        SET email = ${email},
            name = COALESCE(${name || null}, name),
            updated_at = now()
        WHERE id = ${contactId} AND identified = false
        RETURNING email, name
      `),
    )[0];
    if (!saved) {
      throw new HelpWellError('conflict', 'Contact was identified mid-request', {
        publicMessage: 'Your account already has an email address.',
      });
    }
    await passed(conversationId);

    await context.config.support?.contactCaptured?.(conversationId, contactId, {
      email: saved.email,
      name: saved.name,
    });

    return json({ ok: true, contact: { email: saved.email, name: saved.name } });
  });

  return router;
}

/**
 * The widget's extras for `GET /conversations/:id`: who the visitor is, the
 * last time the agent asked for an email, whether the bot check has passed,
 * and whether files can be attached. Read from HelpWell's own tables even
 * when a support extension supplies the messages, because the ask and the
 * contact live here either way.
 */
export async function widgetThreadState(
  context: RequestContext,
  conversation: {
    id: string;
    contact: { email: string | null; name: string | null; identified: boolean };
    messages: { id: string; role: string; toolCalls?: ToolCall[] | null }[];
  },
): Promise<WidgetThreadState> {
  let emailAsk: WidgetThreadState['emailAsk'] = null;
  for (const message of conversation.messages) {
    if (message.role !== 'agent') continue;
    const asked = (message.toolCalls ?? []).find(
      (call) =>
        call.name === 'collect_email' &&
        (call.result as { asked?: unknown } | undefined)?.asked === true,
    );
    if (!asked) continue;
    const reason = asked.arguments?.reason;
    emailAsk = {
      messageId: message.id,
      ...(typeof reason === 'string' && reason.trim() ? { reason: reason.slice(0, 200) } : {}),
    };
  }

  return {
    contact: {
      // An identified visitor's email is the app's business, and the widget
      // never asks them for one, so it has no reason to be sent it.
      email: conversation.contact.identified ? null : conversation.contact.email,
      name: conversation.contact.identified ? null : conversation.contact.name,
      identified: conversation.contact.identified,
    },
    emailAsk: conversation.contact.identified ? null : emailAsk,
    botVerified: await conversationVerified(context.db, conversation.id),
    uploads: uploadPolicy(context.config.support),
  };
}

/**
 * Loose on purpose, like the widget's own check: one @, a dot in the domain,
 * no spaces, and short enough for the column. Deliverability is not
 * something a regular expression can answer.
 */
function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
