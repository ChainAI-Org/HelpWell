/**
 * Images and video in answers, articles and updates.
 *
 * The Markdown renderer is `@helpwell/ui`'s (see markdown.ts) and it already
 * decides what markup may exist: everything escaped, only http(s), mailto and
 * relative URLs, video iframes only for players it rebuilt from an id. This
 * module does the widget's part on top, on the renderer's output, before any
 * of it is live:
 *
 *   - The HTML is parsed into a <template>, which is inert: nothing in it
 *     loads until it is adopted into the page. So an image that fails the
 *     checks below is removed before the browser ever requests it, and a
 *     video player makes no third-party request until a visitor asks for it.
 *   - Images must be https (or on this page's own origin, or the widget's
 *     own API, which a dev server may run on plain http), get lazy loading,
 *     always have alt text, and open in a lightbox on click. GIFs are images.
 *   - YouTube, Vimeo, Loom and Wistia stay the renderer's link cards by
 *     default, because the widget runs under the host page's CSP and a
 *     player's cookies are not ours to bring. With `widget.media.inlineVideo`
 *     on they become click-to-load players instead (YouTube from its
 *     no-cookie domain). A Wistia link inside a sentence, which the renderer
 *     leaves as an image, is caught here too and never loads as one.
 */

import { renderMarkdown as render, videoEmbed } from '@helpwell/ui';
import { h, svg } from './dom.js';
import { icons } from './icons.js';

export interface RichOptions {
  /** Play YouTube, Vimeo, Loom and Wistia in place, after a click. */
  inlineVideo?: boolean;
}

interface Player {
  provider: 'youtube' | 'vimeo' | 'loom' | 'wistia';
  /** The player URL, built from an id this code extracted and checked. */
  src: string;
  /** Where a person watches it on the provider's own site. */
  url: string;
}

const PROVIDER_NAME: Record<Player['provider'], string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  wistia: 'Wistia',
};

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

/**
 * Markdown as a fragment ready to append. Nothing in it has loaded anything
 * yet, and anything that should not load never will.
 */
export function renderRich(source: string, options: RichOptions = {}): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = render(source, { surface: 'panel' }).html;
  enhanceMedia(template.content, options);
  return template.content;
}

/** Apply the image and video rules to markup the renderer produced. */
export function enhanceMedia(root: ParentNode, options: RichOptions = {}): void {
  for (const img of [...root.querySelectorAll('img')]) enhanceImage(img, options);

  for (const video of [...root.querySelectorAll('video')]) {
    const src = safeMediaUrl(video.getAttribute('src') ?? '');
    if (!src) {
      video.closest('figure')?.remove() ?? video.remove();
      continue;
    }
    video.setAttribute('preload', 'metadata');
    video.setAttribute('playsinline', '');
  }

  // The renderer's link cards for YouTube, Vimeo, Loom and Wistia.
  for (const card of [...root.querySelectorAll('p.hc-video-link')]) {
    const link = card.querySelector('a');
    const embed = videoEmbed(link?.getAttribute('href') ?? '');
    if (!link || !embed || embed.provider === 'file') continue;
    const label = card.querySelector('span')?.textContent?.trim() || 'Video';
    if (options.inlineVideo) {
      card.replaceWith(
        videoFacade({ provider: embed.provider, src: embed.src, url: embed.url }, label),
      );
    }
  }
}

function enhanceImage(img: HTMLImageElement, options: RichOptions): void {
  const raw = img.getAttribute('src') ?? '';
  const alt = (img.getAttribute('alt') ?? '').trim();

  // `![Demo](https://acme.wistia.com/medias/…)` inside a sentence: the
  // renderer only makes a player of a video on a line of its own, so this
  // one arrives here as an image.
  const wistia = wistiaPlayer(raw);
  if (wistia) {
    const label = alt || 'Video';
    const paragraph = img.parentElement;
    const alone = paragraph?.tagName === 'P' && paragraph.childNodes.length === 1;
    const replacement = options.inlineVideo
      ? videoFacade(wistia, label)
      : alone
        ? videoCard(wistia, label)
        : h('a', { href: wistia.url, target: '_blank', rel: 'noopener noreferrer', text: label });
    if (alone && paragraph) paragraph.replaceWith(replacement);
    else img.replaceWith(replacement);
    return;
  }

  const src = safeMediaUrl(raw);
  if (!src) {
    // Refused: the words stay, the request never happens.
    img.replaceWith(document.createTextNode(alt));
    return;
  }

  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  // Every image says what it is. The author's words when there are some.
  img.setAttribute('alt', alt || 'Image');

  if (img.closest('a')) return;
  const zoom = h('button', {
    type: 'button',
    class: 'media-zoom',
    'aria-label': `Enlarge image${alt ? `: ${alt}` : ''}`,
  });
  img.replaceWith(zoom);
  zoom.appendChild(img);
  zoom.addEventListener('click', () => openLightbox(zoom, src, alt || 'Image'));
}

/**
 * Origins besides the page's own that http media may come from: the HelpWell
 * API the widget was loaded to talk to. The API sends article images as
 * absolute URLs, so on another site they name the API's host, and when that
 * is a plain-http dev server, refusing them would refuse the very server the
 * widget already calls for everything else.
 */
const trustedOrigins = new Set<string>();

/** Let http media through from the widget's own API, by its address. */
export function trustMediaOrigin(address: string): void {
  try {
    const here = typeof location === 'undefined' ? undefined : location.href;
    const url = new URL(address, here);
    if (url.protocol === 'http:' || url.protocol === 'https:') trustedOrigins.add(url.origin);
  } catch {
    // Not an address: nothing to trust.
  }
}

/**
 * An image or video address the widget will load: https anywhere, or http
 * only on the page's own origin (a local dev server) or the widget's own API.
 * Paths resolve against the page, which is the host's own site.
 */
export function safeMediaUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  for (let k = 0; k < trimmed.length; k++) {
    const code = trimmed.charCodeAt(k);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  try {
    const url = new URL(trimmed, location.href);
    if (url.protocol === 'https:') return trimmed;
    if (url.protocol === 'http:' && url.origin === location.origin) return trimmed;
    if (url.protocol === 'http:' && trustedOrigins.has(url.origin)) return trimmed;
    return null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- video */

/**
 * A Wistia video by its public URL shapes, by the renderer's own rules, so
 * the help centre and the widget recognise exactly the same links. Only the
 * ten-character media id is taken from what was written.
 */
export function wistiaPlayer(value: string): Player | null {
  const embed = videoEmbed(value);
  return embed?.provider === 'wistia'
    ? { provider: 'wistia', src: embed.src, url: embed.url }
    : null;
}

/** The link card, the same markup the renderer draws for the other providers. */
function videoCard(player: Player, label: string): HTMLElement {
  const link = h('a', { href: player.url, target: '_blank', rel: 'noopener noreferrer' });
  link.append(
    svg(PLAY_ICON),
    h('span', { text: label }),
    h('span', { class: 'hc-video-link__via', text: ` · ${PROVIDER_NAME[player.provider]}` }),
  );
  return h('p', { class: 'hc-video-link' }, link);
}

/**
 * A player that is not there yet: a button that says what it will load. The
 * iframe, and every request to the provider, only happen on the click.
 */
export function videoFacade(player: Player, label: string): HTMLElement {
  const figure = h('figure', { class: 'hw-video', 'data-provider': player.provider });
  const play = h('button', {
    type: 'button',
    class: 'hw-video__play',
    'aria-label': `Play video: ${label}`,
  });
  play.append(
    h('span', { class: 'hw-video__icon' }, svg(PLAY_ICON)),
    h('span', { class: 'hw-video__label', text: label }),
    h('span', { class: 'hw-video__via', text: PROVIDER_NAME[player.provider] }),
  );
  play.addEventListener('click', () => {
    const frame = h(
      'div',
      { class: 'hw-video__frame' },
      h('iframe', {
        src: autoplay(player),
        title: label,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }),
    );
    play.replaceWith(frame);
    frame.querySelector('iframe')?.focus();
  });
  figure.appendChild(play);
  return figure;
}

/** The player URL with autoplay on, since the click was the visitor asking to play. */
function autoplay(player: Player): string {
  const url = new URL(player.src);
  url.searchParams.set(
    player.provider === 'wistia' ? 'autoPlay' : 'autoplay',
    player.provider === 'wistia' ? 'true' : '1',
  );
  return url.href;
}

/* -------------------------------------------------------------- lightbox */

/**
 * The image at full size over the page. Escape, the close button or a click
 * anywhere closes it, and focus goes back to the image that opened it.
 */
export function openLightbox(trigger: HTMLElement, src: string, alt: string): HTMLElement {
  const parent =
    trigger.closest('.panel') ?? (trigger.getRootNode() as ShadowRoot | Document | null);
  const close = h('button', {
    type: 'button',
    class: 'lightbox__close',
    'aria-label': 'Close image',
  });
  close.appendChild(svg(icons.close));
  const overlay = h(
    'div',
    { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt },
    close,
    h('img', { class: 'lightbox__img', src, alt }),
  );

  const dismiss = () => {
    overlay.remove();
    trigger.focus();
  };
  overlay.addEventListener('click', dismiss);
  overlay.addEventListener('keydown', (event: KeyboardEvent) => {
    // Kept from the widget's own Escape handler, which would close the panel.
    event.stopPropagation();
    if (event.key === 'Escape') dismiss();
    if (event.key === 'Tab') {
      event.preventDefault();
      close.focus();
    }
  });

  const target =
    parent && 'appendChild' in parent && !(parent instanceof Document) ? parent : document.body;
  target.appendChild(overlay);
  close.focus();
  return overlay;
}
