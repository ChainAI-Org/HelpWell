/**
 * Engage's front page, and where a new engagement starts.
 *
 * The list: every engagement with its type, whether it is live, when it
 * runs and how it is doing, filterable by type and searchable, with
 * duplicate and delete. Above it, the settings that apply to all of them:
 * Engage on or off, and the global cap on how often anyone is interrupted.
 *
 * The gallery: a template for each type, and a blank one.
 */

import type {
  Engagement,
  EngagementKind,
  EngagementStats,
  EngageSettings,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import {
  button,
  card,
  empty,
  formatDateTime,
  notice,
  percent,
  pill,
  searchBox,
  segment,
  toggle,
} from '../components.js';
import { managedContent } from '../content-mode.js';
import { glyph, kitIcon } from '../editor-kit/index.js';
import type { DashboardContext } from '../layout.js';
import { KIND_LOOK } from './editor.js';
import { RANGES, type Range } from './results.js';
import { bannerPosition, beacon, modalLayout, placement, tourStep } from './sketches.js';
import { KIND_HINTS, KIND_LABELS, TEMPLATES } from './templates.js';

export interface ListQuery {
  kind: EngagementKind | null;
  q: string;
  range: Range;
}

const KINDS: EngagementKind[] = ['modal', 'banner', 'hotspot', 'tour', 'survey'];
const PLURAL: Record<EngagementKind, string> = {
  modal: 'Modals',
  banner: 'Banners',
  hotspot: 'Hotspots',
  tour: 'Tours',
  survey: 'Surveys',
};

export function listPage(
  context: DashboardContext,
  engage: EngageSettings,
  stats: readonly EngagementStats[],
  query: ListQuery,
  flash: RawHtml | null,
): RawHtml {
  const base = `${context.basePath}/engage`;
  const params = (patch: Partial<ListQuery>) => {
    const next = { ...query, ...patch };
    const search = new URLSearchParams();
    if (next.kind) search.set('kind', next.kind);
    if (next.q) search.set('q', next.q);
    if (next.range !== '30d') search.set('range', next.range);
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };
  const byId = new Map(stats.map((s) => [s.engagementId, s]));
  const needle = query.q.toLowerCase();
  const shown = engage.engagements.filter(
    (e) =>
      (!query.kind || e.kind === query.kind) &&
      (!needle || e.id.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle)),
  );

  return html`${flash}
${!engage.enabled ? notice('warn', 'Engage is switched off, so none of these are showing.') : null}
${settingsCard(engage)}
<div class="db-toolbar">
  ${segment([
    { label: 'All', href: params({ kind: null }), current: query.kind === null },
    ...KINDS.map((k) => ({
      label: PLURAL[k],
      href: params({ kind: k }),
      current: query.kind === k,
    })),
  ])}
  ${searchBox(base, query.q, 'Search engagements')}
  <span style="flex:1"></span>
  ${segment(
    RANGES.map((r) => ({
      label: r.replace('d', ' days'),
      href: params({ range: r }),
      current: query.range === r,
    })),
  )}
</div>
<div data-setting="engage.engagements">
${
  engage.engagements.length === 0
    ? empty(
        'engage',
        'Nothing set up yet',
        managedContent(context)
          ? 'Modals, banners, hotspots, tours and surveys, shown to the people and on the pages you choose.'
          : 'Modals, banners, hotspots, tours and surveys, shown to the people and on the pages you choose. They are saved in settings, so they can live in your repo too, in the engage section of helpwell.config.json.',
        button('New engagement', { href: `${base}/new`, glyph: 'plus', tone: 'primary' }),
      )
    : shown.length === 0
      ? empty(
          'search',
          'Nothing matches',
          'Try another type, or clear the search.',
          button('Show all', { href: base }),
        )
      : html`<div class="db-tablewrap"><table class="db-table en-list">
  <thead><tr>
    <th>Engagement</th><th>Type</th><th>Live</th><th>Runs</th>
    <th class="db-right">Impressions</th><th class="db-right">Conversion</th><th><span class="db-visually-hidden">Actions</span></th>
  </tr></thead>
  <tbody>${join(shown.map((e) => row(context, e, byId.get(e.id))))}</tbody>
</table></div>`
}
</div>`;
}

function settingsCard(engage: EngageSettings): RawHtml {
  const limit = (key: keyof EngageSettings['limits'], label: string, hint: string, max: number) =>
    html`<label class="db-field en-limit">
      <span class="db-field__label">${label}</span>
      <input class="db-input en-number" type="number" min="0" max="${max}" value="${engage.limits[key]}" data-patch="engage.limits.${key}">
      <span class="db-field__hint">${hint}</span>
    </label>`;
  return html`<details class="db-card en-settings">
  <summary><span class="db-card__title">Settings for every engagement</span>
    <span class="db-muted">${engage.enabled ? 'On' : 'Off'}${
      engage.limits.perSession || engage.limits.perDay || engage.limits.minMinutesBetween
        ? ', with a cap'
        : ', no cap'
    }</span></summary>
  ${toggle('Engage is on', 'Switch it off and nothing here shows, anywhere. Saved as you change it.', engage.enabled, 'engage.enabled')}
  <p class="db-card__hint">A cap on how often one person is interrupted, counted on the server across modals, banners, tours and surveys. Hotspots do not count. 0 is no limit. Saved as you change it.</p>
  <div class="en-row">
    ${limit('perSession', 'Per visit', 'At most this many per browser session.', 100)}
    ${limit('perDay', 'Per day', 'At most this many in any 24 hours.', 100)}
    ${limit('minMinutesBetween', 'Minutes apart', 'At least this long between two.', 10_080)}
  </div>
</details>`;
}

function row(
  context: DashboardContext,
  e: Engagement,
  stats: EngagementStats | undefined,
): RawHtml {
  const base = `${context.basePath}/engage`;
  const href = `${base}/${encodeURIComponent(e.id)}`;
  return html`<tr>
  <td>
    <a class="db-link en-list__name" href="${href}">${e.name || e.id}</a>
    <span class="db-muted en-list__id">${e.id}</span>
  </td>
  <td>${pill('accent', KIND_LABELS[e.kind])}</td>
  <td>
    <form method="post" action="${href}" class="en-inline-form">
      <input type="hidden" name="action" value="toggle">
      <label class="db-switch en-switch" title="${e.enabled ? 'Live' : 'Paused'}">
        <input type="checkbox" name="enabled" value="true"${e.enabled ? raw(' checked') : null} data-autosubmit aria-label="${e.enabled ? 'Live: switch off' : 'Paused: switch on'}">
      </label>
      <noscript><button class="db-btn" type="submit">${e.enabled ? 'Pause' : 'Resume'}</button></noscript>
    </form>
  </td>
  <td class="db-muted">${schedule(context, e)}</td>
  <td class="db-right db-nums">${stats ? String(stats.seen) : '0'}</td>
  <td class="db-right db-nums">${percent(stats?.conversionRate ?? null)}</td>
  <td>
    <div class="db-rowactions">
      ${button('Results', { href: `${href}/results` })}
      <form method="post" action="${href}"><input type="hidden" name="action" value="duplicate">${button('Duplicate')}</form>
      <form method="post" action="${href}" data-confirm="Delete ${e.name || e.id}? Its stats stay, but it stops showing and cannot be brought back from here.">
        <input type="hidden" name="action" value="delete">
        ${button('Delete', { tone: 'danger' })}
      </form>
    </div>
  </td>
</tr>`;
}

function schedule(context: DashboardContext, e: Engagement): string {
  const when = (value: string) =>
    formatDateTime(value, { locale: context.locale, timeZone: context.timeZone });
  const { start, end } = e.schedule;
  const now = Date.now();
  if (end && Date.parse(end) <= now) return `Ended ${when(end)}`;
  if (start && Date.parse(start) > now)
    return `From ${when(start)}${end ? ` to ${when(end)}` : ''}`;
  if (end) return `Until ${when(end)}`;
  return 'Always';
}

/* ----------------------------------------------------------------- gallery */

export function galleryPage(context: DashboardContext): RawHtml {
  const base = `${context.basePath}/engage/new`;
  return html`${join(
    KINDS.map((kind) => {
      const templates = TEMPLATES.filter((t) => t.kind === kind);
      return html`<section class="en-gallery">
      <div class="en-gallery__head">${glyph(KIND_LOOK[kind].icon, KIND_LOOK[kind].tone)}<div>
        <h2 class="en-gallery__title">${PLURAL[kind]}</h2>
        <p class="en-gallery__hint">${KIND_HINTS[kind]}</p>
      </div></div>
      <div class="en-gallery__grid">
        ${join(
          templates.map(
            (t) => html`<a class="en-template" href="${base}?template=${t.key}">
          <span class="en-template__pic">${templatePicture(t.kind, t.key)}</span>
          <span class="en-template__text"><span class="en-template__title">${t.title}</span>
          <span class="en-template__desc">${t.description}</span></span>
        </a>`,
          ),
        )}
        <a class="en-template en-template--blank" href="${base}?template=blank-${kind}">
          <span class="en-template__pic en-template__pic--blank">${raw(kitIcon('plus', 18, 2))}</span>
          <span class="en-template__text"><span class="en-template__title">Blank ${KIND_LABELS[kind].toLowerCase()}</span>
          <span class="en-template__desc">Start from nothing.</span></span>
        </a>
      </div>
    </section>`;
    }),
  )}
${
  // With no repo there is no config file to write one into.
  managedContent(context)
    ? null
    : card(
        'Or write it as code',
        'Every engagement is JSON in the engage section of helpwell.config.json, and helpwell sync loads it. A coding agent can write one; the editor shows what it wrote.',
      )
}`;
}

/** A small drawing of what a template makes, for its card in the gallery. */
function templatePicture(kind: EngagementKind, key: string): RawHtml {
  switch (kind) {
    case 'modal':
      return modalLayout(key === 'feature-launch' ? 'side' : 'top');
    case 'banner':
      return bannerPosition('top', false);
    case 'hotspot':
      return beacon('pulse');
    case 'tour':
      return tourStep();
    case 'survey':
      return placement('corner');
  }
}
