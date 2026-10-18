/**
 * Values that arrive from settings and end up in CSS, SVG or an attribute.
 *
 * An admin types the accent colour and the launcher image URL into the
 * dashboard. They are trusted people, but the strings still travel through
 * the database and the API, and a colour is interpolated into a stylesheet
 * where a stray `}` closes the rule it sits in. So nothing here is used until
 * it looks like what it claims to be.
 */

export const DEFAULT_ACCENT = '#7A3BEB';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A hex colour, or the brand purple when the value is anything else. */
export function safeAccent(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_ACCENT;
  const trimmed = value.trim();
  return HEX.test(trimmed) ? trimmed : DEFAULT_ACCENT;
}

/**
 * A URL that resolves to http(s): an absolute one, or a path on this origin.
 * `javascript:` and `data:` never pass, and neither does anything that fails
 * to parse.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // The URL parser is forgiving; a URL is not where these characters belong.
  if (!trimmed || /[\s<>"'`]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** `#7A3BEB` at 35% -> `rgba(122, 59, 235, 0.35)`. Expects a validated hex. */
export function hexToRgba(hex: string, alpha: number): string {
  let digits = hex.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}
