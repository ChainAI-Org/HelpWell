/**
 * Keeping a human conversation live without a socket.
 *
 * The open-source API has no push channel, and a support extension may not
 * either, so the widget polls: every 3 seconds while someone is actually
 * using the panel (open, the page focused, touched in the last minute), every
 * 15 seconds otherwise, and not at all while the page is hidden. Coming back
 * to the tab polls at once. That keeps a teammate's reply feeling immediate
 * for the person watching, and costs next to nothing for a tab left open all
 * afternoon.
 *
 * Typing goes the other way, throttled to one call every 3 seconds.
 */

export const FAST_POLL_MS = 3_000;
export const IDLE_POLL_MS = 15_000;
/** No pointer or key in the panel for this long counts as idle. */
export const IDLE_AFTER_MS = 60_000;
export const TYPING_THROTTLE_MS = 3_000;
/** A visitor who stops typing for this long has stopped typing. */
export const TYPING_IDLE_MS = 5_000;

export interface Poller {
  /** Poll now, and restart the clock. */
  poke(): void;
  stop(): void;
}

/**
 * Run `tick`, then again after `interval()`, until the signal aborts. A tick
 * never overlaps the one before it, and a hidden page stops the loop until
 * it is visible again.
 */
export function poller(options: {
  tick: () => Promise<void>;
  interval: () => number;
  signal: AbortSignal;
}): Poller {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;

  const schedule = () => {
    clearTimeout(timer);
    if (stopped || options.signal.aborted || document.visibilityState === 'hidden') return;
    timer = setTimeout(run, options.interval());
  };

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await options.tick();
    } catch {
      // A failed poll is retried on the next one.
    } finally {
      running = false;
      schedule();
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') clearTimeout(timer);
    else void run();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  options.signal.addEventListener('abort', stop, { once: true });

  schedule();
  return {
    poke() {
      void run();
    },
    stop,
  };
}

/** When the visitor last touched the panel, for telling "using it" from "left it open". */
export function activityClock(
  target: EventTarget,
  signal: AbortSignal,
  now: () => number = Date.now,
): { active(): boolean; touch(): void } {
  let last = now();
  const touch = () => {
    last = now();
  };
  for (const type of ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart']) {
    target.addEventListener(type, touch, { passive: true, signal } as AddEventListenerOptions);
  }
  return { active: () => now() - last < IDLE_AFTER_MS, touch };
}

/**
 * Tell the other side the visitor is typing, at most once every 3 seconds.
 * A change of state inside the window is sent when it ends, so "stopped"
 * is never lost; five quiet seconds after the last keystroke count as
 * stopped.
 */
export function typingSender(send: (typing: boolean) => Promise<void>): {
  update(typing: boolean): void;
  stop(): void;
} {
  let sent: boolean | null = null;
  let sentAt = Number.NEGATIVE_INFINITY;
  let wanted = false;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const flush = () => {
    trailing = undefined;
    if (stopped || wanted === sent) return;
    const wait = sentAt + TYPING_THROTTLE_MS - Date.now();
    if (wait > 0) {
      trailing = setTimeout(flush, wait);
      return;
    }
    sent = wanted;
    sentAt = Date.now();
    void send(wanted).catch(() => {
      // Typing is a nicety; a lost one is not worth a retry.
    });
  };

  const update = (typing: boolean): void => {
    if (stopped) return;
    wanted = typing;
    clearTimeout(idle);
    if (typing) idle = setTimeout(() => update(false), TYPING_IDLE_MS);
    // Still typing, already said so: nothing to send until the window ends.
    if (typing && sent === true && Date.now() - sentAt < TYPING_THROTTLE_MS) return;
    // Re-assert once a window has passed, so the other side's indicator
    // does not time out while they are still typing.
    if (typing && sent === true) sent = null;
    if (!trailing) flush();
  };

  return {
    update,
    stop() {
      stopped = true;
      clearTimeout(trailing);
      clearTimeout(idle);
    },
  };
}
