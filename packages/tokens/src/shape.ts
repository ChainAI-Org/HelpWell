/** Radius, depth and type tokens (GUIDE section 2, "Shape, depth, type"). */

export const radius = {
  card: 20,
  inner: 14,
  menu: 18,
  control: 12,
  pill: 999,
  panel: 24,
  bubble: 18,
  /** the tail corner of a message bubble */
  bubbleTail: 4,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(23,20,37,.04), 0 16px 40px -20px rgba(23,20,37,.18)',
  cardDark: '0 20px 50px -20px rgba(0,0,0,.6)',
  float: '0 24px 60px -16px rgba(23,20,37,.28)',
  floatDark: '0 24px 60px -16px rgba(0,0,0,.7)',
  raised: '0 4px 14px rgba(23,20,37,.12), 0 0 0 1px rgba(23,20,37,.04)',
  launcher: 'drop-shadow(0 10px 22px rgba(122,59,235,.35))',
} as const;

export const font = {
  ui: '"Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif',
  display: '"Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
} as const;

/** The type scale, in px. Names match how the guide talks about them. */
export const fontSize = {
  tag: 10.5,
  label: 11,
  caption: 12,
  control: 13,
  body: 14,
  bodyLg: 15,
  article: 17,
  h4: 18,
  h3: 20,
  h2: 24,
  h1: 32,
  hero: 44,
} as const;

/** Fonts the Appearance screen offers (WG-08). The first is the default. */
export const fontChoices = ['Plus Jakarta Sans', 'Inter', 'Geist', 'DM Sans', 'Manrope'] as const;
