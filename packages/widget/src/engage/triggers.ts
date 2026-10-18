/**
 * Triggers: the "when" of targeting, which only the page can answer.
 *
 * The server decides who qualifies and on which pages (core's
 * engage/targeting.ts); this decides the moment. Nothing here knows about
 * engagements, so forms can arm the same triggers:
 *
 *   const disarm = armTrigger({ type: 'scroll', percent: 60 }, () => show(), { events });
 *
 * `fire` is called at most once per arming, and `disarm` takes every
 * listener and timer back off, fired or not. The shapes match core's
 * `triggerSchema`:
 *
 *   load          on the next tick
 *   delay         N seconds after arming
 *   scroll        once the visitor has scrolled `percent` of the page (a page
 *                 too short to scroll counts as all of it)
 *   exit          the pointer leaves through the top of the window; never on
 *                 a touch screen, which has no pointer to leave with
 *   time_on_page  N seconds with the tab visible; hidden time does not count
 *   inactivity    N seconds without a pointer move, click, key, scroll or touch
 *   click         a click on anything matching `selector` (inside shadow roots too)
 *   event         `helpwell('track', name)` on this page
 *   manual        never on its own; only `helpwell.engage.show(id)`
 */

import type { Trigger } from './types.js';

export type { Trigger };

/** Named events from the page (`helpwell('track', …)`), for the `event` trigger. */
export class EventHub {
  #listeners = new Map<string, Set<() => void>>();

  on(name: string, fn: () => void): () => void {
    const set = this.#listeners.get(name) ?? new Set();
    set.add(fn);
    this.#listeners.set(name, set);
    return () => set.delete(fn);
  }

  emit(name: string): void {
    for (const fn of [...(this.#listeners.get(name) ?? [])]) fn();
  }
}

export interface TriggerOptions {
  events: EventHub;
  /** Whether exit intent can happen here. Defaults to "has a fine pointer". */
  isDesktop?: () => boolean;
}

/** The longest any trigger waits: an hour. */
const MAX_SECONDS = 3600;

const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

export function armTrigger(
  trigger: Trigger,
  fire: () => void,
  options: TriggerOptions,
): () => void {
  let done = false;
  const cleanups: (() => void)[] = [];
  const disarm = () => {
    for (const fn of cleanups.splice(0)) fn();
  };
  const once = () => {
    if (done) return;
    done = true;
    disarm();
    fire();
  };
  const listen = (
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, handler, opts);
    cleanups.push(() => target.removeEventListener(type, handler, opts));
  };
  const after = (ms: number, fn: () => void) => {
    const timer = setTimeout(fn, ms);
    cleanups.push(() => clearTimeout(timer));
  };
  const seconds = (value: number) => Math.min(Math.max(value, 0), MAX_SECONDS) * 1000;

  switch (trigger.type) {
    case 'load':
      after(0, once);
      break;

    case 'delay':
      after(seconds(trigger.seconds), once);
      break;

    case 'scroll': {
      const check = () => {
        if (scrolledPercent() >= trigger.percent) once();
      };
      listen(window, 'scroll', check, { passive: true });
      listen(window, 'resize', check);
      // The page may already be scrolled that far, or too short to scroll.
      after(0, check);
      break;
    }

    case 'exit': {
      const desktop = options.isDesktop ?? finePointer;
      if (!desktop()) break;
      listen(document, 'mouseout', (event) => {
        const e = event as MouseEvent;
        if (!e.relatedTarget && e.clientY <= 0) once();
      });
      break;
    }

    case 'time_on_page': {
      let remaining = seconds(trigger.seconds);
      let startedAt = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const run = () => {
        startedAt = Date.now();
        timer = setTimeout(once, remaining);
      };
      const pause = () => {
        clearTimeout(timer);
        timer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      };
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (timer !== undefined) pause();
        } else if (timer === undefined) {
          run();
        }
      });
      cleanups.push(() => clearTimeout(timer));
      if (document.visibilityState !== 'hidden') run();
      break;
    }

    case 'inactivity': {
      const ms = seconds(trigger.seconds);
      let timer = setTimeout(once, ms);
      const reset = () => {
        clearTimeout(timer);
        timer = setTimeout(once, ms);
      };
      for (const type of ACTIVITY) listen(window, type, reset, { passive: true });
      cleanups.push(() => clearTimeout(timer));
      break;
    }

    case 'click': {
      if (!trigger.selector) break;
      listen(
        document,
        'click',
        (event) => {
          if (event.composedPath().some((node) => matches(node, trigger.selector))) once();
        },
        { capture: true },
      );
      break;
    }

    case 'event':
      if (trigger.name) cleanups.push(options.events.on(trigger.name, once));
      break;

    case 'manual':
      break;
  }

  return () => {
    done = true;
    disarm();
  };
}

/** How far down the page the bottom of the viewport is, as a percentage. */
export function scrolledPercent(): number {
  const doc = document.documentElement;
  const height = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
  const viewport = window.innerHeight;
  if (height <= viewport) return 100;
  return Math.min(100, ((window.scrollY + viewport) / height) * 100);
}

function matches(node: EventTarget, selector: string): boolean {
  if (!(node instanceof Element)) return false;
  try {
    return node.matches(selector);
  } catch {
    // A selector from settings must never throw into the host page.
    return false;
  }
}

function finePointer(): boolean {
  try {
    return matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return true;
  }
}
