/**
 * Preview states: the widget in each state a visitor can meet it in, with no visitor.
 *
 * For a host that wants to show what the widget looks like at a moment that is hard to wait for:
 * a screen of settings beside a live widget, say. `widget.preview.show('proactive')` draws a made-up
 * state from local data alone. Nothing is fetched, sent or stored: no conversation, visitor or
 * contact exists afterwards, and a button inside a made-up message does what it would do on a page
 * that cannot reach the API (it opens a chat that is only on screen). The live content, a support
 * extension's messages and Settings engagements, stands aside while a state is shown and comes back
 * on `reset()`.
 *
 * One state at a time: showing another replaces the one on screen. Each state is drawn by the same
 * code a visitor's widget uses (the chat, the launcher's badge, the proactive bubbles, the email
 * card, the engage banner and pop-up), fed these samples.
 */

import type { Api, Citation } from './api.js';
import { mountPreview, type PreviewController } from './engage/preview.js';
import { mountProactive, type Proactive } from './proactive.js';
import { PROACTIVE_CSS } from './proactive-styles.js';
import type { ChatMessage, State, Store, View } from './state.js';

/** The states, in the order a control for them would list them. */
export const PREVIEW_STATES = [
  { id: 'launcher', label: 'Launcher closed' },
  { id: 'badge', label: 'Launcher with an unread badge' },
  { id: 'opening', label: 'Widget opening' },
  { id: 'teammate', label: 'Incoming teammate message' },
  { id: 'stacked', label: 'Several stacked messages' },
  { id: 'proactive', label: 'Proactive message over the launcher' },
  { id: 'answer', label: 'AI answer with a source' },
  { id: 'email', label: 'Email card for a visitor who leaves' },
  { id: 'banner', label: 'Banner' },
  { id: 'popup', label: 'Pop-up' },
] as const;

export type PreviewStateId = (typeof PREVIEW_STATES)[number]['id'];

export interface PreviewShowOptions {
  /** The number on the launcher's badge (`badge`). A count over 9 reads "9+". Default 1. */
  count?: number;
}

export interface WidgetPreview {
  readonly states: readonly { id: PreviewStateId; label: string }[];
  /** The state on screen now, or null once reset. */
  readonly current: PreviewStateId | null;
  /**
   * Show a state in place of whatever is shown. Resolves true once it is drawn (for `opening`,
   * once the panel has started to open), false for a name it does not know.
   */
  show(state: PreviewStateId | string, options?: PreviewShowOptions): Promise<boolean>;
  /** Take the made-up state away and let the live content back. */
  reset(): void;
  destroy(): void;
}

/** What the widget hands over: its state, its shadow root, and ways to open it and step aside. */
export interface PreviewHost {
  store: Store;
  root(): ShadowRoot | null;
  open(view?: View): void;
  /** Take the live content (an extension's messages, engagements) off the screen. */
  suspendLive(): void;
  /** Let it back. */
  resumeLive(): void;
}

/** What a preview changes in the widget's state, and puts back on reset. */
const TOUCHED = [
  'config',
  'open',
  'view',
  'conversationId',
  'messages',
  'sending',
  'emailAsk',
  'proactiveId',
  'proactiveUnread',
  'outbox',
  'unread',
] as const satisfies readonly (keyof State)[];

/** The widget with nothing going on: closed, on Home, no thread, nothing waiting by the launcher. */
const CLEAN: Partial<State> = {
  open: false,
  view: { name: 'home' },
  conversationId: null,
  messages: [],
  sending: false,
  emailAsk: null,
  proactiveId: null,
  proactiveUnread: 0,
  outbox: null,
  unread: 0,
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const frame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

/** How long the panel takes to close before a replay opens it again. */
const CLOSE_MS = 320;
/** The pause before the teammate's message arrives, so its arrival can be seen. */
const ARRIVAL_MS = 450;

const CHAT: View = { name: 'chat', conversationId: null };

let counter = 0;
const message = (
  role: ChatMessage['role'],
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: `preview_${++counter}`,
  role,
  body,
  authorName: null,
  citations: [],
  feedback: null,
  createdAt: new Date().toISOString(),
  ...extra,
});

const SOURCE: Citation = {
  slug: 'getting-started/invite-your-team',
  title: 'Invite your team',
  collection: 'getting-started',
};

/** A made-up message from the team, in the shape a support extension offers. */
const proactiveChat = (
  id: string,
  name: string,
  text: string,
  { isAgent = false, replyable = true } = {},
) => ({
  kind: 'chat',
  id,
  sender: { name, avatarUrl: null, isAgent },
  blocks: [{ type: 'text', markdown: text }],
  replyable,
  display: 'bubble',
  triggers: [{ type: 'load' }],
});

const BANNER = {
  id: 'preview_banner',
  kind: 'banner',
  triggers: [{ type: 'load' }],
  banner: {
    position: 'top',
    style: 'inline',
    tone: 'accent',
    sticky: true,
    blocks: [
      { type: 'text', markdown: '**New:** the spring release is out.' },
      { type: 'buttons', buttons: [{ label: 'See what is new', action: 'url', value: '/' }] },
    ],
  },
};

const POPUP = {
  id: 'preview_popup',
  kind: 'modal',
  triggers: [{ type: 'load' }],
  modal: {
    size: 'small',
    slides: [
      {
        blocks: [
          {
            type: 'text',
            markdown: '## Welcome back\n\nHere is what changed since your last visit.',
          },
          {
            type: 'buttons',
            buttons: [
              { label: 'Take a look', action: 'url', value: '/' },
              { label: 'Not now', action: 'dismiss', style: 'secondary' },
            ],
          },
        ],
      },
    ],
  },
};

export function createPreview(host: PreviewHost): WidgetPreview {
  const { store } = host;
  let current: PreviewStateId | null = null;
  /** The widget as it was before the first state, put back on reset. */
  let baseline: Partial<State> | null = null;
  let proactive: Proactive | null = null;
  let engage: PreviewController | null = null;
  /** Each `show` takes a number: one that is no longer the latest stops drawing. */
  let turn = 0;

  const begin = () => {
    if (baseline) return;
    const state = store.state;
    baseline = Object.fromEntries(TOUCHED.map((key) => [key, state[key]])) as Partial<State>;
    host.suspendLive();
    // The launcher's badge is the one thing shown: not the changelog's count on top of it.
    const config = state.config;
    if (config && config.changelog.notification !== 'none')
      store.set({
        config: { ...config, changelog: { ...config.changelog, notification: 'none' } },
      });
  };

  const clear = () => {
    proactive?.destroy();
    proactive = null;
    engage?.destroy();
    engage = null;
    store.set({ ...CLEAN });
  };

  /** The bubbles' own styles, for a widget whose config carries no support extension. */
  const styles = () => {
    const root = host.root();
    if (!root || root.querySelector('style[data-preview]')) return;
    const style = document.createElement('style');
    style.dataset.preview = 'true';
    style.textContent = PROACTIVE_CSS;
    root.appendChild(style);
  };

  /** Bubbles by the launcher, drawn by the real ones, from a list that never leaves the page. */
  const bubbles = (items: unknown[]) => {
    const root = host.root();
    if (!root) return;
    styles();
    const api = {
      proactive: () => Promise.resolve({ items, fields: {} }),
      proactiveEvent: () => Promise.resolve(),
    } as unknown as Api;
    proactive = mountProactive({
      api,
      store,
      container: root,
      open: (view) => host.open(view),
      path: () => '/',
    });
  };

  /** A thread shows its newest message, as it does when one arrives for a visitor. */
  const showNewest = async (mine: number) => {
    await wait(150);
    if (mine !== turn) return;
    const body = host.root()?.querySelector<HTMLElement>('.panel__body');
    if (body) body.scrollTop = body.scrollHeight;
  };

  const draw: Record<PreviewStateId, (options: PreviewShowOptions, mine: number) => Promise<void>> =
    {
      async launcher() {
        // Closed, on Home, nothing by the launcher: what clear() left.
      },

      async badge({ count }) {
        const n = Number.isFinite(count) ? Math.max(1, Math.floor(count as number)) : 1;
        store.set({ proactiveUnread: n });
      },

      async opening(_options, mine) {
        // Closed first, so the opening is seen from the start every time.
        await frame();
        await frame();
        if (mine === turn) host.open();
      },

      async teammate(_options, mine) {
        store.set({
          messages: [message('customer', 'Can you change the email address on my invoice?')],
        });
        host.open(CHAT);
        await wait(ARRIVAL_MS);
        if (mine !== turn) return;
        store.set((state) => ({
          messages: [
            ...state.messages,
            message(
              'human',
              'Hi, Sam here. I have updated the email on your invoice. Anything else I can help with?',
              { authorName: 'Sam' },
            ),
          ],
        }));
        await showNewest(mine);
      },

      async stacked() {
        // Notes with no reply box, so three fit above the launcher, as they do for a visitor.
        const note = { replyable: false };
        bubbles([
          proactiveChat(
            'preview_stack_1',
            'Sam',
            'Welcome! Ask me anything about your plan.',
            note,
          ),
          proactiveChat(
            'preview_stack_2',
            'Priya',
            'Our docs now cover exporting your data.',
            note,
          ),
          proactiveChat(
            'preview_stack_3',
            'Support agent',
            'I can answer questions about your account any time.',
            { ...note, isAgent: true },
          ),
        ]);
      },

      async proactive() {
        bubbles([
          proactiveChat(
            'preview_bubble',
            'Sam',
            'Hi there! Stuck on setup? I am happy to walk you through it.',
          ),
        ]);
      },

      async answer(_options, mine) {
        const question = message('customer', 'How do I invite a teammate?');
        store.set({
          messages: [
            question,
            message(
              'agent',
              'Open **Settings**, choose **Team**, then **Invite**. Enter their email and pick a role. They get an invitation straight away.',
              { citations: [SOURCE] },
            ),
          ],
        });
        host.open(CHAT);
        await showNewest(mine);
      },

      async email(_options, mine) {
        const asked = message(
          'agent',
          'I could not find that in our docs. Leave your email and the team will follow up.',
          { unresolved: true },
        );
        store.set({
          messages: [message('customer', 'Can I get a refund for last month?'), asked],
          emailAsk: {
            messageId: asked.id,
            reason: 'If you leave this page, we will email the reply to this address.',
          },
        });
        host.open(CHAT);
        await showNewest(mine);
      },

      async banner() {
        engage = mountPreview({ onAction() {} });
        engage.render(BANNER, { accent: store.state.config?.widget.appearance.accent });
      },

      async popup() {
        engage = mountPreview({ onAction() {} });
        engage.render(POPUP, { accent: store.state.config?.widget.appearance.accent });
      },
    };

  return {
    states: PREVIEW_STATES,
    get current() {
      return current;
    },

    async show(id, options = {}) {
      if (!PREVIEW_STATES.some((state) => state.id === id)) return false;
      const mine = ++turn;
      const wasOpen = store.state.open;
      begin();
      current = null;
      clear();
      // A panel that was open closes before it opens again, so a replay is a replay.
      if (id === 'opening' && wasOpen) await wait(CLOSE_MS);
      if (mine !== turn) return false;
      await draw[id as PreviewStateId](options, mine);
      if (mine !== turn) return false;
      current = id as PreviewStateId;
      return true;
    },

    reset() {
      turn++;
      current = null;
      if (!baseline) return;
      clear();
      store.set({ ...baseline });
      baseline = null;
      host.resumeLive();
    },

    destroy() {
      turn++;
      current = null;
      proactive?.destroy();
      proactive = null;
      engage?.destroy();
      engage = null;
      baseline = null;
    },
  };
}
