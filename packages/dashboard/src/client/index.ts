/**
 * The dashboard's scripts, served as files rather than written into its pages.
 *
 * A page that carries its script inline can only run under a
 * Content-Security-Policy that allows `'unsafe-inline'` scripts, and that
 * allows whatever an injection manages to put on the page too. So no page
 * has an inline script or an `on*=` handler: each script is a file under
 * `<basePath>/_assets/`, named by a hash of what is in it, and the
 * dashboard's own policy is `script-src 'self'` (server.ts). A host that
 * frames the dashboard under a stricter policy of its own needs nothing more
 * than `'self'` for scripts.
 *
 * The scripts are still small, plain ES5 and one per feature, and a page puts
 * each one's tag exactly where the inline script used to be, so it runs at
 * the same point in the parse as before. What one needs from the page is on
 * its own tag as `data-*` attributes (read through `document.currentScript`)
 * or in the markup it works on.
 *
 * The files are the same for every install and say nothing about one, so,
 * like the fonts, they are served before the admin check and cached for a
 * year: a changed script has a new name. A page rendered before a deploy
 * asks for the old name, and gets the current file, uncached, not a 404.
 */

/// <reference types="node" />

import { createHash } from 'node:crypto';
import { escapeHtml, imageEditorClientScript, type RawHtml, raw } from '@helpwell/ui';
import { ARTICLE_IMAGES_JS } from './article-images.js';
import { EDITOR_KIT_JS, EDITOR_MARK_JS } from './editor-kit.js';
import { ENGAGE_JS } from './engage.js';
import { EVAL_RUN_JS } from './evals.js';
import { FORMS_JS } from './forms.js';
import { KNOWLEDGE_IMPORT_JS } from './knowledge-import.js';
import { MODEL_PICKER_JS } from './model-picker.js';
import { PREVIEW_FRAME_JS } from './preview-frame.js';
import { ARTICLE_PREVIEW_JS, PLAYBOOK_PREVIEW_JS } from './previews.js';
import { HOME_BLOCKS_JS, WIDGET_CHECKS_JS } from './settings.js';
import { SHELL_JS } from './shell.js';

/** Every script the dashboard serves, by the name in its file name. */
const SOURCES = {
  shell: SHELL_JS,
  'editor-mark': EDITOR_MARK_JS,
  'editor-kit': EDITOR_KIT_JS,
  engage: ENGAGE_JS,
  forms: FORMS_JS,
  'model-picker': MODEL_PICKER_JS,
  'eval-run': EVAL_RUN_JS,
  'article-preview': ARTICLE_PREVIEW_JS,
  'article-images': ARTICLE_IMAGES_JS,
  'image-editor': imageEditorClientScript(),
  'knowledge-import': KNOWLEDGE_IMPORT_JS,
  'playbook-preview': PLAYBOOK_PREVIEW_JS,
  'widget-checks': WIDGET_CHECKS_JS,
  'home-blocks': HOME_BLOCKS_JS,
  'preview-frame': PREVIEW_FRAME_JS,
} as const;

export type ClientScriptName = keyof typeof SOURCES;

/** Where the scripts are served, under the dashboard's base path. */
export const CLIENT_SCRIPT_PATH = '/_assets/';

interface ClientFile {
  body: string;
  /** The first 12 hex digits of the body's SHA-256: its version. */
  hash: string;
  /** `<name>.<hash>.js`. */
  file: string;
}

const FILES = new Map<string, ClientFile>(
  Object.entries(SOURCES).map(([name, body]) => {
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
    return [name, { body, hash, file: `${name}.${hash}.js` }];
  }),
);

/** The file name a script is served under right now, e.g. `shell.3f2a9c01b7de.js`. */
export function clientScriptFile(name: ClientScriptName): string {
  return FILES.get(name)!.file;
}

/**
 * The tag that loads one of the dashboard's scripts, where the page wants it
 * to run. `data` becomes `data-*` attributes on the tag, for the script to
 * read through `document.currentScript`.
 */
export function clientScript(
  context: { basePath: string },
  name: ClientScriptName,
  data: Record<string, string> = {},
): RawHtml {
  const src = `${context.basePath}${CLIENT_SCRIPT_PATH}${clientScriptFile(name)}`;
  const attributes = Object.entries(data)
    .map(([key, value]) => ` data-${key.replace(/[^a-z0-9-]/g, '')}="${escapeHtml(value)}"`)
    .join('');
  return raw(`<script src="${escapeHtml(src)}"${attributes}></script>`);
}

/**
 * `GET <basePath>/_assets/<name>.<hash>.js`. The current hash is cached for
 * a year, since that name will never hold anything else; another hash of a
 * known script gets the current file without a long cache; anything else is
 * a 404, so the route reads nothing but these scripts.
 */
export function serveClientScript(fileName: string, request: Request): Response {
  const match = /^([a-z-]+)\.([0-9a-f]{12})\.js$/.exec(fileName);
  const file = match ? FILES.get(match[1]!) : undefined;
  if (!match || !file) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const current = match[2] === file.hash;
  const etag = `"${file.hash}"`;
  const headers = {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': current ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : file.body, { status: 200, headers });
}
