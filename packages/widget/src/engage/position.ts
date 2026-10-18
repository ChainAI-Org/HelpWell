/**
 * Where a tooltip goes next to the element it points at.
 *
 * Pure arithmetic on rectangles, so it can be tested without a layout
 * engine. `auto` takes the first side with room for the whole popover,
 * below first because that is where people read on to; whatever side it
 * lands on, the popover is kept inside the viewport.
 */

import type { Placement } from './types.js';

export type Side = Exclude<Placement, 'auto'>;

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const MARGIN = 8;

export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  placement: Placement,
  viewport: { width: number; height: number },
  gap = 12,
): { top: number; left: number; side: Side } {
  const room: Record<Side, boolean> = {
    bottom: viewport.height - (anchor.top + anchor.height) >= size.height + gap + MARGIN,
    top: anchor.top >= size.height + gap + MARGIN,
    right: viewport.width - (anchor.left + anchor.width) >= size.width + gap + MARGIN,
    left: anchor.left >= size.width + gap + MARGIN,
  };
  const side: Side =
    placement === 'auto'
      ? ((['bottom', 'top', 'right', 'left'] as const).find((s) => room[s]) ?? 'bottom')
      : placement;

  let top: number;
  let left: number;
  if (side === 'bottom' || side === 'top') {
    top = side === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - size.height - gap;
    left = anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    top = anchor.top + anchor.height / 2 - size.height / 2;
    left = side === 'right' ? anchor.left + anchor.width + gap : anchor.left - size.width - gap;
  }

  const clamp = (value: number, max: number) =>
    Math.max(MARGIN, Math.min(value, Math.max(MARGIN, max - MARGIN)));
  return {
    top: Math.round(clamp(top, viewport.height - size.height)),
    left: Math.round(clamp(left, viewport.width - size.width)),
    side,
  };
}

/** Where a hotspot's beacon sits on its element: a corner or the middle of an edge. */
export function beaconPoint(anchor: Box, placement: Placement): { top: number; left: number } {
  switch (placement) {
    case 'top':
      return { top: anchor.top, left: anchor.left + anchor.width / 2 };
    case 'bottom':
      return { top: anchor.top + anchor.height, left: anchor.left + anchor.width / 2 };
    case 'left':
      return { top: anchor.top + anchor.height / 2, left: anchor.left };
    case 'right':
      return { top: anchor.top + anchor.height / 2, left: anchor.left + anchor.width };
    default:
      return { top: anchor.top, left: anchor.left + anchor.width };
  }
}
