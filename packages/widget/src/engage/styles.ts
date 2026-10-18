/**
 * Styles for the engage layer.
 *
 * Separate from the widget's stylesheet because this shadow root covers the
 * whole page rather than sitting in a corner of it. Block content (callouts,
 * steps, video) uses the same rules as articles, from `@helpwell/ui`.
 */

import { cssVariables, duration, easing, scale, travel } from '@helpwell/tokens';
import { markdownBlockStyles } from '@helpwell/ui';

/** The tokens this layer refers to; nothing else goes into its shadow root. */
const ENGAGE_TOKENS = [
  '--hw-accent',
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
  '--hw-hairline',
  '--hw-good',
  '--hw-good-bg',
  '--hw-warn',
  '--hw-warn-bg',
  '--hw-bad',
  '--hw-bad-bg',
  '--hw-info',
  '--hw-info-bg',
  '--hw-shadow-float',
];

export const ENGAGE_CSS = `
${cssVariables(':host', { only: ENGAGE_TOKENS })}

:host {
  --hw-engage-accent: var(--hw-accent);
  font-family: "Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--hw-ink);
}

*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; }
textarea { font: inherit; color: inherit; border: 0; background: none; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--hw-engage-accent); outline-offset: 2px; border-radius: 6px; }

/* The layer itself never intercepts clicks; each surface opts back in. */
.layer { position: fixed; inset: 0; z-index: 2147482000; pointer-events: none; }
.layer > * { pointer-events: auto; }

.is-leaving {
  opacity: 0 !important;
  transition: opacity ${duration.leave}ms linear !important;
}

.engage-primary {
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--hw-engage-accent);
  color: #fff;
  font-weight: 650;
  transition: background ${duration.menuClose}ms ${easing.out},
              transform ${duration.menuClose}ms ${easing.out};
}
.engage-primary:hover { background: color-mix(in srgb, var(--hw-engage-accent) 85%, #000); }
.engage-primary:active { transform: scale(${scale.pressed}); }
.engage-primary[disabled] { opacity: .55; cursor: not-allowed; }

.engage-ghost {
  padding: 10px 14px;
  border-radius: 12px;
  color: var(--hw-ink2);
  font-weight: 600;
  transition: background ${duration.menuClose}ms ${easing.out};
}
.engage-ghost:hover { background: var(--hw-control); }
.engage-ghost[disabled] { opacity: .55; cursor: not-allowed; }

.engage-close {
  position: absolute;
  top: 12px;
  inset-inline-end: 12px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 28px; height: 28px;
  border-radius: 999px;
  color: var(--hw-muted);
  background: color-mix(in srgb, var(--hw-surface) 70%, transparent);
  transition: background ${duration.menuClose}ms ${easing.out};
}
.engage-close:hover { background: var(--hw-control); color: var(--hw-ink); }
.engage-close svg { width: 16px; height: 16px; }

/* ---------------------------------------------------------------- blocks */

.eg-blocks { display: grid; gap: 12px; min-width: 0; }
.eg-text { color: var(--hw-ink2); overflow-wrap: anywhere; }
.eg-text > :first-child { margin-top: 0; }
.eg-text > :last-child { margin-bottom: 0; }
.eg-text h1, .eg-text h2, .eg-text h3, .eg-text h4 {
  margin: 0 0 6px; color: var(--hw-ink); letter-spacing: -.015em; line-height: 1.25;
}
.eg-text h1, .eg-text h2 { font-size: 20px; }
.eg-text h3, .eg-text h4 { font-size: 16px; }
.eg-text p, .eg-text ul, .eg-text ol { margin: 0 0 8px; }
.eg-text ul, .eg-text ol { padding-inline-start: 20px; }
.eg-text a { color: var(--hw-engage-accent); font-weight: 600; }
/* The Markdown renderer anchors headings for articles; a message has no sections to link to. */
.eg-text .hc-anchor { display: none; }
.eg-text code { font-size: .92em; padding: 1px 5px; border-radius: 6px; background: var(--hw-control); }
.eg-text img { max-width: 100%; border-radius: 12px; }
${markdownBlockStyles('.eg-text')}

.eg-image { margin: 0; }
.eg-image__img { display: block; width: 100%; height: auto; border-radius: 12px; }
.eg-image--compact .eg-image__img { width: auto; max-height: 40px; border-radius: 8px; }
.eg-gif-play {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; min-height: 120px;
  border-radius: 12px;
  background: var(--hw-control);
  color: var(--hw-ink2);
  font-weight: 650;
}
.eg-divider { border: 0; border-top: 1px solid var(--hw-hairline); margin: 2px 0; width: 100%; }
.eg-buttons { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.eg-video-file { margin: 0; }
.eg-video-file video { display: block; width: 100%; border-radius: 12px; background: #000; }
.eg-watch {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255,255,255,.18);
  font-weight: 650;
  font-size: 13px;
}

/* The widget's click-to-load player (media.ts), styled for this layer. */
.hw-video { margin: 0; }
.hw-video__play {
  position: relative;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--hw-deep-violet), #171425);
  color: #fff;
  text-align: center;
  padding: 16px;
}
.hw-video__icon {
  display: grid; place-items: center;
  width: 52px; height: 52px;
  border-radius: 999px;
  background: rgba(255,255,255,.18);
  transition: transform ${duration.menuClose}ms ${easing.out};
}
.hw-video__play:hover .hw-video__icon { transform: scale(1.06); }
.hw-video__label { font-weight: 650; }
.hw-video__via { font-size: 12px; opacity: .75; }
.hw-video__frame { position: relative; aspect-ratio: 16 / 9; }
.hw-video__frame iframe {
  position: absolute; inset: 0; width: 100%; height: 100%;
  border: 0; border-radius: 12px; background: #000;
}

.lightbox {
  position: fixed; inset: 0; z-index: 3;
  display: grid; place-items: center;
  padding: 24px;
  background: rgba(23, 20, 37, .72);
}
.lightbox__img { max-width: 100%; max-height: 100%; border-radius: 12px; }
.lightbox--video .hw-video { width: min(880px, 100%); }
.lightbox__close {
  position: absolute; top: 16px; inset-inline-end: 16px;
  display: grid; place-items: center;
  width: 36px; height: 36px;
  border-radius: 999px;
  background: rgba(255,255,255,.16);
  color: #fff;
}
.lightbox__close svg { width: 18px; height: 18px; }

/* ---------------------------------------------------------------- modal */

.scrim {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(23, 20, 37, .42);
  backdrop-filter: blur(2px);
  animation: hw-scrim ${duration.menuOpen}ms ${easing.out} both;
}
@keyframes hw-scrim { from { opacity: 0; } to { opacity: 1; } }

.modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(480px, 100%);
  max-height: calc(100vh - 40px);
  overflow: hidden;
  border-radius: 20px;
  background: var(--hw-surface);
  box-shadow: var(--hw-shadow-float);
  animation: hw-modal ${duration.menuOpen}ms ${easing.spring} both;
}
.modal--small { width: min(360px, 100%); }
.modal--large { width: min(720px, 100%); }
.modal--full { width: 100%; height: 100%; max-height: none; border-radius: 16px; }
@keyframes hw-modal {
  from { opacity: 0; transform: translateY(${travel.page}px) scale(${scale.menuFrom}); }
  to { opacity: 1; transform: none; }
}
.modal__viewport { position: relative; flex: 1; min-height: 0; overflow-y: auto; touch-action: pan-y; }
.modal__slide { display: flex; flex-direction: column; min-height: 100%; }
.modal__content { padding: 24px 24px 20px; }
.modal__slide--plain .modal__content { padding-top: 26px; padding-inline-end: 48px; }
.modal__media .eg-image__img,
.modal__media .hw-video__play,
.modal__media .hw-video__frame iframe,
.modal__media .eg-video-file video { border-radius: 0; }
.modal__slide--side { flex-direction: row; }
.modal__slide--side .modal__media { flex: 0 0 44%; display: flex; }
.modal__slide--side .modal__media > * { width: 100%; }
.modal__slide--side .modal__media .eg-image__img { height: 100%; object-fit: cover; }
.modal__slide--side .modal__content { flex: 1; align-self: center; }
.modal__slide--background { position: relative; justify-content: flex-end; min-height: 320px; }
.modal__slide--background .modal__media { position: absolute; inset: 0; }
.modal__slide--background .modal__media > *,
.modal__slide--background .modal__media .eg-image__img { width: 100%; height: 100%; object-fit: cover; }
.modal__slide--background .modal__content {
  position: relative;
  background: linear-gradient(to top, rgba(23,20,37,.86), rgba(23,20,37,.25) 70%, transparent);
  padding-top: 64px;
}
.modal__slide--background .eg-text,
.modal__slide--background .eg-text h1,
.modal__slide--background .eg-text h2,
.modal__slide--background .eg-text h3 { color: #fff; }
.modal__nav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 0 20px 18px;
}
.modal__nav > :first-child { justify-self: start; }
.modal__nav > :last-child { justify-self: end; }
.modal__dots { display: flex; gap: 6px; }
.modal__dot {
  width: 8px; height: 8px;
  border-radius: 999px;
  background: var(--hw-accent-line);
  transition: width ${duration.menuClose}ms ${easing.out}, background ${duration.menuClose}ms ${easing.out};
}
.modal__dot[aria-current="true"] { width: 20px; background: var(--hw-engage-accent); }
.modal__bar {
  width: 96px; height: 4px;
  border-radius: 999px;
  background: var(--hw-accent-line);
  overflow: hidden;
}
.modal__fill {
  display: block; height: 100%;
  border-radius: inherit;
  background: var(--hw-engage-accent);
  transition: width ${duration.page}ms ${easing.out};
}
.modal__count { font-size: 12.5px; font-weight: 650; color: var(--hw-muted); font-variant-numeric: tabular-nums; }

/* --------------------------------------------------------------- banner */

.banner {
  --banner-bg: var(--hw-engage-accent);
  --banner-ink: #fff;
  position: fixed;
  inset-inline: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: var(--banner-bg);
  color: var(--banner-ink);
  box-shadow: 0 6px 20px -8px rgba(23,20,37,.4);
  animation: hw-banner-top ${duration.message}ms ${easing.spring} both;
}
.banner--top { top: 0; }
.banner--bottom { bottom: 0; animation-name: hw-banner-bottom; }
.banner--floating {
  inset-inline: 12px;
  border-radius: 14px;
  max-width: 960px;
  margin-inline: auto;
}
.banner--floating.banner--top { top: 12px; }
.banner--floating.banner--bottom { bottom: 12px; }
.banner--neutral { --banner-bg: var(--hw-surface); --banner-ink: var(--hw-ink); border-bottom: 1px solid var(--hw-hairline); }
.banner--warning { --banner-bg: var(--hw-warn-bg); --banner-ink: var(--hw-warn); }
@keyframes hw-banner-top { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: none; } }
@keyframes hw-banner-bottom { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: none; } }
.banner .eg-blocks {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-size: 13.5px;
}
.banner .eg-text, .banner .eg-text a { color: inherit; }
.banner .eg-text p { margin: 0; }
.banner .eg-buttons { justify-content: flex-start; }
.banner .engage-primary, .banner .engage-ghost { padding: 7px 14px; border-radius: 999px; font-size: 13px; }
.banner .engage-primary { background: rgba(255,255,255,.2); color: inherit; }
.banner .engage-primary:hover { background: rgba(255,255,255,.3); }
.banner--neutral .engage-primary, .banner--warning .engage-primary { background: var(--hw-engage-accent); color: #fff; }
.banner .engage-ghost { color: inherit; }
.banner__close {
  display: grid; place-items: center;
  flex: none;
  width: 26px; height: 26px;
  border-radius: 999px;
  transition: background ${duration.menuClose}ms ${easing.out};
}
.banner__close:hover { background: rgba(127,127,127,.2); }
.banner__close svg { width: 15px; height: 15px; }
/* Not sticky: moved with the page (banner.ts sets the shift as it scrolls). */
.banner--scrolls { translate: 0 var(--banner-shift, 0px); }
.banner__countdown { display: inline-flex; align-items: baseline; gap: 5px; font-variant-numeric: tabular-nums; }
.banner__unit { display: inline-flex; align-items: baseline; gap: 1px; padding: 2px 7px; border-radius: 8px; background: rgba(255,255,255,.18); font-size: 12px; font-weight: 600; }
.banner__unit b { font-size: 13.5px; font-weight: 700; }
.banner--neutral .banner__unit, .banner--warning .banner__unit { background: var(--hw-inner); }

/* -------------------------------------------------------------- hotspot */

.hotspot {
  position: absolute;
  width: 14px; height: 14px;
  border-radius: 999px;
  background: var(--hw-engage-accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--hw-engage-accent) 60%, transparent);
  animation: hw-pulse 2.2s ${easing.out} infinite;
}
.hotspot--dot { animation: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--hw-engage-accent) 25%, transparent); }
.hotspot--question {
  width: 20px; height: 20px;
  display: grid; place-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: 750;
  line-height: 1;
  animation: none;
  box-shadow: 0 2px 8px -2px rgba(23,20,37,.45);
}
@keyframes hw-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--hw-engage-accent) 55%, transparent); }
  70% { box-shadow: 0 0 0 11px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.hotspot__bubble {
  position: absolute;
  width: min(300px, calc(100vw - 32px));
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--hw-surface);
  box-shadow: var(--hw-shadow-float);
  animation: hw-pop ${duration.menuOpen}ms ${easing.spring} both;
}
.hotspot__bubble .eg-blocks { padding-inline-end: 22px; font-size: 13.5px; }
.hotspot__bubble .engage-close { top: 8px; inset-inline-end: 8px; }
@keyframes hw-pop {
  from { opacity: 0; transform: translateY(-6px) scale(${scale.menuFrom}); }
  to { opacity: 1; transform: none; }
}

/* ----------------------------------------------------------------- tour */

.spotlight {
  position: absolute;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(23, 20, 37, .55);
  pointer-events: none;
  transition: all ${duration.page}ms ${easing.out};
  animation: hw-scrim ${duration.menuOpen}ms ${easing.out} both;
}
.tourPop {
  position: absolute;
  width: min(320px, calc(100vw - 24px));
  padding: 16px 18px 14px;
  border-radius: 16px;
  background: var(--hw-surface);
  box-shadow: var(--hw-shadow-float);
  transition: top ${duration.page}ms ${easing.out}, left ${duration.page}ms ${easing.out};
  animation: hw-pop ${duration.menuOpen}ms ${easing.spring} both;
}
.tourPop[data-side="center"] { width: min(420px, calc(100vw - 24px)); }
.tourPop .eg-blocks { padding-inline-end: 22px; font-size: 13.5px; margin: 4px 0 12px; }
.tourPop__count {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--hw-muted);
}
.tourPop__hint { margin: -4px 0 10px; font-size: 12.5px; color: var(--hw-muted); }
.tourPop__actions { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
.tourPop__skip {
  margin-inline-end: auto;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hw-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* --------------------------------------------------------------- survey */

.surveyWrap {
  position: fixed;
  bottom: 96px;
  inset-inline-end: 20px;
  width: min(380px, calc(100vw - 32px));
}
.survey {
  position: relative;
  overflow: hidden;
  padding: 20px 20px 16px;
  border-radius: 18px;
  background: var(--hw-surface);
  box-shadow: var(--hw-shadow-float);
  animation: hw-surveyIn ${duration.message}ms ${easing.spring} both;
}
.survey--center { width: min(460px, 100%); }
.surveyWrap--bar { inset-inline: 0; bottom: 0; width: auto; }
.survey--bar { border-radius: 18px 18px 0 0; max-width: 720px; margin-inline: auto; padding: 18px 24px 14px; }
.survey--light { --hw-engage-accent: var(--hw-ink); --hw-accent-soft: var(--hw-control); --hw-accent-line: var(--hw-hairline); --hw-deep-violet: var(--hw-ink); }
.survey--light .engage-primary:hover { background: var(--hw-ink2); }
.survey--dark {
  --hw-surface: #1c1a26;
  --hw-control: #2a2736;
  --hw-ink: #f4f2fa;
  --hw-ink2: #d9d5e6;
  --hw-muted: #a39db5;
  --hw-hairline: #3a3648;
  --hw-accent-soft: color-mix(in srgb, var(--hw-engage-accent) 28%, #1c1a26);
  --hw-accent-line: #4a4560;
  --hw-deep-violet: #f4f2fa;
  color: var(--hw-ink);
}
@keyframes hw-surveyIn {
  from { opacity: 0; transform: translateY(${travel.message}px); }
  to { opacity: 1; transform: none; }
}
.survey__progress { position: absolute; top: 0; inset-inline: 0; height: 3px; background: var(--hw-accent-soft); }
.survey__progress i {
  display: block; height: 100%; width: 0;
  background: var(--hw-engage-accent);
  transition: width ${duration.page}ms ${easing.out};
}
.survey__body > .eg-blocks { margin-bottom: 12px; padding-inline-end: 26px; }
.survey__q { margin: 0 0 14px; font-size: 15px; font-weight: 650; padding-inline-end: 26px; }
.survey__scale { display: flex; gap: 4px; }
.survey__score {
  flex: 1;
  min-width: 0;
  padding: 9px 0;
  border-radius: 9px;
  background: var(--hw-control);
  font-size: 12.5px;
  font-weight: 650;
  transition: background ${duration.menuClose}ms ${easing.out},
              color ${duration.menuClose}ms ${easing.out},
              transform ${duration.menuClose}ms ${easing.out};
}
.survey__score:hover {
  background: var(--hw-engage-accent);
  color: #fff;
  transform: translateY(-2px);
}
.survey__score[disabled], .survey__choice[disabled], .survey__star[disabled] { opacity: .55; cursor: not-allowed; }
.survey__stars { display: flex; gap: 4px; }
.survey__star { color: var(--hw-accent-line); transition: color ${duration.menuClose}ms ${easing.out}, transform ${duration.menuClose}ms ${easing.out}; }
.survey__stars:hover .survey__star { color: var(--hw-engage-accent); }
.survey__star:hover ~ .survey__star { color: var(--hw-accent-line); }
.survey__star:hover { transform: scale(1.08); }
.survey__legend {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--hw-muted);
}
.survey__choices { display: grid; gap: 6px; }
.survey__choice {
  padding: 11px 14px;
  border-radius: 12px;
  background: var(--hw-control);
  text-align: start;
  font-weight: 600;
  font-size: 13.5px;
  transition: background ${duration.menuClose}ms ${easing.out};
}
.survey__choice:hover { background: var(--hw-accent-soft); }
.survey__choice[aria-pressed="true"] { background: var(--hw-accent-soft); color: var(--hw-deep-violet); box-shadow: inset 0 0 0 1.5px var(--hw-engage-accent); }
.survey__comment {
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--hw-control);
  outline: none;
  resize: none;
  border: 1px solid transparent;
  transition: border-color ${duration.menuClose}ms ${easing.out};
}
.survey__comment:focus { border-color: var(--hw-accent-line); background: var(--hw-surface); }
.survey__actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.survey__thanks { margin: 0; color: var(--hw-ink2); padding-inline-end: 26px; }
.survey__error { margin: 6px 0 0; font-size: 12.5px; font-weight: 600; color: var(--hw-bad); }
.survey__error:empty { display: none; }

@media (max-width: 480px) {
  .surveyWrap { inset-inline: 16px; width: auto; bottom: 88px; }
  .surveyWrap--bar { inset-inline: 0; bottom: 0; }
  .modal__slide--side { flex-direction: column; }
  .modal__slide--side .modal__media { flex: none; }
  .banner { padding: 9px 12px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: ${duration.reduced}ms !important;
    transition-duration: ${duration.reduced}ms !important;
  }
  .hotspot { animation: none !important; }
}
`;
