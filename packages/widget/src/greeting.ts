/**
 * The owner's own greeting at the top of Home (`widget.greeting`), with its
 * placeholders filled in.
 *
 * Two spellings are read, so a greeting saved before either keeps working:
 *
 * - Liquid-style outputs, the way personalised email is written:
 *   `{{ product.name }}` and `{{ contact.first_name }}` (also `{{ product }}`
 *   and `{{ first_name }}`), with an optional fallback,
 *   `{{ contact.first_name | default: "friend" }}` or the short
 *   `{{ first_name | friend }}`;
 * - the original single braces, `{product}` and `{first_name}`.
 *
 * A first name the host app has not sent reads "there" ("Hi there"), unless
 * the placeholder names its own fallback. Anything else in braces is left as
 * written. Everything is filled in one pass, so a product name or first name
 * that itself contains braces is never read as another placeholder, and the
 * result is always set as text, never as markup.
 */

const VARIABLES: Record<string, 'product' | 'first_name'> = {
  product: 'product',
  'product.name': 'product',
  first_name: 'first_name',
  'contact.first_name': 'first_name',
};

const PLACEHOLDER =
  /\{\{\s*(product\.name|product|contact\.first_name|first_name)\s*(?:\|\s*(?:default\s*:\s*(?:"([^"{}]{0,80})"|'([^'{}]{0,80})')|([^{}|:"']{1,80}?))\s*)?\}\}|\{(product|first_name)\}/g;

export interface GreetingValues {
  product: string;
  /** The visitor's first name, when the host app said who is visiting. */
  firstName: string | null;
}

export function fillGreeting(text: string, values: GreetingValues): string {
  if (!text.includes('{')) return text;
  return text.replace(
    PLACEHOLDER,
    (
      _match: string,
      liquid: string | undefined,
      quoted: string | undefined,
      single: string | undefined,
      bare: string | undefined,
      legacy: string | undefined,
    ) => {
      const variable = VARIABLES[(liquid ?? legacy)!]!;
      // `| default` with nothing after it names no fallback.
      const word = bare?.trim() === 'default' ? undefined : bare?.trim();
      const fallback = quoted ?? single ?? word;
      const value = variable === 'product' ? values.product : values.firstName;
      if (value) return value;
      return fallback ?? (variable === 'first_name' ? 'there' : '');
    },
  );
}
