/**
 * The composer: rich text over Markdown.
 *
 * Markdown stays what is stored. The composer shows it as formatted text
 * (headings, bold, italic, links, lists) in an editable box, and writes
 * Markdown back into a plain textarea, the form field, as it changes. With no
 * script the textarea is all there is, and it is the real field either way,
 * so nothing the composer does can lose what was saved.
 *
 * Markdown the rich box cannot show faithfully (callouts, tabs, tables,
 * images, code blocks, HTML) opens as Markdown, with a switch to go back and
 * forth; it is never flattened.
 *
 * The toolbar is the canvas's: personalise, emoji, link, image/GIF/video,
 * and "Write with AI", with a character count at the end. The page decides
 * which tools it has: media are its own ops (usually a block beside the
 * text), personalisation needs fields its renderer can fill in, and writing
 * needs an endpoint that calls the install's model.
 */

import { escapeHtml, html, join, type RawHtml, raw } from '@helpwell/ui';
import { menu, popover } from './controls.js';
import { type KitIconName, kitIcon } from './icons.js';

export interface ComposerTools {
  /** Emoji picker. Default on. */
  emoji?: boolean;
  /** Link. Default on. */
  link?: boolean;
  /** The image/GIF/video button's menu: usually submit buttons that add a media block. */
  media?: readonly { label: string; icon?: KitIconName; name: string; value: string }[] | null;
  /**
   * Fields the text can be personalised with, stored as `{{key}}`. A key may
   * carry a fallback (`first_name|there`), stored as `{{first_name|there}}`.
   * Leave it out unless whatever draws the text fills them in.
   */
  personalise?: readonly { key: string; label: string }[] | null;
  /**
   * "Write with AI": the URL it posts `markdown`, `instruction` and `context`
   * to, which answers `{ markdown }` or `{ error }`.
   */
  ai?: { url: string; context?: string } | null;
}

export interface ComposerOptions {
  /** The form field that holds the Markdown. */
  name: string;
  value: string;
  /** What the box is, for screen readers. */
  label: string;
  placeholder?: string;
  /** A length to count against. `soft`: going over only turns the count amber. */
  max?: number;
  soft?: boolean;
  /** One line of text (a banner): Enter does not start a new paragraph. */
  line?: boolean;
  tools?: ComposerTools;
  id?: string;
}

const EMOJI = [
  '👋',
  '🎉',
  '🚀',
  '✨',
  '✅',
  '💡',
  '🔥',
  '👀',
  '❤️',
  '👍',
  '🙌',
  '🎁',
  '📣',
  '📅',
  '⏰',
  '⚡',
  '🛠️',
  '📈',
  '💬',
  '🔒',
  '⭐',
  '🤝',
  '🙏',
  '😊',
];

const AI_PRESETS = [
  ['Shorter', 'Make it shorter. Keep the meaning.'],
  ['Friendlier', 'Make it warmer and friendlier, still brief.'],
  ['Clearer', 'Make it clearer and more direct.'],
  ['Fix spelling', 'Fix spelling and grammar only. Change nothing else.'],
] as const;

export function composer(options: ComposerOptions): RawHtml {
  const tools = options.tools ?? {};
  const rich = isSimpleMarkdown(options.value);
  const length = plainLength(options.value);
  const buttons: RawHtml[] = [];

  if (tools.personalise && tools.personalise.length > 0) {
    buttons.push(
      popover({
        trigger: raw(kitIcon('at', 15)),
        triggerClass: 'ek-tb',
        label: 'Personalise',
        attrs: raw(' data-ek-needs-js'),
        body: html`<p class="ek-pop__title">Insert a field</p>${menu(
          tools.personalise.map((f) => ({
            label: f.label,
            icon: 'user' as const,
            attrs: html` data-ek-merge-insert="${f.key}"`,
          })),
        )}`,
      }),
    );
  }
  if (tools.emoji !== false) {
    buttons.push(
      popover({
        trigger: raw(kitIcon('smile', 15)),
        triggerClass: 'ek-tb',
        label: 'Emoji',
        attrs: raw(' data-ek-needs-js'),
        body: html`<div class="ek-emoji">${join(
          EMOJI.map(
            (e) => html`<button type="button" data-ek-emoji aria-label="${e}">${e}</button>`,
          ),
        )}</div>`,
      }),
    );
  }
  if (tools.link !== false) {
    buttons.push(
      popover({
        trigger: raw(kitIcon('link', 15)),
        triggerClass: 'ek-tb',
        label: 'Link',
        attrs: raw(' data-ek-needs-js'),
        body: html`<p class="ek-pop__title">Link</p>
          <input class="ek-input" type="url" placeholder="https://… or /path" aria-label="Link address" data-ek-link-url>
          <p class="ek-pop__text">Select words first to link them, or the address is added as it is.</p>
          <div class="ek-pop__row"><button type="button" class="ek-btn ek-btn--primary" data-ek-link-go>Add link</button></div>`,
      }),
    );
  }
  if (tools.media && tools.media.length > 0) {
    buttons.push(
      popover({
        trigger: raw(kitIcon('image', 15)),
        triggerClass: 'ek-tb',
        label: 'Image, GIF or video',
        body: html`<p class="ek-pop__title">Add beside this text</p>${menu(tools.media)}`,
      }),
    );
  }
  if (tools.ai) {
    buttons.push(raw('<span class="ek-tsep" aria-hidden="true"></span>'));
    buttons.push(
      popover({
        trigger: html`${raw(kitIcon('sparkles', 13))}<span>Write with AI</span>`,
        triggerClass: 'ek-tb ek-tb--label',
        attrs: raw(' data-ek-needs-js'),
        body: html`<div class="ek-ai" data-ek-ai="${tools.ai.url}" data-ek-ai-context="${tools.ai.context ?? ''}">
          <p class="ek-pop__title">Write with AI</p>
          <div class="ek-ai__presets">${join(
            AI_PRESETS.map(
              ([label, instruction]) =>
                html`<button type="button" class="ek-choice" data-ek-ai-preset="${instruction}">${label}</button>`,
            ),
          )}</div>
          <textarea class="ek-input" rows="2" placeholder="Or say what to write: a welcome for new trial users…" aria-label="What to write" data-ek-ai-prompt></textarea>
          <div class="ek-pop__row"><button type="button" class="ek-btn ek-btn--primary" data-ek-ai-go>Write</button><button type="button" class="ek-mini" data-ek-ai-undo hidden>Undo</button></div>
          <p class="ek-ai__status" role="status"></p>
        </div>`,
      }),
    );
  }
  buttons.push(
    html`<button type="button" class="ek-tb" data-ek-markdown data-ek-needs-js aria-pressed="${String(!rich)}" aria-label="Edit as Markdown" title="Edit as Markdown">${raw(
      kitIcon('code', 15),
    )}</button>`,
  );

  const over = options.max !== undefined && length > options.max;
  return html`<div class="ek-composer${options.line ? ' ek-composer--line' : ''}" data-ek-composer data-mode="${rich ? 'rich' : 'source'}"${
    options.max !== undefined ? html` data-max="${options.max}"` : null
  }${options.line ? raw(' data-line') : null}${options.id ? html` id="${options.id}"` : null}>
  <div class="ek-composer__rich" contenteditable="true" role="textbox" aria-multiline="${String(!options.line)}" aria-label="${options.label}" data-placeholder="${
    options.placeholder ?? 'Write something…'
  }" data-empty="${String(!options.value.trim())}" spellcheck="true">${raw(rich ? composerHtml(options.value) : '')}</div>
  <textarea class="ek-composer__source" name="${options.name}" rows="${options.line ? 2 : 4}" aria-label="${options.label}, as Markdown" placeholder="${
    options.placeholder ?? ''
  }">${options.value}</textarea>
  <div class="ek-composer__tools">${join(buttons)}<span class="ek-count" data-ek-count${over ? raw(' data-over="true"') : null}>${
    options.max !== undefined ? `${length} / ${options.max}` : String(length)
  }</span></div>
</div>`;
}

/* ------------------------------------------------------------- Markdown */

/**
 * Whether the rich box can show this Markdown and write back the same
 * thing: paragraphs, ATX headings, bold, italic, links, inline code, one
 * level of bullet or numbered list, and `{{field}}` tags.
 */
export function isSimpleMarkdown(markdown: string): boolean {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  return lines.every((line) => {
    if (/^\s{2,}\S/.test(line) && !/^\s*$/.test(line)) return false; // nested or indented
    if (/^\s*(>|:::|\||```|~~~|<|---\s*$|\*\*\*\s*$|___\s*$)/.test(line)) return false;
    if (/!\[/.test(line)) return false;
    if (/^={3,}|^-{3,}/.test(line)) return false;
    return true;
  });
}

/** How long the text is to a reader: Markdown marks and link targets not counted. */
export function plainLength(markdown: string): number {
  const text = markdown
    .replace(/\r\n/g, '\n')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{\{\s*([\w.-]+)\s*(?:\|[^{}]*)?\}\}/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return [...text].length;
}

/**
 * The simple Markdown above as HTML for the rich box. The same rules as the
 * kit's script uses in the browser, so what the server draws and what the
 * box writes back agree.
 */
export function composerHtml(markdown: string): string {
  const blocks = markdown
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/);
  return blocks
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0] ?? '');
      if (heading) {
        const level = Math.min(heading[1]!.length, 4);
        const rest = lines.slice(1).join(' ').trim();
        return `<h${level}>${inline(heading[2] ?? '')}</h${level}>${rest ? `<p>${inline(rest)}</p>` : ''}`;
      }
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\{\{\s*([\w.-]+)\s*(\|[^{}]*)?\}\}/g, (_, key: string, fallback?: string) =>
      mergeChip(key, fallback ?? ''),
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) =>
      safeLink(href) ? `<a href="${href}">${label}</a>` : label,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');
}

/**
 * A `{{key}}` or `{{key|fallback}}` field as a chip. The fallback, what is
 * said when the field has no value, travels in the chip and shows on hover.
 */
function mergeChip(key: string, fallback: string): string {
  const said = fallback.replace(/^\|/, '').trim();
  const title = said ? ` title="If empty: ${said}"` : '';
  return `<span class="ek-merge" contenteditable="false" data-ek-merge="${key}${fallback}"${title}>@${key}</span>`;
}

function safeLink(href: string): boolean {
  const value = href.replace(/&amp;/g, '&').trim().toLowerCase();
  if (/^[/\\][/\\]/.test(value)) return false;
  return (
    value.startsWith('/') ||
    value.startsWith('#') ||
    value.startsWith('https://') ||
    value.startsWith('http://') ||
    value.startsWith('mailto:')
  );
}
