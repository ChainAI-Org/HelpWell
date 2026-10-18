/**
 * The chat features that only exist when something switches them on: the
 * inline email card, the support email under an unresolved answer, the
 * Turnstile bot check, attachments, and live state for a conversation a
 * person is handling.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WidgetConfig } from '../src/api.js';
import { FAST_POLL_MS, IDLE_POLL_MS, poller, typingSender } from '../src/live.js';
import { humanCheck, type TurnstileApi } from '../src/turnstile.js';
import { bodies, flush, type Mounted, mountWidget, unmount } from './helpers/mount.js';

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const agentReply = (extra: Record<string, unknown> = {}) => ({
  conversationId: 'cnv_1',
  messageId: 'msg_2',
  text: 'Someone from the team will look at this.',
  citations: [],
  unresolved: true,
  degraded: false,
  ...extra,
});

const thread = (extra: Record<string, unknown> = {}) => ({
  id: 'cnv_1',
  status: 'unresolved',
  messages: [
    {
      id: 'msg_1',
      role: 'customer',
      body: 'Can someone call me?',
      citations: [],
      feedback: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'msg_2',
      role: 'agent',
      body: 'Someone from the team will look at this.',
      citations: [],
      feedback: null,
      createdAt: '2026-09-01T10:00:01.000Z',
    },
  ],
  ...extra,
});

async function openChat(options: Parameters<typeof mountWidget>[0] = {}): Promise<Mounted> {
  const w = await mountWidget(options);
  w.widget.open({ name: 'chat', conversationId: null });
  await flush();
  return w;
}

/* ------------------------------------------------------------ email card */

describe('the inline email card', () => {
  it('appears under the answer that asked, with the consent line, and never as a banner', async () => {
    const w = await openChat({
      routes: {
        'POST /chat': agentReply({ askForEmail: { reason: 'So the team can call back.' } }),
      },
    });
    await w.send('Can someone call me?');

    const card = w.$('.emailCard');
    expect(card).toBeTruthy();
    expect(card?.previousElementSibling?.querySelector('.bubble--agent')).toBeTruthy();
    expect(card?.textContent).toContain('So the team can call back.');
    expect(card?.textContent).toContain('We use it for this conversation and nothing else.');
    expect(w.$('.notice--info')).toBeNull();
  });

  it('saves the address without sending a chat message, then folds to one line', async () => {
    const w = await openChat({
      routes: {
        'POST /chat': agentReply({ askForEmail: {} }),
        'POST /conversations/cnv_1/contact': {
          ok: true,
          contact: { email: 'ada@example.com', name: 'Ada' },
        },
      },
    });
    await w.send('Can someone call me?');
    const email = w.$<HTMLInputElement>('.emailCard input[type="email"]')!;
    email.value = 'Ada@Example.com';
    w.$<HTMLInputElement>('.emailCard input[name="name"]')!.value = 'Ada';
    w.$<HTMLFormElement>('.emailCard form')!.requestSubmit();
    await flush(20);

    expect(bodies(w.server, '/conversations/cnv_1/contact')).toEqual([
      { email: 'Ada@Example.com', name: 'Ada', honeypot: '' },
    ]);
    expect(bodies(w.server, '/chat')).toHaveLength(1);
    expect(w.text('.emailCard')).toContain(
      "Thanks, we'll use ada@example.com for this conversation.",
    );

    // "Change" opens the form again, filled in.
    w.click('.emailCard__change');
    expect(w.$<HTMLInputElement>('.emailCard input[type="email"]')?.value).toBe('ada@example.com');
  });

  it('shows why a blocked or disposable address was refused, in the card', async () => {
    const w = await openChat({ routes: { 'POST /chat': agentReply({ askForEmail: {} }) } });
    await w.send('Can someone call me?');
    w.server.status('/conversations/cnv_1/contact', 403, {
      error: { code: 'blocked', message: 'Please use an address we can reply to.' },
    });
    w.$<HTMLInputElement>('.emailCard input[type="email"]')!.value = 'x@mailinator.com';
    w.$<HTMLFormElement>('.emailCard form')!.requestSubmit();
    await flush(20);
    expect(w.text('.emailCard .field__error')).toBe('Please use an address we can reply to.');
    expect(w.$('.emailCard__done')).toBeNull();

    w.server.status('/conversations/cnv_1/contact', 403, {
      error: { code: 'blocked', message: 'That did not go through.' },
    });
    w.$<HTMLFormElement>('.emailCard form')!.requestSubmit();
    await flush(20);
    expect(w.text('.emailCard .field__error')).toBe('That did not go through.');
  });

  it('checks the address before sending it', async () => {
    const w = await openChat({ routes: { 'POST /chat': agentReply({ askForEmail: {} }) } });
    await w.send('Can someone call me?');
    w.$<HTMLInputElement>('.emailCard input[type="email"]')!.value = 'not an address';
    w.$<HTMLFormElement>('.emailCard form')!.requestSubmit();
    await flush();
    expect(w.text('.emailCard .field__error')).toBe('That does not look like an email address.');
    expect(bodies(w.server, '/conversations/cnv_1/contact')).toHaveLength(0);
  });

  it('is never shown to a visitor the host app identified', async () => {
    const w = await mountWidget(
      { routes: { 'POST /chat': agentReply({ askForEmail: {} }) } },
      { token: 'signed' },
    );
    w.widget.open({ name: 'chat', conversationId: null });
    await flush();
    await w.send('Can someone call me?');
    expect(w.$('.emailCard')).toBeNull();
  });

  it('comes back folded after a reload, from what the thread says', async () => {
    const w = await mountWidget({
      routes: {
        'GET /conversations/cnv_1': thread({
          contact: { email: 'ada@example.com', name: null, identified: false },
          emailAsk: { messageId: 'msg_2' },
        }),
      },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(20);
    expect(w.text('.emailCard')).toContain(
      "Thanks, we'll use ada@example.com for this conversation.",
    );
  });
});

/* ---------------------------------------------------------- support email */

describe('the support email', () => {
  const email = { product: { supportEmail: 'support@acme.com' } } as Partial<WidgetConfig>;

  it('follows an answer the agent could not give, as a quiet mailto line', async () => {
    const w = await openChat({ config: email, routes: { 'POST /chat': agentReply() } });
    await w.send('Can someone call me?');
    expect(w.text('.thread .supportEmail')).toBe('Email us at support@acme.com');
    expect(w.$('.thread .supportEmail a')?.getAttribute('href')).toBe('mailto:support@acme.com');
  });

  it('is not shown under an answer that resolved the question', async () => {
    const w = await openChat({ config: email });
    await w.send('How do I export invoices?');
    expect(w.$('.supportEmail')).toBeNull();
  });

  /** The same thread, with its agent answer as the server judged it. */
  const answered = (unresolved: boolean) =>
    thread({
      messages: thread().messages.map((m) =>
        m.role === 'agent' && unresolved ? { ...m, unresolved: true } : m,
      ),
    });

  it('comes back with an unanswered question on reload, and goes when a new conversation starts', async () => {
    const w = await mountWidget({
      config: email,
      routes: { 'GET /conversations/cnv_1': answered(true) },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(20);
    expect(w.text('.thread .supportEmail')).toContain('support@acme.com');
    // Under the answer that left the question open.
    expect(w.$('.thread .supportEmail')?.previousElementSibling?.textContent).toContain(
      'Someone from the team will look at this.',
    );

    w.widget.go({ name: 'chat', conversationId: null });
    await flush();
    expect(w.$('.thread .supportEmail')).toBeNull();
  });

  it('does not come back for small talk, whatever the conversation status says', async () => {
    // "hi" and a greeting back. The widget goes by the answers' own flags,
    // not the status, and no answer says a question went unanswered.
    const w = await mountWidget({
      config: email,
      routes: {
        'GET /conversations/cnv_1': thread({
          status: 'unresolved',
          messages: [
            { ...thread().messages[0], body: 'hi' },
            { ...thread().messages[1], body: 'Hi! What can I help you with?', smallTalk: true },
          ],
        }),
      },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(20);
    expect(w.text('.thread')).toContain('What can I help you with?');
    expect(w.$('.supportEmail')).toBeNull();
  });

  it('does not come back under an answered question', async () => {
    const w = await mountWidget({
      config: email,
      routes: { 'GET /conversations/cnv_1': answered(false) },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(20);
    expect(w.text('.thread')).toContain('Someone from the team will look at this.');
    expect(w.$('.supportEmail')).toBeNull();
  });

  it('stays under the unanswered question when the visitor only says thanks', async () => {
    const w = await openChat({ config: email, routes: { 'POST /chat': agentReply() } });
    await w.send('Can someone call me?');
    w.server.set(
      'POST /chat',
      agentReply({
        messageId: 'msg_4',
        text: 'You are welcome.',
        unresolved: false,
        smallTalk: true,
      }),
    );
    await w.send('thanks!');
    expect(w.text('.thread')).toContain('You are welcome.');
    expect(w.$('.thread .supportEmail')?.previousElementSibling?.textContent).toContain(
      'Someone from the team will look at this.',
    );
    expect(w.$$('.thread .supportEmail')).toHaveLength(1);
  });

  it('stays under the unanswered question after a reload, past the thanks', async () => {
    const w = await mountWidget({
      config: email,
      routes: {
        'GET /conversations/cnv_1': thread({
          messages: [
            ...answered(true).messages,
            { ...thread().messages[0], id: 'msg_3', body: 'thanks!' },
            { ...thread().messages[1], id: 'msg_4', body: 'You are welcome.', smallTalk: true },
          ],
        }),
      },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(20);
    expect(w.text('.thread')).toContain('You are welcome.');
    expect(w.$('.thread .supportEmail')?.previousElementSibling?.textContent).toContain(
      'Someone from the team will look at this.',
    );
  });

  it('goes once a later question is answered', async () => {
    const w = await openChat({ config: email, routes: { 'POST /chat': agentReply() } });
    await w.send('Can someone call me?');
    expect(w.$('.thread .supportEmail')).not.toBeNull();

    w.server.set(
      'POST /chat',
      agentReply({ messageId: 'msg_4', text: 'Billing, then Invoices.', unresolved: false }),
    );
    await w.send('How do I export invoices?');
    expect(w.text('.thread')).toContain('Billing, then Invoices.');
    expect(w.$('.supportEmail')).toBeNull();
  });

  it('is never shown when a support extension answers people', async () => {
    const w = await openChat({
      config: { ...email, support: { human: true } } as Partial<WidgetConfig>,
      routes: { 'POST /chat': agentReply() },
    });
    await w.send('Can someone call me?');
    expect(w.$('.supportEmail')).toBeNull();
    expect(w.text('.handoff__button')).toBe('Talk to a person');
  });

  it('shows nothing for a value that is not a plain address', async () => {
    for (const value of ['javascript:alert(1)', 'help@acme.com?cc=boss@acme.com', 'not an email']) {
      const w = await openChat({
        config: { product: { supportEmail: value } } as Partial<WidgetConfig>,
        routes: { 'POST /chat': agentReply() },
      });
      await w.send('Can someone call me?');
      expect(w.$('.supportEmail'), value).toBeNull();
      unmount();
    }
  });
});

/* ------------------------------------------------------------- turnstile */

function fakeTurnstile(tokens: string[] = ['tok_1', 'tok_2', 'tok_3']) {
  const rendered: { options: Record<string, unknown> }[] = [];
  let resets = 0;
  let next = 0;
  const api: TurnstileApi = {
    render(_container, options) {
      rendered.push({ options });
      queueMicrotask(() => (options.callback as (t: string) => void)(tokens[next++] ?? 'x'));
      return 'w1';
    },
    reset() {
      resets++;
      const options = rendered[0]!.options;
      queueMicrotask(() => (options.callback as (t: string) => void)(tokens[next++] ?? 'x'));
    },
    remove() {},
  };
  return { api, rendered, resets: () => resets };
}

describe('the Turnstile bot check', () => {
  const botConfig = {
    botCheck: { provider: 'turnstile', siteKey: '0xSITE' },
  } as Partial<WidgetConfig>;

  it('loads nothing from Cloudflare when the check is off', async () => {
    const w = await openChat();
    await w.send('hello');
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    expect(bodies(w.server, '/chat')[0]).not.toHaveProperty('turnstileToken');
  });

  it('sends a token with the first message only, then trusts the conversation', async () => {
    const fake = fakeTurnstile();
    (window as unknown as { turnstile?: TurnstileApi }).turnstile = fake.api;
    try {
      const w = await openChat({ config: botConfig });
      await w.send('hello');
      await w.send('and another thing');
      const sent = bodies(w.server, '/chat') as { turnstileToken?: string }[];
      expect(sent[0]?.turnstileToken).toBe('tok_1');
      expect(sent[1]?.turnstileToken).toBeUndefined();
      expect(fake.rendered[0]?.options).toMatchObject({
        sitekey: '0xSITE',
        appearance: 'interaction-only',
      });
    } finally {
      delete (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    }
  });

  it('runs a fresh challenge and retries once when the server refuses the token', async () => {
    const fake = fakeTurnstile();
    (window as unknown as { turnstile?: TurnstileApi }).turnstile = fake.api;
    try {
      const w = await openChat({ config: botConfig });
      // The server refuses every token here, so both tries are seen.
      w.server.status('/chat', 403, {
        error: {
          code: 'forbidden',
          message: 'We could not confirm you are human.',
          details: { humanCheck: 'failed' },
        },
      });
      await w.send('hello');
      const sent = bodies(w.server, '/chat') as { turnstileToken?: string }[];
      expect(sent.map((b) => b.turnstileToken)).toEqual(['tok_1', 'tok_2']);
      expect(fake.resets()).toBe(1);
      // Both refused: a friendly error with a way to try again.
      expect(w.text('.notice--bad')).toContain('We could not confirm you are human.');
      expect(w.$('.notice--bad .notice__retry')).toBeTruthy();
    } finally {
      delete (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    }
  });

  it('adds the script once, only when a token is first needed', async () => {
    const container = document.createElement('div');
    let loads = 0;
    const fake = fakeTurnstile();
    const check = humanCheck('0xSITE', container, async () => {
      loads++;
      return fake.api;
    });
    expect(loads).toBe(0);
    expect(await check.token()).toBe('tok_1');
    expect(await check.token()).toBe('tok_2');
    expect(loads).toBe(1);
    expect(fake.rendered).toHaveLength(1);
    expect(fake.resets()).toBe(1);
    check.destroy();
    await expect(check.token()).rejects.toThrow();
  });

  it('rejects when the challenge fails, so the view can say so', async () => {
    const api: TurnstileApi = {
      render(_c, options) {
        queueMicrotask(() => (options['error-callback'] as () => void)());
        return 'w';
      },
      reset() {},
      remove() {},
    };
    const check = humanCheck('0xSITE', document.createElement('div'), async () => api);
    await expect(check.token()).rejects.toThrow(/failed/);
  });
});

/* ----------------------------------------------------------- attachments */

describe('attachments', () => {
  const withUploads = {
    support: { human: true, uploads: { maxBytes: 1024, types: ['image/*', 'application/pdf'] } },
  } as Partial<WidgetConfig>;

  it('offers no paperclip without a support extension', async () => {
    const w = await openChat();
    await w.send('hello');
    expect(w.$('.composer__attach')?.hidden ?? true).toBe(true);
    expect(w.$('input[type="file"]')).toBeTruthy(); // present in the DOM, never reachable
  });

  it('offers one once the conversation exists, when the extension takes files', async () => {
    const w = await openChat({ config: withUploads });
    expect(w.$('.composer__attach')?.hidden).toBe(true);
    await w.send('hello');
    expect(w.$('.composer__attach')?.hidden).toBe(false);
    expect(w.$('input[type="file"]')?.getAttribute('accept')).toBe('image/*,application/pdf');
  });

  it('refuses a file that is too large or the wrong type before uploading it', async () => {
    const w = await openChat({ config: withUploads });
    await w.send('hello');
    const input = w.$<HTMLInputElement>('input[type="file"]')!;
    const big = new File([new Uint8Array(2048)], 'big.png', { type: 'image/png' });
    const zip = new File([new Uint8Array(10)], 'code.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { value: [big, zip], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
    const errors = w.$$('.upload[data-state="failed"]').map((row) => row.textContent);
    expect(errors[0]).toContain('big.png is too large. The limit is 1 KB.');
    expect(errors[1]).toContain('code.zip is not a type of file that can be attached here.');
    expect(w.server.calls.some((c) => c.path.endsWith('/attachments'))).toBe(false);
  });

  it('uploads the bytes, not a form, and shows the file in the thread', async () => {
    const w = await openChat({
      config: withUploads,
      routes: {
        'POST /conversations/cnv_1/attachments': {
          id: 'att_1',
          url: 'https://files.example/att_1.png',
          name: 'screen.png',
          type: 'image/png',
          size: 4,
        },
      },
    });
    await w.send('hello');
    const input = w.$<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'screen.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush(20);

    const call = w.server.calls.find((c) => c.path === '/conversations/cnv_1/attachments');
    expect(call?.body).toBeInstanceOf(Blob);
    const thumb = w.$<HTMLImageElement>('.attachment--image img');
    expect(thumb?.getAttribute('src')).toBe('https://files.example/att_1.png');
    expect(thumb?.getAttribute('alt')).toBe('screen.png');
  });

  it('keeps a failed upload on screen with a retry', async () => {
    const w = await openChat({ config: withUploads });
    await w.send('hello');
    w.server.status('/conversations/cnv_1/attachments', 400, {
      error: { code: 'bad_request', message: 'That type of file cannot be attached here.' },
    });
    const input = w.$<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'a.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await flush(20);
    expect(w.text('.upload[data-state="failed"]')).toContain(
      'That type of file cannot be attached here.',
    );
    expect(w.$('.upload .notice__retry')).toBeTruthy();
  });

  it('takes a pasted screenshot', async () => {
    const w = await openChat({
      config: withUploads,
      routes: {
        'POST /conversations/cnv_1/attachments': {
          id: 'att_2',
          url: 'https://files.example/paste.png',
          name: 'image.png',
          type: 'image/png',
          size: 3,
        },
      },
    });
    await w.send('hello');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['abc'], 'image.png', { type: 'image/png' })] },
    });
    w.$('.composer textarea')!.dispatchEvent(paste);
    await flush(20);
    expect(paste.defaultPrevented).toBe(true);
    expect(
      w.server.calls.filter((c) => c.path === '/conversations/cnv_1/attachments'),
    ).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ live state */

describe('a conversation a person is handling', () => {
  const live = { support: { human: true, typing: true, presence: true } } as Partial<WidgetConfig>;

  async function humanThread(presence: Record<string, unknown>): Promise<Mounted> {
    const w = await mountWidget({
      config: live,
      routes: {
        'GET /conversations/cnv_1': thread({ mode: 'human' }),
        'GET /conversations/cnv_1/presence': presence,
      },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(30);
    return w;
  }

  it('shows who is typing, with a name, and what they have read', async () => {
    const w = await humanThread({ typing: { name: 'Maya' }, seenUpTo: 'msg_2' });
    expect(w.text('.bubble--typing')).toContain('Maya is typing…');
    const seen = w.$('.seen');
    expect(seen?.textContent).toBe('Seen');
    // Under the visitor's own message, the newest one the teammate has read.
    expect(seen?.previousElementSibling?.querySelector('.bubble--customer')?.textContent).toBe(
      'Can someone call me?',
    );
  });

  it("shows the extension's notice, and the email card when it asks", async () => {
    const w = await humanThread({
      typing: null,
      notice: { text: "If you're away, we'll email you the reply.", askEmail: true },
    });
    expect(w.text('.notice--info')).toBe("If you're away, we'll email you the reply.");
    expect(w.$('.notice--info + .emailCard')).toBeTruthy();
  });

  it('sends typing to the team, throttled', async () => {
    const w = await humanThread({ typing: null });
    const input = w.$<HTMLTextAreaElement>('.composer textarea')!;
    for (const value of ['h', 'he', 'hel', 'hell']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await flush();
    expect(bodies(w.server, '/conversations/cnv_1/typing')).toEqual([{ typing: true }]);
  });

  it('does not poll presence for a conversation the agent is answering', async () => {
    const w = await mountWidget({
      config: live,
      routes: { 'GET /conversations/cnv_1': thread({ mode: 'ai' }) },
    });
    w.widget.open({ name: 'chat', conversationId: 'cnv_1' });
    await flush(30);
    expect(w.server.calls.some((c) => c.path.endsWith('/presence'))).toBe(false);
  });
});

describe('polling', () => {
  it('polls every 3 seconds while in use, 15 when idle, and not at all while hidden', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let busy = true;
    const tick = vi.fn(async () => {});
    poller({
      tick,
      interval: () => (busy ? FAST_POLL_MS : IDLE_POLL_MS),
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    expect(tick).toHaveBeenCalledTimes(2);

    busy = false;
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS); // the tick already scheduled at the fast rate
    expect(tick).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 2);
    expect(tick).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(tick).toHaveBeenCalledTimes(4);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);
    expect(tick).toHaveBeenCalledTimes(4);

    // Back on the tab: poll at once.
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(5);

    controller.abort();
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it('sends typing at most once every 3 seconds, and says when it stops', async () => {
    vi.useFakeTimers();
    const sent: boolean[] = [];
    const typing = typingSender(async (value) => {
      sent.push(value);
    });
    typing.update(true);
    await vi.advanceTimersByTimeAsync(1000);
    typing.update(true);
    await vi.advanceTimersByTimeAsync(1000);
    typing.update(true);
    expect(sent).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1500);
    typing.update(true);
    expect(sent).toEqual([true, true]);
    typing.update(false);
    expect(sent).toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([true, true, false]);
    typing.stop();
  });
});
