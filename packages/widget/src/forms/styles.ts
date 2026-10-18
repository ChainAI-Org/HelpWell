/**
 * Styles for forms, wherever they are drawn: an embed on the page, a popup,
 * a slide-in, a bar, a welcome mat, or a block on the widget's Home tab.
 *
 * Each form sits in a shadow root of its own (on Home too, nested in the panel), so
 * none of this reaches the host page and none of the page's CSS reaches it.
 * Content blocks are engage's (`ENGAGE_CSS`), so a form's headline, image or
 * video looks the same as a modal's. A form's own colours, font, radius and
 * width arrive as custom properties on its root element, set from values the
 * widget has already checked (normalize.ts); nothing from settings is ever
 * written into this stylesheet.
 *
 * Phones get the form's mobile overrides through `data-m-*` attributes,
 * applied when the shadow root's host carries `data-hw-phone`: set from the
 * same breakpoint the widget's display rules use, and kept in step as the
 * window changes (trackDevice). An attribute rather than a media query, so
 * the dashboard's preview can draw a desktop page in a narrow frame. A form
 * squeezed into a narrow column on a desktop page stacks the same way as on
 * a phone, through a container query.
 */

import { duration, easing, scale, travel } from '@helpwell/tokens';
import { ENGAGE_CSS } from '../engage/styles.js';

const PHONE = '(max-width: 767px)';

export const FORM_CSS = `
.hwf {
  --hwf-pad: 24px;
  --hwf-gap: 14px;
  position: relative;
  width: 100%;
  max-width: var(--hwf-width, 480px);
  background: var(--hwf-bg, #fff);
  color: var(--hwf-text, #1B1530);
  border-radius: var(--hwf-radius, 14px);
  font-family: var(--hwf-font, inherit);
  text-align: start;
  overflow: hidden;
  container-type: inline-size;
}
.hwf[data-shadow] { box-shadow: 0 1px 2px rgba(23,20,37,.06), 0 12px 32px rgba(23,20,37,.12); }
.hwf[data-spacing="compact"] { --hwf-pad: 16px; --hwf-gap: 10px; }
.hwf[data-spacing="spacious"] { --hwf-pad: 32px; --hwf-gap: 18px; }
.hwf[data-align="center"] { text-align: center; margin-inline: auto; }
.hwf .eg-text, .hwf .eg-text h1, .hwf .eg-text h2, .hwf .eg-text h3, .hwf .eg-text h4 { color: inherit; }
.hwf .eg-text a { color: var(--hwf-accent); }
.hwf .eg-text p { opacity: .86; }
.hwf .eg-buttons { justify-content: flex-start; }
.hwf[data-align="center"] .eg-buttons { justify-content: center; }
.hwf .engage-primary { background: var(--hwf-accent); color: var(--hwf-btn-text, #fff); }

.hwf__inner { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%; }
.hwf__media { display: none; min-height: 140px; background: color-mix(in srgb, var(--hwf-text) 6%, transparent); }
.hwf__media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.hwf__body { position: relative; display: grid; gap: var(--hwf-gap); padding: var(--hwf-pad); align-content: center; min-width: 0; }
.hwf[data-closable] .hwf__body { padding-inline-end: calc(var(--hwf-pad) + 20px); }

.hwf[data-image="top"] .hwf__media,
.hwf[data-image="left"] .hwf__media,
.hwf[data-image="right"] .hwf__media,
.hwf[data-image="background"] .hwf__media { display: block; }
.hwf[data-image="top"] .hwf__media { max-height: 220px; }
.hwf[data-image="left"] .hwf__inner { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
.hwf[data-image="right"] .hwf__inner { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
.hwf[data-image="right"] .hwf__media { order: 2; }
.hwf[data-image="background"] .hwf__media { position: absolute; inset: 0; }
.hwf[data-image="background"] .hwf__media::after { content: ""; position: absolute; inset: 0; background: color-mix(in srgb, var(--hwf-bg) 72%, transparent); }
.hwf[data-image="background"] .hwf__body { z-index: 1; }

/* ----------------------------------------------------------------- fields */

.hwf__form { display: grid; gap: var(--hwf-gap); margin: 0; }
.hwf__fields { display: grid; gap: var(--hwf-gap); grid-template-columns: minmax(0, 1fr); }
.hwf[data-cols="2"] .hwf__fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.hwf[data-cols="2"] .hwf__field:not([data-width="half"]) { grid-column: 1 / -1; }
.hwf__field { display: grid; gap: 6px; min-width: 0; text-align: start; }
.hwf__field[hidden] { display: none; }
.hwf__label { font-size: 13px; font-weight: 600; }
.hwf__req { color: var(--hwf-accent); margin-inline-start: 2px; }
.hwf__input {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--hwf-field-border, #DAD6E5);
  border-radius: calc(var(--hwf-radius) * .6);
  background: var(--hwf-field-bg, #fff);
  color: var(--hwf-field-text, #1B1530);
  font: inherit;
  font-size: 15px;
}
textarea.hwf__input { min-height: 88px; resize: vertical; }
/* The chevron sits as far from the right edge as the text is from the left. */
select.hwf__input {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 36px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A85A0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 12px;
  cursor: pointer;
}
.hwf__input:focus { outline: 2px solid var(--hwf-accent); outline-offset: 1px; border-color: transparent; }
.hwf__input[aria-invalid="true"] { border-color: #D93D56; }
.hwf__choices { display: grid; gap: 6px; border: 0; margin: 0; padding: 0; min-width: 0; }
.hwf__choices legend { padding: 0; margin-bottom: 4px; }
.hwf__choice { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; cursor: pointer; text-align: start; }
.hwf__choice input { margin-top: 3px; accent-color: var(--hwf-accent); }
.hwf__consent { font-size: 13px; opacity: .9; }
.hwf__consent .eg-text p { margin: 0; opacity: 1; }
.hwf__help { font-size: 12.5px; opacity: .72; margin: 0; }
.hwf__error { font-size: 12.5px; color: #D93D56; margin: 0; }
.hwf__error:empty { display: none; }
.hwf__trap { position: absolute !important; left: -9999px !important; width: 1px; height: 1px; overflow: hidden; }
.hwf__challenge:empty { display: none; }

.hwf__submit {
  min-height: 44px;
  padding: 10px 18px;
  border-radius: calc(var(--hwf-radius) * .6);
  background: var(--hwf-accent);
  color: var(--hwf-btn-text, #fff);
  font-weight: 650;
  font-size: 15px;
  transition: filter ${duration.menuClose}ms ${easing.out}, transform ${duration.menuClose}ms ${easing.out};
}
.hwf__submit:hover { filter: brightness(1.06); }
.hwf__submit:active { transform: scale(${scale.pressed}); }
.hwf__submit[disabled] { opacity: .6; cursor: progress; }
.hwf[data-button-width="full"] .hwf__submit { width: 100%; }
.hwf[data-button="outline"] .hwf__submit { background: transparent; color: var(--hwf-accent); box-shadow: inset 0 0 0 2px var(--hwf-accent); }
.hwf[data-button="pill"] .hwf__submit { border-radius: 999px; }

.hwf[data-fields="inline"] .hwf__form { grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
.hwf[data-fields="inline"] .hwf__fields { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); grid-template-columns: none; }
.hwf[data-fields="inline"] .hwf__field:not(.hwf__field--box) .hwf__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.hwf[data-fields="inline"] .hwf__form > :not(.hwf__fields):not(.hwf__submit) { grid-column: 1 / -1; }
.hwf[data-fields="inline"] .hwf__submit { width: auto; }

.hwf__meta { font-size: 12.5px; opacity: .72; margin: 0; }
.hwf__meta a { color: inherit; }

.hwf__close {
  position: absolute;
  top: 10px;
  inset-inline-end: 10px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 30px; height: 30px;
  border-radius: 999px;
  color: inherit;
  background: color-mix(in srgb, var(--hwf-bg) 70%, transparent);
  opacity: .75;
}
.hwf__close:hover { opacity: 1; }
.hwf__close svg { width: 16px; height: 16px; }

/* -------------------------------------------------------------- after it */

.hwf__done { display: grid; gap: var(--hwf-gap); }
/* Focus moves here so a screen reader reads the thank-you; it is not a control, so no ring. */
.hwf__done:focus { outline: none; }
.hwf__code { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1.5px dashed var(--hwf-accent); border-radius: calc(var(--hwf-radius) * .6); }
.hwf[data-align="center"] .hwf__code { justify-content: center; }
.hwf__code code { font: 700 18px/1.2 ui-monospace, "SF Mono", Consolas, monospace; letter-spacing: .06em; overflow-wrap: anywhere; }
.hwf__copy, .hwf__ghost { padding: 7px 12px; border-radius: 10px; font-weight: 600; font-size: 13px; background: color-mix(in srgb, var(--hwf-accent) 12%, transparent); color: var(--hwf-accent); }
.hwf__download { display: inline-flex; justify-content: center; align-items: center; gap: 8px; min-height: 44px; padding: 10px 18px; border-radius: calc(var(--hwf-radius) * .6); background: var(--hwf-accent); color: var(--hwf-btn-text, #fff); font-weight: 650; text-decoration: none; }
.hwf__entries { display: flex; align-items: baseline; gap: 8px; margin: 0; }
.hwf[data-align="center"] .hwf__entries { justify-content: center; }
.hwf__entries strong { font-size: 28px; line-height: 1; }
.hwf__link { display: flex; gap: 6px; }
.hwf__link input { flex: 1; min-width: 0; }
.hwf__share { display: flex; flex-wrap: wrap; gap: 6px; }
.hwf[data-align="center"] .hwf__share { justify-content: center; }
.hwf__share a, .hwf__share button { padding: 6px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; text-decoration: none; color: inherit; background: color-mix(in srgb, var(--hwf-text) 7%, transparent); }
.hwf__actions { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.hwf__action { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--hwf-text) 5%, transparent); font-size: 13.5px; text-align: start; }
.hwf__action small { display: block; opacity: .7; font-size: 11.5px; }

/* ------------------------------------------------------------ placements */

.hwf-inline { display: block; }
.hwf-inline > .hwf { margin-inline: auto; }
.hwf-launch { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 18px; border-radius: 12px; background: var(--hwf-accent, #7A3BEB); color: var(--hwf-btn-text, #fff); font-weight: 650; font-size: 15px; }

.hwf-scrim {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(23, 20, 37, var(--hwf-overlay, .5));
  animation: hwf-fade ${duration.menuOpen}ms ${easing.out} both;
  pointer-events: auto;
}
.hwf-scrim > .hwf { max-height: calc(100vh - 40px); overflow-y: auto; animation: hwf-rise ${duration.menuOpen}ms ${easing.spring} both; }
.hwf-slidein {
  position: fixed;
  bottom: 20px;
  width: min(var(--hwf-width, 380px), 380px, calc(100vw - 32px));
  pointer-events: auto;
  animation: hwf-rise ${duration.menuOpen}ms ${easing.spring} both;
}
.hwf-slidein[data-side="bottom-right"] { right: 20px; }
.hwf-slidein[data-side="bottom-left"] { left: 20px; }
.hwf-slidein > .hwf { max-width: none; }
.hwf-bar { position: fixed; left: 0; right: 0; pointer-events: auto; animation: hwf-fade ${duration.menuOpen}ms ${easing.out} both; }
.hwf-bar[data-side="top"] { top: 0; }
.hwf-bar[data-side="bottom"] { bottom: 0; }
.hwf-bar > .hwf { max-width: none; border-radius: 0; }
.hwf-bar .hwf__inner { grid-template-columns: minmax(0, 1fr); }
.hwf-bar .hwf__media { display: none !important; }
.hwf-bar .hwf__body { grid-template-columns: minmax(0, 1fr) minmax(260px, 1.2fr); align-items: center; padding-block: 12px; }
.hwf-bar .hwf__done { grid-column: 1 / -1; }
.hwf-bar .eg-text h1, .hwf-bar .eg-text h2, .hwf-bar .eg-text h3 { font-size: 16px; margin: 0; }
.hwf-bar .eg-text p { margin: 0; }
.hwf-welcome { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: var(--hwf-bg, #fff); overflow-y: auto; pointer-events: auto; animation: hwf-fade ${duration.menuOpen}ms ${easing.out} both; }
.hwf-welcome > .hwf { max-width: min(var(--hwf-width, 640px), 100%); box-shadow: none; }
.hwf-welcome .eg-text h1, .hwf-welcome .eg-text h2 { font-size: clamp(24px, 4vw, 36px); }
.hwf-home > .hwf { max-width: none; box-shadow: none; border: 1px solid rgba(23, 20, 37, .08); }

@keyframes hwf-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes hwf-rise {
  from { opacity: 0; transform: translateY(${travel.page}px) scale(${scale.menuFrom}); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hwf-scrim, .hwf-scrim > .hwf, .hwf-slidein, .hwf-bar, .hwf-welcome { animation: none; }
}

/* A narrow column on a wide screen stacks the same way a phone does. */
@container (max-width: 460px) {
  .hwf[data-image="left"] .hwf__inner, .hwf[data-image="right"] .hwf__inner { grid-template-columns: minmax(0, 1fr); }
  .hwf[data-image="left"] .hwf__media, .hwf[data-image="right"] .hwf__media { order: 0; max-height: 180px; }
  .hwf[data-fields="inline"] .hwf__form { grid-template-columns: minmax(0, 1fr); }
  .hwf[data-fields="inline"] .hwf__fields { grid-auto-flow: row; }
  .hwf[data-fields="inline"] .hwf__submit { width: 100%; }
}

/* A phone: the host carries data-hw-phone (see trackDevice), so the dashboard's
   preview can draw either device whatever the width of its frame. */
:host([data-hw-phone]) .hwf[data-m-image="top"] .hwf__inner { grid-template-columns: minmax(0, 1fr); }
:host([data-hw-phone]) .hwf[data-m-image="top"] .hwf__media { display: block; position: relative; inset: auto; order: 0; max-height: 180px; }
:host([data-hw-phone]) .hwf[data-m-image="top"] .hwf__media::after { display: none; }
:host([data-hw-phone]) .hwf[data-m-image="none"] .hwf__inner { grid-template-columns: minmax(0, 1fr); }
:host([data-hw-phone]) .hwf[data-m-image="none"] .hwf__media { display: none; }
:host([data-hw-phone]) .hwf[data-m-fields="stacked"] .hwf__form { grid-template-columns: minmax(0, 1fr); }
:host([data-hw-phone]) .hwf[data-m-fields="stacked"] .hwf__fields { grid-auto-flow: row; grid-template-columns: minmax(0, 1fr); }
:host([data-hw-phone]) .hwf[data-m-fields="stacked"] .hwf__submit { width: 100%; }
:host([data-hw-phone]) .hwf[data-m-cols="one"] .hwf__fields { grid-template-columns: minmax(0, 1fr); }
:host([data-hw-phone]) .hwf[data-m-compact] { --hwf-pad: 18px; --hwf-gap: 10px; }
:host([data-hw-phone]) .hwf[data-m-compact] .eg-text h1, :host([data-hw-phone]) .hwf[data-m-compact] .eg-text h2 { font-size: 18px; }
:host([data-hw-phone]) .hwf-scrim[data-sheet] { place-items: end stretch; padding: 0; }
:host([data-hw-phone]) .hwf-scrim[data-sheet] > .hwf { max-width: none; border-radius: var(--hwf-radius) var(--hwf-radius) 0 0; max-height: 88vh; }
:host([data-hw-phone]) .hwf-slidein { left: 12px !important; right: 12px !important; bottom: 12px; width: auto; }
:host([data-hw-phone]) .hwf-bar .hwf__body { grid-template-columns: minmax(0, 1fr); }
`;

/** Everything a form's shadow root needs: engage's blocks, then the form's own. */
export const FORMS_ROOT_CSS = `${ENGAGE_CSS}\n${FORM_CSS}`;

let sheet: CSSStyleSheet | null | undefined;

/**
 * Put the styles in a shadow root. One shared stylesheet where the browser
 * can adopt it, so ten embeds on a page parse the CSS once; a `<style>`
 * element where it cannot.
 */
export function applyFormStyles(root: ShadowRoot): void {
  trackDevice(root.host);
  if (sheet === undefined) {
    try {
      const shared = new CSSStyleSheet();
      shared.replaceSync(FORMS_ROOT_CSS);
      sheet = shared;
    } catch {
      sheet = null;
    }
  }
  if (sheet && 'adoptedStyleSheets' in root) {
    try {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // Fall through to a style element.
    }
  }
  const style = document.createElement('style');
  style.textContent = FORMS_ROOT_CSS;
  root.prepend(style);
}

/* ------------------------------------------------------------------ device */

const hosts = new Set<Element>();
let forced: 'phone' | 'desktop' | null = null;
let listening = false;

function isPhone(): boolean {
  if (forced) return forced === 'phone';
  try {
    return typeof matchMedia === 'function' && matchMedia(PHONE).matches;
  } catch {
    return false;
  }
}

function markAll(): void {
  const phone = isPhone();
  for (const host of hosts) {
    if (host.isConnected) host.toggleAttribute('data-hw-phone', phone);
    else hosts.delete(host);
  }
}

/**
 * Mark a form's shadow host as on a phone or not, and keep it marked as the
 * window is resized or turned. Hosts that have left the page are forgotten.
 */
export function trackDevice(host: Element): void {
  hosts.add(host);
  host.toggleAttribute('data-hw-phone', isPhone());
  if (listening) return;
  listening = true;
  try {
    matchMedia(PHONE).addEventListener('change', markAll);
  } catch {
    // No matchMedia (a test DOM): the mark set now stands.
  }
}

/** The dashboard's preview says which device it draws for, whatever its frame's width. */
export function setFormsDevice(device: 'phone' | 'desktop' | null): void {
  forced = device;
  markAll();
}
