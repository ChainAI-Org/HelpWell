/**
 * The stylesheet is a string built from settings, so two things are checked
 * here: that nothing from settings can break out of it, and that every token
 * the widget refers to is actually declared in the shadow root it runs in.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGAGE_CSS } from '../src/engage/styles.js';
import { hexToRgba, safeAccent, safeHttpUrl } from '../src/sanitize.js';
import { widgetStyles } from '../src/styles.js';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function referenced(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/var\((--hw-[a-z0-9-]+)/g)) {
      out.add(match[1]!);
    }
  }
  return out;
}

function declared(css: string): Set<string> {
  return new Set([...css.matchAll(/(--hw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

const defaults = {
  accent: '#7A3BEB',
  font: 'Plus Jakarta Sans',
  radius: 24,
  bubbleStyle: 'rounded' as const,
};

describe('tokens in the shadow roots', () => {
  const engageFiles = sources(join(SRC, 'engage'));
  const widgetFiles = sources(SRC).filter((file) => !engageFiles.includes(file));

  it('declares every token the widget refers to', () => {
    const have = declared(widgetStyles(defaults));
    for (const name of referenced(widgetFiles)) expect(have, name).toContain(name);
  });

  it('declares every token the engage layer refers to', () => {
    const have = declared(ENGAGE_CSS);
    for (const name of referenced(engageFiles)) expect(have, name).toContain(name);
  });

  it('carries only the tokens it uses, not the whole set', () => {
    const css = widgetStyles(defaults);
    const declarations = css.match(/--hw-[a-z0-9-]+\s*:/g) ?? [];
    // Formerly 161 per shadow root; a couple of dozen tokens, in three theme
    // blocks, plus the widget's own handful.
    expect(declarations.length).toBeLessThan(80);
    expect(css).not.toContain('--hw-duration-page');
    expect(css).not.toContain('--hw-under-peach');
  });

  it('sets the accent itself, so a custom colour survives dark mode', () => {
    const css = widgetStyles({ ...defaults, accent: '#B23A2C' });
    expect(css).toContain('--hw-accent: #B23A2C;');
    expect(css).not.toContain('--hw-accent: #9B7BFF;');
  });
});

describe('values from settings', () => {
  it('only lets a hex colour into the stylesheet', () => {
    const css = widgetStyles({ ...defaults, accent: '#fff} :host{display:none' });
    expect(css).not.toContain('display:none');
    expect(css).toContain('--hw-accent: #7A3BEB;');
    expect(safeAccent('#abc')).toBe('#abc');
    expect(safeAccent(' #AABBCC80 ')).toBe('#AABBCC80');
    expect(safeAccent('red')).toBe('#7A3BEB');
    expect(safeAccent(null)).toBe('#7A3BEB');
  });

  it('derives the launcher glow from the accent rather than hard-coding purple', () => {
    expect(widgetStyles({ ...defaults, accent: '#B23A2C' })).toContain(
      '--hw-accent-glow: rgba(178, 58, 44, 0.35);',
    );
    expect(hexToRgba('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
  });

  it('quotes the font and defaults the numbers', () => {
    const css = widgetStyles({ ...defaults, font: 'Inter"; } :host { x', radius: Number.NaN });
    expect(css).toContain('--hw-font: "Inter\\"; } :host { x", "Plus Jakarta Sans"');
    expect(css).toContain('--hw-panel-radius: 24px;');
  });

  it('accepts http(s) and same-origin URLs and nothing else', () => {
    expect(safeHttpUrl('https://cdn.example/icon.png')).toBe('https://cdn.example/icon.png');
    expect(safeHttpUrl('/icon.png')).toBe('/icon.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});
