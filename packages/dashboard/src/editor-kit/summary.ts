/**
 * "Who sees it, and when": settings that read as one-line summaries and
 * open, one at a time, to be changed.
 *
 * Each is a `<details>` in one named group, so the browser keeps one open
 * (the kit's script does it where `name` is not supported yet). A closed
 * section's controls are still in the form, so anything left closed keeps
 * its setting when the form is saved.
 */

import { html, join, type RawHtml, raw } from '@helpwell/ui';
import { glyph, type Tone } from './card.js';
import type { KitIconName } from './icons.js';
import { kitIcon } from './icons.js';

export interface SummaryRowOptions {
  /** Used for the id (`<idPrefix><key>`) and the `data-summary` hook a script can rewrite. */
  key: string;
  icon: KitIconName;
  tone: Tone;
  /** The title when closed ("Frequency"). */
  title: string;
  /** The title when open, if longer ("Frequency and timing"). */
  openTitle?: string;
  /** Muted words at the end of the title ("12,480 people"). */
  meta?: string | null;
  /** The one sentence that says what is set. */
  summary: string | RawHtml;
  open?: boolean;
  /** The accordion group; rows sharing one open one at a time. */
  group: string;
  idPrefix?: string;
  /** The controls, shown when open. */
  body: RawHtml;
}

export function summaryRow(options: SummaryRowOptions): RawHtml {
  const title = options.openTitle
    ? html`<span class="ek-sum__closed">${options.title}</span><span class="ek-sum__open">${options.openTitle}</span>`
    : options.title;
  return html`<details class="ek-sum" name="${options.group}" data-ek-accordion id="${options.idPrefix ?? ''}${options.key}"${
    options.open ? raw(' open') : null
  }>
  <summary>${glyph(options.icon, options.tone)}<span class="ek-sum__body"><span class="ek-sum__top"><span>${title}</span>${
    options.meta
      ? html`<span class="ek-sum__meta" data-summary-meta="${options.key}">${options.meta}</span>`
      : null
  }</span><span class="ek-sum__text" data-summary="${options.key}">${options.summary}</span></span><span class="ek-sum__chev" aria-hidden="true">${raw(
    kitIcon('chev-r', 14, 2),
  )}</span></summary>
  <div class="ek-sum__panel">${options.body}</div>
</details>`;
}

/** The column the rows sit in, with its heading and the line under them. */
export function summaryColumn(options: {
  title: string;
  hint?: string;
  rows: readonly RawHtml[];
  foot?: string | RawHtml;
}): RawHtml {
  return html`<div class="ek-who">
  <div class="ek-who__head"><h2 class="ek-who__title">${options.title}</h2>${
    options.hint ? html`<span class="ek-who__hint">${options.hint}</span>` : null
  }</div>
  ${join([...options.rows])}
  ${options.foot ? html`<p class="ek-who__foot">${options.foot}</p>` : null}
</div>`;
}
