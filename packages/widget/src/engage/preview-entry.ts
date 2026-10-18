/**
 * `engage-preview.js`: the script the dashboard's engage editor loads into
 * its preview frame. Self-booting; see preview.ts. A button's action is
 * reported to the editor rather than followed.
 */

import { ACTION_MESSAGE, listenForDrafts, mountPreview } from './preview.js';

const controller = mountPreview({
  onAction(description) {
    if (window.parent !== window) {
      window.parent.postMessage({ type: ACTION_MESSAGE, description }, location.origin);
    }
  },
});
listenForDrafts(controller);
