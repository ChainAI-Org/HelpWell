/**
 * How one form is doing, and everything it collected.
 *
 *   Results      views, sign-ups and conversion over a range, by day, by
 *                variant (with which one is winning and how sure that is),
 *                by placement and by page, where sign-ups came from, and why
 *                submissions were rejected. For a giveaway, entries,
 *                referrals and the viral coefficient.
 *   Submissions  every submission, filterable, with its verdict, a link to
 *                the contact, and CSV.
 *   Giveaway     entrants, the draw and its record, redraws, CSVs.
 *   Versions     every saved version, and bringing one back.
 */

import type {
  Form,
  FormAnalytics,
  FormSubmission,
  FormVersionSummary,
  GiveawayEntry,
  GiveawayStats,
  GiveawayWinner,
  SubmissionPage,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import {
  barChart,
  button,
  card,
  empty,
  formatDateTime,
  percent,
  pill,
  rankedBars,
  searchBox,
  segment,
  stat,
} from '../components.js';
import type { DashboardContext } from '../layout.js';
import { PLACEMENT_LABELS, REASON_LABELS, TYPE_LABELS } from './labels.js';
import { RANGES, type Range } from './list.js';

const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

function tabs(context: DashboardContext, form: Form, current: string): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  const items = [
    { label: 'Build', href: base, key: 'build' },
    { label: 'Results', href: `${base}/results`, key: 'results' },
    { label: 'Submissions', href: `${base}/submissions`, key: 'submissions' },
    ...(form.definition.type === 'giveaway'
      ? [{ label: 'Giveaway', href: `${base}/giveaway`, key: 'giveaway' }]
      : []),
    { label: 'Versions', href: `${base}/versions`, key: 'versions' },
  ];
  return segment(items.map((i) => ({ label: i.label, href: i.href, current: i.key === current })));
}

export function formHeader(form: Form): { title: string; subtitle: string } {
  return {
    title: form.name || form.id,
    subtitle: `${TYPE_LABELS[form.type]} · ${form.id} · version ${form.version}${form.enabled ? ' · live' : ' · off'}`,
  };
}

/* ------------------------------------------------------------------ results */

export function resultsPage(
  context: DashboardContext,
  form: Form,
  analytics: FormAnalytics,
  range: Range,
): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  const t = analytics.totals;
  return html`<div class="db-toolbar">
  ${tabs(context, form, 'results')}
  <span style="flex:1"></span>
  ${segment(RANGES.map((r) => ({ label: RANGE_LABELS[r], href: `${base}/results?range=${r}`, current: r === range })))}
</div>
<div class="db-grid db-grid--4">
  ${stat('Views', t.views.toLocaleString('en'))}
  ${stat('Unique views', t.uniques.toLocaleString('en'))}
  ${stat('Trusted sign-ups', t.trusted.toLocaleString('en'))}
  ${stat('Converted', percent(t.conversionRate, 1))}
</div>
<p class="db-muted fb-note">Converted is trusted sign-ups over unique views (one per person per day). ${t.rejected} rejected, ${t.duplicates} repeat${t.duplicates === 1 ? '' : 's'}, ${t.blocked} refused before they were stored.</p>
${card(
  'Sign-ups by day',
  null,
  barChart(
    analytics.daily.map((d) => ({ label: d.day.slice(5), value: d.trusted })),
    'Trusted sign-ups by day',
  ),
)}
<div class="db-grid db-grid--2 fb-results">
  ${analytics.variants.length > 1 ? variantsCard(analytics) : null}
  ${card(
    'By placement',
    null,
    analytics.placements.length === 0
      ? html`<p class="db-muted">No views yet.</p>`
      : table(
          ['Placement', 'Views', 'Sign-ups', 'Converted'],
          analytics.placements.map((p) => [
            PLACEMENT_LABELS[p.placement as keyof typeof PLACEMENT_LABELS] ?? p.placement,
            String(p.views),
            String(p.trusted),
            percent(p.conversionRate, 1),
          ]),
        ),
  )}
  ${card(
    'Top pages',
    null,
    analytics.pages.length === 0
      ? html`<p class="db-muted">No views yet.</p>`
      : table(
          ['Page', 'Views', 'Sign-ups', 'Converted'],
          analytics.pages.map((p) => [
            p.page,
            String(p.views),
            String(p.trusted),
            percent(p.conversionRate, 1),
          ]),
        ),
  )}
  ${card(
    'Where sign-ups came from',
    null,
    analytics.referrers.length === 0
      ? html`<p class="db-muted">No submissions yet.</p>`
      : rankedBars(
          analytics.referrers.map((r) => ({
            label: r.referrer,
            value: r.trusted,
            suffix: `${r.trusted} of ${r.submissions}`,
          })),
        ),
  )}
  ${card(
    'Rejected, and why',
    'A rejected submission touches no contact and is never sent anywhere.',
    analytics.rejections.length === 0
      ? html`<p class="db-muted">Nothing rejected.</p>`
      : rankedBars(
          analytics.rejections.map((r) => ({
            label: REASON_LABELS[r.reason] ?? r.label,
            value: r.count,
          })),
        ),
  )}
  ${analytics.giveaway ? giveawayStatsCard(analytics.giveaway) : null}
</div>
<p>${button('All submissions', { href: `${base}/submissions` })} ${button('Download CSV', { href: `${base}/submissions.csv`, glyph: 'download' })}</p>`;
}

function variantsCard(analytics: FormAnalytics): RawHtml {
  const verdict = analytics.verdict;
  return card(
    'A/B test',
    verdict?.note ?? null,
    table(
      ['Variant', 'Unique views', 'Sign-ups', 'Converted'],
      analytics.variants.map((v) => [
        `${v.name || v.variant.toUpperCase()}${verdict?.leader === v.variant && verdict.significant ? ' (winning)' : ''}`,
        String(v.uniques),
        String(v.submissions),
        percent(v.conversionRate, 1),
      ]),
    ),
  );
}

function giveawayStatsCard(g: GiveawayStats): RawHtml {
  return card(
    'Giveaway',
    'The viral coefficient is credited referrals per trusted entrant: above 1, each entrant brings in more than one more.',
    html`<div class="db-grid db-grid--2">
      ${stat('Entrants', `${g.trustedEntrants} trusted of ${g.entrants}`)}
      ${stat('Entries in the draw', String(g.totalEntries))}
      ${stat('Referrals', `${g.creditedReferrals} credited of ${g.referrals}`)}
      ${stat('Viral coefficient', g.viralCoefficient === null ? '—' : g.viralCoefficient.toFixed(2))}
    </div>`,
  );
}

function table(head: string[], rows: string[][]): RawHtml {
  return html`<div class="db-tablewrap"><table class="db-table">
  <thead><tr>${join(head.map((h, i) => html`<th${i > 0 ? raw(' class="db-right"') : null}>${h}</th>`))}</tr></thead>
  <tbody>${join(rows.map((r) => html`<tr>${join(r.map((c, i) => html`<td${i > 0 ? raw(' class="db-right db-nums"') : null}>${c}</td>`))}</tr>`))}</tbody>
</table></div>`;
}

/* -------------------------------------------------------------- submissions */

export interface SubmissionsQuery {
  status: string;
  q: string;
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'trusted', label: 'Trusted' },
  { value: 'untrusted', label: 'Accepted, untrusted' },
  { value: 'duplicate', label: 'Repeats' },
  { value: 'rejected', label: 'Rejected' },
];

export function submissionsPage(
  context: DashboardContext,
  form: Form,
  page: SubmissionPage,
  query: SubmissionsQuery,
): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  const link = (patch: Partial<SubmissionsQuery> & { cursor?: string }) => {
    const next = { ...query, ...patch };
    const search = new URLSearchParams();
    if (next.status) search.set('status', next.status);
    if (next.q) search.set('q', next.q);
    if (patch.cursor) search.set('cursor', patch.cursor);
    const text = search.toString();
    return `${base}/submissions${text ? `?${text}` : ''}`;
  };
  const csv = `${base}/submissions.csv${query.status ? `?status=${encodeURIComponent(query.status)}` : ''}`;
  return html`<div class="db-toolbar">
  ${tabs(context, form, 'submissions')}
  <span style="flex:1"></span>
  ${button('Download CSV', { href: csv, glyph: 'download' })}
</div>
<div class="db-toolbar">
  ${segment(STATUS_FILTERS.map((s) => ({ label: s.label, href: link({ status: s.value }), current: query.status === s.value })))}
  ${searchBox(`${base}/submissions`, query.q, 'Search by email or name')}
</div>
${
  page.items.length === 0
    ? empty(
        'inbox',
        'No submissions here',
        'Submissions show up here as they arrive, rejected ones too, each with the checks it passed or failed.',
      )
    : html`<div class="db-tablewrap"><table class="db-table">
  <thead><tr><th>When</th><th>Email</th><th>Status</th><th>Where</th><th>Variant</th><th>Answers</th></tr></thead>
  <tbody>${join(page.items.map((s) => submissionRow(context, form, s)))}</tbody>
</table></div>
${page.nextCursor ? html`<p>${button('Older', { href: link({ cursor: page.nextCursor }) })}</p>` : null}`
}`;
}

function statusPill(s: FormSubmission): RawHtml {
  if (s.status === 'rejected') {
    return pill('bad', `Rejected: ${s.reasons.map((r) => REASON_LABELS[r] ?? r).join(', ')}`);
  }
  if (s.status === 'duplicate') return pill('neutral', 'Repeat');
  return s.trusted ? pill('good', 'Trusted') : pill('warn', 'Accepted, untrusted');
}

function submissionRow(context: DashboardContext, form: Form, s: FormSubmission): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  const answers = Object.entries(s.fields)
    .filter(([key]) => key !== 'email')
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ');
  return html`<tr>
  <td><a class="db-link" href="${base}/submissions/${encodeURIComponent(s.id)}">${formatDateTime(s.createdAt, { locale: context.locale, timeZone: context.timeZone })}</a></td>
  <td>${s.contactId ? html`<a class="db-link" href="${context.basePath}/contacts/${encodeURIComponent(s.contactId)}">${s.email ?? ''}</a>` : (s.email ?? '')}</td>
  <td>${statusPill(s)}</td>
  <td class="db-muted">${PLACEMENT_LABELS[s.placement as keyof typeof PLACEMENT_LABELS] ?? s.placement}${s.pagePath ? html` · <code>${s.pagePath}</code>` : null}</td>
  <td class="db-muted">${s.variant.toUpperCase()}</td>
  <td class="db-muted db-truncate">${answers}</td>
</tr>`;
}

export function submissionDetail(
  context: DashboardContext,
  form: Form,
  s: FormSubmission,
): RawHtml {
  const verdict = s.verdict as Record<string, unknown>;
  const rows: [string, string][] = [
    [
      'Status',
      s.status === 'accepted'
        ? s.trusted
          ? 'Accepted, trusted'
          : 'Accepted, not trusted'
        : s.status === 'duplicate'
          ? 'A repeat of an earlier one'
          : 'Rejected',
    ],
    ['Reasons', s.reasons.map((r) => REASON_LABELS[r] ?? r).join(', ') || 'None'],
    ['Bot check', String(verdict.turnstile ?? 'off')],
    ['Hidden field', verdict.honeypot ? 'Filled in' : 'Empty'],
    [
      'Time to fill in',
      typeof verdict.fillMs === 'number' ? `${(verdict.fillMs / 1000).toFixed(1)} seconds` : '—',
    ],
    ['Rate limited', verdict.rateLimited ? 'Yes' : 'No'],
    ['Throwaway address', verdict.disposable ? 'Yes' : 'No'],
    ['Mail server on the domain', String(verdict.mx ?? 'unchecked')],
    [
      'Consent',
      s.consent === 'none'
        ? 'No consent box'
        : `${s.consent}${s.consentText ? `: “${s.consentText}”` : ''}`,
    ],
    ['Page', s.pageUrl ?? s.pagePath ?? '—'],
    ['Came from', s.referrer ?? 'Direct'],
    [
      'UTM',
      Object.entries(s.utm)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || '—',
    ],
    ['Placement and variant', `${s.placement}, ${s.variant}`],
    ['Form version', String(s.formVersion)],
  ];
  return html`${tabs(context, form, 'submissions')}
${card(
  s.email ?? 'Submission',
  formatDateTime(s.createdAt, { locale: context.locale, timeZone: context.timeZone }),
  html`<dl class="db-kv">${join(Object.entries(s.fields).map(([k, v]) => html`<dt>${k}</dt><dd>${Array.isArray(v) ? v.join(', ') : String(v)}</dd>`))}</dl>`,
  s.contactId
    ? button('Open the contact', {
        href: `${context.basePath}/contacts/${encodeURIComponent(s.contactId)}`,
      })
    : null,
)}
${card('The verdict', 'Every check this submission went through, as stored with it.', html`<dl class="db-kv">${join(rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`))}</dl>`)}`;
}

/* ---------------------------------------------------------------- giveaway */

export function giveawayPage(
  context: DashboardContext,
  form: Form,
  input: {
    stats: GiveawayStats;
    entries: (GiveawayEntry & { referrals: number })[];
    winners: GiveawayWinner[];
    flash?: RawHtml | null;
  },
): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  const g = form.definition.giveaway;
  const byEntry = new Map(input.entries.map((e) => [e.id, e]));
  const active = input.winners.filter((w) => w.status === 'selected');
  return html`${input.flash ?? null}
<div class="db-toolbar">
  ${tabs(context, form, 'giveaway')}
  <span style="flex:1"></span>
  ${button('Entrants CSV', { href: `${base}/giveaway/entrants.csv`, glyph: 'download' })}
  ${button('Winners CSV', { href: `${base}/giveaway/winners.csv`, glyph: 'download' })}
</div>
<div class="db-grid db-grid--4">
  ${stat('Trusted entrants', `${input.stats.trustedEntrants}`)}
  ${stat('Entries in the draw', `${input.stats.totalEntries}`)}
  ${stat('Credited referrals', `${input.stats.creditedReferrals}`)}
  ${stat('Viral coefficient', input.stats.viralCoefficient === null ? '—' : input.stats.viralCoefficient.toFixed(2))}
</div>
${card(
  'Draw winners',
  'Each trusted entry is weighed by its entries. The seed and a hash of every eligible entry are recorded, so anyone given the seed and the entries can repeat the draw and get the same winners. Leave the seed empty for a random one.',
  html`<form method="post" action="${base}/giveaway" class="fb-draw">
    <input type="hidden" name="action" value="draw">
    <label class="db-field"><span class="db-field__label">How many</span><input class="db-input" type="number" name="count" min="1" max="100" value="1"></label>
    <label class="db-field"><span class="db-field__label">Seed (optional)</span><input class="db-input" name="seed" maxlength="128"></label>
    ${button('Draw', { glyph: 'sparkle', tone: 'primary' })}
  </form>
  <p class="db-muted">${g.endsAt && Date.parse(g.endsAt) > Date.now() ? 'The giveaway is still open: a draw now leaves out anyone who enters later.' : ''}</p>`,
)}
${card(
  'Winners',
  'Every draw and redraw, in order. Nothing here is ever deleted.',
  input.winners.length === 0
    ? html`<p class="db-muted">No draw yet.</p>`
    : html`<div class="db-tablewrap"><table class="db-table">
  <thead><tr><th>#</th><th>Email</th><th>Entries</th><th>Status</th><th>Draw record</th><th></th></tr></thead>
  <tbody>${join(
    input.winners.map(
      (w) => html`<tr>
    <td class="db-nums">${String(w.position)}</td>
    <td>${w.email || byEntry.get(w.entryId)?.email || '(erased)'}</td>
    <td class="db-nums">${String(w.entries)}</td>
    <td>${w.status === 'selected' ? pill('good', 'Winner') : pill('neutral', `Redrawn: ${w.reason ?? ''}`)}</td>
    <td class="db-muted"><code>seed ${w.seed}</code> · ${String(w.snapshotSize)} entries, weight ${String(w.totalWeight)} · <code title="SHA-256 of the eligible entries">${w.snapshotHash.slice(0, 12)}…</code></td>
    <td>${
      w.status === 'selected'
        ? html`<form method="post" action="${base}/giveaway" class="en-inline-form">
      <input type="hidden" name="action" value="redraw"><input type="hidden" name="winner" value="${w.id}">
      <input class="db-input" name="reason" required placeholder="Why, e.g. no reply in 7 days" aria-label="Why redraw">
      ${button('Redraw')}
    </form>`
        : null
    }</td>
  </tr>`,
    ),
  )}</tbody>
</table></div>`,
)}
${card(
  'Entrants',
  `Most entries first. ${active.length} winner${active.length === 1 ? '' : 's'} so far.`,
  input.entries.length === 0
    ? html`<p class="db-muted">No entries yet.</p>`
    : html`<div class="db-tablewrap"><table class="db-table">
  <thead><tr><th>Email</th><th class="db-right">Entries</th><th class="db-right">Referrals</th><th>Trusted</th><th></th></tr></thead>
  <tbody>${join(
    input.entries.map(
      (e) => html`<tr>
    <td>${e.contactId ? html`<a class="db-link" href="${context.basePath}/contacts/${encodeURIComponent(e.contactId)}">${e.email}</a>` : e.email}</td>
    <td class="db-right db-nums">${String(e.entries)}</td>
    <td class="db-right db-nums">${String(e.referrals)}</td>
    <td>${e.disqualified ? pill('bad', 'Disqualified') : e.trusted ? pill('good', 'Yes') : pill('warn', 'No')}</td>
    <td><form method="post" action="${base}/giveaway" class="en-inline-form">
      <input type="hidden" name="action" value="disqualify"><input type="hidden" name="entry" value="${e.id}">
      <input type="hidden" name="disqualified" value="${e.disqualified ? 'false' : 'true'}">
      ${button(e.disqualified ? 'Put back' : 'Disqualify')}
    </form></td>
  </tr>`,
    ),
  )}</tbody>
</table></div>`,
)}`;
}

/* ---------------------------------------------------------------- versions */

export function versionsPage(
  context: DashboardContext,
  form: Form,
  versions: FormVersionSummary[],
  flash: RawHtml | null,
): RawHtml {
  const base = `${context.basePath}/forms/${encodeURIComponent(form.id)}`;
  return html`${flash}
<div class="db-toolbar">${tabs(context, form, 'versions')}<span style="flex:1"></span>${button('Export JSON', { href: `${base}/export`, glyph: 'download' })}</div>
${card(
  'Every saved version',
  'Bringing one back saves it as a new version, so nothing is lost. Submissions record the version they came through.',
  html`<div class="db-tablewrap"><table class="db-table">
  <thead><tr><th>Version</th><th>Saved</th><th>Note</th><th></th></tr></thead>
  <tbody>${join(
    versions.map(
      (v) => html`<tr>
    <td class="db-nums">${String(v.version)}${v.version === form.version ? html` ${pill('accent', 'Current')}` : null}</td>
    <td>${formatDateTime(v.createdAt, { locale: context.locale, timeZone: context.timeZone })}</td>
    <td class="db-muted">${v.note ?? ''}</td>
    <td>${
      v.version === form.version
        ? null
        : html`<form method="post" action="${base}" class="en-inline-form"><input type="hidden" name="action" value="restore"><input type="hidden" name="version" value="${v.version}">${button('Bring back')}</form>`
    }</td>
  </tr>`,
    ),
  )}</tbody>
</table></div>`,
)}`;
}
