/**
 * Which links and media an engagement may carry.
 *
 * An engagement is configuration that ends up on somebody else's page, so the
 * dashboard refuses a `javascript:` link before it is saved and the widget
 * refuses it again before it is followed. This file is the server's half:
 * shape checks only. The widget builds the actual player URL itself from the
 * id it recognises, so nothing typed here ever reaches an iframe `src`.
 *
 * The video shapes mirror `videoEmbed` in `@helpwell/ui` (which core does not
 * depend on) plus Wistia, which engagements accept and articles do not yet.
 */

/** An http(s) URL, or a path on the host's own site. */
export function isSafeLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[\s<>"'`\\]/.test(trimmed)) return false;
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  return /^https?:\/\/[^/]+/i.test(trimmed);
}

/** An image or GIF source: the same rule as a link. Uploaded files are root paths. */
export function isSafeMediaUrl(value: string): boolean {
  return isSafeLink(value);
}

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'file';

const VIDEO_FILE = /\.(mp4|webm|m4v|ogv)(?:[?#]|$)/i;

/** Which player a video URL needs, or null when it is not one HelpWell plays. */
export function videoProvider(value: string): VideoProvider | null {
  const trimmed = value.trim();
  if (!isSafeLink(trimmed)) return null;
  if (trimmed.startsWith('/')) return VIDEO_FILE.test(trimmed) ? 'file' : null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return /^[\w-]{11}$/.test(parts[0] ?? '') ? 'youtube' : null;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      parts[0] === 'watch' || parts.length === 0
        ? url.searchParams.get('v')
        : ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')
          ? parts[1]
          : null;
    return id && /^[\w-]{11}$/.test(id) ? 'youtube' : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = host === 'player.vimeo.com' && parts[0] === 'video' ? parts[1] : parts[0];
    return id && /^\d{1,12}$/.test(id) ? 'vimeo' : null;
  }
  if (host === 'loom.com') {
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : null;
    return id && /^[0-9a-f]{32}$/i.test(id) ? 'loom' : null;
  }
  if (host.endsWith('wistia.com') || host.endsWith('wistia.net') || host === 'wi.st') {
    return wistiaId(url) ? 'wistia' : null;
  }
  return VIDEO_FILE.test(url.pathname) ? 'file' : null;
}

/** The media id in a Wistia share or embed URL. */
export function wistiaId(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.findIndex((part) => part === 'medias' || part === 'iframe');
  const id = at >= 0 ? parts[at + 1] : null;
  return id && /^[a-z0-9]{10}$/i.test(id) ? id : null;
}
