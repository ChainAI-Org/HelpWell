/**
 * The form builder: one page per form, one HTML form, a live preview.
 *
 * Drawn with the editor kit (editor-kit/), as the design canvas draws the
 * message editors, in three columns, in the order the decisions are made:
 *
 *   1. The form itself: what kind it is; where it shows and how it looks;
 *      then its content (the words and media above it, its fields, what
 *      happens after), and for a giveaway, the prize and the rules.
 *   2. Who sees it, and when: the audience, the trigger, the frequency and
 *      the goal, each a one-line summary that opens its controls in place.
 *   3. The live preview, pinned, drawn by the widget's own form renderer in
 *      the placement chosen under it, with how the form is doing.
 *
 * The inputs, block editor and condition builder are the engage editor's
 * (engage/fields.ts, blocks-editor.ts, conditions.ts), themselves drawn with
 * the kit, and the page script and preview protocol are engage's too, so the
 * two editors look and behave alike. Without JavaScript it still works: Save
 * posts the form, and the add, remove and move buttons post it too and come
 * back with the draft changed.
 */

import {
  type ContactField,
  FORM_FONTS,
  FORM_TYPES,
  type Form,
  type FormDefinition,
  type FormField,
  type FormSummaryStats,
  type FormType,
  formEmbedPromptSpec,
  formPopupButtonPromptSpec,
  type SegmentSummary,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import { notice, percent } from '../components.js';
import { byMode } from '../content-mode.js';
import {
  card,
  chip,
  choiceChips,
  editorShell,
  editorTopbar,
  field,
  filterRow,
  glyph,
  type KitIconName,
  kitButton,
  kitIcon,
  segmented as kitSegmented,
  list,
  listRow,
  menu,
  panels,
  performanceCard,
  pill,
  pillInput,
  popover,
  previewPanel,
  sketch,
  summaryColumn,
  summaryRow,
  type Tone,
} from '../editor-kit/index.js';
import { type BlocksOptions, blocksEditor } from '../engage/blocks-editor.js';
import { conditionBuilder } from '../engage/conditions.js';
import {
  checkBox,
  checkGroup,
  choice,
  errorOf,
  type Fields,
  hidden,
  linesBox,
  numberBox,
  numberInput,
  opButton,
  pathError,
  pillChoice,
  row,
  segmented,
  shown,
  switchOnly,
  textArea,
  textBox,
  tiles,
} from '../engage/fields.js';
import { isoToZoned } from '../engage/form.js';
import { engagePreviewPromptSpec } from '../engage/prompts.js';
import { modalLayout } from '../engage/sketches.js';
import { TRIGGERS } from '../engage/who.js';
import type { DashboardContext } from '../layout.js';
import { setupPromptPanel } from '../setup-prompt.js';
import { FIELD_LABELS, SUCCESS_LABELS, TYPE_LABELS } from './labels.js';
import type { FormSummaries } from './summaries.js';

export interface BuilderView {
  form: Form;
  definition: FormDefinition;
  name: string;
  enabled: boolean;
  unsaved?: boolean;
  fields: Fields;
  segments: readonly SegmentSummary[];
  contactFields: readonly ContactField[];
  events: readonly string[];
  /** Other forms, for "show another form next". */
  otherForms: readonly { id: string; name: string }[];
  tours: readonly { id: string; name: string }[];
  /** Whether the widget's Home tab has a block for this form. */
  onHome: boolean;
  audienceCount: number | null;
  stats: FormSummaryStats | null;
  summaries: FormSummaries;
  /** The shared cap on interruptions, in words ("at most 1 per visit"). */
  limitsText: string;
  flash?: RawHtml | null;
  focus?: string | null;
  preview: { placement: string; state: string };
  /** The site the preview's address bar names, e.g. app.example.com. */
  siteHost?: string;
}

/* ------------------------------------------------------------- the words */

export const TYPE_LOOK: Record<FormType, { icon: KitIconName; tone: Tone }> = {
  newsletter: { icon: 'at', tone: 'lavender' },
  lead_magnet: { icon: 'text', tone: 'peach' },
  coupon: { icon: 'sparkles', tone: 'butter' },
  giveaway: { icon: 'party', tone: 'peach' },
  waitlist: { icon: 'hourglass', tone: 'blue' },
  webinar: { icon: 'monitor', tone: 'mint' },
  feedback: { icon: 'smile', tone: 'blue' },
  exit_offer: { icon: 'door', tone: 'butter' },
  custom: { icon: 'pen', tone: 'lavender' },
};

const TYPE_HINTS: Record<FormType, string> = {
  newsletter: 'An email address, and a thank-you.',
  lead_magnet: 'A guide or file in return for an email, by a signed link.',
  coupon: 'A discount code, shown once the address is accepted.',
  giveaway: 'Entries, share links for bonus entries, and a fair draw.',
  waitlist: 'A place in the queue for something not out yet.',
  webinar: 'A seat at an event.',
  feedback: 'A question or two, and an address to reply to.',
  exit_offer: 'One last offer as they go to leave.',
  custom: 'Start from an email field and build the rest.',
};

const FIELD_ICONS: Record<string, KitIconName> = {
  email: 'at',
  name: 'user',
  first_name: 'user',
  last_name: 'user',
  phone: 'phone',
  company: 'layers',
  text: 'text',
  textarea: 'list',
  number: 'gauge',
  date: 'calendar',
  dropdown: 'chev-d',
  radio: 'circle-dot',
  checkbox: 'check',
  hidden: 'eye',
  consent: 'lock',
};

const TRIGGER_ICONS = Object.fromEntries(TRIGGERS.map((t) => [t.value, t.icon])) as Record<
  FormDefinition['trigger']['type'],
  KitIconName
>;

/** Which rules section holds a field, so a problem opens the right one. */
function sectionOf(path: string): 'audience' | 'trigger' | 'frequency' | null {
  if (path.startsWith('targeting')) return 'audience';
  if (path.startsWith('trigger')) return 'trigger';
  if (path.startsWith('schedule') || path.startsWith('frequency') || path === 'priority') {
    return 'frequency';
  }
  return null;
}

/* ------------------------------------------------------------ the header */

/** The top bar: ← Forms › **Name** [Live] ● Saved. For the page header's `lead`. */
export function builderTopbar(
  context: DashboardContext,
  form: Form,
  options: { name: string; enabled: boolean; unsaved: boolean; saved: string | null },
): RawHtml {
  const base = `${context.basePath}/forms`;
  return editorTopbar({
    back: { href: base, label: 'All forms' },
    crumbs: [{ label: 'Forms', href: base }],
    title: options.name || form.id,
    state: options.enabled ? { label: 'Live', tone: 'good' } : { label: 'Off', tone: 'neutral' },
    note: options.unsaved
      ? { text: 'Not saved yet.', tone: 'warn' }
      : {
          text:
            options.saved === 'paused'
              ? 'Switched off. It shows nowhere until it is live again.'
              : options.saved === 'live'
                ? 'Live for new page views now.'
                : options.saved
                  ? 'Saved just now'
                  : `Version ${form.version} · all changes saved`,
          tone: 'good',
          dirty: 'Unsaved changes',
        },
  });
}

/** The header's buttons, outside the form they submit: test it, switch it on or off, save. */
export function builderActions(form: Form, enabled: boolean): RawHtml {
  const code = `window.helpwell?.forms?.show('${form.id}')`;
  const test = popover({
    trigger: html`${raw(kitIcon('external', 14))}<span>Test on my site</span>`,
    triggerClass: 'ek-btn ek-btn--secondary',
    align: 'end',
    body: html`<p class="ek-pop__title">See it on your site</p>
      <p class="ek-pop__text">Open a page with the HelpWell script in another tab and run this in the browser console. It opens as a pop-up straight away, whatever its trigger.</p>
      <pre class="ek-pop__code" id="fb-test-code">${code}</pre>
      <div class="ek-pop__row"><button type="button" class="ek-mini" data-copy="fb-test-code">${raw(kitIcon('copy', 12, 2))}<span>Copy</span></button></div>
      <p class="ek-pop__text">It has to be saved and live. A submission from the test counts in the results, so use an address you own.</p>`,
  });
  // Results are a click away in the preview column (Full report) and under Goal.
  return html`${test}${kitButton({
    label: enabled ? 'Switch off' : 'Go live',
    icon: enabled ? 'pause' : 'play',
    look: 'secondary',
    form: 'en-editor',
    name: 'action',
    value: enabled ? 'pause' : 'resume',
  })}${kitButton({ label: 'Save changes', look: 'primary', form: 'en-editor', name: 'action', value: 'save' })}`;
}

/* ---------------------------------------------------------------- page */

export function builderPage(context: DashboardContext, view: BuilderView): RawHtml {
  const { form, definition: d, fields } = view;
  const base = `${context.basePath}/forms`;
  const problems = fields.errors.size;
  const open = new Set(
    [...fields.errors.keys(), view.focus ?? ''].map(sectionOf).filter((s) => s !== null),
  );
  const blocks: BlocksOptions = {
    fields,
    canUpload: true,
    tours: view.tours,
    hasNext: false,
    ai: {
      url: `${base}/_write`,
      context: `An email sign-up form (${TYPE_LABELS[d.type].toLowerCase()}) on ${context.productName || 'the product'}'s website.`,
    },
  };

  const main = html`${view.flash ?? null}${
    problems > 0
      ? notice(
          'bad',
          `${problems === 1 ? 'One thing needs' : `${problems} things need`} fixing before this can be saved. Each is marked below.`,
        )
      : null
  }
  ${typeTiles(d.type)}
  ${placementCard(context, view)}
  ${lookCard(view)}
  ${contentCard(view, blocks)}
  ${fieldsCards(view)}
  ${successCard(view, blocks, `${base}/_upload`)}
  ${d.type === 'giveaway' ? giveawayCard(context, view) : null}
  ${variantsCard(view, blocks)}
  ${abuseCard(context, view)}
  ${detailsCard(view)}
  ${installCard(context, view)}
  <p class="ek-foot">Each save is a new version. <a href="${base}/${encodeURIComponent(form.id)}/export">Export it as JSON</a> to keep ${byMode(context, 'it in your repo', 'a copy')}.</p>`;

  const side = summaryColumn({
    title: 'Who sees it, and when',
    hint: 'Open one to change it',
    rows: [
      summaryRow({
        key: 'audience',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'users',
        tone: 'mint',
        title: 'Audience',
        meta:
          view.audienceCount === null
            ? d.targeting.audience === 'all'
              ? 'every visitor'
              : null
            : `${view.audienceCount.toLocaleString('en')} match now`,
        summary: view.summaries.audience,
        open: open.has('audience'),
        body: audienceControls(view),
      }),
      summaryRow({
        key: 'trigger',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'zap',
        tone: 'butter',
        title: 'Trigger',
        meta:
          d.placements.display === 'none'
            ? 'only for a pop-up'
            : d.trigger.type === 'event' || d.trigger.type === 'manual'
              ? 'needs a line of code'
              : 'no code needed',
        summary: view.summaries.trigger,
        open: open.has('trigger'),
        body: triggerControls(context, view),
      }),
      summaryRow({
        key: 'frequency',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'calendar',
        tone: 'blue',
        title: 'Frequency',
        openTitle: 'Frequency and timing',
        meta: view.limitsText,
        summary: view.summaries.frequency,
        open: open.has('frequency'),
        body: frequencyControls(context, view),
      }),
      summaryRow({
        key: 'goal',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'target',
        tone: 'mint',
        title: 'Goal',
        meta:
          view.stats?.conversionRate != null
            ? `${percent(view.stats.conversionRate, 1)} converted`
            : null,
        summary: view.summaries.goal,
        open: false,
        body: html`<p class="ek-field__hint">A trusted submission is the goal: one that passed every check, from someone who saw the form. Rejected and repeat submissions do not count, and neither do throwaway addresses.</p>
          <p><a class="ek-mini" href="${base}/${encodeURIComponent(form.id)}/results">${raw(kitIcon('activity', 12, 2))}<span>See the results</span></a></p>`,
      }),
    ],
    foot: 'Anything left closed keeps its setting. The trigger and the pages apply when it pops up; an embed shows wherever you put it, to the audience above.',
  });

  const firstPage = d.targeting.pages.include.find((p) => !p.includes('*')) ?? '/';
  const preview = previewPanel({
    subtitle: shortAudience(d),
    url: `${view.siteHost || 'your-site.example'}${firstPage === '/' ? '' : firstPage}`,
    frame: { src: `${base}/_preview`, title: 'Live preview of this form' },
    caption: {
      icon: d.placements.display === 'none' ? 'layout' : TRIGGER_ICONS[d.trigger.type],
      text: view.summaries.moment,
      summaryKey: 'moment',
    },
    replay: true,
    emptyText: 'Add a field or some text and the form appears here, as visitors will see it.',
    below: html`<div class="fb-preview-controls" data-ek-ignore>
        ${field(
          { label: 'Show it as', as: 'group', inline: true },
          kitSegmented({
            name: 'preview.placement',
            value: view.preview.placement,
            choices: previewPlacements(d),
            label: 'Show it as',
          }),
        )}
        ${field(
          { label: 'Showing', as: 'group', inline: true },
          kitSegmented({
            name: 'preview.state',
            value: view.preview.state,
            choices: [
              { value: 'form', label: 'The form' },
              { value: 'done', label: 'After submitting' },
            ],
            label: 'Showing',
          }),
        )}
      </div>
      <p class="ek-preview__status" id="en-preview-status" role="status"></p>
      <div id="en-preview-missing" class="fb-missing" hidden>
        ${notice(
          'warn',
          'The preview could not load the form renderer. The API needs to serve the widget files, and the widget needs to be built.',
        )}
        ${setupPromptPanel('forms-preview', engagePreviewPromptSpec({ apiPath: context.apiPath }))}
      </div>
      <noscript><p class="ek-field__hint">The live preview needs JavaScript. Everything else here works without it.</p></noscript>
      ${performance(context, form, view.stats)}`,
  });

  return html`<form method="post" action="${base}/${encodeURIComponent(form.id)}" id="en-editor" class="ek-editor fb-editor"
      ${view.unsaved ? raw('data-helpwell-dirty') : null}
      data-draft="${base}/_draft" data-ek-upload-url="${base}/_upload" data-accent="${context.accent}"${
        view.focus ? html` data-focus="en-${view.focus}"` : null
      }>
  ${hidden('id', form.id)}
  <input type="hidden" name="expectedVersion:num" value="${form.version}">
  ${editorShell({ basePath: context.basePath, main, side, preview })}
</form>`;
}

function previewPlacements(d: FormDefinition): { value: string; label: string }[] {
  const out = [
    { value: 'inline', label: 'Embedded' },
    { value: 'home', label: 'Home tab' },
  ];
  if (d.placements.display !== 'none') {
    const names = {
      popup: 'Pop-up',
      slidein: 'Slide-in',
      bar: 'Bar',
      welcome: 'Welcome mat',
    } as const;
    out.unshift({ value: d.placements.display, label: names[d.placements.display] });
  }
  if (d.placements.twoStep.enabled) out.push({ value: 'button', label: 'Two-step' });
  return out;
}

function shortAudience(d: FormDefinition): string {
  const who = {
    all: 'Any visitor',
    identified: 'A signed-in visitor',
    anonymous: 'An anonymous visitor',
  }[d.targeting.audience];
  const device = d.targeting.devices.length === 1 ? ` · ${d.targeting.devices[0]}` : '';
  const source = d.targeting.utm.source[0] ? ` · ${d.targeting.utm.source[0]}` : '';
  return `${who}${device}${source}`;
}

function performance(
  context: DashboardContext,
  form: Form,
  stats: FormSummaryStats | null,
): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  const views = stats?.views ?? 0;
  const uniques = stats?.uniques ?? 0;
  const trusted = stats?.trusted ?? 0;
  return performanceCard({
    label: 'Performance · last 30 days',
    link: { href: `${base}/results`, label: 'Full report' },
    stats: [
      {
        value: views.toLocaleString('en'),
        label: 'Views',
        percent: views > 0 ? 100 : 0,
        tone: 'lavender',
      },
      {
        value: uniques.toLocaleString('en'),
        label: 'People',
        percent: views > 0 ? (uniques / views) * 100 : 0,
        tone: 'accent',
      },
      {
        value: percent(stats?.conversionRate ?? null),
        label: 'Signed up',
        percent: (stats?.conversionRate ?? 0) * 100,
        tone: 'good',
      },
    ],
    foot: {
      icon: 'user',
      text:
        trusted > 0
          ? `${trusted.toLocaleString('en')} trusted ${trusted === 1 ? 'sign-up' : 'sign-ups'}`
          : 'No trusted sign-ups yet',
      link: { href: `${base}/submissions`, label: 'Submissions' },
    },
  });
}

/* ------------------------------------------------------------ form type */

/**
 * What kind of form it is: tiles, as the engage editor's type row, but
 * radios, because a form can change kind (its fields and look stay).
 */
function typeTiles(current: FormType): RawHtml {
  return html`<div class="ek-types fb-types" role="radiogroup" aria-label="Kind of form">${join(
    FORM_TYPES.map(
      (type) =>
        html`<label class="ek-type fb-type" title="${TYPE_HINTS[type]}"><input type="radio" name="type" value="${type}"${
          type === current ? raw(' checked') : null
        } data-rerender>${glyph(TYPE_LOOK[type].icon, TYPE_LOOK[type].tone, 13)}<span>${TYPE_LABELS[type]}</span></label>`,
    ),
  )}</div>`;
}

/** A label over the controls after it, for a card made of several parts. */
function subhead(
  label: string,
  options: { hint?: string | null; aside?: RawHtml | null } = {},
): RawHtml {
  return html`<div class="fb-subhead"><span class="ek-field__head"><span class="ek-field__label">${label}</span>${
    options.aside ? html`<span class="ek-field__aside">${options.aside}</span>` : null
  }</span>${options.hint ? html`<span class="ek-field__hint">${options.hint}</span>` : null}</div>`;
}

/* ------------------------------------------------------------ sketches */

const LINES =
  '<i class="ek-sk-line" style="left:8px;top:7px;width:44%"></i><i class="ek-sk-line" style="left:8px;top:14px;width:62%"></i><i class="ek-sk-line" style="left:8px;top:21px;width:36%"></i>';

/** Where it shows: a page, and the form on it. */
function placementSketch(kind: 'none' | 'popup' | 'slidein' | 'bar' | 'welcome'): RawHtml {
  const inner = {
    none: `${LINES}<i class="ek-sk-card" style="left:8px;right:8px;top:27px;height:9px"></i><i class="ek-sk-accent" style="right:11px;top:30px;width:16px;height:3px"></i>`,
    popup: `${LINES}<i style="inset:0;background:rgba(23,20,37,.16)"></i><i class="ek-sk-card" style="left:31%;right:31%;top:6px;bottom:6px"></i><i class="ek-sk-line" style="left:37%;right:37%;top:12px"></i><i class="ek-sk-accent" style="left:37%;right:37%;bottom:11px;height:4px"></i>`,
    slidein: `${LINES}<i class="ek-sk-card" style="right:5px;bottom:4px;width:36%;height:21px"></i><i class="ek-sk-line" style="right:12px;bottom:17px;width:22%"></i><i class="ek-sk-accent" style="right:12px;bottom:8px;width:22%;height:4px"></i>`,
    bar: `<i class="ek-sk-accent" style="left:0;right:0;top:0;height:9px;border-radius:0"></i><i class="ek-sk-card" style="right:8px;top:2px;width:18px;height:5px"></i><i class="ek-sk-line" style="left:8px;top:16px;width:44%"></i><i class="ek-sk-line" style="left:8px;top:23px;width:62%"></i><i class="ek-sk-line" style="left:8px;top:30px;width:36%"></i>`,
    welcome: `<i class="ek-sk-card" style="inset:4px"></i><i class="ek-sk-ink" style="left:34%;right:34%;top:11px;height:3px"></i><i class="ek-sk-line" style="left:28%;right:28%;top:18px"></i><i class="ek-sk-accent" style="left:38%;right:38%;top:25px;height:5px"></i>`,
  }[kind];
  return sketch(raw(inner));
}

/** Where the picture goes. Top, side and full-bleed are the engage editor's own drawings. */
function pictureSketch(where: 'none' | 'top' | 'left' | 'right' | 'background'): RawHtml {
  if (where === 'top') return modalLayout('top');
  if (where === 'left') return modalLayout('side');
  if (where === 'background') return modalLayout('background');
  const card =
    'position:absolute;inset:5px;background:var(--ek-sketch-card);border-radius:3px;box-shadow:0 1px 3px rgba(23,20,37,.12);padding:4px;display:flex;gap:4px';
  const line = 'height:3px;border-radius:2px;background:var(--ek-sketch-ink)';
  const words = `<span style="flex:1;display:flex;flex-direction:column;gap:3px;justify-content:center"><span style="${line};width:80%"></span><span style="${line};width:55%"></span><span style="height:5px;width:42%;border-radius:2px;background:var(--hw-accent)"></span></span>`;
  return sketch(
    raw(
      where === 'right'
        ? `<span style="${card}">${words}<span style="width:44%;background:var(--ek-sketch-media);border-radius:2px"></span></span>`
        : `<span style="${card}">${words}</span>`,
    ),
  );
}

/* ------------------------------------------------------------- placement */

function placementCard(context: DashboardContext, view: BuilderView): RawHtml {
  const { definition: d, fields } = view;
  const p = d.placements;
  const pops = p.display !== 'none';
  return card(
    { icon: 'popup', tone: 'lavender', title: 'Placement', id: 'en-placement' },
    tiles(
      fields,
      'Pops up as',
      'placements.display',
      p.display,
      [
        { value: 'none', label: 'Embed only', sketch: placementSketch('none') },
        { value: 'popup', label: 'Pop-up', sketch: placementSketch('popup') },
        { value: 'slidein', label: 'Slide-in', sketch: placementSketch('slidein') },
        { value: 'bar', label: 'Floating bar', sketch: placementSketch('bar') },
        { value: 'welcome', label: 'Welcome mat', sketch: placementSketch('welcome') },
      ],
      {
        rerender: true,
        columns: 5,
        aside: 'The trigger and pages under "Who sees it" decide when',
      },
    ),
    p.display === 'slidein' ||
      p.display === 'bar' ||
      p.display === 'popup' ||
      p.display === 'welcome' ||
      p.twoStep.enabled
      ? html`<div class="fb-row">
      ${
        p.display === 'slidein'
          ? segmented(
              fields,
              'Corner',
              'placements.slidein.position',
              p.slidein.position,
              [
                { value: 'bottom-right', label: 'Bottom right' },
                { value: 'bottom-left', label: 'Bottom left' },
              ],
              { inline: true },
            )
          : null
      }
      ${
        p.display === 'bar'
          ? segmented(
              fields,
              'Sits at the',
              'placements.bar.position',
              p.bar.position,
              [
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
              ],
              { inline: true },
            )
          : null
      }
      ${
        p.display === 'popup' || p.display === 'welcome' || p.twoStep.enabled
          ? field(
              {
                label: 'Page dimmed behind it',
                inline: true,
                error: errorOf(fields, 'style.overlay'),
              },
              html`<span class="ek-inline">${numberInput(fields, 'style.overlay', d.style.overlay, { min: 0, max: 90, label: 'Page dimmed (%)' })}<span class="fb-unit">%</span></span>`,
            )
          : null
      }
    </div>`
      : null,
    p.display === 'slidein' ? null : hidden('placements.slidein.position', p.slidein.position),
    p.display === 'bar' ? null : hidden('placements.bar.position', p.bar.position),
    p.display === 'popup' || p.display === 'welcome' || p.twoStep.enabled
      ? null
      : html`<input type="hidden" name="style.overlay:num" value="${d.style.overlay}">`,
    html`<div class="ek-toggles">
      ${checkBox(fields, 'Embedded on a page', 'placements.inline', p.inline, 'Wherever your page has its embed code.')}
      ${checkBox(fields, 'Two-step', 'placements.twoStep.enabled', p.twoStep.enabled, 'The embed draws a button; the form opens over the page.')}
      ${checkBox(fields, 'Close button', 'layout.closeButton', d.layout.closeButton, pops ? 'Escape always closes it.' : 'On anything that pops up.')}
    </div>`,
    p.twoStep.enabled
      ? textBox(fields, 'Button that opens it', 'placements.twoStep.label', p.twoStep.label, {
          maxlength: 60,
          inline: true,
        })
      : hidden('placements.twoStep.label', p.twoStep.label),
    html`<div class="ek-rows">${row(fields, [], {
      icon: 'message',
      title: 'Widget Home tab',
      sub: view.onHome
        ? 'This form is a block on it'
        : 'Visitors who open the chat can sign up there too',
      control: view.onHome
        ? html`<a class="ek-mini" href="${context.basePath}/settings?tab=widget">${raw(kitIcon('settings', 12, 2))}<span>Change</span></a>`
        : kitButton({
            label: 'Add it to Home',
            icon: 'plus',
            name: 'action',
            value: 'add-home',
            noValidate: true,
          }),
    })}</div>`,
  );
}

/* ------------------------------------------------------------------ look */

function lookCard(view: BuilderView): RawHtml {
  const { definition: d, fields } = view;
  const hasPicture = d.layout.imagePosition !== 'none';
  return card(
    { icon: 'layout', tone: 'lavender', title: 'Layout and style', id: 'en-look' },
    tiles(
      fields,
      'Picture',
      'layout.imagePosition',
      d.layout.imagePosition,
      [
        { value: 'none', label: 'None', sketch: pictureSketch('none') },
        { value: 'top', label: 'On top', sketch: pictureSketch('top') },
        { value: 'left', label: 'Left', sketch: pictureSketch('left') },
        { value: 'right', label: 'Right', sketch: pictureSketch('right') },
        { value: 'background', label: 'Behind', sketch: pictureSketch('background') },
      ],
      { rerender: true, columns: 5 },
    ),
    hasPicture
      ? html`<div class="ek-grid">
      ${textBox(fields, 'Picture', 'layout.image.url', d.layout.image.url, {
        placeholder: 'https://… or /images/guide.png',
        icon: 'image',
        hint: 'An https:// address, or a path on your site.',
      })}
      ${textBox(fields, 'Alt text', 'layout.image.alt', d.layout.image.alt, { maxlength: 300, hint: 'What it shows, for screen readers.' })}
    </div>`
      : html`${hidden('layout.image.url', d.layout.image.url)}${hidden('layout.image.alt', d.layout.image.alt)}`,
    html`<div class="fb-row">
      ${segmented(
        fields,
        'Fields',
        'layout.fieldLayout',
        d.layout.fieldLayout,
        [
          { value: 'stacked', label: 'Stacked' },
          { value: 'inline', label: 'One row' },
        ],
        { inline: true },
      )}
      ${segmented(
        fields,
        'Columns',
        'layout.columns:num',
        String(d.layout.columns),
        [
          { value: '1', label: 'One' },
          { value: '2', label: 'Two' },
        ],
        { inline: true },
      )}
      ${segmented(
        fields,
        'Align',
        'layout.align',
        d.layout.align,
        [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
        ],
        { inline: true },
      )}
    </div>`,
    html`<div class="fb-row">
      ${segmented(
        fields,
        'Button',
        'style.buttonStyle',
        d.style.buttonStyle,
        [
          { value: 'filled', label: 'Filled' },
          { value: 'outline', label: 'Outline' },
          { value: 'pill', label: 'Pill' },
        ],
        { inline: true },
      )}
      ${segmented(
        fields,
        'Width',
        'style.buttonWidth',
        d.style.buttonWidth,
        [
          { value: 'full', label: 'Full' },
          { value: 'auto', label: 'Fit' },
        ],
        { inline: true },
      )}
      ${segmented(
        fields,
        'Spacing',
        'style.spacing',
        d.style.spacing,
        [
          { value: 'compact', label: 'Tight' },
          { value: 'comfortable', label: 'Normal' },
          { value: 'spacious', label: 'Airy' },
        ],
        { inline: true },
      )}
    </div>`,
    html`<hr class="ek-sep">`,
    html`<div class="fb-colours">
      ${colour(fields, 'Background', 'style.background', d.style.background, '#FFFFFF')}
      ${colour(fields, 'Text', 'style.text', d.style.text, '#171425')}
      ${colour(fields, 'Button', 'style.accent', d.style.accent, 'Your accent')}
      ${colour(fields, 'Button text', 'style.buttonText', d.style.buttonText, '#FFFFFF')}
      ${colour(fields, 'Field background', 'style.fieldBackground', d.style.fieldBackground, '#FFFFFF')}
      ${colour(fields, 'Field border', 'style.fieldBorder', d.style.fieldBorder, '#E4E0EE')}
    </div>`,
    html`<div class="ek-grid">
      ${choice(
        fields,
        'Font',
        'style.font',
        d.style.font,
        FORM_FONTS.map((f) => ({ value: f, label: f === 'inherit' ? 'The page’s own' : f })),
      )}
      ${numberBox(fields, 'Corner radius (px)', 'style.radius', d.style.radius, { min: 0, max: 32 })}
      ${numberBox(fields, 'Widest (px)', 'layout.width', d.layout.width, { min: 240, max: 1200 })}
    </div>`,
    html`<div class="ek-toggles">${checkBox(fields, 'Shadow', 'style.shadow', d.style.shadow)}</div>`,
    html`<details class="ek-more"${
      d.mobile.imagePosition !== 'top' ||
      d.mobile.fieldLayout !== 'stacked' ||
      d.mobile.columns !== 'one' ||
      !d.mobile.compact ||
      !d.mobile.popupAsSheet
        ? raw(' open')
        : null
    }>
      <summary>On a phone</summary>
      <div class="ek-more__body">
        ${segmented(
          fields,
          'Picture',
          'mobile.imagePosition',
          d.mobile.imagePosition,
          [
            { value: 'top', label: 'On top' },
            { value: 'none', label: 'Hidden' },
            { value: 'same', label: 'As on desktop' },
          ],
          { inline: true },
        )}
        ${segmented(
          fields,
          'Fields',
          'mobile.fieldLayout',
          d.mobile.fieldLayout,
          [
            { value: 'stacked', label: 'Stacked' },
            { value: 'same', label: 'As on desktop' },
          ],
          { inline: true },
        )}
        ${segmented(
          fields,
          'Columns',
          'mobile.columns',
          d.mobile.columns,
          [
            { value: 'one', label: 'One' },
            { value: 'same', label: 'As on desktop' },
          ],
          { inline: true },
        )}
        <div class="ek-toggles">
          ${checkBox(fields, 'Tighter spacing, smaller headings', 'mobile.compact', d.mobile.compact)}
          ${checkBox(fields, 'Pop-up rises from the bottom', 'mobile.popupAsSheet', d.mobile.popupAsSheet)}
        </div>
        <p class="ek-field__hint">Switch the preview to Mobile to see these.</p>
      </div>
    </details>`,
  );
}

/** A colour: the picker and the hex box beside it post the same value. */
function colour(
  fields: Fields,
  label: string,
  path: string,
  value: string,
  placeholder: string,
): RawHtml {
  const current = shown(fields, path, value);
  const six = /^#[0-9a-f]{3}$/i.test(current)
    ? `#${[...current.slice(1)].map((c) => c + c).join('')}`
    : /^#[0-9a-f]{6}/i.test(current)
      ? current.slice(0, 7)
      : '#7a3beb';
  return field(
    { label, as: 'group', error: errorOf(fields, path) },
    html`<span class="fb-colour"><input type="color" value="${six}" aria-label="${label}: pick" data-colour-for="${path}"><input class="ek-input ek-input--mono" type="text" name="${path}" value="${current}" placeholder="${placeholder}" maxlength="9" aria-label="${label}"></span>`,
  );
}

/* --------------------------------------------------------------- content */

function contentCard(view: BuilderView, blocks: BlocksOptions): RawHtml {
  const { definition: d } = view;
  return card(
    {
      icon: 'text',
      tone: 'lavender',
      title: 'Content',
      id: 'en-content',
      meta: 'Above the fields, and under the button',
    },
    subhead('Above the fields'),
    blocksEditor('content.blocks', d.content.blocks, {
      ...blocks,
      only: ['text', 'image', 'gif', 'video', 'divider'],
    }),
    html`<hr class="ek-sep">`,
    subhead('Under the button', {
      hint: 'Small print: what they are signing up for, a privacy link.',
    }),
    blocksEditor('content.footer', d.content.footer, {
      ...blocks,
      only: ['text', 'divider'],
      ai: null,
    }),
  );
}

/* ---------------------------------------------------------------- fields */

const ADDABLE = [
  'name',
  'first_name',
  'last_name',
  'phone',
  'company',
  'text',
  'textarea',
  'number',
  'date',
  'dropdown',
  'radio',
  'checkbox',
  'hidden',
  'consent',
];

function fieldTitle(f: FormField): string {
  if (f.kind === 'hidden')
    return f.capture ? `Captures ${f.capture.replace('_', ' ')}` : `Fixed: ${f.value || f.id}`;
  const text = (f.label || f.placeholder || FIELD_LABELS[f.kind] || f.kind).replace(
    /\[([^\]]*)\]\([^)]*\)/g,
    '$1',
  );
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function currentField(focus: string | null | undefined, count: number): number {
  if (!focus?.startsWith('fields.')) return 0;
  const index = Number(focus.split('.')[1]);
  return Number.isInteger(index) && index >= 0 && index < count ? index : 0;
}

function fieldsCards(view: BuilderView): RawHtml {
  const { definition: d, fields } = view;
  const current = currentField(view.focus, d.fields.length);
  const add =
    d.fields.length < 30
      ? popover({
          trigger: html`${raw(kitIcon('plus', 13, 2))}<span>Add field</span>`,
          triggerClass: 'ek-addlink',
          align: 'end',
          label: 'Add a field',
          body: menu(
            ADDABLE.map((kind) => ({
              label: FIELD_LABELS[kind] ?? kind,
              icon: FIELD_ICONS[kind],
              name: 'op',
              value: `add-field|fields|${kind}`,
            })),
          ),
        })
      : html`<span>Thirty is the most</span>`;
  const rows = d.fields.map((f, i) =>
    listRow({
      number: i + 1,
      title: fieldTitle(f),
      panel: `en-fields.${i}`,
      path: `fields.${i}`,
      current: i === current,
      light: f.kind === 'consent',
      lead: [chip(FIELD_LABELS[f.kind] ?? f.kind, 'kind', FIELD_ICONS[f.kind])],
      trail: [
        f.required || f.kind === 'email' ? chip('Required', 'tag') : null,
        f.width === 'half' ? chip('Half', 'type') : null,
        errorOf(fields, `fields.${i}`) ||
        [...fields.errors.keys()].some((k) => k.startsWith(`fields.${i}.`))
          ? chip('Needs fixing', 'warn', 'alert')
          : null,
      ].filter((x): x is RawHtml => x !== null),
    }),
  );
  return html`${card(
    { icon: 'list-check', tone: 'lavender', title: 'Fields', id: 'en-fields', meta: add },
    list({ label: 'Fields', rows, reorder: 'move|{from}|{to}' }),
    pathError(fields, 'fields'),
    textBox(fields, 'Button', 'style.buttonLabel', d.style.buttonLabel, {
      maxlength: 60,
      inline: true,
    }),
  )}${panels(
    d.fields.map((f, i) => ({
      id: `en-fields.${i}`,
      current: i === current,
      body: card(
        {
          icon: FIELD_ICONS[f.kind] ?? 'text',
          tone: 'lavender',
          title: `Field ${i + 1} of ${d.fields.length} · ${FIELD_LABELS[f.kind] ?? f.kind}`,
          meta: html`${i > 0 ? opButton('Move this field up', `up|fields.${i}`, { glyph: 'up' }) : null}${
            i < d.fields.length - 1
              ? opButton('Move this field down', `down|fields.${i}`, { glyph: 'down' })
              : null
          }${f.kind === 'email' ? null : opButton('Remove this field', `remove|fields.${i}`, { glyph: 'remove', tone: 'danger' })}`,
        },
        fieldEditor(view, f, i),
      ),
    })),
  )}`;
}

function fieldEditor(view: BuilderView, f: FormField, i: number): RawHtml {
  const { fields } = view;
  const at = `fields.${i}`;
  const choices = f.kind === 'dropdown' || f.kind === 'radio' || f.kind === 'checkbox';
  const attributes = view.contactFields.filter((c) => !c.builtin);
  return html`${hidden(`${at}.kind`, f.kind)}
  ${
    f.kind === 'consent'
      ? textArea(fields, 'What they agree to', `${at}.label`, f.label, {
          rows: 2,
          hint: 'Markdown links work, e.g. [privacy policy](/privacy). Kept with each submission, word for word.',
        })
      : f.kind === 'hidden'
        ? hidden(`${at}.label`, f.label)
        : html`<div class="ek-grid">
      ${textBox(fields, 'Label', `${at}.label`, f.label, { maxlength: 200 })}
      ${choices ? hidden(`${at}.placeholder`, f.placeholder) : textBox(fields, 'Placeholder', `${at}.placeholder`, f.placeholder, { maxlength: 200 })}
    </div>`
  }
  ${f.kind === 'consent' || f.kind === 'hidden' ? hidden(`${at}.placeholder`, f.placeholder) : null}
  ${
    choices
      ? linesBox(
          fields,
          f.kind === 'checkbox' ? 'Choices' : 'Choices',
          `${at}.options`,
          f.options,
          {
            rows: 3,
            hint:
              f.kind === 'checkbox' ? 'One per line. None: a single box to tick.' : 'One per line.',
          },
        )
      : null
  }
  ${
    f.kind === 'hidden'
      ? html`<div class="ek-grid">
      ${choice(fields, 'Fill it with', `${at}.capture`, f.capture, [
        { value: '', label: 'A fixed value' },
        { value: 'utm_source', label: 'UTM source' },
        { value: 'utm_medium', label: 'UTM medium' },
        { value: 'utm_campaign', label: 'UTM campaign' },
        { value: 'utm_term', label: 'UTM term' },
        { value: 'utm_content', label: 'UTM content' },
        { value: 'referrer', label: 'Where they came from' },
        { value: 'page', label: 'The page address' },
        { value: 'param', label: 'A query parameter' },
      ])}
      ${textBox(fields, 'Value', `${at}.value`, f.value, { hint: 'Fixed, or used when there is nothing to capture.' })}
      ${textBox(fields, 'Query parameter', `${at}.param`, f.param, { placeholder: 'plan', mono: true })}
    </div>`
      : html`${hidden(`${at}.capture`, f.capture)}${hidden(`${at}.value`, f.value)}${hidden(`${at}.param`, f.param)}`
  }
  ${
    f.kind === 'hidden'
      ? null
      : html`<div class="fb-row">
      ${
        f.kind === 'email'
          ? html`<input type="hidden" name="${at}.required:bool" value="true"><span class="ek-field__hint">Always required: it is how a sign-up reaches you.</span>`
          : html`<div class="ek-toggles">${checkBox(fields, 'Required', `${at}.required`, f.required)}</div>`
      }
      ${segmented(
        fields,
        'Width',
        `${at}.width`,
        f.width,
        [
          { value: 'full', label: 'Full' },
          { value: 'half', label: 'Half' },
        ],
        { inline: true },
      )}
    </div>`
  }
  ${f.kind === 'hidden' || f.kind === 'consent' ? hidden(`${at}.help`, f.help) : textBox(fields, 'Help line', `${at}.help`, f.help, { maxlength: 300 })}
  ${
    f.kind === 'email' || f.kind === 'name'
      ? html`${hidden(`${at}.attribute`, f.attribute)}<input type="hidden" name="${at}.save:bool" value="${f.save ? 'true' : 'false'}">`
      : html`<div class="ek-toggles">${checkBox(fields, 'Save the answer on the contact', `${at}.save`, f.save)}</div>
    ${textBox(fields, 'As the contact field', `${at}.attribute`, f.attribute, {
      placeholder: f.id,
      mono: true,
      inline: true,
      hint:
        attributes.length > 0
          ? `Empty: ${f.id}. Existing fields: ${attributes
              .slice(0, 5)
              .map((a) => a.key)
              .join(', ')}${attributes.length > 5 ? '…' : ''}`
          : `Empty: ${f.id}. A new contact field takes its type from the first answer.`,
    })}`
  }
  ${textBox(fields, 'Id', `${at}.id`, f.id, { maxlength: 40, mono: true, inline: true, hint: 'The answer’s name in submissions, exports and the webhook.' })}
  ${pathError(fields, at)}`;
}

/* -------------------------------------------------------------- afterwards */

function successCard(view: BuilderView, blocks: BlocksOptions, uploadUrl: string): RawHtml {
  const { definition: d, fields } = view;
  const s = d.success;
  return card(
    { icon: 'check', tone: 'mint', title: 'After they submit', id: 'en-success' },
    choice(
      fields,
      'Then',
      'success.action',
      s.action,
      (Object.keys(SUCCESS_LABELS) as (keyof typeof SUCCESS_LABELS)[]).map((value) => ({
        value,
        label: SUCCESS_LABELS[value],
      })),
      { inline: true, data: 'data-rerender' },
    ),
    s.action === 'redirect'
      ? textBox(fields, 'Page to go to', 'success.redirectUrl', s.redirectUrl, {
          placeholder: '/welcome or https://…',
          icon: 'link',
        })
      : hidden('success.redirectUrl', s.redirectUrl),
    s.action === 'coupon'
      ? html`<div class="ek-grid">
      ${textBox(fields, 'Code', 'success.coupon.code', s.coupon.code, { maxlength: 60, mono: true, hint: 'Only sent to a submission that was accepted.' })}
      ${textBox(fields, 'Words above it', 'success.coupon.label', s.coupon.label, { maxlength: 120 })}
    </div>`
      : html`${hidden('success.coupon.code', s.coupon.code)}${hidden('success.coupon.label', s.coupon.label)}`,
    s.action === 'download'
      ? html`<div class="fb-file" data-ek-upload-url="${uploadUrl}?for=download">
        ${textBox(fields, 'File', 'success.download.url', s.download.url, {
          placeholder: 'Upload it, or https://… or /files/guide.pdf',
          icon: s.download.url.startsWith('upload:') ? 'upload' : 'link',
          mono: true,
          hint: s.download.url.startsWith('upload:')
            ? 'Uploaded. It has no address of its own: each person gets a signed link that expires.'
            : 'Never shown on the page: each person gets a signed link that expires.',
        })}
        <div class="ek-inline"><label class="ek-mini ek-upload">${raw(kitIcon('upload', 12, 2))}<span>Upload a file</span><input type="file" accept=".pdf,.epub,.zip,image/png,image/jpeg,image/gif,image/webp,video/mp4" data-ek-upload-for="success.download.url"></label><span class="ek-upload__status" data-ek-upload-status="success.download.url" role="status">PDF, EPUB, ZIP, an image or an MP4, up to 25 MB.</span></div>
      </div><div class="ek-grid">
      ${textBox(fields, 'Link text', 'success.download.label', s.download.label, { maxlength: 60 })}
      ${numberBox(fields, 'Link works for (hours)', 'success.download.expiresHours', s.download.expiresHours, { min: 1, max: 168 })}
    </div>`
      : html`${hidden('success.download.url', s.download.url)}${hidden('success.download.label', s.download.label)}<input type="hidden" name="success.download.expiresHours:num" value="${s.download.expiresHours}">`,
    s.action === 'form'
      ? choice(
          fields,
          'Form to show',
          'success.formId',
          s.formId,
          [
            { value: '', label: 'Pick a form' },
            ...view.otherForms.map((f) => ({ value: f.id, label: f.name || f.id })),
          ],
          { inline: true },
        )
      : hidden('success.formId', s.formId),
    subhead('The message', {
      hint: s.action === 'redirect' ? 'Shown for a moment before the page changes.' : null,
    }),
    blocksEditor('success.blocks', s.blocks, blocks),
  );
}

/* --------------------------------------------------------------- giveaway */

function giveawayCard(context: DashboardContext, view: BuilderView): RawHtml {
  const { fields } = view;
  const g = view.definition.giveaway;
  return card(
    {
      icon: 'party',
      tone: 'peach',
      title: 'Giveaway',
      id: 'en-giveaway',
      meta: html`<a class="ek-mini" href="${context.basePath}/forms/${encodeURIComponent(view.form.id)}/giveaway">${raw(
        kitIcon('users', 12, 2),
      )}<span>Entries and draw</span></a>`,
    },
    html`<p class="ek-field__hint">Each person enters once. Their share link earns bonus entries when a trusted person enters through it. Only trusted entries are drawn.</p>`,
    textBox(fields, 'Prize', 'giveaway.prize', g.prize, { maxlength: 500 }),
    html`<div class="ek-grid">
      ${textBox(fields, 'Opens', 'giveaway.startsAt', isoToZoned(g.startsAt, context.timeZone), { type: 'datetime-local', hint: 'Empty: now.' })}
      ${textBox(fields, 'Closes', 'giveaway.endsAt', isoToZoned(g.endsAt, context.timeZone), { type: 'datetime-local', hint: `In ${context.timeZone || 'UTC'}.` })}
    </div>`,
    textBox(fields, 'Official rules', 'giveaway.rulesUrl', g.rulesUrl, {
      placeholder: 'https://… or /giveaway-rules',
      icon: 'link',
      hint: 'Required. Linked under the button.',
    }),
    textArea(fields, 'Who can enter', 'giveaway.eligibility', g.eligibility, { rows: 2 }),
    html`<div class="ek-rows">
      ${row(fields, ['giveaway.maxEntries'], {
        icon: 'layers',
        title: 'Most entries per person',
        sub: 'Their own, plus every bonus',
        control: numberInput(fields, 'giveaway.maxEntries', g.maxEntries, {
          min: 1,
          max: 1000,
          label: 'Most entries per person',
        }),
      })}
      ${row(fields, ['giveaway.referralEntries'], {
        icon: 'users',
        title: 'Bonus entries per referral',
        sub: 'When someone trusted enters through their link',
        control: numberInput(fields, 'giveaway.referralEntries', g.referralEntries, {
          min: 0,
          max: 100,
          label: 'Bonus entries per referral',
        }),
      })}
    </div>`,
    checkGroup('Share buttons', 'giveaway.share', g.share, [
      { value: 'x', label: 'X' },
      { value: 'facebook', label: 'Facebook' },
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: 'email', label: 'Email' },
      { value: 'copy', label: 'Copy link', icon: 'copy' },
    ]),
    textBox(fields, 'Share text', 'giveaway.shareText', g.shareText, { maxlength: 280 }),
    subhead('Bonus actions', {
      aside:
        g.actions.length < 10
          ? opButton('Add bonus action', 'add-action|giveaway.actions', { look: 'link' })
          : null,
      hint:
        g.actions.length === 0
          ? 'None yet. Visiting a page or following an account: self-reported, and labelled so.'
          : 'Self-reported, and labelled so to entrants.',
    }),
    join(
      g.actions.map((a, i) => {
        const at = `giveaway.actions.${i}`;
        return html`<div class="fb-action" id="en-${at}">
        ${filterRow(
          '',
          pillChoice(fields, 'Kind', `${at}.kind`, a.kind, [
            { value: 'follow', label: 'Follow' },
            { value: 'visit', label: 'Visit' },
          ]),
          pillInput({
            name: `${at}.label`,
            value: shown(fields, `${at}.label`, a.label),
            placeholder: 'Follow us on X',
            label: 'Label',
            width: 'grow',
          }),
          pillInput({
            name: `${at}.url`,
            value: shown(fields, `${at}.url`, a.url),
            placeholder: 'https://…',
            label: 'Link',
            width: 'grow',
            mono: true,
          }),
          pillInput({
            name: `${at}.entries:num`,
            value: shown(fields, `${at}.entries`, a.entries),
            type: 'number',
            width: 'num',
            min: 1,
            max: 20,
            label: 'Entries',
          }),
          pill('entries', 'op'),
          opButton('Remove this action', `remove|${at}`, { glyph: 'remove', tone: 'danger' }),
        )}
        ${hidden(`${at}.id`, a.id)}
        ${pathError(fields, at)}${pathError(fields, `${at}.label`)}${pathError(fields, `${at}.url`)}
      </div>`;
      }),
    ),
  );
}

/* --------------------------------------------------------------- variants */

function variantsCard(view: BuilderView, blocks: BlocksOptions): RawHtml {
  const { definition: d, fields } = view;
  if (d.variants.length === 0) {
    return card(
      {
        icon: 'split',
        tone: 'blue',
        title: 'A/B test',
        id: 'en-variants',
        meta: opButton('Start a test', 'add-variant|variants', { look: 'link' }),
      },
      html`<p class="ek-field__hint">Try a different headline, picture, button or colour on part of the traffic. Each visitor keeps the variant they first saw, and the results say which converts better, and how sure that is.</p>`,
    );
  }
  return card(
    {
      icon: 'split',
      tone: 'blue',
      title: 'A/B test',
      id: 'en-variants',
      meta:
        d.variants.length < 4
          ? opButton('Add variant', 'add-variant|variants', { look: 'link' })
          : html`<span>Four is the most</span>`,
    },
    html`<p class="ek-field__hint">Each variant changes only what is filled in here; the rest is the form above. Traffic splits by the weights, in proportion.</p>`,
    pathError(fields, 'variants'),
    join(
      d.variants.map((v, i) => {
        const at = `variants.${i}`;
        return html`<div class="fb-variant" id="en-${at}">
        <div class="fb-variant__head">${chip(`Variant ${v.id.toUpperCase()}`, 'accent')}<span class="fb-variant__tools">${opButton('Remove this variant', `remove|${at}`, { glyph: 'remove', tone: 'danger' })}</span></div>
        <div class="ek-grid">
          ${textBox(fields, 'Name', `${at}.name`, v.name, { maxlength: 60 })}
          ${numberBox(fields, 'Weight', `${at}.weight`, v.weight, { min: 0, max: 100 })}
        </div>
        ${hidden(`${at}.id`, v.id)}
        <div class="ek-grid">
          ${textBox(fields, 'Button', `${at}.style.buttonLabel`, v.style.buttonLabel ?? '', { placeholder: d.style.buttonLabel })}
          ${textBox(fields, 'Button colour', `${at}.style.accent`, v.style.accent ?? '', { placeholder: d.style.accent || 'As the form', mono: true })}
          ${textBox(fields, 'Picture', `${at}.layout.image.url`, v.layout.image?.url ?? '', { placeholder: 'As the form' })}
        </div>
        ${subhead('Above the fields', { hint: 'Empty: as the form.' })}
        ${blocksEditor(`${at}.content.blocks`, v.content.blocks ?? [], { ...blocks, only: ['text', 'image', 'gif', 'video'] })}
      </div>`;
      }),
    ),
  );
}

/* ------------------------------------------------------------- anti-abuse */

function abuseCard(context: DashboardContext, view: BuilderView): RawHtml {
  const { definition: d, fields } = view;
  return card(
    {
      icon: 'lock',
      tone: 'lavender',
      title: 'Spam and bots',
      id: 'en-abuse',
      meta: 'Only trusted sign-ups count',
    },
    html`<p class="ek-field__hint">Every submission needs the one-time token the form was drawn with, and is checked for the hidden bot field, how fast it was filled in, rate limits, blocked and throwaway domains, and a mail server on the domain.</p>`,
    html`<div class="ek-rows">
      ${row(fields, ['abuse.minFillSeconds'], {
        icon: 'timer',
        title: 'Fastest a person fills it in',
        sub: 'Quicker than this is a bot, and quietly dropped',
        control: html`${numberInput(fields, 'abuse.minFillSeconds', d.abuse.minFillSeconds, { min: 0, max: 60, label: 'Seconds' })}<span class="fb-unit">s</span>`,
      })}
      ${row(fields, ['abuse.perIpPerHour'], {
        icon: 'globe',
        title: 'From one network, each hour',
        sub: 'Past three times this, it is refused outright',
        control: numberInput(fields, 'abuse.perIpPerHour', d.abuse.perIpPerHour, {
          min: 1,
          max: 1000,
          label: 'Per network address, each hour',
        }),
      })}
      ${row(fields, ['abuse.perEmailPerDay'], {
        icon: 'at',
        title: 'From one email address, each day',
        control: numberInput(fields, 'abuse.perEmailPerDay', d.abuse.perEmailPerDay, {
          min: 1,
          max: 100,
          label: 'Per email address, each day',
        }),
      })}
    </div>`,
    html`<div class="ek-toggles">${checkBox(fields, 'Check the domain can receive mail', 'abuse.checkMx', d.abuse.checkMx, 'One DNS lookup per domain, kept for an hour.')}</div>`,
    html`<p class="ek-field__hint">Throwaway addresses, blocked domains and network addresses, and the bot check are shared with the chat: <a href="${context.basePath}/settings?tab=agent">Settings, Agent</a>.</p>`,
  );
}

/* ---------------------------------------------------------------- details */

function detailsCard(view: BuilderView): RawHtml {
  const { fields } = view;
  return card(
    {
      icon: 'settings',
      tone: 'lavender',
      title: 'Details',
      id: 'en-details',
      meta: 'Only your team sees these',
    },
    html`<div class="ek-grid">
      ${textBox(fields, 'Name', 'name', view.name, { maxlength: 120, placeholder: 'What your team calls it' })}
      <div class="ek-field"><span class="ek-field__label">Id</span><code class="fb-id">${view.form.id}</code><span class="ek-field__hint">In the embed code. Version ${String(view.form.version)}.</span></div>
    </div>`,
    html`<div class="ek-toggles">${checkBox(fields, 'Live', 'enabled', view.enabled, 'Switched off, it shows nowhere and takes no submissions.')}</div>`,
    linesBox(fields, 'Tag the contact', 'tags', view.definition.tags, {
      hint: 'One per line, e.g. newsletter. Added on every accepted submission.',
      mono: true,
    }),
  );
}

/* ------------------------------------------------------------ installing */

function installCard(context: DashboardContext, view: BuilderView): RawHtml {
  const id = view.form.id;
  const api = context.apiPath.replace(/\/+$/, '');
  const base = {
    formId: id,
    formName: view.name,
    productName: context.productName,
    apiPath: context.apiPath,
  };
  const code = (key: string, text: string) =>
    html`<div class="fb-code"><pre class="db-code" id="fb-code-${key}">${text}</pre><button type="button" class="ek-mini" data-copy="fb-code-${key}">${raw(
      kitIcon('copy', 12, 2),
    )}<span>Copy</span></button></div>`;
  const prompt = (label: string, icon: KitIconName, panel: RawHtml) =>
    html`<div class="fb-prompt"><span class="fb-prompt__label">${raw(kitIcon(icon, 13))}${label}</span>${panel}</div>`;
  return card(
    { icon: 'code', tone: 'lavender', title: 'Put it on your site', id: 'en-install' },
    subhead('The embed', { hint: 'Where the form should appear, in the page.' }),
    code('embed', `<div data-helpwell-form="${id}"></div>`),
    subhead('The script', {
      hint: 'Once per page. If the chat widget is on the page, it is already there.',
    }),
    code('script', `<script src="${api}/assets/loader.js" data-mode="forms" defer></script>`),
    html`<p class="ek-field__hint"><code>data-mode="forms"</code> is for a site with forms and no chat. A button or link with <code>data-helpwell-form-open="${id}"</code> opens it over the page, and so does <code>helpwell.forms.show('${id}')</code>.</p>`,
    html`<hr class="ek-sep">`,
    subhead('Or have an AI assistant do it', {
      hint: 'Instructions to paste into ChatGPT, Claude or your coding agent, for where your site is built.',
    }),
    html`<div class="fb-prompts">
      ${prompt('Plain HTML', 'code', setupPromptPanel(`form-embed-html-${id}`, formEmbedPromptSpec({ ...base, platform: 'html' })))}
      ${prompt('Next.js', 'layers', setupPromptPanel(`form-embed-next-${id}`, formEmbedPromptSpec({ ...base, platform: 'nextjs' })))}
      ${prompt('WordPress', 'globe', setupPromptPanel(`form-embed-wp-${id}`, formEmbedPromptSpec({ ...base, platform: 'wordpress' })))}
      ${prompt('A button that opens it', 'click', setupPromptPanel(`form-button-${id}`, formPopupButtonPromptSpec(base)))}
    </div>`,
  );
}

/* ------------------------------------------------------------- the rules */

function audienceControls(view: BuilderView): RawHtml {
  const { definition: d, fields } = view;
  const t = d.targeting;
  return html`${segmented(
    fields,
    'Who can see it',
    'targeting.audience',
    t.audience,
    [
      { value: 'all', label: 'Everyone' },
      { value: 'identified', label: 'Signed in' },
      { value: 'anonymous', label: 'Anonymous' },
    ],
    { full: true },
  )}
  ${field(
    {
      label: 'In a segment',
      hint: 'Segments are saved on the Contacts page.',
      error: errorOf(fields, 'targeting.segmentId'),
    },
    pillChoice(
      fields,
      'Segment',
      'targeting.segmentId',
      t.segmentId ?? '',
      [
        { value: '', label: 'Any segment' },
        ...view.segments.map((s) => ({ value: s.id, label: `${s.name} (${s.count})` })),
        ...(t.segmentId && !view.segments.some((s) => s.id === t.segmentId)
          ? [{ value: t.segmentId, label: 'A segment that has been deleted' }]
          : []),
      ],
      { grow: true },
    ),
  )}
  ${conditionBuilder(
    t.conditions,
    view.contactFields,
    view.events,
    fields.errors.get('targeting.conditions') ?? null,
    typeof fields.typed.get('targeting.conditions') === 'string'
      ? String(fields.typed.get('targeting.conditions'))
      : undefined,
  )}
  ${linesBox(
    fields,
    'When it pops up, on these pages',
    'targeting.pages.include',
    t.pages.include,
    {
      mono: true,
      placeholder: '/blog/**',
      hint: 'One per line. * is within one part, ** across parts: ** is everywhere.',
    },
  )}
  ${linesBox(fields, 'Never on these', 'targeting.pages.exclude', t.pages.exclude, {
    mono: true,
    placeholder: '/checkout/**',
    hint: 'One per line. These win.',
  })}
  ${checkGroup('Devices', 'targeting.devices', t.devices, [
    { value: 'desktop', label: 'Desktop', icon: 'monitor' },
    { value: 'mobile', label: 'Mobile', icon: 'phone' },
  ])}
  <details class="ek-more"${
    t.referrer.include.length + t.referrer.exclude.length + t.languages.length > 0 ||
    Object.values(t.utm).some((v) => v.length > 0)
      ? raw(' open')
      : null
  }>
    <summary>Referrer, campaign and language</summary>
    <div class="ek-more__body">
    ${linesBox(fields, 'Came from', 'targeting.referrer.include', t.referrer.include, { hint: 'Part of the referring address, e.g. google. Empty: anywhere.' })}
    ${linesBox(fields, 'Did not come from', 'targeting.referrer.exclude', t.referrer.exclude)}
    ${linesBox(fields, 'UTM source', 'targeting.utm.source', t.utm.source, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM medium', 'targeting.utm.medium', t.utm.medium, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM campaign', 'targeting.utm.campaign', t.utm.campaign, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM term', 'targeting.utm.term', t.utm.term, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM content', 'targeting.utm.content', t.utm.content, { hint: 'Any of these.' })}
    ${linesBox(fields, 'Languages', 'targeting.languages', t.languages, { hint: 'Browser language prefixes, e.g. en or pt-BR. Empty: any.' })}
    </div>
  </details>`;
}

function triggerControls(context: DashboardContext, view: BuilderView): RawHtml {
  const { definition: d, fields, form } = view;
  const t = d.trigger;
  const type = shown(fields, 'trigger.type', t.type);
  const seconds = 'seconds' in t ? t.seconds : 5;
  const percentValue = t.type === 'scroll' ? t.percent : 50;
  const selector = t.type === 'click' ? t.selector : '';
  const event = t.type === 'event' ? t.name : '';
  const icon = (name: KitIconName) => raw(kitIcon(name, 13));
  const words = (which: string, subject: string, subjectIcon: KitIconName, op: string) =>
    html`<span class="ek-pill" data-for-trigger="${which}">${icon(subjectIcon)}${subject}</span><span class="ek-pill ek-pill--op" data-for-trigger="${which}">${op}</span>`;
  return html`${
    d.placements.display === 'none'
      ? html`<p class="ek-field__hint fb-warn">It does not pop up yet: choose how under Placement for this to apply.</p>`
      : null
  }${field(
    { label: 'Show it when', as: 'group', error: errorOf(fields, 'trigger.type') },
    choiceChips({
      name: 'trigger.type',
      type: 'radio',
      values: [type],
      choices: TRIGGERS,
      label: 'Trigger',
      attrs: raw(' data-trigger-type'),
    }),
  )}
  <div class="fb-trigger" data-for-trigger="delay time_on_page inactivity">${filterRow(
    'when',
    words('delay', 'Page loads', 'globe', 'then after'),
    words('time_on_page', 'Time on page', 'clock', 'reaches'),
    words('inactivity', 'Idle', 'hourglass', 'for'),
    pillInput({
      name: 'trigger.seconds:num',
      value: shown(fields, 'trigger.seconds', seconds),
      type: 'number',
      width: 'num',
      min: 0,
      max: 3600,
      label: 'Seconds',
    }),
    html`<span class="fb-unit">seconds</span>`,
  )}${pathError(fields, 'trigger.seconds')}<p class="ek-field__hint">Time on the page counts only while the tab is in front of them.</p></div>
  <div class="fb-trigger" data-for-trigger="scroll">${filterRow(
    'when',
    html`<span class="ek-pill">${icon('scroll')}Scroll depth</span>`,
    pill('reaches', 'op'),
    pillInput({
      name: 'trigger.percent:num',
      value: shown(fields, 'trigger.percent', percentValue),
      type: 'number',
      width: 'num',
      min: 1,
      max: 100,
      label: 'Scrolled this far (%)',
    }),
    html`<span class="fb-unit">%</span>`,
  )}${pathError(fields, 'trigger.percent')}</div>
  <div class="fb-trigger" data-for-trigger="click">${filterRow(
    'when',
    html`<span class="ek-pill">${icon('click')}Clicked</span>`,
    pillInput({
      name: 'trigger.selector',
      value: selector,
      placeholder: '#get-the-guide',
      label: 'Clicked element',
      mono: true,
      width: 'grow',
    }),
  )}${pathError(fields, 'trigger.selector')}<p class="ek-field__hint">A CSS selector for the element. For a button of your own, <code>data-helpwell-form-open="${form.id}"</code> needs no trigger at all.</p></div>
  <div class="fb-trigger" data-for-trigger="event">${filterRow(
    'when',
    html`<span class="ek-pill">${icon('activity')}Your app tracks</span>`,
    pillInput({
      name: 'trigger.name',
      value: event,
      placeholder: 'trial_started',
      label: 'Event name',
      mono: true,
      width: 'grow',
    }),
  )}${pathError(fields, 'trigger.name')}
    <p class="ek-field__hint">Your app sends it with helpwell('track', name).</p>
    <pre class="db-code">window.helpwell?.('track', '${event || 'trial_started'}');</pre>
  </div>
  <div class="fb-trigger" data-for-trigger="manual">
    <p class="ek-field__hint">Your code opens it when it chooses. Who sees it and the dates still apply.</p>
    <pre class="db-code">window.helpwell?.forms?.show('${form.id}');</pre>
    ${setupPromptPanel(
      `form-manual-${form.id}`,
      formPopupButtonPromptSpec({
        formId: form.id,
        formName: view.name,
        productName: context.productName,
        apiPath: context.apiPath,
      }),
    )}
  </div>
  <div class="fb-trigger" data-for-trigger="load exit">
    <p class="ek-field__hint">No code needed: the script tag is enough.${type === 'exit' ? ' Exit intent is a desktop signal: the pointer leaving the top of the window.' : ''}</p>
  </div>`;
}

function frequencyControls(context: DashboardContext, view: BuilderView): RawHtml {
  const { definition: d, fields } = view;
  const mode = d.frequency === 'once' || d.frequency === 'always' ? d.frequency : 'every';
  return html`<div class="ek-rows">
  ${row(fields, ['frequencyMode'], {
    icon: 'repeat',
    title: 'How often it pops up',
    control: pillChoice(
      fields,
      'How often',
      'frequencyMode',
      mode,
      [
        { value: 'once', label: 'Once per person' },
        { value: 'every', label: 'Again after some days' },
        { value: 'always', label: 'Every time the rules match' },
      ],
      { look: 'pill-val', attrs: raw(' data-frequency-mode') },
    ),
  })}
  ${row(fields, ['frequencyDays', 'frequency'], {
    icon: 'calendar',
    title: 'Days between',
    sub: 'For "again after some days"',
    control: html`${numberInput(
      fields,
      'frequencyDays',
      typeof d.frequency === 'object' ? d.frequency.everyDays : 30,
      {
        min: 1,
        max: 365,
        label: 'Days between',
      },
    )}<span class="fb-unit">days</span>`,
    attrs: raw(' data-for-frequency="every"'),
  })}
  ${row(fields, ['suppressSubscribed'], {
    icon: 'user',
    title: 'Not for people who already signed up',
    sub: 'An embed shows them the thank-you instead',
    control: switchOnly(
      'suppressSubscribed',
      fields.typed.has('suppressSubscribed')
        ? fields.typed.get('suppressSubscribed') === true
        : d.suppressSubscribed,
      'Not for people who already signed up',
    ),
  })}
  ${row(fields, [], {
    icon: 'layers',
    title:
      view.limitsText === 'no global cap'
        ? 'No cap across pop-ups'
        : `${capitalise(view.limitsText)}, across pop-ups`,
    sub: html`${raw(kitIcon('lock', 10, 2.2))}Shared with engagements · <a href="${context.basePath}/engage">set on the Engage page</a>`,
  })}
  ${row(fields, ['schedule.start'], {
    icon: 'calendar',
    title: 'Starts',
    sub: `Empty: straight away. ${context.timeZone || 'UTC'}`,
    control: dateBox(
      fields,
      'schedule.start',
      isoToZoned(d.schedule.start, context.timeZone),
      'Starts',
    ),
  })}
  ${row(fields, ['schedule.end'], {
    icon: 'calendar',
    title: 'Stops',
    sub: 'Empty: until you switch it off',
    control: dateBox(fields, 'schedule.end', isoToZoned(d.schedule.end, context.timeZone), 'Stops'),
  })}
  ${row(fields, ['priority'], {
    icon: 'arrow-up',
    title: 'Priority',
    sub: 'Higher goes first when several could pop up',
    control: numberInput(fields, 'priority', d.priority, { min: 0, max: 100, label: 'Priority' }),
  })}
</div>
<p class="ek-field__hint">Anyone who closed it or submitted it is not shown it again by a trigger.</p>`;
}

function dateBox(fields: Fields, path: string, value: string, label: string): RawHtml {
  return html`<input class="ek-input" type="datetime-local" name="${path}" value="${shown(fields, path, value)}" aria-label="${label}">`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
