/**
 * Markdown, for anywhere HelpWell shows an article or an answer.
 *
 * One renderer for the help centre, the dashboard's preview and the widget, so
 * an article looks the same in all three. On top of the everyday forms it
 * knows the block vocabulary help articles need (KB-05): callouts in GitHub's
 * alert syntax, numbered steps, tabs, accordions and video embeds. Anchors go
 * on headings, so a link can point at a section, and tables are supported.
 *
 * Everything is escaped before any markup is reintroduced, so a doc written by
 * someone who pasted HTML in cannot inject a script. Inline markup is then
 * built in passes that cannot see each other's output: a code span is lifted
 * out before links are read, and a link is lifted out before emphasis runs, so
 * `[x](https://a.com/**b**)` keeps its href and `` `**a**` `` stays literal.
 * The blocks add no raw HTML either: a video only ever becomes an iframe on a
 * fixed list of players, with an id the renderer extracted and rebuilt itself.
 */

import { escapeHtml } from './html.js';

/**
 * The four glyphs the blocks draw, in the same stroke style as `icons.ts`.
 * Copied rather than imported: the widget bundles this renderer, and the
 * whole icon set would ride along with it for the sake of four paths.
 */
const GLYPHS: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  sparkle: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.8L12 18l-1.7-5.5L4.8 10.7 10.3 9 12 3.5Z"/>',
  play: '<path d="M7 4.5 19 12 7 19.5Z"/>',
};

function icon(name: string, size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name] ?? ''}</svg>`;
}

export interface Heading {
  depth: number;
  /** Plain text: entities decoded, inline markup stripped. Escape it when rendering. */
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: Heading[];
}

/**
 * Where the Markdown is going to be shown.
 *
 * `page` is a whole page HelpWell serves: the help centre, the dashboard.
 * `panel` is the widget, a narrow panel inside somebody else's site. There a
 * video player iframe would be subject to the host page's own CSP, would bring
 * the player's cookies onto a page HelpWell does not own, and would be a
 * postage stamp anyway, so a video becomes a link card that opens the player.
 * Tabs become a stack of disclosures, because the widget's stylesheet is not
 * this renderer's to extend and disclosures need no CSS to work.
 */
export type MarkdownSurface = 'page' | 'panel';

export interface MarkdownOptions {
  surface?: MarkdownSurface;
}

/**
 * The only origins a rendered article ever frames. A page that serves
 * rendered Markdown under its own Content-Security-Policy lists these in
 * `frame-src`; the help centre does.
 */
export const VIDEO_EMBED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.loom.com',
  'https://fast.wistia.net',
] as const;

/** Marks a lifted-out fragment while the inline passes run. Never in real text. */
const NUL = String.fromCharCode(0);

/** A code fence, indented by up to the three spaces CommonMark allows. */
const FENCE = /^ {0,3}```/;

/** `:::steps`, `:::tabs`, `:::details Title`. Colons, a name, then anything. */
const CONTAINER_OPEN = /^ {0,3}:{3,}[ \t]*([A-Za-z][\w-]*)[ \t]*(.*)$/;
const CONTAINER_CLOSE = /^ {0,3}:{3,}[ \t]*$/;
const CONTAINERS = new Set(['steps', 'tabs', 'details', 'accordion']);

/** A blockquote line, after escaping turned `>` into `&gt;`. */
const QUOTE = /^&gt;[ \t]?/;
/** The first line of a GitHub alert: `> [!TIP]`, with an optional title after it. */
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|DANGER)\][ \t]*(.*)$/i;
/** A tab inside `:::tabs`: `== macOS`. */
const TAB = /^==[ \t]+(.+)$/;
/** A numbered item: the number, then its text. */
const ORDERED = /^\s*(\d+)[.)]\s+/;
const ORDERED_MARKER = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,4})\s+(.*)$/;

type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const CALLOUT_KIND: Record<string, CalloutKind> = {
  NOTE: 'note',
  INFO: 'note',
  TIP: 'tip',
  IMPORTANT: 'important',
  WARNING: 'warning',
  CAUTION: 'caution',
  DANGER: 'caution',
};

const CALLOUT_TITLE: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const CALLOUT_ICON: Record<CalloutKind, string> = {
  note: 'info',
  tip: 'sparkle',
  important: 'info',
  warning: 'alert',
  caution: 'alert',
};

interface State {
  headings: Heading[];
  seen: Map<string, number>;
  surface: MarkdownSurface;
  /** Stable for a given document, so two tab groups on one page never share a radio name. */
  uid: string;
  tabGroups: number;
}

/**
 * Inside a quote or a callout, headings are drawn but not anchored. The
 * indexer in core never sees a `>`-prefixed line as a heading, and an anchor
 * the agent cites has to land on the section this page rendered.
 */
interface Scope {
  quoted: boolean;
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): RenderedMarkdown {
  // The marker cannot be allowed in from outside.
  const clean = source.replace(/\r\n/g, '\n').split(NUL).join('');
  const state: State = {
    headings: [],
    seen: new Map(),
    surface: options.surface ?? 'page',
    uid: shortHash(clean),
    tabGroups: 0,
  };
  const lines = escapeHtml(clean).split('\n');
  return {
    html: renderBlocks(lines, state, { quoted: false }).join('\n'),
    headings: state.headings,
  };
}

function renderBlocks(lines: string[], state: State, scope: Scope): string[] {
  const blocks: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (!line.trim()) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const language = line.replace(FENCE, '').trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++;
      const attr = language ? ` class="language-${escapeHtml(language)}"` : '';
      blocks.push(`<pre><code${attr}>${body.join('\n')}</code></pre>`);
      continue;
    }

    const container = containerName(line);
    if (container) {
      const end = closingLine(lines, i);
      const title = (CONTAINER_OPEN.exec(line)?.[2] ?? '').trim();
      const inner = dedent(lines.slice(i + 1, end));
      blocks.push(renderContainer(container, title, inner, state, scope));
      i = end + 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(renderHeading(heading[1]!.length, heading[2] ?? '', state, scope));
      i++;
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(splitRow(lines[i] ?? ''));
        i++;
      }
      blocks.push(table(header, rows));
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(QUOTE, ''));
        i++;
      }
      blocks.push(quote(body, state));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push(`<li>${inline((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (ORDERED.test(line)) {
      const start = Number(ORDERED.exec(line)?.[1] ?? 1);
      const items: string[] = [];
      while (i < lines.length && ORDERED.test(lines[i] ?? '')) {
        const parts = [inline((lines[i] ?? '').replace(ORDERED_MARKER, ''))];
        i++;
        // Steps often carry a screenshot or an indented paragraph after a blank
        // line. Keep them inside the step, so the list is not split and the
        // numbering carries on instead of restarting at 1.
        for (;;) {
          let j = i;
          while (j < lines.length && !(lines[j] ?? '').trim()) j++;
          const next = lines[j] ?? '';
          if (j >= lines.length || ORDERED.test(next)) break;
          if (STANDALONE_IMAGE.test(next.trim())) {
            parts.push(`<p>${inline(next.trim())}</p>`);
            i = j + 1;
            continue;
          }
          if (leading(next) >= 2 && !startsBlock(next.trim(), lines[j + 1])) {
            const body: string[] = [];
            while (
              i < lines.length &&
              (!(lines[i] ?? '').trim() || leading(lines[i] ?? '') >= 2) &&
              !ORDERED.test(lines[i] ?? '')
            ) {
              body.push(lines[i] ?? '');
              i++;
            }
            parts.push(...renderBlocks(dedent(body), state, scope));
            continue;
          }
          break;
        }
        items.push(`<li>${parts.join('')}</li>`);
        // Blank lines between steps do not end the list.
        let k = i;
        while (k < lines.length && !(lines[k] ?? '').trim()) k++;
        if (k < lines.length && ORDERED.test(lines[k] ?? '')) i = k;
      }
      blocks.push(`<ol${start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</ol>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push('<hr>');
      i++;
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !startsBlock(lines[i] ?? '', lines[i + 1])
    ) {
      paragraph.push(lines[i] ?? '');
      i++;
    }
    // A video on a line of its own is a player; anywhere else it is a link.
    const media = paragraph.length === 1 ? standaloneVideo(paragraph[0] ?? '', state) : null;
    blocks.push(media ?? `<p>${inline(paragraph.join(' '))}</p>`);
  }

  return blocks;
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    containerName(line) !== null ||
    /^#{1,4}\s/.test(line) ||
    QUOTE.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^(-{3,}|\*{3,})$/.test(line.trim()) ||
    (line.includes('|') && isTableSeparator(next))
  );
}

function isTableSeparator(line: string | undefined): boolean {
  if (!line) return false;
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function table(header: string[], rows: string[][]): string {
  const head = header.map((cell) => `<th>${inline(cell)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('');
  // Wrapped so a wide table scrolls inside itself rather than pushing the page.
  return `<div class="hc-tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderHeading(
  depth: number,
  raw: string,
  state: State,
  scope: Scope,
  className = '',
): string {
  // Closing hashes are decoration, not content: `## Title ##`.
  const markup = raw.trim().replace(/\s*#+\s*$/, '');
  const cls = className ? ` class="${className}"` : '';
  if (scope.quoted) return `<h${depth}${cls}>${inline(markup)}</h${depth}>`;

  const text = decodeEntities(markup);
  const id = uniqueSlug(text, state.seen);
  state.headings.push({ depth, text: plainText(text), id });
  // The anchor is a link on the heading itself, so "copy link to section"
  // is one click and the URL survives being pasted anywhere.
  return `<h${depth} id="${id}"${cls}><a class="hc-anchor" href="#${id}" aria-label="Link to this section">#</a>${inline(markup)}</h${depth}>`;
}

/* ---------------------------------------------------------------- blocks */

/** The container a line opens, or null. An unknown name is ordinary text. */
function containerName(line: string): string | null {
  const name = CONTAINER_OPEN.exec(line)?.[1]?.toLowerCase();
  return name && CONTAINERS.has(name) ? name : null;
}

/**
 * The line that closes the container opened at `start`, skipping fenced code
 * and anything nested inside. A container nobody closed runs to the end of
 * the document: what the author wrote still shows, inside the block they
 * meant to open, and the preview makes the missing `:::` obvious.
 */
function closingLine(lines: string[], start: number): number {
  let depth = 0;
  let fenced = false;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (CONTAINER_OPEN.test(line)) depth++;
    else if (CONTAINER_CLOSE.test(line)) {
      if (depth === 0) return j;
      depth--;
    }
  }
  return lines.length;
}

/** Indenting a container's body for readability should not change what it means. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim()).map((line) => leading(line));
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  return cut > 0 ? lines.map((line) => line.slice(Math.min(cut, leading(line)))) : lines;
}

function leading(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

/** Lines that match `test` at the top level: not in a fence, not in a nested container. */
function topLevel<T>(
  lines: string[],
  test: (line: string) => T | null,
): { index: number; value: T }[] {
  const out: { index: number; value: T }[] = [];
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (FENCE.test(line)) {
      j++;
      while (j < lines.length && !FENCE.test(lines[j] ?? '')) j++;
      continue;
    }
    if (containerName(line)) {
      j = closingLine(lines, j);
      continue;
    }
    const value = test(line);
    if (value !== null) out.push({ index: j, value });
  }
  return out;
}

function renderContainer(
  name: string,
  title: string,
  lines: string[],
  state: State,
  scope: Scope,
): string {
  if (name === 'steps') return steps(lines, state, scope);
  if (name === 'tabs') return tabs(lines, state, scope);
  // `details` and `accordion` are the same block.
  return disclosure(title ? inline(title) : 'Details', renderBlocks(lines, state, scope), false);
}

function disclosure(summary: string, body: string[], open: boolean): string {
  return `<details class="hc-accordion"${open ? ' open' : ''}><summary>${summary}</summary><div class="hc-accordion__body">${body.join('\n')}</div></details>`;
}

/**
 * Numbered steps. Each heading at the level of the first one starts a step
 * and titles it; everything up to the next is that step's body, screenshots
 * included. The titles are real headings with anchors, so "step 3" can be
 * linked to and shows in the table of contents.
 *
 * With no heading inside, the block is just a numbered list drawn as steps.
 */
function steps(lines: string[], state: State, scope: Scope): string {
  const marks = topLevel(lines, (line) => {
    const heading = HEADING.exec(line);
    return heading ? { depth: heading[1]!.length, markup: heading[2] ?? '' } : null;
  });
  if (marks.length === 0) {
    return `<div class="hc-steps">${renderBlocks(lines, state, scope).join('\n')}</div>`;
  }

  const level = marks[0]!.value.depth;
  const starts = marks.filter((mark) => mark.value.depth === level);
  // Anything written before the first step renders first, so heading ids
  // are handed out in document order, the way the indexer counts them.
  const before = renderBlocks(lines.slice(0, starts[0]!.index), state, scope);

  const items = starts.map((mark, k) => {
    const end = starts[k + 1]?.index ?? lines.length;
    const title = renderHeading(level, mark.value.markup, state, scope, 'hc-step__title');
    const body = renderBlocks(lines.slice(mark.index + 1, end), state, scope);
    return `<li class="hc-step">${title}${
      body.length > 0 ? `<div class="hc-step__body">${body.join('\n')}</div>` : ''
    }</li>`;
  });

  return [...before, `<ol class="hc-steps">${items.join('')}</ol>`].join('\n');
}

/**
 * Tabs, for the same instructions on different platforms. On a page they are
 * radio buttons and labels, so they switch with no script at all and the
 * arrow keys move between them. In the widget they are disclosures, the first
 * one open.
 */
function tabs(lines: string[], state: State, scope: Scope): string {
  const marks = topLevel(lines, (line) => TAB.exec(line)?.[1]?.trim() || null);
  if (marks.length === 0) return renderBlocks(lines, state, scope).join('\n');

  const before = renderBlocks(lines.slice(0, marks[0]!.index), state, scope);
  const panels = marks.map((mark, k) => ({
    label: inline(mark.value),
    body: renderBlocks(
      lines.slice(mark.index + 1, marks[k + 1]?.index ?? lines.length),
      state,
      scope,
    ),
  }));

  if (state.surface === 'panel') {
    const stack = panels.map((panel, k) => disclosure(panel.label, panel.body, k === 0)).join('');
    return [...before, `<div class="hc-tabs hc-tabs--stacked">${stack}</div>`].join('\n');
  }

  const group = `hc-tabs-${state.uid}-${state.tabGroups++}`;
  const items = panels.map((panel, k) => {
    const id = `${group}-${k}`;
    return `<div class="hc-tab"><input class="hc-tab__radio" type="radio" name="${group}" id="${id}"${
      k === 0 ? ' checked' : ''
    }><label class="hc-tab__label" for="${id}">${panel.label}</label><div class="hc-tab__panel">${panel.body.join('\n')}</div></div>`;
  });
  return [...before, `<div class="hc-tabs">${items.join('')}</div>`].join('\n');
}

/**
 * A blockquote, or a callout when its first line is a GitHub alert marker
 * (`> [!WARNING]`). Text after the marker is the callout's title.
 *
 * A callout is a `div` with the note role on a page, where the help centre
 * styles it. In the widget it is a `blockquote`, so it picks up the quote
 * style the panel already has instead of arriving as an unstyled box.
 */
function quote(body: string[], state: State): string {
  const alert = ALERT.exec((body[0] ?? '').trim());
  if (!alert) {
    return `<blockquote>${renderBlocks(body, state, { quoted: true }).join('\n')}</blockquote>`;
  }

  const kind = CALLOUT_KIND[alert[1]!.toUpperCase()] ?? 'note';
  const title = alert[2]?.trim() ? inline(alert[2].trim()) : CALLOUT_TITLE[kind];
  const inner = renderBlocks(body.slice(1), state, { quoted: true }).join('\n');
  const tag = state.surface === 'panel' ? 'blockquote' : 'div';
  const role = tag === 'div' ? ' role="note"' : '';
  return `<${tag} class="hc-callout hc-callout--${kind}"${role}><p class="hc-callout__title">${icon(
    CALLOUT_ICON[kind],
    16,
  )}<span>${title}</span></p>${inner}</${tag}>`;
}

/* ----------------------------------------------------------------- video */

export interface VideoEmbed {
  provider: 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'file';
  /** What to load: the player URL for a provider, the file itself otherwise. */
  src: string;
  /** Where a person watches it: the provider's own page, or the file. */
  url: string;
}

const PROVIDER_NAME: Record<VideoEmbed['provider'], string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  wistia: 'Wistia',
  file: 'video',
};

const VIDEO_FILE = /\.(mp4|webm|m4v|ogv)(?:[?#]|$)/i;

/**
 * Whether a URL is a video HelpWell will play, and how.
 *
 * YouTube, Vimeo, Loom and Wistia by their public URL shapes, and a video
 * file by its extension. For a provider only the id is taken from what was written, and
 * checked against the shape that provider's ids have; the player URL is built
 * here from that id, so nothing the author typed reaches an iframe `src`.
 * YouTube plays from its no-cookie domain.
 */
export function videoEmbed(url: string): VideoEmbed | null {
  const trimmed = url.trim();
  if (!safeUrl(trimmed)) return null;
  const isFile = VIDEO_FILE.test(trimmed);
  if (!/^https?:\/\//i.test(trimmed)) {
    return isFile ? { provider: 'file', src: trimmed, url: trimmed } : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    const id =
      host === 'youtu.be'
        ? parts[0]
        : parts[0] === 'watch' || parts.length === 0
          ? parsed.searchParams.get('v')
          : ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')
            ? parts[1]
            : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = seconds(parsed.searchParams.get('t') ?? parsed.searchParams.get('start'));
    return {
      provider: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
      url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ''}`,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const [id, hash] = host === 'player.vimeo.com' && parts[0] === 'video' ? parts.slice(1) : parts;
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    const secret = hash ?? parsed.searchParams.get('h');
    const h = secret && /^[0-9a-f]{6,20}$/i.test(secret) ? secret : null;
    return {
      provider: 'vimeo',
      src: `https://player.vimeo.com/video/${id}${h ? `?h=${h}` : ''}`,
      url: `https://vimeo.com/${id}${h ? `/${h}` : ''}`,
    };
  }

  if (host === 'loom.com') {
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : null;
    if (!id || !/^[0-9a-f]{32}$/i.test(id)) return null;
    return {
      provider: 'loom',
      src: `https://www.loom.com/embed/${id}`,
      url: `https://www.loom.com/share/${id}`,
    };
  }

  // Wistia: https only, its own hosts (an account's `acme.wistia.com`, the
  // `fast.wistia.net` player, `wi.st` short links) and a ten-character media
  // id after `medias/` or `iframe/`. Wistia has no public watch page of its
  // own, so the player is also where a person watches it.
  if (parsed.protocol === 'https:' && isWistiaHost(parsed.hostname.toLowerCase())) {
    const at = parts.findIndex((part) => part === 'medias' || part === 'iframe');
    const id = (at >= 0 ? parts[at + 1] : undefined)?.replace(/\.(jsonp?|html)$/, '');
    if (!id || !/^[a-z0-9]{10}$/i.test(id)) return null;
    const player = `https://fast.wistia.net/embed/iframe/${id}`;
    return { provider: 'wistia', src: player, url: player };
  }

  return isFile ? { provider: 'file', src: parsed.href, url: parsed.href } : null;
}

function isWistiaHost(host: string): boolean {
  return (
    host === 'wistia.com' ||
    host === 'wistia.net' ||
    host.endsWith('.wistia.com') ||
    host.endsWith('.wistia.net') ||
    host === 'wi.st'
  );
}

/** `90`, `1m30s` or `1h2m`, as seconds. Anything else is no start time. */
function seconds(value: string | null): number | null {
  if (!value) return null;
  if (/^\d{1,6}$/.test(value)) return Number(value) || null;
  const match = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/.exec(value);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
}

const STANDALONE_IMAGE = /^!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/;

/**
 * `![Setting up billing](https://www.youtube.com/watch?v=…)` on a line of its
 * own. Image syntax because a video is media like a screenshot is, and
 * because a relative `.mp4` then gets the same path handling an image does.
 */
function standaloneVideo(line: string, state: State): string | null {
  const match = STANDALONE_IMAGE.exec(line.trim());
  if (!match) return null;
  const video = videoEmbed(decodeEntities(match[2] ?? ''));
  if (!video) return null;

  // Alt text arrives escaped, which is exactly what an attribute needs.
  const alt = (match[1] ?? '').trim();
  const label = alt || 'Video';
  const caption = alt ? `<figcaption>${alt}</figcaption>` : '';

  if (video.provider === 'file') {
    return `<figure class="hc-video hc-video--file"><video src="${escapeHtml(video.src)}" controls preload="metadata" playsinline aria-label="${label}"></video>${caption}</figure>`;
  }
  if (state.surface === 'panel') {
    return `<p class="hc-video-link"><a href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">${icon(
      'play',
      15,
    )}<span>${label}</span><span class="hc-video-link__via"> · ${PROVIDER_NAME[video.provider]}</span></a></p>`;
  }
  return `<figure class="hc-video"><div class="hc-video__frame"><iframe src="${escapeHtml(video.src)}" title="${label}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${caption}</figure>`;
}

/* ---------------------------------------------------------------- inline */

/** A URL in `(...)`: no whitespace, with one level of balanced parentheses. */
const URL_IN_PARENS = String.raw`\(((?:[^()\s]|\([^()\s]*\))+)\)`;
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]${URL_IN_PARENS}`, 'g');
const LINK = new RegExp(String.raw`\[([^\]]+)\]${URL_IN_PARENS}`, 'g');
const PLACEHOLDER = new RegExp(`${NUL}(\\d+)${NUL}`, 'g');

function inline(text: string): string {
  const stash: string[] = [];
  const keep = (fragment: string): string => {
    stash.push(fragment);
    return `${NUL}${stash.length - 1}${NUL}`;
  };

  let out = text
    // Code first, so nothing inside a span is read as a link or emphasis.
    .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(IMAGE, (_, alt: string, src: string) => {
      if (!safeUrl(src)) return alt;
      // A video in the middle of a sentence cannot be a player; it is a link to one.
      const video = videoEmbed(decodeEntities(src));
      if (video) {
        const attrs = isExternal(video.url) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return keep(`<a href="${escapeHtml(video.url)}"${attrs}>${alt || 'Watch the video'}</a>`);
      }
      return keep(`<img src="${src}" alt="${alt}" loading="lazy">`);
    })
    .replace(LINK, (_, label: string, href: string) => {
      if (!safeUrl(href)) return label;
      const attrs = isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return keep(`<a href="${href}"${attrs}>${emphasis(label)}</a>`);
    });
  out = emphasis(out);

  // A stashed fragment can hold an earlier placeholder (a code span inside a
  // link label), so restore until none are left.
  while (out.includes(NUL)) {
    out = out.replace(PLACEHOLDER, (_, index: string) => stash[Number(index)] ?? '');
  }
  return out;
}

function emphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');
}

/** What a heading says with its inline markup taken off, for a table of contents. */
function plainText(text: string): string {
  return text.replace(IMAGE, '$1').replace(LINK, '$1').replace(/[*_`]/g, '').trim();
}

/**
 * http(s), mailto, or a URL with no scheme at all: a path, `./`, `../`, a
 * fragment, a query. Relative paths are what articles in a repo naturally
 * write (`../_screenshots/dashboard.png`), and nothing without a scheme can
 * run script. Everything with another scheme is refused, `javascript:` and
 * `data:` included.
 *
 * Browsers drop control characters from a URL before they read its scheme,
 * so `\x01javascript:` would be `javascript:` to them; a URL carrying any is
 * refused outright rather than cleaned.
 */
function safeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  for (let k = 0; k < trimmed.length; k++) {
    const code = trimmed.charCodeAt(k);
    if (code < 0x20 || code === 0x7f) return false;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!scheme) return true;
  const name = (scheme[1] ?? '').toLowerCase();
  return name === 'http' || name === 'https' || name === 'mailto';
}

/**
 * Absolute, or protocol-relative (`//other.example`, and `/\other.example`,
 * which browsers read the same way): opens in a new tab with `rel` set.
 */
function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^[/\\][/\\]/.test(url);
}

/** A short, stable fingerprint of a document, for ids that must not collide. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    hash ^= text.charCodeAt(k);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/* -------------------------------------------------------------- headings */

/**
 * An article's body without its opening `# Title`, when that heading only
 * repeats the title the page already shows above it.
 *
 * Articles are written the way GitHub reads them, opening with their own H1,
 * and the help centre and the widget both draw the title themselves; without
 * this every such article says its name twice. An opening heading that says
 * something else is kept, and so is every later one.
 */
export function withoutRepeatedTitle(markdown: string, title: string): string {
  const opening = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!opening || plainHeading(opening[1] ?? '') !== plainHeading(title)) return markdown;
  return markdown.slice(opening[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
}

/** A heading as a reader sees it: no emphasis marks, one space, any case. */
function plainHeading(text: string): string {
  return decodeEntities(text).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Undo `escapeHtml`, plus the numeric and named entities a document can
 * contain, so text pulled out of escaped source reads as text again.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code: string) => codePoint(Number(code), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) =>
      codePoint(Number.parseInt(code, 16), match),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function codePoint(code: number, fallback: string): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/**
 * Heading ids must be stable and unique, because they end up in URLs. The
 * rules are the indexer's in core, so an anchor the agent cites from the
 * database lands on the section the page rendered.
 */
export function slugify(text: string): string {
  return slugifyPlain(decodeEntities(text));
}

function slugifyPlain(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      // Combining marks come off after decomposition, so "Café" is "cafe".
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = slugifyPlain(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  // `-1`, `-2`: the same suffix scheme as the indexer.
  return count === 0 ? base : `${base}-${count}`;
}
