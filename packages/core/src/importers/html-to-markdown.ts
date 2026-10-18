/**
 * HTML to Markdown, for articles imported from another help desk.
 *
 * Every platform HelpWell imports from hands articles over as HTML, and the
 * crawler reads whole pages, so this is the one converter they all share.
 * It is deliberately small and dependency-free: headings, paragraphs,
 * emphasis, links, images, lists, code, quotes and simple tables, which is
 * what a help article is made of. Anything it does not know becomes its text,
 * so nothing is lost silently; a coding agent tidies the rest in review.
 */

interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = Element | string;

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Dropped with everything inside them: never article content. */
const DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'nav',
  'form',
  'button',
  'select',
  'textarea',
]);

const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'figure',
  'details',
  'summary',
  'center',
]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•',
  middot: '·',
  times: '×',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  laquo: '«',
  raquo: '»',
  deg: '°',
  euro: '€',
  pound: '£',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** A forgiving parse into a tree: unclosed tags close with their parent. */
export function parseHtml(input: string): Element {
  const source = input.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
  const root: Element = { tag: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  const token =
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0;
  for (let match = token.exec(source); match !== null; match = token.exec(source)) {
    const text = source.slice(last, match.index);
    if (text) stack[stack.length - 1]!.children.push(text);
    last = token.lastIndex;
    const tag = match[1]!.toLowerCase();
    const closing = match[0].startsWith('</');

    if (closing) {
      const at = stack.map((el) => el.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }

    const element: Element = { tag, attrs: parseAttrs(match[2] ?? ''), children: [] };
    stack[stack.length - 1]!.children.push(element);
    if (DROP.has(tag)) {
      // Skip straight past the matching close tag.
      const close = source.toLowerCase().indexOf(`</${tag}`, last);
      if (close === -1) break;
      const end = source.indexOf('>', close);
      last = end === -1 ? source.length : end + 1;
      token.lastIndex = last;
      continue;
    }
    if (!VOID.has(tag) && !match[0].endsWith('/>')) stack.push(element);
  }
  const tail = source.slice(last);
  if (tail) stack[stack.length - 1]!.children.push(tail);
  return root;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (let match = pattern.exec(raw); match !== null; match = pattern.exec(raw)) {
    attrs[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

interface Context {
  /** Resolves a relative href or src against the page it came from. */
  base?: string;
  listDepth: number;
}

/** Convert an HTML fragment or page to Markdown. */
export function htmlToMarkdown(input: string, options: { baseUrl?: string } = {}): string {
  const tree = parseHtml(input);
  const out = render(tree.children, { base: options.baseUrl, listDepth: 0 });
  return tidy(out);
}

/**
 * Trailing spaces go, and so does the single space a collapsed text node
 * leaves at the start of a line. Code fences are left exactly as they are.
 */
function tidy(markdown: string): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/[ \t]+$/, '').replace(/^ (?=\S)/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function render(nodes: Node[], context: Context): string {
  return nodes.map((node) => renderNode(node, context)).join('');
}

function text(nodes: Node[], context: Context): string {
  return render(nodes, context).replace(/\s+/g, ' ').trim();
}

function resolve(url: string | undefined, context: Context): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return '';
  if (!context.base || /^(https?:|mailto:|#)/i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed, context.base).href;
  } catch {
    return trimmed;
  }
}

function renderNode(node: Node, context: Context): string {
  if (typeof node === 'string') return decodeEntities(node).replace(/\s+/g, ' ');
  const { tag, attrs, children } = node;

  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const content = text(children, context);
      return content ? `\n\n${'#'.repeat(Number(tag[1]))} ${content}\n\n` : '';
    }
    case 'br':
      return '\n';
    case 'hr':
      return '\n\n---\n\n';
    case 'strong':
    case 'b':
      return wrap(render(children, context), '**');
    case 'em':
    case 'i':
      return wrap(render(children, context), '_');
    case 'code': {
      const content = decodeEntities(plain(children));
      if (!content.trim()) return '';
      const ticks = content.includes('`') ? '``' : '`';
      return `${ticks}${content}${ticks}`;
    }
    case 'pre': {
      const codeChild = children.find(
        (c): c is Element => typeof c !== 'string' && c.tag === 'code',
      );
      const language = /(?:language|lang)-([\w+-]+)/.exec(
        `${codeChild?.attrs.class ?? ''} ${attrs.class ?? ''}`,
      )?.[1];
      const content = decodeEntities(plain(children)).replace(/^\n+|\s+$/g, '');
      const fence = content.includes('```') ? '````' : '```';
      return `\n\n${fence}${language ?? ''}\n${content}\n${fence}\n\n`;
    }
    case 'a': {
      const href = resolve(attrs.href, context);
      const content = text(children, context);
      if (!href) return content;
      if (!content) return href.startsWith('#') ? '' : `<${href}>`;
      return `[${content}](${href})`;
    }
    case 'img': {
      const src = resolve(attrs.src ?? attrs['data-src'], context);
      return src ? `![${(attrs.alt ?? '').replace(/[[\]]/g, '')}](${src})` : '';
    }
    case 'ul':
    case 'ol':
      return renderList(node, context);
    case 'li':
      return render(children, context);
    case 'blockquote': {
      const inner = tidy(render(children, context));
      return inner
        ? `\n\n${inner
            .split('\n')
            .map((line) => `> ${line}`.trimEnd())
            .join('\n')}\n\n`
        : '';
    }
    case 'table':
      return renderTable(node, context);
    case 'figcaption': {
      const content = text(children, context);
      return content ? `\n\n_${content}_\n\n` : '';
    }
    case 'dt':
      return `\n\n**${text(children, context)}**\n`;
    case 'dd':
      return `${text(children, context)}\n\n`;
    case 'iframe': {
      const src = resolve(attrs.src, context);
      return src ? `\n\n[${attrs.title || 'Embedded content'}](${src})\n\n` : '';
    }
    default:
      if (BLOCK.has(tag)) {
        const inner = render(children, context);
        return inner.trim() ? `\n\n${inner}\n\n` : '';
      }
      return render(children, context);
  }
}

/** `**bold**` around the words, with any space the HTML had kept outside the marks. */
function wrap(inner: string, mark: string): string {
  const content = inner.replace(/\s+/g, ' ').trim();
  if (!content) return inner.trim() ? '' : inner;
  const before = /^\s/.test(inner) ? ' ' : '';
  const after = /\s$/.test(inner) ? ' ' : '';
  return `${before}${mark}${content}${mark}${after}`;
}

/** Text as written, for code: no whitespace collapsing, tags ignored. */
function plain(nodes: Node[]): string {
  return nodes
    .map((node) =>
      typeof node === 'string' ? node : node.tag === 'br' ? '\n' : plain(node.children),
    )
    .join('');
}

function renderList(list: Element, context: Context): string {
  const ordered = list.tag === 'ol';
  const indent = '   '.repeat(context.listDepth);
  const items = list.children.filter(
    (child): child is Element => typeof child !== 'string' && child.tag === 'li',
  );
  const lines = items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : '-';
    const nested: Element[] = [];
    const own: Node[] = [];
    for (const child of item.children) {
      if (typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol'))
        nested.push(child);
      else own.push(child);
    }
    const body = tidy(render(own, { ...context, listDepth: context.listDepth + 1 }))
      .split('\n')
      .filter((line) => line.trim())
      .join(`\n${indent}   `);
    const sub = nested
      .map((n) =>
        renderList(n, { ...context, listDepth: context.listDepth + 1 }).replace(/^\n+|\n+$/g, ''),
      )
      .join('\n');
    return `${indent}${marker} ${body}${sub ? `\n${sub}` : ''}`;
  });
  return lines.length > 0 ? `\n\n${lines.join('\n')}\n\n` : '';
}

function renderTable(table: Element, context: Context): string {
  const rows: string[][] = [];
  const collect = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.tag === 'tr') {
        rows.push(
          node.children
            .filter(
              (c): c is Element => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'),
            )
            .map((cell) => text(cell.children, context).replace(/\|/g, '\\|')),
        );
      } else {
        collect(node.children);
      }
    }
  };
  collect(table.children);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill('')];
  const [head, ...body] = rows.map(pad);
  return `\n\n| ${head!.join(' | ')} |\n| ${head!.map(() => '---').join(' | ')} |\n${body
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')}\n\n`;
}

/** The page's title: its first h1, else its <title> without a " | Site" suffix. */
export function htmlTitle(input: string): string | null {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(input)?.[1];
  const fromH1 = h1
    ? decodeEntities(h1.replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  if (fromH1) return fromH1;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(input)?.[1];
  if (!title) return null;
  const clean = decodeEntities(title).replace(/\s+/g, ' ').trim();
  return clean.split(/\s[|–—-]\s/)[0]?.trim() || clean || null;
}

/**
 * The part of a whole page that is the article: <article>, else <main>, else
 * role="main", else the body. Site chrome (nav, header, footer, aside) goes.
 */
export function mainContent(page: string): string {
  const pick = (pattern: RegExp) => pattern.exec(page)?.[1] ?? null;
  const body =
    pick(/<article\b[^>]*>([\s\S]*)<\/article>/i) ??
    pick(/<main\b[^>]*>([\s\S]*)<\/main>/i) ??
    pick(/<[a-z]+\b[^>]*role=["']main["'][^>]*>([\s\S]*)<\/[a-z]+>/i) ??
    pick(/<body\b[^>]*>([\s\S]*)<\/body>/i) ??
    page;
  return body
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
}
