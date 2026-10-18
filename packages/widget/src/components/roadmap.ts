/**
 * The Roadmap tab.
 *
 * Four lanes, one vote per person per item, and a way to suggest something.
 * Whether anyone can submit, or only signed-in people, is the customer's call.
 */

import type { RoadmapBoard, RoadmapCard } from '../api.js';
import { ApiError } from '../api.js';
import type { ViewContext } from '../context.js';
import { h, replace } from '../dom.js';
import { skeletonSwap } from '../skeleton.js';
import { empty, iconEl, notice, page, skeletonCards } from './common.js';
import { setError } from './prechat.js';

const LANES: { key: keyof RoadmapBoard; label: string; color: string }[] = [
  { key: 'in_progress', label: 'In progress', color: 'var(--hw-accent)' },
  { key: 'planned', label: 'Planned', color: 'var(--hw-info)' },
  { key: 'under_review', label: 'Under review', color: 'var(--hw-muted)' },
  { key: 'shipped', label: 'Shipped', color: 'var(--hw-good)' },
];

export function roadmapView(context: ViewContext): HTMLElement {
  const board = h('div', {});
  const wrap = h('div', {});
  const reveal = skeletonSwap(
    wrap,
    h('div', { style: { padding: '16px' } }, skeletonCards(5)),
    board,
  );

  const canSubmit =
    context.state.config?.changelog.whoCanSubmit === 'anyone' || context.state.identified;

  const submitSlot = h('div', {});
  const view = page(wrap, submitSlot);

  void context.api
    .roadmap(context.signal)
    .then((data) => {
      const lanes = LANES.filter((lane) => (data[lane.key] ?? []).length > 0);
      if (lanes.length === 0) {
        replace(board, empty('roadmap', 'Nothing on the roadmap yet'));
      } else {
        replace(board, ...lanes.map((lane) => laneSection(context, lane, data[lane.key] ?? [])));
      }
      replace(submitSlot, submitBlock(context, canSubmit));
      reveal();
    })
    .catch(() => {
      replace(board, empty('offline', 'Could not load the roadmap'));
      reveal();
    });

  return view;
}

function laneSection(
  context: ViewContext,
  lane: { key: keyof RoadmapBoard; label: string; color: string },
  cards: RoadmapCard[],
): HTMLElement {
  return h(
    'div',
    { class: 'lane' },
    h(
      'div',
      { class: 'lane__head' },
      h('span', { class: 'lane__dot', style: { background: lane.color } }),
      h('span', { class: 'lane__name', text: lane.label }),
      h('span', { class: 'lane__count', text: String(cards.length) }),
    ),
    ...cards.map((card) => ideaCard(context, card)),
  );
}

function ideaCard(context: ViewContext, card: RoadmapCard): HTMLElement {
  const count = h('span', { text: String(card.votesCount) });

  const button = h('button', {
    class: 'vote',
    type: 'button',
    'aria-pressed': String(card.voted),
    'aria-label': card.voted ? `Remove your vote for ${card.title}` : `Vote for ${card.title}`,
  });
  button.append(iconEl('arrowUp'), count);

  button.addEventListener('click', async () => {
    // Move first, reconcile after: a vote should feel instant.
    const wasVoted = button.getAttribute('aria-pressed') === 'true';
    const optimistic = Number(count.textContent) + (wasVoted ? -1 : 1);
    button.setAttribute('aria-pressed', String(!wasVoted));
    count.textContent = String(Math.max(0, optimistic));
    button.classList.add('vote--bumped');
    setTimeout(() => button.classList.remove('vote--bumped'), 320);

    try {
      const result = await context.api.vote(card.id);
      button.setAttribute('aria-pressed', String(result.voted));
      count.textContent = String(result.votesCount);
    } catch (error) {
      button.setAttribute('aria-pressed', String(wasVoted));
      count.textContent = String(card.votesCount);
      const message = error instanceof ApiError ? error.message : 'Your vote did not go through.';
      button.closest('.lane')?.appendChild(notice('bad', message));
    }
  });

  return h(
    'div',
    { class: 'card idea' },
    h(
      'div',
      { class: 'idea__main' },
      h('p', { class: 'idea__title', text: card.title }),
      card.body ? h('p', { class: 'idea__body', text: card.body }) : null,
    ),
    button,
  );
}

function submitBlock(context: ViewContext, canSubmit: boolean): HTMLElement {
  if (!canSubmit) {
    return h(
      'div',
      { class: 'section' },
      h('p', {
        style: { color: 'var(--hw-muted)', fontSize: '13px', textAlign: 'center', margin: '0' },
        text: 'Sign in to suggest an idea.',
      }),
    );
  }

  const section = h('div', { class: 'section' });
  const open = h(
    'button',
    { class: 'ghost', type: 'button', style: { width: '100%', justifyContent: 'center' } },
    iconEl('plus'),
    h('span', { text: 'Suggest an idea' }),
  );

  open.addEventListener('click', () => replace(section, ideaForm(context, section)));
  section.appendChild(open);
  return section;
}

function ideaForm(context: ViewContext, section: HTMLElement): HTMLElement {
  const titleInput = h('input', { class: 'field__input', maxlength: '140', 'aria-label': 'Title' });
  const titleField = h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label', text: 'What should we build?' }),
    titleInput,
  );
  titleInput.addEventListener('input', () => setError(titleField, null));

  const bodyInput = h('textarea', {
    class: 'field__input',
    rows: '3',
    'aria-label': 'More detail',
    placeholder: 'Why would this help? (optional)',
  });

  const form = h(
    'form',
    { novalidate: true },
    titleField,
    h('label', { class: 'field' }, bodyInput),
    h('button', { class: 'primary', type: 'submit', text: 'Submit idea' }),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      setError(titleField, 'Give your idea a title.');
      return;
    }

    try {
      await context.api.submitIdea(title, bodyInput.value.trim() || undefined);
      replace(
        section,
        notice('info', 'Thanks. It is in review and will appear on the board shortly.'),
      );
    } catch (error) {
      setError(titleField, error instanceof ApiError ? error.message : 'That did not submit.');
    }
  });

  return form;
}
