import { light } from './colors.js';
import { duration, easing } from './motion.js';
import { font, fontSize, radius, shadow } from './shape.js';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function buildTailwindPreset() {
  return {
    theme: {
      extend: {
        colors: Object.fromEntries(
          Object.keys(light).map((k) => [kebab(k), `var(--hw-${kebab(k)})`]),
        ),
        borderRadius: Object.fromEntries(Object.entries(radius).map(([k, v]) => [k, `${v}px`])),
        fontSize: Object.fromEntries(Object.entries(fontSize).map(([k, v]) => [k, `${v}px`])),
        fontFamily: { ui: font.ui, display: font.display, mono: font.mono },
        boxShadow: { card: shadow.card, float: shadow.float, raised: shadow.raised },
        transitionTimingFunction: { out: easing.out, spring: easing.spring },
        transitionDuration: Object.fromEntries(
          Object.entries(duration).map(([k, v]) => [k, `${v}ms`]),
        ),
      },
    },
  };
}

/**
 * Tailwind preset built from the same tokens, so a customer styling their own
 * blocks gets the identical palette. Colours point at the CSS variables rather
 * than literals, which is what makes dark mode work without a second preset.
 *
 * Built through a call marked pure so a bundler that only wants the marks or
 * the variables (the widget) can drop it: a bare `Object.fromEntries` at the
 * top level would otherwise be kept as a possible side effect.
 */
export const tailwindPreset = /* @__PURE__ */ buildTailwindPreset();
