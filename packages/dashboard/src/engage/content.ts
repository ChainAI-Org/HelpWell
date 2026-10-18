/**
 * What an engagement says: a pop-up's slides, a banner's or hotspot's
 * content, a tour's steps, a survey's questions.
 *
 * Lists come first (slides as thumbnails, steps and questions as rows with
 * their numbers, kinds and selectors), then the one item being edited. Every
 * item's editor is in the form; the kit's script shows the chosen one, and
 * without it they all show, one after another.
 */

import type {
  Block,
  Engagement,
  ModalEngagement,
  SurveyEngagement,
  SurveyQuestion,
  TourEngagement,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import {
  card,
  chip,
  choiceChips,
  field,
  filterRow,
  type KitIconName,
  kitIcon,
  list,
  listRow,
  listThumb,
  menu,
  panels,
  popover,
  textInput,
} from '../editor-kit/index.js';
import { type BlocksOptions, blocksEditor } from './blocks-editor.js';
import {
  checkBox,
  choice,
  errorOf,
  type Fields,
  hidden,
  linesBox,
  opButton,
  pathError,
  pillChoice,
  pillNumber,
  segmented,
  shown,
  textBox,
} from './fields.js';
import { SIDES } from './look.js';
import { slidePicture } from './sketches.js';

/** Which item's panel shows first: the one a structural edit just touched, else the first. */
function currentIndex(focus: string | null, prefix: string, count: number): number {
  if (!focus?.startsWith(`${prefix}.`)) return 0;
  const index = Number(focus.slice(prefix.length + 1).split('.')[0]);
  return Number.isInteger(index) && index >= 0 && index < count ? index : 0;
}

/** The words a slide or step is known by: its first heading, or its first line. */
export function itemTitle(blocks: readonly Block[], fallback: string): string {
  const text = blocks.find((b) => b.type === 'text' && b.markdown.trim());
  if (text?.type !== 'text') return fallback;
  const first = text.markdown.trim().split('\n')[0] ?? '';
  const clean = first
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{\{\s*([\w.-]+)\s*(?:\|[^{}]*)?\}\}/g, '@$1')
    .replace(/[*_`]/g, '')
    .trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || fallback;
}

function mediaTag(blocks: readonly Block[]): RawHtml | null {
  const media = blocks.find((b) => b.type === 'image' || b.type === 'gif' || b.type === 'video');
  if (!media) return null;
  return chip(media.type === 'gif' ? 'GIF' : media.type === 'video' ? 'Video' : 'Image', 'tag');
}

function tools(
  label: string,
  path: string,
  index: number,
  count: number,
  min: number,
  horizontal = false,
): RawHtml {
  return html`${index > 0 ? opButton(`Move ${label} ${horizontal ? 'left' : 'up'}`, `up|${path}`, { glyph: horizontal ? 'left' : 'up' }) : null}${
    index < count - 1
      ? opButton(`Move ${label} ${horizontal ? 'right' : 'down'}`, `down|${path}`, {
          glyph: horizontal ? 'right' : 'down',
        })
      : null
  }${opButton(`Duplicate ${label}`, `duplicate|${path}`, { glyph: 'copy' })}${
    count > min
      ? opButton(`Remove ${label}`, `remove|${path}`, { glyph: 'remove', tone: 'danger' })
      : null
  }`;
}

export function contentCards(
  e: Engagement,
  fields: Fields,
  blocks: BlocksOptions,
  focus: string | null,
): RawHtml {
  switch (e.kind) {
    case 'modal':
      return modalContent(e, fields, blocks, focus);
    case 'banner':
      return card(
        { icon: 'text', tone: 'butter', title: 'Content', id: 'en-content' },
        blocksEditor('banner.blocks', e.banner.blocks, {
          ...blocks,
          line: true,
          compactMedia: true,
          hasNext: false,
          labels: { image: 'Icon or image', gif: 'Icon or GIF', buttons: 'Call to action' },
          ai: blocks.ai
            ? { ...blocks.ai, context: `${blocks.ai.context} It is a one-line banner.` }
            : null,
        }),
      );
    case 'hotspot':
      return card(
        { icon: 'target', tone: 'lavender', title: 'Content', id: 'en-content' },
        textBox(fields, 'Points at', 'hotspot.target', e.hotspot.target, {
          placeholder: '#export-button',
          mono: true,
          icon: 'crosshair',
          hint: 'A CSS selector for the element the beacon sits on. Ids and data attributes last longest.',
        }),
        blocksEditor('hotspot.blocks', e.hotspot.blocks, { ...blocks, hasNext: false }),
      );
    case 'tour':
      return tourContent(e, fields, blocks, focus);
    case 'survey':
      return surveyContent(e, fields, blocks, focus);
  }
}

/* ---------------------------------------------------------------- modal */

function modalContent(
  e: ModalEngagement,
  fields: Fields,
  blocks: BlocksOptions,
  focus: string | null,
): RawHtml {
  const slides = e.modal.slides;
  const current = currentIndex(focus, 'modal.slides', slides.length);
  const thumbs = slides.map((slide, i) =>
    listThumb({
      number: i + 1,
      title: itemTitle(slide.blocks, 'Untitled'),
      picture: slidePicture(slide.blocks),
      panel: `en-modal.slides.${i}`,
      path: `modal.slides.${i}`,
      current: i === current,
      label: `Slide ${i + 1}: ${itemTitle(slide.blocks, 'untitled')}`,
    }),
  );
  return html`${card(
    {
      icon: 'layers',
      tone: 'peach',
      title: 'Slides',
      id: 'en-slides',
      meta:
        slides.length < 10
          ? opButton('Add slide', 'add-slide|modal.slides')
          : html`<span>Ten is the most</span>`,
    },
    list({ label: 'Slides', rows: thumbs, thumbs: true, reorder: 'move|{from}|{to}' }),
    pathError(fields, 'modal.slides'),
  )}${panels(
    slides.map((slide, i) => ({
      id: `en-modal.slides.${i}`,
      current: i === current,
      body: card(
        {
          icon: 'popup',
          tone: 'peach',
          title: `Slide ${i + 1} of ${slides.length}`,
          meta: tools('slide', `modal.slides.${i}`, i, slides.length, 1, true),
          attrs: html` data-slide-index="${i}"`,
        },
        blocksEditor(`modal.slides.${i}.blocks`, slide.blocks, {
          ...blocks,
          hasNext: i < slides.length - 1 || slides.length > 1,
        }),
      ),
    })),
  )}`;
}

/* ----------------------------------------------------------------- tour */

function tourContent(
  e: TourEngagement,
  fields: Fields,
  blocks: BlocksOptions,
  focus: string | null,
): RawHtml {
  const steps = e.tour.steps;
  const current = currentIndex(focus, 'tour.steps', steps.length);
  const rows = steps.map((step, i) =>
    listRow({
      number: i + 1,
      title: itemTitle(step.blocks, `Step ${i + 1}`),
      panel: `en-tour.steps.${i}`,
      path: `tour.steps.${i}`,
      current: i === current,
      trail: [
        mediaTag(step.blocks),
        step.target ? chip(step.target, 'mono') : chip('Centred card', 'type'),
      ].filter((x): x is RawHtml => x !== null),
    }),
  );
  return html`${card(
    {
      icon: 'route',
      tone: 'mint',
      title: 'Steps',
      id: 'en-steps',
      meta: steps.length < 30 ? opButton('Add step', 'add-step|tour.steps') : null,
    },
    steps.length > 0
      ? list({ label: 'Steps', rows, reorder: 'move|{from}|{to}' })
      : html`<p class="ek-field__hint">No steps yet. Add the first one: it can point at an element, or sit in the middle of the screen.</p>`,
    pathError(fields, 'tour.steps'),
  )}${panels(
    steps.map((step, i) => {
      const at = `tour.steps.${i}`;
      return {
        id: `en-${at}`,
        current: i === current,
        body: card(
          {
            icon: 'route',
            tone: 'mint',
            title: html`Step ${i + 1} · ${itemTitle(step.blocks, 'untitled')}`,
            meta: tools('step', at, i, steps.length, 0),
            attrs: html` data-step-index="${i}"`,
          },
          html`<div class="ek-grid">
            ${textBox(fields, 'Points at', `${at}.target`, step.target, {
              placeholder: '#main-nav',
              mono: true,
              icon: 'crosshair',
              hint: 'A CSS selector. Empty: a card in the middle of the screen.',
            })}
            ${textBox(fields, 'Only on page', `${at}.page`, step.page, {
              placeholder: '/settings',
              mono: true,
              icon: 'globe',
              hint: 'Optional. On other pages the tour waits instead of skipping.',
            })}
          </div>`,
          blocksEditor(`${at}.blocks`, step.blocks, { ...blocks, hasNext: true }),
          html`<div class="eg-look-row eg-look-row--wrap">
            ${segmented(fields, 'This step’s tooltip', `${at}.placement`, step.placement, [
              { value: 'tour', label: 'Same as tour' },
              ...SIDES.filter((s) => s.value !== 'auto'),
              ...(step.placement === 'auto' ? [{ value: 'auto', label: 'Auto' }] : []),
            ])}
            ${segmented(
              fields,
              'Moves on when',
              `${at}.advance`,
              step.advance,
              [
                { value: 'next', label: 'Next button' },
                { value: 'click', label: 'They click it' },
                { value: 'url', label: 'They reach a page' },
              ],
              { rerender: true },
            )}
          </div>`,
          step.advance === 'url'
            ? textBox(fields, 'Page that moves it on', `${at}.url`, step.url, {
                placeholder: '/projects/**',
                mono: true,
                hint: 'A path pattern. The tour carries on there.',
              })
            : hidden(`${at}.url`, step.url),
        ),
      };
    }),
  )}`;
}

/* --------------------------------------------------------------- survey */

const QUESTION_KINDS: {
  value: SurveyQuestion['kind'];
  label: string;
  short: string;
  icon: KitIconName;
}[] = [
  { value: 'nps', label: 'NPS 0–10', short: 'NPS', icon: 'gauge' },
  { value: 'csat', label: 'CSAT 1–5', short: 'CSAT', icon: 'smile' },
  { value: 'stars', label: 'Stars', short: 'Stars', icon: 'star' },
  { value: 'single', label: 'Single choice', short: 'Single', icon: 'circle-dot' },
  { value: 'multi', label: 'Multiple choice', short: 'Multiple', icon: 'list-check' },
  { value: 'text', label: 'Short text', short: 'Text', icon: 'text' },
];

function kindOf(kind: SurveyQuestion['kind']) {
  return QUESTION_KINDS.find((k) => k.value === kind) ?? QUESTION_KINDS[0]!;
}

function branchLabel(q: SurveyQuestion, all: readonly SurveyQuestion[]): string | null {
  const first = q.branches[0];
  if (!first) return null;
  const target = first.goto === 'end' ? 'end' : `Q${all.findIndex((o) => o.id === first.goto) + 1}`;
  const when =
    first.choices.length > 0
      ? first.choices.length === 1
        ? first.choices[0]
        : `${first.choices.length} choices`
      : first.min !== null && first.max !== null
        ? `${first.min}–${first.max}`
        : first.min !== null
          ? `≥ ${first.min}`
          : first.max !== null
            ? `≤ ${first.max}`
            : 'any';
  const more = q.branches.length > 1 ? ` +${q.branches.length - 1}` : '';
  return `${when} → ${target}${more}`;
}

function surveyContent(
  e: SurveyEngagement,
  fields: Fields,
  blocks: BlocksOptions,
  focus: string | null,
): RawHtml {
  const s = e.survey;
  const current = currentIndex(focus, 'survey.questions', s.questions.length);
  const rows = s.questions.map((q, i) => {
    const kind = kindOf(q.kind);
    const branch = branchLabel(q, s.questions);
    return listRow({
      number: i + 1,
      title: q.prompt || 'No question written yet',
      panel: `en-survey.questions.${i}`,
      path: `survey.questions.${i}`,
      current: i === current,
      light: true,
      lead: [chip(kind.label, 'kind', kind.icon)],
      trail: branch ? [chip(branch, 'warn', 'split')] : [],
    });
  });
  const thanks = itemTitle(s.thankYou, 'Thank you.');
  rows.push(
    html`<a class="ek-lrow ek-lrow--light" href="#en-thanks"><span class="ek-grip" aria-hidden="true" style="visibility:hidden">${raw(
      kitIcon('grip', 12, 2),
    )}</span><span class="ek-num">${raw(kitIcon('check', 11, 2.4))}</span>${chip('Thank-you', 'kind', 'party')}<span class="ek-lrow__title">${thanks}</span></a>`,
  );
  const add = popover({
    trigger: html`${raw(kitIcon('plus', 12, 2))}<span>Add question</span>`,
    triggerClass: 'ek-mini ek-mini--accent',
    align: 'end',
    body: menu(
      QUESTION_KINDS.map((k) => ({
        label: k.label,
        icon: k.icon,
        name: 'op',
        value: `add-question|survey.questions|${k.value}`,
      })),
    ),
  });
  const introBlocks = {
    ...blocks,
    only: ['text', 'image', 'gif', 'video', 'divider'] as const,
    hasNext: false,
  };
  return html`${card(
    {
      icon: 'list',
      tone: 'blue',
      title: 'Questions',
      id: 'en-questions',
      meta: s.questions.length < 20 ? add : null,
    },
    list({ label: 'Questions', rows, reorder: 'move|{from}|{to}' }),
    pathError(fields, 'survey.questions'),
    html`<p class="ek-field__hint">Types: NPS 0–10, CSAT 1–5, stars, single or multiple choice, short text. Each answer is saved as it is given; branches only go forward, so every survey ends.</p>`,
  )}${panels(
    s.questions.map((q, i) => ({
      id: `en-survey.questions.${i}`,
      current: i === current,
      body: questionEditor(q, i, s.questions, fields),
    })),
  )}${card(
    {
      icon: 'party',
      tone: 'blue',
      title: 'Thank-you screen',
      id: 'en-thanks',
      meta: 'Shown when it ends, for a few seconds',
    },
    blocksEditor('survey.thankYou', s.thankYou, { ...blocks, hasNext: false }),
  )}${card(
    {
      icon: 'message',
      tone: 'blue',
      title: 'Before the first question',
      id: 'en-intro',
      meta: 'Optional',
    },
    blocksEditor('survey.intro', s.intro, introBlocks),
  )}`;
}

function questionEditor(
  q: SurveyQuestion,
  i: number,
  all: readonly SurveyQuestion[],
  fields: Fields,
): RawHtml {
  const at = `survey.questions.${i}`;
  const kind = kindOf(q.kind);
  const scale = q.kind === 'nps' || q.kind === 'csat' || q.kind === 'stars';
  const choiceKind = q.kind === 'single' || q.kind === 'multi';
  const later = all.slice(i + 1);
  const gotoOptions = [
    ...later.map((l) => ({
      value: l.id,
      label: `Q${all.indexOf(l) + 1} · ${l.prompt || l.id}`.slice(0, 70),
    })),
    { value: 'end', label: 'The end' },
  ];
  const [low, high] = q.kind === 'nps' ? [0, 10] : [1, 5];

  return card(
    {
      icon: kind.icon,
      tone: 'blue',
      title: `Question ${i + 1} · ${kind.label}`,
      meta: tools('question', at, i, all.length, 1),
    },
    segmented(
      fields,
      'Kind',
      `${at}.kind`,
      q.kind,
      QUESTION_KINDS.map((k) => ({ value: k.value, label: k.short })),
      { rerender: true, inline: true },
    ),
    textBox(fields, 'Question', `${at}.prompt`, q.prompt, {
      maxlength: 500,
      placeholder: 'How likely are you to recommend us?',
    }),
    choiceKind
      ? linesBox(fields, 'Choices', `${at}.choices`, q.choices, { rows: 4, hint: 'One per line.' })
      : null,
    q.kind === 'text'
      ? textBox(fields, 'Placeholder', `${at}.placeholder`, q.placeholder, {
          placeholder: 'Tell us anything',
        })
      : null,
    scale && q.kind !== 'stars'
      ? html`<div class="ek-grid">
      ${textBox(fields, `Label under ${low}`, `${at}.lowLabel`, q.lowLabel, { placeholder: q.kind === 'nps' ? 'Not likely' : 'Poor' })}
      ${textBox(fields, `Label under ${high}`, `${at}.highLabel`, q.highLabel, { placeholder: q.kind === 'nps' ? 'Very likely' : 'Great' })}
    </div>`
      : null,
    html`<div class="ek-toggles">${checkBox(fields, 'Must be answered', `${at}.required`, q.required, 'Otherwise there is a Skip button.')}${
      q.kind === 'text'
        ? null
        : checkBox(fields, 'Ask a follow-up comment', `${at}.followUp.enabled`, q.followUp.enabled)
    }</div>`,
    q.kind === 'text'
      ? null
      : html`<div class="eg-followup">
      ${segmented(
        fields,
        'Ask it of',
        `${at}.followUp.when`,
        q.followUp.when,
        [
          { value: 'detractors', label: 'Low scores only' },
          { value: 'always', label: 'Everyone' },
        ],
        { inline: true },
      )}
      ${textBox(fields, 'Follow-up question', `${at}.followUp.prompt`, q.followUp.prompt, { maxlength: 300 })}
    </div>`,
    q.kind === 'text'
      ? null
      : field(
          { label: 'Branching', as: 'group', hint: 'The first rule that matches wins.' },
          html`<div class="ek-rows">${join(
            q.branches.map((b, j) => {
              const bt = `${at}.branches.${j}`;
              const problem = errorOf(fields, bt);
              const arrow = html`<span class="eg-arrow" aria-hidden="true">${raw(kitIcon('arrow-r', 14, 2))}</span>`;
              const condition = scale
                ? html`<span class="ek-pill" aria-hidden="true">${raw(kitIcon(kind.icon, 13))}Score</span>${pillNumber(
                    fields,
                    `${bt}.min`,
                    b.min,
                    { label: `Rule ${j + 1}: lowest score`, min: low, max: high },
                  )}<span class="ek-pill ek-pill--op">to</span>${pillNumber(
                    fields,
                    `${bt}.max`,
                    b.max,
                    {
                      label: `Rule ${j + 1}: highest score`,
                      min: low,
                      max: high,
                    },
                  )}`
                : html`<input type="hidden" name="${bt}.choices:arr" value="">${choiceChips({
                    name: `${bt}.choices:arr`,
                    type: 'checkbox',
                    values: b.choices,
                    label: `Rule ${j + 1}: answers`,
                    choices: q.choices.map((c) => ({ value: c, label: c })),
                  })}`;
              return html`<div class="eg-branch${problem ? ' ek-field' : ''}" id="en-${bt}"${problem ? raw(' data-invalid="true"') : null}>${filterRow(
                'if',
                condition,
                arrow,
                pillChoice(fields, `Rule ${j + 1}: go to`, `${bt}.goto`, b.goto, gotoOptions, {
                  look: 'pill-val',
                }),
                opButton(`Remove rule ${j + 1}`, `remove|${bt}`, {
                  glyph: 'remove',
                  tone: 'danger',
                }),
              )}${pathError(fields, `${bt}.min`)}${pathError(fields, `${bt}.max`)}${pathError(fields, `${bt}.goto`)}${
                problem ? html`<span class="ek-field__error" role="alert">${problem}</span>` : null
              }</div>`;
            }),
          )}<span class="eg-branch-add">${opButton('Rule', `add-branch|${at}.branches`, { look: 'link' })}</span></div>`,
        ),
    html`<div class="ek-grid">
      ${choice(fields, 'Otherwise, go to', `${at}.next`, q.next, [
        { value: '', label: later.length > 0 ? 'The next question' : 'The end' },
        ...gotoOptions,
      ])}
      ${field(
        {
          label: 'Saved as',
          hint: 'Answers are stored against it.',
          error: errorOf(fields, `${at}.id`),
        },
        textInput({
          name: `${at}.id`,
          value: shown(fields, `${at}.id`, q.id),
          maxlength: 40,
          mono: true,
        }),
      )}
    </div>`,
  );
}
