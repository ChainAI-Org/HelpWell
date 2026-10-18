/**
 * The Help tab: collections, an article, and the search that spans both.
 */

import { withoutRepeatedTitle } from '@helpwell/ui';
import type { ViewContext } from '../context.js';
import { h, replace } from '../dom.js';
import { renderRich } from '../media.js';
import { skeletonSwap } from '../skeleton.js';
import {
  empty,
  formatDate,
  iconEl,
  page,
  row,
  skeletonCards,
  skeletonLines,
  titleCase,
} from './common.js';
import { searchBox } from './home.js';

export function helpView(context: ViewContext): HTMLElement {
  const results = h('div', {});
  const list = h('div', {});
  const wrap = h('div', {});

  const view = page(
    h('div', { class: 'section' }, searchBox(context, results), results),
    h('div', { class: 'section' }, h('h3', { class: 'section__title', text: 'Browse' }), wrap),
  );

  const reveal = skeletonSwap(wrap, skeletonCards(4), list);

  void context.api
    .collections(context.signal)
    .then(({ items }) => {
      if (items.length === 0) {
        replace(list, empty('help', 'No articles yet', 'The docs live in the product repo.'));
      } else {
        replace(
          list,
          ...items.map((entry) =>
            h(
              'button',
              {
                class: 'card',
                type: 'button',
                on: {
                  click: () =>
                    context.go({
                      name: 'collection',
                      collection: entry.id,
                      title: entry.title,
                    }),
                },
              },
              h('p', { class: 'card__title', text: entry.title }),
              h('p', {
                class: 'card__meta',
                text: entry.description
                  ? entry.description
                  : `${entry.articles} ${entry.articles === 1 ? 'article' : 'articles'}`,
              }),
            ),
          ),
        );
      }
      reveal();
    })
    .catch(() => {
      replace(list, empty('offline', 'Could not load the help center'));
      reveal();
    });

  return view;
}

export function collectionView(context: ViewContext, collection: string): HTMLElement {
  const list = h('div', { class: 'rowlist' });
  const wrap = h('div', { style: { padding: '0 0 8px' } });
  const reveal = skeletonSwap(
    wrap,
    h('div', { style: { padding: '16px' } }, skeletonCards(5)),
    list,
  );

  void context.api
    .articles(collection, context.signal)
    .then(({ items }) => {
      replace(
        list,
        ...items.map((article) =>
          row({
            title: article.title,
            sub: article.description ?? `${article.reading_minutes} min read`,
            onClick: () =>
              context.go({ name: 'article', slug: article.slug, from: context.state.view }),
          }),
        ),
      );
      reveal();
    })
    .catch(() => {
      replace(list, empty('offline', 'Could not load these articles'));
      reveal();
    });

  return page(wrap);
}

export function articleView(context: ViewContext, slug: string): HTMLElement {
  const content = h('div', {});
  const wrap = h('div', { class: 'article' });
  const reveal = skeletonSwap(
    wrap,
    h('div', { style: { paddingTop: '16px' } }, skeletonLines(7)),
    content,
  );

  void context.api
    .article(slug, context.signal)
    .then(({ article, related }) => {
      const meta = [
        article.collection_title ?? titleCase(article.collection),
        context.state.config?.helpCenter.readingTime ? `${article.reading_minutes} min read` : null,
        article.updated_at ? `Updated ${formatDate(article.updated_at)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const body = h('div', { class: 'article__body' });
      // The body is Markdown from the customer's repo, rendered through the
      // same strict path as everything else so a stray script tag is inert.
      // The view draws the title above the body, so an opening `# Title`
      // that repeats it is dropped rather than shown twice.
      body.appendChild(
        renderRich(withoutRepeatedTitle(article.body, article.title), {
          inlineVideo: context.state.config?.widget.media?.inlineVideo === true,
        }),
      );

      replace(
        content,
        h('h1', { text: article.title }),
        h('p', { class: 'article__meta', text: meta }),
        article.applies_to
          ? h('p', { class: 'chip', text: `Applies to ${article.applies_to}` })
          : null,
        body,
        context.state.config?.helpCenter.ratings ? ratingBlock(context, slug) : null,
        related.length > 0
          ? h(
              'div',
              { style: { marginTop: '24px' } },
              h('h3', { class: 'section__title', text: 'Related' }),
              ...related.map((hit) =>
                h(
                  'button',
                  {
                    class: 'card',
                    type: 'button',
                    on: {
                      click: () =>
                        context.go({
                          name: 'article',
                          slug: hit.slug,
                          from: context.state.view,
                        }),
                    },
                  },
                  h('p', { class: 'card__title', text: hit.title }),
                ),
              ),
            )
          : null,
        // Always an escape hatch: the article may not have covered it.
        h(
          'div',
          { style: { marginTop: '20px' } },
          h('button', {
            class: 'ghost',
            type: 'button',
            text: 'Still stuck? Ask the assistant',
            on: { click: () => context.go({ name: 'chat', conversationId: null }) },
          }),
        ),
      );
      reveal();
    })
    .catch(() => {
      replace(content, empty('offline', 'Could not load this article'));
      reveal();
    });

  return page(wrap);
}

function ratingBlock(context: ViewContext, slug: string): HTMLElement {
  const block = h('div', { class: 'rate' });
  const question = h('p', { class: 'rate__q', text: 'Was this helpful?' });
  const buttons = h('div', { class: 'rate__buttons' });

  const rate = (value: 'up' | 'down') => {
    up.setAttribute('aria-pressed', String(value === 'up'));
    down.setAttribute('aria-pressed', String(value === 'down'));
    void context.api.rateArticle(slug, value).catch(() => {
      // Silent: a lost rating is not the reader's problem.
    });

    question.textContent =
      value === 'up' ? 'Thanks for letting us know.' : 'Thanks — we will improve this.';
    if (value === 'down') {
      replace(
        buttons,
        h('button', {
          class: 'ghost',
          type: 'button',
          text: 'Tell the assistant what was missing',
          on: { click: () => context.go({ name: 'chat', conversationId: null }) },
        }),
      );
    }
  };

  const up = h('button', {
    class: 'rate__btn',
    type: 'button',
    'aria-pressed': 'false',
    on: { click: () => rate('up') },
  });
  up.append(iconEl('thumbUp'), h('span', { text: 'Yes' }));

  const down = h('button', {
    class: 'rate__btn',
    type: 'button',
    'aria-pressed': 'false',
    on: { click: () => rate('down') },
  });
  down.append(iconEl('thumbDown'), h('span', { text: 'No' }));

  buttons.append(up, down);
  block.append(question, buttons);
  return block;
}
