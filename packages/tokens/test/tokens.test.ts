import { describe, expect, it } from 'vitest';
import {
  avatarColorFor,
  brand,
  cssVariables,
  cssVariablesFor,
  dark,
  duration,
  light,
  skeletonCss,
  tailwindPreset,
  widgetMark,
  wordmark,
} from '../src/index.js';

describe('colours', () => {
  it('uses the brand purple as the light accent', () => {
    expect(light.accent).toBe(brand.purple);
  });

  it('keeps dark mode charcoal, never blue-tinted', () => {
    // A blue-tinted charcoal would have a blue channel clearly above the others.
    for (const hex of [dark.ground, dark.surface, dark.inner, dark.control]) {
      const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(b! - r!).toBeLessThanOrEqual(4);
    }
  });

  it('lightens the accent in dark mode so it stays legible', () => {
    expect(dark.accent).not.toBe(light.accent);
    const lum = (hex: string) =>
      Number.parseInt(hex.slice(1, 3), 16) + Number.parseInt(hex.slice(5, 7), 16);
    expect(lum(dark.accent)).toBeGreaterThan(lum(light.accent));
  });

  it('defines every light token in dark too', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('gives the same person the same avatar colour every time', () => {
    expect(avatarColorFor('jane@northwindstudio.co')).toBe(
      avatarColorFor('jane@northwindstudio.co'),
    );
  });
});

describe('css variables', () => {
  const css = cssVariables();

  it('emits light values on the bare selector', () => {
    expect(css).toContain('--hw-ground: #F3F1F9;');
  });

  it('emits dark twice: once for the OS setting, once for an explicit choice', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain("[data-hw-theme='dark']");
    expect(css.match(/--hw-ground: #0E0E10;/g)).toHaveLength(2);
  });

  it('lets an explicit light choice win over the OS setting', () => {
    expect(css).toContain(":root:not([data-hw-theme='light'])");
  });

  it('ships motion as variables so components never hard-code timings', () => {
    expect(css).toContain(`--hw-duration-page: ${duration.page}ms;`);
    expect(css).toContain('--hw-ease-spring: cubic-bezier(.34,1.45,.64,1);');
  });

  it('can pin a single theme for surfaces that do not follow the reader', () => {
    const pinned = cssVariablesFor('dark');
    expect(pinned).toContain('--hw-ground: #0E0E10;');
    expect(pinned).not.toContain('prefers-color-scheme');
  });

  it('matches a shadow host through :host(), the only form a shadow tree honours', () => {
    const shadow = cssVariables(':host');
    expect(shadow).toContain(":host(:not([data-hw-theme='light'])) {");
    expect(shadow).toContain(":host([data-hw-theme='dark']) {");
    // The broken forms: valid CSS that matches nothing.
    expect(shadow).not.toContain(':host:not(');
    expect(shadow).not.toContain(':host[');
  });

  it('can emit only the tokens a surface uses', () => {
    const few = cssVariables(':host', { only: ['--hw-surface', '--hw-ink', '--hw-radius-card'] });
    expect(few).toContain('--hw-surface: #FFFFFF;');
    expect(few).toContain('--hw-surface: #151517;');
    expect(few).toContain('--hw-radius-card: 20px;');
    expect(few).not.toContain('--hw-ground');
    expect(few).not.toContain('--hw-duration');
    expect(few.match(/--hw-[a-z0-9-]+:/g)).toHaveLength(3 + 2 + 2);
    expect(cssVariablesFor('light', ':root', { only: ['--hw-ink'] })).toBe(
      ':root {\n  --hw-ink: #171425;\n}',
    );
  });
});

describe('brand marks', () => {
  it('escapes a colour that tries to end the attribute', () => {
    const hostile = '"><script>alert(1)</script>';
    for (const svg of [widgetMark(hostile), widgetMark('#fff', hostile), wordmark(hostile)]) {
      expect(svg).not.toContain('<script');
      expect(svg).toContain('&quot;&gt;&lt;script&gt;');
    }
    expect(wordmark('currentColor', 'a"b')).not.toContain('id="a"b-e"');
  });

  it('still draws a normal colour untouched', () => {
    expect(widgetMark('#123456')).toContain('fill="#123456"');
    expect(wordmark('currentColor', 'hw-credit')).toContain('id="hw-credit-cut"');
  });

  it('frames the whole widget mark, the tip of the tail included', () => {
    const svg = widgetMark();
    const [x, y, width, height] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);
    const [dx, dy] = (/translate\(([\d.]+) ([\d.]+)\)/.exec(svg) ?? []).slice(1).map(Number);
    const outline = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
    const bounds = pathBounds(outline);

    // Measured, not assumed: the tail's curve dips below its own end points.
    expect(bounds.maxY).toBeGreaterThan(128);
    expect(bounds.minX + dx!).toBeGreaterThanOrEqual(x!);
    expect(bounds.minY + dy!).toBeGreaterThanOrEqual(y!);
    expect(bounds.maxX + dx!).toBeLessThanOrEqual(x! + width!);
    expect(bounds.maxY + dy!).toBeLessThanOrEqual(y! + height!);
    // And tightly: no more than a unit of empty space under the tail.
    expect(y! + height! - (bounds.maxY + dy!)).toBeLessThan(1);
  });
});

/**
 * The extent of a path made of absolute M, L, H, V, C, Q and Z commands, with
 * curves sampled finely enough to find where they bulge past their points.
 */
function pathBounds(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const tokens = d.match(/[A-Za-z]|-?[\d.]+/g) ?? [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (px: number, py: number) => {
    bounds.minX = Math.min(bounds.minX, px);
    bounds.minY = Math.min(bounds.minY, py);
    bounds.maxX = Math.max(bounds.maxX, px);
    bounds.maxY = Math.max(bounds.maxY, py);
  };
  let at = 0;
  const num = () => Number(tokens[at++]);
  let px = 0;
  let py = 0;
  while (at < tokens.length) {
    const command = tokens[at++];
    if (command === 'M' || command === 'L') {
      px = num();
      py = num();
    } else if (command === 'H') px = num();
    else if (command === 'V') py = num();
    else if (command === 'Q' || command === 'C') {
      const points = [[px, py]];
      for (let k = 0; k < (command === 'Q' ? 2 : 3); k++) points.push([num(), num()]);
      for (let step = 0; step <= 1000; step++) {
        const t = step / 1000;
        let level = points;
        while (level.length > 1) {
          level = level
            .slice(1)
            .map((p, k) => [
              level[k]![0]! + (p[0]! - level[k]![0]!) * t,
              level[k]![1]! + (p[1]! - level[k]![1]!) * t,
            ]);
        }
        add(level[0]![0]!, level[0]![1]!);
      }
      [px, py] = points[points.length - 1] as [number, number];
    }
    add(px, py);
  }
  return bounds;
}

describe('skeleton', () => {
  it('declares its properties on the selector the surface asks for', () => {
    expect(skeletonCss()).toMatch(/^:root \{/);
    expect(skeletonCss(':host')).toMatch(/^:host \{/);
    expect(skeletonCss(':host')).not.toContain(':root');
    expect(skeletonCss(':host')).toContain('.t-skel-skeleton.is-pulsing > *');
  });
});

describe('tailwind preset', () => {
  it('points colours at the variables so dark mode needs no second preset', () => {
    expect(tailwindPreset.theme.extend.colors['accent-soft']).toBe('var(--hw-accent-soft)');
  });
});
