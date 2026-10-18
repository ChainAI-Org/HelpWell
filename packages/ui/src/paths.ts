/**
 * Paths, for the two surfaces that are mounted inside somebody else's app.
 *
 * A help centre at `/help` and a dashboard at `/admin/helpwell` both have to
 * work out which part of a URL is theirs, build links back into themselves,
 * and turn an article slug into a URL. Each used to carry its own copy of
 * that, and the copies disagreed about what happens at the root.
 */

/** Normalise a mount path: a leading slash, no trailing one, and '' for the root. */
export function mountPath(base: string | null | undefined): string {
  const trimmed = (base ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** The part of a pathname under the mount, or null when it is outside it. */
export function stripMountPath(pathname: string, base: string): string | null {
  if (!base) return pathname || '/';
  if (pathname === base) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
  return null;
}

/**
 * A link into a mounted surface. `link('/help', '/changelog')` is
 * `/help/changelog`; mounted at the root, `link('', '/')` is `/` rather than
 * the empty href that reloads whatever page it is on.
 */
export function link(base: string, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (suffix === '/') return base || '/';
  return `${base}${suffix}`;
}

/** A slug may contain a slash; each segment is encoded, the slashes are not. */
export function slugPath(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('/');
}

/**
 * Fill the `{path}` in an "edit this page" template. Every occurrence, and
 * without `String.replace` reading a `$&` in the path as a pattern.
 */
export function fillPathTemplate(template: string, path: string): string {
  return template.split('{path}').join(path);
}

/**
 * Split a pathname into decoded segments, or null when it cannot be decoded
 * (`/help/%zz`), which is a 404 rather than a crash.
 */
export function decodeSegments(pathname: string): string[] | null {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}
