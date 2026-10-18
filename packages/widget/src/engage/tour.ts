/**
 * Product tours.
 *
 * A tour points at real elements on the host page, one step at a time, and
 * has to cope with the page not co-operating:
 *
 *   - A step's element may not be there yet. The tour waits up to
 *     `missingTarget.waitSeconds` for it, then skips the step or stops, as
 *     the owner chose.
 *   - A step may belong to another page (`page`). The tour waits there,
 *     drawing nothing, until the visitor arrives.
 *   - A step can move on by its Next button, by a click on its element
 *     (`advance: 'click'`), or by the visitor reaching a URL
 *     (`advance: 'url'`), which is what carries a tour across pages.
 *
 * Progress is saved at every step, in this browser, so a tour resumes where
 * it was left after a reload or a navigation; the orchestrator asks the
 * server for it again with `resume`. Every step drawn is recorded as seen
 * with its step number, which is where the drop-off funnel comes from.
 */

import { append, h, svg } from '../dom.js';
import { focusSelf } from '../focus.js';
import { icons } from '../icons.js';
import { renderBlocks } from './blocks.js';
import { placePopover } from './position.js';
import {
  type EngageHost,
  leave,
  pageMatches,
  reducedMotion,
  type ShowOptions,
  type Surface,
  waitForTarget,
} from './shared.js';
import type { EngageButton, TourEngagement, TourStep } from './types.js';

export async function runTour(
  host: EngageHost,
  engagement: TourEngagement,
  options: ShowOptions,
): Promise<Surface | null> {
  const { steps, missingTarget } = engagement.tour;
  const total = steps.length;
  if (total === 0) {
    options.done();
    return null;
  }

  const spotlight = h('div', { class: 'spotlight' });
  const pop = h('div', { class: 'tourPop', role: 'dialog', 'aria-label': 'Product tour' });

  // A resumed tour whose step was waiting for this URL has arrived: move on.
  let index = options.startAt ?? 0;
  if (options.startAt !== undefined && !host.preview) {
    while (index < total && arrived(steps[index]!)) index++;
  }

  let claimed = options.startAt !== undefined;
  let drawn = false;
  let active = true;
  let target: HTMLElement | null = null;
  let detachClick: (() => void) | null = null;

  const stop = () => {
    if (!active) return false;
    active = false;
    detachClick?.();
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place);
    options.done();
    return true;
  };

  /** Ended by the visitor or by finishing: forget the progress and record it. */
  const end = (state: 'completed' | 'dismissed' | null) => {
    if (!stop()) return;
    host.progress.clear(engagement.id);
    if (drawn && state) {
      host.record(engagement.id, state, { step: state === 'completed' ? total : index + 1 });
    }
    if (drawn) {
      leave(spotlight);
      leave(pop);
    }
  };

  function place(): void {
    const step = steps[index];
    if (!step || !active) return;
    if (!target) {
      // A step with nothing to point at is a card in the middle of the screen.
      spotlight.hidden = true;
      pop.dataset.side = 'center';
      pop.style.top = `${Math.max(12, (window.innerHeight - (pop.offsetHeight || 200)) / 2)}px`;
      pop.style.left = `${Math.max(12, (window.innerWidth - (pop.offsetWidth || 320)) / 2)}px`;
      return;
    }
    // The layer is fixed to the viewport, so a client rect is already in its
    // coordinates: no scroll offset is added.
    const rect = target.getBoundingClientRect();
    const pad = 6;
    spotlight.hidden = !engagement.tour.spotlight;
    Object.assign(spotlight.style, {
      top: `${rect.top - pad}px`,
      left: `${rect.left - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    const spot = placePopover(
      rect,
      { width: pop.offsetWidth || 320, height: pop.offsetHeight || 180 },
      step.placement === 'tour' ? engagement.tour.placement : step.placement,
      { width: window.innerWidth, height: window.innerHeight },
      14,
    );
    pop.style.top = `${spot.top}px`;
    pop.style.left = `${spot.left}px`;
    pop.dataset.side = spot.side;
  }

  async function show(): Promise<void> {
    if (!active) return;
    detachClick?.();
    detachClick = null;
    const step = steps[index];
    if (!step) {
      end('completed');
      return;
    }
    // Only a tour that has started is resumed later; one the server has not
    // let start yet leaves nothing behind to bring it back.
    if (claimed) host.progress.set(engagement.id, index);

    // This step lives on another page: draw nothing here, and hold nothing
    // else up. The progress is saved, and the orchestrator resumes the tour
    // when the visitor navigates.
    if (step.page && !host.preview && !pageMatches(step.page)) {
      if (drawn) {
        pop.remove();
        spotlight.remove();
      }
      stop();
      return;
    }

    target = step.target
      ? await waitForTarget(host, step.target, missingTarget.waitSeconds * 1000)
      : null;
    if (!active) return;
    if (step.target && !target) {
      if (missingTarget.action === 'stop') {
        // Not the visitor's doing, so neither a dismissal nor a completion:
        // the tour quietly ends, and the funnel shows where.
        end(null);
        return;
      }
      index++;
      await show();
      return;
    }

    if (!claimed) {
      claimed = true;
      if (!(await options.claim(index + 1))) {
        stop();
        return;
      }
      host.progress.set(engagement.id, index);
    } else {
      host.record(engagement.id, 'seen', { step: index + 1 });
    }
    if (!active) return;

    if (!drawn || !pop.isConnected) {
      drawn = true;
      host.layer.append(spotlight, pop);
    }
    draw(step);
    target?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // Layout has to settle before the popover can be positioned against it.
    requestAnimationFrame(place);
    focusSelf(pop);

    if (step.advance === 'click' && target) {
      const clicked = target;
      const onClick = () => {
        // Saved before anything else: the click may be about to leave the page.
        host.progress.set(engagement.id, index + 1);
        index++;
        setTimeout(() => void show(), 0);
      };
      clicked.addEventListener('click', onClick, { capture: true, once: true });
      detachClick = () => clicked.removeEventListener('click', onClick, { capture: true });
    }
  }

  function draw(step: TourStep): void {
    pop.textContent = '';
    const onButton = (button: EngageButton) => {
      if (button.action === 'next') {
        advance();
        return;
      }
      if (button.action === 'dismiss') {
        end('dismissed');
        return;
      }
      host.record(engagement.id, 'clicked', { step: index + 1 });
      if (button.action === 'url') {
        // Following a link moves the tour on; it picks up on the next page.
        host.progress.set(engagement.id, index + 1);
      }
      host.act(button.action, button.value, button.newTab);
    };

    const actions = h('div', { class: 'tourPop__actions' });
    if (engagement.tour.allowSkip) {
      actions.appendChild(
        h('button', {
          class: 'tourPop__skip',
          type: 'button',
          text: 'Skip tour',
          on: { click: () => end('dismissed') },
        }),
      );
    }
    const previous = steps[index - 1];
    if (index > 0 && previous?.advance === 'next' && !previous.page) {
      actions.appendChild(
        h('button', {
          class: 'engage-ghost',
          type: 'button',
          text: 'Back',
          on: {
            click: () => {
              index--;
              void show();
            },
          },
        }),
      );
    }
    if (step.advance === 'next') {
      actions.appendChild(
        h('button', {
          class: 'engage-primary',
          type: 'button',
          text: index === total - 1 ? 'Finish' : 'Next',
          on: { click: advance },
        }),
      );
    }

    const hint =
      step.advance === 'click'
        ? 'Click the highlighted element to continue.'
        : step.advance === 'url'
          ? 'The tour carries on when you get to the next page.'
          : null;

    append(pop, [
      engagement.tour.showProgress
        ? h('span', { class: 'tourPop__count', text: `${index + 1} of ${total}` })
        : null,
      renderBlocks(step.blocks, {
        onButton,
        onLink: () => host.record(engagement.id, 'clicked', { step: index + 1 }),
      }),
      hint ? h('p', { class: 'tourPop__hint', text: hint }) : null,
      actions,
    ]);
    if (engagement.dismissible) {
      const close = h('button', {
        class: 'engage-close',
        type: 'button',
        'aria-label': 'End tour',
      });
      close.appendChild(svg(icons.close));
      close.addEventListener('click', () => end('dismissed'));
      pop.appendChild(close);
    }
  }

  function advance(): void {
    index++;
    void show();
  }

  // Listeners go on before the first step, because a tour with nothing to
  // show ends inside it and must be able to take them off again.
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  host.onCleanup(() => {
    // The page moved on: stop drawing, but keep the progress to resume from.
    stop();
  });
  await show();

  return {
    close() {
      if (!stop()) return;
      leave(spotlight);
      leave(pop);
    },
  };
}

/** A step that waits for a URL, and the visitor is now at it. */
function arrived(step: TourStep): boolean {
  return step.advance === 'url' && Boolean(step.url) && pageMatches(step.url);
}
