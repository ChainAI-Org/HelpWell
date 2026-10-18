/**
 * Modals, including multi-slide announcements.
 *
 * One slide is a plain dialog. More is a carousel: Back and Next, with dots,
 * a bar or "2 of 4" between them (`modal.progress`), a
 * swipe on touch screens and the arrow keys on a keyboard, with the last
 * slide's buttons as the call to action (or Done, when it has none). A
 * slide's first block, when it is an image, GIF or video, is its media, and
 * goes above the words, beside them, or behind them.
 *
 * A modal that cannot be dismissed and offers nothing to press would lock the
 * page, so one with no buttons can always be closed.
 *
 * `startAt` opens a carousel on a later slide: the dashboard's preview uses it
 * to show the slide being edited.
 */

import { h, svg } from '../dom.js';
import { focusFirst, trapTab } from '../focus.js';
import { icons } from '../icons.js';
import { blocksLabel, isMedia, renderBlock, renderBlocks } from './blocks.js';
import { type EngageHost, leave, type ShowOptions, type Surface } from './shared.js';
import type { Block, EngageButton, ModalEngagement } from './types.js';

export async function showModal(
  host: EngageHost,
  engagement: ModalEngagement,
  options: ShowOptions,
): Promise<Surface | null> {
  const slides = engagement.modal.slides.filter((slide) => slide.blocks.length > 0);
  if (slides.length === 0 || !(await options.claim())) {
    options.done();
    return null;
  }

  const hasButtons = slides.some((slide) => slide.blocks.some((b) => b.type === 'buttons'));
  const closable = engagement.dismissible || !hasButtons;
  const { size, mediaPosition, progress } = engagement.modal;
  const many = slides.length > 1;

  const scrim = h('div', { class: 'scrim' });
  const card = h('div', {
    class: `modal modal--${size} modal--media-${mediaPosition}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': blocksLabel(slides[0]?.blocks ?? [], 'Announcement'),
    tabindex: '-1',
  });
  const viewport = h('div', {
    class: 'modal__viewport',
    ...(many ? { 'aria-roledescription': 'carousel' } : {}),
  });

  // `startAt` counts every slide; the empty ones are not drawn.
  const earlier = engagement.modal.slides.slice(0, Math.max(0, Math.floor(options.startAt ?? 0)));
  const opening = Math.min(earlier.filter((s) => s.blocks.length > 0).length, slides.length - 1);
  let index = opening;
  let finished = false;
  const before = document.activeElement as HTMLElement | null;

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && closable) dismiss();
    else if (event.key === 'Tab') trapTab(event, card, host.root.activeElement);
    else if (many && event.key === 'ArrowRight' && card.contains(host.root.activeElement))
      go(index + 1);
    else if (many && event.key === 'ArrowLeft' && card.contains(host.root.activeElement))
      go(index - 1);
  };
  const finish = () => {
    if (finished) return false;
    finished = true;
    document.removeEventListener('keydown', onKey);
    if (before?.isConnected) before.focus();
    options.done();
    return true;
  };
  const dismiss = () => {
    if (finish()) host.dismiss(engagement.id, scrim);
  };
  const complete = () => {
    if (!finish()) return;
    host.record(engagement.id, 'completed');
    leave(scrim);
  };
  const onButton = (button: EngageButton) => {
    if (button.action === 'next') {
      if (index < slides.length - 1) go(index + 1);
      else complete();
      return;
    }
    if (button.action === 'dismiss') {
      dismiss();
      return;
    }
    if (!finish()) return;
    host.record(engagement.id, 'clicked');
    host.act(button.action, button.value, button.newTab);
    leave(scrim);
  };

  const slideEls = slides.map((slide, i) => {
    const el = h('div', {
      class: 'modal__slide',
      ...(many
        ? { 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${slides.length}` }
        : {}),
    });
    drawSlide(el, slide.blocks, mediaPosition, onButton, () =>
      host.record(engagement.id, 'clicked'),
    );
    el.hidden = i !== opening;
    return el;
  });
  viewport.append(...slideEls);

  const back = h('button', { class: 'engage-ghost', type: 'button', text: 'Back' });
  const next = h('button', { class: 'engage-primary', type: 'button', text: 'Next' });
  const dots = h('div', { class: 'modal__dots', role: 'group', 'aria-label': 'Slides' });
  const dotEls =
    progress === 'dots'
      ? slides.map((_, i) =>
          h('button', {
            class: 'modal__dot',
            type: 'button',
            'aria-label': `Slide ${i + 1} of ${slides.length}`,
            on: { click: () => go(i) },
          }),
        )
      : [];
  dots.append(...dotEls);
  const fill = h('span', { class: 'modal__fill' });
  const bar = h('div', {
    class: 'modal__bar',
    role: 'progressbar',
    'aria-label': 'Slides',
    'aria-valuemin': '1',
    'aria-valuemax': String(slides.length),
  });
  bar.appendChild(fill);
  const count = h('span', { class: 'modal__count', 'aria-live': 'polite' });
  const marker = progress === 'bar' ? bar : progress === 'count' ? count : dots;
  back.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => (index < slides.length - 1 ? go(index + 1) : complete()));

  const nav = h('div', { class: 'modal__nav' });
  if (many) nav.append(back, marker, next);
  else if (!hasButtons) nav.append(h('span'), next);

  function go(to: number): void {
    if (to < 0 || to >= slides.length || to === index) return;
    slideEls[index]!.hidden = true;
    index = to;
    slideEls[index]!.hidden = false;
    syncNav();
    focusFirst(slideEls[index]!);
  }

  function syncNav(): void {
    const last = index === slides.length - 1;
    back.hidden = index === 0;
    dotEls.forEach((dot, i) => {
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    fill.style.width = `${((index + 1) / slides.length) * 100}%`;
    bar.setAttribute('aria-valuenow', String(index + 1));
    count.textContent = `${index + 1} of ${slides.length}`;
    // The last slide's own buttons are its call to action; Done only when it has none.
    const lastHasButtons = slides[index]?.blocks.some((b) => b.type === 'buttons') ?? false;
    next.textContent = last ? 'Done' : 'Next';
    next.hidden = last && lastHasButtons;
  }
  syncNav();

  // Swipe between slides on a touch screen.
  let startX: number | null = null;
  viewport.addEventListener('pointerdown', (event: PointerEvent) => {
    startX = event.clientX;
  });
  viewport.addEventListener('pointerup', (event: PointerEvent) => {
    if (startX === null || !many) return;
    const delta = event.clientX - startX;
    startX = null;
    if (Math.abs(delta) > 50) go(delta < 0 ? index + 1 : index - 1);
  });

  card.append(viewport);
  if (nav.childNodes.length > 0) card.append(nav);
  if (closable) {
    const close = h('button', { class: 'engage-close', type: 'button', 'aria-label': 'Close' });
    close.appendChild(svg(icons.close));
    close.addEventListener('click', dismiss);
    card.appendChild(close);
    scrim.addEventListener('click', (event) => {
      if (event.target === scrim) dismiss();
    });
  }

  document.addEventListener('keydown', onKey);
  host.onCleanup(() => document.removeEventListener('keydown', onKey));
  scrim.appendChild(card);
  host.layer.appendChild(scrim);
  // aria-modal promises that focus is inside; keep the promise.
  focusFirst(card);

  return {
    close() {
      if (finish()) leave(scrim);
    },
  };
}

function drawSlide(
  el: HTMLElement,
  blocks: readonly Block[],
  position: ModalEngagement['modal']['mediaPosition'],
  onButton: (button: EngageButton) => void,
  onLink: () => void,
): void {
  const [first, ...rest] = blocks;
  const heroBlock = isMedia(first) ? first : undefined;
  // A video cannot sit behind text; it goes on top instead.
  const layout = heroBlock?.type === 'video' && position === 'background' ? 'top' : position;
  const hero = heroBlock ? renderBlock(heroBlock, { onButton, onLink }) : null;
  const content = renderBlocks(heroBlock ? rest : blocks, { onButton, onLink });
  // Buttons sit at the bottom of the slide, after everything else.
  for (const row of content.querySelectorAll('.eg-buttons')) content.appendChild(row);
  el.classList.add(`modal__slide--${hero ? layout : 'plain'}`);
  if (hero) el.appendChild(h('div', { class: 'modal__media' }, hero));
  el.appendChild(h('div', { class: 'modal__content' }, content));
}
