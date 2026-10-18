/**
 * Frontmatter.
 *
 * Articles are markdown files a human or a coding agent edits by hand, so the
 * frontmatter they carry is deliberately small: strings, numbers, booleans and
 * flat lists. Parsing that subset here means no YAML dependency in the runtime
 * and no surprise when someone writes `title: Exporting: the guide`.
 */

export type FrontmatterValue = string | number | boolean | null | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedDocument {
  data: Frontmatter;
  content: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** U+FEFF. Some Windows editors put one ahead of the first character. */
const BOM = String.fromCharCode(0xfeff);

export function parseFrontmatter(input: string): ParsedDocument {
  // Left in, a byte order mark would hide the whole block: `status: draft`
  // would be ignored and the frontmatter shown to readers as text.
  const source = input.startsWith(BOM) ? input.slice(1) : input;
  const match = FENCE.exec(source);
  if (!match) return { data: {}, content: source.trim() };

  const data: Frontmatter = {};
  const lines = match[1]!.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();

    // A list written across following lines:
    //   tags:
    //     - billing
    //     - exports
    if (rest === '') {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) {
        items.push(unquote(lines[++i]!.replace(/^\s*-\s+/, '').trim()));
      }
      data[key] = items;
      continue;
    }

    data[key] = coerce(rest);
  }

  return { data, content: source.slice(match[0].length).trim() };
}

function coerce(raw: string): FrontmatterValue {
  // An inline list: [billing, exports]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => unquote(part.trim()));
  }
  // Quoted text is text, whatever it looks like: "2.0" stays a string.
  if (isQuoted(raw)) return unquote(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function isQuoted(raw: string): boolean {
  return (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  );
}

function unquote(raw: string): string {
  if (!isQuoted(raw)) return raw;
  if (raw.startsWith('"')) {
    // Double quotes are what stringify writes, with JSON escapes inside.
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw.slice(1, -1);
}

/** Write frontmatter back out, so the editor and the CLI round-trip a file. */
export function stringifyFrontmatter(data: Frontmatter, content: string): string {
  const lines = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return `${key}: []`;
        return `${key}:\n${value.map((v) => `  - ${quoteIfNeeded(v)}`).join('\n')}`;
      }
      if (value === null) return `${key}: null`;
      if (typeof value === 'string') return `${key}: ${quoteIfNeeded(value)}`;
      return `${key}: ${value}`;
    });
  return `---\n${lines.join('\n')}\n---\n\n${content.trim()}\n`;
}

/**
 * Quote a string the parser would otherwise read back as something else:
 * YAML punctuation, surrounding whitespace, an empty value, an already quoted
 * value, or text that looks like a number, a boolean or null ("2.0", "true").
 */
function quoteIfNeeded(value: string): string {
  const looksLikeOtherType =
    value === '' ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    value === '~' ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    isQuoted(value);
  return looksLikeOtherType || /[:#[\]{}"]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}
