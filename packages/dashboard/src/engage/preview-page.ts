/**
 * The page inside the editor's preview frame.
 *
 * A faint stand-in for the customer's app, drawn as the design canvas draws
 * it: a sidebar, a top bar, a page title with its main button, three cards
 * and a list, in pale greys, with the HelpWell launcher in the corner. The
 * engagement being edited is drawn over it by the widget's own engage
 * renderer, loaded from the API as `engage-preview.js`; the editor posts
 * each draft into the frame (see the widget's engage/preview.ts).
 *
 * The page title's button is the stand-in element: where a hotspot or tour
 * step points when its selector matches nothing here. Unused, it is just
 * another grey button; used, it turns dark and shows the selector it stands
 * in for.
 *
 * Nothing on this page is the customer's data, so it is the same for every
 * engagement, and it is served with the dashboard's own auth like any page.
 *
 * It is a real page on the dashboard's own origin, not a `srcdoc` or blob
 * document, so it runs under the dashboard's policy (`script-src 'self'`)
 * with nothing of its own: both its scripts are files, the frame's small one
 * from `_assets/` (client/preview-frame.ts, which shows the notice below
 * when the renderer fails to load) and the renderer from the API.
 */

import { escapeHtml } from '@helpwell/ui';
import { clientScript } from '../client/index.js';
import type { DashboardContext } from '../layout.js';

/** The HelpWell mark: the launcher is the bare mark, never inside a circle. */
const MARK = `<svg viewBox="0 0 152 152" width="46" height="46" aria-hidden="true"><g transform="translate(24 11)"><path d="M 28 0 H 76 C 94 0 104 11 104 29 V 75 C 104 94 93 104 76 104 H 29 L 7 128 Q 0 135 0 125 V 29 C 0 11 10 0 28 0 Z" fill="#7A3BEB"/><path d="M 39 26 H 65 Q 78 26 78 39 V 65 Q 78 78 65 78 H 39 Q 26 78 26 65 V 39 Q 26 26 39 26 Z" fill="#FFFFFF"/><path d="M 0 18 C 3 7 11 0 24 0 C 37 0 45 7 48 18 Z" fill="#7A3BEB" transform="translate(31.36 49) scale(.36)"/><path d="M 0 18 C 3 7 11 0 24 0 C 37 0 45 7 48 18 Z" fill="#7A3BEB" transform="translate(55.36 49) scale(.36)"/></g></svg>`;

export function previewPage(context: DashboardContext): string {
  const script = `${context.apiPath.replace(/\/+$/, '')}/assets/engage-preview.js`;
  const side = [70, 62, 78, 58, 50, 64]
    .map(
      (w, i) =>
        `<span class="${i === 2 ? 'gd' : 'g'}" style="width:${w}%;margin-top:${i === 0 ? 20 : 15}px"></span>`,
    )
    .join('');
  const cards = ['#CFCBDA', '#E6EFFD', '#F0EEF6']
    .map(
      (c) =>
        `<div class="card"><span class="swatch" style="background:${c}"></span><span class="g" style="width:60%;background:#E4E0EE"></span><span class="g thin" style="width:86%"></span><span class="g thin" style="width:70%"></span></div>`,
    )
    .join('');
  const rows = [
    [150, 50],
    [120, 65],
    [165, 45],
    [105, 60],
    [138, 55],
  ]
    .map(
      ([a, b]) =>
        `<div class="row"><span class="tick"></span><span class="g" style="width:${a}px"></span><span class="g" style="width:${b}px;margin-left:auto"></span></div>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Preview</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { font: 14px/1.5 system-ui, "Segoe UI", sans-serif; color: #4F4B60; background: #FAF9FC; overflow: auto; }
  .app { display: flex; min-height: 100%; }
  .side { width: 115px; flex: none; background: #FFFFFF; border-right: 1px solid #F1EFF7; padding: 15px 12px; }
  .brand { display: flex; align-items: center; gap: 6px; }
  .brand i { width: 18px; height: 18px; border-radius: 5px; background: #BDB8CB; }
  .brand b { width: 55px; height: 9px; border-radius: 5px; background: #DCD8E8; }
  .g, .gd { display: block; height: 9px; border-radius: 5px; background: #EFEDF5; }
  .gd { background: #DCD8E8; }
  .g.thin { height: 6px; }
  .main { flex: 1; min-width: 0; }
  .top { height: 38px; background: #FFFFFF; border-bottom: 1px solid #F1EFF7; display: flex; align-items: center; padding: 0 15px; }
  .top .g { width: 150px; height: 15px; border-radius: 6px; }
  .content { padding: 18px 15px; display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .head .gd { width: 138px; height: 14px; }
  .cards { display: flex; gap: 10px; margin-top: 5px; }
  .card { flex: 1; height: 115px; border-radius: 11px; border: 1px solid #F1EFF7; background: #FFFFFF; padding: 11px; display: flex; flex-direction: column; gap: 8px; }
  .swatch { width: 22px; height: 22px; border-radius: 6px; }
  .label { width: 88px; height: 10px; margin-top: 10px; background: #E4E0EE; }
  .list { border: 1px solid #F1EFF7; border-radius: 11px; background: #FFFFFF; }
  .row { display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 11px; border-top: 1px solid #F4F2F8; }
  .row:first-child { border-top: 0; }
  .tick { width: 15px; height: 15px; border-radius: 5px; background: #EFEDF5; flex: none; }
  .launch { position: fixed; right: 15px; bottom: 10px; display: block; filter: drop-shadow(0 8px 12px rgba(122,59,235,.38)); }
  [data-helpwell-stand-in] {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: none;
    height: 23px; min-width: 72px; max-width: 58%; padding: 0 10px; border-radius: 7px;
    background: #CFCBDA; color: transparent; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    font: 600 11px/1 ui-monospace, "SF Mono", Consolas, monospace;
  }
  [data-helpwell-stand-in][data-selector] { background: #171425; color: #FFFFFF; }
  [data-helpwell-stand-in][data-selector]::after { content: attr(data-selector); overflow: hidden; text-overflow: ellipsis; }
  .missing { display: none; position: fixed; left: 16px; right: 16px; top: 60px; padding: 14px 16px; border-radius: 12px; background: #FDF2DD; color: #9A6206; }
  .no-preview .missing { display: block; }
  @media (max-width: 420px) { .side { display: none; } .cards .card:nth-child(3) { display: none; } }
</style>
</head>
<body>
<div class="app" aria-hidden="true">
  <div class="side"><div class="brand"><i></i><b></b></div>${side}</div>
  <div class="main">
    <div class="top"><span class="g"></span></div>
    <div class="content">
      <div class="head"><span class="gd"></span><span data-helpwell-stand-in></span></div>
      <span class="g" style="width:238px;height:7px"></span>
      <div class="cards">${cards}</div>
      <span class="g label"></span>
      <div class="list">${rows}</div>
    </div>
  </div>
</div>
<span class="launch" aria-hidden="true">${MARK}</span>
<p class="missing" role="alert">The preview could not load the widget from ${escapeHtml(script)}.</p>
${clientScript(context, 'preview-frame').value}
<script src="${escapeHtml(script)}" data-preview-renderer></script>
</body>
</html>`;
}
