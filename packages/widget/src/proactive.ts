/**
 * Proactive messages: what a support extension wants this visitor to see
 * without being asked.
 *
 * The open-source build sends nothing on its own. When a support extension
 * says it has something (`/config` carries `support.proactive`), the widget
 * pulls it: when the page loads, when a single-page app changes route, and
 * once a minute while the page is visible. It says what `GET /engage` is told
 * about the visit (referrer, UTM, device, language), so the extension can aim
 * as Settings engagements do. Two kinds come back:
 *
 *   - chat messages, from a teammate or the agent. Each appears when its
 *     trigger fires (page load unless it says otherwise: a delay, scroll
 *     depth, exit intent...), either as an incoming bubble above the
 *     launcher with the sender's avatar (the bare mark for the agent) and a
 *     count on the launcher, or, with `display: 'messenger'`, by opening the
 *     widget's panel on a chat holding it. Opening one starts a chat with the
 *     message already in it; the visitor's first reply goes out with its
 *     `proactiveId`, so the extension knows what it answers. A quick-reply
 *     button sends its words as that first reply;
 *   - engagements (a pop-up, a banner, a tour), handed to the one engage
 *     controller through `presentEngagement`, where they take turns with
 *     Settings engagements under the same global cap.
 *
 * `{{field}}` placeholders are filled with the values the server sent, as
 * text (engage/personalize.ts). What the visitor does is reported back: seen
 * when a message is on screen, clicked when they open it or press one of its
 * buttons, dismissed when they close it. The server passes each on to the
 * extension once. Nothing here ever throws at the host page: a failed
 * request means nothing to show.
 */

import type { Api } from './api.js';
import { h, replace, svg } from './dom.js';
import { trigger as normalizeTrigger } from './engage/normalize.js';
import { type Fields, fieldsFrom, fillText, fillTokens, tokenize } from './engage/personalize.js';
import { armTrigger, EventHub } from './engage/triggers.js';
import type { Trigger } from './engage/types.js';
import { visitParams } from './engage/visit.js';
import { icons, widgetMark } from './icons.js';
import { renderRich, safeMediaUrl } from './media.js';
import { safeAccent, safeHttpUrl } from './sanitize.js';
import type { ChatMessage, Store, View } from './state.js';

/** How often the widget asks while the page is visible. */
export const PROACTIVE_POLL_MS = 60_000;
/** The most bubbles stacked by the launcher at once. */
const MAX_BUBBLES = 3;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

type ButtonAction = 'url' | 'dismiss' | 'chat' | 'article' | 'tour' | 'reply';
type Button = { label: string; action: ButtonAction; value: string; newTab: boolean };
const ACTIONS: readonly string[] = ['url', 'dismiss', 'chat', 'article', 'tour', 'reply'];

type ChatBlock =
  | { type: 'text'; markdown: string }
  | { type: 'image'; url: string; alt: string }
  | { type: 'gif'; url: string; alt: string }
  | { type: 'video'; url: string; title: string }
  | { type: 'buttons'; buttons: Button[] }
  | { type: 'divider' };

export interface ProactiveChat {
  kind: 'chat';
  id: string;
  sender: { name: string; avatarUrl: string | null; isAgent: boolean };
  blocks: ChatBlock[];
  replyable: boolean;
  /** A bubble by the launcher, or the panel opened on it. */
  display: 'bubble' | 'messenger';
  /** When it appears: whichever fires first. */
  triggers: Trigger[];
}

export interface ProactiveEngagement {
  kind: 'engagement';
  id: string;
  /** In the widget's engage format, to be checked by the engage renderer. */
  engagement: unknown;
}

export interface ProactiveHost {
  api: Api;
  store: Store;
  /** Where the bubbles go: the widget's shadow root, beside the launcher. */
  container: ShadowRoot | HTMLElement;
  open(view: View): void;
  /**
   * Hand an engagement, and the values for its placeholders, to the engage
   * controller. Absent: engagements are skipped.
   */
  presentEngagement?(item: ProactiveEngagement, fields: Fields): void;
  /** Start one of the install's tours by id, for a "Show me" button. */
  showEngagement?(id: string): void;
  path?(): string;
}

export interface Proactive {
  /** The page moved on: ask again for the new path. */
  refresh(): void;
  /** `helpwell('track', name)`: fire chat triggers waiting for that event. */
  event(name: string): void;
  destroy(): void;
}

/* ---------------------------------------------------------- browser id */

const BROWSER_KEY = 'hw:anon';
let memoryId: string | null = null;

/**
 * A random id for this browser, so a returning visitor can be recognised
 * before HelpWell has a contact for them. Kept in local storage when the page
 * allows it, in memory when it does not. Made up here; never derived from
 * anything about the visitor.
 */
export function browserId(): string {
  try {
    const existing = localStorage.getItem(BROWSER_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = randomId();
    localStorage.setItem(BROWSER_KEY, id);
    return id;
  } catch {
    memoryId ??= randomId();
    return memoryId;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `b_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

/* ------------------------------------------------------------- parsing */

/** Items as the widget can trust them. Anything else in the list is skipped. */
export function parseProactiveItems(raw: unknown): (ProactiveChat | ProactiveEngagement)[] {
  if (!Array.isArray(raw)) return [];
  const out: (ProactiveChat | ProactiveEngagement)[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !ID.test(entry.id)) continue;
    if (entry.kind === 'engagement' && isRecord(entry.engagement)) {
      out.push({ kind: 'engagement', id: entry.id, engagement: entry.engagement });
      continue;
    }
    if (entry.kind !== 'chat' || !isRecord(entry.sender)) continue;
    const name = typeof entry.sender.name === 'string' ? entry.sender.name.trim().slice(0, 60) : '';
    const blocks = Array.isArray(entry.blocks) ? entry.blocks.flatMap(chatBlock) : [];
    if (!name || blocks.length === 0) continue;
    const triggers = (Array.isArray(entry.triggers) ? entry.triggers : [])
      .filter(isRecord)
      .slice(0, 5)
      .map(normalizeTrigger)
      .filter((t) => t.type !== 'manual');
    out.push({
      kind: 'chat',
      id: entry.id,
      sender: {
        name,
        avatarUrl:
          typeof entry.sender.avatarUrl === 'string' ? safeHttpUrl(entry.sender.avatarUrl) : null,
        isAgent: entry.sender.isAgent === true,
      },
      blocks,
      replyable: entry.replyable === true,
      display: entry.display === 'messenger' ? 'messenger' : 'bubble',
      triggers: triggers.length > 0 ? triggers : [{ type: 'load' }],
    });
  }
  return out;
}

function chatBlock(raw: unknown): ChatBlock[] {
  if (!isRecord(raw)) return [];
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  switch (raw.type) {
    case 'text':
      return text('markdown').trim() ? [{ type: 'text', markdown: text('markdown') }] : [];
    case 'image':
    case 'gif':
      return safeMediaUrl(text('url'))
        ? [{ type: raw.type, url: text('url'), alt: text('alt') }]
        : [];
    case 'video':
      return text('url') ? [{ type: 'video', url: text('url'), title: text('title') }] : [];
    case 'divider':
      return [{ type: 'divider' }];
    case 'buttons': {
      const buttons = (Array.isArray(raw.buttons) ? raw.buttons : [])
        .filter(isRecord)
        .map((b) => ({
          label: typeof b.label === 'string' ? b.label.trim().slice(0, 60) : '',
          action: (typeof b.action === 'string' && ACTIONS.includes(b.action)
            ? b.action
            : 'url') as ButtonAction,
          value: typeof b.value === 'string' ? b.value : '',
          newTab: b.newTab === true,
        }))
        .filter((b) => b.label);
      return buttons.length > 0 ? [{ type: 'buttons', buttons: buttons.slice(0, 3) }] : [];
    }
    default:
      return [];
  }
}

/** The message as Markdown: the bubble's body, and the chat's first message. */
export function chatMarkdown(blocks: readonly ChatBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.markdown.trim());
    else if (block.type === 'image' || block.type === 'gif')
      parts.push(`![${block.alt.replace(/[[\]]/g, '')}](${block.url})`);
    else if (block.type === 'video')
      parts.push(`![${block.title.replace(/[[\]]/g, '')}](${block.url})`);
    else if (block.type === 'divider') parts.push('---');
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * How the opened message sits in the chat until the conversation has its own
 * copy. The chat draws it as Markdown, so the visitor's details go in with
 * the characters that would make Markdown of them taken out, as the server
 * does when it stores it.
 */
export function openerMessage(item: ProactiveChat, fields: Fields = {}): ChatMessage {
  const plain: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    plain[key] = value.replace(/[\\`*_[\]()<>#|!~]/g, '');
  }
  const markdown = chatMarkdown(item.blocks.filter((b) => b.type !== 'divider'));
  return {
    id: `proactive_${item.id}`,
    role: item.sender.isAgent ? 'agent' : 'human',
    authorName: item.sender.isAgent ? null : item.sender.name,
    body: fillText(markdown, plain).replace(/\{\{[^{}]*\}\}/g, ''),
    citations: [],
    feedback: null,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------ mounting */

export function mountProactive(host: ProactiveHost): Proactive {
  const { api, store } = host;
  const stack = h('div', { class: 'pro-stack', role: 'region', 'aria-label': 'Messages for you' });
  host.container.appendChild(stack);

  /** Bubbles on screen, in the order they appeared. */
  const bubbles = new Map<string, { item: ProactiveChat; el: HTMLElement }>();
  /** Messages whose triggers are armed on this page, waiting to appear. */
  const armed = new Map<string, () => void>();
  /** Closed or opened on this page: not drawn again, whatever the next answer says. */
  const closed = new Set<string>();
  /** Reported seen on this page. */
  const seen = new Set<string>();
  /** Engagements already handed over on this page. */
  const presented = new Set<string>();
  const events = new EventHub();
  let fields: Record<string, string> = {};
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastLoad = 0;
  let stopped = false;

  const anon = browserId();
  const path = () => host.path?.() ?? location.pathname + location.search;
  const report = (id: string, event: 'seen' | 'clicked' | 'dismissed') => {
    void api.proactiveEvent(id, event, anon).catch(() => {
      // A lost event costs a count somewhere, never the visitor anything.
    });
  };

  const sync = () => {
    const open = store.state.open;
    stack.hidden = open || bubbles.size === 0;
    if (store.state.proactiveUnread !== bubbles.size) store.set({ proactiveUnread: bubbles.size });
    if (!open && document.visibilityState !== 'hidden') {
      for (const id of bubbles.keys()) {
        if (seen.has(id)) continue;
        seen.add(id);
        report(id, 'seen');
      }
    }
  };

  const disarm = (id: string) => {
    armed.get(id)?.();
    armed.delete(id);
  };

  const remove = (id: string) => {
    closed.add(id);
    disarm(id);
    const bubble = bubbles.get(id);
    bubbles.delete(id);
    bubble?.el.remove();
    sync();
  };

  /**
   * A fresh conversation with the message already in it, on screen. The
   * first reply carries its id; `reply`, when given, is sent as that reply.
   */
  const startChat = (item: ProactiveChat, reply?: string) => {
    remove(item.id);
    store.set({
      conversationId: null,
      messages: [openerMessage(item, fields)],
      sending: false,
      emailAsk: null,
      botVerified: false,
      proactiveId: item.replyable ? item.id : null,
      outbox: reply?.trim() ? reply.trim().slice(0, 2000) : null,
    });
    host.open({ name: 'chat', conversationId: null });
  };

  const openChat = (item: ProactiveChat, reply?: string) => {
    report(item.id, 'clicked');
    startChat(item, reply);
  };

  const press = (item: ProactiveChat, button: Button) => {
    switch (button.action) {
      case 'dismiss':
        report(item.id, 'dismissed');
        remove(item.id);
        return;
      case 'chat':
        openChat(item);
        return;
      case 'reply':
        // A quick reply: the visitor's first words, sent for them.
        openChat(item, fillText(button.value || button.label, fields));
        return;
    }
    report(item.id, 'clicked');
    remove(item.id);
    if (button.action === 'article' && button.value) {
      host.open({ name: 'article', slug: button.value, from: { name: 'help' } });
    } else if (button.action === 'tour' && button.value) {
      host.showEngagement?.(button.value);
    } else if (button.action === 'url') {
      const href = safeHttpUrl(button.value);
      if (!href) return;
      if (button.newTab) window.open(href, '_blank', 'noopener');
      else location.assign(href);
    }
  };

  const draw = (item: ProactiveChat): HTMLElement => {
    const accent = safeAccent(store.state.config?.widget.appearance.accent);
    const avatar = h('span', { class: 'pro-avatar', 'aria-hidden': 'true' });
    if (item.sender.avatarUrl) {
      avatar.appendChild(
        h('img', { src: item.sender.avatarUrl, alt: '', width: '32', height: '32' }),
      );
    } else if (item.sender.isAgent) {
      // The agent is the mark itself, never set in a circle.
      avatar.classList.add('pro-avatar--mark');
      avatar.appendChild(svg(widgetMark(accent)));
    } else {
      avatar.classList.add('pro-avatar--initials');
      avatar.textContent = initials(item.sender.name);
    }

    const close = h('button', {
      type: 'button',
      class: 'pro-bubble__close',
      'aria-label': `Dismiss the message from ${item.sender.name}`,
    });
    close.appendChild(svg(icons.close));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      report(item.id, 'dismissed');
      remove(item.id);
    });

    const body = h('div', { class: 'pro-bubble__body' });
    const { markdown, values } = tokenize(
      chatMarkdown(item.blocks.filter((b) => b.type !== 'buttons')),
      fields,
    );
    if (markdown) {
      const drawn = renderRich(markdown, {
        inlineVideo: store.state.config?.widget.media?.inlineVideo === true,
      });
      // The visitor's own details, as text: never Markdown.
      if (values.length > 0) fillTokens(drawn, values);
      body.appendChild(drawn);
    }

    const actions = h('div', { class: 'pro-bubble__actions' });
    for (const block of item.blocks) {
      if (block.type !== 'buttons') continue;
      for (const button of block.buttons) {
        if (button.action === 'tour' && !host.showEngagement) continue;
        actions.appendChild(
          h('button', {
            type: 'button',
            class: `pro-button${button.action === 'reply' ? ' pro-button--quick' : ''}`,
            text: fillText(button.label, fields),
            on: {
              click: (event: Event) => {
                event.stopPropagation();
                press(item, button);
              },
            },
          }),
        );
      }
    }
    const quick = item.blocks.some(
      (b) => b.type === 'buttons' && b.buttons.some((button) => button.action === 'reply'),
    );
    let reply: HTMLFormElement | null = null;
    if (item.replyable) {
      const input = h('input', {
        type: 'text',
        maxlength: '2000',
        placeholder: `Reply to ${item.sender.name}…`,
        'aria-label': `Reply to ${item.sender.name}`,
      });
      const send = h('button', {
        type: 'submit',
        class: `pro-reply__send${quick ? '' : ' pro-button--reply'}`,
        'aria-label': 'Reply',
      });
      send.appendChild(svg(icons.send));
      reply = h('form', { class: 'pro-reply' }, input, send);
      reply.addEventListener('click', (event) => event.stopPropagation());
      reply.addEventListener('submit', (event) => {
        event.preventDefault();
        openChat(item, input.value);
      });
    }

    const bubble = h(
      'div',
      {
        class: `pro-bubble${item.replyable ? ' pro-bubble--replyable' : ''}`,
        'data-proactive': item.id,
        role: 'group',
        'aria-label': `Message from ${item.sender.name}`,
      },
      close,
      h(
        'div',
        { class: 'pro-bubble__head' },
        avatar,
        h(
          'div',
          { class: 'pro-bubble__who' },
          h('span', { class: 'pro-bubble__name', text: item.sender.name }),
          h('span', {
            class: 'pro-bubble__sub',
            text: item.sender.isAgent ? 'AI assistant' : 'From the team',
          }),
        ),
      ),
      body,
      actions.childElementCount > 0 ? actions : null,
      reply,
    );
    // The whole bubble opens the chat when it takes a reply, the way a
    // message preview does; links inside it still go where they point.
    if (item.replyable) {
      bubble.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest?.('a, button, input, form')) return;
        openChat(item);
      });
    }
    return bubble;
  };

  /** Its trigger fired: a bubble by the launcher, or the panel opened on it. */
  const appear = (item: ProactiveChat) => {
    armed.delete(item.id);
    if (stopped || closed.has(item.id) || bubbles.has(item.id)) return;
    // The messenger opens the panel for it, unless the visitor is already in
    // the panel: then it waits there as a bubble, as a message would.
    if (item.display === 'messenger' && !store.state.open) {
      seen.add(item.id);
      report(item.id, 'seen');
      startChat(item);
      return;
    }
    if (bubbles.size >= MAX_BUBBLES) return;
    bubbles.set(item.id, { item, el: draw(item) });
    replace(stack, ...[...bubbles.values()].map((b) => b.el));
    sync();
  };

  const apply = (items: (ProactiveChat | ProactiveEngagement)[]) => {
    const chats = items
      .filter((item): item is ProactiveChat => item.kind === 'chat' && !closed.has(item.id))
      .slice(0, MAX_BUBBLES);
    const wanted = new Set(chats.map((item) => item.id));
    // Gone from the extension's answer: gone from the page, and not waiting.
    for (const id of [...bubbles.keys()]) {
      if (!wanted.has(id)) {
        bubbles.get(id)?.el.remove();
        bubbles.delete(id);
      }
    }
    for (const id of [...armed.keys()]) if (!wanted.has(id)) disarm(id);
    replace(stack, ...[...bubbles.values()].map((b) => b.el));

    for (const item of chats) {
      if (bubbles.has(item.id) || armed.has(item.id)) continue;
      // Whichever trigger fires first shows it, and takes the others down.
      let fired = false;
      const off: (() => void)[] = [];
      const fire = () => {
        if (fired) return;
        fired = true;
        for (const stop of off) stop();
        appear(item);
      };
      armed.set(item.id, () => {
        for (const stop of off) stop();
      });
      for (const trigger of item.triggers) off.push(armTrigger(trigger, fire, { events }));
    }
    sync();

    for (const item of items) {
      if (item.kind !== 'engagement' || presented.has(item.id) || closed.has(item.id)) continue;
      presented.add(item.id);
      try {
        host.presentEngagement?.(item, fields);
      } catch {
        // Engage is additive; one that cannot be drawn is simply not drawn.
      }
    }
  };

  const load = () => {
    if (stopped) return;
    request?.abort();
    const mine = new AbortController();
    request = mine;
    lastLoad = Date.now();
    const visit = visitParams();
    visit.delete('path');
    void api
      .proactive(path(), anon, mine.signal, visit)
      .then((result) => {
        if (stopped || mine.signal.aborted) return;
        fields = { ...fields, ...fieldsFrom(result?.fields) };
        apply(parseProactiveItems(result?.items));
      })
      .catch(() => {
        // Nothing to show is the answer to every failure.
      })
      .finally(() => {
        if (request === mine) request = null;
      });
  };

  const schedule = () => {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => {
      if (document.visibilityState !== 'hidden') load();
      schedule();
    }, PROACTIVE_POLL_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') return;
    sync();
    if (Date.now() - lastLoad >= PROACTIVE_POLL_MS) {
      load();
      schedule();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = store.subscribe((state) => {
    // Bubbles make way for the panel, and come back when it closes.
    const hidden = state.open || bubbles.size === 0;
    if (stack.hidden !== hidden) sync();
  });

  load();
  schedule();

  return {
    refresh() {
      if (stopped) return;
      // Triggers and engagements are per page, like Settings ones: what was
      // armed here goes (the engage controller drops its own), and the next
      // answer arms again whatever has not been shown.
      for (const id of [...armed.keys()]) disarm(id);
      presented.clear();
      load();
      schedule();
    },
    event(name) {
      if (!stopped && name) events.emit(name);
    },
    destroy() {
      stopped = true;
      clearTimeout(timer);
      request?.abort();
      for (const id of [...armed.keys()]) disarm(id);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      stack.remove();
      bubbles.clear();
      if (store.state.proactiveUnread !== 0) store.set({ proactiveUnread: 0 });
    },
  };
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts)
    .map((part) => part?.[0] ?? '')
    .join('');
  return letters.toUpperCase().slice(0, 2) || '?';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
