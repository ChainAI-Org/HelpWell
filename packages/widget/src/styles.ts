/**
 * The widget stylesheet.
 *
 * It lives inside a Shadow DOM, so none of the host page's CSS reaches it and
 * none of this escapes. That is the only reliable way to look the same on a
 * page you have never seen (WG-01).
 *
 * Built as a string from the design tokens rather than a .css file so the
 * accent, radius and font a customer picks in Appearance are real values here
 * and not a second source of truth.
 */

import { cssVariables, duration, easing, radius, scale, travel } from '@helpwell/tokens';
import { markdownBlockStyles } from '@helpwell/ui';
import { WIDGET_FONT_FAMILY } from './fonts.js';
import { WORDMARK_BASELINE_RATIO, WORDMARK_CAP_RATIO } from './icons.js';
import { hexToRgba, safeAccent } from './sanitize.js';
import { SKELETON_CSS } from './skeleton.js';

export interface StyleOptions {
  accent: string;
  font: string;
  radius: number;
  bubbleStyle: 'rounded' | 'soft' | 'square';
}

/**
 * The tokens the widget refers to, in this stylesheet and in the views. Only
 * these go into the shadow root; the other hundred and forty stay out of it.
 * `--hw-accent` is not among them because the widget sets it itself, from
 * Appearance, in both themes.
 */
export const WIDGET_TOKENS = [
  '--hw-accent-hover',
  '--hw-accent-soft',
  '--hw-accent-line',
  '--hw-deep-violet',
  '--hw-ink',
  '--hw-ink2',
  '--hw-muted',
  '--hw-surface',
  '--hw-inner',
  '--hw-control',
  '--hw-ground',
  '--hw-hairline',
  '--hw-good',
  '--hw-good-bg',
  '--hw-warn',
  '--hw-warn-bg',
  '--hw-bad',
  '--hw-bad-bg',
  '--hw-info',
  '--hw-info-bg',
  '--hw-shadow-card',
  '--hw-shadow-float',
  '--hw-font-mono',
];

const bubbleRadius: Record<StyleOptions['bubbleStyle'], string> = {
  rounded: `${radius.bubble}px`,
  soft: '12px',
  square: '4px',
};

export function widgetStyles(options: StyleOptions): string {
  // Everything here came from settings: a colour goes into a rule unquoted,
  // so it is only ever a hex colour, and the numbers are only ever numbers.
  const accent = safeAccent(options.accent);
  const panelRadius = Number.isFinite(options.radius) ? Math.max(0, options.radius) : radius.panel;
  const bubble = bubbleRadius[options.bubbleStyle] ?? bubbleRadius.rounded;
  const font = JSON.stringify(String(options.font || 'Plus Jakarta Sans'));

  // Light values, then the dark overrides twice: once for the reader's OS
  // setting and once for an explicit [data-hw-theme='dark'] on the host.
  return `
${cssVariables(':host', { only: WIDGET_TOKENS })}

:host {
  --hw-accent: ${accent};
  --hw-accent-glow: ${hexToRgba(accent, 0.35)};
  --hw-panel-radius: ${panelRadius}px;
  --hw-bubble-radius: ${bubble};
  /* The page's own Plus Jakarta Sans if it has one, else the copy the API
     serves, registered under its own name (fonts.ts). */
  --hw-font: ${font}, "Plus Jakarta Sans", "${WIDGET_FONT_FAMILY}", system-ui, "Segoe UI", sans-serif;
  /* On a phone; overridden inline with the visual viewport's height. */
  --hw-panel-height: 100dvh;
  /* The room the panel has; a dragged launcher sets its own (drag.ts). */
  --hw-panel-max-width: calc(100vw - 32px);
  --hw-panel-max-height: calc(100vh - 120px);

  position: fixed;
  z-index: 2147483000;
  font-family: var(--hw-font);
  font-size: 14px;
  line-height: 1.5;
  color: var(--hw-ink);
  -webkit-font-smoothing: antialiased;
}

*, *::before, *::after { box-sizing: border-box; }

button {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
}

input, textarea {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
}

:focus-visible {
  outline: 2px solid var(--hw-accent);
  outline-offset: 2px;
  border-radius: 6px;
}

/* Read by screen readers, invisible to everyone else. */
.visuallyHidden {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

${SKELETON_CSS}

/* ------------------------------------------------------------- launcher */

.launcher {
  position: absolute;
  bottom: 0;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--hw-accent);
  color: #fff;
  box-shadow: 0 10px 22px var(--hw-accent-glow);
  transition: transform ${duration.menuOpen}ms ${easing.spring},
              box-shadow ${duration.menuOpen}ms ${easing.out};
}
.launcher:hover { transform: translateY(-2px) scale(1.04); }
.launcher:active { transform: scale(${scale.pressed}); }
.launcher svg { width: 26px; height: 26px; display: block; }

/* The mark IS the chat bubble. It is never set inside another circle. */
.launcher--mark { background: none; box-shadow: none; }
.launcher--mark svg, .launcher--mark img {
  width: 56px;
  height: 56px;
  display: block;
  filter: drop-shadow(0 10px 22px var(--hw-accent-glow));
}
.launcher--mark img { border-radius: 999px; object-fit: cover; }
/*
 * With no circle behind it, a white close icon disappears on a light page.
 * When the panel is open the close mark gets the accent and a surface disc,
 * so it reads on anything the widget might be sitting on.
 */
.launcher--mark .launcher__close {
  width: 44px;
  height: 44px;
  place-self: center;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--hw-surface);
  color: var(--hw-accent);
  box-shadow: var(--hw-shadow-card);
}
.launcher--mark .launcher__close svg { width: 20px; height: 20px; filter: none; }

.launcher__badge {
  position: absolute;
  top: -2px;
  inset-inline-end: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--hw-bad);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  border: 2px solid var(--hw-ground);
}

.launcher__close { position: absolute; opacity: 0; transform: rotate(-90deg); }
.launcher[data-open='true'] .launcher__open { opacity: 0; transform: rotate(90deg); }
.launcher[data-open='true'] .launcher__close { opacity: 1; transform: none; }
/* The Draggable placement (drag.ts): the visitor can pick it up and move it. */
.launcher[data-draggable='true'] { touch-action: none; cursor: grab; }
.launcher[data-dragging='true'] { cursor: grabbing; transition: none; transform: scale(1.04); }
:host([data-position^='top-']) .launcher { bottom: auto; top: 0; }
.launcher__open, .launcher__close {
  grid-area: 1 / 1;
  transition: opacity ${duration.menuClose}ms ${easing.out},
              transform ${duration.menuOpen}ms ${easing.spring};
}

/* ---------------------------------------------------------------- panel */

/*
 * The host element is a zero-width anchor pinned to one corner, so the panel
 * has to say which edge it hangs from. Without this it takes its static
 * position — the anchor's left edge — and 400px of panel ends up off-screen.
 */
.panel {
  position: absolute;
  bottom: 72px;
  inset-inline-end: 0;
  width: 400px;
  max-width: var(--hw-panel-max-width);
  height: 640px;
  max-height: var(--hw-panel-max-height);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--hw-surface);
  border-radius: var(--hw-panel-radius);
  box-shadow: var(--hw-shadow-float);
  opacity: 0;
  transform: translateY(${travel.page}px) scale(${scale.menuFrom});
  transform-origin: bottom right;
  pointer-events: none;
  transition: opacity ${duration.menuClose}ms ${easing.out},
              transform ${duration.menuClose}ms ${easing.out};
}
/* The panel takes focus when it opens; the ring belongs on what is inside it. */
.panel:focus-visible { outline: none; }
.panel[data-open='true'] {
  opacity: 1;
  transform: none;
  pointer-events: auto;
  transition: opacity ${duration.menuOpen - 80}ms ${easing.out},
              transform ${duration.menuOpen}ms ${easing.spring};
}
:host([data-position$='-left']) .panel {
  transform-origin: bottom left;
  inset-inline-end: auto;
  inset-inline-start: 0;
}
/* A launcher dragged near the top opens its panel downward. */
:host([data-position^='top-']) .panel { bottom: auto; top: 72px; transform-origin: top right; }
:host([data-position='top-left']) .panel { transform-origin: top left; }

/*
 * On a phone the panel is the screen, not a card floating on it. Its height
 * follows the visual viewport, which is what shrinks when the keyboard comes
 * up, so the composer stays above the keys rather than under them.
 */
@media (max-width: 480px) {
  /* The panel header closes full-screen chat; keep the launcher off the tabs. */
  .launcher[data-open='true'] { display: none; }
  .panel {
    position: fixed;
    inset: 0;
    width: 100vw;
    max-width: none;
    height: var(--hw-panel-height);
    max-height: none;
    border-radius: 0;
  }
  /* Full screen wherever a dragged launcher was. */
  :host([data-position^='top-']) .panel { inset: 0; }
}

.panel__header {
  position: relative;
  padding: 20px 20px 16px;
  background: var(--hw-accent);
  color: #fff;
  flex: none;
  overflow: hidden;
}
.panel__header--plain { background: var(--hw-surface); color: var(--hw-ink); }
.panel__pattern { position: absolute; inset: 0; opacity: .5; pointer-events: none; }
.panel__headerRow { position: relative; display: flex; align-items: center; gap: 10px; }
.panel__title { font-size: 20px; font-weight: 700; letter-spacing: -.01em; margin: 0; }
.panel__subtitle { position: relative; margin: 4px 0 0; opacity: .85; font-size: 13px; }
.panel__back {
  display: inline-grid;
  place-items: center;
  width: 30px; height: 30px;
  border-radius: 999px;
  margin-inline-start: -6px;
  transition: background ${duration.menuClose}ms ${easing.out};
}
.panel__back:hover { background: rgba(255,255,255,.16); }
.panel__header--plain .panel__back:hover { background: var(--hw-control); }
.panel__back svg { width: 18px; height: 18px; }

.panel__body { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.panel__body--flush { padding: 0; }
.panel__body--padded { padding: 16px; }

/* ----------------------------------------------------------------- tabs */

.tabbar {
  flex: none;
  display: flex;
  border-top: 1px solid var(--hw-hairline);
  background: var(--hw-surface);
  padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
}
.tab {
  flex: 1;
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 7px 2px;
  border-radius: 12px;
  color: var(--hw-muted);
  font-size: 11px;
  font-weight: 600;
  position: relative;
  transition: color ${duration.menuClose}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out};
}
.tab:hover { color: var(--hw-ink2); background: var(--hw-control); }
.tab[aria-selected='true'] { color: var(--hw-accent); }
.tab svg { width: 20px; height: 20px; }
.tab__dot {
  position: absolute;
  top: 5px;
  inset-inline-end: calc(50% - 16px);
  width: 7px; height: 7px;
  border-radius: 999px;
  background: var(--hw-bad);
}

/* ---------------------------------------------------------------- pages */

.page { animation: hw-page ${duration.page}ms ${easing.out} both; }
@keyframes hw-page {
  from { opacity: 0; transform: translateY(${travel.page}px); }
  to { opacity: 1; transform: none; }
}

.section { padding: 16px; }
.section__title {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--hw-muted);
}

.card {
  display: block;
  width: 100%;
  text-align: start;
  padding: 14px;
  border-radius: 14px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-hairline);
  transition: transform ${duration.menuClose}ms ${easing.out},
              box-shadow ${duration.menuClose}ms ${easing.out},
              border-color ${duration.menuClose}ms ${easing.out};
}
.card + .card { margin-top: 8px; }
.card:hover {
  transform: translateY(-${travel.cardLift}px);
  box-shadow: var(--hw-shadow-card);
  border-color: var(--hw-accent-line);
}
.card__title { font-weight: 650; font-size: 14px; margin: 0; }
.card__meta { margin: 3px 0 0; font-size: 12.5px; color: var(--hw-muted); }

.rowlist { display: flex; flex-direction: column; }
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: start;
  padding: 13px 16px;
  border-bottom: 1px solid var(--hw-hairline);
  transition: background ${duration.menuClose}ms ${easing.out};
}
.row:hover { background: var(--hw-inner); }
.row__main { min-width: 0; flex: 1; }
.row__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__sub {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--hw-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__chevron { color: var(--hw-muted); flex: none; }
.row__chevron svg { width: 16px; height: 16px; display: block; }

.primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--hw-accent);
  color: #fff;
  font-weight: 650;
  transition: background ${duration.menuClose}ms ${easing.out},
              transform ${duration.menuClose}ms ${easing.out};
}
.primary:hover { background: var(--hw-accent-hover); }
.primary:active { transform: scale(${scale.pressed}); }
.primary[disabled] { opacity: .55; cursor: not-allowed; transform: none; }

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  color: var(--hw-ink2);
  font-weight: 600;
  font-size: 13px;
  transition: background ${duration.menuClose}ms ${easing.out};
}
.ghost:hover { background: var(--hw-control); }
.ghost[disabled] { opacity: .55; cursor: not-allowed; }

/* The status page link at the foot of Home, when the customer has one. */
.statusLink {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hw-muted);
  text-decoration: none;
}
.statusLink:hover { color: var(--hw-ink2); }
.statusLink svg { width: 13px; height: 13px; }

/* "Email us at …": quiet, under an answer the agent could not give and on Home. */
.supportEmail {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--hw-muted);
  overflow-wrap: anywhere;
}
.supportEmail a {
  color: var(--hw-ink2);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.supportEmail a:hover { color: var(--hw-accent); }
.supportEmail--thread { align-self: flex-start; margin: 2px 0 0 32px; }
.supportEmail--home { text-align: center; }

.searchbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--hw-control);
  border: 1px solid transparent;
  transition: border-color ${duration.menuClose}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out};
}
.searchbox:focus-within { border-color: var(--hw-accent-line); background: var(--hw-surface); }
.searchbox input { flex: 1; outline: none; }
.searchbox input::placeholder { color: var(--hw-muted); }
.searchbox svg { width: 16px; height: 16px; color: var(--hw-muted); flex: none; }

/* ----------------------------------------------------------------- chat */

.thread {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
/*
 * "Jump to latest": a strip of its own between the thread and the composer,
 * never laid over the thread, so it cannot cover a field or a button in it.
 */
.jumpLatest {
  flex: none;
  display: flex;
  justify-content: center;
  padding: 6px 16px 2px;
}
.jumpLatest[hidden] { display: none; }
.jumpLatest__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  font-size: 12px;
  font-weight: 600;
}
.jumpLatest__button:hover { background: var(--hw-accent-line); }
.jumpLatest__button svg { width: 14px; height: 14px; }
/*
 * What a visitor typed is plain text, and keeps its line breaks. A rendered
 * reply is HTML with a newline between its blocks: kept, each one would be a
 * blank line between paragraphs and list items, so it wraps normally and its
 * own margins do the spacing. Code blocks keep theirs either way.
 */
.bubble {
  max-width: 84%;
  padding: 10px 13px;
  border-radius: var(--hw-bubble-radius);
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  animation: hw-bubble ${duration.message}ms ${easing.spring} both;
}
.bubble--rich { white-space: normal; }
@keyframes hw-bubble {
  from { opacity: 0; transform: translateY(${travel.message}px); }
  to { opacity: 1; transform: none; }
}
.bubble--customer {
  align-self: flex-end;
  background: var(--hw-accent);
  color: #fff;
  border-bottom-right-radius: ${radius.bubbleTail}px;
}
.bubble--agent {
  align-self: flex-start;
  background: var(--hw-inner);
  color: var(--hw-ink);
  border-bottom-left-radius: ${radius.bubbleTail}px;
}
/*
 * One message and what hangs off it. A column, so each bubble's align-self
 * holds: the visitor's to the right, the agent's to the left.
 */
.msgGroup { display: flex; flex-direction: column; }

/* The agent's avatar beside its replies: the bare mark, or a round photo. */
.agentRow { display: flex; align-items: flex-end; gap: 8px; }
.agentRow > .bubble { max-width: calc(84% - 32px); }
.agentAvatar { display: inline-flex; flex: none; }
.agentAvatar svg { width: 100%; height: 100%; display: block; }
.agentAvatar img { width: 100%; height: 100%; border-radius: 999px; object-fit: cover; display: block; }
.msgGroup--agent > .citations,
.msgGroup--agent > .msgActions,
.msgGroup--agent > .attachments { margin-inline-start: 32px; }
.panel__agent { display: flex; align-items: center; gap: 10px; min-width: 0; }
.panel__agent .agentAvatar { width: 32px; height: 32px; }
.panel__agentText { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.panel__agentText .panel__title { font-size: 17px; }
.panel__agentRole { font-size: 12.5px; opacity: .8; }

.bubble--event {
  align-self: center;
  background: none;
  color: var(--hw-muted);
  font-size: 12.5px;
  text-align: center;
  padding: 2px 0;
}

.citations { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.citation {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  font-size: 12px;
  font-weight: 600;
  transition: background ${duration.menuClose}ms ${easing.out};
}
.citation:hover { background: var(--hw-accent-line); }
.citation svg { width: 12px; height: 12px; }

.msgActions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity ${duration.menuClose}ms ${easing.out};
}
.msgGroup:hover .msgActions, .msgActions:focus-within { opacity: 1; }
.msgActions[data-voted='true'] { opacity: 1; }
.iconBtn {
  display: grid;
  place-items: center;
  width: 26px; height: 26px;
  border-radius: 8px;
  color: var(--hw-muted);
  transition: background ${duration.menuClose}ms ${easing.out},
              color ${duration.menuClose}ms ${easing.out};
}
.iconBtn:hover { background: var(--hw-control); color: var(--hw-ink2); }
.iconBtn[aria-pressed='true'] { color: var(--hw-accent); background: var(--hw-accent-soft); }
.iconBtn svg { width: 15px; height: 15px; }

.typing { display: flex; gap: 4px; align-items: center; padding: 4px 2px; }
.typing i {
  width: 6px; height: 6px;
  border-radius: 999px;
  background: var(--hw-muted);
  animation: hw-typing 1.1s ${easing.out} infinite;
}
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes hw-typing {
  0%, 60%, 100% { opacity: .3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

.handoff { flex: none; padding: 6px 16px 10px; text-align: center; }
.handoff:empty, .handoff[hidden] { display: none; }
.handoff__button { padding: 8px 14px; border-radius: 999px; background: var(--hw-accent-soft); color: var(--hw-deep-violet); font-size: 12px; font-weight: 600; }
.handoff__button:hover:not(:disabled) { background: var(--hw-accent-line); }
.handoff__button:disabled { color: var(--hw-muted); background: var(--hw-control); cursor: default; }

.composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 12px calc(12px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--hw-hairline);
  background: var(--hw-surface);
}
.composer textarea {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--hw-control);
  outline: none;
  transition: height ${duration.composerGrow}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out};
}
.composer textarea::placeholder { color: var(--hw-muted); }
.composer__send {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px; height: 38px;
  border-radius: 999px;
  background: var(--hw-accent);
  color: #fff;
  transition: transform ${duration.menuClose}ms ${easing.out}, opacity ${duration.menuClose}ms ${easing.out};
}
.composer__send:hover { transform: scale(1.06); }
.composer__send:active { transform: scale(${scale.pressed}); }
.composer__send[disabled] { opacity: .4; cursor: not-allowed; transform: none; }
.composer__send svg { width: 17px; height: 17px; }

/* The honeypot must be reachable by a bot and invisible to a person. */
.honeypot {
  position: absolute;
  left: -9999px;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* ---------------------------------------------------------------- forms */

.field { display: block; margin-bottom: 12px; }
.field__label {
  display: block;
  margin-bottom: 5px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--hw-ink2);
}
.field__input {
  width: 100%;
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--hw-control);
  border: 1px solid transparent;
  outline: none;
  transition: border-color ${duration.fieldError}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out};
}
.field__input:focus { border-color: var(--hw-accent-line); background: var(--hw-surface); }
.field[data-invalid='true'] .field__input { border-color: var(--hw-bad); background: var(--hw-bad-bg); }

/* Validation messages animate in; they never appear instantly (DS-09). */
.field__error {
  display: block;
  margin-top: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hw-bad);
  animation: hw-fielderror ${duration.fieldError}ms ${easing.out} both;
}
@keyframes hw-fielderror {
  from { opacity: 0; transform: translateY(${travel.fieldError}px); }
  to { opacity: 1; transform: none; }
}

.consent { margin: 8px 0 14px; font-size: 12px; color: var(--hw-muted); }

/* --------------------------------------------------------------- notice */

.notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 12px;
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.45;
  animation: hw-notice ${duration.message}ms ${easing.spring} both;
}
@keyframes hw-notice {
  from { opacity: 0; transform: translateY(-${travel.message}px); }
  to { opacity: 1; transform: none; }
}
.notice svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }
.notice--bad { background: var(--hw-bad-bg); color: var(--hw-bad); }
.notice--warn { background: var(--hw-warn-bg); color: var(--hw-warn); }
.notice--info { background: var(--hw-info-bg); color: var(--hw-info); }
.thread .notice--info { background: var(--hw-control); color: var(--hw-ink2); }
.notice__retry { margin-inline-start: auto; font-weight: 700; text-decoration: underline; }

.empty { padding: 44px 24px; text-align: center; color: var(--hw-muted); }
.empty__title { margin: 12px 0 4px; font-weight: 650; color: var(--hw-ink2); font-size: 14px; }
.empty svg { width: 30px; height: 30px; opacity: .5; }

/* -------------------------------------------------------------- article */

.article { padding: 0 18px 24px; }
.article h1 { font-size: 21px; line-height: 1.3; letter-spacing: -.015em; margin: 16px 0 6px; }
.article__meta { color: var(--hw-muted); font-size: 12.5px; margin: 0 0 16px; }
.article__body { font-size: 15px; line-height: 1.65; color: var(--hw-ink2); }
.article__body h1, .article__body h2 { font-size: 17px; color: var(--hw-ink); margin: 22px 0 6px; }
.article__body h3, .article__body h4 { font-size: 15px; color: var(--hw-ink); margin: 18px 0 6px; }
.article__body p { margin: 0 0 12px; }
.article__body ul, .article__body ol { margin: 0 0 12px; padding-inline-start: 20px; }
.article__body li { margin-bottom: 5px; }
.article__body a { color: var(--hw-accent); text-decoration: underline; }
.article__body code {
  font-family: var(--hw-font-mono, ui-monospace, Consolas, monospace);
  font-size: .9em;
  background: var(--hw-control);
  padding: 1px 5px;
  border-radius: 6px;
}
.article__body pre {
  background: var(--hw-inner);
  padding: 12px 14px;
  border-radius: 12px;
  overflow-x: auto;
  margin: 0 0 12px;
}
.article__body pre code { background: none; padding: 0; }
.article__body img { max-width: 100%; border-radius: 12px; }
.article__body blockquote {
  margin: 0 0 12px;
  padding-inline-start: 12px;
  border-inline-start: 3px solid var(--hw-accent-line);
  color: var(--hw-muted);
}

/*
 * Markdown is rendered by the help centre's renderer, in articles and in the
 * agent's answers alike. Tables scroll inside themselves rather than pushing
 * the panel, and the section anchors it draws belong on a full page, not here.
 */
.article__body table, .bubble table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13.5px;
  margin: 0 0 12px;
}
.article__body th, .article__body td, .bubble th, .bubble td {
  text-align: start;
  padding: 7px 9px;
  border-bottom: 1px solid var(--hw-hairline);
}
.article__body th, .bubble th { color: var(--hw-ink); font-weight: 650; }
.hc-tablewrap { overflow-x: auto; margin: 0 0 12px; }
.hc-anchor { display: none; }

.rate {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--hw-hairline);
  text-align: center;
}
.rate__q { font-size: 13px; font-weight: 650; margin: 0 0 10px; }
.rate__buttons { display: flex; gap: 8px; justify-content: center; }
.rate__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--hw-hairline);
  font-size: 13px;
  font-weight: 600;
  transition: border-color ${duration.menuClose}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out},
              transform ${duration.confirm}ms ${easing.spring};
}
.rate__btn:hover { border-color: var(--hw-accent-line); background: var(--hw-accent-soft); }
.rate__btn[aria-pressed='true'] {
  border-color: var(--hw-accent);
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  transform: scale(${scale.confirmPeak});
}
.rate__btn svg { width: 15px; height: 15px; }

/* ------------------------------------------------------------ changelog */

.entry { padding: 16px; border-bottom: 1px solid var(--hw-hairline); }
/* Grouped by month (changelog.groupBy: date): a heading over the month's entries. */
.entry__month {
  margin: 0;
  padding: 16px 16px 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--hw-muted);
}
.entry__top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.entry__version {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  font-size: 11px;
  font-weight: 700;
}
.entry__date { font-size: 12px; color: var(--hw-muted); }
.entry__unread { width: 7px; height: 7px; border-radius: 999px; background: var(--hw-accent); }
.entry__title { margin: 0 0 4px; font-size: 15px; font-weight: 680; letter-spacing: -.01em; }
.entry__summary { margin: 0; font-size: 13.5px; color: var(--hw-ink2); }
.entry__cover { width: 100%; border-radius: 12px; margin-bottom: 10px; display: block; }
.entry__tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--hw-control);
  color: var(--hw-ink2);
  font-size: 11px;
  font-weight: 650;
}

.loadmore { display: block; width: 100%; padding: 14px; color: var(--hw-accent); font-weight: 650; }
.loadmore:hover { background: var(--hw-inner); }

/* -------------------------------------------------------------- roadmap */

.lane { padding: 14px 16px 4px; }
.lane__head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.lane__dot { width: 8px; height: 8px; border-radius: 999px; }
.lane__name { font-size: 12px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--hw-ink2); }
.lane__count { font-size: 12px; color: var(--hw-muted); }

.idea { display: flex; gap: 10px; align-items: flex-start; }
.idea__main { flex: 1; min-width: 0; }
.idea__title { margin: 0; font-size: 14px; font-weight: 640; }
.idea__body { margin: 3px 0 0; font-size: 12.5px; color: var(--hw-muted); }
.vote {
  flex: none;
  display: grid;
  justify-items: center;
  gap: 1px;
  min-width: 44px;
  padding: 6px 8px;
  border-radius: 12px;
  border: 1px solid var(--hw-hairline);
  font-size: 12px;
  font-weight: 700;
  transition: border-color ${duration.menuClose}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out},
              transform ${duration.confirm}ms ${easing.spring};
}
.vote:hover { border-color: var(--hw-accent-line); }
.vote[aria-pressed='true'] {
  border-color: var(--hw-accent);
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
}
.vote--bumped { transform: scale(${scale.confirmPeak}); }
.vote svg { width: 13px; height: 13px; }

/* --------------------------------------------------------------- footer */

.poweredBy {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px;
  font-size: 11.5px;
  color: var(--hw-muted);
  border-top: 1px solid var(--hw-hairline);
  flex: none;
}
.poweredBy a { color: inherit; text-decoration: none; }
.poweredBy a:hover { color: var(--hw-ink2); }
/*
 * Credit line, per design/GUIDE.md: match the wordmark's cap height to the
 * text (font-size x 0.892), sit it on the baseline, and pull it down by
 * font-size x 0.162 so both baselines land together. overflow:visible keeps
 * the p's tail from being clipped by the cropped viewBox.
 */
.poweredBy svg {
  height: calc(11.5px * ${WORDMARK_CAP_RATIO});
  width: auto;
  vertical-align: baseline;
  margin-bottom: calc(-11.5px * ${WORDMARK_BASELINE_RATIO});
  overflow: visible;
}

${featureStyles()}

/* ------------------------------------------------------ reduced motion */

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: ${duration.reduced}ms !important;
    animation-delay: 0ms !important;
    transition-duration: ${duration.reduced}ms !important;
  }
  .page, .bubble, .notice { animation-name: hw-fade; }
  @keyframes hw-fade { from { opacity: 0; } to { opacity: 1; } }
}
`;
}

/**
 * Media in messages, the email card, live human support, attachments, Home
 * blocks, status and the changelog announcements. Kept apart from the core
 * sheet above because each piece belongs to a feature that may be off.
 */
function featureStyles(): string {
  return `
/* ------------------------------------------------------ markdown blocks */

/*
 * The help centre's callouts, steps, tabs and accordions, in articles and in
 * answers alike. The renderer draws the same class names everywhere.
 */
${markdownBlockStyles('.article__body')}
${markdownBlockStyles('.bubble')}
.bubble > :first-child { margin-top: 0; }
.bubble > :last-child { margin-bottom: 0; }
.bubble p { margin: 0 0 8px; }
/* Blocks in an answer sit as close as its paragraphs, not a browser's default em apart. */
.bubble ul, .bubble ol { margin: 0 0 8px; padding-inline-start: 20px; }
.bubble li { margin: 0 0 3px; }
.bubble h1, .bubble h2, .bubble h3, .bubble h4 { font-size: 14.5px; line-height: 1.35; margin: 12px 0 4px; }
.bubble blockquote { margin: 0 0 8px; padding-inline-start: 10px; border-inline-start: 3px solid var(--hw-accent-line); }
.bubble code {
  font-family: var(--hw-font-mono, ui-monospace, Consolas, monospace);
  font-size: .9em;
  background: var(--hw-surface);
  padding: 1px 4px;
  border-radius: 5px;
}
.bubble pre {
  margin: 0 0 8px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-hairline);
  overflow-x: auto;
  white-space: pre;
}
.bubble pre code { background: none; padding: 0; }
.bubble a { color: inherit; text-decoration: underline; }
.bubble--agent a { color: var(--hw-accent); }

/* ----------------------------------------------------------------- media */

.bubble img, .article__body img, .homeCard__body img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  height: auto;
  border-radius: 10px;
}
.bubble img { max-height: 240px; }
.article__body video, .bubble video {
  display: block;
  width: 100%;
  max-height: 320px;
  border-radius: 10px;
  background: #000;
}
.media-zoom {
  display: block;
  margin: 4px 0;
  border-radius: 10px;
  cursor: zoom-in;
  line-height: 0;
}
.media-zoom:focus-visible { outline-offset: 3px; }

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 2147483600;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(12, 8, 24, .82);
  cursor: zoom-out;
  animation: hw-fade-in ${duration.menuOpen}ms ${easing.out} both;
}
.lightbox__img { max-width: 100%; max-height: 100%; border-radius: 10px; box-shadow: var(--hw-shadow-float); }
.lightbox__close {
  position: absolute;
  top: 14px;
  inset-inline-end: 14px;
  width: 40px; height: 40px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, .14);
  color: #fff;
}
.lightbox__close svg { width: 20px; height: 20px; }
@keyframes hw-fade-in { from { opacity: 0; } to { opacity: 1; } }

/* A video link card: the renderer's markup for YouTube, Vimeo, Loom and Wistia. */
.hc-video-link { margin: 4px 0 10px; }
.hc-video-link a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px;
  border-radius: 12px;
  background: var(--hw-control);
  color: var(--hw-ink);
  text-decoration: none;
  font-weight: 600;
}
.hc-video-link a:hover { background: var(--hw-accent-soft); }
.hc-video-link svg { color: var(--hw-accent); flex: none; }
.hc-video-link__via { color: var(--hw-muted); font-weight: 500; }

/* A player that loads nothing until it is clicked. */
.hw-video { margin: 4px 0 10px; }
.hw-video__play {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 12px 14px;
  border-radius: 12px;
  background: linear-gradient(160deg, var(--hw-deep-violet), #1B1230);
  color: #fff;
  text-align: start;
}
.hw-video__icon {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 54px; height: 54px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, .18);
  transition: transform ${duration.menuClose}ms ${easing.out}, background ${duration.menuClose}ms ${easing.out};
}
.hw-video__play:hover .hw-video__icon { transform: scale(1.08); background: var(--hw-accent); }
.hw-video__label { position: relative; font-weight: 650; font-size: 13.5px; }
.hw-video__via { position: relative; font-size: 11.5px; opacity: .75; }
.hw-video__frame { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; }
.hw-video__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

/* ------------------------------------------------------------ email card */

.emailCard {
  align-self: stretch;
  padding: 12px;
  border-radius: 16px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-accent-line);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--hw-accent) 8%, transparent);
  animation: hw-bubble ${duration.message}ms ${easing.spring} both;
}
.emailCard[data-state='done'] {
  padding: 10px 14px;
  background: var(--hw-inner);
  border-color: transparent;
  box-shadow: none;
}
.emailCard__title { margin: 0; font-weight: 700; font-size: 13px; }
.emailCard__reason { margin: 8px 0; color: var(--hw-ink2); font-size: 12px; line-height: 1.45; }
.emailCard .field { margin-bottom: 8px; }
.emailCard .field__input { height: 36px; padding: 0 10px; border-radius: 10px; font-size: 12.5px; }
.emailCard .consent { margin: 8px 0 0; }
.emailCard__address { display: flex; gap: 6px; align-items: flex-start; }
.emailCard__address .field { flex: 1; min-width: 0; margin: 0; }
.emailCard__actions { display: flex; gap: 8px; align-items: center; }
.emailCard__actions .primary { width: auto; min-height: 36px; height: 36px; padding: 0 12px; border-radius: 10px; font-size: 12.5px; font-weight: 700; }
.emailCard__done { margin: 0; font-size: 13px; color: var(--hw-ink2); }
.emailCard__change { color: var(--hw-accent); font-weight: 650; text-decoration: underline; }

/* The bot check, on the rare occasion Cloudflare wants a click. */
.challenge { display: flex; justify-content: center; padding: 0 12px; }
.challenge:empty { display: none; }
.challenge[data-challenge='running'] { padding: 8px 12px 0; }

/* ------------------------------------------------------------- live chat */

.bubble--typing { display: flex; flex-direction: column; gap: 4px; }
.typing__name { font-size: 12px; color: var(--hw-muted); }
.seen {
  align-self: flex-end;
  margin: -6px 2px 0;
  font-size: 11.5px;
  color: var(--hw-muted);
}

/* ----------------------------------------------------------- attachments */

.composer__attachWrap { display: contents; }
.composer__attach {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px; height: 38px;
  border-radius: 999px;
  color: var(--hw-muted);
}
.composer__attach:hover { background: var(--hw-control); color: var(--hw-ink2); }
.composer__attach[hidden] { display: none; }
.panel__body[data-dropping='true'] {
  outline: 2px dashed var(--hw-accent-line);
  outline-offset: -8px;
  background: var(--hw-accent-soft);
}
.uploads { display: flex; flex-direction: column; gap: 6px; padding: 0 12px; }
.uploads:empty { display: none; }
.uploads:not(:empty) { padding-top: 8px; }
.upload {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--hw-inner);
  font-size: 12.5px;
}
.upload svg { flex: none; width: 16px; height: 16px; color: var(--hw-muted); }
.upload[data-state='failed'] { background: var(--hw-bad-bg); color: var(--hw-bad); }
.upload[data-state='failed'] svg { color: var(--hw-bad); }
.upload__name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.upload__meter { flex: none; width: 64px; height: 4px; border-radius: 999px; background: var(--hw-hairline); overflow: hidden; }
.upload__bar { display: block; width: 0; height: 100%; background: var(--hw-accent); transition: width ${duration.menuClose}ms linear; }
.upload__meter:not([data-known]) .upload__bar { width: 40%; animation: hw-indeterminate 1.1s ${easing.out} infinite; }
@keyframes hw-indeterminate { from { transform: translateX(-100%); } to { transform: translateX(250%); } }

.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.attachments--customer { justify-content: flex-end; }
.attachment--image img { width: 160px; max-height: 160px; object-fit: cover; border-radius: 12px; }
.attachment--file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  padding: 9px 12px;
  border-radius: 12px;
  background: var(--hw-inner);
  color: var(--hw-ink);
  text-decoration: none;
  font-size: 13px;
}
.attachment--file:hover { background: var(--hw-control); }
.attachment__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.attachment__size { flex: none; color: var(--hw-muted); font-size: 12px; }

/* ----------------------------------------------------------- home blocks */

.section--tight { padding-top: 4px; }
.rowlist--card { border-radius: 14px; background: var(--hw-inner); overflow: hidden; }
.row--link { text-decoration: none; color: inherit; }
.row__icon { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: var(--hw-accent-soft); color: var(--hw-accent); }
.row__icon svg { width: 16px; height: 16px; }
.homeCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: 16px;
  background: var(--hw-inner);
}
.homeCard__image { width: 100%; max-height: 180px; object-fit: cover; border-radius: 12px; }
.homeCard__title { margin: 0; font-weight: 700; font-size: 15px; letter-spacing: -.01em; }
.homeCard__body { font-size: 13.5px; color: var(--hw-ink2); }
.homeCard__body p { margin: 0 0 6px; }
.homeCard__cta { align-self: flex-start; text-decoration: none; }

/* ----------------------------------------------------------------- status */

.statusRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: 14px;
  background: var(--hw-inner);
  color: var(--hw-ink2);
  font-size: 13px;
  text-decoration: none;
}
a.statusRow:hover { background: var(--hw-control); }
.statusRow__text { flex: 1; min-width: 0; font-weight: 600; }
.statusRow__link { display: inline-flex; align-items: center; gap: 4px; color: var(--hw-muted); font-size: 12px; }
.statusRow__link svg { width: 12px; height: 12px; }
.statusRow__dot, .launcher__status {
  flex: none;
  width: 9px; height: 9px;
  border-radius: 999px;
  background: var(--hw-good);
}
.statusRow__dot[data-level='degraded'], .launcher__status[data-level='degraded'],
.statusRow__dot[data-level='maintenance'], .launcher__status[data-level='maintenance'] { background: var(--hw-warn); }
.statusRow__dot[data-level='partial_outage'], .launcher__status[data-level='partial_outage'],
.statusRow__dot[data-level='major_outage'], .launcher__status[data-level='major_outage'] { background: var(--hw-bad); }
.launcher__status {
  position: absolute;
  bottom: 2px;
  inset-inline-start: 2px;
  width: 12px; height: 12px;
  border: 2px solid var(--hw-ground);
}

/* ------------------------------------------------ changelog announcements */

.announce__close {
  position: absolute;
  top: 8px;
  inset-inline-end: 8px;
  width: 30px; height: 30px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--hw-muted);
}
.announce__close:hover { background: var(--hw-control); color: var(--hw-ink2); }
.announce__close svg { width: 16px; height: 16px; }
.announce__meta { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; }
.announce__new {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--hw-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.announce__title { margin: 0 0 4px; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
.announce__summary { margin: 0; font-size: 13px; color: var(--hw-ink2); }
.announce__read { margin-top: 10px; color: var(--hw-accent); font-weight: 650; font-size: 13px; }
.announce[data-leaving='true'] { opacity: 0; transition: opacity 160ms ${easing.out}; }

.announce--popup {
  position: absolute;
  bottom: 72px;
  inset-inline-end: 0;
  width: 300px;
  max-width: calc(100vw - 32px);
  padding: 16px 40px 16px 16px;
  border-radius: 18px;
  background: var(--hw-surface);
  box-shadow: var(--hw-shadow-float);
  animation: hw-bubble ${duration.message}ms ${easing.spring} both;
}
:host([data-position$='-left']) .announce--popup { inset-inline-end: auto; inset-inline-start: 0; }
:host([data-position^='top-']) .announce--popup { bottom: auto; top: 72px; }

.announce--modal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(12, 8, 24, .5);
  animation: hw-fade-in ${duration.menuOpen}ms ${easing.out} both;
}
.announce__dialog {
  position: relative;
  width: 440px;
  max-width: 100%;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 24px;
  border-radius: 22px;
  background: var(--hw-surface);
  color: var(--hw-ink);
  box-shadow: var(--hw-shadow-float);
}
.announce__cover { width: 100%; border-radius: 14px; margin-bottom: 14px; display: block; }
.announce__dialog .announce__title { font-size: 19px; }
.announce__actions { display: flex; gap: 8px; margin-top: 18px; }
.announce__actions .primary { width: auto; flex: 1; }

.announce--drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  right: 0;
  width: 360px;
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  background: var(--hw-surface);
  color: var(--hw-ink);
  box-shadow: var(--hw-shadow-float);
  animation: hw-drawer ${duration.menuOpen}ms ${easing.spring} both;
}
:host([data-position$='-left']) .announce--drawer { right: auto; left: 0; }
@keyframes hw-drawer { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.announce__head { position: relative; padding: 18px 48px 12px 18px; border-bottom: 1px solid var(--hw-hairline); }
.announce__heading { margin: 0; font-size: 17px; }
.announce__head .announce__close { top: 14px; }
.announce__list { flex: 1; overflow-y: auto; }
.announce__item {
  display: block;
  width: 100%;
  padding: 16px 18px;
  text-align: start;
  border-bottom: 1px solid var(--hw-hairline);
}
.announce__item:hover { background: var(--hw-inner); }
`;
}
