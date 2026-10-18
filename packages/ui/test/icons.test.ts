import { describe, expect, it } from 'vitest';
import { hasIcon, icon, iconOr } from '../src/index.js';

describe('icons', () => {
  it('draws a known icon as an inline SVG of the requested size', () => {
    const svg = icon('search', 20);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="20"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('draws nothing for a name it does not ship', () => {
    expect(icon('nope')).toBe('');
    expect(hasIcon('nope')).toBe(false);
  });

  it('never reads a name off Object.prototype', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(icon(name)).toBe('');
      expect(hasIcon(name)).toBe(false);
    }
    expect(iconOr('constructor', 'knowledge')).toBe(icon('knowledge'));
    expect(iconOr('constructor', 'knowledge')).not.toContain('function');
  });

  it('falls back when a docs author typed an unknown icon', () => {
    expect(iconOr('rocket', 'knowledge')).toBe(icon('rocket'));
    expect(iconOr('spaceship', 'knowledge')).toBe(icon('knowledge'));
    expect(iconOr(null, 'knowledge')).toBe(icon('knowledge'));
  });
});
