/**
 * What a visitor typed, checked against the form's fields and turned into
 * typed values.
 *
 * Typed, because the answers become custom fields on the contact and the
 * field registry types a key by its first value: a number field has to
 * arrive as a number, a date as `YYYY-MM-DD`, a set of checkboxes as a list,
 * for "seats is more than 10" to work in a segment later. Anything the form
 * did not ask for is dropped, and a hidden field with a fixed value takes the
 * value from the definition, never from the page.
 */

import type { UtmKey } from '../engage/rules.js';
import type { FieldKind, FormDefinition, FormField } from './schema.js';

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^[+()\d][\d\s().+-]{3,39}$/;

const MAX: Partial<Record<FieldKind, number>> = { textarea: 5000, email: 254, phone: 40 };

/** Where the submission came from, for the fields that fill themselves. */
export interface VisitDetails {
  url: string | null;
  path: string | null;
  referrer: string | null;
  utm: Partial<Record<UtmKey, string>>;
}

export interface CheckedAnswers {
  /** Every answer by field id, typed. Consent boxes are here too, as true or false. */
  values: Record<string, unknown>;
  /** Field id to the message for that field. Empty when everything is fine. */
  errors: Record<string, string>;
  email: string;
  /** The name field, or first and last joined. */
  name: string | null;
  consent: { state: 'granted' | 'denied' | 'none'; text: string | null };
  /** What is saved on the contact as custom fields, by attribute key. */
  attributes: Record<string, unknown>;
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

export function checkAnswers(
  definition: FormDefinition,
  input: unknown,
  visit: VisitDetails,
): CheckedAnswers {
  const answers =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  let email = '';
  let consent: CheckedAnswers['consent'] = { state: 'none', text: null };

  for (const field of definition.fields) {
    const raw = answers[field.id];
    const result = readField(field, raw, visit);
    if ('error' in result) {
      errors[field.id] = result.error;
      continue;
    }
    if (result.value === undefined) continue;
    values[field.id] = result.value;
    if (field.kind === 'email') email = String(result.value);
    if (field.kind === 'consent') {
      consent = { state: result.value === true ? 'granted' : 'denied', text: field.label };
    }
  }

  const first = typeof values.first_name === 'string' ? values.first_name : '';
  const last = typeof values.last_name === 'string' ? values.last_name : '';
  const nameField = definition.fields.find((f) => f.kind === 'name');
  const firstField = definition.fields.find((f) => f.kind === 'first_name');
  const lastField = definition.fields.find((f) => f.kind === 'last_name');
  const named = nameField ? values[nameField.id] : undefined;
  const joined = [
    firstField ? values[firstField.id] : first,
    lastField ? values[lastField.id] : last,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  const name = typeof named === 'string' && named ? named : joined || null;

  const attributes: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (
      !field.save ||
      field.kind === 'email' ||
      field.kind === 'name' ||
      field.kind === 'consent'
    ) {
      continue;
    }
    const value = values[field.id];
    if (value === undefined || value === '') continue;
    attributes[field.attribute || field.id] = value;
  }

  return { values, errors, email, name, consent, attributes };
}

type Read = { value: unknown } | { error: string };

function readField(field: FormField, raw: unknown, visit: VisitDetails): Read {
  switch (field.kind) {
    case 'hidden':
      return { value: hiddenValue(field, raw, visit) };
    case 'consent': {
      const ticked = raw === true || raw === 'true' || raw === 'on';
      if (field.required && !ticked) return { error: 'Tick this box to continue.' };
      return { value: ticked };
    }
    case 'checkbox': {
      if (field.options.length === 0) {
        const ticked = raw === true || raw === 'true' || raw === 'on';
        if (field.required && !ticked) return { error: 'Tick this box to continue.' };
        return { value: ticked };
      }
      const picked = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
        .map((v) => String(v))
        .filter((v) => field.options.includes(v));
      if (field.required && picked.length === 0) return { error: 'Pick at least one.' };
      return { value: [...new Set(picked)] };
    }
    default:
      break;
  }

  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!text) return field.required ? { error: requiredMessage(field.kind) } : { value: undefined };
  const max = MAX[field.kind] ?? 200;
  if (text.length > max) return { error: `Keep it to ${max} characters.` };

  switch (field.kind) {
    case 'email': {
      const email = text.toLowerCase();
      return isEmail(email)
        ? { value: email }
        : { error: 'Enter an email address, like you@example.com.' };
    }
    case 'phone':
      return PHONE.test(text) ? { value: text } : { error: 'Enter a phone number.' };
    case 'number': {
      const n = Number(text.replace(/,/g, ''));
      return Number.isFinite(n) ? { value: n } : { error: 'Enter a number.' };
    }
    case 'date': {
      if (!DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        return { error: 'Enter a date.' };
      }
      return { value: text };
    }
    case 'dropdown':
    case 'radio':
      return field.options.includes(text) ? { value: text } : { error: 'Pick one of the options.' };
    default:
      return { value: text };
  }
}

function requiredMessage(kind: FieldKind): string {
  if (kind === 'email') return 'Enter your email address.';
  if (kind === 'dropdown' || kind === 'radio') return 'Pick one.';
  return 'This one is required.';
}

function hiddenValue(field: FormField, raw: unknown, visit: VisitDetails): string | undefined {
  // A fixed value is the form's, whatever the page sends.
  if (!field.capture) return field.value || undefined;
  const sent = typeof raw === 'string' ? raw.trim().slice(0, 500) : '';
  switch (field.capture) {
    case 'page':
      return (visit.url ?? visit.path ?? sent) || field.value || undefined;
    case 'referrer':
      return (visit.referrer ?? sent) || field.value || undefined;
    case 'param':
      return sent || field.value || undefined;
    default: {
      const key = field.capture.slice('utm_'.length) as UtmKey;
      return (visit.utm[key] ?? sent) || field.value || undefined;
    }
  }
}
