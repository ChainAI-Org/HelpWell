/**
 * Keeping screenshots honest when they are retaken.
 *
 * A retake can go wrong quietly: the sign-in has expired and the app sends the browser to its
 * sign-in page, or the page errors, and the picture of that replaces a good one. And an article
 * may show an annotated copy of a screenshot (the editor's annotate tool saves a new image and
 * keeps the original), which a retake cannot redraw. These helpers say when a page's picture
 * must not be kept, and which articles use a screenshot or an annotated copy of it.
 */

/** Pages an app sends people to when they are signed out. */
const SIGN_IN = /(^|\/)(log[-_]?in|sign[-_]?in|auth|sessions?)(\/|$)/i;

/**
 * Why the picture of a page must not replace the last one: an error status, or the browser ending
 * on another host or a sign-in page. Null when the page is the one asked for. `signIn` says how
 * to sign in again where this runs.
 */
export function refusedScreenshot(
  requested: string | URL,
  landed: string,
  status: number | null,
  signIn = 'Sign in again',
): string | null {
  if (status !== null && status >= 400)
    return `The page answered ${status}, so the last picture was kept.`;
  let asked: URL;
  let at: URL;
  try {
    asked = new URL(requested);
    at = new URL(landed);
  } catch {
    return null;
  }
  const trim = (path: string) => path.replace(/\/+$/, '') || '/';
  if (at.origin !== asked.origin)
    return `The page sent the browser to ${at.host}, probably to sign in. ${signIn}, then retake. The last picture was kept.`;
  if (trim(at.pathname) !== trim(asked.pathname) && SIGN_IN.test(at.pathname))
    return `The page went to ${at.pathname} instead, so the sign-in has probably expired. ${signIn}, then retake. The last picture was kept.`;
  return null;
}

/** The image title that marks an annotated copy of the screenshot `<name>.png`. */
export function annotatedCopyTitle(name: string): string {
  return `Annotated copy of _screenshots/${name}.png`;
}

const SHOWN = /_screenshots\/([^\s)"/]+)\.png/g;
const COPY = /!\[[^\]]*\]\((\S+?)\s+"Annotated copy of _screenshots\/([^"/]+)\.png"\)/g;

/** The screenshots an article shows, by name, and the annotated copies in it (image path and name). */
export function screenshotsInArticle(body: string): {
  shown: string[];
  copies: { image: string; name: string }[];
} {
  const copies = [...body.matchAll(COPY)].map((m) => ({ image: m[1]!, name: m[2]! }));
  const shown = new Set([...body.matchAll(SHOWN)].map((m) => m[1]!));
  for (const copy of copies) shown.add(copy.name);
  return { shown: [...shown], copies };
}
