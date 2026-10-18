/** What every view is handed: the API, the store, and a way to navigate. */

import type { Api } from './api.js';
import type { State, Store, View } from './state.js';

export interface ViewContext {
  api: Api;
  store: Store;
  /**
   * The live state. A getter onto the store, never a snapshot, so a view that
   * reads it later (a click handler, a resolved fetch) sees what is true then.
   */
  readonly state: State;
  /**
   * Aborted when this render is replaced by another view. Pass it to requests
   * and use it to cancel timers, so a view that is gone stops doing work.
   */
  signal: AbortSignal;
  go(view: View): void;
  back(): void;
  close(): void;
  /** The page path the widget is currently on, for page-aware calls. */
  path(): string;
}
