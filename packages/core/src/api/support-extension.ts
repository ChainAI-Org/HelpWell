/**
 * The seam a hosted service plugs human support into.
 *
 * Open source has no inbox, no queue, no email and no file storage. It has
 * this interface instead: a host that supplies one takes over human-mode
 * threads, and the optional members below switch on the matching widget
 * features. Without an extension every one of those features stays absent,
 * rather than half-working, and nothing here names a vendor.
 *
 * Every optional member is optional so an extension written against an
 * earlier version keeps compiling and keeps working.
 *
 * HelpWell never calls an extension directly: every call goes through the
 * fail-open wrapper in fail-open.ts, so an extension that throws or times out
 * costs the visitor nothing but the feature it provides. The AI keeps
 * answering. Only a real ownership refusal ("not your conversation") reaches
 * the visitor as an error. `createRemoteSupportExtension` (remote-extension.ts)
 * is an extension that speaks HTTP to any service implementing the protocol
 * in docs/support-extension.md.
 */

import type { z } from 'zod';
import type { AgentReply, ReplyInput } from '../agent/agent.js';
import type { ToolName } from '../agent/tools.js';
import type { Citation } from '../db/schema.js';
import type { triggerSchema } from '../engage/rules.js';
import type { chatBlockSchema } from '../engage/schema.js';
import type { FormSubmissionEvent } from '../forms/hook.js';

/** A file a visitor attached, as the extension stored it. */
export interface SupportAttachment {
  id: string;
  /** Where the widget loads it from: https, or a path on the API's own origin. */
  url: string;
  name: string;
  /** The sniffed media type, never the one the browser claimed. */
  type: string;
  /** Bytes. */
  size: number;
}

export interface SupportThreadMessage {
  id: string;
  role: 'customer' | 'agent' | 'human' | 'event';
  body: string;
  citations: Citation[];
  feedback: 'helpful' | 'not_helpful' | null;
  createdAt: string;
  authorName?: string | null;
  attachments?: SupportAttachment[];
}

export interface SupportThread {
  id: string;
  status: string;
  mode: 'ai' | 'human';
  messages: SupportThreadMessage[];
}

/**
 * What the widget shows while a person handles the thread. Polled, so keep
 * it cheap: the widget asks every few seconds while the panel is in use.
 */
export interface SupportPresence {
  /** A teammate is typing, and the name the visitor sees. */
  typing: { name: string } | null;
  /** The id of the newest visitor message a teammate has read. */
  seenUpTo?: string;
  /**
   * A line for the visitor, e.g. how and when they will hear back. With
   * `askEmail`, the widget also offers its email card to a visitor it has no
   * address for.
   */
  notice?: { text: string; askEmail?: boolean };
}

/**
 * Who is looking at which page, for `proactive`. The widget asks when a page
 * loads, when a single-page app changes route, and every minute while the
 * page is visible.
 */
export interface ProactiveContext {
  /** HelpWell's contact for this browser, when it has one yet. */
  contactId: string | null;
  /**
   * A random id the widget keeps in this browser's storage, so a returning
   * visitor can be recognised before HelpWell has a contact for them. Always
   * set; never an IP address or anything derived from one.
   */
  anonymousId: string;
  /** The page's path and query, e.g. `/billing?tab=invoices`. */
  path: string;
  /** Signed in through the host app's identify token. */
  identified: boolean;
  /** The screen the widget measured, or null when it did not say. */
  device?: 'desktop' | 'mobile' | null;
  /** The other site the visit came from, or empty: kept from the page the visit landed on. */
  referrer?: string;
  /** UTM values from the landing page's address, lower-cased. Kept for the visit. */
  utm?: { source?: string; medium?: string; campaign?: string };
  /** The browser's language, a BCP 47 tag such as `en-GB`, or empty. */
  locale?: string;
}

/** Who a proactive chat message is from, as the visitor sees it. */
export interface ProactiveSender {
  name: string;
  /** https only. Without one, the agent shows the product's mark and a teammate their initials. */
  avatarUrl?: string | null;
  /** The support agent, rather than a person on the team. */
  isAgent: boolean;
}

/**
 * One content block, in the engagement format (engage/schema.ts): text,
 * image, gif, video, buttons, divider. A button opens a link (`url`), the
 * chat, an article or one of the install's tours (`tour`, by the ids
 * `contentSync` lists), closes the bubble (`dismiss`), or sends `value`, or
 * its label, as the visitor's reply (`reply`, on a `replyable` message).
 */
export type ProactiveBlock = z.input<typeof chatBlockSchema>;

/** When something appears, in the engagement trigger format: load, delay, scroll, exit... */
export type ProactiveTrigger = z.input<typeof triggerSchema>;

/**
 * A chat message the extension wants a visitor to see: an incoming bubble by
 * the launcher, with an unread count. Replying to a `replyable` one starts a
 * conversation, which reaches `handleMessage` with `proactiveId` set.
 */
export interface ProactiveChatItem {
  kind: 'chat';
  /** Stable for this message: 1 to 64 letters, digits, `_`, `-`, `.` or `:`. */
  id: string;
  sender: ProactiveSender;
  blocks: ProactiveBlock[];
  replyable: boolean;
  /**
   * `bubble` (the default): by the launcher. `messenger`: the widget's panel
   * opens on a chat holding the message, unless the visitor already has the
   * panel open, when it waits there as a bubble instead. Shown that way once.
   */
  display?: 'bubble' | 'messenger';
  /**
   * When it appears, rather than as the page loads: a delay, scroll depth,
   * exit intent and the rest. With several, whichever happens first.
   */
  trigger?: ProactiveTrigger;
  triggers?: ProactiveTrigger[];
}

/**
 * A pop-up, banner, hotspot, tour or survey the extension decided on, in the
 * same definition format as `engage.engagements` in Settings. HelpWell
 * validates it, ignores its targeting and schedule (the extension already
 * chose this visitor), and shows it under the global engage cap.
 */
export interface ProactiveEngagementItem {
  kind: 'engagement';
  id: string;
  definition: Record<string, unknown>;
}

export type ProactiveItem = ProactiveChatItem | ProactiveEngagementItem;

/** What the visitor did with a proactive item. Each is reported once per item. */
export type ProactiveEvent = 'seen' | 'clicked' | 'dismissed';

export interface ProactiveEventContext {
  contactId: string | null;
  anonymousId: string;
}

/** The agent's tools by the names the model sees: `search_docs`, `collect_email`... */
export type AgentToolName = ToolName;

/**
 * How a service steers the AI, besides the playbook. Tools can only be
 * switched off: one the install's Settings switched off stays off whatever
 * this says. The instructions are added after the install's own. A name
 * replaces the agent's name from Settings wherever it is shown or said: the
 * widget, the help centre's "Ask" button and the agent's own instructions.
 */
export interface AgentOverrides {
  tools?: Partial<Record<AgentToolName, boolean>>;
  instructions?: string;
  name?: string;
}

/**
 * What this install can show that a proactive item may start by id: its own
 * tours and surveys from Settings. A button with action `tour` names one.
 */
export interface EngageCatalog {
  tours: { id: string; name: string; enabled: boolean }[];
  surveys: { id: string; name: string; enabled: boolean }[];
}

/**
 * What this install has published, for a service that writes about it (a
 * newsletter, a digest). Pushed by HelpWell, because the service cannot call
 * into the install. Only what the public help centre shows: published
 * articles in public collections, published changelog entries, the roadmap.
 * URLs are absolute when the help centre's address is known, else null.
 */
export interface ContentManifest {
  version: 1;
  generatedAt: string;
  /** Changes whenever anything below does, so an unchanged push can be skipped. */
  fingerprint: string;
  product: { name: string; helpCenterUrl: string | null };
  articles: {
    slug: string;
    title: string;
    description: string | null;
    collection: string;
    url: string | null;
    updatedAt: string;
    /** The first ~600 characters of the body, as plain text. */
    excerpt: string;
  }[];
  changelog: {
    id: string;
    version: string | null;
    title: string;
    date: string | null;
    url: string | null;
    summary: string;
  }[];
  roadmap: { id: string; title: string; status: string; votes: number; url: string | null }[];
  catalog: EngageCatalog;
}

/** Optional host extension. The open-source API has no inbox, queue or email dependency. */
export interface SupportExtension {
  afterReply(conversationId: string): Promise<void>;
  handleMessage(input: ReplyInput): Promise<AgentReply | null>;
  handoff(conversationId: string, contactId: string): Promise<void>;
  markSeen?(conversationId: string, contactId: string, messageIds: string[]): Promise<void>;
  thread(conversationId: string): Promise<SupportThread | null>;
  playbook?(): Promise<string>;

  /**
   * Visitor attachments. Both members together switch on the paperclip,
   * drag-and-drop and paste in the widget. `types` are media types, and
   * `image/*` style wildcards work. HelpWell checks ownership, size and the
   * file's real type (from its bytes) before `upload` is called, and never
   * accepts HTML, SVG, XML or script whatever `types` says.
   */
  uploads?: { maxBytes: number; types: string[] };
  upload?(
    conversationId: string,
    contactId: string,
    file: { name: string; type: string; bytes: Uint8Array },
  ): Promise<SupportAttachment>;

  /** The visitor started or stopped typing. The widget sends at most one call every 3 seconds. */
  typing?(conversationId: string, contactId: string, isTyping: boolean): Promise<void>;
  presence?(conversationId: string): Promise<SupportPresence>;

  /**
   * The visitor left an email (and maybe a name) on this conversation through
   * the widget's email card. Already saved on the contact; this is so a host
   * that follows up by email knows it now can.
   */
  contactCaptured?(
    conversationId: string,
    contactId: string,
    details: { email: string; name: string | null },
  ): Promise<void>;

  /**
   * Messages and engagements to show this visitor now, in the order to show
   * them. Pulled, never pushed: HelpWell has no outbound sender. Called
   * through `GET /proactive`, which caches each answer for a few seconds, so
   * this can be a network call. An error or an empty list shows nothing.
   */
  proactive?(context: ProactiveContext): Promise<ProactiveItem[]>;
  /** A visitor saw, clicked or dismissed an item `proactive` returned. */
  proactiveEvent?(id: string, event: ProactiveEvent, context: ProactiveEventContext): Promise<void>;

  /**
   * Someone submitted a form, and the submission was trusted (forms/abuse.ts)
   * and is not a repeat. Already stored, and the contact already updated.
   * Called from the durable retry queue, never in the visitor's request, and
   * replayed until it resolves, so it may arrive more than once: `id` is
   * stable, and the thing to deduplicate on. Shape: forms/hook.ts.
   */
  formSubmitted?(submission: FormSubmissionEvent): Promise<void>;

  /**
   * Steer the AI for its next answers: switch tools off, add instructions,
   * rename it. Asked before the AI answers and for the widget's config, and
   * the answer reused for 60 seconds, so
   * this can be a network call. An error or null means no overrides.
   */
  agentOverrides?(): Promise<AgentOverrides | null>;

  /**
   * This install's published content and its engage catalog. Pushed soon
   * after the content changes (a `helpwell sync`, an edit, a new release) and
   * at least once an hour otherwise, never in a visitor's request. A failure
   * is logged and the next push carries everything again.
   */
  contentSync?(manifest: ContentManifest): Promise<void>;

  /**
   * The tours and surveys a proactive item can start by id, pushed with
   * `contentSync` for an extension that wants only these.
   */
  catalog?(catalog: EngageCatalog): Promise<void>;
}
