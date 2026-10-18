/**
 * The chat view.
 *
 * Renders the thread, the composer, and the three things that can go wrong:
 * the network being down, a limit being hit, and the agent not knowing the
 * answer. Each of those is a visible, recoverable state rather than a spinner
 * that never resolves.
 *
 * Three things only exist when something switches them on:
 *   - the email card (email-card.ts), when the agent asks for an address, the
 *     pre-chat form is set to ask after the first answer, or a support
 *     extension's notice asks;
 *   - the bot check (turnstile.ts), when `/config` carries a site key: the
 *     first message of a conversation waits for a token;
 *   - live human support, when a support extension is installed: the thread
 *     polls (live.ts), shows who is typing and what they have read, and can
 *     take attachments if the extension stores them.
 *
 * Without an extension, an answer the agent could not give is followed by a
 * quiet "Email us at …" line when Settings has a support email
 * (support-email.ts). Nobody is waiting in HelpWell to read a reply, so that
 * is where a person can be reached. Which answers those are is the server's
 * call, carried on each answer (`unresolved`, `smallTalk`), both as it
 * arrives and when the thread is reloaded: the latest answer to a real
 * question, when the docs did not cover it, the agent flagged it or no model
 * answered. Never for small talk, and never because the conversation as a
 * whole has not been resolved yet.
 */

import {
  ApiError,
  type Attachment,
  type ChatReply,
  type Citation,
  type ConversationThread,
  type Presence,
  type UploadPolicy,
} from '../api.js';
import type { ViewContext } from '../context.js';
import { h, replace } from '../dom.js';
import { activityClock, FAST_POLL_MS, IDLE_POLL_MS, poller, typingSender } from '../live.js';
import { renderRich } from '../media.js';
import type { ChatMessage, State } from '../state.js';
import { humanCheck } from '../turnstile.js';
import { agentAvatar } from './agent.js';
import { attachmentList, uploader } from './attachments.js';
import { empty, iconEl, notice } from './common.js';
import { emailCard } from './email-card.js';
import { preChatForm } from './prechat.js';
import { supportEmailLine, supportEmailOf } from './support-email.js';

/** How close to the newest message still counts as being at it, in pixels. */
const NEAR_END = 48;
/** The room left above a long answer brought into view, below the header. */
const ANSWER_GAP = 12;

/** What the composer calls back into the view with. */
interface ComposerHandlers {
  send: (text: string) => Promise<void>;
  /** The draft changed: `true` while there is something in it. */
  drafting: (hasText: boolean) => void;
}

export function chatView(context: ViewContext): HTMLElement {
  const { store, api, signal } = context;
  const config = store.state.config;
  const support = config?.support;

  const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite' });
  const bannerSlot = h('div', {});
  const handoffSlot = h('div', { class: 'handoff' });
  // Where Turnstile draws itself, in the rare case it needs a click.
  const challengeSlot = h('div', { class: 'challenge', 'data-challenge': 'idle' });
  // Back to the newest message, once the visitor has scrolled up from it. A
  // strip of its own between the thread and the composer, never laid over
  // the thread: nothing in it, the email card's field least of all, can end
  // up underneath.
  const jumpButton = h(
    'button',
    { type: 'button', class: 'jumpLatest__button', on: { click: () => scrollToEnd() } },
    iconEl('arrowDown'),
    'Jump to latest',
  );
  const jumpLatest = h('div', { class: 'jumpLatest', hidden: true }, jumpButton);
  const body = h('div', { class: 'panel__body' }, bannerSlot, thread);
  body.addEventListener('scroll', () => syncJump(), { passive: true });
  const wrap = h('div', { class: 'page', style: { display: 'contents' } });

  /* ------------------------------------------------------------ bot check */

  const check = config?.botCheck?.siteKey
    ? humanCheck(config.botCheck.siteKey, challengeSlot)
    : null;
  signal.addEventListener('abort', () => check?.destroy(), { once: true });

  /**
   * A token when `conversationId` still has to prove a person is there: a new
   * conversation, or one that never passed. `force` asks for a fresh one
   * after the server refused the last.
   */
  async function humanToken(
    conversationId: string | null = store.state.conversationId,
    force = false,
  ): Promise<string | undefined> {
    if (!check) return undefined;
    if (!force && conversationId && store.state.botVerified) return undefined;
    try {
      return await check.token();
    } catch {
      throw new ApiError(0, 'human_check', 'We could not confirm you are human. Please try again.');
    }
  }

  /* ---------------------------------------------------------- attachments */

  /** From the thread when it has said; otherwise from the config. */
  let threadUploads: UploadPolicy | null | undefined;
  const files = uploader({
    upload: (file, onProgress) => {
      const id = store.state.conversationId;
      if (!id) return Promise.reject(new ApiError(0, 'no_conversation', 'Send a message first.'));
      return api.upload(id, file, { onProgress, signal });
    },
    onUploaded: (attachment) => addAttachment(attachment),
    signal,
  });
  function uploadPolicy(): UploadPolicy | null {
    if (!store.state.conversationId) return null;
    return (threadUploads !== undefined ? threadUploads : support?.uploads) ?? null;
  }

  function addAttachment(attachment: Attachment): void {
    const local: ChatMessage = {
      id: `local_${Date.now()}`,
      role: 'customer',
      body: '',
      citations: [],
      feedback: null,
      createdAt: new Date().toISOString(),
      attachments: [attachment],
    };
    store.set((state) => ({ messages: [...state.messages, local] }));
    scrollToEnd();
    void refresh();
  }

  /* ------------------------------------------------------------- composer */

  function buildComposer(handlers: ComposerHandlers): {
    el: HTMLElement;
    input: HTMLTextAreaElement;
    honeypot: () => string;
    clear: () => void;
  } {
    const input = h('textarea', {
      rows: '1',
      placeholder: 'Ask a question…',
      'aria-label': 'Your message',
    });

    // A field a person never sees and a naive bot always fills (AB-04).
    const trap = h('input', {
      class: 'honeypot',
      tabindex: '-1',
      autocomplete: 'off',
      'aria-hidden': 'true',
    });

    const button = h('button', {
      class: 'composer__send',
      type: 'button',
      'aria-label': 'Send',
      disabled: true,
    });
    button.appendChild(iconEl('send'));

    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
      button.toggleAttribute('disabled', input.value.trim().length === 0);
    };

    const clear = () => {
      input.value = '';
      grow();
    };

    const submit = () => {
      const text = input.value;
      if (!text.trim()) return;
      clear();
      void handlers.send(text);
    };

    input.addEventListener('input', () => {
      grow();
      handlers.drafting(input.value.trim().length > 0);
    });
    input.addEventListener('keydown', (event) => {
      // Enter sends. Shift+Enter is a newline, which is what people expect.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    button.addEventListener('click', submit);

    const el = h(
      'div',
      {},
      challengeSlot,
      files.strip,
      h('div', { class: 'composer' }, trap, files.button, input, button),
    );

    return { el, input, honeypot: () => trap.value, clear };
  }

  /* ------------------------------------------------------------ email card */

  const composer = buildComposer({ send, drafting });
  const card = emailCard({
    context,
    reason: () => store.state.emailAsk?.reason,
    honeypot: () => composer.honeypot(),
    humanToken: (force) => humanToken(store.state.conversationId, force),
  });

  /* ------------------------------------------------------------ live state */

  /** True while a person, not the agent, has the conversation. */
  let humanMode = false;
  let presence: Presence | null = null;
  /** True while an existing conversation is being fetched. */
  let loading = false;
  let refreshing = false;

  const activity = activityClock(wrap, signal);
  const typing = support?.typing
    ? typingSender(async (isTyping) => {
        const id = store.state.conversationId;
        if (id && humanMode) await api.typing(id, isTyping);
      })
    : null;
  signal.addEventListener('abort', () => typing?.stop(), { once: true });

  function drafting(hasText: boolean): void {
    if (humanMode && store.state.conversationId) typing?.update(hasText);
  }

  // Polling only happens with an extension: without one no person can answer.
  // In human mode it is fast while the panel is in use; otherwise it checks
  // now and then, so a teammate taking the thread over still shows up.
  const live = support
    ? poller({
        signal,
        interval: () =>
          humanMode &&
          store.state.open &&
          store.state.view.name === 'chat' &&
          document.hasFocus() &&
          activity.active()
            ? FAST_POLL_MS
            : IDLE_POLL_MS,
        tick: async () => {
          await refresh();
          if (humanMode) await refreshPresence();
        },
      })
    : null;

  /* ---------------------------------------------------------- read receipts */

  let markingSeen = false;
  let seenConversationId: string | null = null;
  const markedIds = new Set<string>();
  async function markVisibleReplies(): Promise<void> {
    const id = store.state.conversationId;
    if (
      !id ||
      signal.aborted ||
      loading ||
      markingSeen ||
      !thread.isConnected ||
      !store.state.open ||
      store.state.view.name !== 'chat' ||
      document.visibilityState === 'hidden'
    )
      return;
    if (seenConversationId !== id) {
      markedIds.clear();
      seenConversationId = id;
    }
    const ids = store.state.messages
      .filter((message) => message.role === 'human' && !markedIds.has(message.id))
      .slice(0, 100)
      .map((message) => message.id);
    if (!ids.length) return;
    markingSeen = true;
    let success = false;
    try {
      await api.seen(id, ids, signal);
      if (!signal.aborted && store.state.conversationId === id) {
        for (const messageId of ids) markedIds.add(messageId);
        success = true;
      }
    } catch {
      // The next poll or visibility change retries without marking anything read.
    } finally {
      markingSeen = false;
      if (success) void markVisibleReplies();
    }
  }
  const onVisibility = () => void markVisibleReplies();
  document.addEventListener('visibilitychange', onVisibility);
  signal.addEventListener(
    'abort',
    () => document.removeEventListener('visibilitychange', onVisibility),
    { once: true },
  );

  /* --------------------------------------------------------------- handoff */

  const handoffButton = h('button', {
    type: 'button',
    class: 'handoff__button',
    text: 'Talk to a person',
  });
  handoffButton.addEventListener('click', () => {
    const id = store.state.conversationId;
    if (!id) return;
    handoffButton.disabled = true;
    void api
      .handoff(id)
      .then(() => {
        if (signal.aborted || store.state.conversationId !== id) return;
        humanMode = true;
        setBanner('info', 'The team will reply here. You can keep adding details.');
        live?.poke();
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        // The server's own words when it gave some (the team is unreachable,
        // say); the generic line when the request never got there.
        const said = error instanceof ApiError && error.status > 0 ? error.message : '';
        setBanner('bad', said || 'We could not request a person. Please try again.');
      })
      .finally(() => {
        handoffButton.disabled = humanMode;
      });
  });
  if (support?.human) handoffSlot.appendChild(handoffButton);

  /** Take what the thread says about itself, beyond its messages. */
  function applyThread(conversation: ConversationThread): void {
    humanMode = conversation.mode === 'human';
    if (!humanMode) presence = null;
    handoffButton.textContent = humanMode ? 'Human support requested' : 'Talk to a person';
    handoffButton.disabled = humanMode;
    if (conversation.uploads !== undefined) threadUploads = conversation.uploads;

    const patch: Partial<State> = {};
    if (typeof conversation.botVerified === 'boolean') patch.botVerified = conversation.botVerified;
    if (conversation.emailAsk !== undefined) patch.emailAsk = conversation.emailAsk;
    const contact = conversation.contact;
    if (contact?.identified && !store.state.identified) patch.identified = true;
    if (
      contact &&
      !contact.identified &&
      contact.email &&
      contact.email !== store.state.contact.email
    ) {
      patch.contact = { email: contact.email, name: contact.name };
    }
    if (Object.keys(patch).length > 0) store.set(patch);
  }

  async function refresh(): Promise<void> {
    const id = store.state.conversationId;
    if (!id || signal.aborted || store.state.sending || refreshing || loading) return;
    refreshing = true;
    try {
      const conversation = await api.conversation(id, signal);
      if (signal.aborted || store.state.conversationId !== id || store.state.sending) return;
      applyThread(conversation);
      if (JSON.stringify(store.state.messages) !== JSON.stringify(conversation.messages)) {
        // A reply from a person arrives here. Shown from its start, as the
        // agent's are, unless the visitor has scrolled up to read something
        // else: then they stay where they are, and "Jump to latest" says
        // there is more below.
        const reading = fromEnd() > NEAR_END;
        const known = new Set(store.state.messages.map((m) => m.id));
        const reply = conversation.messages.find(
          (m) => !known.has(m.id) && (m.role === 'agent' || m.role === 'human'),
        );
        store.set({ messages: conversation.messages });
        if (reading) syncJump();
        else if (reply) revealAnswer(reply.id);
        else scrollToEnd();
      } else {
        renderThread();
      }
      void markVisibleReplies();
    } catch {
      /* An intermittent poll never replaces a draft or a visible thread. */
    } finally {
      refreshing = false;
    }
  }

  async function refreshPresence(): Promise<void> {
    const id = store.state.conversationId;
    if (!id || !support?.presence || signal.aborted) return;
    try {
      const next = await api.presence(id, signal);
      if (signal.aborted || store.state.conversationId !== id || !humanMode) return;
      if (JSON.stringify(next) !== JSON.stringify(presence)) {
        presence = next;
        renderThread();
        scrollToEnd();
      }
    } catch {
      // Presence is garnish; the thread itself still updates.
    }
  }

  /* ---------------------------------------------------------------- render */

  // The thread follows the store rather than only its own sends, so a reply
  // that lands after the panel was rebuilt, or a vote made from another view,
  // still shows up. The subscription ends with the view.
  let shown = snapshot(store.state);
  const unsubscribe = store.subscribe((state) => {
    const next = snapshot(state);
    if (next.some((value, index) => value !== shown[index])) renderThread();
    void markVisibleReplies();
  });
  signal.addEventListener('abort', () => unsubscribe(), { once: true });

  function scrollToEnd(): void {
    body.scrollTop = body.scrollHeight;
    syncJump();
  }

  /** How far the visitor is from the newest message, in pixels. */
  function fromEnd(): number {
    return body.scrollHeight - body.clientHeight - body.scrollTop;
  }

  /** "Jump to latest" shows while the newest message is out of sight below. */
  function syncJump(): void {
    jumpLatest.hidden = fromEnd() <= NEAR_END;
  }

  /** Where an element in the thread starts and ends, from the top of the scrolled content. */
  function placeOf(el: HTMLElement): { top: number; bottom: number } {
    const box = el.getBoundingClientRect();
    const origin = body.getBoundingClientRect().top - body.scrollTop;
    return { top: box.top - origin, bottom: box.bottom - origin };
  }

  /** The last thing under `answer` that asks for input, such as the email card. */
  function inputAfter(answer: HTMLElement): HTMLElement | null {
    let found: HTMLElement | null = null;
    for (let el = answer.nextElementSibling; el; el = el.nextElementSibling) {
      if (el instanceof HTMLElement && el.querySelector('input, textarea, select')) found = el;
    }
    return found;
  }

  /**
   * Bring a new answer into view. One that fits is shown whole, with the
   * thread at its end as before. A long one would have its start, and the
   * question above it, scrolled away under the header, so its top goes just
   * below the header instead, and "Jump to latest" leads on to the end. A
   * card under it that asks for something (the email card, after a question
   * the docs could not answer) is the next thing to do, so it is always
   * shown whole: from the answer's top when both fit, otherwise with the
   * card at the foot of the thread.
   */
  function revealAnswer(id: string): void {
    const answer = [...thread.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (el) => el.dataset.messageId === id,
    );
    const top = answer ? placeOf(answer).top : 0;
    if (!answer || body.scrollHeight - top + ANSWER_GAP <= body.clientHeight) {
      scrollToEnd();
      return;
    }
    const card = inputAfter(answer);
    const cardInView = card ? placeOf(card).bottom + ANSWER_GAP - body.clientHeight : 0;
    body.scrollTop = Math.max(0, top - ANSWER_GAP, cardInView);
    syncJump();
  }

  function renderThread(): void {
    const { messages, config, sending } = store.state;
    shown = snapshot(store.state);
    handoffSlot.hidden = !store.state.conversationId;
    files.setPolicy(uploadPolicy());
    replace(thread);

    if (loading) {
      thread.appendChild(threadSkeleton());
      return;
    }

    if (messages.length === 0) {
      thread.appendChild(
        empty(
          'message',
          'Ask us anything',
          `We will look through the ${config?.product.name ?? 'product'} docs and answer.`,
        ),
      );
      return;
    }

    const cardAt = cardAnchor(messages);
    const seenId = seenMessage(messages);
    if (cardAt) card.sync();
    // The way out when the docs fall short, under the latest answer when it
    // left the question open. Never with a support extension: supportEmailOf
    // says null, and the extension's own flow applies.
    const email = sending ? null : supportEmailOf(config);
    const openAt = email ? openAnswer(messages) : null;
    for (const message of messages) {
      thread.appendChild(bubbleFor(message));
      if (message.id === seenId) thread.appendChild(h('p', { class: 'seen', text: 'Seen' }));
      if (message.id === cardAt) thread.appendChild(card.el);
      if (email && message.id === openAt) {
        thread.appendChild(supportEmailLine(email, 'supportEmail--thread'));
      }
    }
    if (presence?.notice) {
      thread.appendChild(notice('info', presence.notice.text));
      if (cardAt === END) thread.appendChild(card.el);
    }
    if (sending) {
      thread.appendChild(h('div', { class: 'agentRow' }, agentAvatar(config, 24), typingBubble()));
    } else if (presence?.typing) thread.appendChild(typingBubble(presence.typing.name));
    void markVisibleReplies();
  }

  /**
   * Where the email card goes, if anywhere: under the agent message that
   * asked; under the first answer when the pre-chat form is set to ask
   * after it; or at the end, under a support extension's notice that asks.
   */
  function cardAnchor(messages: ChatMessage[]): string | null {
    const state = store.state;
    if (state.identified) return null;
    const ask = state.emailAsk;
    if (ask && messages.some((m) => m.id === ask.messageId)) return ask.messageId;
    const preChat = state.config?.widget.preChat;
    if (preChat?.when === 'unknown_only' && preChat.timing === 'after') {
      const first = messages.find(
        (m) => m.role === 'agent' && !m.failed && !m.id.startsWith('proactive_'),
      );
      if (first) return first.id;
    }
    if (presence?.notice?.askEmail) return END;
    return null;
  }

  /** The newest visitor message a teammate has read, to put "Seen" under. */
  function seenMessage(messages: ChatMessage[]): string | null {
    const upTo = presence?.seenUpTo;
    if (!upTo) return null;
    const index = messages.findIndex((m) => m.id === upTo);
    for (let i = index; i >= 0; i--) {
      if (messages[i]?.role === 'customer') return messages[i]!.id;
    }
    return null;
  }

  function showThread(): void {
    replace(wrap, body, jumpLatest, handoffSlot, composer.el);
    files.attach(body, composer.input);
    renderThread();
    // Start at the newest message, the way every chat client does.
    queueMicrotask(scrollToEnd);
    loadIfNeeded();
    // A conversation already on screen: find out straight away whether a
    // person has it, rather than at the first idle poll.
    if (store.state.conversationId && !loading) live?.poke();
  }

  // Opening a conversation the store has not seen — from the Messages tab, or
  // on a fresh page load — has to fetch it before there is anything to show.
  function loadIfNeeded(): void {
    const view = store.state.view;
    const wanted = view.name === 'chat' ? view.conversationId : null;
    if (!wanted || store.state.conversationId === wanted) return;

    loading = true;
    renderThread();
    void api
      .conversation(wanted, signal)
      .then((conversation) => {
        // The signal cancels this when the visitor moves on, so a slow fetch
        // never lands on top of the conversation they switched to.
        if (signal.aborted) return;
        store.set({
          conversationId: conversation.id,
          messages: conversation.messages,
          sending: false,
          emailAsk: null,
          botVerified: false,
        });
        applyThread(conversation);
      })
      .catch(() => {
        if (!signal.aborted) setBanner('bad', 'We could not load that conversation.');
      })
      .finally(() => {
        if (signal.aborted) return;
        loading = false;
        renderThread();
        scrollToEnd();
        if (humanMode) live?.poke();
      });
  }

  function bubbleFor(message: ChatMessage): HTMLElement {
    if (message.role === 'event') {
      return h('div', { class: 'bubble bubble--event', text: message.body });
    }

    const group = h('div', { class: 'msgGroup', 'data-message-id': message.id });
    if (message.role === 'human')
      group.appendChild(
        h('div', {
          class: 'bubble--event',
          text: `${message.authorName || 'Support team'} · Human support`,
        }),
      );

    if (message.body || !message.attachments?.length) {
      const bubble = h('div', {
        class: `bubble bubble--${message.role === 'human' ? 'agent' : message.role}`,
      });
      if (message.role === 'agent' || message.role === 'human') {
        // Replies are rendered through the strict Markdown path and the
        // widget's media rules, never trusted as HTML. Rendered, their line
        // breaks are paragraphs and lists, so the bubble stops keeping the
        // raw ones (styles.ts, `.bubble--rich`).
        bubble.classList.add('bubble--rich');
        bubble.appendChild(
          renderRich(message.body, { inlineVideo: config?.widget.media?.inlineVideo === true }),
        );
      } else {
        bubble.textContent = message.body;
      }
      // The agent's replies carry its avatar, as in any chat client; a
      // person's replies are introduced by name above instead.
      if (message.role === 'agent') {
        group.classList.add('msgGroup--agent');
        group.appendChild(h('div', { class: 'agentRow' }, agentAvatar(config, 24), bubble));
      } else {
        group.appendChild(bubble);
      }
    }

    if (message.attachments?.length) {
      const list = attachmentList(message.attachments);
      if (list) {
        list.classList.add(`attachments--${message.role}`);
        group.appendChild(list);
      }
    }

    if (message.citations?.length) {
      group.appendChild(citationList(context, message.citations));
    }

    if (message.failed) {
      group.appendChild(
        notice('bad', 'That did not send.', () => {
          store.set((state) => ({
            messages: state.messages.filter((m) => m.id !== message.id),
          }));
          void send(message.body, {}, message.requestId);
        }),
      );
    }

    // A proactive message opened from the launcher is only on this screen
    // until the conversation starts; there is nothing yet to vote on.
    if (message.role === 'agent' && !message.failed && !message.id.startsWith('proactive_')) {
      group.appendChild(feedbackRow(context, message));
    }

    return group;
  }

  /* ------------------------------------------------------------------ send */

  async function send(
    text: string,
    extra: { email?: string; name?: string } = {},
    // One id per message the visitor sends, kept through every retry of it,
    // so a support extension never takes the same message twice.
    requestId: string = newRequestId(),
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || store.state.sending) return;
    typing?.update(false);

    const optimistic: ChatMessage = {
      id: `local_${Date.now()}`,
      role: 'customer',
      body: trimmed,
      citations: [],
      feedback: null,
      createdAt: new Date().toISOString(),
      requestId,
    };

    let target = store.state.conversationId;
    // The reply belongs here only while this is still the thread on show. A
    // fresh start, or a switch to another conversation, in the meantime means
    // it is dropped rather than written into the wrong thread.
    const stale = () =>
      !store.state.sending ||
      store.state.conversationId !== target ||
      // Two different visitors can both be waiting for their first reply,
      // with a null conversation id. The pending message must still be ours.
      !store.state.messages.includes(optimistic);
    /** The answer this send got, to bring into view once it is drawn. */
    let answered: string | null = null;

    store.set((state) => ({ messages: [...state.messages, optimistic], sending: true }));
    setBanner(null);
    scrollToEnd();

    // Opened from a proactive message: the conversation it starts is a reply to it.
    const proactiveId = store.state.proactiveId;
    const post = async (conversationId: string | null, force = false) =>
      api.chat({
        message: trimmed,
        conversationId,
        pageUrl: context.path(),
        honeypot: composer.honeypot(),
        ...extra,
        turnstileToken: await humanToken(conversationId, force),
        requestId,
        ...(proactiveId && !conversationId ? { proactiveId } : {}),
      });

    // A refused or expired bot-check token gets one fresh challenge.
    const attempt = async (conversationId: string | null) => {
      try {
        return await post(conversationId);
      } catch (error) {
        if (!(check && error instanceof ApiError && error.needsHumanCheck)) throw error;
        return await post(conversationId, true);
      }
    };

    try {
      let reply: ChatReply;
      try {
        reply = await attempt(target);
      } catch (error) {
        // 403 or 404 on a conversation means it is not ours any more: the
        // cookie changed, or the visitor was reset in another tab. Start a
        // new one, once, rather than fail on every send from here on.
        const lost =
          error instanceof ApiError &&
          (error.status === 403 || error.status === 404) &&
          !error.needsHumanCheck;
        if (!lost || !target || stale()) throw error;
        target = null;
        store.set((state) => ({
          conversationId: null,
          botVerified: false,
          emailAsk: null,
          messages: state.messages.filter((m) => m.id === optimistic.id),
        }));
        reply = await attempt(null);
      }
      if (stale()) return;

      store.set((state) => ({
        conversationId: reply.conversationId,
        sending: false,
        proactiveId: null,
        // The server has marked the conversation; later messages skip the check.
        botVerified: check ? true : state.botVerified,
        emailAsk:
          reply.askForEmail && !state.identified
            ? {
                messageId: reply.messageId,
                ...(reply.askForEmail.reason ? { reason: reply.askForEmail.reason } : {}),
              }
            : state.emailAsk,
        messages: reply.pendingHuman
          ? state.messages
          : [
              ...state.messages,
              {
                id: reply.messageId,
                role: 'agent',
                body: reply.text,
                citations: reply.citations,
                feedback: null,
                createdAt: new Date().toISOString(),
                // An answer the agent could not give offers the support email under it.
                ...(reply.unresolved ? { unresolved: true } : {}),
                ...(reply.smallTalk ? { smallTalk: true } : {}),
              },
            ],
      }));

      if (reply.pendingHuman) {
        humanMode = true;
        setBanner('info', 'Your message is with the support team. Replies will appear here.');
        live?.poke();
        scrollToEnd();
        return;
      }

      if (reply.degraded) {
        setBanner('warn', 'Our assistant is having a moment, so this answer came from the docs.');
      } else {
        setBanner(null);
      }
      answered = reply.messageId;
    } catch (error) {
      if (stale()) return;
      const failure = error instanceof ApiError ? error : null;
      store.set((state) => ({
        sending: false,
        messages: state.messages.map((m) => (m.id === optimistic.id ? { ...m, failed: true } : m)),
      }));
      setBanner(
        'bad',
        failure?.message ?? 'We could not reach support just now.',
        failure?.retryable || failure?.needsHumanCheck
          ? () => {
              store.set((state) => ({
                messages: state.messages.filter((m) => m.id !== optimistic.id),
              }));
              void send(trimmed, extra, requestId);
            }
          : undefined,
      );
    }

    // A new answer is shown from its start; anything else, at the end.
    if (answered) revealAnswer(answered);
    else scrollToEnd();
  }

  function setBanner(kind: 'bad' | 'warn' | 'info' | null, text = '', retry?: () => void): void {
    replace(bannerSlot, kind ? notice(kind, text, retry) : null);
  }

  // Pre-chat: collect what the host app could not tell us, before the first
  // message. With `timing: 'after'` the form is skipped and the email card
  // appears under the first answer instead. Only for a conversation that has
  // not started: one reopened from the Messages tab has no messages in the
  // store until it loads, and belongs on screen, not behind the form.
  const preChat = store.state.config?.widget.preChat;
  const view = store.state.view;
  const reopening = view.name === 'chat' && view.conversationId !== null;
  const needsPreChat =
    preChat?.when === 'unknown_only' &&
    preChat.timing !== 'after' &&
    !store.state.identified &&
    !store.state.preChatDone &&
    !reopening &&
    store.state.messages.length === 0;

  if (needsPreChat && preChat) {
    wrap.appendChild(
      h(
        'div',
        { class: 'panel__body panel__body--padded' },
        preChatForm(preChat, (details) => {
          store.set({
            preChatDone: true,
            ...(details.email
              ? { contact: { email: details.email.toLowerCase(), name: details.name ?? null } }
              : {}),
          });
          // The form and the thread are two states of one view, so the handover
          // happens in place: the composer is on screen before the first
          // message goes, and it goes exactly once.
          showThread();
          if (details.firstMessage) {
            void send(details.firstMessage, { email: details.email, name: details.name });
          }
        }),
      ),
    );
    return wrap;
  }

  showThread();
  // A quick reply pressed on a proactive message goes out as the visitor's
  // first words, once, now the chat is on screen (proactive.ts).
  const queued = store.state.outbox;
  if (queued) {
    store.set({ outbox: null });
    void send(queued);
  }
  return wrap;
}

/** The card's place when it answers a notice rather than a message. */
const END = '__end__';

/** An id for one send: random, and nothing about the visitor. */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** What the thread has to be redrawn for when it changes. */
function snapshot(state: State): unknown[] {
  return [state.messages, state.sending, state.emailAsk, state.contact.email, state.identified];
}

/**
 * The latest answer to a real question, when it left that question open:
 * the one the support email goes under. Replies to small talk are passed
 * over, so "thanks" after an unanswered question leaves the line where it
 * is, and "hi" never earns one; a later question that was answered takes it
 * away. A proactive message is not an answer to anything.
 */
function openAnswer(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (
      message.role !== 'agent' ||
      message.failed ||
      message.smallTalk ||
      message.id.startsWith('proactive_')
    ) {
      continue;
    }
    return message.unresolved ? message.id : null;
  }
  return null;
}

/** The one place chat waits on the network: fetching a conversation. */
function threadSkeleton(): HTMLElement {
  const lines = [72, 58, 84, 46].map((width, index) =>
    h('div', {
      class: `bubble bubble--${index % 2 === 0 ? 'customer' : 'agent'}`,
      style: { width: `${width}%`, height: '38px', background: 'var(--hw-hairline)' },
    }),
  );
  return h('div', { class: 't-skel-skeleton is-pulsing', style: { position: 'static' } }, ...lines);
}

/**
 * Three dots for the eye; a sentence for the screen reader. With a name, it
 * is a teammate typing, and the name is shown.
 */
function typingBubble(name?: string): HTMLElement {
  const label = name ? `${name} is typing…` : 'Writing a reply…';
  return h(
    'div',
    { class: `bubble bubble--agent${name ? ' bubble--typing' : ''}`, role: 'status' },
    name
      ? h('span', { class: 'typing__name', text: label })
      : h('span', { class: 'visuallyHidden', text: label }),
    h('div', { class: 'typing', 'aria-hidden': 'true' }, h('i', {}), h('i', {}), h('i', {})),
  );
}

function citationList(context: ViewContext, citations: Citation[]): HTMLElement {
  const list = h('div', { class: 'citations' });
  for (const citation of citations) {
    const chip = h('button', {
      class: 'citation',
      type: 'button',
      on: {
        click: () => context.go({ name: 'article', slug: citation.slug, from: context.state.view }),
      },
    });
    chip.appendChild(iconEl('article'));
    chip.appendChild(h('span', { text: citation.title }));
    list.appendChild(chip);
  }
  return list;
}

function feedbackRow(context: ViewContext, message: ChatMessage): HTMLElement {
  const row = h('div', { class: 'msgActions' });
  if (message.feedback) row.dataset.voted = 'true';

  const vote = (value: 'helpful' | 'not_helpful') => {
    const next = message.feedback === value ? null : value;
    context.store.set((state) => ({
      messages: state.messages.map((m) => (m.id === message.id ? { ...m, feedback: next } : m)),
    }));
    up.setAttribute('aria-pressed', String(next === 'helpful'));
    down.setAttribute('aria-pressed', String(next === 'not_helpful'));
    row.dataset.voted = next ? 'true' : 'false';
    void context.api.feedback(message.id, next).catch(() => {
      // A lost vote is not worth interrupting the conversation over.
    });
  };

  const up = h('button', {
    class: 'iconBtn',
    type: 'button',
    'aria-label': 'This helped',
    'aria-pressed': String(message.feedback === 'helpful'),
    on: { click: () => vote('helpful') },
  });
  up.appendChild(iconEl('thumbUp'));

  const down = h('button', {
    class: 'iconBtn',
    type: 'button',
    'aria-label': 'This did not help',
    'aria-pressed': String(message.feedback === 'not_helpful'),
    on: { click: () => vote('not_helpful') },
  });
  down.appendChild(iconEl('thumbDown'));

  const copy = h('button', {
    class: 'iconBtn',
    type: 'button',
    'aria-label': 'Copy answer',
    on: {
      click: () => {
        void navigator.clipboard?.writeText(message.body);
      },
    },
  });
  copy.appendChild(iconEl('copy'));

  row.append(up, down, copy);
  return row;
}
