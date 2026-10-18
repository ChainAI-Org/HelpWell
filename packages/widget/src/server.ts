/**
 * Serving the widget from the host app.
 *
 * The widget is a handful of static files (the loader, the bundle, the
 * dashboard's two preview scripts and the widget's font), and every
 * framework has a different idea of where static files live. Rather than ask
 * people to copy them into `public/` and remember to do it again after every
 * upgrade, this reads them out of the installed packages and hands them to
 * the API handler:
 *
 *   import { widgetAssets } from '@helpwell/widget/server';
 *   createHelpWellHandler({ db, basePath: '/api/helpwell', assets: widgetAssets() });
 *
 * after which `<script src="/api/helpwell/assets/loader.js" defer></script>`
 * is the whole install, and an `npm update` is the whole upgrade.
 *
 * Node only. It reads from disk, which is why it is a separate entry point and
 * not part of the browser bundle.
 */

// The rest of this package is browser code and its tsconfig has no Node
// types; this one file needs them, so it asks for them itself.
/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webFontAssets } from '@helpwell/ui/fonts';

export interface StaticAsset {
  body: Uint8Array;
  /** The Content-Type to serve it with. */
  type: string;
}

/**
 * The files, keyed by the name they are served under.
 *
 * The names matter: the loader finds its bundle by taking its own script URL
 * and replacing `loader.js` with `widget.js`, so the two have to be siblings
 * under exactly these names.
 */
const FILES: Record<string, { file: string; type: string; optional?: boolean }> = {
  'loader.js': { file: 'loader.global.js', type: 'text/javascript; charset=utf-8' },
  'widget.js': { file: 'widget.global.js', type: 'text/javascript; charset=utf-8' },
  'loader.js.map': { file: 'loader.global.js.map', type: 'application/json; charset=utf-8' },
  'widget.js.map': { file: 'widget.global.js.map', type: 'application/json; charset=utf-8' },
  // The dashboard's engage editor draws its live preview with this. Optional:
  // without it the preview says so, and nothing a visitor sees changes.
  'engage-preview.js': {
    file: 'engage-preview.global.js',
    type: 'text/javascript; charset=utf-8',
    optional: true,
  },
  // The same for the form builder's preview.
  'forms-preview.js': {
    file: 'forms-preview.global.js',
    type: 'text/javascript; charset=utf-8',
    optional: true,
  },
};

/**
 * Read the built widget files once, at boot.
 *
 * Reading them eagerly rather than per request means a missing build fails
 * loudly when the server starts, not the first time a customer opens a page.
 */
export function widgetAssets(): Record<string, StaticAsset> {
  const dist = distDir();
  const assets: Record<string, StaticAsset> = {};

  for (const [name, { file, type, optional }] of Object.entries(FILES)) {
    try {
      assets[name] = { body: readFileSync(join(dist, file)), type };
    } catch (error) {
      // Source maps are optional. The scripts are not.
      if (name.endsWith('.map') || optional) continue;
      throw new Error(
        `@helpwell/widget: could not read ${file} from ${dist}. ` +
          'If you are working in the HelpWell repo, run `pnpm build` first.',
        { cause: error },
      );
    }
  }

  // The widget's font, self-hosted, for pages that do not load it (fonts.ts).
  // Plus Jakarta Sans only: the widget has no display headings.
  for (const [name, font] of Object.entries(webFontAssets())) {
    if (name.startsWith('plus-jakarta-sans')) assets[`fonts/${name}`] = font;
  }

  return assets;
}

/**
 * The script tag, for templating into a layout.
 *
 * @param apiPath where the API handler is mounted, e.g. "/api/helpwell"
 */
export function widgetScriptTag(apiPath = '/api/helpwell'): string {
  const base = apiPath.replace(/\/+$/, '');
  return `<script src="${base}/assets/loader.js" defer></script>`;
}

/**
 * Where this file was loaded from, in either module system.
 *
 * `import.meta.url` is rewritten to an empty object in the CommonJS build and
 * `__dirname` does not exist in the ESM one, so both are read through
 * `typeof` and whichever is present wins.
 */
function distDir(): string {
  const url = typeof import.meta === 'object' ? import.meta.url : undefined;
  if (typeof url === 'string' && url.length > 0) return dirname(fileURLToPath(url));
  if (typeof __dirname === 'string') return __dirname;
  throw new Error('@helpwell/widget: could not work out where it was installed.');
}
