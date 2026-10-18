/**
 * A form being edited: the builder's HTML form read back into a definition,
 * checked, and kept drawable even when it is not valid yet.
 *
 * The same round trip as the engage editor, with the same form parser
 * (engage/form.ts): every input is named by the path of the value it holds,
 * a draft with a mistake still renders with the message beside the box, and
 * the add, remove and move buttons post the form with an `op`. Block edits
 * are engage's own ops (engage/draft.ts); fields, variants and bonus actions
 * are this file's.
 */

import {
  checkForm,
  type Form,
  type FormDefinition,
  type FormProblem,
  formDefinitionSchema,
  parseFormDefinition,
  publicForm,
} from '@helpwell/core/repos';
import { rowsToConditions } from '../engage/conditions.js';
import { applyOp as applyBlockOp } from '../engage/draft.js';
import { formToObject, getPath, setPath, zonedToIso } from '../engage/form.js';

type Loose = Record<string, unknown>;

export interface FormDraft {
  definition: FormDefinition;
  name: string;
  /** Field path to message. */
  errors: Map<string, string>;
  /** What was typed into a box the schema refused. */
  typed: Map<string, unknown>;
  raw: Loose;
}

/** The parts of the builder's form that are about the page, not the definition. */
const PAGE_ONLY = ['name', 'preview', 'enabled', 'expectedVersion', 'id', 'note'];

/** The builder's form as the nested object the schema expects. */
export function readFormDraft(form: FormData, options: { timeZone?: string }): Loose {
  const raw = formToObject(form) as Loose;
  const mode = raw.frequencyMode;
  const days = raw.frequencyDays;
  delete raw.frequencyMode;
  delete raw.frequencyDays;
  if (mode === 'every') raw.frequency = { everyDays: days ?? 7 };
  else if (mode === 'always' || mode === 'once') raw.frequency = mode;

  // Date-time boxes are in the product's time zone; the schema wants instants.
  for (const at of ['schedule', 'giveaway'] as const) {
    const section = raw[at] as Loose | undefined;
    if (!section) continue;
    const keys =
      at === 'schedule' ? (['start', 'end'] as const) : (['startsAt', 'endsAt'] as const);
    for (const key of keys) {
      const value = section[key];
      section[key] =
        typeof value === 'string' && value.trim()
          ? (zonedToIso(value, options.timeZone) ?? value)
          : null;
    }
  }

  // A variant's empty box means "as the form", not "blank".
  if (Array.isArray(raw.variants)) {
    for (const variant of raw.variants as Loose[]) {
      for (const part of ['style', 'layout', 'content'] as const) {
        const section = variant?.[part] as Loose | undefined;
        if (!section || typeof section !== 'object') continue;
        for (const [key, value] of Object.entries(section)) {
          if (value === '') delete section[key];
          if (key === 'image' && value && typeof value === 'object' && !(value as Loose).url) {
            delete section[key];
          }
        }
        if (Object.keys(section).length === 0) delete variant[part];
      }
    }
  }

  // Conditions: the builder's rows, or rule JSON typed in by hand.
  const targeting = raw.targeting as Loose | undefined;
  if (targeting) {
    if ('conditionsJson' in targeting) {
      targeting.conditions = targeting.conditionsJson;
      delete targeting.conditionsJson;
    } else if ('rules' in targeting) {
      targeting.conditions = rowsToConditions(targeting.rules, targeting.match);
    }
    delete targeting.rules;
    delete targeting.match;
  }
  return raw;
}

/** Parse, setting aside whatever the schema refuses, and (for a save) check it is complete. */
export function draftFromRaw(
  raw: Loose,
  options: { id: string; name: string; mode: 'save' | 'edit'; tours?: readonly string[] },
): FormDraft {
  const definitionInput: Loose = { ...raw };
  for (const key of PAGE_ONLY) delete definitionInput[key];
  const { definition, errors, typed } = repair(definitionInput);
  if (options.mode === 'save') {
    const problems: FormProblem[] = checkForm(definition, { tours: options.tours });
    for (const problem of problems) {
      if (!errors.has(problem.path)) errors.set(problem.path, problem.message);
    }
  }
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : options.name;
  return { definition, name: name || options.name, errors, typed, raw };
}

function repair(raw: Loose): {
  definition: FormDefinition;
  errors: Map<string, string>;
  typed: Map<string, unknown>;
} {
  const errors = new Map<string, string>();
  const typed = new Map<string, unknown>();
  const current = structuredClone(raw);
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = formDefinitionSchema.safeParse(current);
    if (result.success) return { definition: result.data, errors, typed };
    for (const issue of result.error.issues) {
      let path = issue.path.map(String);
      const key = path.join('.');
      if (!errors.has(key)) errors.set(key, friendly(issue));
      if (!typed.has(key)) typed.set(key, getPath(current, key));
      while (removed.has(path.join('.')) && path.length > 0) path = path.slice(0, -1);
      if (path.length === 0) break;
      removed.add(path.join('.'));
      deletePath(current, path);
    }
  }
  return { definition: parseFormDefinition({}), errors, typed };
}

function deletePath(target: Loose, path: string[]): void {
  const parent = getPath(target, path.slice(0, -1).join('.'));
  const last = path[path.length - 1]!;
  if (path.length === 1) delete target[last];
  else if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (parent && typeof parent === 'object') delete (parent as Loose)[last];
}

function friendly(issue: {
  code: string;
  message: string;
  expected?: unknown;
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'number' ? 'Enter a number.' : 'This value is not valid.';
    case 'too_small':
      return issue.type === 'number' ? `Use ${issue.minimum} or more.` : 'This cannot be empty.';
    case 'too_big':
      return issue.type === 'number'
        ? `Use ${issue.maximum} or less.`
        : issue.type === 'array'
          ? `No more than ${issue.maximum}.`
          : `Keep it to ${issue.maximum} characters.`;
    case 'invalid_enum_value':
      return 'Pick one of the options.';
    default:
      return issue.message;
  }
}

/* ------------------------------------------------------ structural edits */

const FIELD_DEFAULTS: Record<string, Loose> = {
  name: { label: 'Name' },
  first_name: { label: 'First name', width: 'half' },
  last_name: { label: 'Last name', width: 'half' },
  phone: { label: 'Phone' },
  company: { label: 'Company' },
  text: { label: 'Your answer' },
  textarea: { label: 'Tell us more' },
  number: { label: 'How many?' },
  date: { label: 'Date' },
  dropdown: { label: 'Pick one', options: ['Option 1', 'Option 2'] },
  radio: { label: 'Pick one', options: ['Option 1', 'Option 2'] },
  checkbox: { label: 'Keep me posted' },
  hidden: { capture: 'utm_source' },
  consent: { label: 'Email me news and offers. Unsubscribe any time.', save: false },
};

/**
 * One of the builder's structural buttons (`op=verb|path|arg`) on the form's
 * object. Returns the path to bring back into view, or null for an op it
 * does not know.
 */
export function applyFormOp(raw: Loose, op: string): string | null {
  const [verb, , arg = ''] = op.split('|');
  const list = (at: string): Loose[] => {
    const existing = getPath(raw, at);
    if (Array.isArray(existing)) return existing as Loose[];
    const created: Loose[] = [];
    setPath(raw, at, created);
    return created;
  };
  switch (verb) {
    case 'add-field': {
      const fields = list('fields');
      if (fields.length >= 30) return 'fields';
      const kind = arg in FIELD_DEFAULTS ? arg : 'text';
      const used = new Set(fields.map((f) => f?.id));
      let id = kind;
      for (let n = 2; used.has(id); n++) id = `${kind}_${n}`;
      fields.push({ id, kind, ...structuredClone(FIELD_DEFAULTS[kind] ?? {}) });
      return `fields.${fields.length - 1}`;
    }
    case 'add-variant': {
      const variants = list('variants');
      if (variants.length >= 4) return 'variants';
      const used = new Set(variants.map((v) => v?.id));
      const ids = ['a', 'b', 'c', 'd'];
      // A test starts with two: the form as it is, and a copy to change.
      if (variants.length === 0) {
        variants.push({ id: 'a', name: 'Original', weight: 50 });
        used.add('a');
      }
      const id = ids.find((i) => !used.has(i)) ?? `v${variants.length + 1}`;
      variants.push({ id, name: `Variant ${id.toUpperCase()}`, weight: 50 });
      return `variants.${variants.length - 1}`;
    }
    case 'add-action': {
      const actions = list('giveaway.actions');
      if (actions.length >= 10) return 'giveaway.actions';
      const used = new Set(actions.map((a) => a?.id));
      let id = 'follow';
      for (let n = 2; used.has(id); n++) id = `follow-${n}`;
      actions.push({ id, kind: 'follow', label: '', url: '', entries: 1 });
      return `giveaway.actions.${actions.length - 1}`;
    }
    default:
      // Blocks, buttons, and remove / up / down on any list: engage's own.
      return applyBlockOp(raw, op);
  }
}

/* ------------------------------------------------------------- preview */

/**
 * What the preview frame draws: the form as a visitor would get it, plus the
 * whole success section (the owner may see the coupon code), plus which
 * placement and state to show.
 */
export function previewDefinition(
  form: Pick<Form, 'id' | 'version'>,
  definition: FormDefinition,
  preview: { placement?: string; state?: string } = {},
): Loose {
  const variant = typeof preview === 'object' ? preview : {};
  return {
    ...publicForm(form, definition),
    success: definition.success,
    preview: {
      placement:
        variant.placement ||
        (definition.placements.display !== 'none' ? definition.placements.display : 'inline'),
      state: variant.state === 'done' ? 'done' : 'form',
    },
  };
}
