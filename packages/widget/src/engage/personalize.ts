/**
 * Personalisation: `{{first_name|there}}` in an engagement or a chat message,
 * filled in with the visitor's own details as it is drawn.
 *
 * The server sends the values (`fields`, with the items that use them) only
 * for a visitor the host app identified, and only the keys the items ask
 * for; anyone else gets each placeholder's fallback, or nothing.
 *
 * A value is always drawn as text, never as Markdown: a name like
 * `**[win](…)**` must not become a link. Plain strings (a button's label, a
 * survey's question) are simply filled in, because they are set as text.
 * Markdown is harder, since the renderer would read Markdown in a value, so
 * each placeholder becomes a marker the renderer passes through untouched
 * (`tokenize`), and the marker becomes the value in the drawn DOM, in text
 * nodes (`fillTokens`), where it can only ever be text.
 */

import type { Block, EngageButton, Engagement } from './types.js';

export type Fields = Readonly<Record<string, string>>;

/** `{{key}}` or `{{key|fallback}}`, the same pattern the server reads. */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]{1,64})\s*(?:\|([^{}]{0,100}))?\}\}/g;
/** Private-use characters (U+E000, U+E001): nothing in Markdown means anything by them. */
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
const TOKEN = new RegExp(`${OPEN}([0-9]{1,3})${CLOSE}`, 'g');

/** What one placeholder says for this visitor. */
function said(fields: Fields, key: string, fallback: string | undefined): string {
  const value = Object.hasOwn(fields, key) ? fields[key] : undefined;
  return (typeof value === 'string' && value ? value : (fallback ?? '').trim()).slice(0, 200);
}

/** A string that is set as text: the values go straight in. */
export function fillText(text: string, fields: Fields): string {
  if (!text.includes('{{')) return text;
  return text.replace(PLACEHOLDER, (_m, key: string, fallback?: string) =>
    said(fields, key, fallback),
  );
}

/** Markdown with each placeholder swapped for a marker, and what each marker becomes. */
export function tokenize(markdown: string, fields: Fields): { markdown: string; values: string[] } {
  const values: string[] = [];
  if (!markdown.includes('{{')) return { markdown, values };
  const out = markdown.replace(PLACEHOLDER, (_m, key: string, fallback?: string) => {
    if (values.length >= 100) return '';
    values.push(said(fields, key, fallback));
    return `${OPEN}${values.length - 1}${CLOSE}`;
  });
  return { markdown: out, values };
}

/** A string with markers in it, as text: for labels read from the Markdown. */
export function untoken(text: string, values: readonly string[] | undefined): string {
  if (!values || !text.includes(OPEN)) return text;
  return text.replace(TOKEN, (_m, index: string) => values[Number(index)] ?? '');
}

/**
 * Swap the markers in drawn Markdown for their values: as text in text
 * nodes, as text in the attributes a reader hears, and URL-encoded in a link
 * or image address, where a value can then never change where it points.
 */
export function fillTokens(root: ParentNode, values: readonly string[]): void {
  // A plain walk rather than a TreeWalker: the Markdown was drawn in a
  // template's own document, which not every DOM walks across.
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child as Text;
        if (text.data.includes(OPEN)) text.data = untoken(text.data, values);
      } else {
        visit(child);
      }
    }
  };
  visit(root as Node);
  for (const el of root.querySelectorAll('*')) {
    for (const name of ['alt', 'title', 'aria-label']) {
      const value = el.getAttribute(name);
      if (value?.includes(OPEN)) el.setAttribute(name, untoken(value, values));
    }
    for (const name of ['href', 'src']) {
      const value = el.getAttribute(name);
      if (value?.includes(OPEN)) {
        el.setAttribute(
          name,
          value.replace(TOKEN, (_m, index: string) =>
            encodeURIComponent(values[Number(index)] ?? ''),
          ),
        );
      }
    }
  }
}

/** Blocks with their placeholders ready to fill: text tokenised, labels and alt text filled. */
export function personalizeBlocks(blocks: readonly Block[], fields: Fields): Block[] {
  return blocks.map((block): Block => {
    switch (block.type) {
      case 'text': {
        const { markdown, values } = tokenize(block.markdown, fields);
        return values.length > 0 ? { ...block, markdown, values } : block;
      }
      case 'image':
      case 'gif':
        return { ...block, alt: fillText(block.alt, fields) };
      case 'video':
        return { ...block, title: fillText(block.title, fields) };
      case 'buttons':
        return { ...block, buttons: block.buttons.map((b) => personalizeButton(b, fields)) };
      default:
        return block;
    }
  });
}

function personalizeButton(button: EngageButton, fields: Fields): EngageButton {
  return { ...button, label: fillText(button.label, fields) };
}

/**
 * An engagement ready to draw for this visitor. What is stored or counted
 * stays as it was: survey choices (answers are saved against them), ids,
 * links and selectors.
 */
export function personalizeEngagement(engagement: Engagement, fields: Fields): Engagement {
  if (!JSON.stringify(engagement).includes('{{')) return engagement;
  const blocks = (list: readonly Block[]) => personalizeBlocks(list, fields);
  switch (engagement.kind) {
    case 'modal':
      return {
        ...engagement,
        modal: {
          ...engagement.modal,
          slides: engagement.modal.slides.map((slide) => ({ blocks: blocks(slide.blocks) })),
        },
      };
    case 'banner':
      return {
        ...engagement,
        banner: { ...engagement.banner, blocks: blocks(engagement.banner.blocks) },
      };
    case 'hotspot':
      return {
        ...engagement,
        hotspot: { ...engagement.hotspot, blocks: blocks(engagement.hotspot.blocks) },
      };
    case 'tour':
      return {
        ...engagement,
        tour: {
          ...engagement.tour,
          steps: engagement.tour.steps.map((step) => ({ ...step, blocks: blocks(step.blocks) })),
        },
      };
    case 'survey':
      return {
        ...engagement,
        survey: {
          ...engagement.survey,
          intro: blocks(engagement.survey.intro),
          thankYou: blocks(engagement.survey.thankYou),
          questions: engagement.survey.questions.map((q) => ({
            ...q,
            prompt: fillText(q.prompt, fields),
            placeholder: fillText(q.placeholder, fields),
            lowLabel: fillText(q.lowLabel, fields),
            highLabel: fillText(q.highLabel, fields),
            followUp: { ...q.followUp, prompt: fillText(q.followUp.prompt, fields) },
          })),
        },
      };
  }
}

/** The fields a response carried, as plain strings; anything else is dropped. */
export function fieldsFrom(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(key))
      out[key] = value.slice(0, 200);
  }
  return out;
}
