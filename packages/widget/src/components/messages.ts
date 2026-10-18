/** The Messages tab: every conversation this visitor has had. */

import type { ViewContext } from '../context.js';
import { h, replace } from '../dom.js';
import { skeletonSwap } from '../skeleton.js';
import { empty, iconEl, page, relativeTime, row, skeletonCards } from './common.js';

export function messagesView(context: ViewContext): HTMLElement {
  const list = h('div', { class: 'rowlist' });
  const wrap = h('div', {});
  const reveal = skeletonSwap(
    wrap,
    h('div', { style: { padding: '16px' } }, skeletonCards(4)),
    list,
  );

  const start = h(
    'div',
    { class: 'section' },
    h(
      'button',
      {
        class: 'primary',
        type: 'button',
        on: { click: () => context.go({ name: 'chat', conversationId: null }) },
      },
      iconEl('plus'),
      h('span', { text: 'New conversation' }),
    ),
  );

  void context.api
    .conversations(context.signal)
    .then(({ items }) => {
      if (items.length === 0) {
        replace(
          list,
          empty('inbox', 'No conversations yet', 'Anything you ask will show up here.'),
        );
      } else {
        replace(
          list,
          ...items.map((conversation) =>
            row({
              title: conversation.topic ?? conversation.snippet.slice(0, 60) ?? 'Conversation',
              sub: `${conversation.status === 'resolved' ? 'Resolved' : 'Open'} · ${relativeTime(conversation.lastMessageAt)}`,
              onClick: () => context.go({ name: 'chat', conversationId: conversation.id }),
            }),
          ),
        );
      }
      reveal();
    })
    .catch(() => {
      replace(list, empty('offline', 'Could not load your conversations'));
      reveal();
    });

  return page(start, wrap);
}
