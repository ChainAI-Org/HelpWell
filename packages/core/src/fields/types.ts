/**
 * The vocabulary of contact fields, with no database in sight.
 *
 * Kept apart from the registry so the conditions module can depend on field
 * types and on the list of built-in fields without pulling in queries, and so
 * a browser bundle (the dashboard's builder, one day the widget) can import
 * the same lists the server validates against.
 */

/** How a field's value is read when a condition compares it. */
export const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'list', 'url', 'money'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Where a field was first seen. `app` is an identify call, `helpwell` is one of
 * the fields HelpWell itself keeps, and the rest are the ways a contact can be
 * written to from outside: an import, a form, the admin API.
 */
export const FIELD_SOURCES = ['app', 'helpwell', 'import', 'form', 'api'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export interface BuiltinField {
  key: string;
  label: string;
  type: FieldType;
}

/**
 * The fields every contact has whether or not the host app sends anything.
 *
 * Their keys are reserved: an identify attribute with one of these names is
 * still stored, but a condition reaches it as `attributes.<key>`, because a
 * bare `tags` or `email` always means HelpWell's own.
 */
export const BUILTIN_FIELDS: readonly BuiltinField[] = [
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'signed_up', label: 'Signed up', type: 'date' },
  { key: 'last_seen', label: 'Last seen', type: 'date' },
  { key: 'identified', label: 'Identified', type: 'boolean' },
  { key: 'tags', label: 'Tags', type: 'list' },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'consent', label: 'Consent', type: 'text' },
];

export const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUILTIN_FIELDS.map((f) => f.key));

/** The prefix that reaches an attribute whose name a built-in field took. */
export const ATTRIBUTE_PREFIX = 'attributes.';

/**
 * The key a condition uses for an identify attribute: the attribute's own
 * name, unless a built-in field owns that name.
 */
export function fieldKeyForAttribute(attribute: string): string {
  return BUILTIN_KEYS.has(attribute) ? `${ATTRIBUTE_PREFIX}${attribute}` : attribute;
}

/**
 * What a condition's `field` points at: one of HelpWell's own fields, or an
 * attribute by its name in the contact's attributes JSON.
 */
export type FieldRef = { kind: 'builtin'; key: string } | { kind: 'attribute'; key: string };

export function resolveFieldRef(field: string): FieldRef {
  if (field.startsWith(ATTRIBUTE_PREFIX)) {
    return { kind: 'attribute', key: field.slice(ATTRIBUTE_PREFIX.length) };
  }
  if (BUILTIN_KEYS.has(field)) return { kind: 'builtin', key: field };
  return { kind: 'attribute', key: field };
}

/** `seatCount` and `seat_count` both read "Seat count". */
export function labelForKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}
