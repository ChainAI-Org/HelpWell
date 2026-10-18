/**
 * The widget's own font, for a page that does not already have it.
 *
 * The widget is set in Plus Jakarta Sans. A host page that loads it already
 * lends it to the widget, since fonts are shared by the whole document. For
 * one that does not, the API serves the font files itself (`widgetAssets()`
 * carries them under `assets/fonts/`), and this registers them with the page.
 *
 * Two details matter on someone else's page. The faces are registered under
 * a name of their own, "HelpWell Plus Jakarta Sans", so the page's own text
 * never changes because the widget arrived. And they are added through the
 * CSS Font Loading API rather than a <style> in the page's head: an
 * `@font-face` inside the widget's shadow root is ignored by browsers, and
 * this touches nothing in the host's DOM. A face is fetched only if the
 * widget actually draws text in it.
 */

import { webFontFamily, webFontFiles } from '@helpwell/ui';

/** The family the widget's stylesheet falls back to. */
export const WIDGET_FONT_FAMILY = webFontFamily('Plus Jakarta Sans', 'HelpWell');

const registered = new Set<string>();

/** Register the self-hosted faces once per API. Quietly does nothing where it cannot. */
export function registerWidgetFonts(apiUrl: string): void {
  const base = apiUrl.replace(/\/+$/, '');
  if (registered.has(base)) return;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  registered.add(base);
  for (const file of webFontFiles({ families: ['Plus Jakarta Sans'] })) {
    try {
      document.fonts.add(
        new FontFace(
          WIDGET_FONT_FAMILY,
          `url(${JSON.stringify(`${base}/assets/fonts/${file.name}`)}) format('woff2')`,
          {
            style: file.style,
            weight: '200 800',
            display: 'swap',
            unicodeRange: file.unicodeRange,
          },
        ),
      );
    } catch {
      // A browser that refuses one face keeps the system fallback for it.
    }
  }
}
