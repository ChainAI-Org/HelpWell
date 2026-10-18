/**
 * Mounting a widget against the fake server, and reaching into its shadow
 * root, for the feature tests. One widget at a time, torn down by `unmount`.
 */

import { Widget, type WidgetOptions } from '../../src/widget.js';
import { createFakeServer, type FakeServer, type FakeServerOptions, flush } from './server.js';

export interface Mounted {
  widget: Widget;
  server: FakeServer;
  $<T extends HTMLElement = HTMLElement>(selector: string): T | null;
  $$<T extends HTMLElement = HTMLElement>(selector: string): T[];
  text(selector: string): string;
  click(selector: string): void;
  /** Type into the composer and press send. */
  send(message: string): Promise<void>;
}

let current: Widget | null = null;

export async function mountWidget(
  options: FakeServerOptions = {},
  widgetOptions: Omit<WidgetOptions, 'apiUrl' | 'fetch'> = {},
): Promise<Mounted> {
  current?.destroy();
  const server = createFakeServer(options);
  const widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch, ...widgetOptions });
  current = widget;
  await widget.mount();
  await flush();

  const root = () => {
    const shadow = widget.shadowRoot;
    if (!shadow) throw new Error('widget is not mounted');
    return shadow;
  };
  const $ = <T extends HTMLElement>(selector: string) => root().querySelector<T>(selector);
  const $$ = <T extends HTMLElement>(selector: string) => [...root().querySelectorAll<T>(selector)];
  const click = (selector: string) => {
    const el = $(selector);
    if (!el) throw new Error(`no element for ${selector}`);
    el.click();
  };

  return {
    widget,
    server,
    $,
    $$,
    text: (selector) => $(selector)?.textContent?.trim() ?? '',
    click,
    async send(message) {
      const input = $('.composer textarea') as HTMLTextAreaElement | null;
      if (!input) throw new Error('no composer');
      input.value = message;
      input.dispatchEvent(new Event('input'));
      click('.composer__send');
      await flush(20);
    },
  };
}

export function unmount(): void {
  current?.destroy();
  current = null;
  document.body.textContent = '';
  for (const script of document.head.querySelectorAll('script')) script.remove();
  history.replaceState({}, '', '/');
  try {
    localStorage.clear();
  } catch {
    // Not every environment has storage.
  }
}

/** The body of the calls made to one path, in order. */
export function bodies(server: FakeServer, path: string): unknown[] {
  return server.calls.filter((call) => call.path === path).map((call) => call.body);
}

export { flush };
