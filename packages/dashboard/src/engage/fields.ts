/**
 * Inputs for the engage editor, named for the form parser (form.ts), drawn
 * with the editor kit.
 *
 * Each helper takes the dotted path of the value it edits, and the editor's
 * `Fields` (the draft's errors and what was typed), so a problem the server
 * found lands beside its own box with the typed value still in it. The type
 * suffix the parser reads (`:num`, `:bool`, `:lines`, `:arr`) is added here,
 * so the editor only ever names the path.
 */

import { html, join, type RawHtml, raw } from '@helpwell/ui';
import {
  type Choice,
  choiceChips,
  field,
  type KitIconName,
  kitButton,
  segmented as kitSegmented,
  textArea as kitTextArea,
  pillInput,
  selectInput,
  settingRow,
  type TileChoice,
  textInput,
  tilePicker,
  toggle,
} from '../editor-kit/index.js';
import { bannerTone, modalLayout, placement } from './sketches.js';

export interface Fields {
  errors: Map<string, string>;
  typed: Map<string, unknown>;
}

/** What to show in a box: what was typed if the server refused it, else the value. */
export function shown(fields: Fields, path: string, value: unknown): string {
  const typed = fields.typed.get(path);
  const pick = typed !== undefined ? typed : value;
  if (pick === null || pick === undefined) return '';
  return Array.isArray(pick) ? pick.join('\n') : String(pick);
}

export function errorOf(fields: Fields, path: string): string | null {
  return fields.errors.get(path) ?? null;
}

interface BoxOptions {
  hint?: string;
  placeholder?: string;
  type?: string;
  maxlength?: number;
  mono?: boolean;
  icon?: KitIconName;
  aside?: string | RawHtml | null;
  inline?: boolean;
  attrs?: RawHtml | null;
}

export function textBox(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  options: BoxOptions = {},
): RawHtml {
  return field(
    {
      label,
      hint: options.hint ?? null,
      error: errorOf(fields, path),
      aside: options.aside ?? null,
      inline: options.inline,
    },
    textInput({
      name: path,
      value: shown(fields, path, value),
      type: options.type,
      placeholder: options.placeholder,
      maxlength: options.maxlength,
      mono: options.mono,
      icon: options.icon,
      attrs: options.attrs,
    }),
  );
}

export function numberBox(
  fields: Fields,
  label: string,
  path: string,
  value: number | null,
  options: { hint?: string; min?: number; max?: number; inline?: boolean } = {},
): RawHtml {
  return field(
    { label, hint: options.hint ?? null, error: errorOf(fields, path), inline: options.inline },
    numberInput(fields, path, value, { min: options.min, max: options.max, label }),
  );
}

/** A number drawn as a condition pill, for a sentence of pills ("if Score [0] to [6]"). */
export function pillNumber(
  fields: Fields,
  path: string,
  value: number | null,
  options: { min?: number; max?: number; label: string },
): RawHtml {
  const typed = fields.typed.get(path);
  return pillInput({
    name: `${path}:num`,
    value: typed !== undefined ? String(typed) : value,
    type: 'number',
    min: options.min,
    max: options.max,
    width: 'num',
    label: options.label,
  });
}

/** A bare number box (no label row), for a sentence or a setting row. */
export function numberInput(
  fields: Fields,
  path: string,
  value: number | null,
  options: { min?: number; max?: number; label: string },
): RawHtml {
  return textInput({
    name: `${path}:num`,
    value: shown(fields, path, value),
    type: 'number',
    min: options.min,
    max: options.max,
    narrow: true,
    label: options.label,
  });
}

export function textArea(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  options: { hint?: string; rows?: number; code?: boolean; placeholder?: string } = {},
): RawHtml {
  return field(
    { label, hint: options.hint ?? null, error: errorOf(fields, path) },
    kitTextArea({
      name: path,
      value: shown(fields, path, value),
      rows: options.rows ?? 3,
      placeholder: options.placeholder,
      mono: options.code,
    }),
  );
}

/** One item per line. */
export function linesBox(
  fields: Fields,
  label: string,
  path: string,
  values: readonly string[],
  options: { hint?: string; rows?: number; placeholder?: string; mono?: boolean } = {},
): RawHtml {
  return field(
    { label, hint: options.hint ?? 'One per line.', error: errorOf(fields, path) },
    kitTextArea({
      name: `${path}:lines`,
      value: shown(fields, path, values),
      rows: options.rows ?? 2,
      placeholder: options.placeholder,
      mono: options.mono,
    }),
  );
}

export function choice(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  choices: readonly { value: string; label: string }[],
  options: { hint?: string; data?: string; inline?: boolean } = {},
): RawHtml {
  return field(
    { label, hint: options.hint ?? null, error: errorOf(fields, path), inline: options.inline },
    selectInput({
      name: path,
      value: shown(fields, path, value),
      choices,
      attrs: options.data ? raw(` ${options.data}`) : null,
    }),
  );
}

/** A drop-down drawn as a condition pill, with no label row. */
export function pillChoice(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  choices: readonly (Choice | { group: string; choices: readonly Choice[] })[],
  options: { look?: 'pill' | 'pill-op' | 'pill-val'; attrs?: RawHtml | null; grow?: boolean } = {},
): RawHtml {
  return selectInput({
    name: path,
    value: shown(fields, path, value),
    choices,
    look: options.look ?? 'pill',
    label,
    attrs: options.attrs,
    grow: options.grow,
  });
}

/**
 * A short set of choices, all on show: radios drawn as the canvas's
 * segmented pill. Posts exactly what a select would. With `tiles`, and a
 * `sketch` named on each choice, they are tiles with a small drawing each
 * (the names the first editor used: `media-top`, `tone-brand`, `corner`…).
 */
export function segmented(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  choices: readonly (Choice & { sketch?: string })[],
  options: {
    hint?: string;
    rerender?: boolean;
    inline?: boolean;
    full?: boolean;
    aside?: string | RawHtml | null;
    attrs?: RawHtml | null;
    tiles?: boolean;
  } = {},
): RawHtml {
  if (options.tiles) {
    return tiles(
      fields,
      label,
      path,
      value,
      choices.map((c) => ({ value: c.value, label: c.label, sketch: namedSketch(c.sketch) })),
      { hint: options.hint, rerender: options.rerender },
    );
  }
  return field(
    {
      label,
      as: 'group',
      hint: options.hint ?? null,
      error: errorOf(fields, path),
      inline: options.inline,
      aside: options.aside ?? null,
    },
    kitSegmented({
      name: path,
      value: shown(fields, path, value),
      choices,
      full: options.full,
      attrs: html`${options.rerender ? raw(' data-rerender') : null}${options.attrs ?? null}`,
    }),
  );
}

/** The first editor's sketch names, drawn the kit's way. */
function namedSketch(name: string | undefined): RawHtml {
  switch (name) {
    case 'media-top':
      return modalLayout('top');
    case 'media-side':
      return modalLayout('side');
    case 'media-full':
      return modalLayout('background');
    case 'tone-brand':
      return bannerTone('accent');
    case 'tone-subtle':
      return bannerTone('neutral');
    case 'tone-warning':
      return bannerTone('warning');
    case 'tone-custom':
      return bannerTone('custom');
    case 'corner':
    case 'center':
    case 'bar':
      return placement(name);
    default:
      return placement('none');
  }
}

/** Choices as tiles with a small drawing of each. */
export function tiles(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  choices: readonly TileChoice[],
  options: {
    hint?: string;
    aside?: string | null;
    rerender?: boolean;
    columns?: number;
    hideLabel?: boolean;
  } = {},
): RawHtml {
  return field(
    {
      label,
      as: 'group',
      hint: options.hint ?? null,
      aside: options.aside ?? null,
      error: errorOf(fields, path),
      hideLabel: options.hideLabel,
    },
    tilePicker({
      name: path,
      value: shown(fields, path, value),
      choices,
      columns: options.columns,
      attrs: options.rerender ? raw(' data-rerender') : null,
    }),
  );
}

/** A switch. The hidden "false" before it is what an unticked one posts. */
export function checkBox(
  fields: Fields,
  label: string,
  path: string,
  checked: boolean,
  hint?: string,
): RawHtml {
  const typed = fields.typed.get(path);
  return toggle({
    name: `${path}:bool`,
    checked: typeof typed === 'boolean' ? typed : checked,
    label,
    hint,
    error: errorOf(fields, path),
  });
}

/** A bare switch, for the end of a setting row. */
export function switchOnly(path: string, checked: boolean, label: string): RawHtml {
  return toggle({ name: `${path}:bool`, checked, attrs: html` aria-label="${label}"` });
}

/** A setting row whose control has its own error line under the row. */
export function row(
  fields: Fields,
  paths: readonly string[],
  options: Parameters<typeof settingRow>[0],
): RawHtml {
  const errors = paths.map((p) => errorOf(fields, p)).filter((e): e is string => Boolean(e));
  if (errors.length === 0) return settingRow(options);
  return html`<div class="ek-field" data-invalid="true">${settingRow(options)}${join(
    errors.map((e) => html`<span class="ek-field__error" role="alert">${e}</span>`),
  )}</div>`;
}

/** Several checkboxes, drawn as chips, posting one list. */
export function checkGroup(
  label: string,
  path: string,
  values: readonly string[],
  options: readonly { value: string; label: string; icon?: KitIconName }[],
): RawHtml {
  return field(
    { label, as: 'group' },
    html`<input type="hidden" name="${path}:arr" value="">${choiceChips({
      name: `${path}:arr`,
      type: 'checkbox',
      values,
      choices: options,
    })}`,
  );
}

export function hidden(path: string, value: string): RawHtml {
  return html`<input type="hidden" name="${path}" value="${value}">`;
}

const GLYPHS: Record<'up' | 'down' | 'left' | 'right' | 'remove' | 'copy', KitIconName> = {
  up: 'arrow-up',
  down: 'arrow-down',
  left: 'arrow-l',
  right: 'arrow-r',
  remove: 'trash',
  copy: 'copy',
};

/** A structural button (add, remove, move): it posts the form with `op`. */
export function opButton(
  label: string,
  op: string,
  options: {
    glyph?: keyof typeof GLYPHS;
    tone?: 'danger';
    icon?: KitIconName;
    look?: 'accent' | 'link' | 'mini';
  } = {},
): RawHtml {
  if (options.glyph) {
    return kitButton({
      label,
      icon: GLYPHS[options.glyph],
      iconOnly: true,
      look: 'bare',
      name: 'op',
      value: op,
      noValidate: true,
      attrs: options.tone === 'danger' ? raw(' data-tone="danger"') : null,
    });
  }
  return kitButton({
    // The plus is drawn as an icon; a label written as "+ Slide" does not repeat it.
    label: label.replace(/^\+\s*/, ''),
    icon: options.icon ?? 'plus',
    look: options.look ?? 'accent',
    name: 'op',
    value: op,
    noValidate: true,
  });
}

/** An error not tied to one box, e.g. "a slide needs a block". */
export function pathError(fields: Fields, path: string): RawHtml | null {
  const message = errorOf(fields, path);
  return message ? html`<p class="ek-field__error" role="alert">${message}</p>` : null;
}
