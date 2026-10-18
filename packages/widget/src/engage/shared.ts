/**
 * What the engage surfaces share: the host they render into, and helpers.
 *
 * A surface (modal, banner, hotspot, tour, survey) never talks to the API or
 * the widget directly. It asks its host, which is the live widget on a
 * customer's page and a stand-in in the dashboard's preview. That split is
 * what lets the preview run the real renderers without recording anything,
 * sending anything, or needing the page's elements to exist.
 */

import type { ButtonAction, ImpressionState, SurveyAnswerBody } from './types.js';

export interface EngageHost {
  root: ShadowRoot;
  layer: HTMLElement;
  /** The dashboard's preview: nothing is recorded, sent or followed. */
  preview: boolean;
  /** Record what the visitor did, so it is counted and not shown again. */
  record(id: string, state: ImpressionState, extra?: { step?: number }): void;
  /** Close a surface the visitor waved away, and record that they did. */
  dismiss(id: string, el: HTMLElement, extra?: { step?: number }): void;
  /**
   * Register something to undo when the layer is cleared, on destroy or when
   * the page moves on: a window listener, a document listener, a timer.
   */
  onCleanup(fn: () => void): void;
  /** Look up a host page element. The preview stands one in for a selector it lacks. */
  findTarget(selector: string): HTMLElement | null;
  /** Carry out a button that leaves the engagement: a link, the chat, an article, a tour. */
  act(action: ButtonAction, value: string, newTab: boolean): void;
  /** Send one survey answer. Rejects when it did not go through. */
  answer(surveyId: string, answer: SurveyAnswerBody): Promise<void>;
  /** The widget's session id, which ties a survey's answers together. */
  session(): string;
  /** Tour progress, kept across page loads so a tour resumes where it was left. */
  progress: TourProgress;
}

export interface TourProgress {
  get(id: string): number | null;
  set(id: string, step: number): void;
  clear(id: string): void;
}

/** What a renderer hands back for something it put on screen. */
export interface Surface {
  /** Take it off screen from code (`helpwell.engage.hide()`), recording nothing. */
  close(): void;
}

/** What the orchestrator gives each renderer. */
export interface ShowOptions {
  /**
   * Ask the server whether it may be shown now (frequency, the global cap).
   * Called at the last moment, once there is definitely something to draw;
   * resolving false means draw nothing. `step` is the tour step about to be drawn.
   */
  claim(step?: number): Promise<boolean>;
  /** It has gone for good: the next queued engagement may show. */
  done(): void;
  /**
   * Carry on from this step of a tour, or open a modal on this slide
   * (0-based), rather than the first.
   */
  startAt?: number;
}

/** Animate out, then remove. Leaving is always faster than arriving. */
export function leave(el: HTMLElement): void {
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 200);
}

/** A selector from settings must never be able to throw. */
export function safeQuery(selector: string): HTMLElement | null {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Wait for an element that may not be on the page yet: a single-page app
 * often renders it a moment after the route changes. Polls rather than
 * observing mutations, because a busy page mutates constantly and the answer
 * is only needed a few times a second. Resolves null once `ms` has passed.
 */
export function waitForTarget(
  host: EngageHost,
  selector: string,
  ms: number,
): Promise<HTMLElement | null> {
  const found = host.findTarget(selector);
  if (found || ms <= 0) return Promise.resolve(found);
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (value: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const poll = () => {
      const el = host.findTarget(selector);
      if (el) finish(el);
      else if (Date.now() >= deadline) finish(null);
      else timer = setTimeout(poll, 200);
    };
    timer = setTimeout(poll, 200);
    // The layer being cleared (the page moved on) ends the wait.
    host.onCleanup(() => finish(null));
  });
}

/** Whether a path pattern matches the current page: `*` in a segment, `**` across. */
export function pageMatches(pattern: string, path = location.pathname): boolean {
  const source = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, (run) => (run.length > 1 ? '.*' : '[^/]*'));
  try {
    return new RegExp(`^${source}/?$`).test(path);
  } catch {
    return false;
  }
}
