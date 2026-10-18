/**
 * Markdown, rendered by the same code as the help centre.
 *
 * Article bodies come from the customer's own repo, but agent answers are
 * generated text, so the renderer escapes everything first and reintroduces
 * only the forms it knows: no raw HTML, no `javascript:` URLs, code spans
 * never read as links or emphasis. Sharing it with `@helpwell/ui` means an
 * article looks the same in the panel as on its own page, tables and callouts
 * included.
 *
 * It renders for the `panel` surface. The widget lives inside somebody else's
 * page, so a YouTube, Vimeo, Loom or Wistia video is a link card that opens the
 * player rather than a third-party iframe on their site (their CSP decides
 * what may be framed, and the player would bring its cookies with it). A video
 * file still plays inline, and tabs become disclosures, the first one open.
 *
 * `renderMarkdown` is the HTML string. Views use `renderRich` from media.ts,
 * which takes that string through the widget's image and video rules
 * (lightbox, click-to-load players) before any of it is live.
 *
 * The widget wants the HTML alone; the headings the full page uses for its
 * table of contents are dropped here.
 */

import { renderMarkdown as render } from '@helpwell/ui';

export { type RichOptions, renderRich } from './media.js';

export function renderMarkdown(source: string): string {
  return render(source, { surface: 'panel' }).html;
}
