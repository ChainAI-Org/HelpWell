/**
 * Preview states: the widget shown in a state that is hard to wait for, from made-up local data. Each
 * is drawn by the code a visitor's widget uses; none fetches, sends or stores anything; one is on
 * screen at a time; and reset puts the widget, and what a support extension offered, back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WidgetConfig } from '../src/api.js';
import { PREVIEW_STATES } from '../src/preview-states.js';
import { badgeText } from '../src/widget.js';
import { flush, type Mounted, mountWidget, unmount } from './helpers/mount.js';

afterEach(() => {
  vi.useRealTimers();
  unmount();
  for (const el of document.querySelectorAll('helpwell-engage')) el.remove();
  vi.restoreAllMocks();
});

async function widget(config: Partial<WidgetConfig> = {}, routes: Record<string, unknown> = {}) {
  const w = await mountWidget({ config, routes });
  await flush(10);
  return w;
}

const panel = (w: Mounted) => w.$('#hw-panel');
const opened = (w: Mounted) => panel(w)?.getAttribute('data-open') === 'true';
const badge = (w: Mounted) => w.$('.launcher__badge')?.textContent ?? null;
const engageRoots = () =>
  [...document.querySelectorAll('helpwell-engage')].map((el) => el.shadowRoot);
const engageText = () =>
  engageRoots()
    .map((root) => root?.textContent ?? '')
    .join(' ');

/** Nothing but reads: a preview must not create a conversation, a visitor or a count. */
const writes = (w: Mounted) =>
  w.server.calls.filter((call) => !['GET', 'HEAD'].includes(call.method.toUpperCase()));

describe('the list of states', () => {
  it('is the one a control would show, in order, each with a plain label', () => {
    expect(PREVIEW_STATES.map((s) => s.id)).toEqual([
      'launcher',
      'badge',
      'opening',
      'teammate',
      'stacked',
      'proactive',
      'answer',
      'email',
      'banner',
      'popup',
    ]);
    for (const state of PREVIEW_STATES) {
      expect(state.label).toMatch(/^[A-Z][^.]*$/);
      expect(state.label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('is on the widget, and a name it does not know shows nothing', async () => {
    const w = await widget();
    expect(w.widget.preview.states).toBe(PREVIEW_STATES);
    expect(w.widget.preview.current).toBeNull();
    expect(await w.widget.preview.show('hologram')).toBe(false);
    expect(w.widget.preview.current).toBeNull();
    expect(opened(w)).toBe(false);
  });
});

describe('the launcher', () => {
  it('shows it closed, with nothing waiting by it', async () => {
    const w = await widget({ unread: 4 } as Partial<WidgetConfig>);
    w.widget.open();
    await w.widget.preview.show('launcher');
    expect(w.widget.preview.current).toBe('launcher');
    expect(opened(w)).toBe(false);
    expect(badge(w)).toBeNull();
    expect(w.$$('.pro-bubble')).toHaveLength(0);
  });

  it('shows an unread badge of 1, of 3, and "9+" past nine, replacing the last', async () => {
    const w = await widget();
    for (const [count, label] of [
      [1, '1'],
      [3, '3'],
      [9, '9'],
      [12, '9+'],
    ] as const) {
      await w.widget.preview.show('badge', { count });
      expect(badge(w)).toBe(label);
      expect(opened(w)).toBe(false);
    }
    // No count asked for: one.
    await w.widget.preview.show('badge');
    expect(badge(w)).toBe('1');
    // The real changelog count never adds to the made-up one.
    const news = await widget({ unread: 5 } as Partial<WidgetConfig>);
    await news.widget.preview.show('badge', { count: 2 });
    expect(badge(news)).toBe('2');
  });

  it('says "9+" for a real count past nine too, and the exact count up to it', () => {
    expect([0, 1, 9, 10, 250].map(badgeText)).toEqual(['0', '1', '9', '9+', '9+']);
  });

  it('opens the panel for the opening animation, and again, from closed, when asked again', async () => {
    const w = await widget();
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    const first = w.widget.preview.show('opening');
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBe(true);
    expect(opened(w)).toBe(true);
    // Asked again while open: it closes, then opens once more.
    const again = w.widget.preview.show('opening');
    expect(opened(w)).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(await again).toBe(true);
    expect(opened(w)).toBe(true);
  });
});

describe('messages', () => {
  it('shows a teammate’s message arriving in a chat, with who it is from', async () => {
    const w = await widget();
    await w.widget.preview.show('teammate');
    expect(opened(w)).toBe(true);
    expect(w.widget.store.state.view).toMatchObject({ name: 'chat' });
    expect(w.$$('.bubble--customer')).toHaveLength(1);
    await vi.waitFor(() => expect(w.text('.panel')).toContain('Sam · Human support'));
    expect(w.text('.panel')).toContain('I have updated the email on your invoice');
    expect(writes(w)).toEqual([]);
  });

  it('stacks three messages by the closed launcher, with their count on it', async () => {
    const w = await widget();
    await w.widget.preview.show('stacked');
    await vi.waitFor(() => expect(w.$$('.pro-bubble')).toHaveLength(3));
    expect(opened(w)).toBe(false);
    expect(badge(w)).toBe('3');
    expect(w.$$('.pro-bubble__name').map((n) => n.textContent)).toEqual([
      'Sam',
      'Priya',
      'Support agent',
    ]);
    // Drawn with its own styles even when the install has no extension: the bubbles are styled.
    expect(w.$('style[data-preview]')).not.toBeNull();
  });

  it('shows one proactive message over the launcher', async () => {
    const w = await widget();
    await w.widget.preview.show('proactive');
    await vi.waitFor(() => expect(w.$$('.pro-bubble')).toHaveLength(1));
    expect(w.text('.pro-bubble__body')).toContain('Stuck on setup?');
    expect(w.$('.pro-reply input')).not.toBeNull();
    expect(badge(w)).toBe('1');
    expect(opened(w)).toBe(false);
  });

  it('answers a question with an AI answer and the article it came from', async () => {
    const w = await widget();
    await w.widget.preview.show('answer');
    expect(opened(w)).toBe(true);
    expect(w.text('.bubble--customer')).toBe('How do I invite a teammate?');
    expect(w.$('.bubble--agent strong')?.textContent).toBe('Settings');
    expect(w.$$('.citation').map((c) => c.textContent?.trim())).toEqual(['Invite your team']);
    expect(writes(w)).toEqual([]);
  });

  it('asks a visitor who may leave for their email, with the reason', async () => {
    const w = await widget();
    await w.widget.preview.show('email');
    expect(opened(w)).toBe(true);
    expect(w.$('.emailCard')).not.toBeNull();
    expect(w.text('.emailCard__reason')).toBe(
      'If you leave this page, we will email the reply to this address.',
    );
    expect(w.$('.emailCard input[type="email"]')).not.toBeNull();
  });
});

describe('in-app messages', () => {
  it('shows a banner, and a pop-up, from the engage renderers', async () => {
    const w = await widget();
    await w.widget.preview.show('banner');
    await vi.waitFor(() => expect(engageText()).toContain('the spring release is out'));
    expect(engageRoots().some((r) => r?.querySelector('.banner'))).toBe(true);
    expect(opened(w)).toBe(false);

    await w.widget.preview.show('popup');
    await vi.waitFor(() => expect(engageText()).toContain('Welcome back'));
    // Replaced, not added to.
    expect(engageText()).not.toContain('the spring release is out');
    expect(engageRoots().some((r) => r?.querySelector('.modal'))).toBe(true);
    expect(writes(w)).toEqual([]);
  });

  it('opens no page and reports nothing when a button in it is pressed', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const w = await widget();
    await w.widget.preview.show('banner');
    await vi.waitFor(() => expect(engageText()).toContain('See what is new'));
    const button = engageRoots()
      .flatMap((r) => [...(r?.querySelectorAll<HTMLElement>('button, a') ?? [])])
      .find((el) => el.textContent?.includes('See what is new'));
    button?.click();
    await flush(10);
    expect(window.open).not.toHaveBeenCalled();
    expect(writes(w)).toEqual([]);
  });
});

describe('one at a time, and reset', () => {
  it('replaces the state on screen with the next, leaving nothing of the last', async () => {
    const w = await widget();
    await w.widget.preview.show('answer');
    expect(w.$$('.bubble')).not.toHaveLength(0);
    await w.widget.preview.show('stacked');
    await vi.waitFor(() => expect(w.$$('.pro-bubble')).toHaveLength(3));
    // The chat is gone and closed; only the bubbles remain.
    expect(opened(w)).toBe(false);
    expect(w.widget.store.state.messages).toEqual([]);
    await w.widget.preview.show('banner');
    await vi.waitFor(() => expect(engageText()).toContain('spring release'));
    expect(w.$$('.pro-bubble')).toHaveLength(0);
    expect(badge(w)).toBeNull();
    await w.widget.preview.show('launcher');
    expect(engageText()).not.toContain('spring release');
    expect(w.widget.preview.current).toBe('launcher');
  });

  it('puts the widget back as it was on reset: open on Home, no thread, no badge', async () => {
    const w = await widget();
    w.widget.open();
    const before = {
      view: w.widget.store.state.view,
      unread: w.widget.store.state.unread,
      config: w.widget.store.state.config,
    };
    await w.widget.preview.show('email');
    await w.widget.preview.show('badge', { count: 3 });
    w.widget.preview.reset();
    expect(w.widget.preview.current).toBeNull();
    expect(w.widget.store.state).toMatchObject({
      open: true,
      view: before.view,
      unread: before.unread,
      messages: [],
      emailAsk: null,
      conversationId: null,
      proactiveUnread: 0,
    });
    // Even the changelog setting the preview set aside is back.
    expect(w.widget.store.state.config).toBe(before.config);
    expect(opened(w)).toBe(true);
    expect(w.$('.emailCard')).toBeNull();
    expect(badge(w)).toBeNull();
    // Reset with nothing shown does nothing.
    w.widget.preview.reset();
    expect(opened(w)).toBe(true);
  });

  it('never sends a thing, whatever is shown and pressed', async () => {
    const w = await widget();
    const before = w.server.calls.length;
    for (const state of PREVIEW_STATES) {
      await w.widget.preview.show(state.id, { count: 3 });
      await flush(5);
    }
    // Press a bubble's reply, as a visitor would: it only opens a chat on screen.
    await w.widget.preview.show('proactive');
    await vi.waitFor(() => expect(w.$('.pro-reply input')).not.toBeNull());
    const input = w.$<HTMLInputElement>('.pro-reply input')!;
    input.value = 'Yes please';
    w.click('.pro-reply__send');
    await flush(20);
    expect(opened(w)).toBe(true);
    expect(writes(w)).toEqual([]);
    const sent = w.server.calls.slice(before).filter((c) => c.method.toUpperCase() !== 'GET');
    expect(sent).toEqual([]);
  });

  it('stands a support extension’s own messages aside while it shows, and brings them back', async () => {
    const own = {
      kind: 'chat',
      id: 'live_1',
      sender: { name: 'Maya', isAgent: false, avatarUrl: null },
      blocks: [{ type: 'text', markdown: 'A real message from the extension.' }],
      replyable: false,
    };
    const w = await widget({ support: { human: true, proactive: true } } as Partial<WidgetConfig>, {
      'GET /proactive': { items: [own] },
    });
    expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).toEqual(['live_1']);
    expect(badge(w)).toBe('1');

    await w.widget.preview.show('stacked');
    await vi.waitFor(() => expect(w.$$('.pro-bubble')).toHaveLength(3));
    expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).not.toContain('live_1');
    expect(badge(w)).toBe('3');

    w.widget.preview.reset();
    await vi.waitFor(() =>
      expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).toEqual(['live_1']),
    );
  });

  it('is torn down with the widget', async () => {
    const w = await widget();
    await w.widget.preview.show('banner');
    await vi.waitFor(() => expect(engageText()).toContain('spring release'));
    w.widget.destroy();
    expect(engageText()).not.toContain('spring release');
  });
});
