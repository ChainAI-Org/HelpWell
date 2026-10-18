/**
 * Keyboard focus, for the panel and for the engage surfaces.
 *
 * A dialog that opens without taking focus leaves a keyboard user stranded
 * behind it, and one that closes without giving it back drops them at the top
 * of the page. These helpers are the whole of what both surfaces need.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Everything inside `container` a Tab press could land on, in order. */
export function focusables(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden]'),
  );
}

/**
 * Keep Tab inside `container` while focus is already in it: the last
 * focusable wraps to the first, and Shift+Tab from the first (or from the
 * container itself) wraps to the last. Focus that is elsewhere on the page is
 * left alone, so a panel that is open beside the page does not hijack it.
 */
export function trapTab(
  event: KeyboardEvent,
  container: HTMLElement,
  active: Element | null,
): void {
  if (event.key !== 'Tab' || !active || !container.contains(active)) return;
  const items = focusables(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey) {
    if (active === first || active === container) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Move focus to the first thing in a surface that can take it, else the surface. */
export function focusFirst(container: HTMLElement): void {
  const target = focusables(container)[0];
  if (target) target.focus();
  else focusSelf(container);
}

/** Focus a surface itself, which lets a screen reader announce its name. */
export function focusSelf(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus();
}
