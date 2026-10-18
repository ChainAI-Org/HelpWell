/**
 * The HelpWell marks, as inline SVG.
 *
 * They live in the tokens package because the widget, the help centre and the
 * dashboard all draw them and they must never drift apart. Nothing here is an
 * image file: the marks have to render offline, on any background, and in
 * whatever colour the surface is using.
 *
 * See design/GUIDE.md. The rules that matter:
 *   - the widget mark IS the launcher; it is never put inside another circle;
 *   - the eyes are the `e` counter at 36%, never rotated or rescaled alone;
 *   - a logo next to text uses the wordmark alone, with no mark beside it;
 *   - there is no GitHub logo anywhere.
 */

/** The `e` counter, reused for the eyes and for the cut in the `e` glyphs. */
const E_COUNTER = 'M 0 18 C 3 7 11 0 24 0 C 37 0 45 7 48 18 Z';

/**
 * Escape a value bound for an attribute. The colours come from settings an
 * admin typed, and the marks are put into the page with innerHTML, so a quote
 * in a colour must stay a quote and never end the attribute.
 */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The widget mark: the p-shaped bubble with two level eyes.
 *
 * Drawn without `<defs>`/`<use>` so the same mark can appear more than once in
 * one document without duplicate ids.
 *
 * The viewBox is the mark's own bounds: 104 wide, and 131 tall because the
 * curve at the tip of the tail dips to y ≈ 130.9 below the bubble's top. A
 * box 128 tall clipped the tip wherever the mark was drawn.
 */
export function widgetMark(color = '#7A3BEB', eyeColor = color, bodyColor = '#FFFFFF'): string {
  const fill = attr(color);
  const eyes = attr(eyeColor);
  const body = attr(bodyColor);
  return `<svg viewBox="24 11 104 131" width="100%" height="100%" role="img" aria-label="Open support">
  <g transform="translate(24 11)">
    <path d="M 28 0 H 76 C 94 0 104 11 104 29 V 75 C 104 94 93 104 76 104 H 29 L 7 128 Q 0 135 0 125 V 29 C 0 11 10 0 28 0 Z" fill="${fill}"/>
    <path d="M 39 26 H 65 Q 78 26 78 39 V 65 Q 78 78 65 78 H 39 Q 26 78 26 65 V 39 Q 26 26 39 26 Z" fill="${body}"/>
    <path d="${E_COUNTER}" fill="${eyes}" transform="translate(31.36 49) scale(.36)"/>
    <path d="${E_COUNTER}" fill="${eyes}" transform="translate(55.36 49) scale(.36)"/>
  </g>
</svg>`;
}

/**
 * The wordmark, in one colour.
 *
 * The viewBox is cropped to the glyph bounds (`24 24 776 171`) so the cap
 * height lines up with surrounding text and both baselines land together.
 * `overflow: visible` matters: without it the descender on the p is clipped.
 *
 * The two `e` glyphs need a mask, and a mask needs an id, so a caller drawing
 * the wordmark more than once in a document must pass a distinct `uid`.
 */
export function wordmark(color = 'currentColor', uid = 'hw'): string {
  const fill = attr(color);
  const id = attr(uid);
  const e =
    'M 52 36 C 83 36 104 58 104 88 V 94 Q 104 98 100 98 H 27 C 31 112 41 120 55 120 C 66 120 74 116 81 109 L 100 120 C 89 135 73 143 53 143 C 22 143 0 120 0 89 C 0 58 22 36 52 36 Z';
  const l = 'M 4 0 H 22 Q 26 0 26 4 V 136 Q 26 140 22 140 H 4 Q 0 140 0 136 V 4 Q 0 0 4 0 Z';
  return `<svg viewBox="24 24 776 171" role="img" aria-label="HelpWell" style="overflow:visible">
  <defs>
    <path id="${id}-e" d="${E_COUNTER}"/>
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="-2" y="-2" width="110" height="150">
      <rect x="-2" y="-2" width="110" height="150" fill="white"/>
      <use href="#${id}-e" transform="translate(28 59)" fill="black"/>
    </mask>
  </defs>
  <g transform="translate(24 24)" fill="${fill}">
    <path d="M 4 0 H 22 Q 26 0 26 4 V 55 H 76 V 4 Q 76 0 80 0 H 98 Q 102 0 102 4 V 136 Q 102 140 98 140 H 80 Q 76 140 76 136 V 80 H 26 V 136 Q 26 140 22 140 H 4 Q 0 140 0 136 V 4 Q 0 0 4 0 Z"/>
    <g transform="translate(116 0)"><g mask="url(#${id}-cut)"><path d="${e}"/></g></g>
    <g transform="translate(234 0)"><path d="${l}"/></g>
    <g transform="translate(276 36)"><path fill-rule="evenodd" d="M 28 0 H 76 C 94 0 104 11 104 29 V 75 C 104 94 93 104 76 104 H 29 L 7 128 Q 0 135 0 125 V 29 C 0 11 10 0 28 0 Z M 39 26 H 65 Q 78 26 78 39 V 65 Q 78 78 65 78 H 39 Q 26 78 26 65 V 39 Q 26 26 39 26 Z"/></g>
    <g transform="translate(393 0)"><path d="M 4 0 H 24 Q 28 0 29 4 L 54 94 L 80 4 Q 81 0 85 0 H 100 Q 104 0 105 4 L 131 94 L 156 4 Q 157 0 161 0 H 180 Q 185 0 183 5 L 145 136 Q 144 140 139 140 H 121 Q 117 140 116 136 L 92 53 L 68 136 Q 67 140 63 140 H 45 Q 41 140 40 136 L 1 5 Q -1 0 4 0 Z"/></g>
    <g transform="translate(590 0)"><g mask="url(#${id}-cut)"><path d="${e}"/></g></g>
    <g transform="translate(708 0)"><path d="${l}"/></g>
    <g transform="translate(750 0)"><path d="${l}"/></g>
  </g>
</svg>`;
}

/**
 * Ratios for sitting the wordmark on a line of text: set its height to
 * `fontSize * WORDMARK_CAP_RATIO` and pull it down by
 * `fontSize * WORDMARK_BASELINE_RATIO`.
 */
export const WORDMARK_CAP_RATIO = 0.892;
export const WORDMARK_BASELINE_RATIO = 0.162;

/** Minimum legible sizes, from the brand guide. */
export const WORDMARK_MIN_WIDTH = 160;
export const WIDGET_MARK_MIN_SIZE = 32;
