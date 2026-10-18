/**
 * The two Settings scripts that go beyond the shell's island.
 */

/**
 * What the API itself says about the widget's outside dependencies (`GET
 * /admin/widget/checks`, from the `data-widget-checks` holder), written over
 * the page's own best guess.
 */
export const WIDGET_CHECKS_JS = `
(function () {
  var holder = document.querySelector('[data-widget-checks]');
  if (!holder || !window.fetch) return;
  function say(kind, text, tone) {
    document.querySelectorAll('[data-check="' + kind + '"]').forEach(function (el) {
      el.textContent = text;
      el.hidden = false;
      if (tone) el.setAttribute('data-tone', tone);
    });
  }
  fetch(holder.getAttribute('data-widget-checks'), { credentials: 'include' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (!data) return;
      var bot = data.botCheck || {};
      if (bot.secretEnv) {
        document.querySelectorAll('[data-secret-env="' + bot.secretEnv + '"] [data-secret-state]').forEach(function (el) {
          var pill = document.createElement('span');
          pill.className = 'db-pill db-pill--' + (bot.secretSet ? 'good' : 'neutral');
          pill.textContent = bot.secretSet ? (bot.secretSource === 'config' ? 'Set: yes, in code' : 'Set: yes') : 'Set: no';
          el.replaceChildren(pill);
        });
      }
      say('botcheck', !bot.requested
        ? 'Off: no challenge is shown.'
        : bot.active
          ? 'On: new conversations need a passed challenge.'
          : 'Asked for, but not running: ' + (!bot.siteKey ? 'the site key is missing' : 'the secret key is not set where the API runs') + '.',
        bot.requested && !bot.active ? 'warn' : null);
      var status = data.status || {};
      say('status', status.mode === 'manual'
        ? 'Showing the status set here: ' + (status.message || status.level) + '.'
        : !status.url
          ? 'No status page set, so the widget shows no status line.'
          : status.readable
            ? 'The status page answers. The widget says: ' + status.message
            : 'The status page could not be read, so the widget shows no status line. Check the URL is a public Statuspage, Instatus or Better Stack page.',
        status.mode !== 'manual' && status.url && !status.readable ? 'warn' : null);
    })
    .catch(function () {});
})();
`;

/**
 * The Home tab's block list: keeps the hidden input's JSON in step with the
 * rows and fires a change on it, which the island saves like any other
 * control; rows move, go and come from their templates.
 */
export const HOME_BLOCKS_JS = `
(function () {
  document.querySelectorAll('[data-blocks]').forEach(function (editor) {
    var input = document.getElementById(editor.getAttribute('data-blocks'));
    var list = editor.querySelector('.db-blocks__list');
    function setPath(target, path, value) {
      var keys = path.split('.');
      var node = target;
      for (var i = 0; i < keys.length - 1; i++) {
        if (!node[keys[i]] || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
        node = node[keys[i]];
      }
      node[keys[keys.length - 1]] = value;
    }
    function read(row) {
      var block = JSON.parse(row.getAttribute('data-block'));
      row.querySelectorAll('[data-field]').forEach(function (el) {
        var kind = el.getAttribute('data-kind');
        var value = el.value;
        if (kind === 'number') {
          if (String(value).trim() === '' || !isFinite(Number(value))) return;
          value = Number(value);
        } else if (kind === 'list') {
          value = value.split(/[,\\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
        } else if (kind === 'links') {
          value = value.split('\\n').map(function (line) {
            var parts = line.split('|').map(function (s) { return s.trim(); });
            return parts[0] && parts[1] ? { label: parts[0], url: parts[1], icon: parts[2] || '' } : null;
          }).filter(Boolean);
        }
        setPath(block, el.getAttribute('data-field'), value);
      });
      row.setAttribute('data-block', JSON.stringify(block));
      return block;
    }
    function save() {
      var blocks = Array.prototype.map.call(list.children, read);
      input.value = JSON.stringify(blocks);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    editor.addEventListener('change', function (event) {
      if (event.target.closest('[data-field]')) save();
    });
    editor.addEventListener('click', function (event) {
      var move = event.target.closest('[data-block-move]');
      if (move) {
        var row = move.closest('.db-blocks__row');
        var how = move.getAttribute('data-block-move');
        if (how === 'up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        else if (how === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        else if (how === 'remove') row.remove();
        else return;
        save();
        return;
      }
      if (event.target.closest('[data-block-add]')) {
        var type = editor.querySelector('select[name="newBlock"]').value;
        var template = editor.querySelector('template[data-block-template="' + type + '"]');
        if (!template) return;
        list.appendChild(template.content.firstElementChild.cloneNode(true));
        save();
      }
    });
  });
})();
`;
