/**
 * The Updates tab (changelog).
 *
 * Pages in as the reader scrolls. A product with three years of releases would
 * otherwise send its whole history to open one tab, and the list deliberately
 * carries summaries only — the body is fetched when an entry is opened.
 *
 * `changelog.groupBy` from Settings decides how it reads: each entry led by
 * its version (the default), or entries under a heading for each month, the
 * date first and the version after it. The embedded feed does the same.
 */

import type { ChangelogSummary } from '../api.js';
import { noteSeen } from '../changelog-notify.js';
import type { ViewContext } from '../context.js';
import { h, replace } from '../dom.js';
import { renderRich } from '../media.js';
import { skeletonSwap } from '../skeleton.js';
import { refreshUnread, unreadBadge } from '../state.js';
import { empty, formatDate, monthLabel, page, skeletonCards, skeletonLines } from './common.js';

/** Entries per request. Small on purpose: the reader scrolls for more. */
const PAGE_SIZE = 10;

export function updatesView(context: ViewContext): HTMLElement {
  const list = h('div', {});
  const wrap = h('div', {});
  const footer = h('div', {});
  const reveal = skeletonSwap(
    wrap,
    h('div', { style: { padding: '16px' } }, skeletonCards(4)),
    list,
  );

  let cursor: string | null = null;
  let loading = false;
  let exhausted = false;
  const byMonth = context.state.config?.changelog.groupBy === 'date';
  // The last month heading drawn, carried across pages so a month split
  // between two pages keeps one heading.
  let lastMonth = '';

  const markAllRead = h('button', {
    class: 'ghost',
    type: 'button',
    text: 'Mark all as read',
    on: {
      click: () => {
        void context.api.markAllRead().then(() => {
          context.store.set({ unread: 0 });
          noteSeen(context.store, 'all');
          for (const dot of list.querySelectorAll('.entry__unread')) dot.remove();
          markAllRead.remove();
        });
      },
    },
  });

  async function loadMore(): Promise<void> {
    if (loading || exhausted) return;
    loading = true;
    try {
      const pageResult = await context.api.changelog(cursor, PAGE_SIZE, context.signal);
      cursor = pageResult.nextCursor;
      exhausted = !pageResult.nextCursor;

      if (pageResult.items.length === 0 && list.childElementCount === 0) {
        replace(list, empty('updates', 'No updates yet'));
      } else {
        for (const entry of pageResult.items) {
          const month = byMonth ? monthLabel(entry.publishedAt) : '';
          if (month && month !== lastMonth) {
            list.appendChild(h('h3', { class: 'entry__month', text: month }));
            lastMonth = month;
          }
          list.appendChild(entryCard(context, entry, byMonth));
        }
      }
      renderFooter();
    } catch {
      replace(footer, empty('offline', 'Could not load updates'));
    } finally {
      loading = false;
    }
  }

  function renderFooter(): void {
    replace(
      footer,
      exhausted
        ? null
        : h('button', {
            class: 'loadmore',
            type: 'button',
            text: 'Load more',
            on: { click: () => void loadMore() },
          }),
    );
  }

  const view = page(
    unreadBadge(context.state) > 0
      ? h('div', { style: { padding: '10px 16px 0', textAlign: 'end' } }, markAllRead)
      : null,
    wrap,
    footer,
  );

  void loadMore().then(reveal);

  // The panel body is the scroller, and this view is not inside it yet, so
  // the listener is attached once the view has been mounted.
  queueMicrotask(() => {
    const host = view.closest('.panel__body');
    host?.addEventListener('scroll', () => {
      const nearBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 240;
      if (nearBottom) void loadMore();
    });
  });

  return view;
}

function entryCard(context: ViewContext, entry: ChangelogSummary, byMonth = false): HTMLElement {
  const card = h('button', {
    class: 'entry',
    type: 'button',
    style: { display: 'block', width: '100%', textAlign: 'start' },
    on: { click: () => context.go({ name: 'entry', id: entry.id }) },
  });

  const top = h('div', { class: 'entry__top' });
  if (entry.read === false) top.appendChild(h('span', { class: 'entry__unread' }));
  const version = entry.version
    ? h('span', { class: 'entry__version', text: entry.version })
    : null;
  const date = h('span', { class: 'entry__date', text: formatDate(entry.publishedAt) });
  // Grouped by month, the date leads and the version follows it.
  if (byMonth) top.append(date, ...(version ? [version] : []));
  else top.append(...(version ? [version] : []), date);

  card.append(top);
  if (entry.coverUrl) {
    card.appendChild(
      h('img', { class: 'entry__cover', src: entry.coverUrl, alt: '', loading: 'lazy' }),
    );
  }
  card.appendChild(h('p', { class: 'entry__title', text: entry.title }));
  if (entry.summary) card.appendChild(h('p', { class: 'entry__summary', text: entry.summary }));
  if (entry.tags.length > 0) {
    card.appendChild(
      h(
        'div',
        { class: 'entry__tags' },
        ...entry.tags.map((tag) => h('span', { class: 'chip', text: tag })),
      ),
    );
  }

  return card;
}

export function entryView(context: ViewContext, id: string): HTMLElement {
  const content = h('div', {});
  const wrap = h('div', { class: 'article' });
  const reveal = skeletonSwap(
    wrap,
    h('div', { style: { paddingTop: '16px' } }, skeletonLines(6)),
    content,
  );

  void context.api
    .changelogEntry(id, context.signal)
    .then((entry) => {
      const body = h('div', { class: 'article__body' });
      body.appendChild(
        renderRich(entry.body, {
          inlineVideo: context.state.config?.widget.media?.inlineVideo === true,
        }),
      );

      replace(
        content,
        h(
          'div',
          { class: 'entry__top', style: { marginTop: '16px' } },
          entry.version ? h('span', { class: 'entry__version', text: entry.version }) : null,
          h('span', { class: 'entry__date', text: formatDate(entry.publishedAt) }),
        ),
        h('h1', { text: entry.title }),
        entry.coverUrl ? h('img', { class: 'entry__cover', src: entry.coverUrl, alt: '' }) : null,
        body,
      );
      reveal();

      // Opening an entry is what marks it read, in this browser's record and
      // on the server. The server's count is then re-read rather than
      // decremented locally: a refresh that was already in flight would
      // otherwise land after the decrement and put the badge back.
      noteSeen(context.store, [id]);
      void context.api
        .markRead(id)
        .then(() => refreshUnread(context.api, context.store))
        .catch(() => {
          // The entry is still readable if the receipt does not land.
        });
    })
    .catch(() => {
      replace(content, empty('offline', 'Could not load this update'));
      reveal();
    });

  return page(wrap);
}
