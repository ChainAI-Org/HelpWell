/**
 * The engage editor's form, turned back into a definition.
 *
 * Every input in the editor is named by the path of the value it holds, with
 * an optional type after a colon: `modal.slides.0.blocks.1.markdown`,
 * `priority:num`, `enabled:bool`, `targeting.pages.include:lines`. A number
 * segment makes an array. So one small parser turns any editor, for any kind,
 * into the nested object the engage schema parses, and the preview, the save
 * and the structural edits (add a block, remove a step) all read the form
 * the same way. It runs on the server only; the browser just posts the form.
 *
 * Types:
 *   str    (default) the text as typed
 *   num    a number; an empty box is left out, so the default applies
 *   bool   a checkbox after a hidden "false" of the same name: the last value wins
 *   lines  one item per line (or comma), blanks dropped
 *   arr    every value posted under the name (a group of checkboxes)
 *   json   parsed JSON, or the raw text when it does not parse (so it fails loudly)
 */

type Loose = Record<string, unknown>;

const TYPES = new Set(['str', 'num', 'bool', 'lines', 'arr', 'json']);
const MAX_INDEX = 50;

/** Field names that are part of the page, not the definition. */
const RESERVED = new Set(['op', 'action', 'range']);

export function formToObject(form: FormData): Loose {
  const out: Loose = {};
  const seen = new Set<string>();
  for (const [rawName] of form.entries()) {
    if (seen.has(rawName) || RESERVED.has(rawName)) continue;
    seen.add(rawName);
    const [path, type = 'str'] = rawName.split(':') as [string, string?];
    if (!path || !TYPES.has(type)) continue;
    // A browser posts a textarea's line breaks as CRLF. What is stored is
    // synced to a repo, so it keeps the plain LF everything else in it has.
    const values = form
      .getAll(rawName)
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.replace(/\r\n?/g, '\n'));
    const value = coerce(type, values);
    if (value !== undefined) setPath(out, path, value);
  }
  return compact(out) as Loose;
}

function coerce(type: string, values: string[]): unknown {
  const last = values[values.length - 1] ?? '';
  switch (type) {
    case 'num': {
      if (last.trim() === '') return undefined;
      const n = Number(last);
      return Number.isFinite(n) ? n : last;
    }
    case 'bool':
      return last === 'true' || last === 'on';
    case 'lines':
      return last
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    case 'arr':
      return values.filter((v) => v !== '');
    case 'json': {
      if (!last.trim()) return null;
      try {
        return JSON.parse(last);
      } catch {
        return last;
      }
    }
    default:
      return last;
  }
}

/** Set `a.b.0.c` on an object, making objects and arrays on the way. */
export function setPath(target: Loose, path: string, value: unknown): void {
  const keys = path.split('.');
  // A name is never allowed to reach an object's prototype, or build a huge array.
  const unsafe = keys.some(
    (key) =>
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      key === '' ||
      (/^\d+$/.test(key) && Number(key) > MAX_INDEX),
  );
  if (unsafe) return;

  let node = target as Record<string, unknown>;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (i === keys.length - 1) {
      node[key] = value;
      return;
    }
    const existing = node[key];
    if (typeof existing !== 'object' || existing === null) {
      node[key] = /^\d+$/.test(keys[i + 1] ?? '') ? [] : {};
    }
    node = node[key] as Record<string, unknown>;
  }
}

/** Read `a.b.0.c`, or undefined when any step is missing. */
export function getPath(target: unknown, path: string): unknown {
  let node: unknown = target;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Arrays built from indices can have holes (a removed row); close them up. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(compact);
  if (value && typeof value === 'object') {
    const out: Loose = {};
    for (const [key, v] of Object.entries(value)) out[key] = compact(v);
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ time */

/**
 * `2026-10-01T09:00` as typed into a date-time box, in the product's time
 * zone, as an ISO instant. Intl knows every zone's offset; the offset at that
 * moment is found by formatting a guess and correcting by the difference.
 */
export function zonedToIso(local: string, timeZone: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = zoneOffset(guess, timeZone);
  const first = guess - offset;
  // Across a clock change the offset at the answer can differ from the guess's.
  const corrected = guess - zoneOffset(first, timeZone);
  return new Date(corrected).toISOString();
}

/** An ISO instant as the `YYYY-MM-DDTHH:mm` a date-time box shows, in the product's zone. */
export function isoToZoned(iso: string | null, timeZone: string | undefined): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const local = new Date(at + zoneOffset(at, timeZone));
  return local.toISOString().slice(0, 16);
}

/** How far ahead of UTC `timeZone` is at `at`, in ms. UTC when the zone is unknown. */
function zoneOffset(at: number, timeZone: string | undefined): number {
  if (!timeZone) return 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return asUtc - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}
