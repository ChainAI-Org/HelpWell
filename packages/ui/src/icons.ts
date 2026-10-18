/**
 * Icons for the server-rendered surfaces.
 *
 * Inline SVG strings rather than files: nothing to load, nothing to fail, and
 * they take their colour from whatever they are placed in. One stroke weight
 * and one grid throughout, so a row of them reads as a set.
 */

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // navigation
  conversations:
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>',
  contacts:
    '<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6"/><path d="M18 14.9c2 .7 3.4 2.4 3.4 5.1"/>',
  knowledge:
    '<path d="M4 5.5A2 2 0 0 1 6 3.5h5V19H6a2 2 0 0 0-2 2Z"/><path d="M20 5.5a2 2 0 0 0-2-2h-5V19h5a2 2 0 0 1 2 2Z"/>',
  gaps: '<path d="M12 3.5 21 19H3Z"/><path d="M12 10v4"/><path d="M12 16.6h.01"/>',
  changelog: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>',
  roadmap:
    '<path d="M4 19V5"/><path d="M4 6.5h9l-1.5 3L13 12.5H4"/><circle cx="4" cy="19" r="1.4"/>',
  engage: '<path d="m3 11 18-7-7 18-2.5-8.5Z"/>',
  reports: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  evals: '<path d="M9 11.5 11.5 14 16 8.5"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z"/>',
  connections:
    '<path d="M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-2.6 2.6a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  appearance:
    '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1.1" fill="currentColor" stroke="none"/><path d="M12 21a3 3 0 0 0 0-6 3 3 0 0 1 0-6"/>',
  agent:
    '<rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 3.5V7"/><circle cx="9" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.1" fill="currentColor" stroke="none"/>',

  // actions and states
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
  offline:
    '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 3.2-2.1"/><path d="M15.8 10.9A10 10 0 0 1 19 13"/><path d="M12 20h.01"/>',
  thumbUp:
    '<path d="M7 21V10l4.5-7a2 2 0 0 1 2.8 2.3L13 10h5.3a2 2 0 0 1 2 2.4l-1.3 7A2 2 0 0 1 17 21H7Z"/><path d="M7 10H4v11h3"/>',
  thumbDown:
    '<path d="M17 3v11l-4.5 7a2 2 0 0 1-2.8-2.3L11 14H5.7a2 2 0 0 1-2-2.4l1.3-7A2 2 0 0 1 7 3h10Z"/><path d="M17 14h3V3h-3"/>',
  arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 3 19.5v-12A1.5 1.5 0 0 1 4.5 6H10"/>',
  article: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9"/><path d="m7.5 13 4.5-4.5L16.5 13"/><path d="M5 4h14"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-4.7L4 8"/><path d="M4 5v3h3"/><path d="M4 13a8 8 0 0 0 14 4.7L20 16"/><path d="M20 19v-3h-3"/>',
  play: '<path d="M7 4.5 19 12 7 19.5Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.3 2"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.6"/>',
  message:
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>',
  inbox:
    '<path d="M3.5 13h4l1.5 3h6l1.5-3h4"/><path d="M5.6 5h12.8l2.1 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-5Z"/>',
  sparkle: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.8L12 18l-1.7-5.5L4.8 10.7 10.3 9 12 3.5Z"/>',
  filter: '<path d="M3 5.5h18"/><path d="M6.5 12h11"/><path d="M10 18.5h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  spend:
    '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2A2.8 2.8 0 0 0 12 8c-1.6 0-2.6.8-2.6 2s1 1.8 2.6 2 2.6.8 2.6 2-1 2-2.6 2a2.8 2.8 0 0 1-2.5-1.2"/><path d="M12 6.2v1.8M12 16v1.8"/>',

  // collection icons, named the way Lucide names them so a docs author can
  // copy one out of the Lucide index and have it work (KB-23)
  'book-open':
    '<path d="M12 6.5V21"/><path d="M12 6.5C10.5 4.8 8.4 4 5.5 4H3v14h2.5c2.9 0 5 .8 6.5 2.5"/><path d="M12 6.5C13.5 4.8 15.6 4 18.5 4H21v14h-2.5c-2.9 0-5 .8-6.5 2.5"/>',
  // Upright, with fins and a flame. The diagonal Lucide rocket loses its nose
  // at 20px and starts reading as a fish.
  rocket:
    '<path d="M12 2.5c2.7 2.2 4 5.2 4 8.4v4H8v-4c0-3.2 1.3-6.2 4-8.4Z"/><path d="M8 11.4 5 14v3.6l3-1.9"/><path d="M16 11.4 19 14v3.6l-3-1.9"/><circle cx="12" cy="9" r="1.5"/><path d="m10.6 18.4 1.4 3.1 1.4-3.1"/>',
  'credit-card':
    '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h3"/>',
  shield:
    '<path d="M12 3 20 6v5.5c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6Z"/><path d="m9 12 2 2 4-4"/>',
  users:
    '<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6"/><path d="M18 14.9c2 .7 3.4 2.4 3.4 5.1"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  folder:
    '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.5h7.8A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>',
  wrench:
    '<path d="M15.5 3.5a5.5 5.5 0 0 0-5 7.7L3.8 18a2 2 0 0 0 2.8 2.8l6.8-6.7a5.5 5.5 0 0 0 6.8-7.3l-3 3-2.6-.7-.7-2.6 3-3a5.5 5.5 0 0 0-1.4-.2Z"/>',
  puzzle:
    '<path d="M9.5 3.5a2 2 0 0 1 4 0V5h3a1.5 1.5 0 0 1 1.5 1.5v3h1.5a2 2 0 0 1 0 4H18v3a1.5 1.5 0 0 1-1.5 1.5h-3V16a2 2 0 0 0-4 0v2H6.5A1.5 1.5 0 0 1 5 16.5v-3H3.5a2 2 0 0 1 0-4H5v-3A1.5 1.5 0 0 1 6.5 5h3Z"/>',
  // the reader's light and dark switch
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName | string, size = 18): string {
  // An own-property check, not a lookup: `constructor` or `__proto__` would
  // otherwise find something on Object.prototype and draw it inside the SVG.
  if (!hasIcon(name)) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${STROKE} aria-hidden="true">${PATHS[name]}</svg>`;
}

/**
 * An icon, or a stand-in when the name is one we do not ship.
 *
 * Collection icons come out of a _meta.json a docs author wrote, so the name
 * is whatever they typed. A missing icon should leave a tidy card rather than
 * a hole where one was.
 */
export function iconOr(name: string | null | undefined, fallback: IconName, size = 18): string {
  return icon(name && hasIcon(name) ? name : fallback, size);
}

export function hasIcon(name: string): name is IconName {
  return Object.hasOwn(PATHS, name);
}
