/**
 * Images in the article editor: paste one, drop one on the Markdown box, or
 * pick one with the button beside it. Each is posted to the dashboard, kept
 * through the install's asset store, and a Markdown image is put where the
 * cursor was, so the preview shows it at once. Without JavaScript the button
 * is not drawn and nothing changes: an image is referenced by its path or
 * address, as before.
 */

/** The article editor (pages/knowledge.ts), when the form has `data-upload`. */
export const ARTICLE_IMAGES_JS = `
(function () {
  var form = document.getElementById('db-editor');
  if (!form || !window.fetch || !window.FormData) return;
  var url = form.getAttribute('data-upload');
  var body = form.querySelector('textarea[name="body"]');
  var picker = form.querySelector('input[type=file][data-image-picker]');
  var annotatePicker = form.querySelector('input[type=file][data-annotate-picker]');
  var status = form.querySelector('[data-image-status]');
  var tools = form.querySelector('[data-image-tools]');
  if (!url || !body) return;
  if (tools) tools.hidden = false;
  var pending = 0;
  var submits = Array.prototype.filter.call(form.elements, function (el) { return el.type === 'submit'; })
    .map(function (el) { return { el: el, disabled: el.disabled }; });

  function busy() {
    submits.forEach(function (item) { item.el.disabled = pending > 0 || item.disabled; });
    if (tools) tools.setAttribute('aria-busy', String(pending > 0));
  }
  form.addEventListener('submit', function (event) {
    if (!pending) return;
    event.preventDefault();
    say('Wait for the image upload to finish before saving.');
  });

  function say(text) { if (status) status.textContent = text; }

  function insert(text) {
    var start = body.selectionStart || 0;
    var end = body.selectionEnd || start;
    var before = body.value.slice(0, start);
    var after = body.value.slice(end);
    // An image on a line of its own, so it is never glued to a sentence.
    var lead = before && !/\\n$/.test(before) ? '\\n\\n' : '';
    var tail = after && !/^\\n/.test(after) ? '\\n\\n' : '';
    body.value = before + lead + text + tail + after;
    var at = (before + lead + text).length;
    body.setSelectionRange(at, at);
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // A copy of a screenshot is titled after it, so a retake can tell which articles to annotate again.
  function shotOf(src) {
    if (!src || /\\/media\\//.test(src)) return null;
    var match = /(?:^|\\/)_?screenshots\\/([^\\/?#"]+)\\.png(?:[?#]|$)/.exec(src);
    return match ? match[1] : null;
  }
  function titled(markdown, shot) {
    return shot ? markdown.replace(/\\)$/, ' "Annotated copy of _screenshots/' + shot + '.png")') : markdown;
  }

  function upload(file, shot) {
    if (!file || !/^image\\//.test(file.type || 'image/')) return;
    var data = new FormData();
    data.append('file', file, file.name || 'image');
    data.append('path', form.getAttribute('data-path') || '');
    pending++;
    form.setAttribute('data-helpwell-dirty', '');
    busy();
    say('Uploading ' + (file.name || 'the image') + '…');
    return fetch(url, { method: 'POST', credentials: 'same-origin', body: data, headers: { accept: 'application/json' } })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (result) {
          if (!response.ok || !result.markdown) throw new Error(result.error || 'That image did not upload.');
          return result;
        });
      })
      .then(function (result) {
        insert(titled(result.markdown, shot));
        pending--;
        busy();
        say(pending > 0 ? 'Uploading…' : 'Added. It is saved with the article when you save.');
        return true;
      })
      .catch(function (error) {
        pending--;
        busy();
        say(error && error.message ? error.message : 'That image did not upload. Check your connection.');
        return false;
      });
  }

  function images(list) {
    var out = [];
    for (var i = 0; list && i < list.length; i++) {
      var item = list[i];
      var file = item.getAsFile ? (item.kind === 'file' ? item.getAsFile() : null) : item;
      if (file && /^image\\//.test(file.type)) out.push(file);
    }
    return out;
  }

  body.addEventListener('paste', function (event) {
    var files = images(event.clipboardData && event.clipboardData.items);
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach(function (file) { upload(file); });
  });
  body.addEventListener('dragover', function (event) {
    if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1) {
      event.preventDefault();
      body.classList.add('db-drop');
    }
  });
  body.addEventListener('dragleave', function () { body.classList.remove('db-drop'); });
  body.addEventListener('drop', function (event) {
    body.classList.remove('db-drop');
    var files = images(event.dataTransfer && event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach(function (file) { upload(file); });
  });
  if (picker) {
    picker.addEventListener('change', function () {
      images(picker.files).forEach(function (file) { upload(file); });
      picker.value = '';
    });
  }
  function annotate(src, name, close) {
    if (!window.HelpWellImageEditor) return;
    window.HelpWellImageEditor({
      src: src,
      name: name || 'article-image',
      saveLabel: 'Insert annotated copy',
      draftHint: 'Choose a tool to annotate. The original is preserved; save the article when you are ready.',
      savedMessage: 'Annotated copy inserted. Save the article to keep it.',
      onEdit: function () { form.setAttribute('data-helpwell-dirty', ''); },
      onClose: close,
      attach: function (file) {
        return upload(file, shotOf(src)).then(function (ok) {
          if (!ok) throw new Error('The annotated copy did not upload. Your annotations are still here; try again.');
        });
      },
      toast: say
    });
  }
  if (annotatePicker) annotatePicker.addEventListener('change', function () {
    var file = images(annotatePicker.files)[0];
    annotatePicker.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { say('Choose an image under 10 MB.'); return; }
    var local = URL.createObjectURL(file);
    annotate(local, file.name, function () { URL.revokeObjectURL(local); });
  });
  var preview = document.getElementById('db-preview');
  function imageButtons() {
    if (!preview) return;
    Array.prototype.forEach.call(preview.querySelectorAll('img'), function (img) {
      if (img.hasAttribute('data-annotation-ready')) return;
      img.setAttribute('data-annotation-ready', '');
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'db-btn db-annotate-image';
      edit.textContent = 'View / annotate image';
      edit.setAttribute('aria-label', 'View or annotate ' + (img.alt || 'article image'));
      edit.addEventListener('click', function () { annotate(img.currentSrc || img.src, img.alt); });
      img.insertAdjacentElement('afterend', edit);
    });
  }
  if (preview) {
    imageButtons();
    new MutationObserver(imageButtons).observe(preview, { childList: true, subtree: true });
  }
})();
`;
