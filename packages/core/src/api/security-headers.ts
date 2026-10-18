/**
 * Security headers for HelpWell's three surfaces: the API, the help centre
 * and the dashboard.
 *
 * Each surface has defaults that suit what it serves, and each is
 * configurable, because HelpWell runs inside someone else's app: a host may
 * already set these at its proxy, or embed the dashboard in its own shell,
 * which a hard-coded `frame-ancestors 'self'` would break. The shape is the
 * same everywhere:
 *
 *   securityHeaders: { 'referrer-policy': 'no-referrer' }   // replace one
 *   securityHeaders: { 'x-frame-options': null }            // drop one
 *   securityHeaders: false                                   // send none
 *
 * A header the response already carries is left alone, so a route that
 * knows better (a media file's sandboxing CSP, a download's no-referrer)
 * keeps its own.
 */

export type SecurityHeaderOverrides = Record<string, string | null>;

/** `false` sends none; an object replaces (a string) or drops (null) single headers. */
export type SecurityHeadersOption = SecurityHeaderOverrides | false;

/** What every surface sends: no MIME sniffing, and no full URLs leaking to other sites. */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

/**
 * The headers to send: the surface's defaults with the host's overrides
 * applied. Header names are matched case-insensitively. Values with a line
 * break are refused, since they would split the header.
 */
export function resolveSecurityHeaders(
  defaults: Readonly<Record<string, string>>,
  option: SecurityHeadersOption | undefined,
): Record<string, string> {
  if (option === false) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(defaults)) out[name.toLowerCase()] = value;
  for (const [name, value] of Object.entries(option ?? {})) {
    const key = name.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(key)) continue;
    if (value === null) delete out[key];
    else if (typeof value === 'string' && !/[\r\n]/.test(value)) out[key] = value;
  }
  return out;
}

/**
 * The response with the headers added. Only those it does not already
 * carry. Rebuilt rather than mutated, because a Response's headers are
 * immutable in some runtimes (a `fetch` result, a redirect).
 */
export function withSecurityHeaders(response: Response, headers: Record<string, string>): Response {
  const missing = Object.entries(headers).filter(([name]) => !response.headers.has(name));
  if (missing.length === 0) return response;
  try {
    for (const [name, value] of missing) response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Headers(response.headers);
    for (const [name, value] of missing) copy.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: copy,
    });
  }
}

/**
 * `frame-ancestors` as a CSP directive from a list of sources, e.g.
 * `["'self'", 'https://app.acme.com']`. An empty list means `'none'`.
 * Anything that could end the directive is dropped.
 */
export function frameAncestorsDirective(sources: readonly string[]): string {
  const clean = sources
    .map((source) => source.trim())
    .filter((source) => source && !/[;,\s\r\n]/.test(source));
  return `frame-ancestors ${clean.length > 0 ? clean.join(' ') : "'none'"}`;
}
