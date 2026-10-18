/**
 * The live Markdown previews: what is typed is posted to the dashboard, which
 * renders it on the server with the same renderer the reader sees, and the
 * result is swapped in. Without JavaScript, "Refresh preview" does the same
 * with a round trip.
 */

/** The article editor (pages/knowledge.ts): rendered as the help centre shows it. */
export const ARTICLE_PREVIEW_JS = `
(function () {
  var form = document.getElementById('db-editor');
  if (!form || !window.fetch) return;
  var body = form.querySelector('textarea[name="body"]');
  var target = document.getElementById('db-preview');
  var url = form.getAttribute('data-preview');
  var timer = null;
  var sent = null;
  function value(name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? el.value : '';
  }
  function refresh() {
    var markdown = body.value;
    if (markdown === sent) return;
    sent = markdown;
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        markdown: markdown,
        path: form.getAttribute('data-path') || '',
        collection: value('collection'),
        title: value('title')
      })
    }).then(function (response) {
      if (!response.ok) throw new Error('preview failed');
      return response.json();
    }).then(function (data) {
      if (sent === markdown) target.innerHTML = data.html;
    }).catch(function () {
      // Keep the last good preview; Refresh preview still works.
      sent = null;
    });
  }
  body.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  });
})();
`;

/** The playbook editor (pages/playbook.ts): rendered as the agent reads it. */
export const PLAYBOOK_PREVIEW_JS = `
(function () {
  var form = document.getElementById('db-playbook');
  if (!form || !window.fetch) return;
  var body = form.querySelector('textarea[name="content"]');
  var target = document.getElementById('db-preview');
  var url = form.getAttribute('data-preview');
  var file = form.getAttribute('data-file');
  var timer = null;
  var sent = null;
  function refresh() {
    var markdown = body.value;
    if (markdown === sent) return;
    sent = markdown;
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: file, markdown: markdown })
    }).then(function (response) {
      if (!response.ok) throw new Error('preview failed');
      return response.json();
    }).then(function (data) {
      if (sent === markdown) target.innerHTML = data.html;
    }).catch(function () { sent = null; });
  }
  body.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  });
})();
`;
