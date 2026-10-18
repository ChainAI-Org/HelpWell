/**
 * Where a drawn form sits: in an embed, or over the page as a popup, a
 * slide-in, a bar or a welcome mat.
 *
 * An embed gets a shadow root on the page's own element, so a React or Vue
 * app that owns that element never sees (or fights over) what is inside it,
 * and any fallback content the page put there shows until the form arrives.
 * The four that sit over the page share one fixed layer of their own. The
 * popup and the welcome mat are modal: they take focus, keep Tab inside,
 * close on Escape, and hand focus back when they go.
 */

import { focusFirst, trapTab } from '../focus.js';
import { applyFormStyles } from './styles.js';
import type { FormPlacement, TriggeredPlacement, WidgetForm } from './types.js';

export interface Mounted {
  /** Where the form element goes. */
  slot: HTMLElement;
  /** Take it off the screen, from code. */
  close(): void;
  /** The visitor closed it: off the screen, and remembered as dismissed. */
  dismiss(): void;
  /** The surface's own element, for tests and focus. */
  el: HTMLElement;
}

/** A shadow root on an embed element, made once and reused. */
export function embedRoot(target: HTMLElement): ShadowRoot | null {
  if (target.shadowRoot) return target.shadowRoot;
  try {
    const root = target.attachShadow({ mode: 'open' });
    applyFormStyles(root);
    return root;
  } catch {
    // An element that cannot take a shadow root (a <p>, or one that has one
    // already): a child that can.
    const child = document.createElement('helpwell-form');
    target.appendChild(child);
    const root = child.attachShadow({ mode: 'open' });
    applyFormStyles(root);
    return root;
  }
}

/** Put an embed's content in place, replacing whatever it held. */
export function mountInline(root: ShadowRoot, placement: 'inline' | 'home'): Mounted {
  for (const node of [...root.childNodes]) {
    if (!(node instanceof HTMLStyleElement)) node.remove();
  }
  const el = document.createElement('div');
  el.className = placement === 'home' ? 'hwf-inline hwf-home' : 'hwf-inline';
  root.appendChild(el);
  return { slot: el, el, close: () => el.replaceChildren(), dismiss: () => el.replaceChildren() };
}

/** The fixed layer popups, slide-ins, bars and welcome mats are drawn in. */
export function overlayLayer(): { root: ShadowRoot; host: HTMLElement } {
  const host = document.createElement('helpwell-forms');
  // Above the page, and alongside the engage layer rather than under it.
  Object.assign(host.style, { position: 'relative', zIndex: '2147482500' });
  const root = host.attachShadow({ mode: 'open' });
  applyFormStyles(root);
  document.body.appendChild(host);
  return { root, host };
}

/**
 * A form over the page. `onDismiss` runs when the visitor closes it
 * (Escape, the backdrop, the close button), not when code does.
 */
export function mountOverlay(
  root: ShadowRoot,
  form: WidgetForm,
  placement: TriggeredPlacement | 'button',
  onDismiss: () => void,
): Mounted {
  const kind: FormPlacement = placement === 'button' ? 'popup' : placement;
  const before = document.activeElement as HTMLElement | null;
  const modal = kind === 'popup' || kind === 'welcome';
  const el = document.createElement('div');
  el.className =
    kind === 'popup'
      ? 'hwf-scrim'
      : kind === 'slidein'
        ? 'hwf-slidein'
        : kind === 'bar'
          ? 'hwf-bar'
          : 'hwf-welcome';
  if (kind === 'slidein') el.dataset.side = form.placements.slidein.position;
  if (kind === 'bar') el.dataset.side = form.placements.bar.position;
  if (kind === 'popup' && form.mobile.popupAsSheet) el.dataset.sheet = '';
  if (kind === 'popup') el.style.setProperty('--hwf-overlay', String(form.style.overlay / 100));
  if (kind === 'welcome') el.style.setProperty('--hwf-bg', form.style.background);
  if (modal) {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Sign up');
  } else {
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Sign up');
  }

  let closed = false;
  const onKey = (event: KeyboardEvent) => {
    if (closed) return;
    if (event.key === 'Escape') dismiss();
    else if (modal && event.key === 'Tab') trapTab(event, el, root.activeElement);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    el.remove();
    if (modal && before?.isConnected) before.focus();
  };
  const dismiss = () => {
    if (closed) return;
    close();
    onDismiss();
  };
  if (kind === 'popup') {
    el.addEventListener('click', (event) => {
      if (event.target === el) dismiss();
    });
  }
  document.addEventListener('keydown', onKey);
  root.appendChild(el);
  if (modal) queueMicrotask(() => focusFirst(el));
  return { slot: el, el, close: () => close(), dismiss };
}

/** Whether a triggered placement takes over the page (one at a time) or sits beside it. */
export function isModal(placement: FormPlacement): boolean {
  return placement === 'popup' || placement === 'welcome' || placement === 'button';
}
