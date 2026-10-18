/**
 * Article Markdown as the plain text a reader sees, for search snippets.
 *
 * A snippet is shown as a line of text under a result's title, so
 * `**Export**` has to read "Export" and `## Billing` has to read "Billing".
 * A code span keeps its words exactly, `<head>` included, because a code span
 * is often the very thing someone searched for. The rules follow the renderer
 * in `@helpwell/ui`, which core cannot import: what it draws as formatting
 * goes, and what it draws as text stays, literally. HTML written into an
 * article is text to that renderer, so it is text here too; a snippet is
 * escaped wherever it becomes HTML.
 *
 * A snippet is one line, so a heading would run straight into the paragraph
 * under it ("Install the tracking snippet The snippet is…"). A heading that
 * only repeats the title is left out, since the title is shown above the
 * snippet already, and any other heading ends with a dash, unless it ends
 * with punctuation of its own.
 */

/** Marks a lifted-out code span while the inline passes run. Never in real text. */
const NUL = String.fromCharCode(0);
const PLACEHOLDER = new RegExp(`${NUL}(\\d+)${NUL}`, 'g');

const FENCE = /^ {0,3}```/;
const CONTAINER_OPEN = /^ {0,3}:{3,}[ \t]*([A-Za-z][\w-]*)[ \t]*(.*)$/;
const CONTAINER_CLOSE = /^ {0,3}:{3,}[ \t]*$/;
const CONTAINERS = new Set(['steps', 'tabs', 'details', 'accordion']);
const TAB = /^==[ \t]+(.+)$/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const QUOTE = /^ {0,3}(?:>[ \t]?)+/;
const ALERT = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|DANGER)\][ \t]*/i;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

const URL_IN_PARENS = String.raw`\(((?:[^()\s]|\([^()\s]*\))+)\)`;
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]${URL_IN_PARENS}`, 'g');
const LINK = new RegExp(String.raw`\[([^\]]+)\]${URL_IN_PARENS}`, 'g');

export interface PlainTextOptions {
  /** The article's title. A heading that repeats it before any other text is left out. */
  title?: string;
}

/**
 * The text of a Markdown document, one output line per line of text, with
 * blank lines kept between paragraphs. Code keeps every character.
 */
export function markdownToPlainText(markdown: string, options: PlainTextOptions = {}): string {
  const lines = withoutControls(markdown.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  const title = comparable(options.title ?? '');
  let written = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (FENCE.test(line)) {
      // The fence lines are markup; the code between them is text. A fence
      // nobody closed runs to the end, as it does when rendered.
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) out.push(lines[i++] ?? '');
      written = true;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = inline(heading[1] ?? '').trim();
      if (!text || (!written && title && comparable(text) === title)) continue;
      out.push(/[.!?:;…]$/.test(text) ? text : `${text} —`);
      written = true;
      continue;
    }

    if (isTableHeader(line, lines[i + 1])) {
      out.push(tableRow(line));
      i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        out.push(tableRow(lines[i++] ?? ''));
      }
      i--;
      continue;
    }

    const text = lineText(line);
    if (text !== null) out.push(text);
    if (text?.trim()) written = true;
  }

  return out.join('\n');
}

/** Text as a title comparison sees it: case, spacing and a closing stop ignored. */
function comparable(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[.:]$/, '').trim();
}

/**
 * Control characters an article has no business containing, tabs and line
 * breaks aside. Search uses some of them as markers, so they go first.
 */
function withoutControls(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) continue;
    out += char;
  }
  return out;
}

/** One line outside code: its words, or null when the whole line is markup. */
function lineText(line: string): string | null {
  if (CONTAINER_CLOSE.test(line)) return null;
  const container = CONTAINER_OPEN.exec(line);
  if (container && CONTAINERS.has((container[1] ?? '').toLowerCase())) {
    // `:::details How refunds work` shows its title; `:::steps` shows nothing.
    const title = (container[2] ?? '').trim();
    return title ? inline(title) : null;
  }
  const tab = TAB.exec(line);
  if (tab) return inline((tab[1] ?? '').trim());
  if (RULE.test(line)) return null;

  const body = line.replace(QUOTE, '').replace(ALERT, '').replace(LIST_MARKER, '');
  return inline(body);
}

function isTableHeader(line: string, next: string | undefined): boolean {
  return (
    line.includes('|') &&
    next !== undefined &&
    /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(next)
  );
}

/** A table row as its cells, set apart so they do not run together. */
function tableRow(line: string): string {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => inline(cell.trim()))
    .filter(Boolean)
    .join(' · ');
}

/**
 * Inline markup off, in the renderer's order: code spans are lifted out
 * first, so nothing inside one is read as a link or emphasis, then images
 * and links become their words, then emphasis marks go.
 */
function inline(text: string): string {
  const stash: string[] = [];
  const keep = (fragment: string): string => {
    stash.push(fragment);
    return `${NUL}${stash.length - 1}${NUL}`;
  };

  const out = text
    .replace(/`([^`]+)`/g, (_, code: string) => keep(code))
    .replace(IMAGE, (_, alt: string) => alt)
    .replace(LINK, (_, label: string) => label)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1$2')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1$2');

  return out.replace(PLACEHOLDER, (_, index: string) => stash[Number(index)] ?? '');
}
