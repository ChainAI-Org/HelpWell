/**
 * `@helpwell/ui/fonts`: the self-hosted font files themselves.
 *
 * The help centre and the dashboard serve these under their own paths, and
 * the widget's asset list carries them, so every surface draws in its own
 * type without a request to a third party (see fonts.ts for the faces).
 *
 * Node only: the bytes are read off disk from the `@fontsource-variable`
 * packages this package depends on, which is why this is its own entry point
 * and not part of the browser-safe index. Read once, on first use, and kept.
 * A missing file is left out rather than thrown: fonts are a nicety, and a
 * page set in the fallback stack is still a working page.
 */

/// <reference types="node" />

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { WEB_FONT_FILES } from './fonts.js';

export {
  type FontFaceOptions,
  fontFaceCss,
  WEB_FONT_FILES,
  type WebFontFamily,
  type WebFontFile,
  webFontFamily,
  webFontFiles,
} from './fonts.js';

export interface FontAsset {
  body: Uint8Array<ArrayBuffer>;
  /** Always `font/woff2`. */
  type: string;
}

const FONT_TYPE = 'font/woff2';

let loaded: Record<string, FontAsset> | null = null;
const etags = new Map<string, string>();

/**
 * Every font file, keyed by the name it is served under. Shaped like the
 * widget's static assets, so it can be spread into the API's `assets`.
 */
export function webFontAssets(): Record<string, FontAsset> {
  if (loaded) return loaded;
  const require = createRequire(moduleUrl());
  const assets: Record<string, FontAsset> = {};
  for (const file of WEB_FONT_FILES) {
    try {
      const path = require.resolve(`${file.source.package}/files/${file.source.file}`);
      assets[file.name] = { body: new Uint8Array(readFileSync(path)), type: FONT_TYPE };
    } catch {
      // Not installed, or not this version's file name: that face falls back.
    }
  }
  loaded = assets;
  return assets;
}

/**
 * A font file as a response, for a surface that serves them under its own
 * path (`<basePath>/_fonts/<name>`). 404 for a name that is not one of ours,
 * so the route cannot be used to read anything else. Cached for a week and
 * revalidated by ETag: the names do not change when a font package does.
 */
export function serveWebFont(name: string, request: Request): Response {
  const asset = webFontAssets()[name];
  if (!asset) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  let etag = etags.get(name);
  if (!etag) {
    etag = `"${createHash('sha1').update(asset.body).digest('base64url').slice(0, 16)}"`;
    etags.set(name, etag);
  }
  const headers = {
    'content-type': FONT_TYPE,
    'cache-control': 'public, max-age=604800, stale-while-revalidate=86400',
    etag,
    'x-content-type-options': 'nosniff',
    // A font on a help centre's own domain may be asked for by the widget
    // on the product's domain.
    'cross-origin-resource-policy': 'cross-origin',
    'access-control-allow-origin': '*',
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers });
}

/**
 * Where this module was loaded from, in either module system: the CommonJS
 * build has no `import.meta.url` of its own and the ESM build has no
 * `__filename`, so both are read through `typeof`.
 */
function moduleUrl(): string {
  const url = typeof import.meta === 'object' ? import.meta.url : undefined;
  if (typeof url === 'string' && url.length > 0) return url;
  if (typeof __filename === 'string') return __filename;
  throw new Error('@helpwell/ui/fonts: could not work out where it was installed.');
}
