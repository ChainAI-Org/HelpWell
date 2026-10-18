/**
 * Absolute image URLs in what the widget is sent.
 *
 * An article's screenshot is indexed as a path on this server
 * (`/api/helpwell/screenshots/export.png`), or, written in the dashboard or
 * kept by a content source, as a path relative to the article
 * (`../_media/3f9a.png`). Either resolves against the page the widget is on.
 * On the customer's own site that is the customer's domain, not HelpWell's,
 * and every image breaks. So each image URL in widget-facing content
 * (articles, answers, the Home tab's cards, changelog entries, engagements,
 * forms, the avatar and launcher images) leaves the API absolute, built from
 * the address the API is reached at: `publicUrl` when the host set one,
 * otherwise the request's own origin and the mount path.
 *
 * Only images and videos are touched. A link stays as it was written, and
 * an absolute URL or a `data:` image is never changed.
 */

import { mapImageUrls, servedMediaUrl } from '../content/media.js';
import type { WidgetSettings } from '../settings/schema.js';
import type { RequestContext } from './context.js';

/** Where the API is reached from a browser. */
export interface PublicBase {
  /** `https://app.acme.com`: what a root path is made absolute against. */
  origin: string;
  /** `https://app.acme.com/api/helpwell`: what a media path is served under. */
  api: string;
}

/** Where the API is mounted when nobody says otherwise. */
const DEFAULT_BASE_PATH = '/api/helpwell';

/**
 * This request's public base: the host's `publicUrl`, or the request's own
 * origin with the mount path. Null when neither is an http(s) URL, and
 * nothing is rewritten then.
 */
export function publicBaseFor(
  context: Pick<RequestContext, 'config' | 'request'>,
): PublicBase | null {
  const configured = context.config.publicUrl?.trim();
  const fixed = configured ? httpUrl(configured) : null;
  if (fixed) return { origin: fixed.origin, api: `${fixed.origin}${trimPath(fixed.pathname)}` };
  const url = httpUrl(context.request.url);
  if (!url) return null;
  const mount = trimPath(context.config.basePath ?? DEFAULT_BASE_PATH);
  return { origin: url.origin, api: `${url.origin}${mount}` };
}

/**
 * One image URL, absolute: a root path gets the origin, and a media path
 * relative to the docs folder (`_media/a.png`, `_screenshots/b.png`) the URL
 * it is served at. Anything else comes back as it was.
 */
export function absoluteMediaUrl(url: string, base: PublicBase, articlePath = 'index.md'): string {
  const value = url.trim();
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || /^(\/\/|#)/.test(value)) return url;
  if (value.startsWith('/')) return `${base.origin}${value}`;
  return servedMediaUrl(value, articlePath.replace(/\\/g, '/'), { apiPath: base.api }) ?? url;
}

/** `absoluteMediaUrl` for a field that may be empty or missing. */
export function absoluteOptionalUrl<T extends string | null | undefined>(
  url: T,
  base: PublicBase | null,
): T {
  return (base && url ? absoluteMediaUrl(url, base) : url) as T;
}

/**
 * A Markdown body with every image and video URL absolute. `articlePath` is
 * the article's file relative to the docs folder, which a relative path is
 * resolved against; left out, the docs folder itself.
 */
export function absoluteMarkdownMedia(
  markdown: string,
  base: PublicBase | null,
  articlePath = 'index.md',
): string {
  if (!base || !markdown?.includes('](')) return markdown;
  return mapImageUrls(markdown, (url) => {
    const absolute = absoluteMediaUrl(url, base, articlePath);
    return absolute === url ? null : absolute;
  });
}

/**
 * The widget's settings as `/config` sends them: the launcher icon, the
 * background pattern image and each Home card's image and body absolute.
 */
export function absoluteWidgetSettings(
  widget: WidgetSettings,
  base: PublicBase | null,
): WidgetSettings {
  if (!base) return widget;
  return {
    ...widget,
    appearance: {
      ...widget.appearance,
      launcherIconUrl: absoluteOptionalUrl(widget.appearance.launcherIconUrl, base),
      patternImageUrl: absoluteOptionalUrl(widget.appearance.patternImageUrl, base),
    },
    home: {
      ...widget.home,
      blocks: widget.home.blocks.map((block) =>
        block.type === 'card'
          ? {
              ...block,
              image: absoluteOptionalUrl(block.image, base),
              body: absoluteMarkdownMedia(block.body, base),
            }
          : block,
      ),
    },
  };
}

/** Block types whose `url` is a picture or a video the widget loads. */
const MEDIA_BLOCKS = new Set(['image', 'gif', 'video']);

/**
 * Engagements and forms as the widget draws them: each image, GIF and video
 * block's `url`, each text block's Markdown, and a form's `image`, absolute.
 * Where a click goes (`link`, a button's `url`) is left as written.
 */
export function absoluteBlockMedia<T>(value: T, base: PublicBase | null): T {
  if (!base) return value;
  const walk = (node: unknown, key?: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (!node || typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype) {
      return node;
    }
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(node)) out[name] = walk(child, name);
    const type = typeof out.type === 'string' ? out.type : '';
    if (typeof out.url === 'string' && (MEDIA_BLOCKS.has(type) || key === 'image')) {
      out.url = absoluteMediaUrl(out.url, base);
    }
    if (type === 'text' && typeof out.markdown === 'string') {
      out.markdown = absoluteMarkdownMedia(out.markdown, base);
    }
    return out;
  };
  return walk(value) as T;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function trimPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
