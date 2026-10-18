/**
 * What the form builder needs on top of the engage editor's page script
 * (which it shares: the preview, the summaries, uploads, the accordion):
 * keeping each colour picker and the hex box beside it in step.
 */

export const FORMS_JS = `
(function () {
  var form = document.getElementById('en-editor');
  if (!form) return;
  form.querySelectorAll('input[type=color][data-colour-for]').forEach(function (picker) {
    var box = form.querySelector('[name="' + picker.getAttribute('data-colour-for') + '"]');
    if (!box) return;
    picker.addEventListener('input', function () {
      box.value = picker.value.toUpperCase();
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    box.addEventListener('change', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(box.value)) picker.value = box.value;
    });
  });
})();
`;
