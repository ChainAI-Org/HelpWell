/**
 * What the form builder needs on top of the engage editor's page script
 * (which it shares: the preview, the summaries, uploads, the accordion):
 * keeping each colour picker and the hex box beside it in step. The code is
 * client/forms.ts, served as a file (client/index.ts).
 */

import type { RawHtml } from '@helpwell/ui';
import { clientScript } from '../client/index.js';

export function formsScript(context: { basePath: string }): RawHtml {
  return clientScript(context, 'forms');
}
