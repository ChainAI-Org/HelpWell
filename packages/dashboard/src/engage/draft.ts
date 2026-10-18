/**
 * An engagement being edited: the form read back, checked, and kept
 * renderable even when it is not valid yet.
 *
 * The editor round-trips a draft through the server for everything: the
 * live preview, adding and removing blocks, saving. A draft with a mistake in
 * it (a letter in a number box, a colour that is not hex) must still render,
 * with the message next to the field and what was typed still in it, so a
 * value the schema refuses is set aside, reported, and the default put in
 * its place until the person fixes it. Completeness problems (a button with
 * no link) come from core's `checkEngagement`, under the same field paths.
 */

import {
  type Block,
  checkEngagement,
  type Engagement,
  type EngagementKind,
  engagementSchema,
  MAX_TRIGGERS,
} from '@helpwell/core/repos';
import { rowsToConditions } from './conditions.js';
import { formToObject, getPath, setPath, zonedToIso } from './form.js';
import { nextTriggerType } from './who.js';

type Loose = Record<string, unknown>;

export interface Draft {
  /** The definition as the schema made it: always complete, defaults filled in. */
  engagement: Engagement;
  /** Field path to message, for the inputs that have a problem. */
  errors: Map<string, string>;
  /** What was typed into a field the schema refused, so the box still shows it. */
  typed: Map<string, unknown>;
}

/**
 * Read an editor form. `mode: 'save'` adds the completeness checks; while
 * someone is still building (preview, adding a block) only the values the
 * schema cannot take are reported.
 */
export function draftFromForm(
  form: FormData,
  options: {
    kind: EngagementKind;
    id: string;
    timeZone?: string;
    others: readonly Engagement[];
    mode: 'save' | 'edit';
  },
): Draft & { raw: Loose } {
  const raw = readForm(form, options);
  return { ...draftFromRaw(raw, options), raw };
}

export function draftFromRaw(
  raw: Loose,
  options: { others: readonly Engagement[]; mode: 'save' | 'edit' },
): Draft {
  const draft = repair(raw);
  if (options.mode === 'save') {
    for (const problem of checkEngagement(draft.engagement, options.others)) {
      if (!draft.errors.has(problem.path)) draft.errors.set(problem.path, problem.message);
    }
  }
  return draft;
}

/** The form as the nested object the schema expects. */
export function readForm(
  form: FormData,
  options: { kind: EngagementKind; id: string; timeZone?: string },
): Loose {
  const raw = formToObject(form);
  raw.kind = options.kind;
  raw.id = options.id || (typeof raw.id === 'string' ? raw.id.trim() : '');

  // Frequency is two controls in the editor and one value in the schema.
  const mode = raw.frequencyMode;
  const days = raw.frequencyDays;
  delete raw.frequencyMode;
  delete raw.frequencyDays;
  if (mode === 'every') raw.frequency = { everyDays: days ?? 7 };
  else if (mode === 'always' || mode === 'once') raw.frequency = mode;

  // A banner's position and style are chosen together, from four tiles.
  const placement = raw.bannerPlacement;
  delete raw.bannerPlacement;
  if (typeof placement === 'string' && options.kind === 'banner') {
    const [position, style] = placement.split('|');
    const banner = (raw.banner ?? {}) as Loose;
    if (position) banner.position = position;
    if (style) banner.style = style;
    raw.banner = banner;
  }

  // Date-time boxes are in the product's time zone; the schema wants instants.
  const schedule = raw.schedule as Loose | undefined;
  if (schedule) {
    for (const key of ['start', 'end'] as const) {
      const value = schedule[key];
      if (typeof value === 'string' && value.trim()) {
        schedule[key] = zonedToIso(value, options.timeZone) ?? value;
      } else {
        schedule[key] = null;
      }
    }
  }
  const countdown = (raw.banner as Loose | undefined)?.countdown as Loose | undefined;
  if (countdown) {
    const value = countdown.until;
    countdown.until =
      typeof value === 'string' && value.trim()
        ? (zonedToIso(value, options.timeZone) ?? value)
        : null;
  }

  // Conditions: the builder's rows, or the rule JSON typed in by hand.
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

/**
 * Parse, setting aside whatever the schema refuses until it parses. Each
 * refused value is reported once, under its own path, and remembered as typed.
 */
export function repair(raw: Loose): Draft {
  const errors = new Map<string, string>();
  const typed = new Map<string, unknown>();
  const current = structuredClone(raw);
  const removed = new Set<string>();

  // Without an id nothing parses, and the rest of the draft would be lost
  // with it: a stand-in keeps it drawable while the id box shows the error.
  if (typeof current.id !== 'string' || !current.id.trim()) {
    errors.set('id', 'Give it an id: letters, numbers and dashes.');
    current.id = 'untitled';
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const result = engagementSchema.safeParse(current);
    if (result.success) return { engagement: result.data, errors, typed };
    for (const issue of result.error.issues) {
      let path = issue.path.map(String);
      const key = path.join('.');
      if (!errors.has(key)) errors.set(key, friendly(issue));
      if (!typed.has(key)) typed.set(key, getPath(current, key));
      // A value that is still wrong once gone is its container's problem.
      while (removed.has(path.join('.')) && path.length > 0) path = path.slice(0, -1);
      if (path.length === 0 || path[0] === 'kind') break;
      if (path.length === 1 && path[0] === 'id') {
        current.id = 'untitled';
        continue;
      }
      removed.add(path.join('.'));
      deletePath(current, path);
    }
  }
  // Nothing could be saved from it: a blank one of the same kind.
  const fallback = engagementSchema.parse({
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'untitled',
    kind: typeof raw.kind === 'string' ? raw.kind : 'modal',
  });
  return { engagement: fallback, errors, typed };
}

function deletePath(target: Loose, path: string[]): void {
  const parent = getPath(target, path.slice(0, -1).join('.'));
  const last = path[path.length - 1]!;
  if (path.length === 1) delete target[last];
  else if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (parent && typeof parent === 'object') delete (parent as Loose)[last];
}

/** The parts of a schema issue this reads. */
interface Issue {
  code: string;
  message: string;
  expected?: unknown;
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}

/** The schema's messages, in the dashboard's voice. */
function friendly(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'number' ? 'Enter a number.' : 'This value is not valid.';
    case 'too_small':
      return issue.type === 'number'
        ? `Use ${issue.minimum} or more.`
        : issue.type === 'array'
          ? `Needs at least ${issue.minimum}.`
          : 'This cannot be empty.';
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

const BLOCK_DEFAULTS: Record<string, Loose> = {
  text: { type: 'text', markdown: '' },
  image: { type: 'image', url: '', alt: '', link: '' },
  gif: { type: 'gif', url: '', alt: '' },
  video: { type: 'video', url: '', title: '' },
  buttons: {
    type: 'buttons',
    buttons: [{ label: 'Learn more', action: 'url', value: '', style: 'primary', newTab: false }],
  },
  divider: { type: 'divider' },
};

/**
 * Apply one of the editor's structural buttons (`op=verb|path|arg`) to the
 * form's object. Returns the path to scroll back to, or null for an op it
 * does not know, which changes nothing.
 */
export function applyOp(raw: Loose, op: string): string | null {
  const [verb, path = '', arg = ''] = op.split('|');
  const list = (at: string): unknown[] => {
    const existing = getPath(raw, at);
    if (Array.isArray(existing)) return existing;
    const created: unknown[] = [];
    setPath(raw, at, created);
    return created;
  };
  const parentAndIndex = (at: string): [unknown[], number] | null => {
    const cut = at.lastIndexOf('.');
    const parent = getPath(raw, at.slice(0, cut));
    const index = Number(at.slice(cut + 1));
    return Array.isArray(parent) && Number.isInteger(index) ? [parent, index] : null;
  };

  switch (verb) {
    case 'add-block': {
      const block = BLOCK_DEFAULTS[arg];
      if (!block) return null;
      const blocks = list(path);
      if (blocks.length >= 20) return path;
      blocks.push(structuredClone(block));
      return `${path}.${blocks.length - 1}`;
    }
    case 'add-slide': {
      const slides = list(path);
      if (slides.length >= 10) return path;
      slides.push({ blocks: [{ type: 'text', markdown: '' }] });
      return `${path}.${slides.length - 1}`;
    }
    case 'add-step': {
      const steps = list(path);
      if (steps.length >= 30) return path;
      steps.push({
        target: '',
        placement: 'tour',
        advance: 'next',
        blocks: [{ type: 'text', markdown: '' }],
      });
      return `${path}.${steps.length - 1}`;
    }
    case 'add-question': {
      const questions = list(path) as Loose[];
      if (questions.length >= 20) return path;
      const used = new Set(questions.map((q) => q?.id));
      let n = questions.length + 1;
      while (used.has(`q${n}`)) n++;
      const kind = ['nps', 'csat', 'stars', 'single', 'multi', 'text'].includes(arg) ? arg : 'nps';
      questions.push({
        id: `q${n}`,
        kind,
        prompt: '',
        choices: kind === 'single' || kind === 'multi' ? ['Option 1', 'Option 2'] : [],
        required: kind !== 'text',
      });
      return `${path}.${questions.length - 1}`;
    }
    case 'add-trigger': {
      // Another way for it to appear: whichever fires first shows it.
      const triggers = list(path) as Loose[];
      if (triggers.length >= MAX_TRIGGERS) return path;
      triggers.push({ type: nextTriggerType(triggers.map((t) => String(t?.type ?? ''))) });
      return `${path}.${triggers.length - 1}`;
    }
    case 'add-branch': {
      const branches = list(path);
      if (branches.length >= 20) return path;
      branches.push({ goto: 'end' });
      return `${path}.${branches.length - 1}`;
    }
    case 'add-button': {
      const buttons = list(path);
      if (buttons.length >= 2) return path;
      buttons.push({ label: '', action: 'url', value: '', style: 'secondary' });
      return `${path}.${buttons.length - 1}`;
    }
    case 'remove': {
      const found = parentAndIndex(path);
      if (!found) return null;
      found[0].splice(found[1], 1);
      return path.slice(0, path.lastIndexOf('.'));
    }
    case 'up':
    case 'down': {
      const found = parentAndIndex(path);
      if (!found) return null;
      const [items, index] = found;
      const to = verb === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= items.length) return path;
      [items[index], items[to]] = [items[to], items[index]];
      return `${path.slice(0, path.lastIndexOf('.'))}.${to}`;
    }
    case 'move': {
      // A drag in a list: `move|path|to`, to being the item's new index.
      const found = parentAndIndex(path);
      const to = Number(arg);
      if (!found || !Number.isInteger(to)) return null;
      const [items, index] = found;
      if (to < 0 || to >= items.length || index >= items.length) return path;
      const [item] = items.splice(index, 1);
      items.splice(to, 0, item);
      return `${path.slice(0, path.lastIndexOf('.'))}.${to}`;
    }
    case 'duplicate': {
      const found = parentAndIndex(path);
      if (!found) return null;
      const [items, index] = found;
      if (index >= items.length || items.length >= limitFor(path)) return path;
      const copy = structuredClone(items[index]) as Loose;
      // A copied question needs its own id: answers are stored against it.
      if (
        copy &&
        typeof copy === 'object' &&
        typeof copy.id === 'string' &&
        /questions\.\d+$/.test(path)
      ) {
        const used = new Set(items.map((q) => (q as Loose)?.id));
        let n = items.length + 1;
        while (used.has(`q${n}`)) n++;
        copy.id = `q${n}`;
      }
      items.splice(index + 1, 0, copy);
      return `${path.slice(0, path.lastIndexOf('.'))}.${index + 1}`;
    }
    default:
      return null;
  }
}

/** The most a list may hold, as the schema says, so a duplicate cannot overflow it. */
function limitFor(path: string): number {
  if (/slides\.\d+$/.test(path)) return 10;
  if (/steps\.\d+$/.test(path)) return 30;
  if (/buttons\.\d+$/.test(path)) return 2;
  if (/triggers\.\d+$/.test(path)) return MAX_TRIGGERS;
  return 20;
}

/** Whether a draft has anything the preview could draw yet. */
export function isEmptyDraft(e: Engagement): boolean {
  const drawable = (blocks: readonly Block[]) =>
    blocks.some((b) =>
      b.type === 'text'
        ? b.markdown.trim().length > 0
        : b.type === 'buttons'
          ? b.buttons.some((button) => button.label.trim())
          : b.type === 'divider'
            ? false
            : b.url.trim().length > 0,
    );
  switch (e.kind) {
    case 'modal':
      return !e.modal.slides.some((s) => drawable(s.blocks));
    case 'banner':
      return !drawable(e.banner.blocks);
    case 'hotspot':
      return !drawable(e.hotspot.blocks);
    case 'tour':
      return !e.tour.steps.some((s) => drawable(s.blocks));
    case 'survey':
      return e.survey.questions.length === 0 && !drawable(e.survey.intro);
  }
}
