/**
 * Blocks: the content of every engagement, drawn one way everywhere.
 *
 * A modal slide, a banner, a hotspot bubble, a tour step and a survey's
 * intro and thank-you are all lists of blocks, so they all take text, images,
 * GIFs, video and buttons, and they all go through the same safety rules.
 * Those rules are the widget's own, from media.ts: Markdown through the
 * shared renderer, images only from https (or this site), and a video player
 * that makes no request to its provider until the visitor presses play.
 */

import { videoEmbed } from '@helpwell/ui';
import { h, svg } from '../dom.js';
import { icons } from '../icons.js';
import { renderRich, safeMediaUrl, videoFacade, wistiaPlayer } from '../media.js';
import { fillTokens, untoken } from './personalize.js';
import { reducedMotion } from './shared.js';
import type { Block, EngageButton } from './types.js';

export interface BlockOptions {
  /** A button was pressed. The surface decides what next, back and dismiss mean. */
  onButton(button: EngageButton): void;
  /** A linked image was followed. */
  onLink?(): void;
  /** Tight spaces (a banner): media shrinks to a thumbnail, video opens over the page. */
  compact?: boolean;
}

const PLAY =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

export function isMedia(block: Block | undefined): boolean {
  return block?.type === 'image' || block?.type === 'gif' || block?.type === 'video';
}

/** The blocks, in order, inside one container. Blocks that cannot be drawn safely are left out. */
export function renderBlocks(blocks: readonly Block[], options: BlockOptions): HTMLElement {
  const wrap = h('div', { class: 'eg-blocks' });
  for (const block of blocks) {
    const el = renderBlock(block, options);
    if (el) wrap.appendChild(el);
  }
  return wrap;
}

export function renderBlock(block: Block, options: BlockOptions): HTMLElement | null {
  switch (block.type) {
    case 'text': {
      if (!block.markdown.trim()) return null;
      const text = h('div', { class: 'eg-text' });
      const drawn = renderRich(block.markdown, { inlineVideo: true });
      // The visitor's own details go in as text, after the Markdown is drawn.
      if (block.values) fillTokens(drawn, block.values);
      text.appendChild(drawn);
      return text;
    }
    case 'image':
      return image(block.url, block.alt, block.link, options);
    case 'gif':
      return gif(block.url, block.alt, options);
    case 'video':
      return video(block.url, block.title, options);
    case 'buttons':
      return buttonRow(block.buttons, options.onButton);
    case 'divider':
      return options.compact ? null : h('hr', { class: 'eg-divider' });
  }
}

export function buttonRow(
  buttons: readonly EngageButton[],
  onButton: (button: EngageButton) => void,
): HTMLElement | null {
  const usable = buttons.filter((b) => b.label.trim());
  if (usable.length === 0) return null;
  return h(
    'div',
    { class: 'eg-buttons' },
    ...usable.map((button) =>
      h('button', {
        class: button.style === 'secondary' ? 'engage-ghost' : 'engage-primary',
        type: 'button',
        text: button.label.trim(),
        on: { click: () => onButton(button) },
      }),
    ),
  );
}

/** The first line of text in some blocks, for a dialog's accessible name. */
export function blocksLabel(blocks: readonly Block[], fallback: string): string {
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const line = block.markdown
      .split('\n')
      .map((l) =>
        l
          .replace(/^#+\s*/, '')
          .replace(/[*_`>[\]]/g, '')
          .trim(),
      )
      .find(Boolean);
    // The Markdown is stripped first, so the visitor's own details stay whole.
    if (line) return untoken(line, block.values).slice(0, 120);
  }
  return fallback;
}

function image(url: string, alt: string, link: string, options: BlockOptions): HTMLElement | null {
  const src = safeMediaUrl(url);
  if (!src) return null;
  const img = h('img', {
    class: 'eg-image__img',
    src,
    alt: alt || '',
    loading: 'lazy',
    decoding: 'async',
  });
  const figure = h('figure', { class: `eg-image${options.compact ? ' eg-image--compact' : ''}` });
  const href = link ? safeLink(link) : null;
  if (href) {
    const anchor = h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, img);
    anchor.addEventListener('click', () => options.onLink?.());
    figure.appendChild(anchor);
  } else {
    figure.appendChild(img);
  }
  return figure;
}

/**
 * A GIF moves on its own. For someone who asked for less motion it waits
 * behind a button until they choose to play it.
 */
function gif(url: string, alt: string, options: BlockOptions): HTMLElement | null {
  const src = safeMediaUrl(url);
  if (!src) return null;
  const figure = h('figure', { class: `eg-image${options.compact ? ' eg-image--compact' : ''}` });
  const img = () => h('img', { class: 'eg-image__img', src, alt: alt || '', decoding: 'async' });
  if (!reducedMotion()) {
    figure.appendChild(img());
    return figure;
  }
  const play = h('button', {
    type: 'button',
    class: 'eg-gif-play',
    'aria-label': `Play animation${alt ? `: ${alt}` : ''}`,
  });
  play.append(svg(PLAY), h('span', { text: 'Play animation' }));
  play.addEventListener('click', () => play.replaceWith(img()));
  figure.appendChild(play);
  return figure;
}

function video(url: string, title: string, options: BlockOptions): HTMLElement | null {
  const label = title.trim() || 'Video';
  const embed = videoEmbed(url);
  if (embed?.provider === 'file') {
    const src = safeMediaUrl(embed.src);
    if (!src) return null;
    // A file on the host's own server: the browser's own controls, and
    // nothing downloaded until play is pressed.
    return h(
      'figure',
      { class: 'eg-video-file' },
      h('video', {
        src,
        controls: true,
        preload: 'none',
        playsinline: true,
        'aria-label': label,
      }),
    );
  }
  const player = embed
    ? { provider: embed.provider, src: embed.src, url: embed.url }
    : wistiaPlayer(url);
  if (!player) return null;

  if (!options.compact) return videoFacade(player, label);

  // In a banner there is no room for a player: a button opens one over the page.
  const open = h('button', { type: 'button', class: 'eg-watch' });
  open.append(svg(PLAY), h('span', { text: label }));
  open.addEventListener('click', () => {
    const facade = videoFacade(player, label);
    const close = h('button', {
      type: 'button',
      class: 'lightbox__close',
      'aria-label': 'Close video',
    });
    close.appendChild(svg(icons.close));
    const overlay = h(
      'div',
      {
        class: 'lightbox lightbox--video',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': label,
      },
      close,
      facade,
    );
    const dismiss = () => {
      overlay.remove();
      open.focus();
    };
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });
    overlay.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss();
      }
    });
    (open.getRootNode() as ShadowRoot).appendChild(overlay);
    // The click that opened it asked for the video, so it starts playing.
    facade.querySelector<HTMLButtonElement>('.hw-video__play')?.click();
  });
  return open;
}

/** An http(s) link, or a path on this site. Anything else is no link. */
export function safeLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\s<>"'`\\]/.test(trimmed)) return null;
  if (trimmed.startsWith('/')) return trimmed.startsWith('//') ? null : trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : null;
  } catch {
    return null;
  }
}
