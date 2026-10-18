/**
 * The self-hosted fonts: every declared face has a file that exists, the CSS
 * swaps rather than blanks, and the route serves only its own files.
 */

import { describe, expect, it } from 'vitest';
import { serveWebFont, webFontAssets } from '../src/font-files.js';
import { fontFaceCss, WEB_FONT_FILES, webFontFamily } from '../src/index.js';

describe('web fonts', () => {
  it('finds a file for every face it declares', () => {
    const assets = webFontAssets();
    for (const file of WEB_FONT_FILES) {
      const asset = assets[file.name];
      expect(asset, file.name).toBeDefined();
      // woff2 files start with the signature "wOF2".
      expect(new TextDecoder().decode(asset!.body.slice(0, 4))).toBe('wOF2');
      expect(asset!.type).toBe('font/woff2');
    }
    expect(Object.keys(assets)).toContain('plus-jakarta-sans-latin.woff2');
    expect(Object.keys(assets)).toContain('bricolage-grotesque-latin.woff2');
  });

  it('writes faces that swap, split by script, served from the base given', () => {
    const css = fontFaceCss('/help/_fonts');
    expect(css).toContain('font-family: "Plus Jakarta Sans"');
    expect(css).toContain('font-family: "Bricolage Grotesque"');
    expect(css).toContain(
      'src: url("/help/_fonts/plus-jakarta-sans-latin.woff2") format(\'woff2\')',
    );
    expect(css).toContain('font-style: italic');
    expect(css.match(/font-display: swap/g)?.length).toBe(WEB_FONT_FILES.length);
    expect(css).toContain('unicode-range: U+0000-00FF');
    // Nothing from a third party.
    expect(css).not.toMatch(/googleapis|gstatic|https?:/);
  });

  it('can name the faces privately, and pick families', () => {
    const css = fontFaceCss('https://acme.com/api/helpwell/assets/fonts', {
      families: ['Plus Jakarta Sans'],
      prefix: 'HelpWell',
    });
    expect(css).toContain('font-family: "HelpWell Plus Jakarta Sans"');
    expect(css).not.toContain('Bricolage');
    expect(webFontFamily('Plus Jakarta Sans', 'Help<Well>')).toBe('HelpWell Plus Jakarta Sans');
  });

  it('refuses a base that could break out of the rule', () => {
    expect(fontFaceCss('/help/_fonts"); } body { color: red')).toBe('');
    expect(fontFaceCss('javascript:alert(1)')).toBe('');
    expect(fontFaceCss('/help</style><script>')).toBe('');
    expect(fontFaceCss('')).toContain('url("/plus-jakarta-sans-latin.woff2")');
  });

  it('serves its own files and nothing else', async () => {
    const ok = serveWebFont('plus-jakarta-sans-latin.woff2', new Request('http://x/f'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('font/woff2');
    expect(ok.headers.get('cache-control')).toContain('max-age=604800');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    const again = serveWebFont(
      'plus-jakarta-sans-latin.woff2',
      new Request('http://x/f', { headers: { 'if-none-match': ok.headers.get('etag')! } }),
    );
    expect(again.status).toBe(304);

    expect(serveWebFont('../package.json', new Request('http://x/f')).status).toBe(404);
    expect(serveWebFont('index.css', new Request('http://x/f')).status).toBe(404);
  });
});
