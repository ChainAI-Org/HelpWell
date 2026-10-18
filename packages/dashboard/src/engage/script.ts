/**
 * The engage pages' client-side script, for what plain forms cannot do: the
 * live preview, re-drawing the form when a choice changes its fields, the
 * "who sees it, and when" sentences, and the list's live switch. The editor
 * kit's script does the composer, lists, popovers, media and uploads.
 *
 * The code is client/engage.ts, served as a file (client/index.ts). The form
 * builder runs on it too, through the same hooks. Without it, everything
 * still works with buttons and a page load.
 */

import type { RawHtml } from '@helpwell/ui';
import { clientScript } from '../client/index.js';

export function engageScript(context: { basePath: string }): RawHtml {
  return clientScript(context, 'engage');
}
