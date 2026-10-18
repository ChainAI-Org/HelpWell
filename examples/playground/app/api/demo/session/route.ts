/**
 * The fake sign-in. Nothing HelpWell-specific lives here.
 *
 * Plain links rather than a form or a server action, so the whole identity and
 * admin story is visible in the HTML and works with JavaScript switched off:
 *
 *   /api/demo/session?user=ada&next=/       sign in as Ada
 *   /api/demo/session?user=none&next=/      sign out
 *   /api/demo/session?admin=on&next=/       become an admin
 *   /api/demo/session?admin=off&next=/      stop being one
 *
 * A real app deletes this file and uses its own session.
 */

import { cookieHeader, VISITOR_COOKIE } from '@helpwell/core/api';
import { ADMIN_COOKIE, USER_COOKIE } from '../../../../lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YEAR = 60 * 60 * 24 * 365;
const secure = process.env.NODE_ENV === 'production';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cookies: string[] = [];

  const user = url.searchParams.get('user');
  if (user === 'ada') {
    cookies.push(cookieHeader(USER_COOKIE, 'ada', { maxAge: YEAR, secure }));
  } else if (user === 'none') {
    cookies.push(cookieHeader(USER_COOKIE, '', { maxAge: 0, secure }));
    // Signing out of Ridgeline should also drop HelpWell's visitor cookie.
    // Without this the "anonymous" visitor still resolves to Ada's contact
    // record, and her conversation history follows her out of the door.
    cookies.push(cookieHeader(VISITOR_COOKIE, '', { maxAge: 0, secure }));
  }

  const admin = url.searchParams.get('admin');
  if (admin === 'on') {
    cookies.push(cookieHeader(ADMIN_COOKIE, 'yes', { maxAge: YEAR, secure }));
  } else if (admin === 'off') {
    cookies.push(cookieHeader(ADMIN_COOKIE, '', { maxAge: 0, secure }));
  }

  const headers = new Headers({ location: safeNext(url.searchParams.get('next')) });
  for (const cookie of cookies) headers.append('set-cookie', cookie);

  // 303 so the browser follows with GET and the back button behaves.
  return new Response(null, { status: 303, headers });
}

/** Only same-site paths, so a crafted link cannot bounce somebody off-site. */
function safeNext(value: string | null): string {
  const next = value ?? '';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
