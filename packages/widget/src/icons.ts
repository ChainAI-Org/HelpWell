/**
 * Inline SVG. Nothing here is an image file: the widget must draw correctly
 * offline, on any background, and in whatever colour Appearance is set to.
 *
 * The brand marks are redrawn without `<defs>`/`<use>` so the same mark can
 * appear more than once in one shadow tree without duplicate ids.
 */

const UI =
  'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

const icon = (body: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${UI} aria-hidden="true">${body}</svg>`;

export const icons = {
  home: icon('<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>'),
  message: icon(
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>',
  ),
  help: icon(
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.1-2.5 3.8"/><path d="M12 17.5h.01"/>',
  ),
  updates: icon(
    '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  ),
  roadmap: icon(
    '<path d="M4 19V5"/><path d="M4 6.5h9l-1.5 3L13 12.5H4"/><circle cx="4" cy="19" r="1.4"/>',
  ),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  close: icon('<path d="M6 6 18 18M18 6 6 18"/>'),
  back: icon('<path d="M15 5 8 12l7 7"/>'),
  chevron: icon('<path d="m9 5 7 7-7 7"/>'),
  send: icon('<path d="M4.5 12 20 4.5 14.5 20l-3-6.5-7-1.5Z"/>'),
  thumbUp: icon(
    '<path d="M7 21V10l4.5-7a2 2 0 0 1 2.8 2.3L13 10h5.3a2 2 0 0 1 2 2.4l-1.3 7A2 2 0 0 1 17 21H7Z"/><path d="M7 10H4v11h3"/>',
  ),
  thumbDown: icon(
    '<path d="M17 3v11l-4.5 7a2 2 0 0 1-2.8-2.3L11 14H5.7a2 2 0 0 1-2-2.4l1.3-7A2 2 0 0 1 7 3h10Z"/><path d="M17 14h3V3h-3"/>',
  ),
  copy: icon(
    '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5"/>',
  ),
  check: icon('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  alert: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>'),
  offline: icon(
    '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 3.2-2.1"/><path d="M15.8 10.9A10 10 0 0 1 19 13"/><path d="M2 9.5A15 15 0 0 1 7 6.4"/><path d="M17 6.4a15 15 0 0 1 5 3.1"/><path d="M12 20h.01"/>',
  ),
  article: icon('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>'),
  external: icon(
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 3 19.5v-12A1.5 1.5 0 0 1 4.5 6H10"/>',
  ),
  arrowUp: icon('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>'),
  arrowDown: icon('<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  inbox: icon(
    '<path d="M3.5 13h4l1.5 3h6l1.5-3h4"/><path d="M5.6 5h12.8l2.1 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-5Z"/>',
  ),
} as const;

export type IconName = keyof typeof icons;

/* ------------------------------------------------------------ brand marks */

// The marks live in @helpwell/tokens so the widget, the help centre and the
// dashboard cannot drift apart. Re-exported here because this is where every
// call site already looks for them.
export {
  WORDMARK_BASELINE_RATIO,
  WORDMARK_CAP_RATIO,
  widgetMark,
  wordmark,
} from '@helpwell/tokens';
