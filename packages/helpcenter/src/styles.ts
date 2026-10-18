/**
 * The help centre stylesheet.
 *
 * Inlined into every page rather than served as a file. It is about 9KB, which
 * is smaller than the round trip it would otherwise cost, and it means a page
 * is never briefly unstyled (HC-01: pages load instantly).
 *
 * The theme values come from settings. They are checked here, at the point
 * they become CSS, because an accent field is a text box and a stylesheet has
 * no way to escape what is typed into one.
 *
 * The type is self-hosted: the faces are declared against the help centre's
 * own `_fonts/` route (see @helpwell/ui's fonts), and a browser only fetches
 * a file when a page actually uses that face and script.
 */

import { cssVariables, duration, easing, travel } from '@helpwell/tokens';
import {
  baseStyles,
  fontFaceCss,
  MONO_STACK,
  markdownBlockStyles,
  safeCssColor,
  safeFontFamily,
} from '@helpwell/ui';

export interface HelpCenterStyleOptions {
  accent: string;
  font: string;
  radius: number;
  /** Headings. Falls back to the body font. */
  headlineFont?: string;
  /** Ground colour for the light scheme. Anything but a hex colour keeps the default. */
  background?: string;
  /** Where the self-hosted fonts are served, e.g. "/help/_fonts". Null or absent: none declared. */
  fontsPath?: string | null;
}

const DEFAULT_ACCENT = '#7A3BEB';
const DEFAULT_FONT = 'Plus Jakarta Sans';

export function helpCenterStyles(options: HelpCenterStyleOptions): string {
  const accent = safeCssColor(options.accent, DEFAULT_ACCENT);
  const font = safeFontFamily(options.font, DEFAULT_FONT);
  const headlineFont = safeFontFamily(options.headlineFont, font);
  const background = safeCssColor(options.background, '');
  const radius = Number.isFinite(options.radius) ? Math.max(0, Math.round(options.radius)) : 24;

  return `
${options.fontsPath != null ? fontFaceCss(options.fontsPath) : ''}
${cssVariables(':root')}

:root {
  --hw-accent: ${accent};
  --hc-radius: ${radius}px;
  --hc-font: ${JSON.stringify(font)}, "Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif;
  --hc-headline-font: ${JSON.stringify(headlineFont)}, var(--hc-font);
  --hc-measure: 720px;
  color-scheme: light dark;
}
${background ? groundOverride(background) : ''}
${baseStyles('hc')}

body {
  margin: 0;
  background: var(--hw-ground);
  color: var(--hw-ink);
  font-family: var(--hc-font);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--hw-accent); }

.hc-hero h1, .hc-article h1, .hc-entry h2, .hc-card h2,
.hc-body h1, .hc-body h2, .hc-body h3, .hc-body h4 { font-family: var(--hc-headline-font); }

.hc-shell { max-width: 1080px; margin: 0 auto; padding: 0 20px 72px; }
.hc-narrow { max-width: var(--hc-measure); margin: 0 auto; }

/* --------------------------------------------------------------- header */

.hc-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: color-mix(in srgb, var(--hw-ground) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--hw-hairline);
}
.hc-header__inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.hc-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -.01em;
  color: var(--hw-ink);
  text-decoration: none;
}
.hc-brand img { height: 24px; width: auto; display: block; }
.hc-brand .hc-logo--dark { display: none; }
:root[data-hw-theme='dark'] .hc-brand .hc-logo--dark { display: block; }
:root[data-hw-theme='dark'] .hc-brand .hc-logo--light { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-hw-theme='light']) .hc-brand .hc-logo--dark { display: block; }
  :root:not([data-hw-theme='light']) .hc-brand .hc-logo--light { display: none; }
}
.hc-nav { margin-inline-start: auto; display: flex; gap: 4px; }
.hc-nav a {
  padding: 7px 12px;
  border-radius: 10px;
  color: var(--hw-ink2);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  transition: background ${duration.menuClose}ms ${easing.out}, color ${duration.menuClose}ms ${easing.out};
}
.hc-nav a:hover { background: var(--hw-control); color: var(--hw-ink); }
.hc-nav a[aria-current='page'] { background: var(--hw-accent-soft); color: var(--hw-deep-violet); }
.hc-nav a { white-space: nowrap; }
/* On a phone the links get a row of their own under the name and the theme switch. */
@media (max-width: 640px) {
  .hc-header__inner { flex-wrap: wrap; gap: 8px 12px; padding: 12px 16px; }
  .hc-theme { margin-inline-start: auto; }
  .hc-nav { order: 3; flex-basis: 100%; min-width: 0; margin-inline-start: 0; overflow-x: auto; scrollbar-width: none; }
  .hc-nav a { padding: 6px 10px; }
}

/* The reader's light and dark switch: a moon in light, a sun in dark. */
.hc-theme {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  color: var(--hw-ink2);
  transition: background ${duration.menuClose}ms ${easing.out}, color ${duration.menuClose}ms ${easing.out};
}
.hc-theme[hidden] { display: none; }
.hc-theme:hover { background: var(--hw-control); color: var(--hw-ink); }
.hc-theme span { display: inline-flex; }
.hc-theme__light { display: none !important; }
:root[data-hw-theme='dark'] .hc-theme__light { display: inline-flex !important; }
:root[data-hw-theme='dark'] .hc-theme__dark { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-hw-theme='light']) .hc-theme__light { display: inline-flex !important; }
  :root:not([data-hw-theme='light']) .hc-theme__dark { display: none; }
}

/* ------------------------------------------------------- agent and ask */

/* The HelpWell mark stands on its own: never set inside a circle. */
.hc-avatar { display: inline-block; flex: none; }
img.hc-avatar { border-radius: 999px; object-fit: cover; }
.hc-avatar--mark svg { display: block; width: 100%; height: 100%; }

.hc-ask {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px 7px 10px;
  border-radius: 999px;
  border: 1px solid var(--hw-hairline);
  background: var(--hw-surface);
  color: var(--hw-ink);
  font-weight: 640;
  font-size: 14px;
  transition: border-color ${duration.menuClose}ms ${easing.out}, background ${duration.menuClose}ms ${easing.out};
}
.hc-ask[hidden] { display: none; }
.hc-ask:hover { border-color: var(--hw-accent-line); background: var(--hw-accent-soft); }
.hc-hero .hc-ask { margin-top: 16px; }
.hc-still {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 18px;
  color: var(--hw-muted);
  font-size: 14px;
}
.hc-still[hidden] { display: none; }

/* ----------------------------------------------------------------- hero */

.hc-hero { padding: 56px 0 40px; text-align: center; }
.hc-hero h1 {
  margin: 0 0 10px;
  font-size: clamp(28px, 5vw, 40px);
  letter-spacing: -.025em;
  line-height: 1.15;
}
.hc-hero p { margin: 0 auto 26px; max-width: 540px; color: var(--hw-ink2); font-size: 17px; }

/* Settings, Help centre, Hero: a soft accent glow, flat, or a solid brand block. */
/* The glow fades out before the hero's edges, so it never shows a seam. */
.hc-hero--glow {
  background: radial-gradient(ellipse 50% 240px at 50% 0%, color-mix(in srgb, var(--hw-accent) 16%, transparent), transparent);
}
.hc-hero--brand {
  margin-top: 24px;
  padding: 52px 24px 44px;
  border-radius: var(--hc-radius);
  background: linear-gradient(135deg, var(--hw-accent), color-mix(in srgb, var(--hw-accent) 62%, #140a33));
  color: #FFFFFF;
}
.hc-hero--brand h1 { color: #FFFFFF; }
.hc-hero--brand p { color: rgba(255,255,255,.86); }
.hc-hero--brand .hc-search { border-color: transparent; box-shadow: 0 12px 30px -12px rgba(10,6,30,.45); }
.hc-hero--brand .hc-search input { color: var(--hw-ink); }
.hc-hero--brand .hc-ask { border-color: rgba(255,255,255,.35); background: rgba(255,255,255,.12); color: #FFFFFF; }
.hc-hero--brand .hc-ask:hover { background: rgba(255,255,255,.2); border-color: rgba(255,255,255,.55); }
/* On the brand block the mark is reversed, white on the accent, as on any accent ground. */
.hc-hero--brand .hc-avatar--mark path { fill: #FFFFFF; }
.hc-hero--brand .hc-avatar--mark path:nth-child(2) { fill: var(--hw-accent); }

.hc-search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 520px;
  margin: 0 auto;
  padding: 13px 16px;
  border-radius: 14px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-hairline);
  box-shadow: var(--hw-shadow-card);
  transition: border-color ${duration.menuClose}ms ${easing.out};
}
.hc-search:focus-within { border-color: var(--hw-accent-line); }
.hc-search input { flex: 1; border: 0; outline: none; background: none; font-size: 15px; }
.hc-search input::placeholder { color: var(--hw-muted); }
.hc-search svg { width: 18px; height: 18px; color: var(--hw-muted); flex: none; }

/* ---------------------------------------------------------------- cards */

.hc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.hc-card {
  display: block;
  padding: 22px;
  border-radius: var(--hc-radius);
  background: var(--hw-surface);
  border: 1px solid var(--hw-card-edge);
  text-decoration: none;
  color: inherit;
  transition: transform ${duration.menuOpen}ms ${easing.out},
              box-shadow ${duration.menuOpen}ms ${easing.out},
              border-color ${duration.menuOpen}ms ${easing.out};
}
.hc-card:hover {
  transform: translateY(-${travel.cardLift}px);
  box-shadow: var(--hw-shadow-card);
  border-color: var(--hw-accent-line);
}
/*
 * The tint comes from the collection's _meta.json, and the rotation in
 * readKnowledgeBase() guarantees two neighbours never draw the same one.
 */
.hc-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-bottom: 14px;
  border-radius: 12px;
  background: var(--hw-under-lavender);
  color: var(--hw-under-lavender-ink);
}
.hc-card[data-tint='peach'] .hc-card__icon { background: var(--hw-under-peach); color: var(--hw-under-peach-ink); }
.hc-card[data-tint='butter'] .hc-card__icon { background: var(--hw-under-butter); color: var(--hw-under-butter-ink); }
.hc-card[data-tint='mint'] .hc-card__icon { background: var(--hw-under-mint); color: var(--hw-under-mint-ink); }

.hc-card h2 { margin: 0 0 6px; font-size: 17px; letter-spacing: -.01em; }
.hc-card p { margin: 0; color: var(--hw-ink2); font-size: 14.5px; }
.hc-card__count { display: block; margin-top: 12px; font-size: 13px; color: var(--hw-muted); }

/*
 * The under card: ONE element, the tint, with the white card nested inside
 * and pulled 10px wider each side, so the tint shows only as a strip beneath
 * it carrying the count and the freshness (design/GUIDE.md). It cannot come
 * apart at any card height, because it is not two layers.
 */
.hc-ucard {
  display: flex;
  flex-direction: column;
  padding: 0 10px 5px;
  border-radius: var(--hc-radius);
  background: var(--hw-under-lavender);
  color: var(--hw-under-lavender-ink);
  text-decoration: none;
  transition: transform ${duration.menuOpen}ms ${easing.out};
}
.hc-ucard[data-tint='peach'] { background: var(--hw-under-peach); color: var(--hw-under-peach-ink); }
.hc-ucard[data-tint='butter'] { background: var(--hw-under-butter); color: var(--hw-under-butter-ink); }
.hc-ucard[data-tint='mint'] { background: var(--hw-under-mint); color: var(--hw-under-mint-ink); }
.hc-ucard > .hc-card { margin: 0 -10px; flex: 1; color: var(--hw-ink); }
.hc-ucard:hover { transform: translateY(-${travel.cardLift}px); }
.hc-ucard:hover > .hc-card { transform: none; box-shadow: var(--hw-shadow-card); border-color: var(--hw-accent-line); }
.hc-ucard .hc-card__icon { background: var(--hw-under-lavender); color: var(--hw-under-lavender-ink); }
.hc-ucard[data-tint='peach'] .hc-card__icon { background: var(--hw-under-peach); color: var(--hw-under-peach-ink); }
.hc-ucard[data-tint='butter'] .hc-card__icon { background: var(--hw-under-butter); color: var(--hw-under-butter-ink); }
.hc-ucard[data-tint='mint'] .hc-card__icon { background: var(--hw-under-mint); color: var(--hw-under-mint-ink); }
.hc-umeta {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 5px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
}

.hc-section { padding: 34px 0; }
.hc-section > h2 {
  margin: 0 0 16px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--hw-muted);
}

.hc-list { list-style: none; margin: 0; padding: 0; }
.hc-list li + li { border-top: 1px solid var(--hw-hairline); }
.hc-list a {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px 4px;
  text-decoration: none;
  color: inherit;
  transition: padding-inline-start ${duration.menuClose}ms ${easing.out};
}
.hc-list a:hover { padding-inline-start: 10px; }
.hc-list__main { flex: 1; min-width: 0; }
.hc-list__title { margin: 0; font-size: 15.5px; font-weight: 620; }
.hc-list__sub { margin: 2px 0 0; font-size: 13.5px; color: var(--hw-muted); }
.hc-list__meta { flex: none; font-size: 13px; color: var(--hw-muted); }

/* -------------------------------------------------------------- article */

.hc-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  padding: 26px 0 4px;
  font-size: 13.5px;
  color: var(--hw-muted);
}
.hc-breadcrumb a { color: var(--hw-muted); text-decoration: none; }
.hc-breadcrumb a:hover { color: var(--hw-ink2); }

.hc-article { padding-bottom: 40px; }
.hc-article h1 {
  margin: 8px 0 10px;
  font-size: clamp(26px, 4vw, 34px);
  letter-spacing: -.022em;
  line-height: 1.2;
}
.hc-article__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 0 0 28px;
  color: var(--hw-muted);
  font-size: 13.5px;
}
.hc-body { font-size: 16.5px; line-height: 1.72; color: var(--hw-ink2); }
.hc-body > :first-child { margin-top: 0; }
.hc-body h1, .hc-body h2, .hc-body h3, .hc-body h4 {
  color: var(--hw-ink);
  letter-spacing: -.012em;
  scroll-margin-top: 80px;
  position: relative;
}
.hc-body h1 { font-size: 26px; margin: 36px 0 10px; }
.hc-body h2 { font-size: 21px; margin: 34px 0 10px; }
.hc-body h3 { font-size: 17.5px; margin: 26px 0 8px; }
.hc-body h4 { font-size: 16px; margin: 22px 0 6px; }
.hc-body p { margin: 0 0 16px; }
.hc-body ul, .hc-body ol { margin: 0 0 16px; padding-inline-start: 24px; }
.hc-body li { margin-bottom: 7px; }
.hc-body img { border-radius: 14px; border: 1px solid var(--hw-hairline); }
.hc-body code {
  font-family: ${MONO_STACK};
  font-size: .88em;
  background: var(--hw-control);
  padding: 2px 6px;
  border-radius: 6px;
}
.hc-body pre {
  background: var(--hw-inner);
  border: 1px solid var(--hw-hairline);
  padding: 16px 18px;
  border-radius: 14px;
  overflow-x: auto;
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.6;
}
.hc-body pre code { background: none; padding: 0; font-size: inherit; }
.hc-body blockquote {
  margin: 0 0 16px;
  padding: 2px 0 2px 16px;
  border-inline-start: 3px solid var(--hw-accent-line);
  color: var(--hw-muted);
}
.hc-body table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
.hc-body th, .hc-body td { padding: 10px 12px; text-align: start; border-bottom: 1px solid var(--hw-hairline); }
.hc-body th { background: var(--hw-inner); font-weight: 650; color: var(--hw-ink); }

/* The anchor only appears on hover, so it never competes with the heading. */
.hc-anchor {
  position: absolute;
  inset-inline-start: -0.75em;
  text-decoration: none;
  color: var(--hw-accent-line);
  opacity: 0;
  transition: opacity ${duration.menuClose}ms ${easing.out};
}
.hc-body h1:hover .hc-anchor,
.hc-body h2:hover .hc-anchor,
.hc-body h3:hover .hc-anchor,
.hc-body h4:hover .hc-anchor,
.hc-anchor:focus { opacity: 1; }
.hc-body img, .hc-body video { max-width: 100%; height: auto; }

/* Callouts, steps, tabs, accordions and video: the renderer's blocks. */
${markdownBlockStyles('.hc-body')}

/* ------------------------------------------------------------ sidebar */

.hc-layout { display: grid; grid-template-columns: 1fr; gap: 40px; }
@media (min-width: 1000px) {
  .hc-layout { grid-template-columns: minmax(0, 1fr) 220px; align-items: start; }
}
.hc-toc { position: sticky; top: 84px; display: none; }
@media (min-width: 1000px) { .hc-toc { display: block; } }
.hc-toc h2 {
  margin: 0 0 10px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--hw-muted);
}
.hc-toc ol { list-style: none; margin: 0; padding: 0; font-size: 13.5px; }
.hc-toc li { margin-bottom: 7px; }
.hc-toc a { color: var(--hw-ink2); text-decoration: none; }
.hc-toc a:hover { color: var(--hw-accent); }
.hc-toc li[data-depth='3'] { padding-inline-start: 12px; }
.hc-toc li[data-depth='4'] { padding-inline-start: 24px; }

/* -------------------------------------------------------------- rating */

/*
 * Related reading sits on a surface like the rating block above it. Without
 * one, a single related article is a line of text floating on the page
 * background with nothing to say it is a list.
 */
.hc-related {
  margin-top: 28px;
  padding: 18px 22px 8px;
  border-radius: var(--hc-radius);
  background: var(--hw-surface);
  border: 1px solid var(--hw-card-edge);
}
.hc-related > h2 { margin-top: 0; }

.hc-rate {
  margin-top: 40px;
  padding: 22px;
  border-radius: var(--hc-radius);
  background: var(--hw-surface);
  border: 1px solid var(--hw-card-edge);
  text-align: center;
}
.hc-rate p { margin: 0 0 14px; font-weight: 650; color: var(--hw-ink); }
.hc-rate__buttons { display: flex; gap: 10px; justify-content: center; }
.hc-rate button {
  padding: 9px 22px;
  border-radius: 999px;
  border: 1px solid var(--hw-hairline);
  font-weight: 640;
  font-size: 14px;
  transition: border-color ${duration.menuClose}ms ${easing.out},
              background ${duration.menuClose}ms ${easing.out};
}
.hc-rate button:hover { border-color: var(--hw-accent); background: var(--hw-accent-soft); }
.hc-rate button[aria-pressed='true'] {
  border-color: var(--hw-accent);
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
}
/* Shown once a reader says the article did not help. */
.hc-rate .hc-rate__contact { margin: 14px 0 0; font-weight: 500; color: var(--hw-muted); }
.hc-rate__contact a { color: var(--hw-ink2); font-weight: 640; text-underline-offset: 2px; }
.hc-rate__contact a:hover { color: var(--hw-accent); }

/* ------------------------------------------------------------ changelog */

.hc-entry { padding: 30px 0; border-bottom: 1px solid var(--hw-hairline); }
/* Grouped by date: a month heading over its entries. */
.hc-month {
  margin: 34px 0 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--hw-muted);
}
.hc-month + .hc-entry { padding-top: 14px; }
.hc-entry__top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.hc-tag {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  font-size: 12px;
  font-weight: 700;
}
.hc-chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--hw-control);
  color: var(--hw-ink2);
  font-size: 12px;
  font-weight: 620;
}
.hc-entry__date { font-size: 13px; color: var(--hw-muted); }
.hc-entry h2 { margin: 0 0 8px; font-size: 21px; letter-spacing: -.015em; }
.hc-entry h2 a { color: inherit; text-decoration: none; }
.hc-entry h2 a:hover { color: var(--hw-accent); }

.hc-more {
  display: block;
  width: 100%;
  margin-top: 26px;
  padding: 14px;
  border-radius: 12px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-hairline);
  color: var(--hw-accent);
  font-weight: 650;
  text-align: center;
  text-decoration: none;
}
.hc-more:hover { border-color: var(--hw-accent-line); }

/* -------------------------------------------------------------- roadmap */

.hc-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
.hc-lane__head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.hc-lane__dot { width: 9px; height: 9px; border-radius: 999px; }
.hc-lane__name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--hw-ink2);
}
.hc-lane__count { font-size: 12.5px; color: var(--hw-muted); }
.hc-idea {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 15px;
  border-radius: 14px;
  background: var(--hw-surface);
  border: 1px solid var(--hw-card-edge);
  margin-bottom: 10px;
}
.hc-idea h3 { margin: 0; font-size: 14.5px; font-weight: 640; }
.hc-idea p { margin: 4px 0 0; font-size: 13px; color: var(--hw-muted); }
.hc-votes {
  flex: none;
  display: grid;
  justify-items: center;
  min-width: 46px;
  padding: 7px 9px;
  border-radius: 12px;
  border: 1px solid var(--hw-hairline);
  font-size: 12.5px;
  font-weight: 700;
}
.hc-votes span { font-size: 10px; color: var(--hw-muted); font-weight: 600; }

/* --------------------------------------------------------------- footer */

.hc-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 6px 22px;
  border-top: 1px solid var(--hw-hairline);
  padding: 26px 20px 40px;
  text-align: center;
  color: var(--hw-muted);
  font-size: 13.5px;
}
.hc-footer a { color: inherit; text-decoration: none; }
.hc-footer a:hover { color: var(--hw-ink2); }
.hc-footer .hc-footer__contact { text-decoration: underline; text-underline-offset: 2px; }
/* Credit line: cap height matched to the text, both baselines together. */
.hc-credit svg {
  height: calc(13.5px * 0.892);
  width: auto;
  vertical-align: baseline;
  margin-bottom: calc(-13.5px * 0.162);
  overflow: visible;
}

/* --------------------------------------------------------------- motion */

.hc-rise { animation: hc-rise ${duration.page}ms ${easing.out} both; }

@media (prefers-reduced-motion: reduce) {
  .hc-list a:hover { padding-inline-start: 4px; }
  .hc-card:hover { transform: none; }
}
`;
}

/** The theme's ground colour applies to the light scheme only; dark keeps the charcoal set. */
function groundOverride(colour: string): string {
  return `
@media (prefers-color-scheme: light) {
  :root:not([data-hw-theme='dark']) { --hw-ground: ${colour}; }
}
:root[data-hw-theme='light'] { --hw-ground: ${colour}; }
`;
}
