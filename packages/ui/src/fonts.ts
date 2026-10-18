/**
 * The web fonts HelpWell's own surfaces are set in, self-hosted.
 *
 * Plus Jakarta Sans for the interface and body text, Bricolage Grotesque for
 * public display headings (design/GUIDE.md). Both come from the OFL-licensed
 * `@fontsource-variable` packages this package depends on and are served by
 * HelpWell itself, never from Google Fonts or another CDN: a help centre or
 * dashboard behind a strict Content-Security-Policy, or on a network with no
 * way out, still gets its own type, and no reader's address is handed to a
 * font host.
 *
 * Each family is split by Unicode range the way Google splits it, so a page
 * in English downloads the one latin file and nothing else. `font-display:
 * swap` shows the text in the fallback straight away rather than blank.
 *
 * This module is data and CSS only, so the widget's browser bundle can use
 * it. The bytes are read by `@helpwell/ui/fonts`, which is Node only.
 */

export type WebFontFamily = 'Plus Jakarta Sans' | 'Bricolage Grotesque';

export interface WebFontFile {
  /** The name it is served under, e.g. `plus-jakarta-sans-latin.woff2`. */
  name: string;
  family: WebFontFamily;
  style: 'normal' | 'italic';
  /** The package it ships in, and the file's name there. */
  source: { package: string; file: string };
  unicodeRange: string;
}

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const VIETNAMESE =
  'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB';
const CYRILLIC_EXT = 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F';

const SUBSETS: [subset: string, range: string][] = [
  ['latin', LATIN],
  ['latin-ext', LATIN_EXT],
  ['vietnamese', VIETNAMESE],
  ['cyrillic-ext', CYRILLIC_EXT],
];

const JAKARTA = '@fontsource-variable/plus-jakarta-sans';
const BRICOLAGE = '@fontsource-variable/bricolage-grotesque';

/**
 * Every file HelpWell serves. Plus Jakarta Sans in both styles, since body
 * text has emphasis in it; Bricolage Grotesque upright only, because it is a
 * headline face and has no italic. Bricolage has no cyrillic-ext subset.
 */
export const WEB_FONT_FILES: readonly WebFontFile[] = [
  ...(['normal', 'italic'] as const).flatMap((style) =>
    SUBSETS.map(([subset, unicodeRange]) => ({
      name: `plus-jakarta-sans-${subset}${style === 'italic' ? '-italic' : ''}.woff2`,
      family: 'Plus Jakarta Sans' as const,
      style,
      source: { package: JAKARTA, file: `plus-jakarta-sans-${subset}-wght-${style}.woff2` },
      unicodeRange,
    })),
  ),
  ...SUBSETS.filter(([subset]) => subset !== 'cyrillic-ext').map(([subset, unicodeRange]) => ({
    name: `bricolage-grotesque-${subset}.woff2`,
    family: 'Bricolage Grotesque' as const,
    style: 'normal' as const,
    source: { package: BRICOLAGE, file: `bricolage-grotesque-${subset}-wght-normal.woff2` },
    unicodeRange,
  })),
];

export interface FontFaceOptions {
  /** Only these families. Default: both. */
  families?: readonly WebFontFamily[];
  /**
   * Declare the faces under a family name of their own, e.g. `HelpWell` gives
   * "HelpWell Plus Jakarta Sans". For a surface on someone else's page, where
   * a face named plainly would restyle the page's own text that asks for it.
   */
  prefix?: string;
}

/**
 * Where the fonts are served from, if it is safe inside a CSS `url()`: a
 * path or an http(s) URL, with nothing that could close the string or the
 * rule. Anything else is refused, and the faces are left out.
 */
function safeBase(base: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (
    !/^(?:https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)?(?:\/[A-Za-z0-9._~%!$&*+,;=:@-]*)*$/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

/** The files a face list covers. */
export function webFontFiles(options: FontFaceOptions = {}): WebFontFile[] {
  const families = options.families ?? ['Plus Jakarta Sans', 'Bricolage Grotesque'];
  return WEB_FONT_FILES.filter((file) => families.includes(file.family));
}

/** The family name a face is declared under. */
export function webFontFamily(family: WebFontFamily, prefix?: string): string {
  const clean = (prefix ?? '').replace(/[^A-Za-z0-9 -]/g, '').trim();
  return clean ? `${clean} ${family}` : family;
}

/**
 * `@font-face` rules for the self-hosted fonts, served from `base` (e.g.
 * `/help/_fonts`). Empty when `base` is not a plain path or URL.
 */
export function fontFaceCss(base: string, options: FontFaceOptions = {}): string {
  const root = safeBase(base);
  if (root === null) return '';
  return webFontFiles(options)
    .map(
      (file) => `@font-face {
  font-family: ${JSON.stringify(webFontFamily(file.family, options.prefix))};
  font-style: ${file.style};
  font-weight: 200 800;
  font-display: swap;
  src: url(${JSON.stringify(`${root}/${file.name}`)}) format('woff2');
  unicode-range: ${file.unicodeRange};
}`,
    )
    .join('\n');
}
