/**
 * Motion tokens (PRD DS-09, non-functional "Motion").
 *
 * Nothing appears instantly. Every value here is deliberate and slower than a
 * default framework transition, because the product should feel drawn out.
 * Reduced motion collapses everything to a 120 ms fade with no travel.
 */

export const easing = {
  /** general purpose ease-out: pages, menus closing, cross-fades */
  out: 'cubic-bezier(.22,1,.36,1)',
  /** gentle spring with a soft overshoot: menus opening, banners, fan-outs */
  spring: 'cubic-bezier(.34,1.45,.64,1)',
  linear: 'linear',
} as const;

export const duration = {
  /** page fade + rise */
  page: 420,
  /** per-row stagger inside a page or list */
  stagger: 40,
  /** menu / popover open */
  menuOpen: 300,
  /** menu / popover close, always faster than the open */
  menuClose: 180,
  /** message or banner arriving */
  message: 380,
  /** chat bubble stagger */
  bubbleStagger: 60,
  /** confirmation pop */
  confirm: 320,
  /** composer growing a line */
  composerGrow: 220,
  /** composer settling after send */
  composerSettle: 260,
  /** stack fanning out on hover */
  fanOut: 420,
  /** stack collapsing back */
  fanIn: 260,
  /** field-level validation message */
  fieldError: 220,
  /** anything leaving: flat fade, no travel */
  leave: 180,
  /** skeleton -> content cross-fade */
  reveal: 400,
  /** one skeleton pulse */
  pulse: 1000,
  /** prefers-reduced-motion */
  reduced: 120,
} as const;

export const travel = {
  /** page fade + rise distance */
  page: 16,
  /** message / banner slide */
  message: 14,
  /** offline strip slide */
  strip: 10,
  /** field error rise */
  fieldError: 6,
  /** under-card lift on hover */
  cardLift: 6,
} as const;

export const scale = {
  menuFrom: 0.94,
  confirmPeak: 1.06,
  toastPeak: 1.04,
  pressed: 0.97,
} as const;

/** Ready-made CSS transition strings for the components that need them. */
export const transition = {
  page: `opacity ${duration.page}ms ${easing.out}, transform ${duration.page}ms ${easing.out}`,
  menuOpen: `transform ${duration.menuOpen}ms ${easing.spring}, opacity ${duration.menuOpen - 80}ms ${easing.out}`,
  menuClose: `transform ${duration.menuClose}ms ${easing.out}, opacity ${duration.menuClose}ms ${easing.out}`,
  message: `opacity ${duration.message}ms ${easing.out}, transform ${duration.message}ms ${easing.spring}`,
  leave: `opacity ${duration.leave}ms ${easing.linear}`,
  fieldError: `opacity ${duration.fieldError}ms ${easing.out}, transform ${duration.fieldError}ms ${easing.out}`,
} as const;
