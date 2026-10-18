/**
 * The media block: how an image, GIF or video looks wherever a message takes
 * one. A thumbnail with its type badge (and a video's length), the file name,
 * a line about it, and Replace, Alt text and Remove.
 *
 * Replace and Alt text open small panels holding the real form fields, so the
 * block is the same markup with or without script. The script fills in what
 * only the browser knows (an image's size, a video file's length) and keeps
 * the thumbnail and the green "alt text set" dot in step with the fields.
 *
 * Nothing is fetched from a video host to draw it: a YouTube, Vimeo, Loom or
 * Wistia link gets a drawn thumbnail with the host's name on it, as the
 * widget does until the visitor presses play.
 */

import { html, type RawHtml, raw } from '@helpwell/ui';
import { popover } from './controls.js';
import { kitIcon } from './icons.js';

export type MediaKind = 'image' | 'gif' | 'video';

export interface MediaBlockOptions {
  kind: MediaKind;
  url: string;
  /** A video's title, used as its name. */
  title?: string;
  /** Whether it is described (alt text, or a video's title): the green dot. */
  described: boolean;
  /** The address box, shown in the Replace panel. */
  urlControl: RawHtml;
  /** Uploading into that box: the field name it fills, and the file types taken. */
  upload?: { target: string; accept: string } | null;
  /** The description boxes, shown in the Alt text panel. */
  describeControl: RawHtml;
  /** What the description is called: "Alt text" for images, "Title" for a video. */
  describeLabel?: string;
  /** The Remove button, usually a submit that posts the page's remove op. */
  remove?: RawHtml | null;
  /** The small thumbnail (a banner's icon or image). */
  compact?: boolean;
  id?: string;
}

const PROVIDERS: [RegExp, string][] = [
  [/(^|\.)youtube(-nocookie)?\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)loom\.com$/, 'Loom'],
  [/(^|\.)wistia\.(com|net)$/, 'Wistia'],
];

/** A URL safe to put in an `img` or `video` src: http(s), or a path on this site. */
export function safeMediaSrc(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /^[/\\][/\\]/.test(trimmed)) return null;
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/** What the block says about a URL before the browser has looked at it. */
export function describeMedia(
  kind: MediaKind,
  url: string,
  title = '',
): { name: string; meta: string; badge: string | null; provider: string | null } {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      name: kind === 'video' ? 'No video yet' : kind === 'gif' ? 'No GIF yet' : 'No image yet',
      meta:
        kind === 'video'
          ? 'Paste a link, or upload an MP4 or WebM'
          : 'Upload a file, or paste a link',
      badge: kind === 'gif' ? 'GIF' : null,
      provider: null,
    };
  }
  let host = '';
  let file = trimmed;
  try {
    const parsed = new URL(trimmed, 'https://local.invalid');
    host = parsed.hostname === 'local.invalid' ? '' : parsed.hostname.replace(/^www\./, '');
    file = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? trimmed);
  } catch {
    // Keep the raw text: the field beside it will say what is wrong with it.
  }
  // A path on this site is an upload: links to elsewhere name their host.
  const where = host || 'uploaded';
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(file)?.[1] ?? '').toUpperCase();

  if (kind === 'video') {
    const provider = PROVIDERS.find(([test]) => test.test(host))?.[1] ?? null;
    return {
      name: title || (provider ? `${provider} video` : file),
      meta: provider ? `${provider} link` : `${ext || 'Video'} · ${where}`,
      badge: provider ?? (ext || 'Video'),
      provider,
    };
  }
  return {
    name: file,
    meta: `${kind === 'gif' ? 'GIF' : ext || 'Image'} · ${where}`,
    badge: kind === 'gif' ? 'GIF' : null,
    provider: null,
  };
}

export function mediaBlock(options: MediaBlockOptions): RawHtml {
  const info = describeMedia(options.kind, options.url, options.title);
  const src = safeMediaSrc(options.url);
  const isFile = options.kind === 'video' && src && !info.provider;
  const thumb =
    !options.url.trim() || !src
      ? html`<span class="ek-media__thumb ek-media__thumb--empty" data-ek-thumb>${raw(kitIcon(options.kind === 'video' ? 'film' : 'image', 20))}</span>`
      : options.kind === 'video'
        ? html`<span class="ek-media__thumb ek-media__thumb--video" data-ek-thumb>${
            isFile
              ? html`<video src="${src}" preload="metadata" muted playsinline hidden data-ek-duration></video>`
              : null
          }<span class="ek-media__play">${raw(kitIcon('play', 12, 2.2))}</span><span class="ek-media__badge">${info.badge}</span><span class="ek-media__dur" data-ek-dur></span></span>`
        : html`<span class="ek-media__thumb" data-ek-thumb><img src="${src}" alt="" loading="lazy" data-ek-img>${
            info.badge ? html`<span class="ek-media__badge">${info.badge}</span>` : null
          }</span>`;

  const replace = popover({
    trigger: html`${raw(kitIcon('refresh', 12, 2))}<span>${options.url.trim() ? 'Replace' : 'Add'}</span>`,
    label: options.url.trim() ? 'Replace' : 'Add',
    body: html`<p class="ek-pop__title">${options.kind === 'video' ? 'Video' : options.kind === 'gif' ? 'GIF' : 'Image'}</p>
      ${options.urlControl}
      ${
        options.upload
          ? html`<div class="ek-pop__row"><label class="ek-mini ek-upload">${raw(kitIcon('upload', 12, 2))}<span>Upload a file</span><input type="file" accept="${options.upload.accept}" data-ek-upload-for="${options.upload.target}"></label><span class="ek-upload__status" data-ek-upload-status="${options.upload.target}" role="status"></span></div>`
          : null
      }`,
  });
  const describe = popover({
    trigger: html`${raw(kitIcon('alt', 12, 2))}<span>${options.describeLabel ?? 'Alt text'}</span><span class="ek-okdot" data-on="${String(options.described)}" data-ek-okdot></span>`,
    label: options.describeLabel ?? 'Alt text',
    body: options.describeControl,
  });

  return html`<div class="ek-media${options.compact ? ' ek-media--compact' : ''}" data-ek-media="${options.kind}"${
    options.id ? html` id="${options.id}"` : null
  }>${thumb}<span class="ek-media__info"><span class="ek-media__name" data-ek-name>${info.name}</span><span class="ek-media__meta" data-ek-meta="${info.meta}">${
    info.meta
  }</span><span class="ek-media__actions">${replace}${describe}${options.remove ?? null}</span></span></div>`;
}
