import { type ColorScale, dark, light } from './colors.js';
import { duration, easing, scale, travel } from './motion.js';
import { font, fontSize, radius, shadow } from './shape.js';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

type Declaration = [name: string, value: string];

function colorVars(scale: ColorScale, shadows: { card: string; float: string }): Declaration[] {
  const out: Declaration[] = Object.entries(scale).map(([k, v]) => [`--hw-${kebab(k)}`, v]);
  out.push(['--hw-shadow-card', shadows.card]);
  out.push(['--hw-shadow-float', shadows.float]);
  return out;
}

function staticVars(): Declaration[] {
  const out: Declaration[] = [];
  for (const [k, v] of Object.entries(radius)) out.push([`--hw-radius-${kebab(k)}`, `${v}px`]);
  for (const [k, v] of Object.entries(fontSize)) out.push([`--hw-text-${kebab(k)}`, `${v}px`]);
  for (const [k, v] of Object.entries(font)) out.push([`--hw-font-${kebab(k)}`, v]);
  for (const [k, v] of Object.entries(duration)) out.push([`--hw-duration-${kebab(k)}`, `${v}ms`]);
  for (const [k, v] of Object.entries(easing)) out.push([`--hw-ease-${kebab(k)}`, v]);
  for (const [k, v] of Object.entries(travel)) out.push([`--hw-travel-${kebab(k)}`, `${v}px`]);
  for (const [k, v] of Object.entries(scale)) out.push([`--hw-scale-${kebab(k)}`, String(v)]);
  out.push(['--hw-shadow-raised', shadow.raised]);
  out.push(['--hw-shadow-launcher', shadow.launcher]);
  return out;
}

export interface CssVariablesOptions {
  /**
   * Emit only these custom properties, by their full name (`--hw-surface`).
   * A surface that uses a couple of dozen tokens, such as the widget's shadow
   * root, need not carry the other hundred and forty.
   */
  only?: Iterable<string>;
}

function keep(declarations: Declaration[], options: CssVariablesOptions): Declaration[] {
  if (!options.only) return declarations;
  const wanted = new Set(options.only);
  return declarations.filter(([name]) => wanted.has(name));
}

function block(selector: string, declarations: Declaration[], indent = ''): string[] {
  return [
    `${indent}${selector} {`,
    ...declarations.map(([name, value]) => `${indent}  ${name}: ${value};`),
    `${indent}}`,
  ];
}

/**
 * Attach a condition to the root selector.
 *
 * A shadow root's host can only be matched through the `:host()` function:
 * `:host[data-hw-theme='dark']` is valid CSS that matches nothing, which is
 * how dark mode once failed silently inside the widget. Any other selector is
 * a plain element or class and takes the condition directly.
 */
function themed(selector: string, condition: string): string {
  return selector === ':host' ? `:host(${condition})` : `${selector}${condition}`;
}

const darkShadows = { card: shadow.cardDark, float: shadow.floatDark };
const lightShadows = { card: shadow.card, float: shadow.float };

/**
 * The whole token set as CSS custom properties.
 *
 * Dark mode is emitted twice on purpose: once behind `prefers-color-scheme` for
 * people who never touch a toggle, and once behind `[data-hw-theme="dark"]` so an
 * explicit choice wins in both directions.
 */
export function cssVariables(selector = ':root', options: CssVariablesOptions = {}): string {
  const lightVars = keep([...colorVars(light, lightShadows), ...staticVars()], options);
  const darkVars = keep(colorVars(dark, darkShadows), options);
  return [
    ...block(selector, lightVars),
    '',
    '@media (prefers-color-scheme: dark) {',
    ...block(themed(selector, ":not([data-hw-theme='light'])"), darkVars, '  '),
    '}',
    '',
    ...block(themed(selector, "[data-hw-theme='dark']"), darkVars),
  ].join('\n');
}

/** Variables for one theme only, for surfaces that pin a theme (e.g. an email). */
export function cssVariablesFor(
  theme: 'light' | 'dark',
  selector = ':root',
  options: CssVariablesOptions = {},
): string {
  const vars =
    theme === 'dark'
      ? [...colorVars(dark, darkShadows), ...staticVars()]
      : [...colorVars(light, lightShadows), ...staticVars()];
  return block(selector, keep(vars, options)).join('\n');
}
