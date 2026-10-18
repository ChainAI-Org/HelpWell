/**
 * Hotspots: a beacon on an element (a pulsing ring, a still dot, or a
 * question-mark badge), with a tooltip of blocks.
 *
 * The element may render a moment after the page does (single-page apps
 * usually do), so the beacon waits a few seconds for it. If it never comes,
 * nothing is drawn and nothing is recorded. The tooltip goes on the side the
 * owner chose, or on whichever side has room.
 */

import { h, svg } from '../dom.js';
import { icons } from '../icons.js';
import { blocksLabel, renderBlocks } from './blocks.js';
import { beaconPoint, placePopover } from './position.js';
import { type EngageHost, leave, type ShowOptions, type Surface, waitForTarget } from './shared.js';
import type { EngageButton, HotspotEngagement } from './types.js';

/** How long a beacon waits for its element to appear. */
export const HOTSPOT_WAIT_MS = 10_000;

export async function showHotspot(
  host: EngageHost,
  engagement: HotspotEngagement,
  options: ShowOptions,
): Promise<Surface | null> {
  const { placement, beacon, blocks } = engagement.hotspot;
  const target = await waitForTarget(host, engagement.hotspot.target, HOTSPOT_WAIT_MS);
  if (!target || !(await options.claim())) {
    options.done();
    return null;
  }

  const label = blocksLabel(blocks, 'What is this?');
  const dot = h('button', {
    class: `hotspot hotspot--${beacon}`,
    type: 'button',
    'aria-label': label,
    'aria-expanded': 'false',
  });
  const bubble = h('div', { class: 'hotspot__bubble', role: 'dialog', 'aria-label': label });
  bubble.hidden = true;

  let opened = false;
  let finished = false;
  const finish = () => {
    if (finished) return false;
    finished = true;
    window.removeEventListener('scroll', place);
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    options.done();
    return true;
  };
  const remove = () => {
    leave(dot);
    leave(bubble);
  };

  const onButton = (button: EngageButton) => {
    if (button.action === 'dismiss') {
      if (finish()) {
        host.record(engagement.id, 'dismissed');
        remove();
      }
      return;
    }
    if (button.action === 'next') {
      toggle(false);
      return;
    }
    host.record(engagement.id, 'clicked');
    host.act(button.action, button.value, button.newTab);
    toggle(false);
  };

  bubble.appendChild(
    renderBlocks(blocks, { onButton, onLink: () => host.record(engagement.id, 'clicked') }),
  );
  if (engagement.dismissible) {
    const close = h('button', { class: 'engage-close', type: 'button', 'aria-label': 'Dismiss' });
    close.appendChild(svg(icons.close));
    close.addEventListener('click', () => {
      if (!finish()) return;
      host.record(engagement.id, 'dismissed');
      remove();
    });
    bubble.appendChild(close);
  }

  // The layer is fixed to the viewport, so a client rect is already in its
  // coordinates; adding the scroll offset would push the dot off its target.
  function place(): void {
    const rect = target!.getBoundingClientRect();
    const point = beaconPoint(rect, placement);
    const half = beacon === 'question' ? 10 : 7;
    dot.style.top = `${point.top - half}px`;
    dot.style.left = `${point.left - half}px`;
    if (bubble.hidden) return;
    const spot = placePopover(
      rect,
      { width: bubble.offsetWidth || 280, height: bubble.offsetHeight || 120 },
      placement,
      { width: window.innerWidth, height: window.innerHeight },
    );
    bubble.style.top = `${spot.top}px`;
    bubble.style.left = `${spot.left}px`;
    bubble.dataset.side = spot.side;
  }

  function toggle(open: boolean): void {
    bubble.hidden = !open;
    dot.setAttribute('aria-expanded', String(open));
    if (open) {
      place();
      if (!opened) {
        opened = true;
        host.record(engagement.id, 'clicked');
      }
    }
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !bubble.hidden) {
      toggle(false);
      dot.focus();
    }
  };

  if (beacon === 'question') dot.textContent = '?';
  dot.addEventListener('click', () => toggle(bubble.hidden));
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey);
  host.onCleanup(() => finish());

  host.layer.append(dot, bubble);
  place();

  return {
    close() {
      if (finish()) remove();
    },
  };
}
