/**
 * The page inside the form builder's preview frame.
 *
 * A stand-in for the customer's site: a header, a hero with a spot where an
 * embed goes, a column of copy, and a widget panel for the Home tab. The
 * widget's form renderer, loaded from the API as `forms-preview.js`, draws
 * each draft the builder posts into it (see the widget's forms/preview.ts):
 * an embed or a Home block into its spot, the other placements over the page.
 * Nothing here is the customer's data, so it is the same for every form.
 *
 * Like the engage preview (engage/preview-page.ts), it is a real page on the
 * dashboard's origin under the dashboard's own policy: its scripts are the
 * frame's from `_assets/` and the renderer from the API, and none is inline.
 */

import { escapeHtml } from '@helpwell/ui';
import { clientScript } from '../client/index.js';
import type { DashboardContext } from '../layout.js';

export function formsPreviewPage(context: DashboardContext): string {
  const script = `${context.apiPath.replace(/\/+$/, '')}/assets/forms-preview.js`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Preview</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { font: 14px/1.5 system-ui, "Segoe UI", sans-serif; color: #4F4B60; background: #F3F1F9; }
  .top { display: flex; align-items: center; gap: 14px; height: 52px; padding: 0 18px; background: #fff; border-bottom: 1px solid #ECEAF3; }
  .logo { width: 26px; height: 26px; border-radius: 8px; background: #D9CCFB; }
  .bar { display: block; height: 10px; border-radius: 6px; background: #ECEAF3; }
  .page { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; padding: 26px 22px; }
  .main { display: grid; gap: 18px; align-content: start; }
  .hero { display: grid; gap: 10px; padding: 8px 0 4px; }
  .embed { display: block; }
  .embed:empty::before { content: ""; display: block; height: 180px; border-radius: 14px; border: 1.5px dashed #D9CCFB; }
  .copy { display: grid; gap: 10px; }
  .panel { align-self: start; border-radius: 22px; background: #fff; box-shadow: 0 12px 32px rgba(23,20,37,.12); overflow: hidden; }
  .panel__head { height: 88px; background: linear-gradient(135deg, #7A3BEB, #9B7BFF); }
  .panel__body { display: grid; gap: 12px; padding: 14px; }
  .missing { display: none; margin: 24px; padding: 14px 16px; border-radius: 12px; background: #FDF2DD; color: #9A6206; }
  .no-preview .missing { display: block; }
  @media (max-width: 700px) { .page { grid-template-columns: 1fr; } .panel { display: none; } .panel.home-on { display: block; } }
</style>
</head>
<body>
<div class="top" aria-hidden="true"><span class="logo"></span><span class="bar" style="width:120px"></span><span class="bar" style="width:80px;margin-left:auto"></span></div>
<div class="page">
  <div class="main">
    <div class="hero" aria-hidden="true"><span class="bar" style="width:55%;height:18px"></span><span class="bar" style="width:75%"></span></div>
    <div class="embed" data-form-preview-target="inline"></div>
    <div class="copy" aria-hidden="true"><span class="bar"></span><span class="bar" style="width:92%"></span><span class="bar" style="width:84%"></span><span class="bar" style="width:66%"></span><span class="bar"></span><span class="bar" style="width:72%"></span></div>
  </div>
  <div class="panel" aria-label="The widget's Home tab">
    <div class="panel__head"></div>
    <div class="panel__body"><span class="bar" style="width:70%"></span><div data-form-preview-target="home"></div><span class="bar" style="width:50%"></span></div>
  </div>
</div>
<p class="missing" role="alert">The preview could not load the form renderer from ${escapeHtml(script)}.</p>
${clientScript(context, 'preview-frame').value}
<script src="${escapeHtml(script)}" data-preview-renderer></script>
</body>
</html>`;
}
