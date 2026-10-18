import { describe, expect, it } from 'vitest';
import { escapeHtml, html, join, RawHtml, raw, safeHref } from '../src/index.js';

describe('escapeHtml', () => {
  it('escapes the five characters that matter in text and attributes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('html', () => {
  it('escapes every interpolation', () => {
    const page = html`<p>${'<img src=x onerror=alert(1)>'}</p>`;
    expect(page.value).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('passes raw markup through untouched', () => {
    expect(html`<div>${raw('<b>ok</b>')}</div>`.value).toBe('<div><b>ok</b></div>');
  });

  it('drops null, undefined and booleans, and flattens arrays', () => {
    const out = html`<ul>${[html`<li>a</li>`, null, false, undefined, true, html`<li>b</li>`]}</ul>`;
    expect(out.value).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('renders numbers', () => {
    expect(html`<i>${3}</i>`.value).toBe('<i>3</i>');
  });

  it('nests: a template inside a template is not escaped twice', () => {
    const inner = html`<em>${'a & b'}</em>`;
    expect(html`<p>${inner}</p>`.value).toBe('<p><em>a &amp; b</em></p>');
  });
});

describe('raw and join', () => {
  it('wraps a string as trusted markup', () => {
    const value = raw('<hr>');
    expect(value).toBeInstanceOf(RawHtml);
    expect(String(value)).toBe('<hr>');
  });

  it('joins renderables with a separator, escaping strings', () => {
    expect(join(['a<b', raw('<i>c</i>')], ', ').value).toBe('a&lt;b, <i>c</i>');
  });
});

describe('safeHref', () => {
  it('allows same-site, anchor, http(s) and mailto URLs, escaped', () => {
    expect(safeHref('/help/a"b')).toBe('/help/a&quot;b');
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('https://acme.test/?a=1&b=2')).toBe('https://acme.test/?a=1&amp;b=2');
    expect(safeHref('HTTP://acme.test')).toBe('HTTP://acme.test');
    expect(safeHref('mailto:help@acme.test')).toBe('mailto:help@acme.test');
  });

  it('refuses javascript:, data: and anything else', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref(' JavaScript:alert(1)')).toBe('#');
    expect(safeHref('data:text/html,hi')).toBe('#');
    expect(safeHref('vbscript:x')).toBe('#');
    expect(safeHref('')).toBe('#');
  });

  it('refuses protocol-relative URLs, which leave the site while looking local', () => {
    expect(safeHref('//evil.example/')).toBe('#');
    expect(safeHref('/\\evil.example/')).toBe('#');
    expect(safeHref('\\\\evil.example/')).toBe('#');
  });
});
