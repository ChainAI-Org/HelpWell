/**
 * The dashboard stylesheet.
 *
 * Same approach as the help centre: one string, inlined, built from the design
 * tokens. A dashboard that takes a round trip to become styled feels broken,
 * and the whole sheet is smaller than one webfont.
 *
 * The one webfont, Plus Jakarta Sans, is self-hosted: the faces point at the
 * dashboard's own `_fonts/` route, and `font-display: swap` means text shows
 * in the system font until it arrives rather than waiting for it.
 */

import { cssVariables, duration, easing, scale, travel } from '@helpwell/tokens';
import { baseStyles, fontFaceCss, MONO_STACK, safeCssColor } from '@helpwell/ui';

/** The chevron on a select, drawn by us so its distance from the edge is ours to set. */
const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A85A0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

const DEFAULT_ACCENT = '#7A3BEB';

/**
 * @param fontsPath where the self-hosted fonts are served, e.g.
 *   "/admin/helpwell/_fonts". Absent: the system font stack only.
 */
export function dashboardStyles(accent = DEFAULT_ACCENT, fontsPath?: string | null): string {
  return `
${fontsPath != null ? fontFaceCss(fontsPath, { families: ['Plus Jakarta Sans'] }) : ''}
${cssVariables(':root')}

:root {
  --hw-accent: ${safeCssColor(accent, DEFAULT_ACCENT)};
  --db-rail: 232px;
  --db-font: "Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif;
  color-scheme: light dark;
}
${baseStyles('db')}

body {
  margin: 0;
  background: var(--hw-ground);
  color: var(--hw-ink);
  font-family: var(--db-font);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }

/* ----------------------------------------------------------------- shell */

.db-shell { display: grid; grid-template-columns: var(--db-rail) minmax(0, 1fr); min-height: 100vh; }
@media (max-width: 860px) { .db-shell { grid-template-columns: 1fr; } }

.db-rail {
  border-inline-end: 1px solid var(--hw-hairline);
  background: var(--hw-surface);
  padding: 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
@media (max-width: 860px) {
  .db-rail {
    position: static;
    height: auto;
    flex-direction: row;
    flex-wrap: wrap;
    border-inline-end: 0;
    border-bottom: 1px solid var(--hw-hairline);
  }
}

/* The lockup is the charcoal wordmark alone; never a mark beside text. */
.db-lockup { display: flex; align-items: center; padding: 4px 10px 18px; color: var(--hw-ink); }
.db-lockup svg { height: 20px; width: auto; overflow: visible; }

.db-navgroup {
  padding: 14px 10px 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--hw-muted);
}
.db-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 13.5px;
  color: var(--hw-ink2);
  transition: background ${duration.menuClose}ms ${easing.out}, color ${duration.menuClose}ms ${easing.out};
}
.db-nav:hover { background: var(--hw-control); color: var(--hw-ink); }
/* Selected row: lavender fill with violet text. Not a grey block. */
.db-nav[aria-current='page'] { background: var(--hw-accent-soft); color: var(--hw-deep-violet); }
.db-nav svg { width: 17px; height: 17px; flex: none; }
/* Sign out, for someone who came in with the admin token: last in the rail. */
.db-signout { margin-top: auto; padding-top: 14px; }
.db-signout .db-nav { width: 100%; border: 0; background: none; font-family: inherit; cursor: pointer; }
.db-nav__count {
  margin-inline-start: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--hw-control);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--hw-ink2);
}
.db-nav[aria-current='page'] .db-nav__count { background: var(--hw-surface); color: var(--hw-deep-violet); }

.db-main { min-width: 0; display: flex; flex-direction: column; }

.db-top {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 26px;
  border-bottom: 1px solid var(--hw-hairline);
  background: var(--hw-ground);
  position: sticky;
  top: 0;
  z-index: 3;
}
.db-top--bare { padding-block: 14px 0; border-bottom: 0; position: static; }
.db-top h1 { margin: 0; font-size: 19px; letter-spacing: -.015em; }
.db-top__sub { margin: 2px 0 0; color: var(--hw-muted); font-size: 13px; }
.db-top__actions { margin-inline-start: auto; display: flex; gap: 8px; align-items: center; }

.db-page { padding: 22px 26px 60px; animation: db-rise ${duration.page}ms ${easing.out} both; }

/* ---------------------------------------------------------------- pieces */

.db-card {
  background: var(--hw-surface);
  border: 1px solid var(--hw-card-edge);
  border-radius: 18px;
  padding: 20px;
}
.db-card + .db-card { margin-top: 14px; }
.db-card__title { margin: 0 0 4px; font-size: 15px; letter-spacing: -.01em; }
.db-card__hint { margin: 0 0 16px; color: var(--hw-muted); font-size: 13px; }

/* One element under the card, never a stack of them. */
.db-under {
  margin: -10px 14px 0;
  padding: 12px 16px 11px;
  border-radius: 0 0 16px 16px;
  font-size: 12.5px;
  font-weight: 600;
}
.db-under--lavender { background: var(--hw-under-lavender); color: var(--hw-under-lavender-ink); }
.db-under--peach { background: var(--hw-under-peach); color: var(--hw-under-peach-ink); }
.db-under--butter { background: var(--hw-under-butter); color: var(--hw-under-butter-ink); }
.db-under--mint { background: var(--hw-under-mint); color: var(--hw-under-mint-ink); }

.db-grid { display: grid; gap: 14px; }
.db-grid--2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.db-grid--3 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.db-grid--4 { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }

.db-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; }
@media (min-width: 1100px) { .db-split { grid-template-columns: 340px minmax(0, 1fr); } }

/* ---------------------------------------------------------------- stats */

.db-stat { background: var(--hw-surface); border: 1px solid var(--hw-card-edge); border-radius: 16px; padding: 16px 18px; }
.db-stat__label { margin: 0; font-size: 12px; font-weight: 650; color: var(--hw-muted); }
.db-stat__value { margin: 6px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -.02em; }

/* ---------------------------------------------------------------- table */

.db-tablewrap { overflow-x: auto; background: var(--hw-surface); border: 1px solid var(--hw-card-edge); border-radius: 18px; }
table.db-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.db-table th {
  text-align: start;
  padding: 11px 16px;
  background: var(--hw-inner);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--hw-muted);
  white-space: nowrap;
}
.db-table td { padding: 13px 16px; border-top: 1px solid var(--hw-hairline); vertical-align: middle; }
.db-table tbody tr { transition: background ${duration.menuClose}ms ${easing.out}; }
.db-table tbody tr:hover { background: var(--hw-inner); }
.db-table a { color: var(--hw-ink); font-weight: 600; }
.db-table a:hover { color: var(--hw-accent); }

.db-truncate { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* --------------------------------------------------------------- pills */

.db-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}
.db-pill--good { background: var(--hw-good-bg); color: var(--hw-good); }
.db-pill--warn { background: var(--hw-warn-bg); color: var(--hw-warn); }
.db-pill--bad { background: var(--hw-bad-bg); color: var(--hw-bad); }
.db-pill--info { background: var(--hw-info-bg); color: var(--hw-info); }
.db-pill--neutral { background: var(--hw-neutral-bg); color: var(--hw-neutral); }
.db-pill--accent { background: var(--hw-accent-soft); color: var(--hw-deep-violet); }
a.db-pill:hover { text-decoration: underline; }

.db-avatar {
  display: inline-grid;
  place-items: center;
  width: 28px; height: 28px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  flex: none;
}
.db-person { display: flex; align-items: center; gap: 9px; }
.db-person__name { font-weight: 620; }
.db-person__sub { font-size: 12px; color: var(--hw-muted); }

/* -------------------------------------------------------------- buttons */

.db-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 620;
  font-size: 13.5px;
  border: 1px solid var(--hw-hairline);
  background: var(--hw-surface);
  color: var(--hw-ink2);
  transition: background ${duration.menuClose}ms ${easing.out},
              border-color ${duration.menuClose}ms ${easing.out},
              transform ${duration.menuClose}ms ${easing.out};
}
.db-btn:hover { background: var(--hw-control); color: var(--hw-ink); }
.db-btn:active { transform: scale(${scale.pressed}); }
.db-btn svg { width: 15px; height: 15px; flex: none; display: block; stroke-width: 2.2; }
.db-btn span { line-height: 1.2; }
.db-btn--primary { background: var(--hw-accent); border-color: var(--hw-accent); color: #fff; }
.db-btn--primary:hover { background: var(--hw-accent-hover); color: #fff; }
.db-btn--danger { color: var(--hw-bad); }
.db-btn--danger:hover { background: var(--hw-bad-bg); color: var(--hw-bad); }

/* --------------------------------------------------------------- inputs */

.db-field { display: block; margin-bottom: 16px; }
.db-field__label { display: block; font-size: 12.5px; font-weight: 650; margin-bottom: 5px; }
.db-field__hint { margin: 4px 0 0; font-size: 12px; color: var(--hw-muted); }
.db-input, .db-select, .db-textarea {
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--hw-control);
  border: 1px solid transparent;
  outline: none;
  transition: border-color ${duration.fieldError}ms ${easing.out}, background ${duration.menuClose}ms ${easing.out};
}
/* Our own chevron, as far from the right edge as the text is from the left. */
.db-select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 36px;
  background-image: ${SELECT_CHEVRON};
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 12px;
  cursor: pointer;
}
.db-input:focus, .db-select:focus, .db-textarea:focus {
  border-color: var(--hw-accent-line);
  background-color: var(--hw-surface);
}
.db-textarea { resize: vertical; min-height: 92px; font-family: inherit; }
.db-textarea--code { font-family: ${MONO_STACK}; font-size: 13px; min-height: 220px; }
.db-field[data-invalid='true'] .db-input,
.db-field[data-invalid='true'] .db-select,
.db-field[data-invalid='true'] .db-textarea { border-color: var(--hw-bad); background-color: var(--hw-bad-bg); }
.db-error {
  display: block;
  margin-top: 5px;
  font-size: 12.5px;
  font-weight: 620;
  color: var(--hw-bad);
  animation: db-fielderror ${duration.fieldError}ms ${easing.out} both;
}
@keyframes db-fielderror {
  from { opacity: 0; transform: translateY(${travel.fieldError}px); }
  to { opacity: 1; transform: none; }
}

.db-switch { display: flex; align-items: flex-start; gap: 11px; padding: 11px 0; }
.db-switch + .db-switch { border-top: 1px solid var(--hw-hairline); }
.db-switch__text { flex: 1; }
.db-switch__title { font-weight: 620; font-size: 13.5px; }
.db-switch__hint { font-size: 12.5px; color: var(--hw-muted); margin-top: 2px; }
.db-switch input { appearance: none; width: 38px; height: 22px; border-radius: 999px; background: var(--hw-control); position: relative; cursor: pointer; flex: none; margin-top: 2px; transition: background ${duration.menuClose}ms ${easing.out}; }
.db-switch input::after {
  content: '';
  position: absolute;
  top: 3px; left: 3px;
  width: 16px; height: 16px;
  border-radius: 999px;
  background: var(--hw-surface);
  box-shadow: 0 1px 3px rgba(23,20,37,.25);
  transition: transform ${duration.menuClose}ms ${easing.spring};
}
.db-switch input:checked { background: var(--hw-accent); }
.db-switch input:checked::after { transform: translateX(16px); }

.db-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.db-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 10px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-hairline);
  min-width: 300px;
}
.db-search input { flex: 1; border: 0; background: none; outline: none; }
.db-search svg { width: 15px; height: 15px; color: var(--hw-muted); }

.db-segment { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--hw-control); gap: 2px; }
.db-segment a {
  padding: 5px 11px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 620;
  color: var(--hw-ink2);
  transition: background ${duration.menuClose}ms ${easing.out};
}
.db-segment a[aria-current='page'] { background: var(--hw-surface); color: var(--hw-ink); box-shadow: 0 1px 2px rgba(23,20,37,.08); }

/* --------------------------------------------------------------- thread */

.db-thread { display: flex; flex-direction: column; gap: 12px; }
.db-msg { max-width: 78%; }
.db-msg--customer { align-self: flex-start; }
.db-msg--agent { align-self: flex-end; }
.db-msg__bubble {
  padding: 11px 14px;
  border-radius: 16px;
  font-size: 13.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* A rendered answer is HTML: its blocks space it, not the newlines between them. */
.db-msg__bubble--rich { white-space: normal; }
.db-msg__bubble--rich > :first-child { margin-top: 0; }
.db-msg__bubble--rich > :last-child { margin-bottom: 0; }
.db-msg__bubble--rich p, .db-msg__bubble--rich ul, .db-msg__bubble--rich ol, .db-msg__bubble--rich pre { margin: 0 0 8px; }
.db-msg__bubble--rich ul, .db-msg__bubble--rich ol { padding-inline-start: 20px; }
.db-msg__bubble--rich pre { white-space: pre; overflow-x: auto; }
.db-msg--customer .db-msg__bubble { background: var(--hw-inner); border-bottom-left-radius: 4px; }
.db-msg--agent .db-msg__bubble { background: var(--hw-accent-soft); color: var(--hw-ink); border-bottom-right-radius: 4px; }
.db-msg__meta { margin-top: 5px; font-size: 11.5px; color: var(--hw-muted); display: flex; gap: 8px; flex-wrap: wrap; }
.db-msg--agent .db-msg__meta { justify-content: flex-end; }
.db-msg__event { align-self: center; font-size: 12px; color: var(--hw-muted); }

.db-cite {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-accent-line);
  color: var(--hw-deep-violet);
  font-size: 11.5px;
  font-weight: 650;
}
.db-tool {
  font-family: ${MONO_STACK};
  font-size: 11.5px;
  color: var(--hw-muted);
  background: var(--hw-inner);
  padding: 5px 9px;
  border-radius: 8px;
  margin-top: 6px;
  overflow-x: auto;
}

/* --------------------------------------------------------------- charts */

.db-chart { display: flex; align-items: flex-end; gap: 3px; height: 150px; padding-top: 10px; }
.db-chart__bar {
  flex: 1;
  min-width: 3px;
  background: var(--hw-accent-line);
  border-radius: 4px 4px 0 0;
  position: relative;
  transition: background ${duration.menuClose}ms ${easing.out};
  animation: db-grow ${duration.page}ms ${easing.out} both;
  transform-origin: bottom;
}
.db-chart__bar > i {
  position: absolute;
  inset: auto 0 0 0;
  background: var(--hw-accent);
  border-radius: 4px 4px 0 0;
  display: block;
}
.db-chart__bar:hover { background: var(--hw-accent); }
@keyframes db-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.db-chart__axis { display: flex; justify-content: space-between; margin-top: 7px; font-size: 11px; color: var(--hw-muted); }

.db-bars { display: grid; gap: 9px; }
.db-bars__row { display: grid; grid-template-columns: 150px 1fr 46px; gap: 10px; align-items: center; font-size: 13px; }
/* Spans by default are inline, where height and overflow do nothing. */
.db-bars__track { display: block; height: 8px; border-radius: 999px; background: var(--hw-control); overflow: hidden; }
.db-bars__fill { display: block; height: 100%; border-radius: 999px; background: var(--hw-accent); animation: db-fill ${duration.page}ms ${easing.out} both; transform-origin: left; }
@keyframes db-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.db-bars__value { text-align: end; color: var(--hw-muted); font-variant-numeric: tabular-nums; }

/* -------------------------------------------------------------- notices */

.db-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 16px;
  border-radius: 14px;
  font-size: 13.5px;
  margin-bottom: 16px;
  animation: db-notice ${duration.message}ms ${easing.spring} both;
}
@keyframes db-notice {
  from { opacity: 0; transform: translateY(-${travel.message}px); }
  to { opacity: 1; transform: none; }
}
.db-notice svg { width: 17px; height: 17px; flex: none; margin-top: 1px; }
.db-notice--bad { background: var(--hw-bad-bg); color: var(--hw-bad); }
.db-notice--warn { background: var(--hw-warn-bg); color: var(--hw-warn); }
.db-notice--info { background: var(--hw-info-bg); color: var(--hw-info); }
.db-notice--good { background: var(--hw-good-bg); color: var(--hw-good); }

/* ---------------------------------------------------------------- misc */

.db-kv { display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 13px; }
.db-kv dt { color: var(--hw-muted); }
.db-kv dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }

.db-tagrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.db-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--hw-control);
  font-size: 11.5px;
  font-weight: 620;
}
.db-tag button { color: var(--hw-muted); display: inline-grid; place-items: center; }
.db-tag button:hover { color: var(--hw-bad); }

.db-code {
  font-family: ${MONO_STACK};
  font-size: 12.5px;
  background: var(--hw-inner);
  border: 1px solid var(--hw-hairline);
  border-radius: 12px;
  padding: 13px 15px;
  overflow-x: auto;
  white-space: pre;
}

.db-prompt { margin-top: 14px; }
.db-prompt>details { margin-top: 10px; }
.db-agent-instruction { white-space: normal; max-width: 100%; }
.db-agent-copied { animation: db-agent-copy .24s ease-out; }
@keyframes db-agent-copy { from { transform: scale(.97); opacity: .7; } to { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .db-agent-copied { animation: none; } }
.db-prompt summary { cursor: pointer; font-weight: 600; color: var(--hw-accent); }
.db-prompt__hint { color: var(--hw-muted); margin: 8px 0; }
.db-prompt__text { white-space: pre-wrap; max-height: 320px; overflow-y: auto; margin-bottom: 10px; }
/* The copy button the setup prompt panel draws. */
.db-prompt .db-button {
  display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 10px;
  font-weight: 620; font-size: 13.5px; border: 1px solid var(--hw-hairline);
  background: var(--hw-surface); color: var(--hw-ink2); cursor: pointer;
}
.db-prompt .db-button:hover { background: var(--hw-control); color: var(--hw-ink); }

.db-muted { color: var(--hw-muted); }
.db-right { text-align: end; }
.db-nums { font-variant-numeric: tabular-nums; }
.db-link { color: var(--hw-accent); font-weight: 620; }
.db-link:hover { text-decoration: underline; }
.db-rowactions { display: inline-flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.db-rowactions form { margin: 0; }
button[disabled], .db-btn[disabled] { opacity: .6; cursor: progress; }

/* ------------------------------------------------- config-only and secrets */

.db-configonly__list { display: grid; gap: 0; }
.db-configonly { display: grid; grid-template-columns: minmax(180px, auto) auto 1fr; gap: 4px 14px; align-items: baseline; padding: 10px 0; font-size: 13px; }
.db-configonly + .db-configonly { border-top: 1px solid var(--hw-hairline); }
.db-configonly__where { font-size: 11.5px; font-weight: 700; color: var(--hw-muted); white-space: nowrap; }
.db-configonly__why { color: var(--hw-ink2); }
@media (max-width: 760px) { .db-configonly { grid-template-columns: 1fr; } }

.db-secret { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; font-size: 13px; }
.db-secret + .db-secret { border-top: 1px solid var(--hw-hairline); }
.db-secret__label { font-weight: 620; min-width: 170px; }
.db-secret__hint { color: var(--hw-muted); font-size: 12.5px; flex-basis: 100%; }
[data-check][data-tone='warn'] { color: var(--hw-warn); font-weight: 620; }

/* ------------------------------------------------------ confidence, review */

.db-meter { display: inline-flex; align-items: center; gap: 7px; vertical-align: middle; }
.db-meter__track { display: block; width: 64px; height: 6px; border-radius: 999px; background: var(--hw-control); overflow: hidden; }
.db-meter__fill { display: block; height: 100%; border-radius: 999px; background: var(--hw-accent); }
.db-meter--good .db-meter__fill { background: var(--hw-good); }
.db-meter--warn .db-meter__fill { background: var(--hw-warn); }
.db-meter--bad .db-meter__fill { background: var(--hw-bad); }
.db-meter__value { font-size: 12px; font-weight: 700; color: var(--hw-ink2); }

.db-review { margin-top: 8px; font-size: 12.5px; background: var(--hw-surface); border: 1px solid var(--hw-hairline); border-radius: 12px; padding: 8px 12px; }
.db-review summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; list-style: none; }
.db-review summary::-webkit-details-marker { display: none; }
.db-review__label { font-weight: 700; color: var(--hw-ink2); }
.db-review__certainty { color: var(--hw-muted); }
.db-review__reason { margin: 10px 0 0; color: var(--hw-ink2); line-height: 1.5; }
.db-review__sources { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
.db-review__sources caption { text-align: start; font-weight: 700; color: var(--hw-muted); padding-bottom: 4px; }
.db-review__sources th { text-align: start; font-size: 11px; color: var(--hw-muted); font-weight: 700; padding: 4px 6px; }
.db-review__sources td { padding: 5px 6px; border-top: 1px solid var(--hw-hairline); }
/* A cited passage: lavender fill, violet title. Never a rail down the side. */
.db-review__sources tr[data-cited='true'] td { background: #F0EAFE; }
.db-review__sources tr[data-cited='true'] td:nth-child(2) { color: #6A2FD6; font-weight: 650; }

a.db-cite:hover { background: var(--hw-accent-soft); }
.db-cite__how { font-weight: 600; color: var(--hw-muted); margin-inline-start: 2px; }
.db-cite__how::before { content: '· '; }
.db-cite--expected { background: #F0EAFE; color: #6A2FD6; }

/* ------------------------------------------------------- home block editor */

.db-blocks__list { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 8px; }
.db-blocks__row { border: 1px solid var(--hw-hairline); border-radius: 14px; padding: 10px 12px; background: var(--hw-surface); }
.db-blocks__row .db-field { margin: 10px 0 0; }
.db-blocks__head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.db-blocks__name { font-weight: 680; font-size: 13.5px; white-space: nowrap; }
/* The hint takes the rest of the row, and moves under the name when the row is narrow. */
.db-blocks__hint { color: var(--hw-muted); font-size: 12.5px; flex: 1 1 14em; }
.db-blocks__moves { display: inline-flex; gap: 4px; margin-inline-start: auto; }
.db-blocks__add { display: flex; gap: 8px; align-items: center; }
.db-blocks__add .db-select { max-width: 240px; }

/* ------------------------------------------- a long tab, in a few headed parts */

.wg-group { margin-top: 30px; }
.wg-group:first-child { margin-top: 0; }
.wg-group__title { margin: 0 0 2px; font-size: 18px; letter-spacing: -.015em; }
.wg-group__hint { margin: 0 0 14px; color: var(--hw-muted); font-size: 13px; }
.wg-group > .db-card + .db-card { margin-top: 14px; }
.wg-group + .wg-fold { margin-top: 30px; }
.wg-fold > summary { cursor: pointer; display: flex; gap: 10px; align-items: baseline; list-style: none; border-radius: 10px; }
.wg-fold > summary::-webkit-details-marker { display: none; }
.wg-fold > summary .db-card__title { margin: 0; flex: none; white-space: nowrap; }
.wg-fold > summary .db-muted { flex: 1; min-width: 0; font-size: 13px; }
.wg-fold > summary::after {
  content: '';
  flex: none;
  align-self: center;
  margin-inline-start: auto;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--hw-muted);
  border-bottom: 2px solid var(--hw-muted);
  transform: rotate(45deg);
}
.wg-fold[open] > summary::after { transform: rotate(-135deg); }
.wg-fold > summary:focus-visible { outline: 2px solid var(--hw-accent); outline-offset: 4px; }
.wg-fold__body { margin-top: 16px; }

/* The agent's avatar beside its URL field: the mark bare, a photo round. */
.db-avatarfield { display: flex; align-items: center; gap: 14px; margin-top: 2px; }
.db-avatarfield .db-field { flex: 1; min-width: 0; margin-bottom: 0; }
.db-avatarfield__preview { flex: none; width: 44px; height: 44px; display: inline-flex; }
.db-avatarfield__preview svg { width: 100%; height: 100%; }
.db-avatarfield__preview img { width: 44px; height: 44px; border-radius: 999px; object-fit: cover; }
.db-blocks__empty { margin: 0 0 12px; }
.db-iconbtn { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--hw-hairline); background: var(--hw-surface); color: var(--hw-ink2); cursor: pointer; }
.db-iconbtn:hover { background: var(--hw-control); }
.db-iconbtn svg { width: 14px; height: 14px; }
.db-iconbtn--down svg { transform: rotate(180deg); }

/* ------------------------------------------------------------------- evals */

.db-evalprogress { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; font-size: 13px; }
.db-evalprogress[hidden] { display: none; }
.db-evalprogress progress, .db-setup__progress progress { width: 100%; max-width: 420px; height: 8px; accent-color: var(--hw-accent); }
.db-evalprogress__text { color: var(--hw-ink2); }
.db-evalcase { padding: 14px 0; border-top: 1px solid var(--hw-hairline); }
.db-evalcase__head { display: flex; gap: 9px; align-items: center; margin-bottom: 8px; }
.db-evalcase__head strong { font-size: 13.5px; }
.db-evalcase__ms { margin-inline-start: auto; font-size: 12px; }
.db-evalcase__reason { margin: 0 0 8px; font-size: 13px; color: var(--hw-ink2); }
.db-evalcase__answer { margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: var(--hw-inner); }
.db-evalcase__answer .db-preview { font-size: 13.5px; }
.db-evalcase__answer .db-preview > :last-child { margin-bottom: 0; }
.db-evalchecks { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 5px; font-size: 13px; }
.db-evalcheck { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.db-evalcheck__kind { font-weight: 620; }
.db-evalcheck__detail { color: var(--hw-muted); }

/* -------------------------------------------------------------- get set up */

.db-setup__progress { margin-bottom: 14px; }
.db-setup__count { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.db-setup__count strong { font-size: 22px; letter-spacing: -.02em; }
.db-setup { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.db-step { background: var(--hw-surface); border: 1px solid var(--hw-card-edge); border-radius: 18px; padding: 16px 18px; scroll-margin-top: 90px; }
.db-step__head { display: flex; align-items: flex-start; gap: 12px; }
.db-step__number { flex: none; display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; background: var(--hw-control); font-weight: 700; font-size: 13px; color: var(--hw-ink2); }
.db-step[data-status='done'] .db-step__number { background: var(--hw-good-bg); color: var(--hw-good); }
.db-step__number svg { width: 14px; height: 14px; }
.db-step__text { flex: 1; min-width: 0; }
.db-step__title { margin: 2px 0 2px; font-size: 15px; letter-spacing: -.01em; }
.db-step__detail { margin: 0; color: var(--hw-muted); font-size: 13px; }
.db-step__body { margin: 12px 0 0 40px; font-size: 13.5px; }
.db-step__body > p { margin: 0 0 10px; }
.db-step__body .db-segment { flex-wrap: wrap; margin-bottom: 4px; }
.db-step__again { margin: 10px 0 0 40px; }
.db-step__again > summary { cursor: pointer; color: var(--hw-muted); font-weight: 600; font-size: 12.5px; }
.db-step__mark { margin: 12px 0 0 40px; }
@media (max-width: 640px) { .db-step__body, .db-step__again, .db-step__mark { margin-inline-start: 0; } }

.db-steps { margin: 0; padding-inline-start: 18px; font-size: 13px; display: grid; gap: 6px; color: var(--hw-ink2); }
.db-gap__question { margin: 0; font-weight: 650; font-size: 14px; }
.db-gap__variants { margin: 4px 0 0; padding-inline-start: 18px; font-size: 13px; color: var(--hw-ink2); display: grid; gap: 3px; }

@media (prefers-reduced-motion: reduce) {
  .db-page, .db-notice { animation-name: db-fade; }
}
`;
}
