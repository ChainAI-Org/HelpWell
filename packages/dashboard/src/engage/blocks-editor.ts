/**
 * Editing a list of blocks: the content of every engagement.
 *
 * Each block is drawn as the design draws that part of a message: media as a
 * media block (thumbnail, name, Replace, Alt text, Remove), text in the
 * composer (formatted text over Markdown, with its toolbar and count), and
 * buttons as a label and what it does. They stay in their stored order, each
 * with small buttons to move or remove it; under them, one chip per kind of
 * block adds one. Images and GIFs take an address or, when the dashboard can
 * store files, an upload (the kit's script sends the file and fills in the
 * address).
 */

import type { Block, Engagement } from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import {
  composer,
  field,
  type KitIconName,
  kitButton,
  kitIcon,
  segmented as kitSegmented,
  mediaBlock,
  popover,
  selectInput,
  textInput,
  toggle,
} from '../editor-kit/index.js';
import { errorOf, type Fields, hidden, opButton, pathError, shown } from './fields.js';

const BLOCK_NAMES: Record<Block['type'], string> = {
  text: 'Text',
  image: 'Image',
  gif: 'GIF',
  video: 'Video',
  buttons: 'Button',
  divider: 'Divider',
};

const BLOCK_ICONS: Record<Block['type'], KitIconName> = {
  text: 'text',
  image: 'image',
  gif: 'film',
  video: 'play',
  buttons: 'click',
  divider: 'minus',
};

const ACTIONS = [
  { value: 'url', label: 'Link' },
  { value: 'next', label: 'Next' },
  { value: 'tour', label: 'Tour' },
  { value: 'chat', label: 'Chat' },
  { value: 'article', label: 'Article' },
  { value: 'dismiss', label: 'Close' },
];

export interface BlocksOptions {
  fields: Fields;
  /** Whether files can be uploaded here, rather than only linked. */
  canUpload: boolean;
  /** The tours a "Start a tour" button can name. */
  tours: readonly Pick<Engagement, 'id' | 'name'>[];
  /** Hide block kinds that make no sense here. */
  only?: readonly Block['type'][];
  /** One line of text, as a banner is. */
  line?: boolean;
  /** Where Write with AI posts, and what it is told the text is for. */
  ai?: { url: string; context: string } | null;
  /** What each kind of block is called here ("Icon or image" in a banner). */
  labels?: Partial<Record<Block['type'], string>>;
  /** The small media thumbnail (a banner's icon). */
  compactMedia?: boolean;
  /** "Next" makes sense: a slide or step follows. */
  hasNext?: boolean;
  /**
   * Contact fields the text can be personalised with, as `{{key}}` (a key
   * may carry its fallback: `first_name|there`). The widget fills them in.
   */
  personalise?: readonly { key: string; label: string }[];
}

export function blocksEditor(
  path: string,
  blocks: readonly Block[],
  options: BlocksOptions,
): RawHtml {
  const kinds = (options.only ?? (Object.keys(BLOCK_NAMES) as Block['type'][])).filter(
    (k) => k in BLOCK_NAMES,
  );
  return html`<div class="eg-blocks" id="en-${path}">
  ${pathError(options.fields, path)}
  ${
    blocks.length === 0
      ? html`<p class="ek-field__hint eg-blocks__empty">Nothing here yet. Add text, media or a button below.</p>`
      : join(
          blocks.map((block, i) =>
            blockPanel(`${path}.${i}`, path, block, i, blocks.length, options),
          ),
        )
  }
  ${
    blocks.length < 20
      ? html`<div class="eg-blocks__add" role="group" aria-label="Add a block"><span class="eg-blocks__addlabel">${raw(
          kitIcon('plus', 12, 2),
        )}Add</span>${join(
          kinds.map(
            (kind) =>
              html`<button type="submit" class="ek-choice" name="op" value="add-block|${path}|${kind}" formnovalidate>${raw(
                kitIcon(BLOCK_ICONS[kind], 12),
              )}${BLOCK_NAMES[kind]}</button>`,
          ),
        )}</div>`
      : null
  }
</div>`;
}

function label(block: Block, options: BlocksOptions): string {
  const named = options.labels?.[block.type];
  if (named) return named;
  if (block.type === 'image' || block.type === 'gif' || block.type === 'video') return 'Media';
  if (block.type === 'buttons') return block.buttons.length > 1 ? 'Buttons' : 'Button';
  return BLOCK_NAMES[block.type];
}

function blockPanel(
  path: string,
  listPath: string,
  block: Block,
  index: number,
  count: number,
  options: BlocksOptions,
): RawHtml {
  const { fields } = options;
  const isMedia = block.type === 'image' || block.type === 'gif' || block.type === 'video';
  const moves = html`${index > 0 ? opButton(`Move this ${BLOCK_NAMES[block.type].toLowerCase()} up`, `up|${path}`, { glyph: 'up' }) : null}${
    index < count - 1
      ? opButton(`Move this ${BLOCK_NAMES[block.type].toLowerCase()} down`, `down|${path}`, {
          glyph: 'down',
        })
      : null
  }${isMedia ? null : opButton(`Remove this ${BLOCK_NAMES[block.type].toLowerCase()}`, `remove|${path}`, { glyph: 'remove', tone: 'danger' })}`;
  const hint =
    isMedia && !options.compactMedia
      ? html`<span class="eg-block__hint">${block.type === 'video' ? 'YouTube, Vimeo, Loom or Wistia link, or a file' : 'Upload, or paste a link'}</span>`
      : null;
  const problem = errorOf(fields, path);
  return html`<div class="ek-field eg-block" id="en-${path}"${problem ? raw(' data-invalid="true"') : null}>
  <span class="ek-field__head"><span class="ek-field__label">${label(block, options)}</span><span class="ek-field__aside">${hint}${moves}</span></span>
  ${hidden(`${path}.type`, block.type)}
  ${blockFields(path, listPath, block, options)}
  ${problem ? html`<span class="ek-field__error" role="alert">${problem}</span>` : null}
</div>`;
}

function blockFields(
  path: string,
  listPath: string,
  block: Block,
  options: BlocksOptions,
): RawHtml | null {
  const { fields } = options;
  switch (block.type) {
    case 'text': {
      const at = `${path}.markdown`;
      const problem = errorOf(fields, at);
      return html`${composer({
        name: at,
        value: shown(fields, at, block.markdown),
        label: 'Text',
        placeholder: options.line
          ? 'One short line…'
          : 'A title on the first line, then a sentence or two…',
        max: options.line ? 120 : undefined,
        soft: true,
        line: options.line,
        tools: {
          media: (options.only ?? ['image', 'gif', 'video'])
            .filter(
              (k): k is 'image' | 'gif' | 'video' => k === 'image' || k === 'gif' || k === 'video',
            )
            .map((kind) => ({
              label: kind === 'gif' ? 'A GIF' : kind === 'video' ? 'A video' : 'An image',
              icon: BLOCK_ICONS[kind],
              name: 'op',
              value: `add-block|${listPath}|${kind}`,
            })),
          ai: options.ai ?? null,
          personalise: options.personalise ?? null,
        },
      })}${problem ? html`<span class="ek-field__error" role="alert">${problem}</span>` : null}`;
    }
    case 'image':
    case 'gif':
    case 'video':
      return media(path, block, options);
    case 'buttons':
      return html`<div class="eg-buttons">${join(
        block.buttons.map((button, j) =>
          buttonRow(`${path}.buttons.${j}`, button, j, block.buttons.length, options),
        ),
      )}${
        block.buttons.length < 2
          ? html`<span>${opButton('Another button', `add-button|${path}.buttons`, { look: 'link' })}</span>`
          : null
      }${pathError(fields, `${path}.buttons`)}</div>`;
    case 'divider':
      return html`<span class="eg-divider" aria-hidden="true"></span>`;
  }
}

const MEDIA = {
  image: {
    accept: 'image/png,image/jpeg,image/gif,image/webp',
    placeholder: 'https://… or an uploaded file',
  },
  gif: { accept: 'image/gif', placeholder: 'https://….gif or an uploaded file' },
  video: {
    accept: 'video/mp4,video/webm',
    placeholder: 'https://www.youtube.com/watch?v=…',
  },
} as const;

function media(
  path: string,
  block: Extract<Block, { type: 'image' | 'gif' | 'video' }>,
  options: BlocksOptions,
): RawHtml {
  const { fields } = options;
  const kind = block.type;
  const urlPath = `${path}.url`;
  const url = shown(fields, urlPath, block.url);
  const urlError = errorOf(fields, urlPath);
  const urlControl = field(
    {
      label: kind === 'video' ? 'Video link or file' : 'Address',
      error: urlError,
      hint:
        kind === 'video'
          ? 'Nothing loads from the video host until the visitor presses play.'
          : options.canUpload
            ? 'An https:// address, or upload a file.'
            : 'An https:// address.',
    },
    textInput({
      name: urlPath,
      value: url,
      placeholder: MEDIA[kind].placeholder,
      attrs: raw(' data-ek-media-url'),
    }),
  );
  const describeControl =
    kind === 'video'
      ? field(
          {
            label: 'Title',
            hint: 'Read out to people who cannot see the player.',
            error: errorOf(fields, `${path}.title`),
          },
          textInput({
            name: `${path}.title`,
            value: shown(fields, `${path}.title`, block.title),
            maxlength: 200,
            attrs: raw(' data-ek-describe'),
          }),
        )
      : html`${field(
          {
            label: 'Alt text',
            hint: 'What it shows, for people who cannot see it.',
            error: errorOf(fields, `${path}.alt`),
          },
          textInput({
            name: `${path}.alt`,
            value: shown(fields, `${path}.alt`, block.alt),
            maxlength: 300,
            attrs: raw(' data-ek-describe'),
          }),
        )}${
          kind === 'image'
            ? field(
                { label: 'Link (optional)', error: errorOf(fields, `${path}.link`) },
                textInput({
                  name: `${path}.link`,
                  value: shown(fields, `${path}.link`, block.link),
                  placeholder: 'https://… or /path',
                }),
              )
            : null
        }`;
  const described = kind === 'video' ? Boolean(block.title.trim()) : Boolean(block.alt.trim());
  const block_ = mediaBlock({
    kind,
    url,
    title: kind === 'video' ? block.title : undefined,
    described,
    urlControl,
    describeControl,
    describeLabel: kind === 'video' ? 'Title' : 'Alt text',
    upload: options.canUpload ? { target: urlPath, accept: MEDIA[kind].accept } : null,
    remove: kitButton({
      label: 'Remove',
      icon: 'trash',
      look: 'danger',
      name: 'op',
      value: `remove|${path}`,
      noValidate: true,
    }),
    compact: options.compactMedia,
  });
  // A problem with the address has to be seen without opening Replace.
  return urlError
    ? html`<span class="ek-field" data-invalid="true">${block_}<span class="ek-field__error" role="alert">${urlError}</span></span>`
    : block_;
}

type ButtonValue = Extract<Block, { type: 'buttons' }>['buttons'][number];

function buttonRow(
  at: string,
  button: ButtonValue,
  index: number,
  count: number,
  options: BlocksOptions,
): RawHtml {
  const { fields } = options;
  const action = shown(fields, `${at}.action`, button.action);
  const valueError = errorOf(fields, `${at}.value`);
  const value = shown(fields, `${at}.value`, button.value);
  const valueControl =
    action === 'tour'
      ? selectInput({
          name: `${at}.value`,
          value,
          label: 'Tour to start',
          choices: [
            { value: '', label: 'Pick a tour' },
            ...options.tours.map((t) => ({ value: t.id, label: t.name || t.id })),
            ...(value && !options.tours.some((t) => t.id === value)
              ? [{ value, label: `${value} (not found)` }]
              : []),
          ],
        })
      : textInput({
          name: `${at}.value`,
          value,
          icon: action === 'article' ? 'text' : 'link',
          placeholder: action === 'article' ? 'billing/invoices' : 'https://… or /path',
          label: action === 'article' ? 'Article slug' : 'Where it goes',
          attrs: raw(' data-en-value'),
        });
  const actions =
    options.hasNext === false
      ? ACTIONS.filter((a) => a.value !== 'next' || action === 'next')
      : ACTIONS;
  // Whether the second row (where it goes, and New tab) shows follows the
  // chosen action in CSS (styles.ts), so it works before any script; only a
  // switch to or from "Tour" redraws, because that one is a list of tours.
  const more = popover({
    trigger: raw(kitIcon('more', 14, 2)),
    triggerClass: 'ek-mini ek-mini--bare',
    label: `More for button ${index + 1}`,
    align: 'end',
    body: html`${field(
      { label: 'Style', as: 'group' },
      kitSegmented({
        name: `${at}.style`,
        value: shown(fields, `${at}.style`, button.style),
        label: `Button ${index + 1} style`,
        choices: [
          { value: 'primary', label: 'Filled' },
          { value: 'secondary', label: 'Quiet' },
        ],
      }),
    )}${
      count > 1 || index > 0
        ? html`<div class="ek-pop__row">${kitButton({
            label: `Remove button ${index + 1}`,
            icon: 'trash',
            look: 'danger',
            name: 'op',
            value: `remove|${at}`,
            noValidate: true,
          })}</div>`
        : null
    }`,
  });
  return html`<div class="eg-button" data-en-button="${action}">
  <div class="eg-button__row">
    ${textInput({
      name: `${at}.label`,
      value: shown(fields, `${at}.label`, button.label),
      maxlength: 60,
      placeholder: 'Button text',
      label: `Button ${index + 1} text`,
    })}
    ${kitSegmented({
      name: `${at}.action`,
      value: action,
      choices: actions,
      label: `What button ${index + 1} does`,
      attrs: raw(' data-en-action'),
    })}
    ${more}
  </div>
  <div class="eg-button__row eg-button__where"${valueError ? raw(' data-invalid="true"') : null}>
    <span class="ek-field eg-button__value"${valueError ? raw(' data-invalid="true"') : null}>${valueControl}${
      valueError ? html`<span class="ek-field__error" role="alert">${valueError}</span>` : null
    }</span>
    <span class="eg-button__newtab">${toggle({ name: `${at}.newTab:bool`, checked: button.newTab, label: 'New tab' })}</span>
  </div>
</div>`;
}
