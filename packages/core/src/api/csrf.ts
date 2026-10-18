/**
 * Cross-site request forgery, for a product that rides on the host's cookies.
 *
 * The dashboard and the admin API are authenticated by whatever session the
 * host app already has, which is usually a cookie. A cookie is sent by the
 * browser on any request to the site, including one a hostile page makes with
 * an auto-submitting form. So every request that changes something has to
 * prove it came from the site itself.
 *
 * Two signals, both set by the browser and unforgeable from a page:
 *
 *   - `Sec-Fetch-Site`: every current browser sends it; `cross-site` is the
 *     answer we refuse.
 *   - `Origin`: sent on every POST; compared by host against the request's
 *     own host, because a reverse proxy that terminates TLS often makes the
 *     scheme differ while the host does not.
 *
 * A request with neither header is allowed through: that is a non-browser
 * client (curl, the SDK, a CI job), and those carry a bearer token or nothing
 * rather than a cookie, so a forged form cannot be one of them.
 */

import { HelpWellError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;

  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw crossSite();

  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') {
    // `null` is what a sandboxed iframe or a redirect from a data: URL sends.
    // If the browser told us the site relationship it already passed above;
    // without either signal this is a non-browser client.
    if (origin === 'null') throw crossSite();
    return;
  }

  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossSite();
  }

  const expected = requestHost ?? safeHost(request.url);
  if (expected && originHost !== expected) throw crossSite();
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function crossSite(): HelpWellError {
  return new HelpWellError('forbidden', 'Cross-site request refused', {
    publicMessage: 'That request did not come from this site.',
  });
}
