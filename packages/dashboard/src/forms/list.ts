/**
 * The Forms front page, and where a new form starts.
 *
 * The list: every form with its kind, whether it is live, where it shows,
 * and how it is converting, with results, submissions, duplicate and
 * archive on each. Under it, importing a form exported as JSON.
 *
 * The gallery: a template for each kind of form, and a blank one. Choosing
 * one creates the form, switched off, and opens the builder on it.
 */

import {
  FORM_TEMPLATES,
  type Form,
  type FormSummaryStats,
  type FormType,
} from '@helpwell/core/repos';
import { html, icon, join, type RawHtml, raw } from '@helpwell/ui';
import {
  button,
  card,
  empty,
  formatDateTime,
  percent,
  pill,
  searchBox,
  segment,
} from '../components.js';
import { byMode } from '../content-mode.js';
import type { DashboardContext } from '../layout.js';
import { PLACEMENT_LABELS, TYPE_ICONS, TYPE_LABELS } from './labels.js';

export const RANGES = ['7d', '30d', '90d'] as const;
export type Range = (typeof RANGES)[number];

export function rangeFrom(value: string | null): Range {
  return RANGES.find((r) => r === value) ?? '30d';
}

export function sinceFor(range: Range, now = new Date()): Date {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  return new Date(now.getTime() - days * 86_400_000);
}

export interface ListQuery {
  q: string;
  range: Range;
  archived: boolean;
}

export function listPage(
  context: DashboardContext,
  forms: readonly Form[],
  stats: ReadonlyMap<string, FormSummaryStats>,
  query: ListQuery,
  flash: RawHtml | null,
): RawHtml {
  const base = `${context.basePath}/forms`;
  const params = (patch: Partial<ListQuery>) => {
    const next = { ...query, ...patch };
    const search = new URLSearchParams();
    if (next.q) search.set('q', next.q);
    if (next.range !== '30d') search.set('range', next.range);
    if (next.archived) search.set('archived', '1');
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };
  const needle = query.q.toLowerCase();
  const shown = forms.filter(
    (f) => !needle || f.id.includes(needle) || f.name.toLowerCase().includes(needle),
  );

  return html`${flash}
<div class="db-toolbar">
  ${segment([
    { label: 'Current', href: params({ archived: false }), current: !query.archived },
    { label: 'With archived', href: params({ archived: true }), current: query.archived },
  ])}
  ${searchBox(base, query.q, 'Search forms')}
  <span style="flex:1"></span>
  ${segment(
    RANGES.map((r) => ({
      label: r.replace('d', ' days'),
      href: params({ range: r }),
      current: query.range === r,
    })),
  )}
</div>
${
  forms.length === 0
    ? empty(
        'inbox',
        'No forms yet',
        'Newsletter sign-ups, lead magnets, discount codes, giveaways and waitlists: embedded on your site, popping up on a trigger, or on the widget’s Home tab. Every submission is checked for bots before it counts.',
        button('New form', { href: `${base}/new`, glyph: 'plus', tone: 'primary' }),
      )
    : shown.length === 0
      ? empty(
          'search',
          'Nothing matches',
          'Try another search.',
          button('Show all', { href: base }),
        )
      : html`<div class="db-tablewrap"><table class="db-table en-list">
  <thead><tr>
    <th>Form</th><th>Kind</th><th>Live</th><th>Shows</th>
    <th class="db-right">Views</th><th class="db-right">Sign-ups</th><th class="db-right">Converted</th><th><span class="db-visually-hidden">Actions</span></th>
  </tr></thead>
  <tbody>${join(shown.map((f) => row(context, f, stats.get(f.id))))}</tbody>
</table></div>`
}
${importCard(context)}`;
}

function where(form: Form): string {
  const p = form.definition.placements;
  const out: string[] = [];
  if (p.inline) out.push('Embedded');
  if (p.twoStep.enabled) out.push('Button');
  if (p.display !== 'none') out.push(PLACEMENT_LABELS[p.display]);
  return out.join(', ') || 'Nowhere yet';
}

function row(context: DashboardContext, form: Form, stats: FormSummaryStats | undefined): RawHtml {
  const href = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  return html`<tr>
  <td>
    <a class="db-link en-list__name" href="${href}">${form.name || form.id}</a>
    <span class="db-muted en-list__id">${form.id} · v${form.version}${form.archivedAt ? ' · archived' : ''}</span>
  </td>
  <td>${pill('accent', TYPE_LABELS[form.type])}</td>
  <td>
    ${
      form.archivedAt
        ? pill('neutral', 'Archived')
        : html`<form method="post" action="${href}" class="en-inline-form">
      <input type="hidden" name="action" value="toggle">
      <label class="db-switch en-switch" title="${form.enabled ? 'Live' : 'Off'}">
        <input type="checkbox" name="enabled" value="true"${form.enabled ? raw(' checked') : null} data-autosubmit aria-label="${form.enabled ? 'Live: switch off' : 'Off: switch on'}">
      </label>
      <noscript><button class="db-btn" type="submit">${form.enabled ? 'Switch off' : 'Switch on'}</button></noscript>
    </form>`
    }
  </td>
  <td class="db-muted">${where(form)}</td>
  <td class="db-right db-nums">${String(stats?.views ?? 0)}</td>
  <td class="db-right db-nums">${String(stats?.trusted ?? 0)}</td>
  <td class="db-right db-nums">${percent(stats?.conversionRate ?? null)}</td>
  <td>
    <div class="db-rowactions">
      ${button('Results', { href: `${href}/results` })}
      ${button('Submissions', { href: `${href}/submissions` })}
      <form method="post" action="${href}"><input type="hidden" name="action" value="duplicate">${button('Duplicate')}</form>
      ${
        form.archivedAt
          ? html`<form method="post" action="${href}"><input type="hidden" name="action" value="unarchive">${button('Restore')}</form>`
          : html`<form method="post" action="${href}" data-confirm="Archive ${form.name || form.id}? It stops showing; its submissions stay.">
        <input type="hidden" name="action" value="delete">${button('Archive', { tone: 'danger' })}
      </form>`
      }
    </div>
  </td>
</tr>`;
}

function importCard(context: DashboardContext): RawHtml {
  return html`<details class="db-card fb-fold">
  <summary class="db-card__title">Import a form</summary>
  <p class="db-card__hint">Paste a form exported from here (Export JSON on a form)${byMode(context, ', for example one kept in your repo', '')}. A form with the same id is only replaced when you tick the box; then it becomes its next version.</p>
  <form method="post" action="${context.basePath}/forms/import">
    <label class="db-field"><span class="db-field__label">The exported JSON</span>
      <textarea class="db-textarea db-textarea--code" name="json" rows="6" placeholder='{ "helpwell": "form", "id": "newsletter", ... }'></textarea>
    </label>
    <label class="db-switch"><input type="checkbox" name="overwrite" value="true"><span class="db-switch__text"><span class="db-switch__title">Replace a form with the same id</span><span class="db-switch__hint">It becomes that form's next version.</span></span></label>
    ${button('Import', { glyph: 'upload' })}
  </form>
</details>`;
}

/* ----------------------------------------------------------------- gallery */

export function galleryPage(context: DashboardContext): RawHtml {
  const action = `${context.basePath}/forms/new`;
  const tile = (key: FormType | 'custom', title: string, description: string) =>
    html`<form method="post" action="${action}" class="fb-template-form">
  <input type="hidden" name="template" value="${key}">
  <button type="submit" class="db-card en-template fb-template">
    <span class="fb-template__icon" aria-hidden="true">${raw(icon(TYPE_ICONS[key as FormType] ?? 'wrench', 18))}</span>
    <span class="en-template__title">${title}</span>
    <span class="db-muted">${description}</span>
  </button>
</form>`;
  return html`<section class="en-gallery">
  <div class="db-grid db-grid--3">
    ${join(FORM_TEMPLATES.map((t) => tile(t.key, t.title, t.description)))}
    ${tile('custom', 'Blank form', 'An email field and nothing else.')}
  </div>
</section>
${card(
  'Or write it as JSON',
  'A form is JSON, and a coding agent can write one: POST it to /admin/forms, or import it from the Forms page. Each starts switched off.',
)}`;
}

export function when(context: DashboardContext, value: Date | string | null): string {
  return formatDateTime(value, { locale: context.locale, timeZone: context.timeZone });
}
