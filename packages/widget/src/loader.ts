/**
 * The loader: the only HelpWell code a customer's page parses up front.
 *
 * It does three things and nothing else — creates the global queue so calls
 * made before the widget arrives are not lost, waits until the page has
 * actually loaded, and then fetches the real bundle. Support must never be on
 * the critical path of somebody else's product.
 *
 * <script src="/api/helpwell/assets/loader.js" defer></script>
 *
 * `data-api` overrides where the API is; `data-src` overrides where the bundle
 * is. Neither is needed when the API serves the loader itself, on this site or
 * any other: the loader finds the API from its own address, host included.
 * `data-mode="forms"` is for a site that wants HelpWell's forms and no chat:
 * no launcher, no panel.
 */

type Queue = [string, ...unknown[]][];

(function loader(): void {
  const w = window;
  if (w.helpwell?.widget) return;

  const script = document.currentScript as HTMLScriptElement | null;
  const data = script?.dataset ?? {};

  // Queue-shim: `helpwell('identify', token)` works before the bundle lands.
  if (!w.helpwell) {
    const queue: Queue = [];
    const shim = (method: string, ...args: unknown[]) => {
      queue.push([method, ...args]);
    };
    shim.q = queue;
    // The method forms queue too: `helpwell.engage.show(id)` on line one works.
    shim.track = (name: string, props?: Record<string, unknown>) => shim('track', name, props);
    shim.engage = {
      show: (id: string) => shim('engage.show', id),
      hide: () => shim('engage.hide'),
    };
    shim.forms = {
      show: (id: string) => shim('forms.show', id),
      on: (event: string, listener: (event: unknown) => void) => shim('forms.on', event, listener),
      off: (event: string, listener: (event: unknown) => void) =>
        shim('forms.off', event, listener),
    };
    w.helpwell = shim as unknown as typeof w.helpwell;
  }

  // When the API handler serves this file, it sits at <api>/assets/loader.js,
  // so the API is one directory up, on the host that served it. Keeping the
  // host is what lets the same tag work on a customer's own domain: a path
  // alone would send every call to the page's site instead. `data-api` is
  // only for an API somewhere else; a relative one resolves against the page.
  const own = script?.src ? new URL(script.src, location.href) : null;
  const served = own && /^(.*)\/assets\/loader(\.min)?\.js$/.exec(own.pathname);
  const apiUrl = data.api || (own && served ? own.origin + served[1] : '/api/helpwell');

  const options = {
    apiUrl,
    token: data.token || undefined,
    open: data.open === 'true',
    theme: (data.theme as 'light' | 'dark' | 'system' | undefined) || undefined,
    mode: data.mode === 'forms' || data.launcher === 'false' ? 'forms' : undefined,
  };
  w.helpwell?.('init', options);

  // The bundle is this file's sibling, `widget.js`. That only follows when
  // this file is actually called loader.js; served under any other name the
  // bundle is looked for under the API instead, because the alternative was
  // a loader that fetched itself again, forever.
  const sibling =
    own && /\/loader(\.min)?\.js$/.test(own.pathname)
      ? own.href.replace(/loader(\.min)?\.js(?=[?#]|$)/, 'widget.js')
      : null;
  const src = data.src || sibling || `${apiUrl.replace(/\/+$/, '')}/assets/widget.js`;

  const start = () => {
    // requestIdleCallback where it exists: the widget can wait for a gap.
    const go = () => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onerror = () => {
        console.warn(`helpwell: could not load the widget from ${src}`);
      };
      document.head.appendChild(tag);
    };
    if ('requestIdleCallback' in window) {
      (
        window as unknown as { requestIdleCallback: (cb: () => void, o?: object) => void }
      ).requestIdleCallback(go, { timeout: 2500 });
    } else {
      setTimeout(go, 1);
    }
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();

// The loader is a script, not a module, but the test imports it as one.
export {};
