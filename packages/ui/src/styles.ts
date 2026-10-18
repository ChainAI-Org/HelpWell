/**
 * The stylesheet the help centre and the dashboard share.
 *
 * Both inline one string of CSS into every page. The reset, the motion rules,
 * the empty state and the accessibility helpers were the same seventy lines
 * in each; now they are written once and each surface adds its own on top.
 *
 * Also the two checks a stylesheet needs before an admin-written value goes
 * into it. Settings are trusted more than a visitor is, but `<style>` is not
 * the place to find out that a colour field held a `</style><script>`.
 */

import { duration, travel } from '@helpwell/tokens';

export const MONO_STACK = '"JetBrains Mono", ui-monospace, Consolas, monospace';

const HEX_COLOUR = /^#[0-9a-fA-F]{3,8}$/;

/** A hex colour from settings, or the fallback when it is anything else. */
export function safeCssColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return HEX_COLOUR.test(trimmed) ? trimmed : fallback;
}

/**
 * A font family name with anything that could close a string, a rule or a
 * tag removed. The result is safe to place inside a quoted CSS string.
 */
export function safeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = [...value.replace(/[<>"'\\;{}()]/g, '')]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  return cleaned || fallback;
}

/**
 * Rules both surfaces start from. `prefix` is the class prefix of the surface
 * (`hc` or `db`), so `.hc-empty` and `.db-empty` come out of the same source.
 */
export function baseStyles(prefix: string): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
img { max-width: 100%; height: auto; }
button, input, select, textarea { font: inherit; color: inherit; }
button { border: 0; background: none; cursor: pointer; padding: 0; }
:focus-visible { outline: 2px solid var(--hw-accent); outline-offset: 2px; border-radius: 8px; }

/* First in the tab order, and invisible until it has focus. */
.${prefix}-skip {
  position: absolute;
  left: -9999px;
  top: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--hw-surface);
  box-shadow: var(--hw-shadow-card);
  z-index: 10;
}
.${prefix}-skip:focus { left: 8px; }

/* Off screen, still read out. */
.${prefix}-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* The Markdown renderer wraps every table so a wide one scrolls inside itself. */
.hc-tablewrap { overflow-x: auto; margin: 0 0 16px; }

.${prefix}-empty { padding: 64px 24px; text-align: center; color: var(--hw-muted); }
.${prefix}-empty svg { width: 34px; height: 34px; opacity: .45; margin-bottom: 8px; }
.${prefix}-empty h2 { margin: 0 0 6px; font-size: 17px; color: var(--hw-ink2); }
.${prefix}-empty p { margin: 0 0 18px; font-size: 13.5px; }

@keyframes ${prefix}-rise {
  from { opacity: 0; transform: translateY(${travel.page}px); }
  to { opacity: 1; transform: none; }
}
@keyframes ${prefix}-fade { from { opacity: 0; } to { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: ${duration.reduced}ms !important;
    transition-duration: ${duration.reduced}ms !important;
  }
  .${prefix}-rise { animation-name: ${prefix}-fade; }
}
`;
}
