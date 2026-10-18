/**
 * "Who sees it, and when": the audience, the trigger, the frequency and the
 * goal, each a one-line summary that opens its controls in place, one at a
 * time. Anything left closed keeps its setting, because a closed section's
 * controls are still in the form.
 *
 * Controls are drawn as the design draws conditions: sentences of pills
 * ("when [Scroll depth] reaches [60] %"), and settings as rows with a small
 * icon ("How often … [Once per person]").
 */

import {
  type ContactField,
  type EngageLimits,
  type Engagement,
  engageCodePromptSpec,
  MAX_TRIGGERS,
  type SegmentSummary,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import { percent } from '../components.js';
import {
  choiceChips,
  field,
  filterRow,
  type KitIconName,
  kitIcon,
  pill,
  pillInput,
  summaryColumn,
  summaryRow,
} from '../editor-kit/index.js';
import type { DashboardContext } from '../layout.js';
import { setupPromptPanel } from '../setup-prompt.js';
import { conditionBuilder } from './conditions.js';
import {
  checkGroup,
  errorOf,
  type Fields,
  linesBox,
  numberInput,
  opButton,
  pathError,
  pillChoice,
  pillNumber,
  row,
  segmented,
  shown,
} from './fields.js';
import { isoToZoned } from './form.js';
import type { Summaries } from './summaries.js';

export const TRIGGERS: {
  value: Engagement['triggers'][number]['type'];
  label: string;
  icon: KitIconName;
}[] = [
  { value: 'load', label: 'Page loads', icon: 'globe' },
  { value: 'delay', label: 'After a delay', icon: 'timer' },
  { value: 'scroll', label: 'Scroll depth', icon: 'scroll' },
  { value: 'exit', label: 'Exit intent', icon: 'door' },
  { value: 'time_on_page', label: 'Time on page', icon: 'clock' },
  { value: 'inactivity', label: 'Idle for N seconds', icon: 'hourglass' },
  { value: 'click', label: 'Element clicked', icon: 'click' },
  { value: 'event', label: 'Event happened', icon: 'activity' },
  { value: 'manual', label: 'From your code', icon: 'code' },
];

export interface WhoOptions {
  context: DashboardContext;
  e: Engagement;
  fields: Fields;
  said: Summaries;
  open: Set<string>;
  segments: readonly SegmentSummary[];
  contactFields: readonly ContactField[];
  events: readonly string[];
  audienceCount: number | null;
  limits: EngageLimits;
  conversionRate: number | null;
  isNew: boolean;
}

export function whoColumn(o: WhoOptions): RawHtml {
  const { e } = o;
  return summaryColumn({
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
          o.audienceCount === null
            ? e.targeting.audience === 'all'
              ? 'every visitor'
              : null
            : `${o.audienceCount.toLocaleString('en')} match now`,
        summary: o.said.audience,
        open: o.open.has('audience'),
        body: audience(o),
      }),
      summaryRow({
        key: 'trigger',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'zap',
        tone: 'butter',
        title: 'Trigger',
        meta: e.triggers.some((t) => t.type === 'event' || t.type === 'manual')
          ? 'needs a line of code'
          : e.triggers.length > 1
            ? `whichever of ${e.triggers.length} comes first`
            : 'no code needed',
        summary: capitalise(o.said.trigger),
        open: o.open.has('trigger'),
        body: trigger(o),
      }),
      summaryRow({
        key: 'frequency',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'calendar',
        tone: 'blue',
        title: 'Frequency',
        openTitle: 'Frequency and timing',
        meta: capText(o.limits),
        summary: o.said.frequency,
        open: o.open.has('frequency'),
        body: frequency(o),
      }),
      summaryRow({
        key: 'goal',
        idPrefix: 'en-rule-',
        group: 'en-rules',
        icon: 'target',
        tone: 'mint',
        title: 'Goal',
        meta: o.conversionRate != null ? `${percent(o.conversionRate, 1)} reached` : null,
        summary: o.said.goal,
        open: false,
        body: goal(o),
      }),
    ],
    foot: 'Anything left closed keeps its setting. Audience conditions use the same fields as segments on the Contacts page.',
  });
}

export function capText(limits: EngageLimits): string {
  const parts: string[] = [];
  if (limits.perSession) parts.push(`${limits.perSession} per visit`);
  if (limits.perDay) parts.push(`${limits.perDay} a day`);
  if (limits.minMinutesBetween) parts.push(`${limits.minMinutesBetween} min apart`);
  return parts.length > 0 ? `at most ${parts.join(', ')}` : 'no global cap';
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* -------------------------------------------------------------- audience */

function audience(o: WhoOptions): RawHtml {
  const { e, fields } = o;
  const t = e.targeting;
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
        ...o.segments.map((s) => ({ value: s.id, label: `${s.name} (${s.count})` })),
        ...(t.segmentId && !o.segments.some((s) => s.id === t.segmentId)
          ? [{ value: t.segmentId, label: 'A segment that has been deleted' }]
          : []),
      ],
      { grow: true },
    ),
  )}
  ${conditionBuilder(
    t.conditions,
    o.contactFields,
    o.events,
    fields.errors.get('targeting.conditions') ?? null,
    typeof fields.typed.get('targeting.conditions') === 'string'
      ? String(fields.typed.get('targeting.conditions'))
      : undefined,
  )}
  ${linesBox(fields, 'On these pages', 'targeting.pages.include', t.pages.include, {
    mono: true,
    placeholder: '/pricing',
    hint: 'One per line. * is within one part, ** across parts: ** is everywhere.',
  })}
  ${linesBox(fields, 'Never on these', 'targeting.pages.exclude', t.pages.exclude, {
    mono: true,
    placeholder: '/checkout/**',
    hint: 'One per line. These win.',
  })}
  ${checkGroup('Devices', 'targeting.devices', t.devices, [
    { value: 'desktop', label: 'Desktop', icon: 'monitor' },
    { value: 'mobile', label: 'Mobile', icon: 'phone' },
  ])}
  <details class="ek-more"${hasPlaceRules(e) ? raw(' open') : null}>
    <summary>Referrer, campaign and language</summary>
    <div class="ek-more__body">
    ${linesBox(fields, 'Came from', 'targeting.referrer.include', t.referrer.include, {
      hint: 'Part of the referring address, e.g. google. Empty: anywhere.',
    })}
    ${linesBox(fields, 'Did not come from', 'targeting.referrer.exclude', t.referrer.exclude)}
    ${linesBox(fields, 'UTM source', 'targeting.utm.source', t.utm.source, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM medium', 'targeting.utm.medium', t.utm.medium, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM campaign', 'targeting.utm.campaign', t.utm.campaign, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM term', 'targeting.utm.term', t.utm.term, { hint: 'Any of these.' })}
    ${linesBox(fields, 'UTM content', 'targeting.utm.content', t.utm.content, { hint: 'Any of these.' })}
    ${linesBox(fields, 'Languages', 'targeting.languages', t.languages, {
      hint: 'Browser language prefixes, e.g. en or pt-BR. Empty: any.',
    })}
    <p class="ek-field__hint">UTM values are read from the page the visit landed on, and kept for the rest of the visit.</p>
    </div>
  </details>`;
}

function hasPlaceRules(e: Engagement): boolean {
  const t = e.targeting;
  return (
    t.referrer.include.length + t.referrer.exclude.length + t.languages.length > 0 ||
    Object.values(t.utm).some((v) => v.length > 0)
  );
}

/* --------------------------------------------------------------- trigger */

type Trigger = Engagement['triggers'][number];

/** Types in the order a further trigger is offered: the likeliest pairings first. */
const NEXT_TRIGGERS: Trigger['type'][] = ['exit', 'scroll', 'time_on_page', 'delay', 'inactivity'];

/**
 * The triggers: the first as the design's row of chips, each further one a
 * sentence starting "or", with its own settings. Whichever happens first
 * shows it. Which settings show follows the chosen type in CSS (styles.ts),
 * scoped to that one trigger, so every one works before any script.
 */
function trigger(o: WhoOptions): RawHtml {
  const { e, fields } = o;
  const list = e.triggers;
  return html`${join(list.map((t, i) => triggerItem(o, t, i)))}${
    list.length < MAX_TRIGGERS
      ? html`<div class="eg-trig-add">${opButton('Or when…', 'add-trigger|triggers', { look: 'link' })}<span class="ek-field__hint">With several, whichever happens first shows it.</span></div>`
      : null
  }${pathError(fields, 'triggers')}`;
}

function triggerItem(o: WhoOptions, t: Trigger, i: number): RawHtml {
  const { context, e, fields } = o;
  const at = `triggers.${i}`;
  const type = shown(fields, `${at}.type`, t.type);
  const seconds = 'seconds' in t ? t.seconds : 5;
  const percentValue = t.type === 'scroll' ? t.percent : 50;
  const selector = t.type === 'click' ? t.selector : '';
  const event = t.type === 'event' ? t.name : '';
  const prompt = (which: 'event' | 'manual') =>
    setupPromptPanel(
      i === 0 ? `engage-${which}` : `engage-${which}-${i}`,
      engageCodePromptSpec({
        trigger: which,
        productName: context.productName,
        apiPath: context.apiPath,
        engagementId: e.id,
        event: event || undefined,
      }),
    );
  const icon = (name: KitIconName) => raw(kitIcon(name, 13));
  const secondsBox = pillNumber(fields, `${at}.seconds`, seconds, {
    min: 0,
    max: 3600,
    label: 'Seconds',
  });
  const words = (which: string, subject: string, subjectIcon: KitIconName, op: string) =>
    html`<span class="ek-pill" data-for-trigger="${which}">${icon(subjectIcon)}${subject}</span><span class="ek-pill ek-pill--op" data-for-trigger="${which}">${op}</span>`;
  const head =
    i === 0
      ? field(
          { label: 'Show it when', as: 'group', error: errorOf(fields, `${at}.type`) },
          choiceChips({
            name: `${at}.type`,
            type: 'radio',
            values: [type],
            choices: TRIGGERS,
            label: 'Trigger',
            attrs: raw(' data-trigger-type'),
          }),
        )
      : html`<div class="eg-trig__head">${filterRow(
          'or',
          pillChoice(
            fields,
            `Trigger ${i + 1}`,
            `${at}.type`,
            type,
            TRIGGERS.map((choice) => ({ value: choice.value, label: choice.label })),
            { look: 'pill-val', attrs: raw(' data-trigger-type'), grow: true },
          ),
          opButton(`Remove trigger ${i + 1}`, `remove|${at}`, { glyph: 'remove', tone: 'danger' }),
        )}${pathError(fields, `${at}.type`)}</div>`;
  return html`<div class="eg-trig" id="en-${at}"${i > 0 ? raw(' data-more') : null}>
  ${head}
  <div class="eg-trigger" data-for-trigger="delay time_on_page inactivity">${filterRow(
    'when',
    words('delay', 'Page loads', 'globe', 'then after'),
    words('time_on_page', 'Time on page', 'clock', 'reaches'),
    words('inactivity', 'Idle', 'hourglass', 'for'),
    secondsBox,
    pill('seconds', 'op'),
  )}${pathError(fields, `${at}.seconds`)}<p class="ek-field__hint">Time on the page counts only while the tab is open in front of them.</p></div>
  <div class="eg-trigger" data-for-trigger="scroll">${filterRow(
    'when',
    html`<span class="ek-pill">${icon('scroll')}Scroll depth</span>`,
    pill('reaches', 'op'),
    pillNumber(fields, `${at}.percent`, percentValue, {
      min: 1,
      max: 100,
      label: 'Scrolled this far (%)',
    }),
    pill('%', 'op'),
  )}${pathError(fields, `${at}.percent`)}</div>
  <div class="eg-trigger" data-for-trigger="click">${filterRow(
    'when',
    html`<span class="ek-pill">${icon('click')}Clicked</span>`,
    pillInput({
      name: `${at}.selector`,
      value: selector,
      placeholder: '#upgrade-button',
      label: 'Clicked element',
      mono: true,
      width: 'grow',
    }),
  )}${pathError(fields, `${at}.selector`)}<p class="ek-field__hint">A CSS selector for the element.</p></div>
  <div class="eg-trigger" data-for-trigger="event">${filterRow(
    'when',
    html`<span class="ek-pill">${icon('activity')}Your app tracks</span>`,
    pillInput({
      name: `${at}.name`,
      value: event,
      placeholder: 'project_created',
      label: 'Event name',
      mono: true,
      width: 'grow',
    }),
  )}${pathError(fields, `${at}.name`)}
    <p class="ek-field__hint">Your app sends it with helpwell('track', name). It is also recorded on the contact.</p>
    <pre class="db-code">window.helpwell?.('track', '${event || 'project_created'}');</pre>
    ${prompt('event')}
  </div>
  <div class="eg-trigger" data-for-trigger="manual">
    <p class="ek-field__hint">Your app shows it when it chooses. Who sees it and the dates still apply.</p>
    <pre class="db-code">window.helpwell?.engage?.show('${e.id}');</pre>
    ${prompt('manual')}
  </div>
  <div class="eg-trigger" data-for-trigger="load exit">
    <p class="ek-field__hint">No code needed: the widget's script tag is enough.${
      type === 'exit'
        ? ' Exit intent is a desktop signal: the pointer leaving the top of the window.'
        : ''
    }</p>
  </div>
</div>`;
}

/** A type for one more trigger: the first of the likely ones not already in the list. */
export function nextTriggerType(existing: readonly string[]): Trigger['type'] {
  return NEXT_TRIGGERS.find((type) => !existing.includes(type)) ?? 'delay';
}

/* ------------------------------------------------------------- frequency */

function frequency(o: WhoOptions): RawHtml {
  const { context, e, fields, limits } = o;
  const mode = e.frequency === 'once' || e.frequency === 'always' ? e.frequency : 'every';
  return html`<div class="ek-rows">
  ${row(fields, ['frequencyMode'], {
    icon: 'repeat',
    title: 'How often',
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
      typeof e.frequency === 'object' ? e.frequency.everyDays : 30,
      {
        min: 1,
        max: 365,
        label: 'Days between',
      },
    )}<span class="eg-unit">days</span>`,
    attrs: raw(' data-for-frequency="every"'),
  })}
  ${row(fields, [], {
    icon: 'layers',
    title:
      capText(limits) === 'no global cap'
        ? 'No cap across messages'
        : `${capitalise(capText(limits))}, across messages`,
    sub: html`${raw(kitIcon('lock', 10, 2.2))}Every engagement · <a href="${context.basePath}/engage">set on the Engage page</a>`,
  })}
  ${row(fields, ['schedule.start'], {
    icon: 'calendar',
    title: 'Starts',
    sub: 'Empty: from now',
    control: dateBox(
      fields,
      'schedule.start',
      isoToZoned(e.schedule.start, context.timeZone),
      'Starts',
    ),
  })}
  ${row(fields, ['schedule.end'], {
    icon: 'calendar',
    title: 'Stops',
    sub: 'Empty: until paused',
    control: dateBox(fields, 'schedule.end', isoToZoned(e.schedule.end, context.timeZone), 'Stops'),
  })}
  ${row(fields, ['priority'], {
    icon: 'arrow-up',
    title: 'Priority',
    sub: 'Higher goes first when several qualify at once',
    control: numberInput(fields, 'priority', e.priority, { min: 0, max: 100, label: 'Priority' }),
  })}
</div>
<p class="ek-field__hint">Dates are in ${context.timeZone || 'UTC'}, the time zone in Settings. Anyone who closed it or finished it is never shown it again.</p>`;
}

function dateBox(fields: Fields, path: string, value: string, label: string): RawHtml {
  return html`<input class="ek-input eg-date" type="datetime-local" name="${path}" value="${shown(fields, path, value)}" aria-label="${label}">`;
}

/* ------------------------------------------------------------------ goal */

function goal(o: WhoOptions): RawHtml {
  const { context, e, isNew } = o;
  const what =
    e.kind === 'tour' || e.kind === 'survey'
      ? 'Finishing it is what counts as reaching the goal.'
      : e.kind === 'hotspot'
        ? 'Opening the beacon, or clicking a button in it, is what counts as reaching the goal.'
        : 'Clicking its button is what counts as reaching the goal. Next and Close do not count.';
  return html`<p class="ek-field__hint">${what} The conversion rate is that share of the times it was shown.</p>${
    isNew
      ? null
      : html`<p><a class="ek-mini" href="${context.basePath}/engage/${encodeURIComponent(e.id)}/results">${raw(
          kitIcon('activity', 12, 2),
        )}<span>See the results</span></a></p>`
  }`;
}
