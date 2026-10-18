/**
 * Mount 1 of 3: the HelpWell HTTP API.
 *
 * `createHelpWellHandler` is a plain `(Request) => Promise<Response>`, so the
 * whole integration is re-exporting it under each method Next should accept.
 * The optional catch-all `[[...route]]` is what makes `/api/helpwell` and
 * everything under it land here; the handler does its own routing from the
 * `basePath` it was configured with.
 */

import { helpwell } from '../../../../lib/helpwell';

export const runtime = 'nodejs';
// Without this Next would try to render the GET routes at build time, which
// means booting a database during `next build`. Support endpoints are never
// static anyway.
export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  const { api } = await helpwell();
  return api(request);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
