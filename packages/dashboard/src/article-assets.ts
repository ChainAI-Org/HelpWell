/**
 * Images pasted, dropped or picked in the article editor.
 *
 * Each one is posted here on its own, checked (PNG, JPEG, GIF or WebP by its
 * bytes, up to 10 MB, never SVG) and kept through the install's asset store
 * (`AssetStore` in @helpwell/core/content), and the answer is the Markdown
 * the editor puts where the cursor was. The article itself is not saved: the
 * image is in it once the person presses Save, like anything else typed.
 *
 * Which store: the host's own, when it passed one; otherwise its writable
 * content source; otherwise, for an install whose Save writes to the repo,
 * the docs folder under `_media/`, beside the screenshots, to be committed
 * with the article. An install that cannot save articles from here takes no
 * uploads either, since there is nowhere for the image to be used.
 */

import { isHelpWellError } from '@helpwell/core';
import {
  type AssetStore,
  articleWriter,
  assetMarkdown,
  fileAssetStore,
  MAX_ASSET_BYTES,
  resolveAssetStore,
  storeAsset,
} from '@helpwell/core/content';
import type { DashboardContext } from './layout.js';
import type { DashboardConfig } from './server.js';

/** Where this dashboard's uploads go, or null when it takes none. */
export function dashboardAssetStore(
  config: Pick<DashboardConfig, 'assetStore' | 'content' | 'writeArticle' | 'docsDir'>,
): AssetStore | null {
  if (!articleWriter(config.writeArticle, config.content)) return null;
  if (config.assetStore !== undefined || config.content) {
    return resolveAssetStore({ assetStore: config.assetStore, content: config.content });
  }
  return fileAssetStore({ docs: config.docsDir ?? 'docs' });
}

/** A multipart body a little over the limit still has room for its own headers. */
const MULTIPART_SLACK = 64 * 1024;

/** POST `/knowledge/_upload`: one image, answered as JSON for the editor's script. */
export async function uploadArticleImage(
  config: DashboardConfig,
  context: DashboardContext,
  request: Request,
): Promise<Response> {
  const store = dashboardAssetStore(config);
  if (!store) {
    return json(
      { error: 'This install cannot keep uploaded images. Use an https:// address instead.' },
      501,
    );
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_ASSET_BYTES + MULTIPART_SLACK) {
    return json({ error: tooLarge() }, 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return json({ error: 'Send the image as a file upload.' }, 400);
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return json({ error: 'Choose an image to upload.' }, 400);
  }
  if (file.size > MAX_ASSET_BYTES) return json({ error: tooLarge() }, 413);

  try {
    const record = await storeAsset(store, new Uint8Array(await file.arrayBuffer()));
    const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
    return json(
      {
        path: record.path,
        url: record.url,
        reference: record.reference,
        markdown: assetMarkdown(record, name === 'image' || name === 'blob' ? '' : name),
        src: record.url ?? `${context.apiPath}/media/${record.path}`,
      },
      201,
    );
  } catch (error) {
    if (isHelpWellError(error) && error.code === 'bad_request') {
      const reason = error.details?.reason;
      const status =
        reason === 'too_large' ? 413 : reason === 'svg' || reason === 'type' ? 415 : 400;
      return json({ error: error.publicMessage }, status);
    }
    // A store that refuses on purpose (a storage limit, say) says why in its
    // own words; an internal error is never passed on.
    if (isHelpWellError(error) && error.code !== 'internal') {
      return json({ error: error.publicMessage }, error.status);
    }
    // Any other failure: said plainly, without whatever it said inside.
    return json(
      { error: 'The image could not be saved just now. Try again, or use an https:// address.' },
      502,
    );
  }
}

function tooLarge(): string {
  return `That image is over ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB. Save it smaller and try again.`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
