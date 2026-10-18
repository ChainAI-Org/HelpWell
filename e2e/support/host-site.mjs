/**
 * "Another site": a page on a second origin that embeds Ridgeline's widget.
 *
 * It stands in for a marketing site on its own domain. The page is on
 * 127.0.0.1 and the HelpWell API on localhost, so the browser treats every
 * call as cross-site: the API's cookie is never stored or sent, and the widget
 * has to keep its visitor in the X-HelpWell-Visitor header instead. The
 * playground lists this origin in HELPWELL_CORS_ORIGINS (serve-playground.mjs).
 *
 * Two pages, two tags. `/` names the API with `data-api`, the way a hosted
 * install's snippet does. `/plain` is the tag alone, so the loader has to find
 * the API from its own address: this server answers nothing under /api, so a
 * loader that fell back to the page's own host would never find a widget.
 */

import { createServer } from 'node:http';
import { API_PATH, HOST_PORT, PLAYGROUND } from './ports.mjs';

const api = `${PLAYGROUND}${API_PATH}`;

/** The page, with the loader tag given; `data-api` or not is the difference. */
const page = (tag) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Another site</title>
  <style>body { font-family: system-ui, sans-serif; margin: 40px; color: #171425; }</style>
</head>
<body>
  <h1>Another site</h1>
  <p>This page is on a different origin from the HelpWell API it talks to.</p>
  ${tag}
</body>
</html>`;

const pages = {
  '/': page(`<script src="${api}/assets/loader.js" data-api="${api}" defer></script>`),
  '/plain': page(`<script src="${api}/assets/loader.js" defer></script>`),
};

createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://host').pathname;
  if (path === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  const html = pages[path === '/index.html' ? '/' : path];
  if (html) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
}).listen(HOST_PORT, '127.0.0.1', () => {
  console.log(`[e2e] another site on http://127.0.0.1:${HOST_PORT}`);
});
