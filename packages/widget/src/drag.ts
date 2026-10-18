/**
 * The "Draggable" placement: the visitor can move the launcher anywhere on
 * the screen, and it stays where they left it on their next visit.
 *
 * Where it sits is kept as the nearer edge on each axis and the distance from
 * it, so the panel, popups and messages open toward the middle of the screen
 * from wherever the launcher is, and a launcher near the right edge stays
 * near the right edge when the window is resized. The spot lives in this
 * browser's localStorage; nothing about it is sent anywhere.
 */

export interface LauncherSpot {
  h: 'left' | 'right';
  /** Pixels from the `h` edge to the launcher's near side. */
  x: number;
  v: 'top' | 'bottom';
  /** Pixels from the `v` edge to the launcher's near side. */
  y: number;
}

export const SPOT_KEY = 'helpwell:launcher-spot';
/** The launcher's size (styles.ts). */
const SIZE = 56;
/** The closest the launcher comes to an edge of the window. */
const MARGIN = 8;
/** How far a press has to travel before it is a drag and not a click. */
const DRAG_THRESHOLD = 5;
/** How far one arrow-key press moves the launcher. */
const KEY_STEP = 24;

export function readSpot(): LauncherSpot | null {
  try {
    const raw = localStorage.getItem(SPOT_KEY);
    if (!raw) return null;
    const spot = JSON.parse(raw) as Partial<LauncherSpot>;
    if (
      (spot.h === 'left' || spot.h === 'right') &&
      (spot.v === 'top' || spot.v === 'bottom') &&
      typeof spot.x === 'number' &&
      Number.isFinite(spot.x) &&
      typeof spot.y === 'number' &&
      Number.isFinite(spot.y)
    ) {
      return { h: spot.h, x: spot.x, v: spot.v, y: spot.y };
    }
  } catch {
    // Storage can be blocked or hold junk; the starting corner applies.
  }
  return null;
}

export function saveSpot(spot: LauncherSpot): void {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(spot));
  } catch {
    // Blocked storage: the launcher stays put for this page view only.
  }
}

/** The spot for a launcher whose top-left corner is at (left, top) in the window. */
export function spotAt(left: number, top: number, width: number, height: number): LauncherSpot {
  const l = clamp(left, MARGIN, width - SIZE - MARGIN);
  const t = clamp(top, MARGIN, height - SIZE - MARGIN);
  const onLeft = l + SIZE / 2 < width / 2;
  const onTop = t + SIZE / 2 < height / 2;
  return {
    h: onLeft ? 'left' : 'right',
    x: Math.round(onLeft ? l : width - l - SIZE),
    v: onTop ? 'top' : 'bottom',
    y: Math.round(onTop ? t : height - t - SIZE),
  };
}

/** The same spot, moved back inside a window of this size if it no longer fits. */
export function fitSpot(spot: LauncherSpot, width: number, height: number): LauncherSpot {
  const left = spot.h === 'left' ? spot.x : width - spot.x - SIZE;
  const top = spot.v === 'top' ? spot.y : height - spot.y - SIZE;
  return spotAt(left, top, width, height);
}

/**
 * Put the host (the zero-size anchor the launcher hangs from) at a spot.
 * `data-position` names the corner the launcher is nearest, which is what the
 * stylesheet uses to open everything toward the middle of the screen.
 */
export function applySpot(host: HTMLElement, launcher: HTMLElement, spot: LauncherSpot): void {
  host.dataset.position = `${spot.v}-${spot.h}`;
  const style = host.style;
  style.left = spot.h === 'left' ? `${spot.x}px` : '';
  style.right = spot.h === 'right' ? `${spot.x}px` : '';
  style.top = spot.v === 'top' ? `${spot.y}px` : '';
  style.bottom = spot.v === 'bottom' ? `${spot.y}px` : '';
  // The panel opens from the launcher, so it can only be as big as the room
  // between the launcher and the far edges.
  style.setProperty('--hw-panel-max-width', `calc(100vw - ${spot.x + 16}px)`);
  style.setProperty('--hw-panel-max-height', `calc(100vh - ${spot.y + 96}px)`);
  launcher.style.left = spot.h === 'left' ? '0' : '';
  launcher.style.right = spot.h === 'right' ? '0' : '';
}

export interface DraggableOptions {
  host: HTMLElement;
  launcher: HTMLElement;
  /** Where the launcher starts when this visitor has never moved it. */
  start: LauncherSpot;
}

export interface Draggable {
  /**
   * True once for the click that ends a drag, which is not a click on the
   * launcher. The launcher's click handler asks before it opens the panel.
   */
  endedDrag(): boolean;
  destroy(): void;
}

export function makeDraggable({ host, launcher, start }: DraggableOptions): Draggable {
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  /** Where the visitor last put it, which a smaller window may not have room for. */
  let wanted = readSpot() ?? start;
  let spot = fitSpot(wanted, viewport().width, viewport().height);
  applySpot(host, launcher, spot);
  launcher.dataset.draggable = 'true';
  launcher.title = 'Drag to move';

  let press: { id: number; x: number; y: number; left: number; top: number } | null = null;
  let dragged = false;

  const move = (left: number, top: number) => {
    const { width, height } = viewport();
    spot = spotAt(left, top, width, height);
    applySpot(host, launcher, spot);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    dragged = false;
    // Moves keep coming here even once the pointer is past the launcher's edge.
    try {
      launcher.setPointerCapture(event.pointerId);
    } catch {
      // Not every environment supports capture; moves over the launcher still arrive.
    }
  };

  const onMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!dragged) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragged = true;
      launcher.dataset.dragging = 'true';
    }
    event.preventDefault();
    move(press.left + dx, press.top + dy);
  };

  const onUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return;
    press = null;
    delete launcher.dataset.dragging;
    if (dragged) {
      wanted = spot;
      saveSpot(spot);
    }
  };

  // A keyboard can move it too: Alt with the arrow keys.
  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey) return;
    const step = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    }[event.key];
    if (!step) return;
    event.preventDefault();
    const rect = launcher.getBoundingClientRect();
    move(rect.left + (step[0] ?? 0), rect.top + (step[1] ?? 0));
    wanted = spot;
    saveSpot(spot);
  };

  // A smaller window keeps the launcher on screen; the spot the visitor
  // chose is kept, so it goes back there when the window grows again.
  const onResize = () => {
    const { width, height } = viewport();
    spot = fitSpot(wanted, width, height);
    applySpot(host, launcher, spot);
  };

  launcher.addEventListener('pointerdown', onDown);
  launcher.addEventListener('pointermove', onMove);
  launcher.addEventListener('pointerup', onUp);
  launcher.addEventListener('pointercancel', onUp);
  launcher.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  return {
    endedDrag() {
      if (!dragged) return false;
      dragged = false;
      return true;
    },
    destroy() {
      launcher.removeEventListener('pointerdown', onDown);
      launcher.removeEventListener('pointermove', onMove);
      launcher.removeEventListener('pointerup', onUp);
      launcher.removeEventListener('pointercancel', onUp);
      launcher.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
