/**
 * The editor kit's cards and the type picker.
 *
 * Every card has the canvas's header: a 26px icon tile in the section's tone,
 * a 14px title, and muted text or small buttons at the end. The tone says
 * which part of the editor a card belongs to (peach for a pop-up's slides,
 * butter for a banner, mint for a tour, blue for a survey, lavender for the
 * rest), so a long form reads as a few groups rather than a stack of boxes.
 */

import { html, join, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { type KitIconName, kitIcon } from './icons.js';

export type Tone = 'lavender' | 'peach' | 'butter' | 'mint' | 'blue';

/** The small coloured tile an icon sits in. */
export function glyph(icon: KitIconName, tone: Tone, size = 14): RawHtml {
  return html`<span class="ek-glyph ek-tone--${tone}" aria-hidden="true">${raw(kitIcon(icon, size))}</span>`;
}

export interface CardOptions {
  icon: KitIconName;
  tone: Tone;
  title: string | RawHtml;
  /** Muted words at the end of the header ("Any of 2"), or small buttons ("+ Add slide"). */
  meta?: string | RawHtml | null;
  id?: string;
  /** Heading level for the title; cards inside a section use 3. */
  level?: 2 | 3;
  /** The violet ring the canvas gives the one section being edited. */
  open?: boolean;
  class?: string;
  attrs?: RawHtml | null;
}

/** A card with the canvas's icon header, then whatever goes in it. */
export function card(options: CardOptions, ...body: (RawHtml | null | undefined)[]): RawHtml {
  const level = options.level ?? 2;
  return html`<section class="ek-card${options.open ? ' ek-card--open' : ''}${options.class ? ` ${options.class}` : ''}"${
    options.id ? html` id="${options.id}"` : null
  }${options.attrs ?? null}><div class="ek-card__head">${glyph(options.icon, options.tone)}<h${raw(String(level))} class="ek-card__title">${
    options.title
  }</h${raw(String(level))}>${options.meta ? html`<span class="ek-card__meta">${options.meta}</span>` : null}</div>${join(
    body.map((part) => part ?? null),
  )}</section>`;
}

export interface TypeChoice {
  value: string;
  label: string;
  icon: KitIconName;
  tone: Tone;
  /** Where choosing it goes; without one, the tile is shown but cannot be chosen. */
  href?: string | null;
  /** Why it cannot be chosen, or what it is. */
  title?: string;
}

/**
 * The row of type tiles at the top of an editor ("Pop-up · Banner · Tour …").
 * The current one is `aria-current`; the others are links, or inert when the
 * type cannot change.
 */
export function typeTiles(options: {
  label: string;
  current: string;
  choices: readonly TypeChoice[];
  /** Class for the row, kept for pages that look for it. */
  class?: string;
}): RawHtml {
  return html`<nav class="ek-types${options.class ? ` ${options.class}` : ''}" style="--ek-count:${options.choices.length}" aria-label="${options.label}">${join(
    options.choices.map((c) => {
      const inner = html`${glyph(c.icon, c.tone, 13)}<span>${c.label}</span>`;
      const title = c.title ? html` title="${c.title}"` : null;
      if (c.value === options.current) {
        return html`<span class="ek-type" aria-current="true"${title}>${inner}</span>`;
      }
      return c.href
        ? html`<a class="ek-type" href="${raw(safeHref(c.href))}"${title}>${inner}</a>`
        : html`<span class="ek-type" aria-disabled="true"${title}>${inner}</span>`;
    }),
  )}</nav>`;
}
