/**
 * Route changes in a single-page app.
 *
 * The display rules and the engagements are per page, but a single-page app
 * changes page without a reload. The browser announces `popstate` and
 * `hashchange` on its own; `pushState` and `replaceState` announce nothing, so
 * they are wrapped once per page to dispatch a `helpwell:navigate` event, which
 * any HelpWell code on the page (there may be a loader bundle and a library
 * build) listens to like the other two.
 */

const EVENT = 'helpwell:navigate';
const PATCHED = '__helpwellNavigate';

function patchHistory(): void {
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method] as History[typeof method] & { [PATCHED]?: true };
    if (original[PATCHED]) continue;
    const wrapped = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(EVENT));
      return result;
    } as History[typeof method] & { [PATCHED]?: true };
    wrapped[PATCHED] = true;
    history[method] = wrapped;
  }
}

function where(): string {
  return location.pathname + location.search + location.hash;
}

/**
 * Call `onChange` once the URL has settled on a new value. Debounced, because
 * a router may replace the URL several times while it renders a page.
 */
export function watchNavigation(onChange: () => void, debounceMs = 150): () => void {
  patchHistory();

  let last = where();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = where();
      if (now === last) return;
      last = now;
      onChange();
    }, debounceMs);
  };

  window.addEventListener('popstate', settle);
  window.addEventListener('hashchange', settle);
  window.addEventListener(EVENT, settle);

  return () => {
    clearTimeout(timer);
    window.removeEventListener('popstate', settle);
    window.removeEventListener('hashchange', settle);
    window.removeEventListener(EVENT, settle);
  };
}
