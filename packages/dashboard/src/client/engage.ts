/**
 * The engage pages' client-side script, for what plain forms cannot do. The
 * editor kit's script does the composer, lists, popovers, media and uploads;
 * this does what is particular to engagements.
 *
 *   - The live preview: every change posts the form to `_draft`, and the
 *     definition that comes back is handed to the preview frame with
 *     postMessage, on this origin only, with the slide or step being edited
 *     and sample values for `{{field}}` placeholders. The frame says when it
 *     is ready; if it never does, the notice about the widget's files is
 *     shown. The frame shows a loading sketch until then, and an empty state
 *     when the draft has nothing to draw.
 *   - Re-drawing the form when a choice changes which fields exist (a
 *     question's kind, a button that starts a tour), keeping the place.
 *   - Keeping the "who sees it, and when" sentences in step with the
 *     controls (they come back with every draft).
 *   - Bringing the part of the form just added back into view, unfolding one
 *     more condition row, and the colour pickers beside their hex boxes.
 *   - Saving the live switch in the list as soon as it is flipped.
 *
 * The form builder runs on this script too, through the same hooks.
 *
 * Without it, everything still works with buttons and a page load.
 */

export const ENGAGE_JS = `
(function () {
  document.addEventListener('change', function (event) {
    var box = event.target.closest && event.target.closest('[data-autosubmit]');
    if (box && box.form) box.form.submit();
  });

  var form = document.getElementById('en-editor');
  if (!form) return;
  var wrap = form.querySelector('.ek-frame');
  var frame = wrap && wrap.querySelector('iframe');
  var status = document.getElementById('en-preview-status');
  var missing = document.getElementById('en-preview-missing');
  var draftUrl = form.getAttribute('data-draft');
  var accent = form.getAttribute('data-accent');
  var sample = {};
  try { sample = JSON.parse(form.getAttribute('data-sample-fields') || '{}'); } catch (error) { sample = {}; }
  var last = null;
  var empty = false;
  var ready = false;
  var startAt = null;
  var timer = null;
  var sequence = 0;

  function state(value) { if (wrap) wrap.setAttribute('data-state', value); }

  var focus = form.getAttribute('data-focus');
  if (focus) {
    var target = document.getElementById(focus);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      var first = target.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable=true]');
      if (first && first.offsetParent !== null) first.focus({ preventScroll: true });
    }
  }

  function send() {
    if (!ready || !last || !frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: 'helpwell:engage:preview', definition: last, accent: accent, startAt: startAt, fields: sample },
      location.origin
    );
    state(empty ? 'empty' : 'ready');
  }

  function refresh() {
    var mine = ++sequence;
    fetch(draftUrl, { method: 'POST', credentials: 'same-origin', body: new FormData(form) })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || mine !== sequence) return;
        last = data.definition;
        empty = Boolean(data.empty);
        var said = data.summaries || {};
        Object.keys(said).forEach(function (key) {
          document.querySelectorAll('[data-summary="' + key + '"]').forEach(function (el) {
            var text = String(said[key]);
            el.textContent = key === 'trigger' ? text.charAt(0).toUpperCase() + text.slice(1) : text;
          });
        });
        if (status) {
          status.textContent = data.problems
            ? data.problems + (data.problems === 1 ? ' thing needs' : ' things need') + ' fixing before it can be saved. The preview shows it as it is.'
            : '';
        }
        send();
      })
      .catch(function () {});
  }

  function soon() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  }

  // Structural choices re-draw the form, and come back to the same place.
  function rerender(from) {
    var item = from.closest('[data-ek-panel], .eg-block, .ek-card');
    var op = document.createElement('input');
    op.type = 'hidden';
    op.name = 'op';
    op.value = 'refresh' + (item && item.id ? '|' + item.id.replace(/^en-/, '') : '');
    form.appendChild(op);
    form.setAttribute('data-ek-submitting', '');
    form.submit();
  }

  form.addEventListener('input', soon);
  form.addEventListener('change', function (event) {
    var el = event.target;
    if (el.matches('[data-rerender]')) { rerender(el); return; }
    if (el.matches('[data-en-action]')) {
      var button = el.closest('.eg-button');
      var was = button && button.getAttribute('data-en-button');
      if (was === 'tour' || el.value === 'tour') { rerender(el); return; }
      if (button) {
        button.setAttribute('data-en-button', el.value);
        var value = button.querySelector('[data-en-value]');
        if (value) value.placeholder = el.value === 'article' ? 'billing/invoices' : 'https://… or /path';
      }
    }
    if (el.matches('[data-en-colour-for]')) {
      var hex = form.elements.namedItem(el.getAttribute('data-en-colour-for'));
      if (hex) { hex.value = el.value.toUpperCase(); }
    }
    soon();
  });
  form.addEventListener('input', function (event) {
    var el = event.target;
    if (el.matches('[data-en-colour-for]')) {
      var hex = form.elements.namedItem(el.getAttribute('data-en-colour-for'));
      if (hex) hex.value = el.value.toUpperCase();
    }
  });

  // One more condition row at a time.
  form.querySelectorAll('[data-en-more-conditions]').forEach(function (button) {
    var group = button.closest('.eg-conditions');
    function spare() { return group.querySelector('.eg-condition[data-en-spare]'); }
    button.hidden = !spare();
    button.addEventListener('click', function () {
      var next = spare();
      if (!next) return;
      next.removeAttribute('data-en-spare');
      var field = next.querySelector('select');
      if (field) field.focus();
      button.hidden = !spare();
    });
  });

  // Previewing a tour starts at the step being edited, and a carousel at the
  // slide being edited: the one shown first, then whichever is chosen or typed in.
  var ITEM = '[data-step-index], [data-slide-index]';
  function stepFrom(el) {
    var item = el && el.closest && el.closest(ITEM);
    if (!item) return null;
    return Number(item.getAttribute('data-step-index') || item.getAttribute('data-slide-index'));
  }
  startAt = stepFrom(form.querySelector('[data-ek-panel][data-ek-current] :is(' + ITEM + ')'));
  form.addEventListener('focusin', function (event) {
    var next = stepFrom(event.target);
    if (next !== null && next !== startAt) { startAt = next; send(); }
  });
  form.addEventListener('ek:select', function (event) {
    var panel = document.getElementById(event.detail.id);
    var next = stepFrom(panel && panel.querySelector(ITEM));
    if (next !== null && next !== startAt) { startAt = next; send(); }
  });

  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    var data = event.data || {};
    if (data.type === 'helpwell:engage:ready') {
      ready = true;
      if (missing) missing.hidden = true;
      if (last) send(); else refresh();
    } else if (data.type === 'helpwell:engage:action' && status) {
      status.textContent = 'In the live widget, that button: ' + String(data.description || '').toLowerCase() + '.';
    }
  });
  setTimeout(function () {
    if (ready) return;
    state('broken');
    if (missing) missing.hidden = false;
  }, 6000);

  if (wrap) wrap.addEventListener('ek:device', send);
  var replay = form.querySelector('[data-ek-replay]');
  if (replay) replay.addEventListener('click', send);

  refresh();
})();
`;
