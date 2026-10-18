/**
 * How it looks and where it sits, for the whole engagement: the second thing
 * decided, after the kind. What belongs to one slide, step or question stays
 * in that item's own editor.
 *
 * Tiles carry small drawings of what each choice looks like (the design's
 * layout sketches, banner positions and swatches), and on/off settings are
 * switches. A banner's two placement settings, top or bottom and inline or
 * floating, are chosen together from four tiles; the form posts the pair as
 * one value, which draft.ts splits back into the two fields. A banner can
 * also scroll away rather than stay in view, and count down to a date.
 */

import type { Engagement } from '@helpwell/core/repos';
import { html, type RawHtml } from '@helpwell/ui';
import { card } from '../editor-kit/index.js';
import {
  checkBox,
  type Fields,
  hidden,
  numberInput,
  pillChoice,
  row,
  segmented,
  shown,
  tiles,
} from './fields.js';
import { isoToZoned } from './form.js';
import { bannerPosition, bannerTone, beacon, modalLayout } from './sketches.js';

export const SIDES = [
  { value: 'auto', label: 'Auto' },
  { value: 'top', label: 'Above' },
  { value: 'bottom', label: 'Below' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

export function lookCard(
  e: Engagement,
  fields: Fields,
  options: { timeZone?: string } = {},
): RawHtml {
  switch (e.kind) {
    case 'modal':
      return card(
        { icon: 'layout', tone: 'peach', title: 'Layout and size', id: 'en-look' },
        tiles(
          fields,
          'Layout',
          'modal.mediaPosition',
          e.modal.mediaPosition,
          [
            { value: 'top', label: 'Media on top', sketch: modalLayout('top') },
            { value: 'side', label: 'Side by side', sketch: modalLayout('side') },
            { value: 'background', label: 'Full-bleed', sketch: modalLayout('background') },
          ],
          { hideLabel: true },
        ),
        html`<div class="eg-look-row">
          ${segmented(
            fields,
            'Size',
            'modal.size',
            e.modal.size,
            [
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
              { value: 'full', label: 'Full' },
            ],
            { inline: true },
          )}
          ${segmented(
            fields,
            'Progress',
            'modal.progress',
            e.modal.progress,
            [
              { value: 'dots', label: 'Dots' },
              { value: 'bar', label: 'Bar' },
              { value: 'count', label: '2 of 4' },
            ],
            { inline: true },
          )}
        </div>`,
      );
    case 'banner': {
      const b = e.banner;
      const place = `${b.position}|${b.style}`;
      return card(
        { icon: 'banner', tone: 'butter', title: 'Placement and style', id: 'en-look' },
        tiles(
          fields,
          'Position',
          'bannerPlacement',
          shown(fields, 'bannerPlacement', place),
          [
            { value: 'top|inline', label: 'Top · inline', sketch: bannerPosition('top', false) },
            { value: 'top|floating', label: 'Top · floating', sketch: bannerPosition('top', true) },
            {
              value: 'bottom|inline',
              label: 'Bottom · inline',
              sketch: bannerPosition('bottom', false),
            },
            {
              value: 'bottom|floating',
              label: 'Bottom · floating',
              sketch: bannerPosition('bottom', true),
            },
          ],
          { aside: 'Inline pushes the page down. Floating sits over it.', columns: 4 },
        ),
        tiles(
          fields,
          'Style',
          'banner.tone',
          b.tone,
          [
            { value: 'accent', label: 'Brand', sketch: bannerTone('accent') },
            { value: 'neutral', label: 'Subtle', sketch: bannerTone('neutral') },
            { value: 'warning', label: 'Warning', sketch: bannerTone('warning') },
            {
              value: 'custom',
              label: 'Custom',
              sketch: bannerTone('custom', { background: b.background, color: b.color }),
            },
          ],
          { rerender: true, columns: 4 },
        ),
        b.tone === 'custom'
          ? html`<div class="ek-grid">
      ${colourBox(fields, 'Background', 'banner.background', b.background)}
      ${colourBox(fields, 'Text', 'banner.color', b.color)}
    </div>`
          : html`${hidden('banner.background', b.background)}${hidden('banner.color', b.color)}`,
        html`<div class="ek-toggles">${checkBox(fields, 'Dismissible', 'dismissible', e.dismissible)}${checkBox(
          fields,
          'Stays in view while scrolling',
          'banner.sticky',
          b.sticky,
          'Off, it scrolls away with the top of the page, or waits at the end of it.',
        )}</div>`,
        row(fields, ['banner.countdown.until', 'banner.countdown.onEnd'], {
          icon: 'timer',
          title: 'Countdown',
          sub: `Ticks down to a date after the text. Empty: none. In ${options.timeZone || 'UTC'}.`,
          control: html`<input class="ek-input eg-date" type="datetime-local" name="banner.countdown.until" value="${shown(
            fields,
            'banner.countdown.until',
            isoToZoned(b.countdown.until, options.timeZone),
          )}" aria-label="Count down to">${pillChoice(
            fields,
            'At zero',
            'banner.countdown.onEnd',
            b.countdown.onEnd,
            [
              { value: 'hide', label: 'Then it goes' },
              { value: 'keep', label: 'Then it stays' },
            ],
          )}`,
        }),
      );
    }
    case 'hotspot':
      return card(
        { icon: 'circle-dot', tone: 'lavender', title: 'Look and placement', id: 'en-look' },
        tiles(fields, 'Beacon', 'hotspot.beacon', e.hotspot.beacon, [
          { value: 'pulse', label: 'Pulsing ring', sketch: beacon('pulse') },
          { value: 'dot', label: 'Still dot', sketch: beacon('dot') },
          { value: 'question', label: 'Question mark', sketch: beacon('question') },
        ]),
        segmented(fields, 'Tooltip sits', 'hotspot.placement', e.hotspot.placement, SIDES, {
          inline: true,
          hint: 'Auto picks whichever side has room.',
        }),
      );
    case 'tour': {
      const t = e.tour;
      return card(
        { icon: 'layout', tone: 'mint', title: 'Look and placement', id: 'en-look' },
        segmented(fields, 'Tooltips sit', 'tour.placement', t.placement, SIDES, {
          inline: true,
          hint: 'Every step, unless the step picks its own.',
        }),
        html`<div class="ek-toggles">
      ${checkBox(fields, 'Backdrop and spotlight', 'tour.spotlight', t.spotlight)}
      ${checkBox(fields, 'Show step count', 'tour.showProgress', t.showProgress)}
      ${checkBox(fields, 'Skip button', 'tour.allowSkip', t.allowSkip)}
    </div>`,
        row(fields, ['tour.missingTarget.waitSeconds', 'tour.missingTarget.action'], {
          icon: 'hourglass',
          title: 'When a step’s element is missing',
          sub: 'Wait for it to appear, then skip the step or stop the tour',
          control: html`${numberInput(
            fields,
            'tour.missingTarget.waitSeconds',
            t.missingTarget.waitSeconds,
            {
              min: 0,
              max: 60,
              label: 'Seconds to wait',
            },
          )}<span class="eg-unit">s, then</span>${pillChoice(
            fields,
            'Then',
            'tour.missingTarget.action',
            t.missingTarget.action,
            [
              { value: 'skip', label: 'Skip that step' },
              { value: 'stop', label: 'Stop the tour' },
            ],
          )}`,
        }),
      );
    }
    case 'survey':
      return card(
        { icon: 'layout', tone: 'blue', title: 'Placement and style', id: 'en-look' },
        segmented(
          fields,
          'Shows as',
          'survey.placement',
          e.survey.placement,
          [
            { value: 'corner', label: 'Corner card' },
            { value: 'center', label: 'Centered' },
            { value: 'bar', label: 'Bottom bar' },
          ],
          { inline: true },
        ),
        segmented(
          fields,
          'Colours',
          'survey.theme',
          e.survey.theme,
          [
            { value: 'brand', label: 'Brand' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
          { inline: true, hint: 'Brand uses your accent colour for the scores and buttons.' },
        ),
      );
  }
}

/** A hex colour: a swatch you can pick from, and the hex it posts. */
function colourBox(fields: Fields, label: string, path: string, value: string): RawHtml {
  const current = shown(fields, path, value);
  const problem = fields.errors.get(path) ?? null;
  const safe = /^#[0-9a-fA-F]{6}$/.test(current) ? current : '#7A3BEB';
  return html`<label class="ek-field"${problem ? html` data-invalid="true"` : null}>
    <span class="ek-field__label">${label}</span>
    <span class="eg-colour"><input type="color" value="${safe}" aria-label="${label} colour" data-en-colour-for="${path}"><input class="ek-input ek-input--mono" type="text" name="${path}" value="${current}" placeholder="#7A3BEB"></span>
    ${problem ? html`<span class="ek-field__error" role="alert">${problem}</span>` : html`<span class="ek-field__hint">A hex colour, like #102030.</span>`}
  </label>`;
}
