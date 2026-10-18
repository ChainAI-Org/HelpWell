/**
 * Server-rendered HTML, shared by the help centre and the dashboard.
 *
 * Both surfaces assemble pages as strings rather than running a client-side
 * framework. The help centre needs to load instantly and be indexable; the
 * dashboard reads from the database and writes through plain forms. Neither
 * has a problem a framework would solve, and skipping it means HelpWell never
 * fights the host app over a React version.
 *
 * `html` is a tagged template that escapes every interpolation. Anything that
 * is genuinely trusted markup has to be wrapped in `raw()`, which makes the
 * unsafe case visible at the call site instead of being the default.
 */

export class RawHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export type Renderable = string | number | boolean | null | undefined | RawHtml | Renderable[];

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function html(strings: TemplateStringsArray, ...values: Renderable[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += stringify(values[i]);
    out += strings[i + 1] ?? '';
  }
  return new RawHtml(out);
}

function stringify(value: Renderable): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(stringify).join('');
  return escapeHtml(String(value));
}

/** Join a list of renderables with no separator. */
export function join(parts: Renderable[], separator = ''): RawHtml {
  return new RawHtml(parts.map(stringify).filter(Boolean).join(separator));
}

/**
 * Only http(s), mailto and same-site URLs are allowed in an href. Settings and
 * article front matter are edited by hand, and a typo should not become a
 * `javascript:` link.
 *
 * A protocol-relative URL (`//evil.example`, or `/\evil.example`, which
 * browsers read the same way) is refused as well: it looks same-site and is
 * not, and an attribute value cannot carry the `rel` an external link needs.
 *
 * The result is already escaped for an attribute, so wrap it in `raw()` when
 * placing it inside the `html` template.
 */
export function safeHref(url: string): string {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (/^[/\\][/\\]/.test(trimmed)) return '#';
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:')
  ) {
    return escapeHtml(trimmed);
  }
  return '#';
}
