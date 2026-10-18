import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fitSpot, readSpot, SPOT_KEY, spotAt } from '../src/drag.js';
import { Widget } from '../src/widget.js';
import { createFakeServer, flush } from './helpers/server.js';

let widget: Widget | null = null;

async function mount(position: 'draggable' | 'bottom-right' = 'draggable'): Promise<Widget> {
  const server = createFakeServer({ config: { widget: { position } } as never });
  widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch });
  await widget.mount();
  await flush();
  return widget;
}

function host(): HTMLElement {
  const el = document.querySelector<HTMLElement>('helpwell-widget');
  if (!el) throw new Error('widget is not mounted');
  return el;
}

function launcher(): HTMLElement {
  const el = widget?.shadowRoot?.querySelector<HTMLElement>('.launcher');
  if (!el) throw new Error('no launcher');
  return el;
}

function pointer(type: string, x: number, y: number): void {
  launcher().dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true }),
  );
}

/** Pick the launcher up where it is drawn and put it down (dx, dy) away, then let go. */
function drag(dx: number, dy: number): void {
  const rect = launcher().getBoundingClientRect();
  pointer('pointerdown', rect.left, rect.top);
  pointer('pointermove', rect.left + dx / 2, rect.top + dy / 2);
  pointer('pointermove', rect.left + dx, rect.top + dy);
  pointer('pointerup', rect.left + dx, rect.top + dy);
  launcher().click();
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1200;
  window.innerHeight = 800;
});

afterEach(() => {
  widget?.destroy();
  widget = null;
  localStorage.clear();
  document.body.textContent = '';
});

describe('where a dragged launcher sits', () => {
  it('measures from the nearer edge on each axis', () => {
    expect(spotAt(100, 50, 1200, 800)).toEqual({ h: 'left', x: 100, v: 'top', y: 50 });
    expect(spotAt(1000, 600, 1200, 800)).toEqual({ h: 'right', x: 144, v: 'bottom', y: 144 });
  });

  it('never leaves the window', () => {
    expect(spotAt(-500, -500, 1200, 800)).toEqual({ h: 'left', x: 8, v: 'top', y: 8 });
    expect(spotAt(5000, 5000, 1200, 800)).toEqual({ h: 'right', x: 8, v: 'bottom', y: 8 });
  });

  it('is brought back on screen when the window shrinks', () => {
    // 900px from the left on a wide screen is past the edge of a 600px one.
    const spot = { h: 'left', x: 900, v: 'top', y: 40 } as const;
    expect(fitSpot(spot, 600, 800)).toEqual({ h: 'right', x: 8, v: 'top', y: 40 });
    // A corner spot stays the same corner.
    expect(fitSpot({ h: 'right', x: 24, v: 'bottom', y: 24 }, 400, 300)).toEqual({
      h: 'right',
      x: 24,
      v: 'bottom',
      y: 24,
    });
  });

  it('ignores a saved spot it cannot read', () => {
    localStorage.setItem(SPOT_KEY, '{"h":"middle","x":1,"v":"top","y":2}');
    expect(readSpot()).toBeNull();
    localStorage.setItem(SPOT_KEY, 'not json');
    expect(readSpot()).toBeNull();
  });
});

describe('the Draggable placement', () => {
  it('starts at the bottom right, at the offset from settings', async () => {
    await mount();
    expect(host().dataset.position).toBe('bottom-right');
    expect(host().style.right).toBe('24px');
    expect(host().style.bottom).toBe('24px');
    expect(launcher().dataset.draggable).toBe('true');
  });

  it('moves where the visitor drags it, without opening the panel', async () => {
    const w = await mount();
    drag(-900, -500);
    expect(host().dataset.position).toBe('top-left');
    expect(w.store.state.open).toBe(false);
    expect(readSpot()?.h).toBe('left');
    expect(readSpot()?.v).toBe('top');
  });

  it('stays where the visitor put it on their next visit', async () => {
    await mount();
    drag(-900, -500);
    const saved = readSpot();
    widget?.destroy();
    document.body.textContent = '';

    await mount();
    expect(host().dataset.position).toBe('top-left');
    expect(host().style.left).toBe(`${saved?.x}px`);
    expect(host().style.top).toBe(`${saved?.y}px`);
  });

  it('still opens on a plain click', async () => {
    const w = await mount();
    launcher().click();
    expect(w.store.state.open).toBe(true);
  });

  it('a tiny wobble on press is still a click', async () => {
    const w = await mount();
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 12, 11);
    pointer('pointerup', 12, 11);
    launcher().click();
    expect(w.store.state.open).toBe(true);
    expect(readSpot()).toBeNull();
  });

  it('moves with Alt and the arrow keys', async () => {
    await mount();
    const before = host().style.right;
    launcher().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }),
    );
    expect(host().style.right).not.toBe(before);
    expect(readSpot()).not.toBeNull();
  });

  it('keeps the launcher on screen when the window gets smaller', async () => {
    const wanted = { h: 'left', x: 500, v: 'bottom', y: 24 };
    localStorage.setItem(SPOT_KEY, JSON.stringify(wanted));
    await mount();
    expect(host().style.left).toBe('500px');

    window.innerWidth = 400;
    window.dispatchEvent(new Event('resize'));
    expect(host().dataset.position).toBe('bottom-right');
    expect(host().style.right).toBe('8px');
    // The visitor's own choice is kept, and comes back when the window grows.
    expect(readSpot()).toEqual(wanted);
    window.innerWidth = 1200;
    window.dispatchEvent(new Event('resize'));
    expect(host().style.left).toBe('500px');
  });

  it('a fixed corner ignores any spot saved earlier', async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ h: 'left', x: 40, v: 'top', y: 40 }));
    await mount('bottom-right');
    expect(host().dataset.position).toBe('bottom-right');
    expect(launcher().dataset.draggable).toBeUndefined();
  });
});
