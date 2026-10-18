/**
 * "Import from another help center": posts the form, file and all, with
 * fetch and reads the progress stream, one JSON line per step, into the
 * progress bar; then puts the summary, rendered on the server, in place of
 * the form. Without it (no JavaScript, an old browser) the form posts as
 * usual and the summary comes back when the import is done.
 */

export const KNOWLEDGE_IMPORT_JS = `
(function () {
  var form = document.querySelector('form[data-import]');
  if (!form || !window.fetch || !window.TextDecoder || !window.ReadableStream || !window.FormData) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var box = form.querySelector('.db-evalprogress');
    var bar = box.querySelector('progress');
    var text = box.querySelector('.db-evalprogress__text');
    var submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    box.hidden = false;
    text.textContent = 'Starting…';
    function fail(message) {
      text.textContent = message;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/x-ndjson' },
      body: new FormData(form)
    }).then(function (response) {
      if (!response.ok || !response.body) throw new Error('The import did not start.');
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffered = '';
      function handle(line) {
        if (!line.trim()) return;
        var message = JSON.parse(line);
        if (message.type === 'progress') {
          if (message.total) { bar.max = message.total; bar.value = message.done || 0; }
          else bar.removeAttribute('value');
          text.textContent = message.text;
        } else if (message.type === 'done') {
          var holder = document.getElementById('db-import');
          if (holder && message.html) holder.innerHTML = message.html;
          else window.location.reload();
        } else if (message.type === 'error') {
          fail(message.message);
        }
      }
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { handle(buffered); return; }
          buffered += decoder.decode(chunk.value, { stream: true });
          var lines = buffered.split('\\n');
          buffered = lines.pop();
          lines.forEach(handle);
          return pump();
        });
      }
      return pump();
    }).catch(function (error) {
      fail(error && error.message ? error.message : 'The import did not finish. Try again.');
    });
  });
})();
`;
