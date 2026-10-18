import { defineConfig } from 'tsup';

/**
 * Six outputs, because they have genuinely different jobs: a library build
 * for apps that import the widget, a tiny loader, the self-booting bundle the
 * loader fetches, the engage and form previews the dashboard's editors draw
 * with, and the Node half that serves the rest.
 *
 * None of them sets `clean`. tsup runs an array config under Promise.all, so a
 * `clean: true` on one entry can delete another entry's output after it has
 * been written. The build script removes dist once, first, instead.
 */
export default defineConfig([
  {
    // The library build, for apps that import the widget directly.
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    // The widget runs on someone else's page: no globals, no polyfills.
    platform: 'browser',
    target: 'es2020',
  },
  {
    // The only thing a customer's page parses synchronously. Built on its own
    // and kept small enough to inline if they would rather. No `globalName`:
    // the only global the widget adds to a page is `window.helpwell`.
    entry: ['src/loader.ts'],
    format: ['esm', 'iife'],
    dts: true,
    minify: true,
    sourcemap: true,
    platform: 'browser',
    target: 'es2020',
  },
  {
    // widget.js: what the loader fetches. Self-booting, minified, one file.
    entry: { widget: 'src/browser.ts' },
    format: ['iife'],
    minify: true,
    sourcemap: true,
    platform: 'browser',
    target: 'es2020',
  },
  {
    // engage-preview.js: the engage renderers alone, for the dashboard
    // editor's preview frame. Never loaded on a customer's page.
    entry: { 'engage-preview': 'src/engage/preview-entry.ts' },
    format: ['iife'],
    minify: true,
    sourcemap: true,
    platform: 'browser',
    target: 'es2020',
  },
  {
    // forms-preview.js: the form renderer alone, for the dashboard's form
    // builder preview frame. Never loaded on a customer's page.
    entry: { 'forms-preview': 'src/forms/preview-entry.ts' },
    format: ['iife'],
    minify: true,
    sourcemap: true,
    platform: 'browser',
    target: 'es2020',
  },
  {
    // The server half: reads the two files above off disk so the API handler
    // can serve them. Node only, hence its own entry.
    entry: ['src/server.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    platform: 'node',
    target: 'node20',
    // Gives the CJS build a real `import.meta.url` and the ESM build a real
    // `__dirname`, so distDir() works in both.
    shims: true,
  },
]);
