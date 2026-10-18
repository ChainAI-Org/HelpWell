/**
 * The three kinds of response a dashboard screen gives: a page in the shell,
 * a redirect after a form post, and JSON for the small scripts that preview
 * or stream. Shared by the screens that live in their own modules, so each
 * one answers exactly the way the server's own screens do.
 */

import type { RawHtml } from '@helpwell/ui';
import { type DashboardContext, type NavKey, type PageHeader, renderDashboard } from './layout.js';

export function htmlPage(
  context: DashboardContext,
  nav: NavKey,
  header: PageHeader,
  body: RawHtml,
  status = 200,
): Response {
  return new Response(renderDashboard(context, nav, header, body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 303, so the browser follows with GET: a refresh must never re-submit. */
export function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * A JSON body from a script on the page, refused when it is not JSON or is
 * larger than `max` characters. Null means refused; the reason is the response.
 */
export async function readJsonBody<T>(
  request: Request,
  max: number,
): Promise<{ body: T } | { response: Response }> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return { response: json({ error: 'Send it as JSON.' }, 415) };
  }
  if (Number(request.headers.get('content-length') ?? 0) > max) {
    return { response: json({ error: 'Too large.' }, 413) };
  }
  const text = await request.text();
  if (text.length > max) return { response: json({ error: 'Too large.' }, 413) };
  try {
    return { body: JSON.parse(text) as T };
  } catch {
    return { response: json({ error: 'Not JSON.' }, 400) };
  }
}
