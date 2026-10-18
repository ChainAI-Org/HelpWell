/**
 * Personalisation: `{{field}}` in an engagement or a chat message, filled in
 * from the contact looking at it.
 *
 *   Hi {{first_name|there}}, your {{plan}} trial ends soon.
 *
 * A key is a contact field: `first_name`, `last_name`, `name` and `email`,
 * or any attribute the host app sends with identify (`plan`, `company`...).
 * What follows `|` is said when the field has no value; with no fallback, a
 * field with no value says nothing.
 *
 * The widget does the filling in, as it draws (widget/src/engage/personalize.ts),
 * and fills text rather than Markdown, so a name can never become a link or
 * a heading. The server's part is here: it finds the keys the items it is
 * about to send use, and sends the values of those keys only, and only for
 * a contact the host app identified. An anonymous visitor, or one who only
 * typed a name into the chat, gets the fallbacks: a cookie on a shared
 * computer is not proof of who is sitting at it.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';

/** `{{key}}` or `{{key|fallback}}`. The key is letters, digits, `_`, `-` and `.`. */
export const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]{1,64})\s*(?:\|([^{}]{0,100}))?\}\}/g;

/** The fields every contact can be personalised with, before any attribute. */
export const PERSONAL_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'name', label: 'Full name' },
  { key: 'email', label: 'Email' },
] as const;

/** The longest value sent for one field. */
const MAX_VALUE = 200;
/** The most keys one answer fills. */
const MAX_KEYS = 30;

/** Every placeholder key in these values, however deeply nested. */
export function placeholderKeys(value: unknown, into = new Set<string>(), depth = 0): Set<string> {
  if (into.size >= MAX_KEYS || depth > 12) return into;
  if (typeof value === 'string') {
    if (!value.includes('{{')) return into;
    for (const match of value.matchAll(PLACEHOLDER)) {
      if (into.size >= MAX_KEYS) break;
      into.add(match[1]!);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) placeholderKeys(item, into, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) placeholderKeys(item, into, depth + 1);
  }
  return into;
}

/**
 * The values of these keys for this contact, as plain strings. Empty for an
 * anonymous visitor, for a contact the host app has not identified, and for
 * a key with no value, so the widget says the fallback instead.
 */
export async function personalFields(
  db: Db,
  contactId: string | null,
  keys: Iterable<string>,
): Promise<Record<string, string>> {
  const wanted = [...keys].slice(0, MAX_KEYS);
  if (!contactId || wanted.length === 0) return {};
  const [row] = rowsOf<{
    name: string | null;
    email: string | null;
    identified: boolean;
    attributes: unknown;
  }>(
    await db.execute(sql`
      SELECT name, email, identified, attributes
      FROM helpwell.contacts
      WHERE id = ${contactId} AND deleted_at IS NULL
    `),
  );
  if (!row?.identified) return {};
  return fieldValues(row, wanted);
}

/** The lookup itself, apart from the database: exported for tests and the preview. */
export function fieldValues(
  contact: { name: string | null; email: string | null; attributes: unknown },
  keys: readonly string[],
): Record<string, string> {
  const attributes = asRecord(contact.attributes);
  const name = clean(contact.name);
  const words = name.split(/\s+/).filter(Boolean);
  const out: Record<string, string> = {};
  for (const key of keys) {
    let value = attribute(attributes, key);
    if (!value) {
      if (key === 'name' || key === 'full_name') value = name;
      else if (key === 'email') value = clean(contact.email);
      else if (key === 'first_name' || key === 'firstName') {
        value = attribute(attributes, 'first_name') || words[0] || '';
      } else if (key === 'last_name' || key === 'lastName') {
        value = attribute(attributes, 'last_name') || (words.length > 1 ? words.at(-1)! : '');
      }
    }
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Fill placeholders into text that will be stored as Markdown, e.g. the
 * proactive message a conversation opens with. The values are the visitor's
 * own details, but still cannot add a link, emphasis or a heading: the
 * characters that would are taken out.
 */
export function fillPlaceholders(text: string, fields: Readonly<Record<string, string>>): string {
  if (!text.includes('{{')) return text;
  return text.replace(PLACEHOLDER, (_match, key: string, fallback: string | undefined) => {
    const value = fields[key] ?? (fallback ?? '').trim();
    return value.replace(/[\\`*_[\]()<>#|!~]/g, '');
  });
}

/* ---------------------------------------------------------------- helpers */

/** An attribute by key, then its other spelling (`first_name` / `firstName`), as text. */
function attribute(attributes: Record<string, unknown>, key: string): string {
  const bare = key.startsWith('attributes.') ? key.slice('attributes.'.length) : key;
  const camel = bare.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const snake = bare.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  for (const candidate of [bare, camel, snake]) {
    const value = scalar(attributes[candidate]);
    if (value) return value;
  }
  return '';
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    return clean(
      value
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .map(String)
        .join(', '),
    );
  }
  return '';
}

/** One line, trimmed, no longer than the longest value sent. */
function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}
