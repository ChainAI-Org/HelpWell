/**
 * The editor kit's behaviour in the browser, for what markup alone cannot do:
 * the composer, lists and reordering, popovers, media blocks and uploads, the
 * preview's device switch, and the unsaved-changes line. The code is
 * client/editor-kit.ts, served as a file (client/index.ts), so an editor
 * page needs no inline script.
 *
 * Every hook is a `data-ek-*` attribute the kit's own markup writes, so a
 * page gets all of it by drawing with the kit and including this once, after
 * the editor. Without it, every form still posts and every panel still shows.
 */

import type { RawHtml } from '@helpwell/ui';
import { clientScript } from '../client/index.js';

export function editorKitScript(context: { basePath: string }): RawHtml {
  return clientScript(context, 'editor-kit');
}
