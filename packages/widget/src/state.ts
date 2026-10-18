/**
 * Widget state.
 *
 * One object, one change event. Small enough that a store library would be
 * more code than the thing it manages, and it keeps every render path
 * explicitly driven by a state change rather than by whoever called last.
 */

import type { Api, ChangelogSummary, ThreadMessage, WidgetConfig, WidgetStatus } from './api.js';

export type View =
  | { name: 'home' }
  | { name: 'messages' }
  | { name: 'help' }
  | { name: 'updates' }
  | { name: 'roadmap' }
  | { name: 'chat'; conversationId: string | null }
  | { name: 'article'; slug: string; from: View }
  | { name: 'entry'; id: string }
  // `title` rides along from the list that opened it, so the header can read
  // "Getting started" rather than the folder id. It is absent when the view is
  // entered any other way, and titleCase() covers that.
  | { name: 'collection'; collection: string; title?: string };

export interface ChatMessage extends ThreadMessage {
  /** Set when sending failed, so the UI can offer a retry. */
  failed?: boolean;
  /** The id its send went with, reused when it is retried. */
  requestId?: string;
}

export interface State {
  open: boolean;
  view: View;
  config: WidgetConfig | null;
  identified: boolean;
  /** What Home greets an identified visitor by, when the host app said. */
  firstName: string | null;
  unread: number;

  conversationId: string | null;
  messages: ChatMessage[];
  sending: boolean;

  /** Pre-chat details captured before the first message (WG-07). */
  preChatDone: boolean;

  /**
   * What this visitor left on the email card or the pre-chat form. Per
   * visitor, not per conversation: an address given once is not asked for
   * again in the next thread.
   */
  contact: { email: string | null; name: string | null };
  /** The agent message in this conversation that asked for an email, if one did. */
  emailAsk: { messageId: string; reason?: string } | null;
  /** This conversation already passed the bot check. */
  botVerified: boolean;

  /**
   * Changelog entries the visitor has not seen, for the announcement styles.
   * `server` when the API tracks reads for this visitor; `local` when it
   * cannot (no visitor cookie yet) and this browser keeps the record.
   */
  news: { tracking: 'server' | 'local'; items: ChangelogSummary[] } | null;
  /** The product's status, when one is configured (WG-11). */
  status: WidgetStatus | null;

  /**
   * The proactive chat message the visitor opened, when the conversation on
   * screen has not started yet: its first message goes out as a reply to it.
   */
  proactiveId: string | null;
  /** Proactive chat messages waiting by the launcher, for its badge. */
  proactiveUnread: number;
  /**
   * A message to send as soon as the chat is on screen: the quick reply the
   * visitor pressed on a proactive message (proactive.ts). Sent once.
   */
  outbox: string | null;
}

export type Listener = (state: State) => void;

export class Store {
  #state: State;
  #listeners = new Set<Listener>();

  constructor(initial?: Partial<State>) {
    this.#state = {
      open: false,
      view: { name: 'home' },
      config: null,
      identified: false,
      firstName: null,
      unread: 0,
      conversationId: null,
      messages: [],
      sending: false,
      preChatDone: false,
      contact: { email: null, name: null },
      emailAsk: null,
      botVerified: false,
      news: null,
      status: null,
      proactiveId: null,
      proactiveUnread: 0,
      outbox: null,
      ...initial,
    };
  }

  get state(): State {
    return this.#state;
  }

  set(patch: Partial<State> | ((state: State) => Partial<State>)): void {
    const next = typeof patch === 'function' ? patch(this.#state) : patch;
    this.#state = { ...this.#state, ...next };
    for (const listener of this.#listeners) listener(this.#state);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** Which tab a view belongs under, for the tab bar's selected state. */
export function tabFor(view: View): 'home' | 'messages' | 'help' | 'updates' | 'roadmap' {
  switch (view.name) {
    case 'chat':
      return 'messages';
    case 'article':
    case 'collection':
      return 'help';
    case 'entry':
      return 'updates';
    default:
      return view.name;
  }
}

/**
 * The unread count, for the Updates tab's dot.
 *
 * `changelog.notification` picks how new entries are announced; `'none'`
 * turns every sign of them off. For a visitor the server cannot track yet,
 * the count is what this browser has not seen.
 */
export function unreadBadge(state: State): number {
  if (state.config?.changelog.notification === 'none') return 0;
  if (state.news?.tracking === 'local') return state.news.items.length;
  return state.unread;
}

/**
 * The count on the launcher. Every style but `embed` and `none` shows it:
 * with `embed` the announcement lives in the host page's own feed, and a
 * second one on the launcher would be the same news twice. Messages waiting
 * by the launcher (proactive.ts) always count.
 */
export function launcherBadge(state: State): number {
  const news = state.config?.changelog.notification === 'embed' ? 0 : unreadBadge(state);
  return news + (state.proactiveUnread ?? 0);
}

/**
 * Should the widget show on this page at all?
 *
 * Checked in the browser as well as in settings, because a single-page app
 * changes route without reloading and the rules have to follow it (WG-09).
 */
export function shouldShow(
  rules: WidgetConfig['widget']['displayRules'],
  context: { path: string; identified: boolean; isMobile: boolean },
): boolean {
  if (rules.audience === 'identified' && !context.identified) return false;
  if (rules.audience === 'anonymous' && context.identified) return false;
  if (!rules.devices.includes(context.isMobile ? 'mobile' : 'desktop')) return false;
  if (rules.exclude.some((pattern) => matchPath(pattern, context.path))) return false;
  if (rules.include.length === 0) return true;
  return rules.include.some((pattern) => matchPath(pattern, context.path));
}

/** Same rule as the server's matcher: `*` within a segment, `**` across. */
export function matchPath(pattern: string, path: string): boolean {
  const source = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, (run) => (run.length > 1 ? '.*' : '[^/]*'));
  return new RegExp(`^${source}/?$`).test(path);
}

/** Load or refresh the unread badge without blocking anything else. */
export async function refreshUnread(api: Api, store: Store): Promise<void> {
  try {
    const { count } = await api.unread();
    store.set({ unread: count });
  } catch {
    // A missing badge is not worth surfacing an error for.
  }
}
