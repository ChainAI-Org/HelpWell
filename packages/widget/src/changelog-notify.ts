/**
 * Announcing new changelog entries (CL-07), in the style Settings pick.
 *
 *   badge   the count on the launcher and a dot on the Updates tab
 *   popup   the badge, plus a small card above the launcher for the newest entry
 *   modal   the badge, plus the newest entry in a dialog over the page
 *   drawer  the badge, plus a panel from the side of the page listing what is new
 *   embed   an inline feed wherever the page has <div data-helpwell-changelog>,
 *           with "New" on what the visitor has not read; no launcher badge
 *   none    nothing at all
 *
 * The inline feed renders for any style but `none` wherever the element is,
 * because a page that placed it asked for it; `embed` is the style where it is
 * the only announcement.
 *
 * "New" is tracked per visitor on the server (the changelog's read receipts)
 * whenever the visitor has a HelpWell cookie. A visitor who has never talked
 * to the widget has none, and minting one on every page view would fill the
 * contacts table, so for them this browser keeps the record in localStorage
 * instead. Dismissing an announcement marks what it showed as read in both
 * places, so it does not come back on the next page.
 */

import type { Api, ChangelogSummary } from './api.js';
import { monthLabel } from './components/common.js';
import { h, replace, svg } from './dom.js';
import { icons } from './icons.js';
import { renderRich, safeMediaUrl } from './media.js';
import type { Store, View } from './state.js';

export type AnnouncementStyle = 'badge' | 'popup' | 'modal' | 'drawer' | 'embed' | 'none';

/** What the announcer needs from the widget. */
export interface AnnouncerHost {
  api: Api;
  store: Store;
  /** The widget's shadow root, where popups, modals and drawers are drawn. */
  root: ShadowRoot;
  /** Whether the widget is on this page at all (display rules). */
  shown(): boolean;
  open(view: View): void;
}

export interface Announcer {
  /** Look again: after identify, or when the page changes. */
  refresh(): void;
  destroy(): void;
}

const SEEN_KEY = 'helpwell:changelog-seen';
/** For a visitor the server cannot track, older than this is not news. */
const LOCAL_WINDOW_MS = 30 * 86_400_000;
/** A beat after the page settles, so the announcement is not the first thing that moves. */
export const ANNOUNCE_DELAY_MS = 1_200;
const NEWS_LIMIT = 5;

export function announcementStyle(value: string | undefined): AnnouncementStyle {
  return value === 'popup' ||
    value === 'modal' ||
    value === 'drawer' ||
    value === 'embed' ||
    value === 'none'
    ? value
    : 'badge';
}

/* --------------------------------------------------------- local record */

function readSeen(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Iterable<string>): void {
  try {
    const all = [...readSeen(), ...ids];
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set(all)].slice(-200)));
  } catch {
    // Private mode or blocked storage: the server record is the one that counts.
  }
}

/**
 * The visitor has seen these: note it in this browser, and drop them from
 * what the badge counts. Opening an entry, dismissing an announcement and
 * "Mark all as read" all end here.
 */
export function noteSeen(store: Store, ids: string[] | 'all'): void {
  const news = store.state.news;
  const seen = ids === 'all' ? (news?.items.map((item) => item.id) ?? []) : ids;
  writeSeen(seen);
  if (!news) return;
  const drop = new Set(seen);
  store.set({
    news: { ...news, items: ids === 'all' ? [] : news.items.filter((item) => !drop.has(item.id)) },
  });
}

/** What this visitor has not seen, from the newest entries, and who is keeping track. */
export async function loadNews(
  api: Api,
  store: Store,
  now: () => number = Date.now,
): Promise<ChangelogSummary[]> {
  const { items } = await api.changelog(null, NEWS_LIMIT);
  const tracking = items.some((item) => typeof item.read === 'boolean') ? 'server' : 'local';
  const seen = readSeen();
  const fresh = items.filter((item) => {
    if (seen.has(item.id)) return false;
    if (tracking === 'server') return item.read === false;
    const at = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
    return Number.isFinite(at) && now() - at < LOCAL_WINDOW_MS;
  });
  store.set({ news: { tracking, items: fresh } });
  return fresh;
}

/* ------------------------------------------------------------ announcer */

export function mountAnnouncements(host: AnnouncerHost): Announcer {
  const style = announcementStyle(host.store.state.config?.changelog.notification);
  let surface: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let announced = false;
  let destroyed = false;
  const embeds = new Map<Element, ShadowRoot>();

  const dismiss = (items: ChangelogSummary[]) => {
    close();
    const ids = items.map((item) => item.id);
    noteSeen(host.store, ids);
    for (const id of ids) {
      void host.api.markRead(id).catch(() => {
        // The local record keeps it from coming back on this browser.
      });
    }
  };

  const close = () => {
    const el = surface;
    surface = null;
    if (!el) return;
    el.dataset.leaving = 'true';
    setTimeout(() => el.remove(), 180);
  };

  const read = (entry: ChangelogSummary) => {
    close();
    noteSeen(host.store, [entry.id]);
    host.open({ name: 'entry', id: entry.id });
  };

  const announce = (items: ChangelogSummary[]) => {
    if (announced || destroyed || items.length === 0) return;
    if (!host.shown() || host.store.state.open) return;
    announced = true;
    if (style === 'popup')
      surface = popup(items[0]!, { read, dismiss: () => dismiss([items[0]!]) });
    else if (style === 'modal')
      surface = modal(items[0]!, { read, dismiss: () => dismiss([items[0]!]) });
    else if (style === 'drawer') {
      surface = drawer(items, {
        read,
        dismiss: () => dismiss(items),
        all: () => {
          close();
          host.open({ name: 'updates' });
        },
      });
    }
    if (surface) host.root.appendChild(surface);
    surface?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  };

  const run = () => {
    if (destroyed || style === 'none') return;
    void loadNews(host.api, host.store)
      .then((fresh) => {
        if (destroyed) return;
        renderEmbeds(fresh);
        if (style === 'popup' || style === 'modal' || style === 'drawer') {
          clearTimeout(timer);
          timer = setTimeout(
            () => announce(host.store.state.news?.items ?? fresh),
            ANNOUNCE_DELAY_MS,
          );
        }
      })
      .catch(() => {
        // No news is not an error worth showing.
      });
  };

  /** Every `[data-helpwell-changelog]` on the page, drawn once each. */
  const renderEmbeds = (fresh: ChangelogSummary[]) => {
    for (const el of document.querySelectorAll('[data-helpwell-changelog]')) {
      if (embeds.has(el)) continue;
      let shadow: ShadowRoot;
      try {
        shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
      } catch {
        continue;
      }
      embeds.set(el, shadow);
      mountEmbed(el as HTMLElement, shadow, host, new Set(fresh.map((item) => item.id)));
    }
  };

  // Opening the panel is the visitor looking: the announcement steps aside.
  const unsubscribe = host.store.subscribe((state) => {
    if (state.open && surface) close();
  });

  run();

  return {
    refresh() {
      run();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      unsubscribe();
      surface?.remove();
      surface = null;
      for (const [el, shadow] of embeds) {
        shadow.textContent = '';
        el.removeAttribute('data-helpwell-mounted');
      }
      embeds.clear();
    },
  };
}

/* -------------------------------------------------------------- surfaces */

interface Actions {
  read: (entry: ChangelogSummary) => void;
  dismiss: () => void;
}

function closeButton(label: string, onClick: () => void): HTMLElement {
  const button = h('button', {
    type: 'button',
    class: 'announce__close',
    'aria-label': label,
    on: { click: onClick },
  });
  button.appendChild(svg(icons.close));
  return button;
}

function meta(entry: ChangelogSummary): HTMLElement {
  return h(
    'p',
    { class: 'announce__meta' },
    h('span', { class: 'announce__new', text: 'New' }),
    entry.version ? h('span', { class: 'entry__version', text: entry.version }) : null,
  );
}

function popup(entry: ChangelogSummary, actions: Actions): HTMLElement {
  return h(
    'div',
    { class: 'announce announce--popup', role: 'status', 'aria-label': "What's new" },
    closeButton('Dismiss', actions.dismiss),
    meta(entry),
    h('p', { class: 'announce__title', text: entry.title }),
    entry.summary ? h('p', { class: 'announce__summary', text: entry.summary }) : null,
    h('button', {
      type: 'button',
      class: 'announce__read',
      text: 'Read more',
      on: { click: () => actions.read(entry) },
    }),
  );
}

function modal(entry: ChangelogSummary, actions: Actions): HTMLElement {
  const cover = entry.coverUrl ? safeMediaUrl(entry.coverUrl) : null;
  const dialog = h(
    'div',
    {
      class: 'announce__dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'hw-announce-title',
    },
    closeButton('Close', actions.dismiss),
    cover ? h('img', { class: 'announce__cover', src: cover, alt: '' }) : null,
    meta(entry),
    h('h2', { class: 'announce__title', id: 'hw-announce-title', text: entry.title }),
    entry.summary ? h('p', { class: 'announce__summary', text: entry.summary }) : null,
    h(
      'div',
      { class: 'announce__actions' },
      h('button', {
        type: 'button',
        class: 'primary',
        text: 'Read more',
        'data-autofocus': 'true',
        on: { click: () => actions.read(entry) },
      }),
      h('button', {
        type: 'button',
        class: 'ghost',
        text: 'Got it',
        on: { click: actions.dismiss },
      }),
    ),
  );
  const backdrop = h('div', { class: 'announce announce--modal' }, dialog);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) actions.dismiss();
  });
  backdrop.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      actions.dismiss();
    }
  });
  return backdrop;
}

function drawer(items: ChangelogSummary[], actions: Actions & { all: () => void }): HTMLElement {
  const panel = h(
    'aside',
    { class: 'announce announce--drawer', role: 'dialog', 'aria-label': "What's new" },
    h(
      'div',
      { class: 'announce__head' },
      h('h2', { class: 'announce__heading', text: "What's new" }),
      closeButton('Close', actions.dismiss),
    ),
    h(
      'div',
      { class: 'announce__list' },
      ...items.map((entry) =>
        h(
          'button',
          { type: 'button', class: 'announce__item', on: { click: () => actions.read(entry) } },
          meta(entry),
          h('p', { class: 'announce__title', text: entry.title }),
          entry.summary ? h('p', { class: 'announce__summary', text: entry.summary }) : null,
        ),
      ),
    ),
    h('button', {
      type: 'button',
      class: 'loadmore',
      text: 'See all updates',
      'data-autofocus': 'true',
      on: { click: actions.all },
    }),
  );
  panel.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      actions.dismiss();
    }
  });
  return panel;
}

/* ----------------------------------------------------------------- embed */

/**
 * The inline feed, in the host page's own layout. Its own shadow root, so the
 * page's CSS does not reshape it and it does not reshape the page. An entry
 * opens in place; reading it marks it read.
 */
function mountEmbed(
  el: HTMLElement,
  shadow: ShadowRoot,
  host: AnnouncerHost,
  fresh: Set<string>,
): void {
  el.setAttribute('data-helpwell-mounted', 'true');
  const limit = Math.min(20, Math.max(1, Number.parseInt(el.dataset.limit ?? '', 10) || 5));
  const style = h('style', { text: EMBED_CSS });
  const list = h('div', { class: 'feed', role: 'feed', 'aria-label': "What's new" });
  shadow.replaceChildren(style, list);
  const markNew = announcementStyle(host.store.state.config?.changelog.notification) !== 'none';
  // Settings' changelog.groupBy, as on the Updates tab: by version, or under month headings.
  const byMonth = host.store.state.config?.changelog.groupBy === 'date';

  void host.api
    .changelog(null, limit)
    .then(({ items }) => {
      if (items.length === 0) {
        replace(list, h('p', { class: 'feed__empty', text: 'No updates yet.' }));
        return;
      }
      let lastMonth = '';
      replace(
        list,
        ...items.flatMap((entry) => {
          const month = byMonth ? monthLabel(entry.publishedAt) : '';
          const heading =
            month && month !== lastMonth ? h('h3', { class: 'feed__month', text: month }) : null;
          if (heading) lastMonth = month;
          const unread = markNew && (fresh.has(entry.id) || entry.read === false);
          const body = h('div', { class: 'feed__body', hidden: true });
          const version = entry.version
            ? h('span', { class: 'feed__version', text: entry.version })
            : null;
          const date = entry.publishedAt
            ? h('span', { text: new Date(entry.publishedAt).toLocaleDateString() })
            : null;
          const toggle = h(
            'button',
            { type: 'button', class: 'feed__toggle', 'aria-expanded': 'false' },
            h(
              'span',
              { class: 'feed__meta' },
              unread ? h('span', { class: 'feed__new', text: 'New' }) : null,
              byMonth ? date : version,
              byMonth ? version : date,
            ),
            h('span', { class: 'feed__title', text: entry.title }),
            entry.summary ? h('span', { class: 'feed__summary', text: entry.summary }) : null,
          );
          let loaded = false;
          toggle.addEventListener('click', () => {
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            toggle.setAttribute('aria-expanded', String(open));
            body.hidden = !open;
            if (!open || loaded) return;
            loaded = true;
            replace(body, h('p', { class: 'feed__loading', text: 'Loading…' }));
            void host.api
              .changelogEntry(entry.id)
              .then((detail) => {
                replace(
                  body,
                  renderRich(detail.body, {
                    inlineVideo: host.store.state.config?.widget.media?.inlineVideo === true,
                  }),
                );
                toggle.querySelector('.feed__new')?.remove();
                noteSeen(host.store, [entry.id]);
                return host.api.markRead(entry.id);
              })
              .catch(() => {
                loaded = false;
                replace(
                  body,
                  h('p', { class: 'feed__loading', text: 'This update did not load.' }),
                );
              });
          });
          const item = h('article', { class: 'feed__item' }, toggle, body);
          return heading ? [heading, item] : [item];
        }),
      );
    })
    .catch(() => {
      replace(list, h('p', { class: 'feed__empty', text: 'Updates are unavailable right now.' }));
    });
}

/**
 * The feed's own styles. It inherits the page's font and colour, because it
 * is part of the page, and draws only structure and the accent.
 */
const EMBED_CSS = `
:host { display: block; font: inherit; color: inherit; }
* { box-sizing: border-box; }
.feed { display: flex; flex-direction: column; gap: 10px; }
.feed__item { border: 1px solid rgba(127,127,127,.25); border-radius: 12px; overflow: hidden; }
.feed__toggle {
  display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: start;
  padding: 14px 16px; border: 0; background: none; font: inherit; color: inherit; cursor: pointer;
}
.feed__toggle:focus-visible { outline: 2px solid var(--hw-accent, #7A3BEB); outline-offset: -2px; }
.feed__meta { display: flex; gap: 8px; align-items: center; font-size: .8em; opacity: .75; }
.feed__new {
  padding: 1px 8px; border-radius: 999px; font-weight: 700; opacity: 1;
  background: var(--hw-accent, #7A3BEB); color: #fff;
}
.feed__version { font-weight: 700; }
.feed__month { margin: 8px 0 -2px; font-size: .75em; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
.feed__title { font-weight: 700; font-size: 1.05em; }
.feed__summary { opacity: .8; }
.feed__body { padding: 0 16px 14px; line-height: 1.6; }
.feed__body img, .feed__body video { max-width: 100%; height: auto; border-radius: 8px; }
.feed__body .media-zoom { border: 0; padding: 0; background: none; cursor: zoom-in; }
.feed__body .hw-video__play, .feed__body .hc-video-link a { color: inherit; }
.feed__empty, .feed__loading { opacity: .7; margin: 0; }
.lightbox { position: fixed; inset: 0; z-index: 2147483600; display: grid; place-items: center; background: rgba(10,8,20,.82); padding: 24px; }
.lightbox__img { max-width: 100%; max-height: 100%; border-radius: 8px; }
.lightbox__close { position: absolute; top: 12px; right: 12px; width: 40px; height: 40px; border: 0; border-radius: 999px; background: rgba(255,255,255,.14); color: #fff; cursor: pointer; }
.lightbox__close svg { width: 20px; height: 20px; }
`;
