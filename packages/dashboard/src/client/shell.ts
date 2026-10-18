/**
 * The shell's client-side code, on every admin page (layout.ts).
 *
 * What plain forms cannot do: saving a toggle without a page reload, deleting
 * with a confirmation, copying text such as a setup prompt, and the command
 * palette. A screen that needs more (the model picker, the home block and
 * engage editors, a live preview, an eval run's progress) has its own small
 * script; everything else is a real form, which is why there is no bundle.
 *
 * The page's values ride on the script's own tag: `data-api`, where the API
 * is mounted, and `data-palette="false"` when the dashboard is embedded.
 */

export const SHELL_JS = `
(function () {
  // The page's values are on this script's own tag (layout.ts).
  var tag = document.currentScript;
  var API = (tag && tag.getAttribute('data-api')) || '';
  // Embedded, the host's navigation is the navigation: no palette over it.
  var PALETTE = !tag || tag.getAttribute('data-palette') !== 'false';

  // A shared DOM contract lets an embedding shell protect drafts before it
  // removes this frame. Removing an iframe does not fire beforeunload.
  var draftForms = 'form.db-editor, form.ek-editor, form[data-protect-draft]';
  document.querySelectorAll(draftForms).forEach(function (form) {
    function mark(event) {
      if (event.target.closest && event.target.closest('[data-ek-ignore]')) return;
      form.setAttribute('data-helpwell-dirty', '');
      var status = document.querySelector('[data-ek-status][data-dirty-text]');
      if (status) {
        status.textContent = status.getAttribute('data-dirty-text');
        status.setAttribute('data-tone', 'warn');
      }
    }
    form.addEventListener('input', mark);
    form.addEventListener('change', mark);
  });
  window.addEventListener('submit', function (event) {
    // Window runs after the form and document's validation/preview listeners.
    // A prevented save or an unrelated form must not clear this draft.
    if (!event.defaultPrevented && event.target.matches(draftForms)) {
      event.target.removeAttribute('data-helpwell-dirty');
    }
  });
  window.addEventListener('beforeunload', function (event) {
    if (!document.querySelector('form[data-helpwell-dirty]:not([data-ek-submitting])')) return;
    event.preventDefault();
    event.returnValue = '';
  });

  function flash(kind, message) {
    var existing = document.querySelector('.db-notice[data-flash]');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'db-notice db-notice--' + kind;
    el.setAttribute('data-flash', '');
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    el.textContent = message;
    var page = document.querySelector('.db-page');
    if (page) page.insertBefore(el, page.firstChild);
    if (kind === 'good') setTimeout(function () { el.remove(); }, 2600);
  }

  // A text box marked data-live also saves a moment after the typing stops, so
  // whatever sits beside the settings (a live preview) can follow along. The
  // box then has nothing new to save when it is left, and a save shows no
  // banner that would move it while the typing goes on.
  var liveTimers = new WeakMap();
  document.addEventListener('input', function (event) {
    var el = event.target.closest && event.target.closest('[data-patch][data-live]');
    if (!el) return;
    clearTimeout(liveTimers.get(el));
    liveTimers.set(el, setTimeout(function () {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, 700));
  });

  // Any element with data-patch sends a PATCH when it changes.
  document.addEventListener('change', function (event) {
    var el = event.target.closest('[data-patch]');
    if (!el) return;
    var value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-live')) {
      clearTimeout(liveTimers.get(el));
      var last = el.hasAttribute('data-saved') ? el.getAttribute('data-saved') : el.defaultValue;
      if (last === String(value)) return;
    }
    if (el.type === 'number') {
      // An emptied box is not a zero. Leave what is saved alone.
      if (String(value).trim() === '') return;
      value = Number(value);
      if (!isFinite(value)) return;
    }
    if (el.getAttribute('data-patch-type') === 'list') {
      // "a, b" and one-per-line both mean a list.
      value = String(value).split(/[,\\n]/).map(function (item) { return item.trim(); }).filter(Boolean);
    }
    if (el.getAttribute('data-patch-type') === 'json') {
      // A select whose options are arrays, or an editor that serialises itself.
      try { value = JSON.parse(String(value)); } catch (e) { return; }
    }
    var body = {};
    el.getAttribute('data-patch').split('.').reduce(function (node, key, i, keys) {
      node[key] = i === keys.length - 1 ? value : {};
      return node[key];
    }, body);

    fetch(API + '/admin/settings', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) throw new Error('save failed');
      if (el.hasAttribute('data-live')) {
        // No banner pushing the box down while someone is still typing in it.
        el.setAttribute('data-saved', String(value));
        return;
      }
      flash('good', 'Saved.');
    }).catch(function () {
      flash('bad', 'That did not save. Check your connection and try again.');
      if (el.type === 'checkbox') el.checked = !el.checked;
    });
  });

  // Anything destructive asks first, every time.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var confirmText = form.getAttribute('data-confirm');
    if (confirmText && !window.confirm(confirmText)) { event.preventDefault(); return; }
    // A slow form (drafting with the model) says it is working, and cannot be
    // sent twice. Disabled a tick later, so the button's own value still goes.
    var busy = form.getAttribute('data-busy');
    if (busy && !event.defaultPrevented) {
      var button = event.submitter || form.querySelector('button');
      form.setAttribute('aria-busy', 'true');
      setTimeout(function () {
        if (!button) return;
        button.disabled = true;
        var label = button.querySelector('span');
        if (label) label.textContent = busy;
      }, 0);
    }
  });

  // data-copy="<id>" copies that element's text, e.g. a setup prompt.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    var source = document.getElementById(button.getAttribute('data-copy'));
    if (!source || !navigator.clipboard) return;
    navigator.clipboard.writeText(source.textContent).then(function () {
      var agentInstruction = button.hasAttribute('data-agent-instruction');
      flash('good', agentInstruction ? 'Copied! Paste to your agent' : 'Copied.');
      if (agentInstruction) {
        clearTimeout(button._copyTimer);
        button.textContent = 'Copied! Paste to your agent';
        button.classList.add('db-agent-copied');
        button._copyTimer = setTimeout(function () {
          button.textContent = 'Agent Instruction';
          button.classList.remove('db-agent-copied');
        }, 3000);
      }
    }, function () {
      flash('bad', 'Could not copy. Select the text and copy it instead.');
    });
  });

  // Command palette: everything in the rail, by keyboard.
  var palette = null;
  var restoreFocus = null;
  document.addEventListener('keydown', function (event) {
    if (PALETTE && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
    }
    if (event.key === 'Escape' && palette) closePalette();
  });

  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function openPalette() {
    if (palette) return;
    restoreFocus = document.activeElement;
    var links = Array.prototype.map.call(document.querySelectorAll('.db-rail .db-nav'), function (a) {
      // The label only: the badge count is not part of the name.
      var label = a.querySelector('.db-nav__label');
      return { label: (label ? label.textContent : a.textContent).trim(), href: a.getAttribute('href') };
    });

    palette = document.createElement('div');
    palette.className = 'db-palette';
    palette.innerHTML =
      '<div class="db-palette__box" role="dialog" aria-modal="true" aria-label="Command palette">' +
      '<input class="db-palette__input" placeholder="Jump to…" aria-label="Jump to">' +
      '<ul class="db-palette__list"></ul></div>';
    document.body.appendChild(palette);

    var box = palette.querySelector('.db-palette__box');
    var input = palette.querySelector('input');
    var list = palette.querySelector('ul');
    var active = 0;

    function matching() {
      var term = input.value.toLowerCase();
      return links.filter(function (l) { return l.label.toLowerCase().indexOf(term) > -1; });
    }

    function render() {
      var matches = matching();
      if (active >= matches.length) active = Math.max(0, matches.length - 1);
      list.innerHTML = matches.map(function (l, i) {
        return '<li><a href="' + esc(l.href) + '"' + (i === active ? ' aria-current="true"' : '') + '>' + esc(l.label) + '</a></li>';
      }).join('');
      return matches;
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', function (event) {
      var matches = matching();
      if (event.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); render(); event.preventDefault(); }
      if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); event.preventDefault(); }
      if (event.key === 'Enter' && matches[active]) { window.location.href = matches[active].href; }
    });
    // Tab stays inside the dialog: the input and whichever links are showing.
    box.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var focusable = box.querySelectorAll('input, a[href]');
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    });
    palette.addEventListener('click', function (event) { if (event.target === palette) closePalette(); });

    render();
    input.focus();
  }

  function closePalette() {
    if (!palette) return;
    palette.remove();
    palette = null;
    // Focus goes back to wherever it was, so closing is not a dead end.
    if (restoreFocus && typeof restoreFocus.focus === 'function') restoreFocus.focus();
    restoreFocus = null;
  }
})();
`;
