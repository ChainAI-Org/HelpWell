/**
 * The blocks the Home tab is built from, and the seam for new ones.
 *
 * `widget.home.blocks` is an ordered list. Each entry names a type; the
 * renderer for that type draws it, or draws nothing when it has nothing to
 * say (no open conversation, no status configured). A type with no renderer
 * is skipped, never an error, so a config written for a newer widget, or a
 * block whose renderer a feature registers later (`form`), cannot break Home.
 *
 * `registerHomeBlock(type, renderer)` adds or replaces a renderer.
 */

import type { HomeBlock } from '../api.js';
import type { ViewContext } from '../context.js';
import { h, markedSnippet, replace, svg } from '../dom.js';
import { icons } from '../icons.js';
import { renderRich, safeMediaUrl } from '../media.js';
import { safeHttpUrl } from '../sanitize.js';
import { STATUS_TEXT } from '../status.js';
import { iconEl, relativeTime, row, section } from './common.js';

/** Draws one block. Return null to draw nothing. */
export type HomeBlockRenderer = (block: HomeBlock, context: ViewContext) => Node | null;

const registered = new Map<string, HomeBlockRenderer>();

/**
 * Teach Home a block type, or replace how a built-in one draws. Returns a
 * function that takes it away again.
 */
export function registerHomeBlock(type: string, renderer: HomeBlockRenderer): () => void {
  registered.set(type, renderer);
  return () => {
    if (registered.get(type) === renderer) registered.delete(type);
  };
}

/** What Home showed before it had blocks, in the same order. */
export const DEFAULT_HOME_BLOCKS: HomeBlock[] = [
  { type: 'search' },
  { type: 'conversation' },
  { type: 'newConversation' },
  { type: 'updates', title: "What's new", count: 3 },
  { type: 'status' },
];

/** One block, or null. A renderer that throws costs its block, not the tab. */
export function renderHomeBlock(block: HomeBlock, context: ViewContext): Node | null {
  if (!block || typeof block !== 'object' || typeof block.type !== 'string') return null;
  const renderer = registered.get(block.type) ?? BUILT_IN[block.type];
  if (!renderer) return null;
  try {
    return renderer(block, context);
  } catch (error) {
    console.warn(`helpwell: the "${block.type}" block on Home did not render.`, error);
    return null;
  }
}

/* -------------------------------------------------------------- built in */

const BUILT_IN: Record<string, HomeBlockRenderer> = {
  search: (_block, context) => {
    const results = h('div', {});
    return h('div', { class: 'section' }, searchBox(context, results), results);
  },

  // An open conversation is the most likely reason they came back.
  conversation: (_block, context) => {
    const { store } = context;
    if (!store.state.conversationId) return null;
    const messages = store.state.messages;
    const latest = messages[messages.length - 1];
    return section(
      'Your conversation',
      row({
        title: 'Continue where you left off',
        sub: latest?.body.slice(0, 70) ?? '',
        onClick: () => context.go({ name: 'chat', conversationId: store.state.conversationId }),
      }),
    );
  },

  newConversation: (_block, context) =>
    h(
      'div',
      { class: 'section' },
      h(
        'button',
        {
          class: 'primary',
          type: 'button',
          on: { click: () => context.go({ name: 'chat', conversationId: null }) },
        },
        iconEl('message'),
        h('span', {
          text: context.store.state.conversationId ? 'Ask something else' : 'Ask a question',
        }),
      ),
    ),

  // Recent updates, but only when the customer has that tab turned on.
  updates: (block, context) => {
    if (!context.state.config?.changelog.widgetTab) return null;
    const { title, count } = block as { title?: string; count?: number };
    const slot = h('div', { class: 'section' });
    void context.api
      .changelog(null, clampCount(count, 3), context.signal)
      .then(({ items }) => {
        if (items.length === 0) return;
        replace(
          slot,
          h('h3', { class: 'section__title', text: title || "What's new" }),
          ...items.map((entry) =>
            h(
              'button',
              {
                class: 'card',
                type: 'button',
                on: { click: () => context.go({ name: 'entry', id: entry.id }) },
              },
              h('p', { class: 'card__title', text: entry.title }),
              h('p', {
                class: 'card__meta',
                text: [entry.version, relativeTime(entry.publishedAt ?? '')]
                  .filter(Boolean)
                  .join(' · '),
              }),
            ),
          ),
        );
      })
      .catch(() => {
        // The home tab still works without it.
      });
    return slot;
  },

  status: (_block, context) => {
    // An empty text node holds the place, so with nothing to show Home is
    // exactly what it was before this block existed.
    const draw = () => statusSection(context) ?? document.createTextNode('');
    let current: Node = draw();
    // The status usually lands a moment after Home is drawn.
    let shown = context.store.state.status;
    const unsubscribe = context.store.subscribe((state) => {
      if (state.status === shown) return;
      shown = state.status;
      const next = draw();
      current.parentNode?.replaceChild(next, current);
      current = next;
    });
    context.signal.addEventListener('abort', unsubscribe, { once: true });
    return current;
  },

  articles: (block, context) => {
    const { title, collection, slugs, limit } = block as {
      title?: string;
      collection?: string;
      slugs?: string[];
      limit?: number;
    };
    const list = h('div', { class: 'rowlist' });
    const slot = h('div', { class: 'section' });
    const wanted = (slugs ?? []).filter(Boolean);
    void context.api
      .articles(collection || undefined, context.signal)
      .then(({ items }) => {
        const picked = wanted.length
          ? wanted
              .map((slug) => items.find((item) => item.slug === slug))
              .filter((item): item is (typeof items)[number] => Boolean(item))
          : items;
        const shownItems = picked.slice(0, clampCount(limit, 5));
        if (shownItems.length === 0) return;
        replace(
          list,
          ...shownItems.map((article) =>
            row({
              title: article.title,
              sub: article.description ?? undefined,
              onClick: () =>
                context.go({ name: 'article', slug: article.slug, from: context.state.view }),
            }),
          ),
        );
        replace(
          slot,
          h('h3', { class: 'section__title', text: title || 'Popular articles' }),
          list,
        );
      })
      .catch(() => {
        // Nothing to show is better than an error on Home.
      });
    return slot;
  },

  links: (block) => {
    const { title, items } = block as {
      title?: string;
      items?: { label?: string; url?: string; icon?: string }[];
    };
    const links = (items ?? [])
      .map((item) => ({ ...item, href: safeHttpUrl(item.url) }))
      .filter((item) => item.href && item.label);
    if (links.length === 0) return null;
    return h(
      'div',
      { class: 'section' },
      title ? h('h3', { class: 'section__title', text: title }) : null,
      h(
        'div',
        { class: 'rowlist rowlist--card' },
        ...links.map((item) =>
          h(
            'a',
            {
              class: 'row row--link',
              href: item.href!,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            h('span', { class: 'row__icon' }, svg(icons[iconName(item.icon)])),
            h(
              'span',
              { class: 'row__main' },
              h('span', { class: 'row__title', text: item.label! }),
            ),
            h('span', { class: 'row__chevron' }, iconEl('external')),
          ),
        ),
      ),
    );
  },

  card: (block, context) => {
    const { title, body, image, cta } = block as {
      title?: string;
      body?: string;
      image?: string;
      cta?: { label?: string; url?: string };
    };
    const src = image ? safeMediaUrl(image) : null;
    const href = cta?.url ? safeHttpUrl(cta.url) : null;
    if (!title && !body && !src) return null;
    const content = h('div', { class: 'homeCard__body' });
    if (body) {
      content.appendChild(
        renderRich(body, { inlineVideo: context.state.config?.widget.media?.inlineVideo === true }),
      );
    }
    return h(
      'div',
      { class: 'section' },
      h(
        'div',
        { class: 'homeCard' },
        src ? h('img', { class: 'homeCard__image', src, alt: '', loading: 'lazy' }) : null,
        title ? h('p', { class: 'homeCard__title', text: title }) : null,
        body ? content : null,
        href && cta?.label
          ? h('a', {
              class: 'ghost homeCard__cta',
              href,
              target: '_blank',
              rel: 'noopener noreferrer',
              text: cta.label,
            })
          : null,
      ),
    );
  },
};

/* ----------------------------------------------------------------- parts */

/**
 * The status row: what is happening and a link to the page. When the status
 * is unknown but there is a page, a plain link to it, as Home always had.
 */
function statusSection(context: ViewContext): HTMLElement | null {
  const status = context.state.status;
  const url = safeHttpUrl(status?.url ?? context.state.config?.widget.statusUrl);

  if (status?.level) {
    const message = status.message || STATUS_TEXT[status.level];
    const children = [
      h('span', { class: 'statusRow__dot', 'data-level': status.level }),
      h('span', { class: 'statusRow__text', text: message }),
      url
        ? h('span', { class: 'statusRow__link' }, h('span', { text: 'Status' }), iconEl('external'))
        : null,
    ];
    return h(
      'div',
      { class: 'section section--tight' },
      url
        ? h(
            'a',
            {
              class: 'statusRow',
              'data-level': status.level,
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            ...children,
          )
        : h('div', { class: 'statusRow', 'data-level': status.level, role: 'status' }, ...children),
    );
  }

  // Where to look when the product itself is the problem.
  if (!url) return null;
  return h(
    'div',
    { class: 'section', style: { textAlign: 'center', paddingTop: '0' } },
    h(
      'a',
      { class: 'statusLink', href: url, target: '_blank', rel: 'noopener noreferrer' },
      iconEl('external'),
      h('span', { text: 'Status' }),
    ),
  );
}

function iconName(name: string | undefined): keyof typeof icons {
  return name && Object.hasOwn(icons, name) ? (name as keyof typeof icons) : 'external';
}

function clampCount(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, 10)
    : fallback;
}

/**
 * Search that answers as you type, debounced so a fast typist does not send
 * eight queries for one word.
 */
export function searchBox(
  context: ViewContext,
  results: HTMLElement,
  placeholder = 'Search for help…',
): HTMLElement {
  const input = h('input', { type: 'search', placeholder, 'aria-label': placeholder });
  const box = h('div', { class: 'searchbox' }, iconEl('search'), input);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;

  // A query typed just before the view changed must not fire into the void.
  context.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();

    if (!query) {
      replace(results);
      return;
    }

    timer = setTimeout(async () => {
      const mine = ++sequence;
      try {
        const { results: hits } = await context.api.search(query, 8, context.signal);
        // Ignore a response that arrived after a newer one.
        if (mine !== sequence) return;

        if (hits.length === 0) {
          replace(
            results,
            h(
              'div',
              { style: { padding: '18px 2px', color: 'var(--hw-muted)', fontSize: '13px' } },
              h('p', { text: `Nothing matched "${query}".`, style: { margin: '0 0 10px' } }),
              h('button', {
                class: 'ghost',
                type: 'button',
                text: 'Ask the assistant instead',
                on: { click: () => context.go({ name: 'chat', conversationId: null }) },
              }),
            ),
          );
          return;
        }

        replace(
          results,
          h('div', { style: { marginTop: '10px' } }),
          ...hits.map((hit) => {
            const card = h('button', {
              class: 'card',
              type: 'button',
              on: {
                click: () =>
                  context.go({ name: 'article', slug: hit.slug, from: context.state.view }),
              },
            });
            card.appendChild(h('p', { class: 'card__title', text: hit.title }));
            // The snippet carries <mark> from the server; nothing else survives.
            card.appendChild(
              h('p', {
                class: 'card__meta',
                html: markedSnippet(hit.snippet || hit.description || ''),
              }),
            );
            return card;
          }),
        );
      } catch {
        if (context.signal.aborted) return;
        replace(
          results,
          h('p', {
            style: { padding: '14px 2px', color: 'var(--hw-muted)', fontSize: '13px' },
            text: 'Search is unavailable right now.',
          }),
        );
      }
    }, 220);
  });

  return box;
}
