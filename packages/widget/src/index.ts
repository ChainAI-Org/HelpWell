/**
 * @helpwell/widget
 *
 * Usually mounted by the loader script rather than imported, but the class is
 * exported so a single-page app can control it directly.
 */

import type { FormsListener } from './forms/runtime.js';
import { Widget, type WidgetOptions } from './widget.js';

export type {
  ArticleDetail,
  ArticleSummary,
  Attachment,
  ChangelogSummary,
  ChatReply,
  Citation,
  ConversationThread,
  HomeBlock,
  Presence,
  RoadmapBoard,
  RoadmapCard,
  SearchHit,
  StatusLevel,
  UploadPolicy,
  WidgetConfig,
  WidgetStatus,
} from './api.js';
export { Api, ApiError } from './api.js';
export {
  DEFAULT_HOME_BLOCKS,
  type HomeBlockRenderer,
  registerHomeBlock,
} from './components/home-blocks.js';
export type { FormSubmitEvent, WidgetForm } from './forms/types.js';
export { icons, widgetMark, wordmark } from './icons.js';
export { type RichOptions, renderMarkdown, renderRich } from './markdown.js';
export type { State, View } from './state.js';
export { matchPath, shouldShow } from './state.js';
export { Widget, type WidgetOptions } from './widget.js';

/** The `window.helpwell` shape, declared ambiently in `globals.d.ts`. */
export type HelpWellGlobal = HelpWellQueueApi;

let current: Widget | null = null;

/** Create and mount a widget. Calling it twice replaces the first. */
export async function init(options: WidgetOptions = {}): Promise<Widget> {
  current?.destroy();
  const widget = new Widget(options);
  current = widget;
  await widget.mount();
  return widget;
}

export function instance(): Widget | null {
  return current;
}

/**
 * Drain whatever the loader queued while this bundle was downloading, then
 * replace the queue-shim with a real dispatcher and tell the page.
 *
 * This is what lets a page call `helpwell('identify', token)` on line one and
 * have it work, without blocking rendering on a support widget. Nothing in
 * here may throw: the bundle runs on somebody else's page, and a support
 * widget that fails must fail silently. It resolves to null when it did.
 */
export async function boot(global: HelpWellGlobal | undefined): Promise<Widget | null> {
  try {
    const queued = global?.q ?? [];
    const initCall = queued.find(([method]) => method === 'init');
    const widget = await init((initCall?.[1] as WidgetOptions) ?? {});

    for (const [method, ...args] of queued) {
      if (method === 'init') continue;
      dispatch(widget, method, args);
    }

    const api = ((method: string, ...args: unknown[]) => {
      dispatch(widget, method, args);
    }) as unknown as HelpWellGlobal;
    api.widget = widget;
    api.q = [];
    // The method forms, same as the loader's shim: helpwell.engage.show(id).
    api.track = (name, props) => dispatch(widget, 'track', [name, props]);
    api.engage = {
      show: (id) => dispatch(widget, 'engage.show', [id]),
      hide: () => dispatch(widget, 'engage.hide', []),
    };
    api.forms = {
      show: (id) => dispatch(widget, 'forms.show', [id]),
      on: (event, listener) => dispatch(widget, 'forms.on', [event, listener]),
      off: (event, listener) => dispatch(widget, 'forms.off', [event, listener]),
    };
    window.helpwell = api;

    // Let the host app know it can start calling, without it having to poll.
    window.dispatchEvent(new CustomEvent('helpwell:ready', { detail: { widget } }));
    return widget;
  } catch (error) {
    console.warn('helpwell: the widget did not start.', error);
    return null;
  }
}

export function dispatch(widget: Widget, method: string, args: unknown[]): void {
  switch (method) {
    case 'open':
      widget.open();
      break;
    case 'close':
      widget.close();
      break;
    case 'toggle':
      widget.toggle();
      break;
    case 'identify':
      void widget.identify(String(args[0] ?? '')).catch(() => {
        // A rejected token leaves the visitor anonymous, which is fine.
      });
      break;
    case 'reset':
      void widget.reset().catch(() => {
        // The local state is cleared either way; the cookie goes next time.
      });
      break;
    case 'track':
      widget.track(String(args[0] ?? ''), args[1] as Record<string, unknown> | undefined);
      break;
    case 'engage.show':
      widget.engage.show(String(args[0] ?? ''));
      break;
    case 'engage.hide':
      widget.engage.hide();
      break;
    case 'forms.show':
      widget.forms.show(String(args[0] ?? ''));
      break;
    case 'forms.on':
      if (typeof args[1] === 'function') {
        widget.forms.on(String(args[0] ?? ''), args[1] as FormsListener);
      }
      break;
    case 'forms.off':
      if (typeof args[1] === 'function') {
        widget.forms.off(String(args[0] ?? ''), args[1] as FormsListener);
      }
      break;
    case 'destroy':
      widget.destroy();
      break;
    default:
      // Unknown calls are ignored rather than thrown: the page's own script
      // should not break because it is a version ahead of the widget.
      break;
  }
}
