import { describe, expect, it } from 'vitest';
import { baseStyles, MONO_STACK, safeCssColor, safeFontFamily } from '../src/index.js';

describe('safeCssColor', () => {
  it('accepts a hex colour of three to eight digits', () => {
    expect(safeCssColor('#0EA5E9', '#000')).toBe('#0EA5E9');
    expect(safeCssColor(' #fff ', '#000')).toBe('#fff');
    expect(safeCssColor('#7A3BEBCC', '#000')).toBe('#7A3BEBCC');
  });

  it('falls back for anything that is not one', () => {
    expect(safeCssColor('red', '#000')).toBe('#000');
    expect(safeCssColor('#fff; } body { background: red', '#000')).toBe('#000');
    expect(safeCssColor('</style><script>x</script>', '#000')).toBe('#000');
    expect(safeCssColor(undefined, '#000')).toBe('#000');
    expect(safeCssColor(12, '#000')).toBe('#000');
  });
});

describe('safeFontFamily', () => {
  it('keeps an ordinary family name', () => {
    expect(safeFontFamily('Plus Jakarta Sans', 'system-ui')).toBe('Plus Jakarta Sans');
  });

  it('strips what could close the string, the rule or the style element', () => {
    expect(safeFontFamily(`Inter", "x</style><script>alert(1)</script>`, 'system-ui')).toBe(
      'Inter, x/stylescriptalert1/script',
    );
    expect(safeFontFamily("a'; } body { color: red", 'system-ui')).toBe('a  body  color: red');
    expect(safeFontFamily('back\\slash', 'system-ui')).toBe('backslash');
  });

  it('falls back when nothing is left', () => {
    expect(safeFontFamily('"<>"', 'system-ui')).toBe('system-ui');
    expect(safeFontFamily(null, 'system-ui')).toBe('system-ui');
  });
});

describe('baseStyles', () => {
  it('emits the shared rules under the surface prefix', () => {
    const css = baseStyles('db');
    expect(css).toContain('.db-empty {');
    expect(css).toContain('@keyframes db-rise');
    expect(css).toContain('.db-skip:focus');
    expect(css).toContain('.db-visually-hidden');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('.hc-tablewrap { overflow-x: auto;');
    expect(baseStyles('hc')).toContain('.hc-empty {');
  });

  it('names one monospace stack for both surfaces', () => {
    expect(MONO_STACK).toContain('ui-monospace');
  });
});
