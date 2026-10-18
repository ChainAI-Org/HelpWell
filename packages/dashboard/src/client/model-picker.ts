/**
 * The model picker's behaviour (model-picker.ts draws its markup). Plain ES5,
 * like the shell's island: no bundle, no framework. Every value that came
 * from OpenRouter goes in as text, never as markup.
 */

export const MODEL_PICKER_JS = `
(function () {
  var lists = {};
  var MAX = 200;
  var ID = /^~?[A-Za-z0-9._-]+\\/[A-Za-z0-9._:-]+$/;

  function load(url) {
    if (!lists[url]) {
      lists[url] = fetch(url, { credentials: 'include' })
        .then(function (response) { return response.ok ? response.json() : { available: false, reason: 'unreachable' }; })
        .catch(function () { return { available: false, reason: 'unreachable' }; });
    }
    return lists[url];
  }

  function ago(iso) {
    if (!iso) return '';
    var days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    if (!isFinite(days)) return '';
    if (days < 1) return 'Added today';
    if (days < 2) return 'Added yesterday';
    if (days < 31) return 'Added ' + days + ' days ago';
    if (days < 365) return 'Added ' + Math.round(days / 30.4) + ' mo ago';
    return 'Added ' + (days / 365).toFixed(1).replace(/\\.0$/, '') + ' yr ago';
  }
  function money(n) {
    if (n === null || n === undefined) return '?';
    if (n === 0) return '$0';
    return '$' + (n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(0)).replace(/\\.?0+$/, '');
  }
  function price(model, kind) {
    var p = model.pricing || {};
    if (p.prompt === 0 && (p.completion === 0 || p.completion === null)) return 'Free';
    if (kind === 'embeddings' || p.completion === null) return money(p.prompt) + ' per M tokens';
    return money(p.prompt) + ' in · ' + money(p.completion) + ' out per M';
  }
  function context(n) {
    if (!n) return '';
    return (n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M' : Math.round(n / 1000) + 'K') + ' context';
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  document.querySelectorAll('[data-model-picker]').forEach(function (root, index) {
    var url = root.getAttribute('data-model-picker');
    var kind = root.getAttribute('data-model-kind');
    var input = root.querySelector('.db-model__input');
    var trigger = root.querySelector('.db-model__trigger');
    var pop = root.querySelector('.db-model__pop');
    var search = pop.querySelector('input');
    var list = pop.querySelector('.db-model__list');
    var foot = pop.querySelector('.db-model__foot');
    var hint = root.querySelector('[data-model-hint]');
    var nameEl = trigger.querySelector('.db-model__name');
    var idEl = trigger.querySelector('.db-model__id');
    var models = null;
    var shown = [];
    var active = 0;
    var optionId = 'db-model-opt-' + index + '-';

    function label() {
      var current = input.value.trim();
      var match = models && models.filter(function (m) { return m.id === current; })[0];
      nameEl.textContent = match ? match.name : '';
      idEl.textContent = current || (kind === 'embeddings' ? 'None: full-text search only' : 'Not set');
    }

    function setActive(i) {
      active = Math.max(0, Math.min(i, shown.length - 1));
      Array.prototype.forEach.call(list.children, function (item, n) {
        item.setAttribute('data-active', n === active ? 'true' : 'false');
      });
      var item = list.children[active];
      if (item) {
        search.setAttribute('aria-activedescendant', item.id);
        item.scrollIntoView({ block: 'nearest' });
      } else {
        search.removeAttribute('aria-activedescendant');
      }
    }

    function render() {
      var terms = search.value.toLowerCase().split(/\\s+/).filter(Boolean);
      var matches = (models || []).filter(function (m) {
        var hay = (m.id + ' ' + m.name).toLowerCase();
        return terms.every(function (t) { return hay.indexOf(t) > -1; });
      });
      var typed = search.value.trim();
      shown = matches.slice(0, MAX).map(function (m) { return { id: m.id, model: m }; });
      if (typed && ID.test(typed) && !matches.some(function (m) { return m.id === typed; })) {
        shown.unshift({ id: typed, model: null });
      }
      // Embeddings are optional: none means full-text search only.
      if (kind === 'embeddings' && !terms.length) shown.unshift({ id: '', model: null, none: true });
      list.replaceChildren.apply(list, shown.map(function (entry, n) {
        var item = el('li', 'db-model__option');
        item.id = optionId + n;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', entry.id === input.value.trim() ? 'true' : 'false');
        var m = entry.model;
        var title = el('span', 'db-model__oname', m ? m.name : entry.none ? 'None' : 'Use ' + entry.id);
        if (m && kind === 'chat' && !m.tools) title.appendChild(el('span', 'db-model__tag', 'No tools'));
        item.appendChild(title);
        var meta = el('span', 'db-model__ometa');
        if (m) {
          meta.appendChild(el('span', '', price(m, kind)));
          meta.appendChild(document.createElement('br'));
          meta.appendChild(el('span', '', [ago(m.created), context(m.contextLength)].filter(Boolean).join(' · ')));
        } else {
          meta.textContent = entry.none ? 'Full-text search only' : 'Not in the list';
        }
        item.appendChild(meta);
        item.appendChild(el('span', 'db-model__oid', entry.none ? 'Semantic search off' : entry.id));
        item.addEventListener('mousedown', function (event) { event.preventDefault(); });
        item.addEventListener('click', function () { choose(entry.id); });
        item.addEventListener('mousemove', function () { if (active !== n) setActive(n); });
        return item;
      }));
      foot.textContent = shown.length === 0
        ? 'No model matches. Type a full id, such as vendor/model, to use one that is not listed.'
        : matches.length > MAX
          ? 'Showing the newest ' + MAX + ' of ' + matches.length + '. Keep typing to narrow it down.'
          : matches.length + (matches.length === 1 ? ' model' : ' models') + ', newest first.';
      var selected = -1;
      shown.forEach(function (entry, n) { if (selected < 0 && entry.id === input.value.trim()) selected = n; });
      setActive(terms.length ? 0 : Math.max(0, selected));
    }

    function open() {
      if (!pop.hidden) return;
      pop.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      search.value = '';
      if (models) render();
      else { list.replaceChildren(); foot.textContent = 'Loading models from OpenRouter…'; }
      search.focus();
    }
    function close(refocus) {
      if (pop.hidden) return;
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (refocus) trigger.focus();
    }
    function choose(id) {
      close(true);
      if (id === input.value.trim()) return;
      input.value = id;
      // The shell's island saves any [data-patch] control on change.
      input.dispatchEvent(new Event('change', { bubbles: true }));
      label();
    }

    // Enhance: the button stands in for the text box, which stays as the value.
    input.hidden = true;
    trigger.hidden = false;
    label();

    trigger.addEventListener('click', function () { if (pop.hidden) open(); else close(false); });
    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
    });
    search.addEventListener('input', render);
    search.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
      else if (event.key === 'Enter') { event.preventDefault(); if (shown[active]) choose(shown[active].id); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === 'Tab') close(false);
    });
    document.addEventListener('mousedown', function (event) {
      if (!root.contains(event.target)) close(false);
    });

    load(url).then(function (data) {
      if (data && data.available && data.models && data.models.length) {
        models = data.models;
        label();
        if (!pop.hidden) render();
        return;
      }
      // No list to pick from: back to the text box, saying why.
      close(false);
      trigger.hidden = true;
      input.hidden = false;
      if (hint) {
        hint.textContent = data && data.reason === 'no_key'
          ? 'The API has no OPENROUTER_API_KEY, so there is no model list to pick from. Type a model id.'
          : 'OpenRouter could not be reached for its model list, so type a model id. The list comes back on its own.';
      }
    });
  });
})();
`;
