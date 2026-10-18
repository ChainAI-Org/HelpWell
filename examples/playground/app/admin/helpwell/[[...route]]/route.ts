/**
 * Mount 3 of 3: the admin dashboard.
 *
 * POST as well as GET, because every write in the dashboard is a plain HTML
 * form that redirects afterwards. No client-side router, no JSON body.
 *
 * Authentication is not configured here — it is the `isAdmin` callback passed
 * to `createDashboard` in lib/helpwell.ts. Without it the dashboard answers 401
 * to everything, which is the correct default for an app that has not said who
 * its admins are.
 */

import { helpwell } from '../../../../lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  const { dashboard } = await helpwell();
  return dashboard(request);
}

export const GET = handler;
export const POST = handler;
