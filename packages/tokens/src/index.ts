export {
  WIDGET_MARK_MIN_SIZE,
  WORDMARK_BASELINE_RATIO,
  WORDMARK_CAP_RATIO,
  WORDMARK_MIN_WIDTH,
  widgetMark,
  wordmark,
} from './brand.js';
export {
  type AvatarColor,
  avatarColorFor,
  avatarPalette,
  brand,
  type ColorScale,
  dark,
  light,
} from './colors.js';
export { type CssVariablesOptions, cssVariables, cssVariablesFor } from './css.js';
export { duration, easing, scale, transition, travel } from './motion.js';
export { font, fontChoices, fontSize, radius, shadow } from './shape.js';
export { skeletonCss } from './skeleton.js';
export { tailwindPreset } from './tailwind.js';

/** Themes a surface can be set to. `system` follows the reader's OS setting. */
export type ThemeSetting = 'light' | 'dark' | 'system';
