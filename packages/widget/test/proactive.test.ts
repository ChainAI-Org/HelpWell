/**
 * Proactive messages in the widget: bubbles by the launcher for chat items
 * a support extension offers, the count on the launcher, opening one into a
 * chat whose first reply carries its id, events reported back, and nothing
 * at all when the extension offers nothing or the request fails.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WidgetConfig } from '../src/api.js';
import {
  browserId,
  chatMarkdown,
  mountProactive,
  PROACTIVE_POLL_MS,
  parseProactiveItems,
} from '../src/proactive.js';
import { Store } from '../src/state.js';
import { bodies, flush, type Mounted, mountWidget, unmount } from './helpers/mount.js';

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const withProactive = { support: { human: true, proactive: true } } as Partial<WidgetConfig>;

const agentHello = {
  kind: 'chat',
  id: 'hello_1',
  sender: { name: 'Fern', isAgent: true, avatarUrl: null },
  blocks: [{ type: 'text', markdown: 'Want a hand setting up **invoices**?' }],
  replyable: true,
};

const teammateNote = {
  kind: 'chat',
  id: 'note_1',
  sender: { name: 'Maya Lopez', isAgent: false, avatarUrl: null },
  blocks: [
    { type: 'text', markdown: 'We shipped exports.' },
    { type: 'buttons', buttons: [{ label: 'Read more', action: 'url', value: '/changelog' }] },
  ],
  replyable: false,
};

async function mountWith(
  items: unknown[],
  extra: Record<string, unknown> = {},
  response: Record<string, unknown> = {},
): Promise<Mounted> {
  const w = await mountWidget({
    config: withProactive,
    routes: { 'GET /proactive': { items, ...response }, ...extra },
  });
  await flush(10);
  return w;
}

function events(w: Mounted): { path: string; body: unknown }[] {
  return w.server.calls
    .filter((call) => /^\/proactive\/[^/]+\/events$/.test(call.path))
    .map((call) => ({ path: call.path, body: call.body }));
}

describe('without an extension that offers messages', () => {
  it('never asks', async () => {
    const w = await mountWidget({ config: { support: { human: true } } as Partial<WidgetConfig> });
    await flush(10);
    expect(w.server.calls.some((call) => call.path.startsWith('/proactive'))).toBe(false);
    expect(w.$('.pro-stack')).toBeNull();
  });
});

describe('chat items', () => {
  it('lets a visitor type in the bubble and sends that first reply once with its message id', async () => {
    const w = await mountWith([agentHello]);
    const input = w.$<HTMLInputElement>('.pro-reply input')!;
    input.click();
    input.value = '  Yes, help me with invoices  ';
    input.dispatchEvent(new Event('input'));
    expect(w.widget.store.state.open).toBe(false);
    expect(bodies(w.server, '/chat')).toHaveLength(0);
    w.click('.pro-reply__send');
    await flush(30);
    expect(w.widget.store.state.open).toBe(true);
    const sent = bodies(w.server, '/chat') as Record<string, unknown>[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      message: 'Yes, help me with invoices',
      conversationId: null,
      proactiveId: 'hello_1',
    });
  });

  it('stack by the launcher with the sender, count on the launcher, and are reported seen', async () => {
    const w = await mountWith([agentHello, teammateNote]);

    const bubbles = w.$$('.pro-bubble');
    expect(bubbles.map((b) => b.dataset.proactive)).toEqual(['hello_1', 'note_1']);
    expect(w.text('.pro-bubble[data-proactive="hello_1"] .pro-bubble__name')).toBe('Fern');
    // The agent is the bare mark; a teammate without a photo gets initials.
    expect(w.$('[data-proactive="hello_1"] .pro-avatar--mark svg')).not.toBeNull();
    expect(w.$('[data-proactive="hello_1"] .pro-avatar img')).toBeNull();
    expect(w.text('[data-proactive="note_1"] .pro-avatar--initials')).toBe('ML');
    expect(w.$('[data-proactive="hello_1"] .pro-bubble__body strong')?.textContent).toBe(
      'invoices',
    );
    expect(w.text('.launcher__badge')).toBe('2');

    const asked = w.server.calls.find((call) => call.path.startsWith('/proactive?'));
    const query = new URLSearchParams(asked?.path.split('?')[1]);
    expect(query.get('path')).toBe('/');
    expect(query.get('anon')).toMatch(/^b_[a-z0-9]+$/);
    // What the engage request is told about the visit, so the extension can aim.
    expect(query.get('device')).toBe('desktop');
    expect(query.get('lang')).toBe(navigator.language);
    expect(events(w)).toEqual([
      { path: '/proactive/hello_1/events', body: { event: 'seen', anon: browserId() } },
      { path: '/proactive/note_1/events', body: { event: 'seen', anon: browserId() } },
    ]);
  });

  it('opens into a chat holding the message, and the first reply carries its id', async () => {
    const w = await mountWith([agentHello]);
    w.click('.pro-bubble[data-proactive="hello_1"] .pro-button--reply');
    await flush(10);

    expect(w.widget.store.state.open).toBe(true);
    expect(w.$('.pro-bubble')).toBeNull();
    expect(w.$('.launcher__badge')).toBeNull();
    expect(w.$$('.bubble--agent').map((b) => b.textContent?.trim())).toEqual([
      'Want a hand setting up invoices?',
    ]);
    // Nothing to vote on until the conversation exists.
    expect(w.$('.msgActions')).toBeNull();
    expect(events(w).at(-1)).toEqual({
      path: '/proactive/hello_1/events',
      body: { event: 'clicked', anon: browserId() },
    });

    await w.send('Yes please');
    await w.send('And receipts?');
    const sent = bodies(w.server, '/chat') as Record<string, unknown>[];
    expect(sent[0]).toMatchObject({
      message: 'Yes please',
      conversationId: null,
      proactiveId: 'hello_1',
    });
    expect(sent[1]).toMatchObject({ message: 'And receipts?', conversationId: 'cnv_1' });
    expect(sent[1]).not.toHaveProperty('proactiveId');
    expect(typeof sent[0]?.requestId).toBe('string');
    expect(sent[0]?.requestId).not.toBe(sent[1]?.requestId);
  });

  it('takes a dismissal, and does not draw that message again on this page', async () => {
    const w = await mountWith([agentHello, teammateNote]);
    w.click('.pro-bubble[data-proactive="note_1"] .pro-bubble__close');
    await flush();
    expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).toEqual(['hello_1']);
    expect(w.text('.launcher__badge')).toBe('1');
    expect(events(w).at(-1)?.body).toEqual({ event: 'dismissed', anon: browserId() });

    history.pushState({}, '', '/pricing');
    await flush(250);
    expect(w.server.calls.filter((c) => c.path.startsWith('/proactive?')).at(-1)?.path).toContain(
      'path=%2Fpricing',
    );
    expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).toEqual(['hello_1']);
  });

  it('hides the bubbles while the panel is open', async () => {
    const w = await mountWith([agentHello]);
    w.widget.open();
    await flush();
    expect(w.$<HTMLElement>('.pro-stack')?.hidden).toBe(true);
    w.widget.close();
    await flush();
    expect(w.$<HTMLElement>('.pro-stack')?.hidden).toBe(false);
  });

  it('shows nothing, and breaks nothing, when the request fails', async () => {
    const w = await mountWidget({ config: withProactive, fail: new Set(['/proactive']) });
    await flush(10);
    expect(w.$$('.pro-bubble')).toEqual([]);
    expect(w.$('.launcher__badge')).toBeNull();
    w.widget.open();
    await flush();
    expect(w.widget.store.state.open).toBe(true);
  });
});

describe('sending', () => {
  it('keeps one requestId through a retry of the same message', async () => {
    const w = await mountWidget();
    w.widget.open({ name: 'chat', conversationId: null });
    await flush();
    w.server.fail('/chat');
    await w.send('Hello');
    w.server.unfail('/chat');
    w.click('.notice__retry');
    await flush(20);
    const sent = bodies(w.server, '/chat') as { requestId?: string }[];
    expect(sent).toHaveLength(2);
    expect(sent[0]?.requestId).toBeTruthy();
    expect(sent[1]?.requestId).toBe(sent[0]?.requestId);
  });

  it('shows what the server said when a person cannot be reached', async () => {
    const w = await mountWidget({
      config: { support: { human: true } } as Partial<WidgetConfig>,
    });
    w.widget.open({ name: 'chat', conversationId: null });
    await flush();
    await w.send('Hello');
    w.server.status('/conversations/cnv_1/handoff', 502, {
      error: { code: 'upstream_failed', message: "We couldn't reach the team just now." },
    });
    w.click('.handoff__button');
    await flush(20);
    expect(w.text('.notice--bad')).toContain("We couldn't reach the team just now.");
  });
});

describe('the poller', () => {
  it('asks on mount and once a minute while the page is visible', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const api = {
      proactive: vi.fn(async () => ({ items: [] })),
      proactiveEvent: vi.fn(async () => {}),
    };
    const container = document.createElement('div');
    const proactive = mountProactive({
      api: api as never,
      store: new Store(),
      container,
      open: () => {},
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.proactive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PROACTIVE_POLL_MS);
    expect(api.proactive).toHaveBeenCalledTimes(2);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(PROACTIVE_POLL_MS);
    expect(api.proactive).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.proactive).toHaveBeenCalledTimes(3);

    proactive.destroy();
    await vi.advanceTimersByTimeAsync(PROACTIVE_POLL_MS * 2);
    expect(api.proactive).toHaveBeenCalledTimes(3);
  });
});

describe('parsing', () => {
  it('keeps only what it can draw safely', () => {
    const items = parseProactiveItems([
      agentHello,
      { ...agentHello, id: 'bad id' },
      { ...agentHello, id: 'x', sender: { name: '' } },
      {
        ...agentHello,
        id: 'img',
        blocks: [
          { type: 'image', url: 'javascript:alert(1)', alt: '' },
          { type: 'image', url: 'https://cdn.example/a.png', alt: 'A' },
        ],
      },
      { kind: 'engagement', id: 'modal_1', engagement: { kind: 'modal' } },
      'nonsense',
    ]);
    expect(items.map((i) => i.id)).toEqual(['hello_1', 'img', 'modal_1']);
    const img = items[1];
    expect(img?.kind === 'chat' ? chatMarkdown(img.blocks) : '').toBe(
      '![A](https://cdn.example/a.png)',
    );
  });
});

/* ------------------------------------------------------------ engagements */

const proactiveModal = {
  kind: 'engagement',
  id: 'launch_1',
  engagement: {
    id: 'proactive:launch_1',
    kind: 'modal',
    triggers: [{ type: 'load' }],
    priority: 0,
    dismissible: true,
    modal: {
      size: 'medium',
      mediaPosition: 'top',
      slides: [{ blocks: [{ type: 'text', markdown: '## Invoices are here' }] }],
    },
  },
};

const SHOW = '/engage/proactive%3Alaunch_1/show';

function engageLayer(): ShadowRoot | null {
  return document.querySelector('helpwell-engage')?.shadowRoot ?? null;
}

describe('engagement items', () => {
  it('go to the one engage controller, claimed and recorded under their proactive name', async () => {
    const w = await mountWith([proactiveModal], { [`POST ${SHOW}`]: { shown: true } });
    await flush(20);
    // One engage layer for Settings engagements and these alike.
    expect(document.querySelectorAll('helpwell-engage')).toHaveLength(1);
    const claims = w.server.calls.filter((c) => c.path === SHOW);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.body).toMatchObject({ url: '/', anon: browserId() });
    const modal = engageLayer()?.querySelector('.modal');
    expect(modal?.getAttribute('aria-label')).toBe('Invoices are here');
    // It is not a chat bubble.
    expect(w.$('.pro-bubble')).toBeNull();

    engageLayer()?.querySelector<HTMLElement>('.engage-close')?.click();
    await flush();
    // The server tells the extension about the close, once.
    expect(
      w.server.calls.find((c) => c.path === '/engage/proactive%3Alaunch_1/impression')?.body,
    ).toMatchObject({ state: 'dismissed', anon: browserId() });
    expect(events(w)).toEqual([]);
  });

  it('draw nothing when the cap says no', async () => {
    const w = await mountWith([proactiveModal], {
      [`POST ${SHOW}`]: { shown: false, reason: 'limit' },
    });
    await flush(20);
    expect(w.server.calls.some((c) => c.path === SHOW)).toBe(true);
    expect(engageLayer()?.querySelector('.modal') ?? null).toBeNull();
  });

  it('ignore a definition whose id the server did not give it', async () => {
    const w = await mountWith([
      { ...proactiveModal, engagement: { ...proactiveModal.engagement, id: 'eng_other' } },
    ]);
    await flush(20);
    expect(w.server.calls.some((c) => c.path.endsWith('/show'))).toBe(false);
  });

  it('take turns on screen with Settings engagements', async () => {
    const mine = {
      id: 'welcome',
      kind: 'modal',
      triggers: [{ type: 'load' }],
      priority: 10,
      dismissible: true,
      modal: { slides: [{ blocks: [{ type: 'text', markdown: '## Welcome aboard' }] }] },
    };
    await mountWith([proactiveModal], {
      'GET /engage': { items: [mine] },
      'POST /engage/welcome/show': { shown: true },
      [`POST ${SHOW}`]: { shown: true },
    });
    await flush(30);
    const shown = () =>
      [...(engageLayer()?.querySelectorAll('.modal') ?? [])].map((m) =>
        m.getAttribute('aria-label'),
      );
    expect(shown()).toHaveLength(1);
    const first = shown()[0];
    engageLayer()?.querySelector<HTMLElement>('.engage-close')?.click();
    await flush(250);
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).not.toBe(first);
    expect(new Set([first, shown()[0]])).toEqual(new Set(['Welcome aboard', 'Invoices are here']));
  });
});

describe('chat items with a moment and a display', () => {
  it('appear when their trigger fires, not on load', async () => {
    const w = await mountWith([
      { ...agentHello, triggers: [{ type: 'event', name: 'pricing_viewed' }] },
    ]);
    expect(w.$('.pro-bubble')).toBeNull();
    expect(w.$('.launcher__badge')).toBeNull();
    w.widget.track('pricing_viewed');
    await flush();
    expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).toEqual(['hello_1']);
    expect(w.text('.launcher__badge')).toBe('1');
  });

  it('open the messenger on the message, once, and report it seen', async () => {
    const w = await mountWith([{ ...agentHello, display: 'messenger' }]);
    await flush(10);
    expect(w.widget.store.state.open).toBe(true);
    expect(w.widget.store.state.proactiveId).toBe('hello_1');
    expect(w.$$('.bubble--agent').map((b) => b.textContent?.trim())).toEqual([
      'Want a hand setting up invoices?',
    ]);
    expect(w.$('.pro-bubble')).toBeNull();
    expect(events(w)).toEqual([
      { path: '/proactive/hello_1/events', body: { event: 'seen', anon: browserId() } },
    ]);
  });

  it('wait as a bubble when the visitor already has the panel open', async () => {
    const w = await mountWith([
      { ...agentHello, display: 'messenger', triggers: [{ type: 'event', name: 'later' }] },
    ]);
    w.widget.open({ name: 'help' });
    await flush();
    w.widget.track('later');
    await flush();
    expect(w.widget.store.state.view.name).toBe('help');
    expect(w.$$('.pro-bubble').map((b) => b.dataset.proactive)).toEqual(['hello_1']);
  });

  it('send a quick reply as the visitor’s first words, with the message id', async () => {
    const w = await mountWith([
      {
        ...agentHello,
        blocks: [
          ...agentHello.blocks,
          {
            type: 'buttons',
            buttons: [
              { label: 'Yes please', action: 'reply' },
              { label: 'Not now', action: 'reply', value: 'Maybe later, thanks' },
            ],
          },
        ],
      },
    ]);
    // Quick replies stand in for the Reply button.
    expect(w.$('.pro-button--reply')).toBeNull();
    const quick = w.$$<HTMLButtonElement>('.pro-button--quick');
    expect(quick.map((b) => b.textContent)).toEqual(['Yes please', 'Not now']);
    quick[1]?.click();
    await flush(30);
    expect(w.widget.store.state.open).toBe(true);
    const sent = bodies(w.server, '/chat') as Record<string, unknown>[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      message: 'Maybe later, thanks',
      conversationId: null,
      proactiveId: 'hello_1',
    });
    expect(w.widget.store.state.outbox).toBeNull();
  });

  it('start one of the install’s tours from a button', async () => {
    const w = await mountWith([
      {
        ...teammateNote,
        blocks: [
          { type: 'text', markdown: 'New here?' },
          { type: 'buttons', buttons: [{ label: 'Show me', action: 'tour', value: 'setup' }] },
        ],
      },
    ]);
    w.click('.pro-bubble[data-proactive="note_1"] .pro-button');
    await flush(10);
    expect(w.server.calls.some((c) => c.path === '/engage/setup')).toBe(true);
    expect(events(w).at(-1)?.body).toMatchObject({ event: 'clicked' });
  });
});

describe('personalisation', () => {
  it('fills the visitor’s details in as text, and the fallback for what is missing', async () => {
    const w = await mountWith(
      [
        {
          ...agentHello,
          blocks: [
            {
              type: 'text',
              markdown: 'Hi **{{first_name|there}}**, {{company|your team}} is set.',
            },
            { type: 'buttons', buttons: [{ label: 'Thanks {{first_name}}', action: 'reply' }] },
          ],
        },
      ],
      {},
      { fields: { first_name: '[Ada](javascript:alert(1))' } },
    );
    const body = w.$('.pro-bubble__body');
    expect(body?.textContent?.trim()).toBe('Hi [Ada](javascript:alert(1)), your team is set.');
    // The value is text inside the bold, never a link of its own.
    expect(body?.querySelector('strong')?.textContent).toBe('[Ada](javascript:alert(1))');
    expect(body?.querySelector('a')).toBeNull();
    expect(w.text('.pro-button--quick')).toBe('Thanks [Ada](javascript:alert(1))');
  });
});
