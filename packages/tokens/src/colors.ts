/**
 * Colour tokens, straight from design/GUIDE.md section 2.
 *
 * Light is the default. Dark is charcoal, never blue-tinted: the dark palette is
 * a separate set of values rather than an algorithmic inversion, because the
 * accent lightens (#7A3BEB -> #9B7BFF) while the surfaces deepen.
 */

export interface ColorScale {
  /** page background */
  ground: string;
  /** cards, panels, sidebar */
  surface: string;
  /** inner cards, sub-panels, table headers */
  inner: string;
  /** pill inputs, segmented tracks */
  control: string;
  ink: string;
  ink2: string;
  muted: string;
  hairline: string;
  /** the only border a top-level card gets */
  cardEdge: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentLine: string;
  deepViolet: string;
  good: string;
  goodBg: string;
  warn: string;
  warnBg: string;
  bad: string;
  badBg: string;
  info: string;
  infoBg: string;
  neutral: string;
  neutralBg: string;
  /** black pill used for a hero brand mark or a value tag */
  capsule: string;
  capsuleInk: string;
  /** under-card tints */
  underLavender: string;
  underLavenderInk: string;
  underPeach: string;
  underPeachInk: string;
  underButter: string;
  underButterInk: string;
  underMint: string;
  underMintInk: string;
}

export const light: ColorScale = {
  ground: '#F3F1F9',
  surface: '#FFFFFF',
  inner: '#F8F7FC',
  control: '#F6F5FA',
  ink: '#171425',
  ink2: '#4F4B60',
  muted: '#8A85A0',
  hairline: '#ECEAF3',
  cardEdge: 'rgba(23,20,37,.05)',
  accent: '#7A3BEB',
  accentHover: '#6A2FD6',
  accentSoft: '#F0EAFE',
  accentLine: '#D9CCFB',
  deepViolet: '#3B3486',
  good: '#177A52',
  goodBg: '#E3F6EE',
  warn: '#9A6206',
  warnBg: '#FDF2DD',
  bad: '#B23A2C',
  badBg: '#FDE7E4',
  info: '#2B5FBF',
  infoBg: '#E6EFFD',
  neutral: '#4F4B60',
  neutralBg: '#F0EEF6',
  capsule: '#171425',
  capsuleInk: '#FFFFFF',
  underLavender: '#E6E1F8',
  underLavenderInk: '#5B4EB8',
  underPeach: '#FBE3D6',
  underPeachInk: '#B65A2E',
  underButter: '#FBEFC7',
  underButterInk: '#9A6206',
  underMint: '#DDF3E8',
  underMintInk: '#177A52',
};

export const dark: ColorScale = {
  ground: '#0E0E10',
  surface: '#151517',
  inner: '#1B1B1E',
  control: '#1C1C1F',
  ink: '#EDEDF0',
  ink2: '#B4B4BC',
  muted: '#7E7E88',
  hairline: '#26262B',
  cardEdge: 'rgba(255,255,255,.06)',
  accent: '#9B7BFF',
  accentHover: '#AE93FF',
  accentSoft: '#251E3B',
  accentLine: '#4A3A78',
  deepViolet: '#C9B8FF',
  good: '#6FD3A5',
  goodBg: '#143126',
  warn: '#F0B95A',
  warnBg: '#33260F',
  bad: '#F09A8C',
  badBg: '#3A1A17',
  info: '#8DB4F5',
  infoBg: '#16243A',
  neutral: '#B4B4BC',
  neutralBg: '#232326',
  capsule: '#FFFFFF',
  capsuleInk: '#171425',
  underLavender: '#251E3B',
  underLavenderInk: '#C9B8FF',
  underPeach: '#3A2418',
  underPeachInk: '#F0B98C',
  underButter: '#332A10',
  underButterInk: '#F0CE72',
  underMint: '#143126',
  underMintInk: '#6FD3A5',
};

/** Avatar backgrounds. The admin uses slate; identified customers use violet. */
export const avatarPalette = {
  violet: '#7A3BEB',
  teal: '#0F9D7A',
  amber: '#D97706',
  pink: '#DB2777',
  blue: '#2563EB',
  slate: '#4F4B60',
} as const;

export type AvatarColor = keyof typeof avatarPalette;

/** Stable colour for a person, so the same contact keeps the same avatar. */
export function avatarColorFor(seed: string): AvatarColor {
  const keys = Object.keys(avatarPalette) as AvatarColor[];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return keys[hash % keys.length]!;
}

/** Brand constants from branding/README.md. Not theme-dependent. */
export const brand = {
  purple: '#7A3BEB',
  charcoal: '#34363B',
  /** minimum rendered width of the wordmark, in px */
  wordmarkMinWidth: 160,
  /** minimum rendered size of the widget mark, in px */
  markMinSize: 32,
} as const;
