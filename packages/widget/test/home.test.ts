/**
 * Home blocks, status, and the changelog announcement styles.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeBlock, WidgetConfig } from '../src/api.js';
import { ANNOUNCE_DELAY_MS } from '../src/changelog-notify.js';
import { DEFAULT_HOME_BLOCKS, registerHomeBlock } from '../src/components/home-blocks.js';
import { flush, type Mounted, mountWidget, unmount } from './helpers/mount.js';

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const withBlocks = (blocks: HomeBlock[], extra: Record<string, unknown> = {}) =>
  ({ widget: { home: { blocks }, ...extra } }) as unknown as Partial<WidgetConfig>;

async function home(config: Partial<WidgetConfig> = {}, routes: Record<string, unknown> = {}) {
  const w = await mountWidget({ config, routes });
  w.widget.open();
  await flush(20);
  return w;
}

function pageHtml(w: Mounted): string {
  return w.$('.panel__body .page')?.innerHTML ?? '';
}

/* ------------------------------------------------------------ home blocks */

describe('Home blocks', () => {
  it('draws the old Home by default, exactly, whether or not the server sends blocks', async () => {
    const old = await home({ widget: { statusUrl: 'https://status.acme.com' } } as never);
    const before = pageHtml(old);
    unmount();
    const configured = await home(
      withBlocks(DEFAULT_HOME_BLOCKS, { statusUrl: 'https://status.acme.com' }),
    );
    expect(pageHtml(configured)).toBe(before);

    // Search, the new-conversation button, what's new, then the status link.
    const sections = configured.$$('.panel__body .page > *');
    expect(sections[0]?.querySelector('.searchbox')).toBeTruthy();
    expect(sections[1]?.querySelector('.primary')?.textContent).toBe('Ask a question');
    expect(sections[2]?.querySelector('.section__title')?.textContent).toBe("What's new");
    expect(sections[3]?.querySelector('.statusLink')?.getAttribute('href')).toBe(
      'https://status.acme.com',
    );
  });

  it('skips a type it does not know, and a registered one draws', async () => {
    const off = registerHomeBlock('form', (block) => {
      const el = document.createElement('p');
      el.className = 'test-form';
      el.textContent = `form ${(block as { formId?: string }).formId}`;
      return el;
    });
    try {
      const w = await home(
        withBlocks([{ type: 'hologram' }, { type: 'form', formId: 'frm_1' }, { type: 'search' }]),
      );
      const children = w.$$('.panel__body .page > *');
      expect(children).toHaveLength(2);
      expect(children[0]?.textContent).toBe('form frm_1');
      expect(children[1]?.querySelector('.searchbox')).toBeTruthy();
    } finally {
      off();
    }
  });

  it('skips a block whose renderer throws, and keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off = registerHomeBlock('form', () => {
      throw new Error('boom');
    });
    try {
      const w = await home(withBlocks([{ type: 'form' }, { type: 'newConversation' }]));
      expect(w.$$('.panel__body .page > *')).toHaveLength(1);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      off();
    }
  });

  it('draws links, a card and chosen articles', async () => {
    const w = await home(
      withBlocks([
        {
          type: 'links',
          title: 'Elsewhere',
          items: [
            { label: 'API docs', url: 'https://acme.com/api', icon: 'article' },
            { label: 'Bad', url: 'javascript:alert(1)' },
          ],
        },
        {
          type: 'card',
          title: 'Office hours',
          body: 'Join us **Thursdays**.',
          image: 'https://cdn.acme.com/office.png',
          cta: { label: 'Book a slot', url: 'https://acme.com/book' },
        },
        { type: 'articles', title: 'Start here', slugs: ['billing/invoices'] },
      ]),
    );
    const links = w.$$<HTMLAnchorElement>('.row--link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://acme.com/api']);
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(w.$('.homeCard strong')?.textContent).toBe('Thursdays');
    expect(w.$('.homeCard__cta')?.getAttribute('href')).toBe('https://acme.com/book');
    expect(w.$('.homeCard__image')?.getAttribute('src')).toBe('https://cdn.acme.com/office.png');
    expect(w.$$('.section__title').map((t) => t.textContent)).toContain('Start here');
    const lists = w.$$('.rowlist');
    expect(lists[lists.length - 1]?.querySelector('.row__title')?.textContent).toBe(
      'Exporting invoices',
    );
  });
});

/* ---------------------------------------------------- greeting and email */

describe('Home greeting', () => {
  it('says hello in plain words, with no emoji', async () => {
    const w = await home();
    expect(w.text('.panel__title')).toBe('Hi there');
    expect(w.text('.panel__header')).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('greets a visitor the host app identified by their first name', async () => {
    const w = await mountWidget(
      { routes: { 'POST /identify': { contactId: 'con_1', identified: true, firstName: 'Ada' } } },
      { token: 'signed' },
    );
    w.widget.open();
    await flush(20);
    expect(w.text('.panel__title')).toBe('Hi Ada');

    await w.widget.reset();
    await flush(20);
    expect(w.text('.panel__title')).toBe('Hi there');
  });

  const greeting = (value: unknown) =>
    ({ widget: { greeting: value } }) as unknown as Partial<WidgetConfig>;

  it('keeps the standard words when no greeting is set, an older server sends none, or both are empty', async () => {
    for (const config of [
      {},
      greeting(undefined),
      greeting({}),
      greeting({ title: '', subtitle: '' }),
    ]) {
      const w = await home(config);
      expect(w.text('.panel__title')).toBe('Hi there');
      expect(w.text('.panel__subtitle')).toBe('How can we help with Acme?');
      unmount();
    }
    // Spaces alone are no greeting either.
    const spaces = await home(greeting({ title: '   ', subtitle: ' ' }));
    expect(spaces.text('.panel__title')).toBe('Hi there');
    expect(spaces.text('.panel__subtitle')).toBe('How can we help with Acme?');
  });

  it('shows the owner’s own title and subtitle, each on its own', async () => {
    const both = await home(greeting({ title: 'Welcome aboard', subtitle: 'Ask us anything.' }));
    expect(both.text('.panel__title')).toBe('Welcome aboard');
    expect(both.text('.panel__subtitle')).toBe('Ask us anything.');
    unmount();

    const titleOnly = await home(greeting({ title: 'Hello', subtitle: '' }));
    expect(titleOnly.text('.panel__title')).toBe('Hello');
    expect(titleOnly.text('.panel__subtitle')).toBe('How can we help with Acme?');
    unmount();

    const subtitleOnly = await home(greeting({ title: '', subtitle: 'We reply within minutes.' }));
    expect(subtitleOnly.text('.panel__title')).toBe('Hi there');
    expect(subtitleOnly.text('.panel__subtitle')).toBe('We reply within minutes.');
  });

  it('fills in {product} and {first_name}, and says "there" when the app has not said who is visiting', async () => {
    const config = greeting({
      title: 'Welcome, {first_name}',
      subtitle: 'Ask us about {product}. {product} is why we are here.',
    });
    const anonymous = await home(config);
    expect(anonymous.text('.panel__title')).toBe('Welcome, there');
    expect(anonymous.text('.panel__subtitle')).toBe('Ask us about Acme. Acme is why we are here.');
    unmount();

    const identified = await mountWidget(
      {
        config,
        routes: { 'POST /identify': { contactId: 'con_1', identified: true, firstName: 'Ada' } },
      },
      { token: 'signed' },
    );
    identified.widget.open();
    await flush(20);
    expect(identified.text('.panel__title')).toBe('Welcome, Ada');
  });

  it('fills in {{ product.name }} and {{ contact.first_name }}, the way email is personalised', async () => {
    const config = greeting({
      title: 'Welcome, {{ contact.first_name }}',
      subtitle: 'Ask {{product.name}} anything, {{ contact.first_name | default: "friend" }}.',
    });
    const anonymous = await home(config);
    expect(anonymous.text('.panel__title')).toBe('Welcome, there');
    expect(anonymous.text('.panel__subtitle')).toBe('Ask Acme anything, friend.');
    unmount();

    const identified = await mountWidget(
      {
        config,
        routes: { 'POST /identify': { contactId: 'con_1', identified: true, firstName: 'Ada' } },
      },
      { token: 'signed' },
    );
    identified.widget.open();
    await flush(20);
    expect(identified.text('.panel__title')).toBe('Welcome, Ada');
    expect(identified.text('.panel__subtitle')).toBe('Ask Acme anything, Ada.');
  });

  it('draws the owner’s words as text, never as markup', async () => {
    const w = await home(
      greeting({ title: '<img src=x onerror=alert(1)>', subtitle: '$& <b>bold</b> {product}' }),
    );
    expect(w.$('.panel__header img')).toBeNull();
    expect(w.$('.panel__subtitle b')).toBeNull();
    expect(w.text('.panel__title')).toBe('<img src=x onerror=alert(1)>');
    // A "$&" in the text is not a replacement pattern for the product name.
    expect(w.text('.panel__subtitle')).toBe('$& <b>bold</b> Acme');
  });

  it('greets only on Home: other views keep their own titles', async () => {
    const w = await home(greeting({ title: 'Welcome', subtitle: 'Hello there.' }));
    w.click('#hw-tab-help');
    await flush(20);
    expect(w.text('.panel__title')).toBe('Help center');
    expect(w.$('.panel__subtitle')).toBeNull();
  });
});

describe('the support email on Home', () => {
  const email = { supportEmail: 'support@acme.com' };

  it('sits under the links block', async () => {
    const w = await home({
      product: { name: 'Acme', locale: 'en', ...email },
      widget: {
        home: {
          blocks: [
            { type: 'links', title: 'Help', items: [{ label: 'Docs', url: 'https://acme.com' }] },
            { type: 'newConversation' },
          ],
        },
      },
    } as never);
    const sections = w.$$('.panel__body .page > *');
    expect(sections).toHaveLength(3);
    expect(sections[0]?.querySelector('.row--link')).toBeTruthy();
    expect(sections[1]?.textContent).toBe('Email us at support@acme.com');
    expect(sections[1]?.querySelector('a')?.getAttribute('href')).toBe('mailto:support@acme.com');
  });

  it('goes at the foot of Home when there are no links', async () => {
    const w = await home({ product: { name: 'Acme', locale: 'en', ...email } } as never);
    const sections = w.$$('.panel__body .page > *');
    expect(sections.at(-1)?.textContent).toBe('Email us at support@acme.com');
  });

  it('is not there when none is set, or when a support extension answers people', async () => {
    expect((await home()).$('.supportEmail')).toBeNull();
    unmount();
    const extended = await home({
      product: { name: 'Acme', locale: 'en', ...email },
      support: { human: true },
    } as never);
    expect(extended.$('.supportEmail')).toBeNull();
  });
});

/* ----------------------------------------------------------------- status */

describe('status', () => {
  const incident = {
    level: 'major_outage',
    message: 'Exports are failing',
    url: 'https://status.acme.com',
    incidents: [],
    source: 'statuspage',
    updatedAt: null,
  };

  it('asks for status only when one is configured', async () => {
    const w = await home();
    expect(w.server.calls.some((c) => c.path === '/status')).toBe(false);
  });

  it('shows a row on Home and a dot on the launcher during an incident', async () => {
    const w = await mountWidget({
      config: { widget: { statusUrl: 'https://status.acme.com' } } as never,
      routes: { 'GET /status': incident },
    });
    await flush(10);
    expect(w.$('.launcher__status')?.dataset.level).toBe('major_outage');
    w.widget.open();
    await flush(10);
    expect(w.text('.statusRow__text')).toBe('Exports are failing');
    expect(w.$('.statusRow')?.getAttribute('href')).toBe('https://status.acme.com');
    // The dot steps aside while the panel is open.
    expect(w.$('.launcher__status')).toBeNull();
  });

  it('puts no dot on the launcher when all is well', async () => {
    const w = await mountWidget({
      config: { widget: { statusUrl: 'https://status.acme.com' } } as never,
      routes: { 'GET /status': { ...incident, level: 'operational', message: 'All good' } },
    });
    await flush(10);
    expect(w.$('.launcher__status')).toBeNull();
  });

  it('reads a manual status too', async () => {
    const w = await mountWidget({
      config: {
        widget: { status: { mode: 'manual', level: 'maintenance', message: 'Upgrading' } },
      } as never,
      routes: {
        'GET /status': { ...incident, level: 'maintenance', message: 'Upgrading', url: null },
      },
    });
    await flush(10);
    expect(w.$('.launcher__status')?.dataset.level).toBe('maintenance');
  });
});

/* ------------------------------------------------- changelog announcements */

describe('changelog announcements', () => {
  async function announcing(style: string, routes: Record<string, unknown> = {}) {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const w = await mountWidget({
      config: { unread: 1, changelog: { notification: style } } as never,
      routes,
    });
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS + 10);
    return w;
  }

  it('badge: a count on the launcher, and nothing else', async () => {
    const w = await announcing('badge');
    expect(w.text('.launcher__badge')).toBe('1');
    expect(w.$('.announce')).toBeNull();
  });

  it('popup: a card above the launcher; dismissing marks it read', async () => {
    const w = await announcing('popup');
    expect(w.text('.announce--popup .announce__title')).toBe('Faster exports');
    w.click('.announce--popup .announce__close');
    await vi.advanceTimersByTimeAsync(300);
    expect(w.$('.announce--popup')).toBeNull();
    expect(w.server.calls.some((c) => c.path === '/changelog/chg_1/read')).toBe(true);
  });

  it('modal: the newest entry in a dialog; Read more opens it in the panel', async () => {
    const w = await announcing('modal');
    const dialog = w.$('.announce--modal [role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(w.text('.announce--modal .announce__title')).toBe('Faster exports');
    w.click('.announce--modal .primary');
    await vi.advanceTimersByTimeAsync(300);
    expect(w.widget.store.state.open).toBe(true);
    expect(w.widget.store.state.view).toEqual({ name: 'entry', id: 'chg_1' });
    expect(w.$('.announce--modal')).toBeNull();
  });

  it('drawer: what is new, listed from the side', async () => {
    const w = await announcing('drawer');
    expect(w.$$('.announce--drawer .announce__item')).toHaveLength(1);
    w.click('.announce--drawer .loadmore');
    expect(w.widget.store.state.view).toEqual({ name: 'updates' });
  });

  it('none: no badge, no dot, no announcement, not even a request', async () => {
    const w = await announcing('none');
    expect(w.$('.launcher__badge')).toBeNull();
    expect(w.$('.announce')).toBeNull();
    expect(w.server.calls.filter((c) => c.path.startsWith('/changelog?'))).toHaveLength(0);
  });

  it('embed: renders an inline feed in the page, and no launcher badge', async () => {
    const slot = document.createElement('div');
    slot.setAttribute('data-helpwell-changelog', '');
    document.body.appendChild(slot);
    const w = await announcing('embed');
    await vi.advanceTimersByTimeAsync(20);
    expect(w.$('.launcher__badge')).toBeNull();
    const feed = slot.shadowRoot;
    expect(feed?.querySelector('.feed__title')?.textContent).toBe('Faster exports');
    expect(feed?.querySelector('.feed__new')?.textContent).toBe('New');

    // Opening an entry in place reads it.
    feed?.querySelector<HTMLButtonElement>('.feed__toggle')?.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(feed?.querySelector('.feed__body strong')?.textContent).toBe('much');
    expect(feed?.querySelector('.feed__new')).toBeNull();
    expect(w.server.calls.some((c) => c.path === '/changelog/chg_1/read')).toBe(true);
  });

  it('keeps "new" in this browser for a visitor the server cannot track yet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const recent = new Date(Date.now() - 86_400_000).toISOString();
    const untracked = {
      items: [
        {
          id: 'chg_9',
          version: '3.0.0',
          title: 'Dark mode',
          summary: null,
          tags: [],
          coverUrl: null,
          publishedAt: recent,
        },
      ],
      nextCursor: null,
    };
    let w = await mountWidget({
      config: { unread: 0, changelog: { notification: 'popup' } } as never,
      routes: { 'GET /changelog': untracked },
    });
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS + 10);
    expect(w.widget.store.state.news?.tracking).toBe('local');
    expect(w.text('.launcher__badge')).toBe('1');
    w.click('.announce--popup .announce__close');
    await vi.advanceTimersByTimeAsync(300);
    expect(w.$('.launcher__badge')).toBeNull();

    // The next page load remembers.
    w.widget.destroy();
    w = await mountWidget({
      config: { unread: 0, changelog: { notification: 'popup' } } as never,
      routes: { 'GET /changelog': untracked },
    });
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS + 10);
    expect(w.$('.announce--popup')).toBeNull();
    expect(w.$('.launcher__badge')).toBeNull();
  });

  it('waits while the panel is open, rather than covering it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const w = await mountWidget({ config: { changelog: { notification: 'modal' } } as never });
    w.widget.open();
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS + 10);
    expect(w.$('.announce--modal')).toBeNull();
  });
});
