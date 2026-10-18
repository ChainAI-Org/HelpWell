/**
 * `forms-preview.js`: the script the dashboard's form builder loads into its
 * preview frame. Self-booting; see preview.ts. An embed or a Home block is
 * drawn into the page's `[data-form-preview-target]` element; the other
 * placements over the page.
 */

import { listenForFormDrafts, mountFormsPreview } from './preview.js';

const preview = mountFormsPreview({
  target: (placement) =>
    document.querySelector<HTMLElement>(
      `[data-form-preview-target="${placement === 'home' ? 'home' : 'inline'}"]`,
    ),
});
listenForFormDrafts(preview);
