/**
 * Lists of the things an editor is made of (slides, steps, questions,
 * fields), and the panels that edit one of them at a time.
 *
 * A list row is a link to its item's panel, so with no script it jumps to
 * it and every panel shows. With the kit's script, choosing a row shows only
 * that item's panel, the chosen row is drawn in lavender, and rows can be
 * dragged into a new order: the drop posts the page's form with an op built
 * from the list's `reorder` template, so the page applies the move the same
 * way as its own move buttons.
 */

import { html, join, type RawHtml, raw } from '@helpwell/ui';
import { kitIcon } from './icons.js';

export interface ListOptions {
  /** What the list is, for screen readers. */
  label: string;
  /**
   * The op a drag posts, with `{from}` (the dragged row's `path`) and `{to}`
   * (its new index): e.g. `move|{from}|{to}`. Without it rows do not drag.
   */
  reorder?: string;
  /** The form field the op is posted under. Default `op`. */
  opName?: string;
  /** Rows, from `listRow`, or tiles, from `listThumb`. */
  rows: readonly RawHtml[];
  /** Tiles in a grid (slides) rather than rows. */
  thumbs?: boolean;
}

export function list(options: ListOptions): RawHtml {
  return html`<div class="${options.thumbs ? 'ek-thumbs' : 'ek-list'}" role="group" aria-label="${options.label}"${
    options.reorder
      ? html` data-ek-reorder="${options.reorder}" data-ek-op="${options.opName ?? 'op'}"`
      : null
  }>${join([...options.rows])}</div>`;
}

export interface RowOptions {
  /** 1-based number in the dot, or `check` for a closing item (a thank-you screen). */
  number: number | 'check';
  title: string | RawHtml;
  /** The id of the panel this row opens. */
  panel: string;
  /** The row's path, for dragging. */
  path?: string;
  current?: boolean;
  /** Chips before the title (a question's kind). */
  lead?: readonly RawHtml[];
  /** Chips after the title (a media tag, a selector, a branch). */
  trail?: readonly RawHtml[];
  /** Lighter title weight, for rows whose title is a sentence. */
  light?: boolean;
  /** An accessible name when the title alone is not enough. */
  label?: string;
}

/** A row: grip, number dot, optional kind chip, title, trailing chips. */
export function listRow(options: RowOptions): RawHtml {
  const dot =
    options.number === 'check'
      ? html`<span class="ek-num">${raw(kitIcon('check', 11, 2.4))}</span>`
      : html`<span class="ek-num">${options.number}</span>`;
  return html`<a class="ek-lrow${options.light ? ' ek-lrow--light' : ''}" href="#${options.panel}" data-ek-select="${options.panel}"${
    options.path ? html` data-ek-path="${options.path}" draggable="true"` : null
  }${options.current ? raw(' aria-current="true"') : null}${
    options.label ? html` aria-label="${options.label}"` : null
  }>${options.path ? html`<span class="ek-grip" aria-hidden="true">${raw(kitIcon('grip', 12, 2))}</span>` : null}${dot}${join(
    [...(options.lead ?? [])],
  )}<span class="ek-lrow__title">${options.title}</span>${join([...(options.trail ?? [])])}</a>`;
}

/** A tile: a small picture of the item over its number and title (a pop-up's slides). */
export function listThumb(options: {
  number: number;
  title: string;
  picture: RawHtml;
  panel: string;
  path?: string;
  current?: boolean;
  label?: string;
}): RawHtml {
  return html`<a class="ek-thumb" href="#${options.panel}" data-ek-select="${options.panel}"${
    options.path ? html` data-ek-path="${options.path}" draggable="true"` : null
  }${options.current ? raw(' aria-current="true"') : null}${
    options.label ? html` aria-label="${options.label}"` : null
  }><span class="ek-thumb__pic" aria-hidden="true">${options.picture}</span><span class="ek-thumb__cap">${
    options.path
      ? html`<span class="ek-grip" aria-hidden="true">${raw(kitIcon('grip', 12, 2))}</span>`
      : null
  }<span class="ek-num">${options.number}</span><span>${options.title}</span></span></a>`;
}

/**
 * The panels a list's rows open. Each panel needs the `id` its row names;
 * `current` is the one shown first (the others show too without script).
 */
export function panels(items: readonly { id: string; current: boolean; body: RawHtml }[]): RawHtml {
  return html`<div class="ek-col" data-ek-panels>${join(
    items.map(
      (item) =>
        html`<div data-ek-panel id="${item.id}"${item.current ? raw(' data-ek-current') : null} class="ek-col">${item.body}</div>`,
    ),
  )}</div>`;
}
