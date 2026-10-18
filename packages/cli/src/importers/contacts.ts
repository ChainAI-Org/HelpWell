/**
 * Reading contacts out of another tool's export: CSV or JSON.
 *
 * Every tool names its columns differently, so the common spellings of the
 * few columns HelpWell cares about are recognised (`user_id`, `external_id`,
 * `Full name`, `Signed up at`…) and every other column becomes an attribute
 * under its own name. Values that plainly are numbers or booleans are stored
 * as such, so the field registry types them correctly.
 */

import type { ImportContactRow } from '@helpwell/core/repos';

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, a BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const ALIASES: Record<string, keyof Omit<ImportContactRow, 'attributes'>> = {
  id: 'id',
  user_id: 'id',
  userid: 'id',
  external_id: 'id',
  externalid: 'id',
  email: 'email',
  email_address: 'email',
  name: 'name',
  full_name: 'name',
  fullname: 'name',
  signed_up: 'signedUpAt',
  signed_up_at: 'signedUpAt',
  signedupat: 'signedUpAt',
  signup_date: 'signedUpAt',
  created_at: 'signedUpAt',
  tags: 'tags',
  tag: 'tags',
};

function normaliseHeader(header: string): string {
  return header
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** "4" is 4, "true" is true, "" is nothing; everything else stays text. */
function coerce(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && !/^0\d/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(value.includes(';') ? ';' : ',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** One flat record (a CSV row, or a loose JSON object) as an import row. */
export function toImportRow(record: Record<string, unknown>): ImportContactRow {
  const row: ImportContactRow = { attributes: {} };
  for (const [header, raw] of Object.entries(record)) {
    const value = typeof raw === 'string' ? coerce(raw) : raw;
    if (value === undefined || value === null || value === '') continue;
    const key = ALIASES[normaliseHeader(header)];
    if (header === 'attributes' && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(row.attributes!, value);
    } else if (key === 'tags') {
      row.tags = splitTags(value);
    } else if (key) {
      (row as Record<string, unknown>)[key] = String(value);
    } else {
      row.attributes![header.trim()] = value;
    }
  }
  return row;
}

/** A CSV export, or JSON (an array of rows, or `{ "contacts": [...] }`). */
export function readContactsFile(text: string, format: 'csv' | 'json'): ImportContactRow[] {
  if (format === 'json') {
    const parsed = JSON.parse(text) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { contacts?: unknown })?.contacts)
        ? (parsed as { contacts: unknown[] }).contacts
        : null;
    if (!list)
      throw new Error('A contacts JSON file is an array of people, or { "contacts": [...] }.');
    return list
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(toImportRow);
  }
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((cells) =>
    toImportRow(Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))),
  );
}
