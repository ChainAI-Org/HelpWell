/**
 * The first script inside an editor's preview frame (engage/preview-page.ts,
 * forms/preview-page.ts). The renderer comes next, from the API; if it cannot
 * load, the frame shows its notice. A script's load error does not bubble,
 * so it is caught on its way down, at the window.
 */

export const PREVIEW_FRAME_JS = `
(function () {
  window.addEventListener('error', function (event) {
    var el = event.target;
    if (el && el.nodeType === 1 && el.hasAttribute('data-preview-renderer')) {
      document.body.classList.add('no-preview');
    }
  }, true);
})();
`;
