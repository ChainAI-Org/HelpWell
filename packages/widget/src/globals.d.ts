/**
 * The `window.helpwell` global.
 *
 * Declared in an ambient file with no imports so it is in scope for every
 * entry point, including the loader — which must stay standalone and must not
 * pull the widget's types (or its code) in behind it.
 */

interface HelpWellQueueApi {
  (method: string, ...args: unknown[]): void;
  /** Calls made before the widget bundle arrived. */
  q?: [string, ...unknown[]][];
  /** Set once the widget has mounted. */
  widget?: unknown;
  /** `helpwell.track(name, props)`: the same as `helpwell('track', name, props)`. */
  track?: (name: string, props?: Record<string, unknown>) => void;
  /** Engagements on demand: `helpwell.engage.show(id)`, `helpwell.engage.hide()`. */
  engage?: { show(id: string): void; hide(): void };
  /**
   * Forms on demand: `helpwell.forms.show(id)` opens one as a popup, and
   * `helpwell.forms.on('submit', cb)` hears about every submission.
   */
  forms?: {
    show(id: string): void;
    on(event: string, listener: (event: never) => void): void;
    off(event: string, listener: (event: never) => void): void;
  };
}

interface Window {
  helpwell?: HelpWellQueueApi;
}
