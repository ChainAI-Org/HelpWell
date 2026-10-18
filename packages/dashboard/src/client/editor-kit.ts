/**
 * The editor kit's behaviour in the browser, for what markup alone cannot do
 * (editor-kit/script.ts puts it on a page).
 *
 *   - The composer: editing formatted text and writing Markdown back into
 *     its textarea as it changes, the toolbar (emoji, link, personalise,
 *     Markdown on and off, Write with AI) and the character count.
 *   - Lists: choosing a row shows its panel only; dragging a row posts the
 *     form with the list's reorder op.
 *   - Popovers close on a click elsewhere or Escape, one open at a time, and
 *     the summary accordion keeps one open where `<details name>` does not.
 *   - Media blocks: an image's size and a video file's length, the thumbnail
 *     following the address box, the alt-text dot, and uploads.
 *   - The preview's Desktop / Mobile switch.
 *   - The top bar's saved-state line turning to "unsaved" on the first change,
 *     and a warning before leaving with changes.
 *
 * Every hook is a `data-ek-*` attribute the kit's own markup writes, so a
 * page gets all of it by drawing with the kit and including this once.
 * Without it, every form still posts and every panel still shows.
 */

export const EDITOR_KIT_JS = `
(function () {
  'use strict';
  document.documentElement.classList.add('ek-js');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function safeLink(href) {
    var v = String(href).trim().toLowerCase();
    if (/^[\\/\\\\][\\/\\\\]/.test(v)) return false;
    return v.charAt(0) === '/' || v.charAt(0) === '#' || v.indexOf('https://') === 0 || v.indexOf('http://') === 0 || v.indexOf('mailto:') === 0;
  }

  /* ------------------------------------------------------ popovers */

  function closePops(except) {
    document.querySelectorAll('details.ek-pop[open]').forEach(function (d) {
      if (d !== except && !d.contains(except)) d.open = false;
    });
  }
  document.addEventListener('toggle', function (event) {
    var d = event.target;
    if (d.matches && d.matches('details.ek-pop') && d.open) {
      closePops(d);
      var first = d.querySelector('.ek-pop__panel input:not([type=hidden]), .ek-pop__panel textarea, .ek-pop__panel select');
      if (first) setTimeout(function () { first.focus(); }, 0);
    }
  }, true);
  document.addEventListener('click', function (event) {
    if (!event.target.closest('details.ek-pop')) closePops(null);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = event.target.closest && event.target.closest('details.ek-pop[open]');
    if (open) { open.open = false; var s = open.querySelector('summary'); if (s) s.focus(); }
  });

  // One summary open at a time where the browser does not group <details name>.
  document.querySelectorAll('details[data-ek-accordion]').forEach(function (section) {
    section.addEventListener('toggle', function () {
      if (!section.open) return;
      document.querySelectorAll('details[data-ek-accordion]').forEach(function (other) {
        if (other !== section && other.open && other.getAttribute('name') === section.getAttribute('name')) other.open = false;
      });
    });
  });

  /* --------------------------------------------------------- lists */

  function select(panel) {
    var group = panel.parentElement;
    Array.prototype.forEach.call(group.children, function (p) {
      if (p.hasAttribute('data-ek-panel')) p.toggleAttribute('data-ek-current', p === panel);
    });
    document.querySelectorAll('[data-ek-select]').forEach(function (row) {
      var target = document.getElementById(row.getAttribute('data-ek-select'));
      if (!target || target.parentElement !== group) return;
      if (target === panel) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    });
    panel.dispatchEvent(new CustomEvent('ek:select', { bubbles: true, detail: { id: panel.id } }));
  }
  document.addEventListener('click', function (event) {
    var row = event.target.closest('[data-ek-select]');
    if (!row) return;
    var panel = document.getElementById(row.getAttribute('data-ek-select'));
    if (!panel || !panel.hasAttribute('data-ek-panel')) return;
    event.preventDefault();
    select(panel);
  });
  if (location.hash) {
    var hashed = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (hashed && hashed.hasAttribute('data-ek-panel')) select(hashed);
  }

  document.querySelectorAll('[data-ek-reorder]').forEach(function (list) {
    var dragged = null;
    var target = null;
    function rows() { return Array.prototype.slice.call(list.querySelectorAll('[data-ek-path]')); }
    function clear() { rows().forEach(function (r) { r.classList.remove('ek-drop-before', 'ek-drop-after'); }); }
    function place(event) {
      var over = event.target.closest('[data-ek-path]');
      if (!over || over === dragged) return null;
      var box = over.getBoundingClientRect();
      var grid = list.classList.contains('ek-thumbs');
      var after = grid ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
      return { row: over, after: after };
    }
    list.addEventListener('dragstart', function (event) {
      dragged = event.target.closest('[data-ek-path]');
      if (!dragged) return;
      dragged.classList.add('ek-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragged.getAttribute('data-ek-path'));
    });
    list.addEventListener('dragover', function (event) {
      if (!dragged) return;
      event.preventDefault();
      clear();
      target = place(event);
      if (!target) return;
      var all = rows();
      var next = all[all.indexOf(target.row) + 1];
      if (!target.after) target.row.classList.add('ek-drop-before');
      else if (next && next !== dragged) next.classList.add('ek-drop-before');
      else target.row.classList.add('ek-drop-after');
    });
    list.addEventListener('drop', function (event) {
      event.preventDefault();
      if (!dragged || !target) return;
      var all = rows();
      var from = all.indexOf(dragged);
      var to = all.indexOf(target.row) + (target.after ? 1 : 0);
      if (from < to) to -= 1;
      clear();
      if (to === from) return;
      var form = list.closest('form');
      if (!form) return;
      var op = document.createElement('input');
      op.type = 'hidden';
      op.name = list.getAttribute('data-ek-op') || 'op';
      op.value = list.getAttribute('data-ek-reorder').replace('{from}', dragged.getAttribute('data-ek-path')).replace('{to}', String(to));
      form.appendChild(op);
      form.setAttribute('data-ek-submitting', '');
      form.submit();
    });
    list.addEventListener('dragend', function () {
      if (dragged) dragged.classList.remove('ek-dragging');
      dragged = null;
      target = null;
      clear();
    });
  });

  /* ------------------------------------------------------ composer */

  function inline(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\\u00a0/g, ' ');
    if (node.nodeType !== 1) return '';
    if (node.hasAttribute('data-ek-merge')) return '{{' + node.getAttribute('data-ek-merge') + '}}';
    var tag = node.tagName;
    if (tag === 'BR') return ' ';
    var inner = '';
    node.childNodes.forEach(function (child) { inner += inline(child); });
    if (!inner.trim()) return inner;
    var style = node.getAttribute('style') || '';
    if (tag === 'STRONG' || tag === 'B' || /font-weight:\\s*(bold|[6-9]00)/.test(style)) return wrap(inner, '**');
    if (tag === 'EM' || tag === 'I' || /font-style:\\s*italic/.test(style)) return wrap(inner, '_');
    if (tag === 'CODE') return '\`' + inner + '\`';
    if (tag === 'A') {
      var href = node.getAttribute('href') || '';
      return href && safeLink(href) ? '[' + inner.trim() + '](' + href + ')' : inner;
    }
    return inner;
  }
  function wrap(text, mark) {
    var m = /^(\\s*)([\\s\\S]*?)(\\s*)$/.exec(text);
    return m[1] + mark + m[2] + mark + m[3];
  }
  function line(node) {
    var out = '';
    node.childNodes.forEach(function (child) { out += inline(child); });
    return out.replace(/\\s+/g, ' ').trim();
  }
  function blocks(node, out) {
    node.childNodes.forEach(function (child) {
      if (child.nodeType === 3) { var t = child.nodeValue.replace(/\\s+/g, ' ').trim(); if (t) out.push(t); return; }
      if (child.nodeType !== 1) return;
      var tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) { var h = line(child); if (h) out.push(new Array(Number(tag.charAt(1)) + 1).join('#') + ' ' + h); return; }
      if (tag === 'UL' || tag === 'OL') {
        var items = [];
        Array.prototype.forEach.call(child.children, function (li, i) {
          var text = line(li);
          if (text) items.push((tag === 'OL' ? (i + 1) + '. ' : '- ') + text);
        });
        if (items.length) out.push(items.join('\\n'));
        return;
      }
      if (child.querySelector && child.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol')) { blocks(child, out); return; }
      if (tag === 'BR') return;
      var text = line(child);
      if (text) out.push(text);
    });
    return out;
  }
  function toMarkdown(root) { return blocks(root, []).join('\\n\\n'); }

  // A merge field as a chip: its key, and any fallback, as composer.ts draws it.
  function merge(key, fallback) {
    var said = fallback.replace(/^\\|/, '').trim();
    return '<span class="ek-merge" contenteditable="false" data-ek-merge="' + key + fallback + '"' +
      (said ? ' title="If empty: ' + said + '"' : '') + '>@' + key + '</span>';
  }
  function inlineHtml(text) {
    return esc(text)
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\{\\{\\s*([\\w.-]+)\\s*(\\|[^{}]*)?\\}\\}/g, function (m, key, fallback) {
        return merge(key, fallback || '');
      })
      .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function (m, label, href) {
        return safeLink(href.replace(/&amp;/g, '&')) ? '<a href="' + href + '">' + label + '</a>' : label;
      })
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/(^|[\\s(])\\*([^*]+)\\*/g, '$1<em>$2</em>')
      .replace(/(^|[\\s(])_([^_]+)_/g, '$1<em>$2</em>');
  }
  function toHtml(markdown) {
    return String(markdown).replace(/\\r\\n/g, '\\n').trim().split(/\\n{2,}/).filter(function (b) { return b.trim(); }).map(function (block) {
      var lines = block.split('\\n');
      if (lines.every(function (l) { return /^\\s*[-*]\\s+/.test(l); })) {
        return '<ul>' + lines.map(function (l) { return '<li>' + inlineHtml(l.replace(/^\\s*[-*]\\s+/, '')) + '</li>'; }).join('') + '</ul>';
      }
      if (lines.every(function (l) { return /^\\s*\\d+[.)]\\s+/.test(l); })) {
        return '<ol>' + lines.map(function (l) { return '<li>' + inlineHtml(l.replace(/^\\s*\\d+[.)]\\s+/, '')) + '</li>'; }).join('') + '</ol>';
      }
      var h = /^(#{1,6})\\s+(.*)$/.exec(lines[0]);
      if (h) {
        var level = Math.min(h[1].length, 4);
        var rest = lines.slice(1).join(' ').trim();
        return '<h' + level + '>' + inlineHtml(h[2]) + '</h' + level + '>' + (rest ? '<p>' + inlineHtml(rest) + '</p>' : '');
      }
      return '<p>' + inlineHtml(lines.join(' ')) + '</p>';
    }).join('');
  }
  function isSimple(markdown) {
    return String(markdown).replace(/\\r\\n/g, '\\n').split('\\n').every(function (l) {
      if (/^\\s{2,}\\S/.test(l)) return false;
      if (/^\\s*(>|:::|\\||\`\`\`|~~~|<|---\\s*$|\\*\\*\\*\\s*$|___\\s*$)/.test(l)) return false;
      if (/!\\[/.test(l)) return false;
      if (/^={3,}|^-{3,}/.test(l)) return false;
      return true;
    });
  }
  function plainLength(markdown) {
    var text = String(markdown).replace(/\\r\\n/g, '\\n')
      .replace(/\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
      .replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, '$1')
      .replace(/^#{1,6}\\s+/gm, '')
      .replace(/^\\s*(?:[-*]|\\d+[.)])\\s+/gm, '')
      .replace(/(\\*\\*|__|\\*|_|\`)/g, '')
      .replace(/\\n{2,}/g, '\\n')
      .trim();
    return Array.from(text).length;
  }

  document.querySelectorAll('[data-ek-composer]').forEach(function (root) {
    var rich = root.querySelector('.ek-composer__rich');
    var source = root.querySelector('.ek-composer__source');
    var count = root.querySelector('[data-ek-count]');
    var toggle = root.querySelector('[data-ek-markdown]');
    var max = Number(root.getAttribute('data-max')) || 0;
    var oneLine = root.hasAttribute('data-line');
    var saved = null;
    var undo = null;

    function isRich() { return root.getAttribute('data-mode') === 'rich'; }
    function empty() {
      rich.setAttribute('data-empty', String(!rich.textContent.trim() && !rich.querySelector('[data-ek-merge]')));
    }
    function counter() {
      if (!count) return;
      var n = plainLength(source.value);
      count.textContent = max ? n + ' / ' + max : String(n);
      count.setAttribute('data-over', String(max > 0 && n > max));
    }
    function sync() {
      var markdown = toMarkdown(rich);
      if (markdown !== source.value) {
        source.value = markdown;
        fire(source, 'input');
      }
      empty();
      counter();
    }
    function setMode(mode) {
      root.setAttribute('data-mode', mode);
      if (toggle) toggle.setAttribute('aria-pressed', String(mode !== 'rich'));
    }
    function setValue(markdown) {
      source.value = markdown;
      if (isSimple(markdown)) { rich.innerHTML = toHtml(markdown); setMode('rich'); }
      else setMode('source');
      empty();
      counter();
      fire(source, 'input');
      fire(source, 'change');
    }
    function remember() {
      var selection = window.getSelection();
      if (selection && selection.rangeCount && rich.contains(selection.anchorNode)) saved = selection.getRangeAt(0).cloneRange();
    }
    function restore() {
      rich.focus();
      if (!saved) return;
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(saved);
    }
    function insert(text, htmlText) {
      if (isRich()) {
        restore();
        if (htmlText) document.execCommand('insertHTML', false, htmlText);
        else document.execCommand('insertText', false, text);
        sync();
      } else {
        var start = source.selectionStart, end = source.selectionEnd;
        source.setRangeText(text, start, end, 'end');
        source.focus();
        fire(source, 'input');
        counter();
      }
      closePops(null);
    }

    empty();
    rich.addEventListener('input', sync);
    rich.addEventListener('blur', sync);
    rich.addEventListener('keyup', remember);
    rich.addEventListener('mouseup', remember);
    source.addEventListener('input', counter);
    rich.addEventListener('keydown', function (event) {
      var key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && (key === 'b' || key === 'i')) {
        event.preventDefault();
        document.execCommand(key === 'b' ? 'bold' : 'italic');
        sync();
      } else if (event.key === 'Enter' && (oneLine || event.shiftKey)) {
        event.preventDefault();
        if (!oneLine) document.execCommand('insertParagraph');
      }
    });
    rich.addEventListener('paste', function (event) {
      event.preventDefault();
      var text = (event.clipboardData || window.clipboardData).getData('text/plain');
      if (oneLine) text = text.replace(/\\s*\\n\\s*/g, ' ');
      document.execCommand('insertText', false, text);
    });

    if (toggle) toggle.addEventListener('click', function () {
      if (isRich()) { sync(); setMode('source'); source.focus(); return; }
      if (!isSimple(source.value)) {
        toggle.title = 'This text uses Markdown the formatted view cannot show, so it stays as Markdown.';
        toggle.animate && toggle.animate([{ transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 180 });
        return;
      }
      rich.innerHTML = toHtml(source.value);
      empty();
      setMode('rich');
      rich.focus();
    });

    root.querySelectorAll('[data-ek-emoji]').forEach(function (button) {
      button.addEventListener('click', function () { insert(button.textContent); });
    });
    root.querySelectorAll('[data-ek-merge-insert]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-ek-merge-insert');
        var bar = key.indexOf('|');
        insert('{{' + key + '}}', merge(esc(bar < 0 ? key : key.slice(0, bar)), esc(bar < 0 ? '' : key.slice(bar))) + '&nbsp;');
      });
    });

    var linkUrl = root.querySelector('[data-ek-link-url]');
    var linkGo = root.querySelector('[data-ek-link-go]');
    if (linkUrl && linkGo) {
      var addLink = function () {
        var url = linkUrl.value.trim();
        if (!url || !safeLink(url)) { linkUrl.setCustomValidity('Use an https:// address or a path like /pricing.'); linkUrl.reportValidity(); return; }
        linkUrl.setCustomValidity('');
        if (isRich()) {
          restore();
          var selection = window.getSelection();
          if (selection && !selection.isCollapsed) document.execCommand('createLink', false, url);
          else document.execCommand('insertHTML', false, '<a href="' + esc(url) + '">' + esc(url) + '</a>&nbsp;');
          sync();
          closePops(null);
        } else {
          var start = source.selectionStart, end = source.selectionEnd;
          var words = source.value.slice(start, end) || url;
          insert('[' + words + '](' + url + ')');
        }
        linkUrl.value = '';
      };
      linkGo.addEventListener('click', addLink);
      linkUrl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); addLink(); }
      });
    }

    var ai = root.querySelector('[data-ek-ai]');
    if (ai) {
      var status = ai.querySelector('.ek-ai__status');
      var prompt = ai.querySelector('[data-ek-ai-prompt]');
      var undoButton = ai.querySelector('[data-ek-ai-undo]');
      var write = function (instruction) {
        if (!instruction) { if (prompt) prompt.focus(); return; }
        if (isRich()) sync();
        var body = new FormData();
        body.append('markdown', source.value);
        body.append('instruction', instruction);
        body.append('context', ai.getAttribute('data-ek-ai-context') || '');
        ai.setAttribute('aria-busy', 'true');
        status.removeAttribute('data-tone');
        status.textContent = 'Writing…';
        fetch(ai.getAttribute('data-ek-ai'), { method: 'POST', credentials: 'same-origin', body: body })
          .then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) { return { ok: response.ok, data: data }; });
          })
          .then(function (result) {
            ai.removeAttribute('aria-busy');
            if (!result.ok || typeof result.data.markdown !== 'string') {
              status.setAttribute('data-tone', 'bad');
              status.textContent = result.data.error || 'That did not work. Try again.';
              return;
            }
            undo = source.value;
            setValue(result.data.markdown);
            status.textContent = 'Written. Check it reads right before you save.';
            if (undoButton) undoButton.hidden = false;
          })
          .catch(function () {
            ai.removeAttribute('aria-busy');
            status.setAttribute('data-tone', 'bad');
            status.textContent = 'That did not reach the server. Check your connection.';
          });
      };
      ai.querySelectorAll('[data-ek-ai-preset]').forEach(function (button) {
        button.addEventListener('click', function () { write(button.getAttribute('data-ek-ai-preset')); });
      });
      var go = ai.querySelector('[data-ek-ai-go]');
      if (go) go.addEventListener('click', function () { write(prompt ? prompt.value.trim() : ''); });
      if (undoButton) undoButton.addEventListener('click', function () {
        if (undo === null) return;
        setValue(undo);
        undo = null;
        undoButton.hidden = true;
        status.textContent = 'Put back as it was.';
      });
    }
  });

  /* ---------------------------------------------------------- media */

  function withSize(meta, size) {
    var parts = String(meta).split(' · ');
    parts.splice(1, 0, size);
    return parts.join(' · ');
  }
  function duration(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    var s = Math.round(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function describeImage(img) {
    var block = img.closest('[data-ek-media]');
    var meta = block && block.querySelector('[data-ek-meta]');
    if (!meta || !img.naturalWidth) return;
    meta.textContent = withSize(meta.getAttribute('data-ek-meta'), img.naturalWidth + ' × ' + img.naturalHeight);
  }
  document.querySelectorAll('[data-ek-img]').forEach(function (img) {
    if (img.complete) describeImage(img);
    img.addEventListener('load', function () { describeImage(img); });
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
  });
  document.querySelectorAll('video[data-ek-duration]').forEach(function (video) {
    video.addEventListener('loadedmetadata', function () {
      var badge = video.parentElement.querySelector('[data-ek-dur]');
      if (badge) badge.textContent = duration(video.duration);
    });
  });
  document.addEventListener('input', function (event) {
    var describe = event.target.closest('[data-ek-describe]');
    if (!describe) return;
    var block = describe.closest('[data-ek-media]');
    var dot = block && block.querySelector('[data-ek-okdot]');
    if (dot) dot.setAttribute('data-on', String(Boolean(describe.value.trim())));
  });
  function showMedia(block, url) {
    var thumb = block.querySelector('[data-ek-thumb]');
    var name = block.querySelector('[data-ek-name]');
    var kind = block.getAttribute('data-ek-media');
    var clean = String(url || '').trim();
    if (name && clean) name.textContent = decodeURIComponent(clean.split('?')[0].split('/').filter(Boolean).pop() || clean);
    if (!thumb || kind === 'video' || !(clean.charAt(0) === '/' || /^https?:\\/\\//i.test(clean)) || /^\\/\\//.test(clean)) return;
    thumb.className = 'ek-media__thumb';
    thumb.innerHTML = '';
    var img = document.createElement('img');
    img.alt = '';
    img.src = clean;
    img.setAttribute('data-ek-img', '');
    img.addEventListener('load', function () { describeImage(img); });
    thumb.appendChild(img);
    if (kind === 'gif') {
      var badge = document.createElement('span');
      badge.className = 'ek-media__badge';
      badge.textContent = 'GIF';
      thumb.appendChild(badge);
    }
  }
  document.addEventListener('change', function (event) {
    var block = event.target.closest('[data-ek-media]');
    if (block && event.target.matches('[data-ek-media-url]')) showMedia(block, event.target.value);
  });

  document.querySelectorAll('input[type=file][data-ek-upload-for]').forEach(function (input) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var form = input.closest('form');
      var host = input.closest('[data-ek-upload-url]');
      var url = host && host.getAttribute('data-ek-upload-url');
      var name = input.getAttribute('data-ek-upload-for');
      var box = form && form.elements.namedItem(name);
      var note = document.querySelector('[data-ek-upload-status="' + CSS.escape(name) + '"]');
      if (!url || !box) return;
      var body = new FormData();
      body.append('file', file);
      if (note) note.textContent = 'Uploading…';
      fetch(url, { method: 'POST', credentials: 'same-origin', body: body })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (data.url) {
            box.value = data.url;
            fire(box, 'input');
            fire(box, 'change');
            if (note) note.textContent = 'Uploaded.';
          } else if (note) {
            note.textContent = data.error || 'That did not upload.';
          }
        })
        .catch(function () { if (note) note.textContent = 'That did not upload. Check your connection.'; });
      input.value = '';
    });
  });

  /* -------------------------------------------------------- preview */

  document.querySelectorAll('button[data-ek-device]').forEach(function (button) {
    button.addEventListener('click', function () {
      var device = button.getAttribute('data-ek-device');
      var panel = button.closest('.ek-preview') || document;
      var frame = panel.querySelector('.ek-frame');
      if (frame) {
        frame.setAttribute('data-device', device);
        frame.dispatchEvent(new CustomEvent('ek:device', { bubbles: true, detail: { device: device } }));
      }
      panel.querySelectorAll('button[data-ek-device]').forEach(function (other) {
        other.setAttribute('aria-pressed', String(other === button));
      });
    });
  });

  // Unsaved changes are protected by shell.ts, including embedded navigation.
})();
`;

/**
 * Marks the page as having script before the editor is drawn (editorShell),
 * so script-only states such as one list panel at a time apply from the
 * first paint rather than after the kit's script runs at the end.
 */
export const EDITOR_MARK_JS = `document.documentElement.classList.add('ek-js');
`;
