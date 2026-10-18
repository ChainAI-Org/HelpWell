/**
 * The dashboard's live preview: the real engage renderers, fed a draft.
 *
 * The engage editor loads a page into an iframe with this script on it, and
 * posts the definition being edited every time it changes:
 *
 *   frame.contentWindow.postMessage(
 *     { type: 'helpwell:engage:preview', definition, accent, startAt, fields },
 *     location.origin,
 *   );
 *
 * `startAt` opens a tour on the step being edited, or a modal on the slide
 * being edited. `fields` are sample values for `{{field}}` placeholders, so
 * the draft reads as a visitor would see it.
 *
 * Only messages from the parent window, on the same origin, are read. The
 * draft is drawn at once, whatever its trigger, with a host that records
 * nothing, sends nothing and follows no link: a button reports what it would
 * have done back to the editor instead. A hotspot or tour step whose element
 * is not on the preview page points at a stand-in (`[data-helpwell-stand-in]`
 * on that page, labelled with the selector) so it can still be seen.
 */

import { safeAccent } from '../sanitize.js';
import { normalizeEngagement } from './normalize.js';
import { type Fields, fieldsFrom, personalizeEngagement } from './personalize.js';
import { type EngageHost, leave, safeQuery, type TourProgress } from './shared.js';
import { ENGAGE_CSS } from './styles.js';
import { renderEngagement } from './surfaces.js';
import type { ButtonAction } from './types.js';

export const PREVIEW_MESSAGE = 'helpwell:engage:preview';
export const READY_MESSAGE = 'helpwell:engage:ready';
export const ACTION_MESSAGE = 'helpwell:engage:action';

export interface PreviewOptions {
  /** Told what a button would have done, e.g. "Opens /pricing in a new tab". */
  onAction?(description: string): void;
}

export interface PreviewController {
  /**
   * Draw this draft, replacing whatever was there. `startAt`: a tour step or
   * a modal slide, 0-based. `fields`: values for its placeholders.
   */
  render(
    definition: unknown,
    options?: { accent?: string; startAt?: number; fields?: Fields },
  ): void;
  destroy(): void;
}

export function mountPreview(options: PreviewOptions = {}): PreviewController {
  const element = document.createElement('helpwell-engage');
  const root = element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ENGAGE_CSS;
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(style, layer);
  document.body.appendChild(element);

  let cleanups: (() => void)[] = [];
  const steps = new Map<string, number>();
  const progress: TourProgress = {
    get: (id) => steps.get(id) ?? null,
    set: (id, step) => steps.set(id, step),
    clear: (id) => steps.delete(id),
  };

  const host: EngageHost = {
    root,
    layer,
    preview: true,
    record() {},
    dismiss(_id, el) {
      leave(el);
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
    findTarget(selector) {
      return safeQuery(selector) ?? standIn(selector);
    },
    act(action, value, newTab) {
      options.onAction?.(describe(action, value, newTab));
    },
    answer: () => Promise.resolve(),
    session: () => 'preview',
    progress,
  };

  const clear = () => {
    const pending = cleanups;
    cleanups = [];
    for (const fn of pending) fn();
    layer.textContent = '';
  };

  return {
    render(definition, renderOptions = {}) {
      clear();
      element.style.setProperty('--hw-engage-accent', safeAccent(renderOptions.accent));
      const normalized = normalizeEngagement(definition);
      if (!normalized) return;
      const engagement = personalizeEngagement(normalized, renderOptions.fields ?? {});
      void renderEngagement(host, engagement, {
        claim: () => Promise.resolve(true),
        done: () => {},
        startAt:
          engagement.kind === 'tour' || engagement.kind === 'modal'
            ? renderOptions.startAt
            : undefined,
      }).catch((error) => {
        console.warn('helpwell: the preview could not draw this draft.', error);
      });
    },
    destroy() {
      clear();
      element.remove();
    },
  };
}

/**
 * Listen for drafts from the editor and draw them. Returns a function that
 * stops listening. Tells the parent it is ready, so the editor can send the
 * first draft without guessing when the frame has loaded.
 */
export function listenForDrafts(controller: PreviewController): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data as {
      type?: unknown;
      definition?: unknown;
      accent?: unknown;
      startAt?: unknown;
      fields?: unknown;
    };
    if (!data || data.type !== PREVIEW_MESSAGE) return;
    controller.render(data.definition, {
      accent: typeof data.accent === 'string' ? data.accent : undefined,
      startAt: typeof data.startAt === 'number' ? data.startAt : undefined,
      fields: fieldsFrom(data.fields),
    });
  };
  window.addEventListener('message', onMessage);
  if (window.parent !== window) {
    window.parent.postMessage({ type: READY_MESSAGE }, location.origin);
  }
  return () => window.removeEventListener('message', onMessage);
}

/** The preview page's stand-in element, labelled with the selector it is standing in for. */
function standIn(selector: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>('[data-helpwell-stand-in]');
  // A selector not typed yet still gets something to point at while drafting.
  if (el && selector) el.dataset.selector = selector;
  else if (el) delete el.dataset.selector;
  return el;
}

function describe(action: ButtonAction, value: string, newTab: boolean): string {
  switch (action) {
    case 'url':
      return value ? `Opens ${value}${newTab ? ' in a new tab' : ''}` : 'Closes';
    case 'chat':
      return 'Opens the support chat';
    case 'article':
      return `Opens the article ${value}`;
    case 'tour':
      return `Starts the tour ${value}`;
    default:
      return 'Closes';
  }
}
