/**
 * Where the thread scrolls when an answer arrives. A short one is shown at
 * the end, as before. A long one used to be too: its start, and the question
 * above it, went out of sight under the header, so the visitor landed in the
 * middle of an answer. Now its top goes just below the header, and "Jump to
 * latest" leads on. happy-dom does no layout, so the thread is given one:
 * each message a height, the panel body 400px tall.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted, mountWidget, unmount } from './helpers/mount.js';

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

const VIEW = 400;
/** The thread's padding, and the gap between messages (styles.ts, `.thread`). */
const PAD = 16;
const GAP = 10;

const reply = (messageId: string, text: string) => ({
  'POST /chat': {
    conversationId: 'cnv_1',
    messageId,
    text,
    citations: [],
    unresolved: false,
    degraded: false,
  },
});

/**
 * A layout for the open thread: everything in it (a message, the email
 * card) 40px tall unless `heights` says otherwise, by message id or class,
 * stacked with the thread's padding and gaps, in a body `VIEW` tall that
 * scrolls like a browser's (scrollTop clamped to the end).
 */
function layout(w: Mounted, heights: Record<string, number>) {
  const thread = w.$('.thread') as HTMLElement;
  const body = thread.parentElement as HTMLElement;
  const blocks = () => [...thread.children] as HTMLElement[];
  const height = (block: HTMLElement) =>
    heights[block.dataset.messageId ?? ''] ?? heights[block.classList[0] ?? ''] ?? 40;
  const offset = (target: HTMLElement | null) => {
    let top = PAD;
    for (const block of blocks()) {
      if (block === target) return top;
      top += height(block) + GAP;
    }
    return top - GAP + PAD;
  };
  /** The thread's child an element is in: what the layout places. */
  const blockOf = (el: HTMLElement) => blocks().find((block) => block.contains(el)) ?? null;
  let scrollTop = 0;
  const max = () => Math.max(0, offset(null) - VIEW);
  Object.defineProperties(body, {
    clientHeight: { get: () => VIEW, configurable: true },
    scrollHeight: { get: () => Math.max(VIEW, offset(null)), configurable: true },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(Math.max(0, value), max());
      },
      configurable: true,
    },
  });
  const rect = (top: number, tall = 0) =>
    ({ top, bottom: top + tall, left: 0, right: 0, height: tall, width: 0 }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === body) return rect(0, VIEW);
    const block = blockOf(this);
    return block ? rect(offset(block) - scrollTop, height(block)) : rect(0);
  });
  return {
    body,
    max,
    top: (id: string) => offset(blocks().find((b) => b.dataset.messageId === id) ?? null),
    /** Where a block starts and ends, from the top of the content. */
    place(selector: string) {
      const block = blockOf(w.$(selector) as HTMLElement) as HTMLElement;
      return { top: offset(block), bottom: offset(block) + height(block) };
    },
    jump: () => w.$('.jumpLatest') as HTMLElement,
    scrollTo(value: number) {
      body.scrollTop = value;
      body.dispatchEvent(new Event('scroll'));
    },
  };
}

async function openChat(routes: Record<string, unknown>): Promise<Mounted> {
  const w = await mountWidget({ routes });
  w.widget.open({ name: 'chat', conversationId: null });
  await flush();
  return w;
}

describe('an answer arriving', () => {
  it('shows a long answer from its start, just below the header, and offers the way to the end', async () => {
    const w = await openChat(reply('msg_long', 'A very long answer.'));
    const view = layout(w, { msg_long: 900 });
    await w.send('How do I set up SSO?');

    // The answer's top, less a little room, at the top of the body: the
    // header sits directly above it.
    expect(view.body.scrollTop).toBe(view.top('msg_long') - 12);
    expect(view.body.scrollTop).toBeLessThan(view.max());
    expect(view.jump().hidden).toBe(false);
    expect(w.text('.jumpLatest__button')).toBe('Jump to latest');
    // Outside the scrolling thread, so it covers none of it.
    expect(view.body.contains(view.jump())).toBe(false);

    w.click('.jumpLatest__button');
    expect(view.body.scrollTop).toBe(view.max());
    expect(view.jump().hidden).toBe(true);
  });

  it('shows a short answer at the end, as it always did', async () => {
    const w = await openChat(reply('msg_short', 'Open Billing, then Invoices.'));
    // Enough history that the thread scrolls at all.
    const view = layout(w, {});
    const earlier = Array.from({ length: 12 }, (_, i) => ({
      id: `old_${i}`,
      role: i % 2 ? 'agent' : 'customer',
      body: `Earlier message ${i}`,
      citations: [],
      feedback: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    }));
    w.widget.store.set({ conversationId: 'cnv_1', messages: earlier as never });
    await flush();
    await w.send('Where are invoices?');

    expect(view.max()).toBeGreaterThan(0);
    expect(view.body.scrollTop).toBe(view.max());
    expect(view.jump().hidden).toBe(true);
  });

  it('offers "Jump to latest" only while the visitor is scrolled up from the end', async () => {
    const w = await openChat(reply('msg_mid', 'A middling answer.'));
    const view = layout(w, { msg_mid: 300 });
    const earlier = Array.from({ length: 10 }, (_, i) => ({
      id: `old_${i}`,
      role: i % 2 ? 'agent' : 'customer',
      body: `Earlier message ${i}`,
      citations: [],
      feedback: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    }));
    w.widget.store.set({ conversationId: 'cnv_1', messages: earlier as never });
    await flush();
    await w.send('And the rest?');
    // It fits: shown whole, at the end.
    expect(view.body.scrollTop).toBe(view.max());
    expect(view.jump().hidden).toBe(true);

    view.scrollTo(0);
    expect(view.jump().hidden).toBe(false);
    // Nearly at the end counts as at it.
    view.scrollTo(view.max() - 20);
    expect(view.jump().hidden).toBe(true);
  });
});

describe('the email card under an answer the docs could not give', () => {
  const unanswered = {
    'POST /chat': {
      conversationId: 'cnv_1',
      messageId: 'msg_open',
      text: 'The docs do not cover that yet.',
      citations: [],
      unresolved: true,
      degraded: false,
      askForEmail: {},
    },
  };

  it('is shown whole, email field and all, and nothing is laid over it', async () => {
    const w = await openChat(unanswered);
    // Too tall to show from the answer's start with the card: the card wins.
    const view = layout(w, { msg_open: 300, emailCard: 200 });
    await w.send('Can I import three years of history?');

    const email = w.$<HTMLInputElement>('.emailCard input[type="email"]');
    expect(email).toBeTruthy();
    const card = view.place('.emailCard');
    const shown = { top: view.body.scrollTop, bottom: view.body.scrollTop + VIEW };
    expect(card.top).toBeGreaterThanOrEqual(shown.top);
    expect(card.bottom).toBeLessThanOrEqual(shown.bottom);
    // The card is the newest thing, all of it in view: no pill to show.
    expect(view.jump().hidden).toBe(true);

    // And when there is one, it is never over the thread: it has a strip of
    // its own between the thread and the composer.
    view.scrollTo(0);
    expect(view.jump().hidden).toBe(false);
    expect(view.body.contains(view.jump())).toBe(false);
    expect(view.jump().previousElementSibling).toBe(view.body);
    expect(view.jump().parentElement?.querySelector('.composer')).toBeTruthy();
  });

  it('keeps the answer’s start in view when the card fits under it', async () => {
    const w = await openChat(unanswered);
    const view = layout(w, { msg_open: 240, emailCard: 120, old_0: 200, old_1: 200 });
    const earlier = ['old_0', 'old_1'].map((id, i) => ({
      id,
      role: i ? 'agent' : 'customer',
      body: 'Earlier',
      citations: [],
      feedback: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    }));
    w.widget.store.set({ conversationId: 'cnv_1', messages: earlier as never });
    await flush();
    await w.send('Can I import three years of history?');

    // The answer's first line and the whole card, together.
    const card = view.place('.emailCard');
    expect(view.top('msg_open')).toBeGreaterThanOrEqual(view.body.scrollTop);
    expect(card.bottom).toBeLessThanOrEqual(view.body.scrollTop + VIEW);
    expect(view.jump().hidden).toBe(true);
  });
});
