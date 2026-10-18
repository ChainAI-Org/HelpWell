/**
 * The editor kit's form controls: labelled fields, inputs, segmented
 * controls, tiles with sketches, switches, setting rows, pills and chips.
 *
 * Every control is a real form control with the `name` it is given, so a
 * page's own form posts it and the page's own parser reads it: nothing here
 * knows how a value is stored. Values and labels are escaped; only markup a
 * caller built with `html` (a sketch, an icon) goes in unescaped.
 */

import { html, join, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { type KitIconName, kitIcon } from './icons.js';

/* ------------------------------------------------------------------ fields */

export interface FieldOptions {
  /** The words over the control. */
  label: string;
  /** Muted text at the end of the label row: a hint about what goes in, or small buttons. */
  aside?: string | RawHtml | null;
  /** Muted text under the control. */
  hint?: string | RawHtml | null;
  /** A problem with the value, shown under it in red, and the control marked invalid. */
  error?: string | null;
  /**
   * `label` wraps a single control, so clicking the words focuses it.
   * `group` is for several controls (radios, a row of inputs): a labelled group.
   */
  as?: 'label' | 'group';
  /** Label on the left, control on the right, on one line. */
  inline?: boolean;
  /** Keep the label for screen readers only, when the card's title already says it. */
  hideLabel?: boolean;
  id?: string;
  class?: string;
}

let groupIds = 0;

/**
 * A labelled field: label (and aside), the control, then hint and error.
 * The error is announced (`role="alert"`) when the page loads with one.
 */
export function field(options: FieldOptions, control: RawHtml | null): RawHtml {
  const tag = options.as === 'group' ? 'div' : 'label';
  const labelId = options.as === 'group' ? `ek-l${++groupIds}` : null;
  const labelClass = options.hideLabel ? 'ek-field__label ek-sr' : 'ek-field__label';
  const head = options.aside
    ? html`<span class="ek-field__head"><span class="${labelClass}"${labelId ? html` id="${labelId}"` : null}>${options.label}</span><span class="ek-field__aside">${options.aside}</span></span>`
    : html`<span class="${labelClass}"${labelId ? html` id="${labelId}"` : null}>${options.label}</span>`;
  const cls = `ek-field${options.inline ? ' ek-field--inline' : ''}${options.class ? ` ${options.class}` : ''}`;
  return html`<${raw(tag)} class="${cls}"${options.id ? html` id="${options.id}"` : null}${
    labelId ? html` role="group" aria-labelledby="${labelId}"` : null
  }${options.error ? raw(' data-invalid="true"') : null}>${head}${control}${
    options.hint ? html`<span class="ek-field__hint">${options.hint}</span>` : null
  }${options.error ? html`<span class="ek-field__error" role="alert">${options.error}</span>` : null}</${raw(tag)}>`;
}

export interface InputOptions {
  name: string;
  value?: string | number | null;
  type?: string;
  placeholder?: string;
  maxlength?: number;
  min?: number;
  max?: number;
  step?: number | 'any';
  /** Code-like values: selectors, ids, paths. */
  mono?: boolean;
  /** A small number box rather than full width. */
  narrow?: boolean;
  /** An icon inside the start of the box. */
  icon?: KitIconName;
  /** Something inside the end of the box: a unit, a small switch. */
  end?: RawHtml | string | null;
  id?: string;
  /** Extra attributes, already escaped: `data-*` hooks. */
  attrs?: RawHtml | null;
  label?: string;
}

/** A one-line text (or number, date, url) box in the canvas's look. */
export function textInput(options: InputOptions): RawHtml {
  const cls = `ek-input${options.mono ? ' ek-input--mono' : ''}${options.narrow ? ' ek-input--num' : ''}`;
  const extra = [
    options.maxlength ? html` maxlength="${options.maxlength}"` : null,
    options.min !== undefined ? html` min="${options.min}"` : null,
    options.max !== undefined ? html` max="${options.max}"` : null,
    options.step !== undefined ? html` step="${String(options.step)}"` : null,
    options.type === 'number' ? raw(' inputmode="numeric"') : null,
    options.id ? html` id="${options.id}"` : null,
    options.label ? html` aria-label="${options.label}"` : null,
    options.attrs ?? null,
  ];
  const input = html`<input class="${cls}" type="${options.type ?? 'text'}" name="${options.name}" value="${
    options.value === null || options.value === undefined ? '' : String(options.value)
  }" placeholder="${options.placeholder ?? ''}"${join(extra)}>`;
  if (!options.icon && !options.end) return input;
  return html`<span class="ek-affix">${options.icon ? raw(kitIcon(options.icon, 14)) : null}${input}${
    options.end ? html`<span class="ek-affix__end">${options.end}</span>` : null
  }</span>`;
}

/** A multi-line box. */
export function textArea(options: {
  name: string;
  value: string;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
  maxlength?: number;
  attrs?: RawHtml | null;
  label?: string;
}): RawHtml {
  return html`<textarea class="ek-input${options.mono ? ' ek-input--mono' : ''}" name="${options.name}" rows="${options.rows ?? 3}" placeholder="${options.placeholder ?? ''}"${
    options.maxlength ? html` maxlength="${options.maxlength}"` : null
  }${options.label ? html` aria-label="${options.label}"` : null}${options.attrs ?? null}>${options.value}</textarea>`;
}

export interface Choice {
  value: string;
  label: string;
  icon?: KitIconName;
}

/**
 * A drop-down. `look: 'pill'` draws it as one of the canvas's condition
 * pills; `group` puts options under headings.
 */
export function selectInput(options: {
  name: string;
  value: string;
  choices: readonly (Choice | { group: string; choices: readonly Choice[] })[];
  look?: 'box' | 'pill' | 'pill-op' | 'pill-val';
  label?: string;
  attrs?: RawHtml | null;
  grow?: boolean;
}): RawHtml {
  const option = (c: Choice) =>
    html`<option value="${c.value}"${c.value === options.value ? raw(' selected') : null}>${c.label}</option>`;
  const look = options.look ?? 'box';
  const cls =
    look === 'box'
      ? 'ek-input'
      : `ek-pill${look === 'pill-op' ? ' ek-pill--op' : look === 'pill-val' ? ' ek-pill--val' : ''}${options.grow ? ' ek-pill--grow' : ''}`;
  return html`<select class="${cls}" name="${options.name}"${options.label ? html` aria-label="${options.label}"` : null}${
    options.attrs ?? null
  }>${join(
    options.choices.map((c) =>
      'group' in c
        ? html`<optgroup label="${c.group}">${join(c.choices.map(option))}</optgroup>`
        : option(c),
    ),
  )}</select>`;
}

/** A small box drawn as a condition pill: `[ 60 ]` in "reaches [60] %". */
export function pillInput(options: {
  name: string;
  value: string | number | null;
  type?: 'text' | 'number';
  placeholder?: string;
  label: string;
  mono?: boolean;
  width?: 'num' | 'grow';
  min?: number;
  max?: number;
  attrs?: RawHtml | null;
}): RawHtml {
  const cls = `ek-pill ek-pill--val${options.mono ? ' ek-pill--mono' : ''}${
    options.width === 'num' ? ' ek-pill--num' : options.width === 'grow' ? ' ek-pill--grow' : ''
  }`;
  return html`<input class="${cls}" type="${options.type ?? 'text'}" name="${options.name}" value="${
    options.value === null ? '' : String(options.value)
  }" placeholder="${options.placeholder ?? ''}" aria-label="${options.label}"${
    options.min !== undefined ? html` min="${options.min}"` : null
  }${options.max !== undefined ? html` max="${options.max}"` : null}${
    options.type === 'number' ? raw(' inputmode="numeric"') : null
  }${options.attrs ?? null}>`;
}

/** A row of pills that reads as a sentence: "when [Scroll depth] [reaches] [60%]". */
export function filterRow(word: string, ...parts: (RawHtml | null)[]): RawHtml {
  return html`<div class="ek-filter"><span class="ek-filter__word">${word}</span>${join(parts)}</div>`;
}

/** Words drawn as a static pill, for the fixed parts of a sentence. */
export function pill(
  text: string | RawHtml,
  look: 'field' | 'op' | 'val' = 'field',
  icon?: KitIconName,
): RawHtml {
  return html`<span class="ek-pill${look === 'op' ? ' ek-pill--op' : look === 'val' ? ' ek-pill--val' : ''}">${
    icon ? raw(kitIcon(icon, 13)) : null
  }${text}</span>`;
}

/* -------------------------------------------------------------- segmented */

export interface SegmentedOptions {
  name: string;
  value: string;
  choices: readonly Choice[];
  /** What the group is, for screen readers, when no field label names it. */
  label?: string;
  size?: 'sm' | 'md';
  /** Stretch to the width, each option an equal share. */
  full?: boolean;
  /** Extra attributes on every radio: `data-rerender`, say. */
  attrs?: RawHtml | null;
}

/**
 * Radio buttons drawn as the canvas's segmented pill. Posts exactly what a
 * select would. A value that is none of the choices leaves them all
 * unchecked, so whatever default the page applies stands.
 */
export function segmented(options: SegmentedOptions): RawHtml {
  return html`<span class="ek-seg${options.size === 'md' ? ' ek-seg--md' : ''}${options.full ? ' ek-seg--full' : ''}" role="radiogroup"${
    options.label ? html` aria-label="${options.label}"` : null
  }>${join(
    options.choices.map(
      (c) =>
        html`<label class="ek-seg__opt"><input type="radio" name="${options.name}" value="${c.value}"${
          c.value === options.value ? raw(' checked') : null
        }${options.attrs ?? null}><span class="ek-seg__label">${c.icon ? raw(kitIcon(c.icon, 13)) : null}${c.label}</span></label>`,
    ),
  )}</span>`;
}

/** Buttons drawn as a segmented pill, for page state that is not a form value (Desktop / Mobile). */
export function segmentedButtons(options: {
  label: string;
  current: string;
  choices: readonly Choice[];
  data: string;
  size?: 'sm' | 'md';
}): RawHtml {
  return html`<span class="ek-seg${options.size === 'md' ? ' ek-seg--md' : ''}" role="group" aria-label="${options.label}">${join(
    options.choices.map(
      (c) =>
        html`<button type="button" ${raw(options.data)}="${c.value}" aria-pressed="${String(c.value === options.current)}">${
          c.icon ? raw(kitIcon(c.icon, 13)) : null
        }${c.label}</button>`,
    ),
  )}</span>`;
}

/* ------------------------------------------------------------------ tiles */

export interface TileChoice {
  value: string;
  label: string;
  /** The small drawing of what this choice looks like: see `sketch()`. */
  sketch: RawHtml;
}

/**
 * Radio buttons drawn as tiles, each with a small picture of the choice:
 * layouts, positions, styles. The chosen tile gets the canvas's violet ring.
 */
export function tilePicker(options: {
  name: string;
  value: string;
  choices: readonly TileChoice[];
  columns?: number;
  label?: string;
  attrs?: RawHtml | null;
}): RawHtml {
  const columns = options.columns ?? options.choices.length;
  return html`<span class="ek-tiles" style="--ek-cols:${columns}" role="radiogroup"${
    options.label ? html` aria-label="${options.label}"` : null
  }>${join(
    options.choices.map(
      (c) =>
        html`<label class="ek-tile"><input type="radio" name="${options.name}" value="${c.value}"${
          c.value === options.value ? raw(' checked') : null
        }${options.attrs ?? null}>${c.sketch}<span class="ek-tile__label">${c.label}</span></label>`,
    ),
  )}</span>`;
}

/**
 * The frame a tile's drawing sits in. `inner` is positioned children using
 * the `ek-sk-*` classes (a card, a line, a media block, ink, accent).
 */
export function sketch(inner: RawHtml, options: { tall?: boolean; style?: string } = {}): RawHtml {
  return html`<span class="ek-sketch${options.tall ? ' ek-sketch--tall' : ''}" aria-hidden="true"${
    options.style ? html` style="${options.style}"` : null
  }>${inner}</span>`;
}

/* ---------------------------------------------------------------- switches */

export interface ToggleOptions {
  name: string;
  checked: boolean;
  label?: string;
  hint?: string;
  /** What an unticked switch posts, from a hidden input before it. Default `false`; null for nothing. */
  off?: string | null;
  /** What a ticked switch posts. Default `true`. */
  on?: string;
  error?: string | null;
  /** The switch at the end of the row, words first. */
  end?: boolean;
  attrs?: RawHtml | null;
}

/**
 * The canvas's switch: a checkbox drawn as a toggle. By default a hidden
 * `false` precedes it under the same name, so an unticked switch still posts
 * a value and "the last value wins" reads it.
 */
export function toggle(options: ToggleOptions): RawHtml {
  const off = options.off === undefined ? 'false' : options.off;
  return html`<label class="ek-toggle${options.end ? ' ek-toggle--end' : ''}"${options.error ? raw(' data-invalid="true"') : null}>${
    off === null ? null : html`<input type="hidden" name="${options.name}" value="${off}">`
  }<input type="checkbox" name="${options.name}" value="${options.on ?? 'true'}"${options.checked ? raw(' checked') : null}${
    options.label ? null : raw(' aria-label="On"')
  }${options.attrs ?? null}>${
    options.label
      ? html`<span class="ek-toggle__text"><span class="ek-toggle__label">${options.label}</span>${
          options.hint ? html`<span class="ek-toggle__hint">${options.hint}</span>` : null
        }${options.error ? html`<span class="ek-field__error" role="alert">${options.error}</span>` : null}</span>`
      : null
  }</label>`;
}

/**
 * One setting as a row: a small icon tile, the words, and its control at the
 * end ("How often … [Every visit until dismissed]").
 */
export function settingRow(options: {
  icon: KitIconName;
  title: string | RawHtml;
  sub?: string | RawHtml | null;
  control?: RawHtml | null;
  id?: string;
  attrs?: RawHtml | null;
}): RawHtml {
  return html`<div class="ek-row"${options.id ? html` id="${options.id}"` : null}${options.attrs ?? null}><span class="ek-row__icon" aria-hidden="true">${raw(
    kitIcon(options.icon, 13),
  )}</span><span class="ek-row__text"><span class="ek-row__title">${options.title}</span>${
    options.sub ? html`<span class="ek-row__sub">${options.sub}</span>` : null
  }</span>${options.control ? html`<span class="ek-row__control">${options.control}</span>` : null}</div>`;
}

/* ------------------------------------------------------------------ chips */

/**
 * Checkboxes or radios drawn as small chips, for picking from a short list
 * ("Desktop", "Mobile"; a trigger type).
 */
export function choiceChips(options: {
  name: string;
  type: 'checkbox' | 'radio';
  values: readonly string[];
  choices: readonly Choice[];
  label?: string;
  attrs?: RawHtml | null;
}): RawHtml {
  return html`<span class="ek-choices" role="${options.type === 'radio' ? 'radiogroup' : 'group'}"${
    options.label ? html` aria-label="${options.label}"` : null
  }>${join(
    options.choices.map(
      (c) =>
        html`<label class="ek-choice"><input type="${options.type}" name="${options.name}" value="${c.value}"${
          options.values.includes(c.value) ? raw(' checked') : null
        }${options.attrs ?? null}>${c.icon ? raw(kitIcon(c.icon, 12)) : null}${c.label}</label>`,
    ),
  )}</span>`;
}

export type ChipLook = 'type' | 'mono' | 'tag' | 'warn' | 'accent' | 'kind';

/** A small label: a question's kind, a selector, a media tag, a branch. */
export function chip(text: string | RawHtml, look: ChipLook = 'type', icon?: KitIconName): RawHtml {
  const cls = look === 'type' ? 'ek-chip' : `ek-chip ek-chip--${look}`;
  return html`<span class="${cls}"${look === 'mono' && typeof text === 'string' ? html` title="${text}"` : null}>${
    icon ? raw(kitIcon(icon, look === 'tag' ? 10 : 12)) : null
  }${text}</span>`;
}

/* ---------------------------------------------------------------- buttons */

export interface ButtonOptions {
  label: string;
  icon?: KitIconName;
  /** A submit button's name and value, e.g. `op` and `remove|path`. */
  name?: string;
  value?: string;
  type?: 'submit' | 'button';
  look?: 'mini' | 'accent' | 'danger' | 'bare' | 'link' | 'primary' | 'secondary';
  /** Show only the icon; the label becomes its accessible name and tooltip. */
  iconOnly?: boolean;
  /** The id of a form elsewhere on the page this button submits. */
  form?: string;
  /** Skip the browser's own validation, for structural edits. */
  noValidate?: boolean;
  href?: string;
  attrs?: RawHtml | null;
}

/** The kit's buttons: the small bordered ones, the violet "+ Add", bare icons, top-bar buttons. */
export function kitButton(options: ButtonOptions): RawHtml {
  const look = options.look ?? 'mini';
  const cls =
    look === 'link'
      ? 'ek-addlink'
      : look === 'primary' || look === 'secondary'
        ? `ek-btn ek-btn--${look}`
        : `ek-mini${look === 'mini' ? '' : ` ek-mini--${look}`}`;
  const icon = options.icon ? raw(kitIcon(options.icon, look === 'link' ? 13 : 12, 2)) : null;
  const inner = options.iconOnly ? icon : html`${icon}<span>${options.label}</span>`;
  const named = options.iconOnly
    ? html` aria-label="${options.label}" title="${options.label}"`
    : null;
  if (options.href) {
    return html`<a class="${cls}" href="${raw(safeHref(options.href))}"${named}${options.attrs ?? null}>${inner}</a>`;
  }
  return html`<button class="${cls}" type="${options.type ?? (options.name ? 'submit' : 'button')}"${
    options.form ? html` form="${options.form}"` : null
  }${options.name ? html` name="${options.name}" value="${options.value ?? ''}"` : null}${
    options.noValidate ? raw(' formnovalidate') : null
  }${named}${options.attrs ?? null}>${inner}</button>`;
}

/**
 * A button that opens a small panel beside it: a menu, a form, some help.
 * A `<details>`, so it opens without JavaScript; the kit's script closes it
 * on a click elsewhere or Escape.
 */
export function popover(options: {
  trigger: RawHtml;
  body: RawHtml;
  /** Trigger's class, e.g. `ek-tb` for a toolbar button or `ek-mini`. */
  triggerClass?: string;
  label?: string;
  align?: 'start' | 'end';
  up?: boolean;
  attrs?: RawHtml | null;
}): RawHtml {
  return html`<details class="ek-pop${options.align === 'end' ? ' ek-pop--end' : ''}${options.up ? ' ek-pop--up' : ''}"${
    options.attrs ?? null
  }><summary class="${options.triggerClass ?? 'ek-mini'}"${
    options.label ? html` aria-label="${options.label}" title="${options.label}"` : null
  }>${options.trigger}</summary><div class="ek-pop__panel">${options.body}</div></details>`;
}

/** Items for a popover menu: each a submit button (`name`/`value`) or a plain button. */
export function menu(
  items: readonly {
    label: string;
    icon?: KitIconName;
    name?: string;
    value?: string;
    attrs?: RawHtml | null;
  }[],
): RawHtml {
  return html`<div class="ek-menu" role="menu">${join(
    items.map(
      (item) =>
        html`<button class="ek-menu__item" role="menuitem" type="${item.name ? 'submit' : 'button'}"${
          item.name ? html` name="${item.name}" value="${item.value ?? ''}" formnovalidate` : null
        }${item.attrs ?? null}>${item.icon ? raw(kitIcon(item.icon, 14)) : null}${item.label}</button>`,
    ),
  )}</div>`;
}
