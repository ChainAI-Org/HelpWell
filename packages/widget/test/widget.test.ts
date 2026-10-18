import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../src/index.js';
import { Widget } from '../src/widget.js';
import { createFakeServer, type FakeServer, flush } from './helpers/server.js';

let server: FakeServer;
let widget: Widget;

async function mount(
  options: Parameters<typeof createFakeServer>[0] = {},
  widgetOptions: Omit<ConstructorParameters<typeof Widget>[0], 'apiUrl' | 'fetch'> = {},
): Promise<Widget> {
  server = createFakeServer(options);
  widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch, ...widgetOptions });
  await widget.mount();
  await flush();
  return widget;
}

function root(): ShadowRoot {
  const shadow = widget.shadowRoot;
  if (!shadow) throw new Error('widget is not mounted');
  return shadow;
}

function $(selector: string): HTMLElement | null {
  return root().querySelector(selector);
}

function $$(selector: string): HTMLElement[] {
  return [...root().querySelectorAll<HTMLElement>(selector)];
}

function text(selector: string): string {
  return $(selector)?.textContent?.trim() ?? '';
}

function click(selector: string): void {
  const el = $(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  el.click();
}

function key(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init }),
  );
}

afterEach(() => {
  widget?.destroy();
  document.body.textContent = '';
  history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('mounting', () => {
  beforeEach(async () => {
    await mount();
  });

  it('renders into a shadow root so the host page cannot restyle it', () => {
    expect(document.querySelector('helpwell-widget')?.shadowRoot).toBeTruthy();
    expect(root().querySelector('style')?.textContent).toContain('--hw-accent');
  });

  it('shows the launcher closed, with the mark and not a circle around it', () => {
    const launcher = $('.launcher');
    expect(launcher).toBeTruthy();
    expect(launcher?.classList.contains('launcher--mark')).toBe(true);
    expect(launcher?.dataset.open).toBe('false');
    expect($('.panel')?.dataset.open).toBe('false');
  });

  it('anchors the panel to the corner it is mounted in', () => {
    // The host element is a zero-width anchor. Without an explicit edge the
    // panel takes its static position and hangs off the side of the viewport.
    const style = root().querySelector('style')?.textContent ?? '';
    expect(style).toMatch(/\.panel\s*\{[^}]*inset-inline-end:\s*0/);
    expect(style).toMatch(/-left'\]\)\s*\.panel\s*\{[^}]*inset-inline-start:\s*0/);
  });

  it('applies the accent from settings', () => {
    const style = root().querySelector('style')?.textContent ?? '';
    expect(style).toContain('--hw-accent: #7A3BEB');
  });

  it('opens and closes', () => {
    click('.launcher');
    expect($('.panel')?.dataset.open).toBe('true');
    expect($('.launcher')?.getAttribute('aria-label')).toBe('Close support');

    click('.launcher');
    expect($('.panel')?.dataset.open).toBe('false');
  });

  it('closes on Escape', () => {
    widget.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(widget.store.state.open).toBe(false);
  });

  it('does not render at all when the page is excluded', async () => {
    widget.destroy();
    document.body.textContent = '';
    await mount({ config: { widget: { displayRules: { exclude: ['/'] } } } as never });
    expect(document.querySelector('helpwell-widget')).toBeNull();
  });

  it('stays silent when the API is unreachable, rather than breaking the page', async () => {
    widget.destroy();
    document.body.textContent = '';
    server = createFakeServer({ fail: new Set(['/config']) });
    widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch });
    await widget.mount();
    expect(document.querySelector('helpwell-widget')).toBeNull();
  });

  it('stays silent when /config answers 200 with something that is not a config', async () => {
    widget.destroy();
    document.body.textContent = '';
    // A misrouted request lands on the app's HTML shell, with a 200.
    await mount({
      routes: { 'GET /config': new Response('<!doctype html><p>Sign in</p>', { status: 200 }) },
    });
    expect(document.querySelector('helpwell-widget')).toBeNull();
    // And open() has nothing to open, rather than something to throw at.
    expect(() => widget.open()).not.toThrow();
  });

  it('reports a render error once and never throws it at the host page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    widget.open();
    // A view that throws: the store update runs the subscriber synchronously,
    // inside whatever click handler triggered it.
    expect(() => widget.go({ name: 'collection', collection: null as never })).not.toThrow();
    expect(() => widget.go({ name: 'collection', collection: undefined as never })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('appearance from settings', () => {
  /**
   * happy-dom matches `:host(...)` whatever its argument, so a computed colour
   * here would prove nothing. The selectors are asserted instead; the browser
   * check lives in the headless-Chromium smoke, which reads the real colour.
   */
  function themeBlocks(): string {
    return root().querySelector('style')?.textContent ?? '';
  }

  it('follows an explicit dark theme inside the shadow root', async () => {
    await mount({ config: { widget: { appearance: { theme: 'dark' } } } as never });
    expect(document.querySelector('helpwell-widget')?.getAttribute('data-hw-theme')).toBe('dark');
    const css = themeBlocks();
    // A shadow host is only ever matched through :host(); the old
    // `:host[data-hw-theme='dark']` was valid CSS that matched nothing.
    expect(css).toMatch(/:host\(\[data-hw-theme='dark'\]\) \{[^}]*--hw-surface: #151517;/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:host\(:not\(\[data-hw-theme='light'\]\)\) \{[^}]*--hw-surface: #151517;/,
    );
    expect(css).not.toMatch(/:host\[|:host:not/);
    // The light surface is still the default the dark blocks override.
    expect(css).toMatch(/:host \{[^}]*--hw-surface: #FFFFFF;/);
  });

  it('marks the host light when the theme is light, so the OS setting is ignored', async () => {
    await mount();
    expect(document.querySelector('helpwell-widget')?.getAttribute('data-hw-theme')).toBe('light');
  });

  it('follows the reader when the theme is system, and lets the embed force one', async () => {
    await mount({ config: { widget: { appearance: { theme: 'system' } } } } as never);
    expect(document.querySelector('helpwell-widget')?.hasAttribute('data-hw-theme')).toBe(false);
    widget.destroy();
    await mount({}, { theme: 'dark' });
    expect(document.querySelector('helpwell-widget')?.getAttribute('data-hw-theme')).toBe('dark');
  });

  it('builds a custom launcher image as an element, never as markup', async () => {
    await mount({
      config: {
        widget: { appearance: { launcherIconUrl: '"><img src=x onerror="window.pwned=1">' } },
      } as never,
    });
    expect($('.launcher img')).toBeNull();
    expect($('.launcher svg')).toBeTruthy();
    expect((window as { pwned?: number }).pwned).toBeUndefined();

    widget.destroy();
    await mount({
      config: { widget: { appearance: { launcherIconUrl: 'javascript:alert(1)' } } } as never,
    });
    expect($('.launcher img')).toBeNull();

    widget.destroy();
    await mount({
      config: { widget: { appearance: { launcherIconUrl: '/brand/launcher.png' } } } as never,
    });
    expect($('.launcher img')?.getAttribute('src')).toBe('/brand/launcher.png');
  });

  it('ignores an accent that is not a colour, in the stylesheet and in the mark', async () => {
    await mount({
      config: { widget: { appearance: { accent: '#fff"><script>window.pwned=1</script>' } } },
    } as never);
    const style = root().querySelector('style')?.textContent ?? '';
    expect(style).toContain('--hw-accent: #7A3BEB;');
    expect(style).not.toContain('<script>');
    expect(root().querySelector('script')).toBeNull();
    expect($('.launcher path')?.getAttribute('fill')).toBe('#7A3BEB');
  });

  it('shows no badge when the customer turned the notification off', async () => {
    await mount({ config: { unread: 3, changelog: { notification: 'none' } } as never });
    expect($('.launcher__badge')).toBeNull();
    widget.open();
    await flush();
    expect($('.tab__dot')).toBeNull();
  });

  it('links to the status page from Home when there is one', async () => {
    await mount({ config: { widget: { statusUrl: 'https://status.acme.com' } } } as never);
    widget.open();
    await flush();
    const link = $('.statusLink') as HTMLAnchorElement;
    expect(link?.getAttribute('href')).toBe('https://status.acme.com');
    expect(link?.textContent).toContain('Status');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});

describe('keyboard and focus', () => {
  beforeEach(async () => {
    await mount();
  });

  it('moves focus into the panel on open and back to the launcher on close', () => {
    click('.launcher');
    expect(root().activeElement).toBe($('.panel'));

    key(document, 'Escape');
    expect(widget.store.state.open).toBe(false);
    expect(root().activeElement).toBe($('.launcher'));
  });

  it('keeps Tab inside the panel while focus is in it', async () => {
    widget.open();
    await flush();
    const focusables = $$('.panel a[href], .panel button, .panel input');
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    last.focus();
    key(last, 'Tab');
    expect(root().activeElement).toBe(first);

    first.focus();
    key(first, 'Tab', { shiftKey: true });
    expect(root().activeElement).toBe(last);

    // From the panel itself, Shift+Tab wraps to the end too.
    $('.panel')!.focus();
    key($('.panel')!, 'Tab', { shiftKey: true });
    expect(root().activeElement).toBe(last);
  });

  it('leaves focus alone when it is on the page beside the panel', () => {
    widget.open();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    key(field, 'Tab');
    expect(document.activeElement).toBe(field);

    // Closing programmatically does not steal it either.
    widget.close();
    expect(document.activeElement).toBe(field);
  });

  it('points the launcher at the panel it controls', () => {
    expect($('.launcher')?.getAttribute('aria-controls')).toBe('hw-panel');
    expect($('.panel')?.id).toBe('hw-panel');
    expect($('.panel')?.getAttribute('aria-modal')).toBe('false');
  });

  it('is modal on a phone, where it is the whole screen', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query.includes('480px'),
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    widget.open();
    expect($('.panel')?.getAttribute('aria-modal')).toBe('true');
    widget.close();
    expect($('.panel')?.getAttribute('aria-modal')).toBe('false');
  });

  it('follows the visual viewport so the composer stays above the keyboard', async () => {
    widget.destroy();
    class FakeViewport extends EventTarget {
      height = 800;
    }
    const viewport = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    try {
      await mount();
      const host = document.querySelector('helpwell-widget') as HTMLElement;
      widget.open();
      expect(host.style.getPropertyValue('--hw-panel-height')).toBe('800px');

      viewport.height = 460;
      viewport.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--hw-panel-height')).toBe('460px');

      widget.close();
      expect(host.style.getPropertyValue('--hw-panel-height')).toBe('');
    } finally {
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    }
  });
});

describe('tabs', () => {
  beforeEach(async () => {
    await mount();
    widget.open();
    await flush();
  });

  it('shows every enabled tab', () => {
    expect($$('.tab').map((t) => t.textContent)).toEqual([
      'Home',
      'Messages',
      'Help',
      'Updates',
      'Roadmap',
    ]);
  });

  it('hides a tab the customer switched off', async () => {
    widget.destroy();
    await mount({ config: { widget: { tabs: { roadmap: false } } } as never });
    widget.open();
    await flush();
    expect($$('.tab').map((t) => t.textContent)).not.toContain('Roadmap');
  });

  it('hides Updates when the changelog tab is off', async () => {
    widget.destroy();
    await mount({ config: { changelog: { widgetTab: false } } as never });
    widget.open();
    await flush();
    expect($$('.tab').map((t) => t.textContent)).not.toContain('Updates');
  });

  it('marks the current tab selected', async () => {
    const help = $$('.tab').find((t) => t.textContent?.includes('Help'));
    help?.click();
    await flush();
    const selected = $$('.tab').find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toContain('Help');
  });

  it('is a real tab list: each tab controls the body, and the arrows move between them', () => {
    const tabs = $$('.tab');
    for (const tab of tabs) expect(tab.getAttribute('aria-controls')).toBe('hw-tabpanel');
    const body = $('#hw-tabpanel');
    expect(body?.getAttribute('role')).toBe('tabpanel');
    expect(body?.getAttribute('aria-labelledby')).toBe('hw-tab-home');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);

    tabs[0]!.focus();
    key(tabs[0]!, 'ArrowRight');
    expect(root().activeElement?.id).toBe('hw-tab-messages');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1, -1]);

    key(tabs[1]!, 'ArrowLeft');
    expect(root().activeElement?.id).toBe('hw-tab-home');
    key(tabs[0]!, 'End');
    expect(root().activeElement?.id).toBe('hw-tab-roadmap');
  });

  it('goes straight back into the open conversation from the Messages tab', async () => {
    widget.open({ name: 'chat', conversationId: null });
    await flush();
    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    click('.composer__send');
    await flush(20);
    expect(widget.store.state.conversationId).toBe('cnv_1');

    widget.go({ name: 'help' });
    await flush();
    $$('.tab')
      .find((t) => t.textContent?.includes('Messages'))
      ?.click();
    await flush();
    expect(widget.store.state.view).toEqual({ name: 'chat', conversationId: 'cnv_1' });
    expect(text('.bubble--customer')).toBe('hello');
  });
});

describe('chat', () => {
  beforeEach(async () => {
    await mount();
    widget.open({ name: 'chat', conversationId: null });
    await flush();
  });

  async function send(message: string): Promise<void> {
    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = message;
    input.dispatchEvent(new Event('input'));
    click('.composer__send');
    await flush(20);
  }

  it('acknowledges a human reply only while its thread is visible', async () => {
    server.set('POST /conversations/cnv_1/seen', { ok: true });
    widget.close();
    widget.store.set({
      conversationId: 'cnv_1',
      messages: [
        {
          id: 'human_1',
          role: 'human',
          body: 'A person has replied.',
          citations: [],
          feedback: null,
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    });
    await flush(10);
    expect(server.calls.some((call) => call.path === '/conversations/cnv_1/seen')).toBe(false);
    widget.open();
    await flush(10);
    const receipts = server.calls.filter((call) => call.path === '/conversations/cnv_1/seen');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.body).toEqual({ messageIds: ['human_1'] });
    widget.store.set({ open: true });
    await flush(10);
    expect(server.calls.filter((call) => call.path === '/conversations/cnv_1/seen')).toHaveLength(
      1,
    );
  });

  it('disables send until something is typed', () => {
    const button = $('.composer__send') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    expect(button.disabled).toBe(false);
  });

  it('shows the question, the answer, and the article it came from', async () => {
    await send('How do I export invoices?');

    expect(text('.bubble--customer')).toBe('How do I export invoices?');
    expect(text('.bubble--agent')).toContain('Open Billing');
    expect(text('.citation')).toBe('Exporting invoices');
  });

  it('tells a screen reader a reply is being written', async () => {
    server.delay('/chat', 40);
    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    click('.composer__send');
    await flush(5);

    const typing = $('[role="status"]');
    expect(typing?.textContent).toContain('Writing a reply');
    expect(typing?.querySelector('.typing')?.getAttribute('aria-hidden')).toBe('true');
    await flush(60);
    expect($('[role="status"]')).toBeNull();
  });

  it('opens the cited article from the answer', async () => {
    await send('How do I export invoices?');
    click('.citation');
    await flush(20);
    expect(text('.article h1')).toBe('Exporting invoices');
  });

  it('sends a honeypot field that a person never sees', async () => {
    await send('hello');
    const call = server.calls.find((c) => c.path === '/chat');
    expect(call?.body).toMatchObject({ honeypot: '' });
    expect($('.honeypot')).toBeTruthy();
  });

  it('records a thumbs-up without blocking the thread', async () => {
    await send('How do I export invoices?');
    const up = $$('.iconBtn').find((b) => b.getAttribute('aria-label') === 'This helped');
    up?.click();
    await flush(10);

    expect(up?.getAttribute('aria-pressed')).toBe('true');
    expect(server.calls.some((c) => c.path === '/messages/msg_1/feedback')).toBe(true);
  });

  it('surfaces a failure with a retry rather than losing the message', async () => {
    server.fail('/chat');
    await send('this will fail');

    expect(text('.notice--bad')).toContain('Support is unavailable.');
    expect($('.notice__retry')).toBeTruthy();

    server.unfail('/chat');
    click('.notice__retry');
    await flush(20);
    expect(text('.bubble--agent')).toContain('Open Billing');
  });

  it('says so when the answer came from search rather than the model', async () => {
    server.set('POST /chat', {
      conversationId: 'cnv_1',
      messageId: 'msg_2',
      text: 'Here is the closest article.',
      citations: [],
      unresolved: false,
      degraded: true,
    });
    await send('anything');
    expect(text('.notice--warn')).toContain('came from the docs');
  });

  it('keeps one conversation across turns', async () => {
    await send('first');
    await send('second');
    const second = server.calls.filter((c) => c.path === '/chat')[1];
    expect(second?.body).toMatchObject({ conversationId: 'cnv_1' });
  });

  it('starts a fresh conversation from "Ask something else"', async () => {
    await send('first');
    expect(widget.store.state.conversationId).toBe('cnv_1');

    widget.go({ name: 'home' });
    await flush();
    expect(text('.primary')).toContain('Ask something else');
    click('.primary');
    await flush();

    // A clean thread, and the next message does not carry the old id.
    expect($('.bubble--customer')).toBeNull();
    expect(widget.store.state.conversationId).toBeNull();
    await send('second');
    const calls = server.calls.filter((c) => c.path === '/chat');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ conversationId: null });
  });

  it('starts over, once, when the server says the conversation is not ours', async () => {
    // The cookie changed, or the visitor was reset in another tab: the id in
    // the store is stale and the server answers 403 to it.
    widget.store.set({ conversationId: 'cnv_stale', messages: [] });
    const attempts: (string | null)[] = [];
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (String(input).endsWith('/chat')) {
        const body = JSON.parse(String(init?.body)) as { conversationId: string | null };
        attempts.push(body.conversationId);
        if (body.conversationId === 'cnv_stale') {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Not yours' } }), {
              status: 403,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
      }
      return server.fetch(input, init);
    };
    widget.destroy();
    widget = new Widget({ apiUrl: '/api/helpwell', fetch });
    await widget.mount();
    widget.store.set({ conversationId: 'cnv_stale' });
    widget.open({ name: 'chat', conversationId: 'cnv_stale' });
    await flush();

    await send('hello again');
    expect(attempts).toEqual(['cnv_stale', null]);
    expect(widget.store.state.conversationId).toBe('cnv_1');
    expect(text('.bubble--agent')).toContain('Open Billing');
    expect($('.notice--bad')).toBeNull();
  });

  it('does not let a slow fetch overwrite the conversation the visitor switched to', async () => {
    server.delay('/conversations/cnv_a', 60);
    widget.open({ name: 'chat', conversationId: 'cnv_a' });
    await flush(5);
    expect($('.t-skel-skeleton')).toBeTruthy();

    widget.go({ name: 'chat', conversationId: 'cnv_b' });
    await flush(120);

    expect(widget.store.state.conversationId).toBe('cnv_b');
    expect($$('.bubble--customer').map((b) => b.textContent)).toEqual(['second thread']);
    expect($('.notice--bad')).toBeNull();
  });

  it('shows the reply even if the panel was rebuilt while it was on its way', async () => {
    server.delay('/chat', 40);
    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = 'slow one';
    input.dispatchEvent(new Event('input'));
    click('.composer__send');
    await flush(5);

    widget.go({ name: 'help' });
    await flush();
    // Back to where they were: the same thread, not a fresh start.
    widget.back();
    await flush(80);

    expect(text('.bubble--agent')).toContain('Open Billing');
    expect($('[role="status"]')).toBeNull();
  });
});

describe('reset', () => {
  it.each([200, 503])(
    'ignores the previous visitor late chat response (%s) during a new send',
    async (status) => {
      server = createFakeServer();
      const pending: ((response: Response) => void)[] = [];
      const fetch: typeof globalThis.fetch = (input, init) => {
        if (String(input).endsWith('/chat')) return new Promise((resolve) => pending.push(resolve));
        return server.fetch(input, init);
      };
      widget = new Widget({ apiUrl: '/api/helpwell', fetch });
      await widget.mount();
      const send = async (message: string) => {
        widget.open({ name: 'chat', conversationId: null });
        await flush();
        const input = $('.composer textarea') as HTMLTextAreaElement;
        input.value = message;
        input.dispatchEvent(new Event('input'));
        click('.composer__send');
        await flush();
      };
      await widget.identify('visitor-a');
      await send('Visitor A private question');
      await widget.reset();
      await widget.identify('visitor-b');
      await send('Visitor B question');
      expect(pending).toHaveLength(2);
      pending[0]?.(
        Response.json(
          status === 200
            ? {
                conversationId: 'cnv_a_private',
                messageId: 'msg_a',
                text: 'Visitor A private answer',
                citations: [],
              }
            : { error: { code: 'unavailable', message: 'Old request failed' } },
          { status },
        ),
      );
      await flush();
      expect(widget.store.state.sending).toBe(true);
      expect(widget.store.state.conversationId).toBeNull();
      expect(widget.store.state.messages.map((message) => message.body)).toEqual([
        'Visitor B question',
      ]);
      expect($('.notice--bad')).toBeNull();
      pending[1]?.(
        Response.json({
          conversationId: 'cnv_b',
          messageId: 'msg_b',
          text: 'Visitor B answer',
          citations: [],
        }),
      );
      await flush();
      expect(widget.store.state.sending).toBe(false);
      expect(widget.store.state.conversationId).toBe('cnv_b');
      expect(widget.store.state.messages.map((message) => message.body)).toEqual([
        'Visitor B question',
        'Visitor B answer',
      ]);
    },
  );

  it('forgets the visitor on the server and starts the widget clean', async () => {
    await mount({}, { token: 'signed-token' });
    widget.open({ name: 'chat', conversationId: null });
    await flush();
    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    click('.composer__send');
    await flush(20);
    expect(widget.store.state.identified).toBe(true);
    expect(widget.store.state.conversationId).toBe('cnv_1');

    dispatch(widget, 'reset', []);
    await flush(10);

    expect(server.calls.find((c) => c.path === '/visitor/reset')?.method).toBe('POST');
    expect(widget.store.state).toMatchObject({
      conversationId: null,
      messages: [],
      identified: false,
      view: { name: 'home' },
    });
    // Home no longer offers the old thread.
    expect(text('.primary')).toBe('Ask a question');
  });
});

describe('pre-chat form', () => {
  beforeEach(async () => {
    await mount({ config: { widget: { preChat: { when: 'unknown_only' } } } as never });
    widget.open({ name: 'chat', conversationId: null });
    await flush();
  });

  it('asks before the first message when nobody has identified the visitor', () => {
    expect($('form')).toBeTruthy();
    expect($('.composer')).toBeNull();
  });

  it('animates in a validation message rather than submitting', () => {
    ($('form') as HTMLFormElement).requestSubmit();
    const error = $('.field__error');
    expect(error?.textContent).toBe('We need an email to reply to.');
    expect(error?.getAttribute('role')).toBe('alert');
    expect($('.field[data-invalid="true"]')).toBeTruthy();
  });

  it('rejects an address that is not one', () => {
    const email = $$('input').find((i) => i.getAttribute('type') === 'email') as HTMLInputElement;
    email.value = 'not-an-email';
    ($('form') as HTMLFormElement).requestSubmit();
    expect(text('.field__error')).toBe('That does not look like an email address.');
  });

  it('clears the error as soon as they start fixing it', () => {
    ($('form') as HTMLFormElement).requestSubmit();
    const email = $$('input').find((i) => i.getAttribute('type') === 'email') as HTMLInputElement;
    email.value = 'a';
    email.dispatchEvent(new Event('input'));
    expect($('.field__error')).toBeNull();
  });

  it('hands over to the thread and sends the details with the first message, once', async () => {
    const email = $$('input').find((i) => i.getAttribute('type') === 'email') as HTMLInputElement;
    email.value = 'ada@example.com';
    const textarea = $('form textarea') as HTMLTextAreaElement;
    textarea.value = 'How do I export invoices?';

    ($('form') as HTMLFormElement).requestSubmit();
    await flush(20);

    // The form is gone and the conversation is on screen.
    expect($('form')).toBeNull();
    expect($('.composer')).toBeTruthy();
    expect(text('.bubble--customer')).toBe('How do I export invoices?');
    expect(text('.bubble--agent')).toContain('Open Billing');

    const calls = server.calls.filter((c) => c.path === '/chat');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      email: 'ada@example.com',
      message: 'How do I export invoices?',
    });
  });

  it('is not asked again when a visitor reopens a conversation they already had', async () => {
    // After a reload the store holds no messages, only the list's id: the
    // form is for starting a conversation, and this one has started.
    widget.go({ name: 'messages' });
    await flush();
    widget.go({ name: 'chat', conversationId: 'cnv_a' });
    await flush(20);

    expect($('form')).toBeNull();
    expect(text('.bubble--customer')).toBe('first thread');
    expect(text('.bubble--agent')).toBe('A');
    expect($('.composer')).toBeTruthy();
  });

  it('is skipped entirely when the host app identified the visitor', async () => {
    widget.destroy();
    server = createFakeServer({
      config: { widget: { preChat: { when: 'unknown_only' } } } as never,
    });
    widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch, token: 'signed-token' });
    await widget.mount();
    widget.open({ name: 'chat', conversationId: null });
    await flush();
    expect($('.composer')).toBeTruthy();
    expect($('form')).toBeNull();
  });

  it('is skipped when the customer would rather ask after the first answer', async () => {
    widget.destroy();
    await mount({
      config: { widget: { preChat: { when: 'unknown_only', timing: 'after' } } },
    } as never);
    widget.open({ name: 'chat', conversationId: null });
    await flush();
    expect($('form')).toBeNull();
    expect($('.composer')).toBeTruthy();

    // The email card appears under the first answer instead, in the thread.
    const input = $('.composer textarea') as HTMLTextAreaElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    click('.composer__send');
    await flush(20);
    const card = $('.emailCard');
    expect(card).toBeTruthy();
    expect(card?.previousElementSibling?.querySelector('.bubble--agent')).toBeTruthy();
    expect(card?.querySelector('input[type="email"]')).toBeTruthy();
    expect(card?.textContent).toContain('We use it for this conversation and nothing else.');
  });
});

describe('help centre', () => {
  beforeEach(async () => {
    await mount();
    widget.open({ name: 'help' });
    await flush(20);
  });

  it('lists collections', () => {
    expect($$('.card__title').map((c) => c.textContent)).toEqual(['Billing', 'Setup']);
  });

  it('shows a collection description, and the article count when there is none', () => {
    expect($$('.card__meta').map((c) => c.textContent)).toEqual([
      'Invoices and receipts.',
      '1 article',
    ]);
  });

  it('titles the collection header with the name, not the folder id', async () => {
    ($$('.card')[0] as HTMLElement).click();
    await flush(20);
    expect($('.panel__title')?.textContent).toBe('Billing');
  });

  it('searches as you type and keeps the highlight', async () => {
    const input = $('.searchbox input') as HTMLInputElement;
    input.value = 'invoice';
    input.dispatchEvent(new Event('input'));
    await flush(320);

    expect($('.card__meta mark')?.textContent).toBe('invoices');
  });

  it('drops a search that was still waiting when the view changed', async () => {
    const input = $('.searchbox input') as HTMLInputElement;
    input.value = 'invoice';
    input.dispatchEvent(new Event('input'));
    widget.go({ name: 'roadmap' });
    await flush(320);
    expect(server.calls.some((c) => c.path.startsWith('/search'))).toBe(false);
  });

  it('opens an article and renders its Markdown', async () => {
    const input = $('.searchbox input') as HTMLInputElement;
    input.value = 'invoice';
    input.dispatchEvent(new Event('input'));
    await flush(320);

    // The search results render above the Browse list, so the hit is first.
    $$('.card')[0]?.click();
    await flush(20);

    expect(text('.article h1')).toBe('Exporting invoices');
    expect($('.article__body strong')?.textContent).toBe('Billing');
  });

  it('takes a rating on the article', async () => {
    widget.go({ name: 'article', slug: 'billing/invoices', from: { name: 'help' } });
    await flush(20);

    const yes = $$('.rate__btn').find((b) => b.textContent?.includes('Yes'));
    yes?.click();
    await flush(10);

    expect(text('.rate__q')).toBe('Thanks for letting us know.');
    expect(server.calls.some((c) => c.path === '/articles/billing/invoices/rating')).toBe(true);
  });
});

describe('an article that opens with its own title', () => {
  it('says the title once', async () => {
    await mount({
      routes: {
        'GET /articles/billing/refunds': {
          article: {
            slug: 'billing/refunds',
            title: 'Issuing a refund',
            description: null,
            collection: 'Billing',
            body: '# Issuing a refund\n\nOpen the charge and press **Refund**.',
            headings: [],
            applies_to: null,
            reading_minutes: 1,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          related: [],
        },
      },
    });
    widget.open({ name: 'article', slug: 'billing/refunds', from: { name: 'help' } });
    await flush(20);

    expect($$('.article h1').map((heading) => heading.textContent?.trim())).toEqual([
      'Issuing a refund',
    ]);
    expect($('.article__body strong')?.textContent).toBe('Refund');
  });
});

describe('updates', () => {
  it('shows the feed and never ships article bodies into the list', async () => {
    await mount();
    widget.open({ name: 'updates' });
    await flush(30);

    expect(text('.entry__title')).toBe('Faster exports');
    expect(text('.entry__version')).toBe('2.1.0');
    expect($('.entry__unread')).toBeTruthy();
  });

  it('shows an unread badge on the launcher and clears it on read', async () => {
    await mount({ config: { unread: 3 } });
    expect(text('.launcher__badge')).toBe('3');

    widget.open({ name: 'entry', id: 'chg_1' });
    await flush(30);
    expect(widget.store.state.unread).toBe(2);
  });
});

describe('roadmap', () => {
  beforeEach(async () => {
    await mount();
    widget.open({ name: 'roadmap' });
    await flush(30);
  });

  it('shows the lanes that have cards', () => {
    expect($$('.lane__name').map((l) => l.textContent)).toEqual(['Planned']);
    expect(text('.idea__title')).toBe('Dark mode');
  });

  it('votes optimistically and settles on the server count', async () => {
    const vote = $('.vote') as HTMLButtonElement;
    expect(vote.textContent).toContain('4');

    vote.click();
    // Optimistic, before the request resolves.
    expect(vote.textContent).toContain('5');
    expect(vote.getAttribute('aria-pressed')).toBe('true');

    await flush(20);
    expect(vote.textContent).toContain('5');
  });

  it('rolls a vote back when the server refuses it', async () => {
    server.fail('/roadmap/rmp_1/vote');
    const vote = $('.vote') as HTMLButtonElement;
    vote.click();
    await flush(20);

    expect(vote.getAttribute('aria-pressed')).toBe('false');
    expect(vote.textContent).toContain('4');
    expect(text('.notice--bad')).toContain('Support is unavailable.');
  });

  it('tells an anonymous visitor to sign in before suggesting an idea', () => {
    expect(text('.section')).toContain('Sign in to suggest an idea.');
  });
});

describe('single-page apps', () => {
  it('follows the route: hides on an excluded page and comes back after', async () => {
    await mount({ config: { widget: { displayRules: { exclude: ['/checkout/**'] } } } } as never);
    expect(document.querySelector('helpwell-widget')).toBeTruthy();
    widget.open();

    history.pushState({}, '', '/checkout/pay');
    await flush(200);
    expect(document.querySelector('helpwell-widget')).toBeNull();
    expect(widget.store.state.open).toBe(false);

    history.pushState({}, '', '/account');
    await flush(200);
    expect(document.querySelector('helpwell-widget')).toBeTruthy();

    // The browser's own navigation counts too.
    history.replaceState({}, '', '/checkout/done');
    await flush(200);
    expect(document.querySelector('helpwell-widget')).toBeNull();
  });

  it("asks for the new page's engagements once the route has settled", async () => {
    await mount();
    const before = server.calls.filter((c) => c.path.startsWith('/engage?')).length;
    history.pushState({}, '', '/settings');
    history.pushState({}, '', '/settings/billing');
    await flush(200);
    const after = server.calls.filter((c) => c.path.startsWith('/engage?'));
    expect(after).toHaveLength(before + 1);
    // Engage may add more context to the query; the path is what this is about.
    expect(after[after.length - 1]?.path).toMatch(/^\/engage\?path=%2Fsettings%2Fbilling(&|$)/);
  });

  it('removes what it added to the page, listeners included', async () => {
    const added = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const track = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      on: boolean,
    ) => {
      if (!listener) return;
      const set = added.get(type) ?? new Set();
      added.set(type, set);
      if (on) set.add(listener);
      else set.delete(listener);
    };
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, l: never) =>
      track(type, l, true)) as never);
    vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, l: never) =>
      track(type, l, false)) as never);
    vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, l: never) =>
      track(`document:${type}`, l, true)) as never);
    vi.spyOn(document, 'removeEventListener').mockImplementation(((type: string, l: never) =>
      track(`document:${type}`, l, false)) as never);

    await mount();
    widget.open();
    await flush();
    expect([...added.values()].some((set) => set.size > 0)).toBe(true);

    widget.destroy();
    for (const [type, set] of added) expect(set.size, type).toBe(0);
    expect(document.querySelector('helpwell-widget')).toBeNull();
    expect(document.querySelector('helpwell-engage')).toBeNull();
  });
});

describe('credit line', () => {
  it('draws the wordmark as SVG rather than an image', async () => {
    await mount();
    widget.open();
    await flush();

    const credit = $('.poweredBy');
    expect(credit?.textContent).toContain('Powered by');
    expect(credit?.querySelector('svg')).toBeTruthy();
    expect(credit?.querySelector('img')).toBeNull();
    // Cropped to the glyph bounds so both baselines line up.
    expect(credit?.querySelector('svg')?.getAttribute('viewBox')).toBe('24 24 776 171');
  });

  it('links to helpwell.ai with the referrer kept and a campaign tag', async () => {
    await mount();
    widget.open();
    await flush();

    const link = $('.poweredBy a');
    expect(link?.getAttribute('href')).toBe(
      'https://helpwell.ai/?utm_source=helpwell-widget&utm_medium=powered-by',
    );
    expect(link?.getAttribute('rel')).toBe('noopener');
  });

  it('is removed when the customer turns it off', async () => {
    await mount({ config: { helpCenter: { poweredBy: false } } as never });
    widget.open();
    await flush();
    expect($('.poweredBy')).toBeNull();
  });
});
