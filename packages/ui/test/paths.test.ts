import { describe, expect, it } from 'vitest';
import {
  decodeSegments,
  fillPathTemplate,
  link,
  mountPath,
  slugPath,
  stripMountPath,
} from '../src/index.js';

describe('mountPath', () => {
  it('normalises the base to a leading slash and no trailing one', () => {
    expect(mountPath('/help/')).toBe('/help');
    expect(mountPath('help')).toBe('/help');
    expect(mountPath('  /admin/helpwell// ')).toBe('/admin/helpwell');
  });

  it('is empty at the root', () => {
    expect(mountPath('/')).toBe('');
    expect(mountPath('')).toBe('');
    expect(mountPath(undefined)).toBe('');
  });
});

describe('stripMountPath', () => {
  it('returns the path under the mount, and null outside it', () => {
    expect(stripMountPath('/help', '/help')).toBe('/');
    expect(stripMountPath('/help/billing/x', '/help')).toBe('/billing/x');
    expect(stripMountPath('/helpdesk', '/help')).toBeNull();
    expect(stripMountPath('/elsewhere', '/help')).toBeNull();
  });

  it('passes everything through at the root', () => {
    expect(stripMountPath('/', '')).toBe('/');
    expect(stripMountPath('/anything', '')).toBe('/anything');
  });
});

describe('link', () => {
  it('builds links inside the mount', () => {
    expect(link('/help')).toBe('/help');
    expect(link('/help', '/')).toBe('/help');
    expect(link('/help', '/changelog')).toBe('/help/changelog');
    expect(link('/help', 'changelog?cursor=1')).toBe('/help/changelog?cursor=1');
  });

  it('never produces an empty href at the root', () => {
    expect(link('')).toBe('/');
    expect(link('', '/')).toBe('/');
    expect(link('', '/changelog')).toBe('/changelog');
  });
});

describe('slugPath', () => {
  it('encodes each segment and keeps the slashes', () => {
    expect(slugPath('billing/invoices')).toBe('billing/invoices');
    expect(slugPath('a b/c"d')).toBe('a%20b/c%22d');
    expect(slugPath('x" onmouseover="alert(1)')).toBe('x%22%20onmouseover%3D%22alert(1)');
  });
});

describe('fillPathTemplate', () => {
  it('fills every {path}, and treats the path as text rather than a pattern', () => {
    expect(fillPathTemplate('https://x/edit/{path}?f={path}', 'a.md')).toBe(
      'https://x/edit/a.md?f=a.md',
    );
    expect(fillPathTemplate('https://x/{path}', '$&.md')).toBe('https://x/$&.md');
    expect(fillPathTemplate('https://x/{path}', "$'.md")).toBe("https://x/$'.md");
  });
});

describe('decodeSegments', () => {
  it('decodes each segment', () => {
    expect(decodeSegments('/help/a%20b/c')).toEqual(['help', 'a b', 'c']);
    expect(decodeSegments('/')).toEqual([]);
  });

  it('returns null rather than throwing on a malformed escape', () => {
    expect(decodeSegments('/help/%zz')).toBeNull();
    expect(decodeSegments('/%E0%A4%A')).toBeNull();
  });
});
