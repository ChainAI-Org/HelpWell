/**
 * Posts the eval run form with fetch and reads the progress stream, one JSON
 * line per case, into the progress bar; then opens the finished run. Anything
 * it cannot do (an old browser) falls back to the plain form post.
 */

export const EVAL_RUN_JS = `
(function () {
  var form = document.querySelector('form[data-eval-run]');
  if (!form || !window.fetch || !window.TextDecoder || !window.ReadableStream) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var box = form.querySelector('.db-evalprogress');
    var bar = box.querySelector('progress');
    var text = box.querySelector('.db-evalprogress__text');
    var submit = form.querySelector('button');
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    box.hidden = false;
    function fail(message) {
      text.textContent = message;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/x-ndjson' },
      body: new URLSearchParams(new FormData(form))
    }).then(function (response) {
      if (!response.ok || !response.body) throw new Error('The run did not start.');
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffered = '';
      function handle(line) {
        if (!line.trim()) return;
        var message = JSON.parse(line);
        if (message.type === 'progress') {
          bar.max = message.total;
          bar.value = message.index;
          text.textContent = 'Case ' + (message.index + 1) + ' of ' + message.total + ': ' + message.question;
        } else if (message.type === 'done') {
          bar.value = bar.max;
          text.textContent = 'Done. Opening the results…';
          window.location.href = message.location;
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
      fail(error && error.message ? error.message : 'The run did not finish. Try again.');
    });
  });
})();
`;
