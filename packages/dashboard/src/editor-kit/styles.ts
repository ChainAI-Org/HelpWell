/**
 * The editor kit's stylesheet: the design canvas's message-editor boards
 * (canvas/build/engage_shell.py and common.py), as classes.
 *
 * Sizes, radii and weights are the canvas's own. Colours are the dashboard's
 * tokens wherever the canvas uses one of them, and `--ek-*` variables for the
 * few lavender greys it adds (field edges, segmented tracks, sketch grounds),
 * each with a dark value, so dark mode needs nothing per component.
 *
 * An editor page opts into the kit's page shell by rendering `editorShell`:
 * its root carries `.ek-editor`, and the rules keyed on `:has(.ek-editor)`
 * narrow the dashboard's rail to the canvas's 64px icon rail and turn the
 * header into the canvas's white top bar, for that page only.
 */

import { type RawHtml, raw } from '@helpwell/ui';

/** The HelpWell mark, for the icon rail's head. Violet bubble, white inner square, violet eyes. */
const MARK = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 152 152'><g transform='translate(24 11)'><path d='M 28 0 H 76 C 94 0 104 11 104 29 V 75 C 104 94 93 104 76 104 H 29 L 7 128 Q 0 135 0 125 V 29 C 0 11 10 0 28 0 Z' fill='%237A3BEB'/><path d='M 39 26 H 65 Q 78 26 78 39 V 65 Q 78 78 65 78 H 39 Q 26 78 26 65 V 39 Q 26 26 39 26 Z' fill='%23FFFFFF'/><path d='M 0 18 C 3 7 11 0 24 0 C 37 0 45 7 48 18 Z' fill='%237A3BEB' transform='translate(31.36 49) scale(.36)'/><path d='M 0 18 C 3 7 11 0 24 0 C 37 0 45 7 48 18 Z' fill='%237A3BEB' transform='translate(55.36 49) scale(.36)'/></g></svg>`;

const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A85A0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

const LIGHT = `
  --ek-edge: #E4E0EE;
  --ek-on-accent: #FFFFFF;
  --ek-track: #F1EFF7;
  --ek-raised: #FFFFFF;
  --ek-on: #FBF9FF;
  --ek-ring: rgba(122, 59, 235, .12);
  --ek-faint: #A9A3BD;
  --ek-grip: #C9C4D6;
  --ek-dot: #F0EEF6;
  --ek-switch: #DCD8E8;
  --ek-soft: #FBFAFE;
  --ek-sketch: #F3F1F9;
  --ek-sketch-ink: #DCD8E8;
  --ek-sketch-card: #FFFFFF;
  --ek-sketch-media: #C9B6F6;
  --ek-icon: #6F6A85;
  --ek-bar: #EEEAF8;
  --ek-shadow: 0 1px 2px rgba(23, 20, 37, .03);
  --ek-pop-shadow: 0 28px 64px -18px rgba(23, 20, 37, .34), 0 0 0 1px rgba(23, 20, 37, .05);`;

const DARK = `
  --ek-edge: #2E2E35;
  --ek-on-accent: #0E0E10;
  --ek-track: #1F1F23;
  --ek-raised: #2A2A30;
  --ek-on: #1D1A28;
  --ek-ring: rgba(155, 123, 255, .22);
  --ek-faint: #62626C;
  --ek-grip: #4A4A52;
  --ek-dot: #26262B;
  --ek-switch: #3A3A42;
  --ek-soft: #18181B;
  --ek-sketch: #1F1F23;
  --ek-sketch-ink: #3A3A42;
  --ek-sketch-card: #2A2A30;
  --ek-sketch-media: #5B4A8F;
  --ek-icon: #9A9AA5;
  --ek-bar: #26262B;
  --ek-shadow: none;
  --ek-pop-shadow: 0 28px 64px -18px rgba(0, 0, 0, .7), 0 0 0 1px rgba(255, 255, 255, .06);`;

export function editorKitStyles(): RawHtml {
  return raw(`<style>
:root {${LIGHT}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-hw-theme='light']) {${DARK}
  }
}
:root[data-hw-theme='dark'] {${DARK}
}

/* ------------------------------------------------------------ page shell */

.db-page:has(> .ek-editor) { padding: 0; }
html:has(body.db-embedded .ek-editor) { scrollbar-width: none; }
body.db-embedded .db-main:has(.ek-editor) { padding: 0; }
/* The name keeps at least 360px: when the buttons do not fit beside it they
   go on a line of their own, and wrap there however many a page has. */
.db-top:has(.ek-topbar) { min-height: 64px; padding: 12px 20px; gap: 10px 12px; flex-wrap: wrap; background: var(--hw-surface); }
.db-top:has(.ek-topbar) > div:first-child { flex: 1 1 360px; min-width: 0; }
.db-top:has(.ek-topbar) .db-top__actions { gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
/* On a phone the buttons always go under the name, the crumbs give way to
   the name, and a header popover spans the bar. */
@media (max-width: 640px) {
  .db-top:has(.ek-topbar) { padding: 10px 16px 12px; }
  .db-top:has(.ek-topbar) > div:first-child { flex: 1 1 100%; }
  .db-top:has(.ek-topbar) .db-top__actions { flex: 1 1 100%; flex-wrap: wrap; justify-content: flex-end; margin-inline-start: 0; }
  .db-top:has(.ek-topbar) .ek-topbar { flex-wrap: wrap; row-gap: 4px; }
  .db-top:has(.ek-topbar) .ek-crumb > :not(.ek-crumb__title) { display: none; }
  .db-top:has(.ek-topbar) .ek-crumb { flex: 1 1 0; }
  .db-top:has(.ek-topbar) .ek-note { flex: 1 1 100%; padding-left: 44px; }
  .db-top:has(.ek-topbar) .ek-pop { position: static; }
  .db-top:has(.ek-topbar) .ek-pop__panel { left: 16px; right: 16px; min-width: 0; max-width: none; }
}
@media (min-width: 861px) {
  .db-shell:has(.ek-editor) { grid-template-columns: 64px minmax(0, 1fr); }
  .db-shell:has(.ek-editor) .db-rail { padding: 16px 0; align-items: center; gap: 8px; overflow: visible; z-index: 4; }
  .db-shell:has(.ek-editor) .db-lockup { width: 36px; height: 36px; padding: 0; margin: 0 0 4px; background: url("data:image/svg+xml,${MARK.replace(/"/g, "'")}") center / 36px no-repeat; }
  .db-shell:has(.ek-editor) .db-lockup svg { display: none; }
  .db-shell:has(.ek-editor) .db-navgroup { height: 6px; padding: 0; font-size: 0; overflow: hidden; }
  .db-shell:has(.ek-editor) .db-nav { position: relative; width: 40px; height: 40px; padding: 0; justify-content: center; border-radius: 12px; color: var(--hw-muted); }
  .db-shell:has(.ek-editor) .db-nav svg { width: 18px; height: 18px; }
  .db-shell:has(.ek-editor) .db-nav[aria-current='page'] { background: var(--hw-accent); color: var(--ek-on-accent); }
  .db-shell:has(.ek-editor) .db-nav__label {
    position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%);
    padding: 6px 10px; border-radius: 8px; background: #171425; color: #FFFFFF;
    font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none;
    opacity: 0; transition: opacity .12s ease-out; z-index: 10;
  }
  .db-shell:has(.ek-editor) .db-nav:is(:hover, :focus-visible) .db-nav__label { opacity: 1; }
  .db-shell:has(.ek-editor) .db-nav__count {
    position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; margin: 0;
    display: grid; place-items: center; border: 2px solid var(--hw-surface); background: var(--hw-accent); color: var(--ek-on-accent); font-size: 10px;
  }
}

.ek-editor { container: ek-editor / inline-size; }
.ek-layout { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
.ek-work { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 16px; align-items: start; min-width: 0; }
.ek-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ek-foot { margin: 0; padding: 2px 2px 8px; font-size: 11.5px; line-height: 1.45; color: var(--hw-muted); }
.ek-foot code { font-size: 11px; }
@container ek-editor (min-width: 900px) {
  .ek-work { grid-template-columns: minmax(0, 1fr) 340px; }
}
@container ek-editor (min-width: 900px) and (max-width: 1239.98px) {
  .ek-layout { grid-template-columns: minmax(0, 1fr) 372px; }
  .ek-layout > .ek-work { grid-column: 1 / -1; }
}
@container ek-editor (min-width: 1240px) {
  .ek-layout { grid-template-columns: minmax(0, 1fr) 440px; }
  .ek-preview { position: sticky; top: 64px; height: calc(100vh - 64px); overflow-y: auto; border-left: 1px solid var(--hw-hairline); }
}

/* the top bar */
.ek-topbar { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ek-back { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 999px; color: var(--hw-muted); flex: none; }
.ek-back:hover { background: var(--hw-control); color: var(--hw-ink); }
.ek-crumb { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--hw-muted); white-space: nowrap; }
.ek-crumb a { color: inherit; }
.ek-crumb a:hover { color: var(--hw-ink); }
.ek-crumb .ek-icon { flex: none; }
.db-top .ek-crumb__title, .ek-crumb__title { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0; line-height: 1.4; color: var(--hw-ink); overflow: hidden; text-overflow: ellipsis; }
.ek-state { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; flex: none; }
.ek-state::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.ek-state--good { background: var(--hw-good-bg); color: var(--hw-good); }
.ek-state--info { background: var(--hw-info-bg); color: var(--hw-info); }
.ek-state--neutral { background: var(--hw-neutral-bg); color: var(--hw-neutral); }
.ek-state--warn { background: var(--hw-warn-bg); color: var(--hw-warn); }
.ek-note { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--hw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ek-note::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: #22B573; flex: none; }
.ek-note[data-tone='warn']::before { background: #E0A526; }
.ek-note[data-tone='bad']::before { background: var(--hw-bad); }

/* buttons */
.ek-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 10px; border: 1px solid transparent; font: inherit; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; text-decoration: none; transition: background .14s ease-out, border-color .14s ease-out; }
.ek-btn--primary { background: var(--hw-accent); color: var(--ek-on-accent); box-shadow: 0 6px 16px -6px rgba(122, 59, 235, .6); }
.ek-btn--primary:hover { background: var(--hw-accent-hover); color: var(--ek-on-accent); }
.ek-btn--secondary { background: var(--hw-surface); color: var(--hw-ink); border-color: var(--hw-hairline); box-shadow: 0 1px 2px rgba(23, 20, 37, .05); }
.ek-btn--secondary:hover { background: var(--hw-control); }
.ek-btn .ek-icon { flex: none; }
.ek-mini { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--hw-hairline); background: var(--hw-surface); font: inherit; font-size: 11.5px; font-weight: 600; color: var(--hw-ink2); cursor: pointer; white-space: nowrap; text-decoration: none; list-style: none; }
.ek-mini::-webkit-details-marker { display: none; }
.ek-mini:hover { background: var(--hw-control); color: var(--hw-ink); }
.ek-mini .ek-icon { color: var(--hw-muted); flex: none; }
.ek-mini--accent, .ek-mini--accent .ek-icon { color: var(--hw-accent-hover); }
.ek-mini--danger, .ek-mini--danger .ek-icon { color: var(--hw-bad); }
.ek-mini--bare { border-color: transparent; background: none; padding: 0 6px; }
.ek-mini--bare:hover { background: var(--hw-control); }
.ek-okdot { width: 6px; height: 6px; border-radius: 999px; background: #22B573; display: none; }
[data-ek-set='true'] > .ek-okdot, .ek-okdot[data-on='true'] { display: inline-block; }
.ek-addlink { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0; border: 0; background: none; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--hw-accent-hover); cursor: pointer; }
.ek-addlink:hover { text-decoration: underline; }

/* ---------------------------------------------------------------- pieces */

.ek-icon { display: block; flex: none; }
.ek-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ek-tone--lavender { background: var(--hw-accent-soft); color: var(--hw-accent-hover); }
.ek-tone--peach { background: var(--hw-under-peach); color: var(--hw-under-peach-ink); }
.ek-tone--butter { background: var(--hw-under-butter); color: var(--hw-under-butter-ink); }
.ek-tone--mint { background: var(--hw-under-mint); color: var(--hw-under-mint-ink); }
.ek-tone--blue { background: var(--hw-info-bg); color: var(--hw-info); }
.ek-glyph { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; flex: none; }

/* type tiles */
.ek-types { display: grid; grid-template-columns: repeat(var(--ek-count, 5), minmax(0, 1fr)); gap: 8px; }
.ek-type { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; height: 58px; min-width: 0; border: 1px solid var(--hw-hairline); border-radius: 13px; background: var(--hw-surface); font-size: 12px; font-weight: 600; color: var(--hw-ink2); white-space: nowrap; text-decoration: none; }
.ek-type .ek-glyph { width: 24px; height: 24px; border-radius: 7px; }
a.ek-type:hover { border-color: var(--hw-accent-line); color: var(--hw-ink); }
.ek-type[aria-current='true'] { border-color: var(--hw-accent); background: var(--ek-on); box-shadow: 0 0 0 3px var(--ek-ring); color: var(--hw-ink); }
.ek-type[aria-disabled='true'] { cursor: default; }
@media (max-width: 520px) { .ek-types { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

/* cards */
.ek-card { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 13px 14px; border: 1px solid var(--hw-hairline); border-radius: 16px; background: var(--hw-surface); box-shadow: var(--ek-shadow); scroll-margin-top: 80px; }
.ek-card--open { border-color: var(--hw-accent-line); box-shadow: 0 0 0 3px rgba(122, 59, 235, .08); }
.ek-card__head { display: flex; align-items: center; gap: 10px; min-height: 26px; min-width: 0; }
.ek-card__title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0; line-height: 1.3; color: var(--hw-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ek-card__meta { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--hw-muted); white-space: nowrap; }
.ek-card__meta form { margin: 0; }
.ek-sep { border: 0; border-top: 1px solid var(--ek-track); margin: 0; }

/* fields */
.ek-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
.ek-field__head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.ek-field__label { font-size: 12px; font-weight: 600; color: var(--hw-ink2); }
.ek-field__aside { margin-left: auto; font-size: 11.5px; color: var(--hw-muted); text-align: right; display: flex; align-items: center; gap: 2px; }
.ek-field__hint { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--hw-muted); }
.ek-field__error { margin: 0; font-size: 12px; font-weight: 600; color: var(--hw-bad); animation: db-fielderror 180ms ease-out both; }
.ek-field--inline { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; }
.ek-field--inline > .ek-field__hint, .ek-field--inline > .ek-field__error { flex-basis: 100%; }
.ek-field[data-invalid='true'] .ek-input, .ek-field[data-invalid='true'] .ek-seg { border-color: var(--hw-bad); box-shadow: 0 0 0 1px var(--hw-bad); }
.ek-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px 12px; align-items: start; }
.ek-inline { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.ek-inline > .ek-grow { flex: 1; min-width: 140px; }

.ek-input { display: block; width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--ek-edge); border-radius: 10px; background: var(--hw-surface); font: inherit; font-size: 13px; color: var(--hw-ink); outline: none; transition: border-color .14s ease-out, box-shadow .14s ease-out; }
.ek-input::placeholder { color: var(--ek-faint); }
.ek-input:focus { border-color: var(--hw-accent); box-shadow: 0 0 0 3px var(--ek-ring); }
textarea.ek-input { height: auto; min-height: 36px; padding: 8px 11px; line-height: 1.5; resize: vertical; }
select.ek-input { appearance: none; -webkit-appearance: none; padding-right: 32px; background: var(--hw-surface) ${CHEVRON} right 11px center / 12px no-repeat; cursor: pointer; }
.ek-input--mono { font-family: var(--hw-font-mono); font-size: 12px; }
.ek-input--num { width: 84px; }
.ek-affix { position: relative; display: flex; align-items: center; min-width: 0; }
.ek-affix > .ek-icon:first-child { position: absolute; left: 11px; color: var(--hw-muted); pointer-events: none; }
.ek-affix > .ek-icon:first-child ~ .ek-input { padding-left: 32px; }
.ek-affix__end { position: absolute; right: 8px; display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--hw-muted); }
.ek-affix:has(.ek-affix__end) .ek-input { padding-right: 96px; }

/* segmented */
.ek-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--ek-track); max-width: 100%; min-width: 0; border: 0; }
.ek-seg--full { display: flex; }
.ek-seg--full > .ek-seg__opt { flex: 1; }
.ek-seg__opt { position: relative; display: inline-flex; min-width: 0; }
.ek-seg__opt input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.ek-seg__label, .ek-seg > button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: 100%; padding: 5px 10px; border: 0; border-radius: 999px; background: none; font: inherit; font-size: 12px; font-weight: 500; color: var(--hw-ink2); white-space: nowrap; cursor: pointer; }
.ek-seg--md .ek-seg__label, .ek-seg--md > button { padding: 6px 14px; font-size: 13px; }
.ek-seg__opt input:checked + .ek-seg__label, .ek-seg > button[aria-pressed='true'] { background: var(--ek-raised); box-shadow: 0 2px 6px rgba(23, 20, 37, .10); font-weight: 600; color: var(--hw-ink); }
.ek-seg__opt input:focus-visible + .ek-seg__label, .ek-seg > button:focus-visible { outline: 2px solid var(--hw-accent); outline-offset: 1px; }
.ek-seg__opt input:disabled + .ek-seg__label { opacity: .5; cursor: not-allowed; }

/* tiles with sketches */
.ek-tiles { display: grid; grid-template-columns: repeat(var(--ek-cols, 3), minmax(0, 1fr)); gap: 8px; }
.ek-tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; padding: 8px; border: 1px solid var(--hw-hairline); border-radius: 12px; background: var(--hw-surface); font-size: 11.5px; font-weight: 600; color: var(--hw-ink2); white-space: nowrap; cursor: pointer; transition: border-color .14s ease-out; }
.ek-tile:hover { border-color: var(--hw-accent-line); }
.ek-tile input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.ek-tile:has(input:checked) { border-color: var(--hw-accent); background: var(--ek-on); box-shadow: 0 0 0 3px var(--ek-ring); color: var(--hw-ink); }
.ek-tile:has(input:focus-visible) { outline: 2px solid var(--hw-accent); outline-offset: 2px; }
.ek-tile__label { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
@media (max-width: 560px) { .ek-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* sketches: the small drawings inside tiles */
.ek-sketch { position: relative; display: block; width: 100%; height: 40px; border-radius: 7px; background: var(--ek-sketch); overflow: hidden; }
.ek-sketch--tall { height: 56px; border-radius: 8px; }
.ek-sketch i, .ek-sketch b, .ek-sketch s, .ek-sketch u { position: absolute; display: block; text-decoration: none; }
.ek-sk-card { background: var(--ek-sketch-card); border-radius: 3px; box-shadow: 0 1px 3px rgba(23, 20, 37, .12); }
.ek-sk-line { height: 3px; border-radius: 2px; background: var(--ek-sketch-ink); }
.ek-sk-ink { background: var(--hw-ink); border-radius: 2px; }
.ek-sk-media { background: var(--ek-sketch-media); border-radius: 2px; }
.ek-sk-accent { background: var(--hw-accent); border-radius: 2px; }

/* switches */
.ek-toggles { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; }
.ek-toggle { position: relative; display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; color: var(--hw-ink); cursor: pointer; }
.ek-toggle input[type='checkbox'] { appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 34px; height: 20px; margin: 0; border-radius: 999px; background: var(--ek-switch); cursor: pointer; transition: background .16s ease-out; }
.ek-toggle input[type='checkbox']::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #FFFFFF; box-shadow: 0 1px 2px rgba(23, 20, 37, .2); transition: transform .2s cubic-bezier(.34, 1.45, .64, 1); }
.ek-toggle input[type='checkbox']:checked { background: var(--hw-accent); }
.ek-toggle input[type='checkbox']:checked::after { transform: translateX(14px); }
.ek-toggle input[type='checkbox']:focus-visible { outline: 2px solid var(--hw-accent); outline-offset: 2px; }
.ek-toggle__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.ek-toggle__hint { font-size: 11px; color: var(--hw-muted); }
.ek-toggle[data-invalid='true'] .ek-toggle__label { color: var(--hw-bad); }
.ek-toggle--end { width: 100%; }
.ek-toggle--end input[type='checkbox'] { order: 2; margin-left: auto; }

/* a setting as a row: icon, words, control */
.ek-rows { display: flex; flex-direction: column; gap: 4px; }
.ek-row { display: flex; align-items: center; gap: 10px; min-height: 34px; min-width: 0; }
.ek-row__icon { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--hw-control); color: var(--ek-icon); flex: none; }
.ek-row__text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ek-row__title { font-size: 12.5px; font-weight: 500; line-height: 1.3; color: var(--hw-ink); }
.ek-row__sub { display: flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1.3; color: var(--hw-muted); }
.ek-row__sub a { color: var(--hw-accent-hover); font-weight: 600; }
.ek-row__control { display: flex; align-items: center; gap: 6px; flex: none; max-width: 60%; }
.ek-row__control .ek-input { height: 30px; font-size: 12.5px; }

/* pills: a condition drawn as words */
.ek-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.ek-filter__word { width: 36px; font-size: 12px; color: var(--hw-muted); flex: none; }
.ek-pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--ek-edge); border-radius: 9px; background: var(--hw-surface); font: inherit; font-size: 12.5px; color: var(--hw-ink); white-space: nowrap; min-width: 0; max-width: 100%; }
.ek-pill .ek-icon { color: var(--hw-muted); }
select.ek-pill { appearance: none; -webkit-appearance: none; padding-right: 29px; background: var(--hw-surface) ${CHEVRON} right 10px center / 11px no-repeat; cursor: pointer; }
input.ek-pill { outline: none; }
.ek-pill:focus { border-color: var(--hw-accent); box-shadow: 0 0 0 3px var(--ek-ring); outline: none; }
.ek-pill--op { background-color: var(--hw-inner); color: var(--hw-ink2); }
.ek-pill--val { font-weight: 600; }
.ek-pill--mono { font-family: var(--hw-font-mono); font-size: 11.5px; }
.ek-pill--num { width: 50px; padding: 0 6px 0 10px; }
.ek-pill--grow { flex: 1; min-width: 90px; }

/* chips */
.ek-chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 7px; border-radius: 7px; background: var(--hw-control); font-size: 11px; font-weight: 600; color: var(--hw-ink2); white-space: nowrap; flex: none; }
.ek-chip .ek-icon { color: var(--hw-muted); }
.ek-chip--mono { height: 24px; padding: 0 8px; border: 1px solid var(--hw-hairline); font-family: var(--hw-font-mono); font-size: 11px; font-weight: 400; max-width: 46%; overflow: hidden; text-overflow: ellipsis; display: inline-block; line-height: 22px; }
.ek-chip--tag { height: 18px; padding: 0 5px; border-radius: 5px; background: var(--ek-dot); color: var(--ek-icon); font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ek-chip--warn { background: var(--hw-under-butter); color: var(--hw-under-butter-ink); }
.ek-chip--warn .ek-icon { color: inherit; }
.ek-chip--accent { background: var(--hw-accent-soft); color: var(--hw-accent-hover); }
.ek-chip--kind { width: 112px; }
.ek-choices { display: flex; flex-wrap: wrap; gap: 5px; }
.ek-choice { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 1px solid var(--hw-hairline); border-radius: 8px; background: var(--ek-soft); font: inherit; font-size: 11.5px; font-weight: 500; color: var(--hw-ink2); white-space: nowrap; cursor: pointer; }
.ek-choice .ek-icon { color: var(--hw-muted); }
.ek-choice:hover { border-color: var(--hw-accent-line); color: var(--hw-ink); }
.ek-choice input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.ek-choice:has(input:checked) { border-color: var(--hw-accent-line); background: var(--hw-accent-soft); color: var(--hw-accent-hover); font-weight: 600; }
.ek-choice:has(input:checked) .ek-icon { color: inherit; }
.ek-choice:has(input:focus-visible) { outline: 2px solid var(--hw-accent); outline-offset: 1px; }

/* lists: slides, steps, questions */
.ek-num { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 999px; background: var(--ek-dot); color: var(--hw-ink2); font-size: 11px; font-weight: 700; flex: none; font-variant-numeric: tabular-nums; }
[aria-current='true'] .ek-num { background: var(--hw-accent); color: var(--ek-on-accent); }
.ek-grip { display: flex; color: var(--ek-grip); flex: none; cursor: grab; }
.ek-list { display: flex; flex-direction: column; gap: 2px; margin: 0 -4px; padding: 0; list-style: none; }
.ek-lrow { display: flex; align-items: center; gap: 8px; min-height: 36px; min-width: 0; padding: 0 8px; border: 1px solid transparent; border-radius: 10px; color: inherit; text-decoration: none; cursor: pointer; }
.ek-lrow:hover { background: var(--hw-inner); }
.ek-lrow[aria-current='true'] { background: var(--hw-accent-soft); }
.ek-lrow__title { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--hw-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ek-lrow--light .ek-lrow__title { font-weight: 500; }
.ek-lrow[aria-current='true'] .ek-lrow__title { color: var(--hw-accent-hover); }
.ek-lrow__title .ek-merge { vertical-align: 0; }
.ek-thumbs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.ek-thumb { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 6px; border: 1px solid var(--hw-hairline); border-radius: 12px; background: var(--hw-surface); color: inherit; text-decoration: none; }
.ek-thumb:hover { border-color: var(--hw-accent-line); }
.ek-thumb[aria-current='true'] { border-color: var(--hw-accent); background: var(--ek-on); box-shadow: 0 0 0 3px var(--ek-ring); }
.ek-thumb__pic { display: flex; align-items: center; justify-content: center; height: 56px; border-radius: 8px; background: var(--ek-sketch); }
.ek-thumb__card { display: flex; flex-direction: column; gap: 3px; width: 62px; height: 46px; padding: 4px; border-radius: 6px; background: var(--ek-sketch-card); box-shadow: 0 4px 10px -4px rgba(23, 20, 37, .25); overflow: hidden; }
.ek-thumb__cap { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11.5px; font-weight: 600; color: var(--hw-ink); }
.ek-thumb__cap .ek-num { width: 17px; height: 17px; font-size: 10px; }
.ek-thumb__cap span:last-child { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) { .ek-thumbs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ek-dragging { opacity: .45; }
.ek-drop-before { box-shadow: inset 0 2px 0 var(--hw-accent); }
.ek-thumbs .ek-drop-before { box-shadow: -3px 0 0 var(--hw-accent); }
html.ek-js [data-ek-panels] > [data-ek-panel]:not([data-ek-current]) { display: none; }

/* the composer */
.ek-composer { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--ek-edge); border-radius: 14px; background: var(--hw-surface); transition: border-color .14s ease-out, box-shadow .14s ease-out; }
.ek-composer:focus-within { border-color: var(--hw-accent); box-shadow: 0 0 0 3px var(--ek-ring); }
.ek-field[data-invalid='true'] .ek-composer { border-color: var(--hw-bad); }
.ek-composer__rich { min-height: 46px; padding: 11px 13px; font-size: 13px; line-height: 1.6; color: var(--hw-ink); outline: none; overflow-wrap: anywhere; cursor: text; }
.ek-composer__rich > * { margin: 0; }
.ek-composer__rich :is(h1, h2, h3, h4) { font-size: 14px; font-weight: 700; line-height: 1.45; letter-spacing: 0; color: var(--hw-ink); }
.ek-composer__rich :is(h1, h2, h3, h4) + * { margin-top: 3px; }
.ek-composer__rich :is(h1, h2, h3, h4) ~ :is(p, ul, ol) { color: var(--hw-ink2); }
.ek-composer__rich p + p, .ek-composer__rich :is(ul, ol) + p, .ek-composer__rich p + :is(ul, ol) { margin-top: 6px; }
.ek-composer__rich :is(ul, ol) { padding-left: 20px; }
.ek-composer__rich a { color: var(--hw-accent-hover); text-decoration: underline; text-underline-offset: 2px; }
.ek-composer__rich code { font-family: var(--hw-font-mono); font-size: 12px; padding: 1px 4px; border-radius: 5px; background: var(--hw-control); }
.ek-composer__rich[data-empty='true']::before { content: attr(data-placeholder); color: var(--ek-faint); pointer-events: none; position: absolute; }
.ek-composer__rich[data-empty='true'] { position: relative; }
.ek-composer__source { display: block; width: 100%; min-height: 96px; padding: 11px 13px; border: 0; border-radius: 14px 14px 0 0; background: transparent; font-family: var(--hw-font-mono); font-size: 12.5px; line-height: 1.6; color: var(--hw-ink); outline: none; resize: vertical; }
.ek-composer--line .ek-composer__source { min-height: 60px; }
.ek-composer:not([data-mode='rich']) .ek-composer__rich { display: none; }
.ek-composer[data-mode='rich'] .ek-composer__source { display: none; }
/* Without the script the Markdown box is the editor: it is the form field either way. */
html:not(.ek-js) .ek-composer .ek-composer__rich { display: none; }
html:not(.ek-js) .ek-composer .ek-composer__source { display: block; }
html:not(.ek-js) [data-ek-needs-js] { display: none; }
.ek-composer__tools { display: flex; align-items: center; gap: 1px; min-width: 0; padding: 5px 7px; border-top: 1px solid var(--ek-track); }
.ek-tb { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--ek-icon); cursor: pointer; flex: none; list-style: none; }
.ek-tb::-webkit-details-marker { display: none; }
.ek-tb:hover, .ek-pop[open] > .ek-tb { background: var(--hw-control); color: var(--hw-ink); }
.ek-tb[aria-pressed='true'] { background: var(--hw-accent-soft); color: var(--hw-accent-hover); }
.ek-tb--label { display: inline-flex; align-items: center; gap: 5px; width: auto; padding: 0 8px; font: inherit; font-size: 11.5px; font-weight: 600; color: var(--hw-accent-hover); background: var(--hw-accent-soft); }
.ek-tb--label:hover, .ek-pop[open] > .ek-tb--label { background: var(--hw-accent-soft); color: var(--hw-accent); }
.ek-tsep { width: 1px; height: 18px; margin: 0 4px; background: var(--hw-hairline); flex: none; }
.ek-count { margin-left: auto; padding-right: 4px; font-size: 11.5px; color: var(--hw-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ek-count[data-over='true'] { color: var(--hw-warn); font-weight: 600; }
.ek-merge { display: inline-flex; align-items: center; gap: 3px; height: 1.55em; padding: 0 .45em; border-radius: 7px; background: var(--hw-accent-soft); color: var(--hw-accent-hover); font-size: .82em; font-weight: 600; vertical-align: .08em; white-space: nowrap; user-select: all; }

/* popovers and menus */
.ek-pop { position: relative; display: inline-flex; }
.ek-pop > summary { list-style: none; }
.ek-pop > summary::-webkit-details-marker { display: none; }
.ek-pop__panel { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; display: flex; flex-direction: column; gap: 8px; min-width: 280px; max-width: min(360px, 86vw); padding: 10px; border-radius: 14px; background: var(--hw-surface); box-shadow: var(--ek-pop-shadow); cursor: default; }
.ek-pop--end .ek-pop__panel { left: auto; right: 0; }
.ek-pop--up .ek-pop__panel { top: auto; bottom: calc(100% + 6px); }
.ek-pop__title { font-size: 12px; font-weight: 700; color: var(--hw-ink); margin: 0; }
.ek-pop__text { margin: 0; font-size: 12px; line-height: 1.5; color: var(--hw-ink2); white-space: normal; }
.ek-pop__code { margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--hw-inner); border: 1px solid var(--hw-hairline); font-family: var(--hw-font-mono); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--hw-ink); }
.ek-pop__row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ek-menu { display: flex; flex-direction: column; gap: 2px; min-width: 200px; }
.ek-menu__item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: 10px; background: none; font: inherit; font-size: 12.5px; color: var(--hw-ink); text-align: left; cursor: pointer; white-space: nowrap; }
.ek-menu__item:hover, .ek-menu__item:focus-visible { background: var(--hw-accent-soft); outline: none; }
.ek-menu__item .ek-icon { color: var(--hw-muted); }
.ek-emoji { display: grid; grid-template-columns: repeat(8, 28px); gap: 2px; }
.ek-emoji button { width: 28px; height: 28px; border: 0; border-radius: 8px; background: none; font-size: 16px; line-height: 1; cursor: pointer; }
.ek-emoji button:hover { background: var(--hw-control); }
.ek-ai { display: flex; flex-direction: column; gap: 8px; width: 320px; max-width: 100%; }
.ek-ai__presets { display: flex; flex-wrap: wrap; gap: 5px; }
.ek-ai__status { margin: 0; font-size: 12px; color: var(--hw-muted); }
.ek-ai__status[data-tone='bad'] { color: var(--hw-bad); }
.ek-ai[aria-busy='true'] .ek-ai__status::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 999px; border: 2px solid var(--hw-accent-line); border-top-color: var(--hw-accent); animation: ek-spin .8s linear infinite; vertical-align: -1px; }
@keyframes ek-spin { to { transform: rotate(360deg); } }

/* the media block */
.ek-media { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 8px; border: 1px solid var(--hw-hairline); border-radius: 12px; background: var(--hw-surface); }
.ek-media__thumb { position: relative; flex: none; width: 128px; height: 72px; border-radius: 8px; overflow: hidden; background: #EEE9FB; }
.ek-media--compact .ek-media__thumb { width: 64px; height: 44px; }
.ek-media__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.ek-media__thumb--video { background: linear-gradient(135deg, #231B3A 0%, #3B2479 55%, #6A2FD6 100%); }
.ek-media__thumb--video::before { content: ''; position: absolute; left: 15px; right: 15px; top: 15px; bottom: 0; border-radius: 6px 6px 0 0; background: rgba(255, 255, 255, .1); }
.ek-media__thumb--video::after { content: ''; position: absolute; left: 24px; top: 24px; width: 42%; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, .55); box-shadow: 0 9px 0 -1px rgba(255, 255, 255, .22), 0 17px 0 -1px rgba(255, 255, 255, .22); }
.ek-media__thumb--empty { display: grid; place-items: center; background: var(--hw-accent-soft); color: var(--hw-accent-hover); }
.ek-media__badge { position: absolute; left: 5px; top: 5px; z-index: 1; display: flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 5px; background: rgba(23, 20, 37, .74); color: #FFFFFF; font-size: 9px; font-weight: 700; letter-spacing: .05em; }
.ek-media__dur { position: absolute; right: 5px; bottom: 5px; z-index: 1; display: flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 5px; background: rgba(23, 20, 37, .74); color: #FFFFFF; font-family: var(--hw-font-mono); font-size: 9.5px; font-weight: 600; }
.ek-media__dur:empty { display: none; }
.ek-media__play { position: absolute; left: 50%; top: 50%; z-index: 1; display: grid; place-items: center; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 999px; background: rgba(255, 255, 255, .94); color: #7A3BEB; box-shadow: 0 4px 14px rgba(23, 20, 37, .35); }
.ek-media__info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.ek-media__name { font-size: 12.5px; font-weight: 600; color: var(--hw-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ek-media__meta { font-size: 11px; color: var(--hw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ek-media__actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.ek-media__actions form { margin: 0; }
.ek-upload { position: relative; overflow: hidden; }
.ek-upload input[type='file'] { position: absolute; inset: 0; opacity: 0; cursor: pointer; font-size: 0; }
.ek-upload__status { font-size: 11.5px; color: var(--hw-muted); }
.ek-upload__status:empty { display: none; }

/* who sees it, and when */
.ek-who { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ek-who__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 2px 2px 0; }
.ek-who__title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0; color: var(--hw-ink); }
.ek-who__hint { font-size: 11.5px; color: var(--hw-muted); white-space: nowrap; }
.ek-who__foot { margin: 0; padding: 0 2px; font-size: 11.5px; line-height: 1.45; color: var(--hw-muted); }
.ek-sum { min-width: 0; border: 1px solid var(--hw-hairline); border-radius: 14px; background: var(--hw-surface); box-shadow: var(--ek-shadow); scroll-margin-top: 80px; }
.ek-sum[open] { border-color: var(--hw-accent-line); box-shadow: 0 0 0 3px rgba(122, 59, 235, .08); border-radius: 16px; }
.ek-sum > summary { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border-radius: 14px; list-style: none; cursor: pointer; }
.ek-sum > summary::-webkit-details-marker { display: none; }
.ek-sum > summary:focus-visible { outline: 2px solid var(--hw-accent); outline-offset: 2px; }
.ek-sum[open] > summary { align-items: center; padding: 13px 14px 6px; }
.ek-sum__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.ek-sum__top { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 600; color: var(--hw-ink); }
.ek-sum[open] .ek-sum__top { font-size: 14px; }
.ek-sum__open { display: none; }
.ek-sum[open] .ek-sum__open { display: inline; }
.ek-sum[open] .ek-sum__closed { display: none; }
.ek-sum__meta { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--hw-muted); white-space: nowrap; }
.ek-sum__text { font-size: 12px; line-height: 1.45; color: var(--hw-ink2); overflow-wrap: anywhere; }
.ek-sum[open] .ek-sum__text { display: none; }
.ek-sum__chev { display: flex; padding-top: 4px; color: var(--ek-faint); }
.ek-sum[open] .ek-sum__chev { transform: rotate(90deg); padding: 0; }
.ek-sum__panel { display: flex; flex-direction: column; gap: 10px; padding: 6px 14px 14px; min-width: 0; }
.ek-sum__panel .db-code { margin: 0; padding: 9px 11px; font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 10px; }
.ek-sum__panel .db-prompt { margin-top: 0; font-size: 12.5px; }
.ek-more { min-width: 0; }
.ek-more > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--hw-accent-hover); list-style: none; }
.ek-more > summary::-webkit-details-marker { display: none; }
.ek-more[open] > summary { margin-bottom: 10px; }
.ek-more__body { display: flex; flex-direction: column; gap: 10px; }

/* the preview */
.ek-preview { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 18px 20px 20px; background: var(--hw-surface); }
.ek-preview__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ek-preview__head > div { flex: 1; min-width: 0; }
.ek-preview__head > .ek-seg { flex: none; }
.ek-preview__title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0; line-height: 1.3; color: var(--hw-ink); }
.ek-preview__sub { display: block; font-size: 12px; line-height: 1.3; color: var(--hw-muted); }
.ek-frame { position: relative; flex: none; width: 100%; margin: 0 auto; border: 1px solid var(--ek-edge); border-radius: 14px; overflow: hidden; background: var(--hw-surface); box-shadow: 0 20px 40px -26px rgba(23, 20, 37, .35); transition: width .2s ease-out; }
/* The page inside is drawn at a desktop width and shown a little smaller, as a browser zoomed out would. */
.ek-frame { --ek-zoom: .8; }
.ek-frame[data-device='mobile'] { width: 272px; --ek-zoom: .7253; }
.ek-frame__bar { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 10px; background: var(--hw-control); border-bottom: 1px solid var(--hw-hairline); }
.ek-frame__dots { display: flex; gap: 4px; }
.ek-frame__dots span { width: 7px; height: 7px; border-radius: 999px; background: var(--ek-sketch-ink); }
.ek-frame__url { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; height: 20px; padding: 0 8px; border: 1px solid var(--hw-hairline); border-radius: 6px; background: var(--hw-surface); font-size: 10.5px; color: var(--hw-muted); white-space: nowrap; overflow: hidden; }
.ek-frame__url span { overflow: hidden; text-overflow: ellipsis; }
.ek-frame__body { position: relative; height: clamp(360px, calc(100vh - 404px), 640px); background: #FAF9FC; }
.ek-frame__body { overflow: hidden; }
.ek-frame__body iframe { display: block; width: calc(100% / var(--ek-zoom)); height: calc(100% / var(--ek-zoom)); border: 0; transform: scale(var(--ek-zoom)); transform-origin: 0 0; }
.ek-frame__state { position: absolute; inset: 0; z-index: 2; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 24px; text-align: center; background: rgba(250, 249, 252, .94); color: #4F4B60; font-size: 12.5px; }
.ek-frame__state strong { font-size: 13.5px; color: #171425; }
.ek-frame__state .ek-glyph { width: 36px; height: 36px; border-radius: 11px; margin-bottom: 4px; }
.ek-frame[data-state='loading'] .ek-frame__state--loading,
.ek-frame[data-state='empty'] .ek-frame__state--empty,
.ek-frame[data-state='broken'] .ek-frame__state--broken { display: flex; }
.ek-frame__state--loading { background: #FAF9FC; padding: 0; justify-content: flex-start; align-items: stretch; }
.ek-skel { position: relative; display: flex; flex: 1; width: 100%; overflow: hidden; }
.ek-skel__side { width: 92px; flex: none; background: #FFFFFF; border-right: 1px solid #F1EFF7; }
.ek-skel__main { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 44px 12px 12px; }
.ek-skel__main span { display: block; height: 8px; border-radius: 4px; background: #EFEDF5; }
.ek-skel::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 20%, rgba(255, 255, 255, .7) 50%, transparent 80%); transform: translateX(-100%); animation: ek-shimmer 1.4s ease-in-out infinite; }
@keyframes ek-shimmer { to { transform: translateX(100%); } }
.ek-caption { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--hw-ink2); }
.ek-caption > .ek-icon { color: var(--hw-muted); }
.ek-caption__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ek-replay { display: inline-flex; align-items: center; gap: 6px; height: 28px; margin-left: auto; padding: 0 8px; border: 0; border-radius: 9px; background: none; font: inherit; font-size: 12px; font-weight: 600; color: var(--hw-accent-hover); cursor: pointer; white-space: nowrap; }
.ek-replay:hover { background: var(--hw-accent-soft); }
.ek-preview__status { margin: -6px 0 0; font-size: 11.5px; color: var(--hw-muted); }
.ek-preview__status:empty { display: none; }
.ek-perf { display: flex; flex-direction: column; gap: 12px; margin-top: auto; padding: 14px 16px; border: 1px solid var(--hw-hairline); border-radius: 16px; background: var(--ek-soft); }
.ek-perf__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ek-perf__label { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--hw-muted); }
.ek-perf__link { font-size: 12px; font-weight: 500; color: var(--hw-muted); }
.ek-perf__link:hover { color: var(--hw-ink); }
.ek-perf__stats { display: flex; gap: 18px; }
.ek-stat { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.ek-stat__value { font-family: var(--hw-font-display); font-size: 24px; font-weight: 600; letter-spacing: -.02em; line-height: 1; color: var(--hw-ink); font-variant-numeric: tabular-nums; }
.ek-stat__label { font-size: 12px; color: var(--hw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ek-bar { display: block; height: 6px; border-radius: 999px; background: var(--ek-bar); overflow: hidden; }
.ek-bar > span { display: block; height: 100%; border-radius: 999px; }
.ek-perf__foot { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid var(--hw-hairline); font-size: 12px; color: var(--hw-ink2); }
.ek-perf__foot > .ek-icon { color: var(--hw-muted); }
.ek-perf__foot a { margin-left: auto; font-weight: 600; color: var(--hw-accent-hover); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .ek-skel::after { animation: none; }
  .ek-toggle input[type='checkbox']::after { transition: none; }
}
</style>`);
}
