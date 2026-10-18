/**
 * Mount 2 of 3: the public help centre.
 *
 * A route handler rather than a page, because `createHelpCenter` renders the
 * whole document itself — articles, search, changelog, roadmap, sitemap.xml and
 * llms.txt all come out of this one function. Nothing here knows what any of
 * those pages look like.
 *
 * GET only: the help centre has no writes.
 */

import { helpwell } from '../../../lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const { helpCenter } = await helpwell();
  return helpCenter(request);
}
