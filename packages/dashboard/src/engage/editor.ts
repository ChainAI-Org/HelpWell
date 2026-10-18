/**
 * The engage editor: one page per engagement, one form, a live preview.
 *
 * Drawn with the editor kit, as the design canvas's message editors: three
 * columns, left to right, in the order the decisions are made.
 *
 *   1. The message itself: what kind it is (chosen first); then how it looks
 *      and where it sits, for the whole of it; then its content (slides,
 *      steps, questions: a list, then the one being edited).
 *   2. Who sees it, and when: the audience, the trigger, the frequency and
 *      the goal, each a one-line summary that opens its controls in place,
 *      one at a time. Anything left closed keeps its setting, because a
 *      closed section's controls are still in the form.
 *   3. The live preview, pinned while the page scrolls, with how it is doing.
 *
 * The form is plain HTML and works without JavaScript: Save posts it, and the
 * add, remove and move buttons post it too and come back with the draft
 * changed, unsaved. With JavaScript, every change is also posted to `_draft`,
 * and what comes back is handed to the preview frame, where the widget's own
 * engage renderer draws it (preview-page.ts), and fills the summaries in.
 */

import {
  type ContactField,
  type EngageLimits,
  type Engagement,
  type EngagementKind,
  type EngagementStats,
  PERSONAL_FIELDS,
  type SegmentSummary,
} from '@helpwell/core/repos';
import { html, type RawHtml, raw } from '@helpwell/ui';
import { notice, percent } from '../components.js';
import { managedContent } from '../content-mode.js';
import {
  card,
  editorShell,
  type KitIconName,
  performanceCard,
  previewPanel,
  type Tone,
  typeTiles,
} from '../editor-kit/index.js';
import type { DashboardContext } from '../layout.js';
import { setupPromptPanel } from '../setup-prompt.js';
import type { BlocksOptions } from './blocks-editor.js';
import { contentCards } from './content.js';
import { checkBox, type Fields, hidden, textBox } from './fields.js';
import { lookCard } from './look.js';
import { engagePreviewPromptSpec } from './prompts.js';
import { summaries } from './summaries.js';
import { KIND_HINTS, KIND_LABELS } from './templates.js';
import { whoColumn } from './who.js';

export interface EditorView {
  engagement: Engagement;
  isNew: boolean;
  unsaved?: boolean;
  fields: Fields;
  /** Every other engagement: for unique ids and "start a tour" buttons. */
  others: readonly Engagement[];
  segments: readonly SegmentSummary[];
  contactFields: readonly ContactField[];
  events: readonly string[];
  canUpload: boolean;
  /** How many contacts the audience rules match now, when there are rules. */
  audienceCount: number | null;
  /** The global cap, shown beside the frequency it adds to. */
  limits: EngageLimits;
  /** The last 30 days, for a saved engagement. */
  stats: EngagementStats | null;
  /** A notice over the form: not saved, or why not. */
  flash?: RawHtml | null;
  /** The part of the form to bring back into view after a structural edit. */
  focus?: string | null;
  /** The site the preview's address bar names, e.g. app.example.com. */
  siteHost?: string;
}

const KINDS: EngagementKind[] = ['modal', 'banner', 'hotspot', 'tour', 'survey'];

export const KIND_LOOK: Record<EngagementKind, { icon: KitIconName; tone: Tone }> = {
  modal: { icon: 'popup', tone: 'peach' },
  banner: { icon: 'banner', tone: 'butter' },
  hotspot: { icon: 'circle-dot', tone: 'lavender' },
  tour: { icon: 'route', tone: 'mint' },
  survey: { icon: 'star', tone: 'blue' },
};

const TRIGGER_ICONS: Record<Engagement['triggers'][number]['type'], KitIconName> = {
  load: 'globe',
  delay: 'timer',
  scroll: 'scroll',
  exit: 'door',
  time_on_page: 'clock',
  inactivity: 'hourglass',
  click: 'click',
  event: 'activity',
  manual: 'code',
};

/** Which rules section holds a field, so a problem opens the right one. */
function sectionOf(path: string): 'audience' | 'trigger' | 'frequency' | null {
  if (path.startsWith('targeting')) return 'audience';
  if (path.startsWith('trigger')) return 'trigger';
  if (path.startsWith('schedule') || path.startsWith('frequency') || path === 'priority') {
    return 'frequency';
  }
  return null;
}

export function editorPage(context: DashboardContext, view: EditorView): RawHtml {
  const { engagement: e, fields } = view;
  const base = `${context.basePath}/engage`;
  const action = view.isNew ? `${base}/new` : `${base}/${encodeURIComponent(e.id)}`;
  const blocks: BlocksOptions = {
    fields,
    canUpload: view.canUpload,
    personalise: personaliseFields(view.contactFields),
    tours: view.others.filter((o) => o.kind === 'tour' && o.id !== e.id),
    ai: {
      url: `${base}/_write`,
      context: `A ${KIND_LABELS[e.kind].toLowerCase()} shown inside ${context.productName || 'the product'}.`,
    },
  };
  const problems = fields.errors.size;
  const segmentName = view.segments.find((s) => s.id === e.targeting.segmentId)?.name ?? null;
  const said = summaries(e, { segmentName, locale: context.locale, timeZone: context.timeZone });
  const open = new Set(
    [...fields.errors.keys(), view.focus ?? ''].map(sectionOf).filter((s) => s !== null),
  );

  const main = html`${view.flash ?? null}${
    problems > 0
      ? notice(
          'bad',
          `${problems === 1 ? 'One thing needs' : `${problems} things need`} fixing before this can be saved. Each is marked below.`,
        )
      : null
  }
  ${typeTiles({
    label: 'Type',
    current: e.kind,
    choices: KINDS.map((k) => ({
      value: k,
      label: KIND_LABELS[k],
      ...KIND_LOOK[k],
      // A saved engagement keeps its type: its content only fits that kind.
      href: view.isNew ? `${base}/new?template=blank-${k}` : null,
      title:
        view.isNew || k === e.kind
          ? KIND_HINTS[k]
          : 'A saved engagement keeps its type. Duplicate one, or start a new one, for another.',
    })),
  })}
  ${lookCard(e, fields, { timeZone: context.timeZone })}
  ${contentCards(e, fields, blocks, view.focus ?? null)}
  ${detailsCard(e, fields, view.isNew)}
  <p class="ek-foot">${
    managedContent(context)
      ? 'Saved here. Once it is live, it shows from the next page load.'
      : html`Saved to settings. <code>helpwell settings pull</code> copies them into your repo.`
  }</p>`;

  const side = whoColumn({
    context,
    e,
    fields,
    said,
    open,
    segments: view.segments,
    contactFields: view.contactFields,
    events: view.events,
    audienceCount: view.audienceCount,
    limits: view.limits,
    conversionRate: view.stats?.conversionRate ?? null,
    isNew: view.isNew,
  });

  const firstPage = e.targeting.pages.include.find((p) => !p.includes('*')) ?? '/';
  const preview = previewPanel({
    subtitle: shortAudience(e),
    url: `${view.siteHost || 'your-app.example'}${firstPage === '/' ? '' : firstPage}`,
    frame: {
      src: `${base}/_preview`,
      title: `Live preview of this ${KIND_LABELS[e.kind].toLowerCase()}`,
    },
    caption: {
      icon: TRIGGER_ICONS[e.triggers[0]?.type ?? 'load'],
      text: said.moment,
      summaryKey: 'moment',
    },
    replay: true,
    below: html`<p class="ek-preview__status" id="en-preview-status" role="status"></p>
      <div id="en-preview-missing" class="eg-missing" hidden>
        ${notice(
          'warn',
          'The preview could not load the widget. The API needs to serve the widget files, and the widget needs to be built.',
        )}
        ${setupPromptPanel('engage-preview', engagePreviewPromptSpec({ apiPath: context.apiPath }))}
      </div>
      <noscript><p class="ek-field__hint">The live preview needs JavaScript. Everything else here works without it.</p></noscript>
      ${view.isNew ? null : performance(context, e, view.stats)}`,
  });

  return html`<form method="post" action="${action}" id="en-editor" class="ek-editor"
      ${view.unsaved ? raw('data-helpwell-dirty') : null}
      data-draft="${base}/_draft" data-ek-upload-url="${base}/_upload"
      data-accent="${context.accent}" data-sample-fields="${JSON.stringify(sampleFields(view.contactFields))}"${
        view.focus ? html` data-focus="en-${view.focus}"` : null
      }>
  ${hidden('kind', e.kind)}
  ${editorShell({ basePath: context.basePath, main, side, preview })}
</form>`;
}

/**
 * The fields the composer offers to personalise with: a person's name and
 * email, then the app's own attributes. First name says "there" when the
 * visitor is anonymous, which reads well at the start of a greeting.
 */
export function personaliseFields(
  contactFields: readonly ContactField[],
): { key: string; label: string }[] {
  const attributes = contactFields
    .filter((f) => !f.builtin && !f.hidden && /^[A-Za-z0-9_.-]{1,64}$/.test(f.key))
    .filter(
      (f) => f.type === 'text' || f.type === 'number' || f.type === 'url' || f.type === 'money',
    )
    .filter((f) => !PERSONAL_FIELDS.some((p) => p.key === f.key))
    .slice(0, 12)
    .map((f) => ({ key: f.key, label: f.label }));
  return [
    ...PERSONAL_FIELDS.map((f) => ({
      key: f.key === 'first_name' ? 'first_name|there' : f.key,
      label: f.label,
    })),
    ...attributes,
  ];
}

/** What the preview fills the placeholders with: a made-up person, and each attribute's last value. */
function sampleFields(contactFields: readonly ContactField[]): Record<string, string> {
  const out: Record<string, string> = {
    first_name: 'Jane',
    last_name: 'Martin',
    name: 'Jane Martin',
    email: 'jane@example.com',
  };
  for (const f of contactFields) {
    if (f.builtin || f.key in out) continue;
    const sample = f.sample;
    if (typeof sample === 'string' || typeof sample === 'number') {
      out[f.key] = String(sample).slice(0, 60);
    }
  }
  return out;
}

function detailsCard(e: Engagement, fields: Fields, isNew: boolean): RawHtml {
  return card(
    {
      icon: 'settings',
      tone: 'lavender',
      title: 'Details',
      meta: 'Only your team sees these',
      id: 'en-details',
    },
    html`<div class="ek-grid">
      ${textBox(fields, 'Name', 'name', e.name, { maxlength: 120, placeholder: 'What your team calls it' })}
      ${
        isNew
          ? textBox(fields, 'Id', 'id', e.id, {
              hint: 'Stable, and in your stats. Letters, numbers and dashes.',
              maxlength: 80,
              mono: true,
            })
          : html`<div class="ek-field"><span class="ek-field__label">Id</span><code class="eg-id">${e.id}</code>${hidden('id', e.id)}<span class="ek-field__hint">Stable, and in your stats.</span></div>`
      }
    </div>`,
    html`<div class="ek-toggles">
      ${checkBox(fields, 'Live', 'enabled', e.enabled, 'Switched off, it never shows, whatever its rules say.')}
      ${
        e.kind === 'banner'
          ? null
          : checkBox(
              fields,
              'Can be closed',
              'dismissible',
              e.dismissible,
              'A close button and Escape.',
            )
      }
    </div>`,
  );
}

function shortAudience(e: Engagement): string {
  const who = {
    all: 'Any visitor',
    identified: 'A signed-in visitor',
    anonymous: 'An anonymous visitor',
  }[e.targeting.audience];
  const device = e.targeting.devices.length === 1 ? ` · ${e.targeting.devices[0]}` : '';
  const source = e.targeting.utm.source[0] ? ` · ${e.targeting.utm.source[0]}` : '';
  return `${who}${device}${source}`;
}

function performance(
  context: DashboardContext,
  e: Engagement,
  stats: EngagementStats | null,
): RawHtml {
  const seen = stats?.seen ?? 0;
  const goal =
    e.kind === 'tour' || e.kind === 'survey'
      ? 'Finished'
      : e.kind === 'hotspot'
        ? 'Opened'
        : 'Clicked';
  const dismissed = seen > 0 ? (stats?.dismissed ?? 0) / seen : null;
  const results = `${context.basePath}/engage/${encodeURIComponent(e.id)}/results`;
  return performanceCard({
    label: 'Performance · last 30 days',
    link: { href: results, label: 'Full report' },
    stats: [
      {
        value: seen.toLocaleString('en'),
        label: 'Shown',
        percent: seen > 0 ? 100 : 0,
        tone: 'lavender',
      },
      {
        value: percent(dismissed),
        label: 'Closed it',
        percent: (dismissed ?? 0) * 100,
        tone: 'accent',
      },
      {
        value: percent(stats?.conversionRate ?? null),
        label: goal,
        percent: (stats?.conversionRate ?? 0) * 100,
        tone: 'good',
      },
    ],
    foot: {
      icon: 'user',
      text:
        seen > 0
          ? `${(stats?.people ?? 0).toLocaleString('en')} ${stats?.people === 1 ? 'person' : 'people'} saw it`
          : 'Nobody has seen it yet',
      link: { href: results, label: 'See results' },
    },
  });
}
