/**
 * Reports.
 *
 * Six questions, in the order someone running support actually asks them: is
 * the agent resolving things, what is it being asked, what is it costing,
 * which articles are carrying the load, what are people searching for that
 * finds nothing, and is anything being blocked.
 *
 * Everything on it, the CSV export included, is served by the dashboard
 * itself, so it works wherever the dashboard does: embedded in a host's own
 * shell, limited to a few pages, or on an install whose models come from the
 * host rather than an OpenRouter key of its own.
 */

import type { SpendStatus } from '@helpwell/core/agent';
import type { Db } from '@helpwell/core/db';
import {
  type DateRange,
  dailySeries,
  type ReportBundle,
  rangeFor,
  seriesToCsv,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, slugPath } from '@helpwell/ui';
import {
  barChart,
  button,
  card,
  duration,
  money,
  notice,
  percent,
  pill,
  rankedBars,
  segment,
  stat,
  underCard,
} from '../components.js';
import { type DashboardContext, pageAllowed } from '../layout.js';
import { bucketSeries, MONTHLY_ABOVE, WEEKLY_ABOVE } from '../series.js';

export const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
] as const;

export interface ReportsPageOptions {
  /**
   * Whether the install pays for its models with its own OpenRouter key, as
   * the Spend card says. False when a host's model factory supplies them.
   * Default true.
   */
  ownKey?: boolean;
}

export function reportsPage(
  context: DashboardContext,
  report: ReportBundle,
  spend: SpendStatus,
  range: string,
  options: ReportsPageOptions = {},
): RawHtml {
  const base = `${context.basePath}/reports`;
  // A link to an article only where the knowledge base is one of the pages served.
  const articleLinks = pageAllowed(context, 'knowledge');
  const head = report.headline;
  const unit =
    report.series.length > MONTHLY_ABOVE
      ? 'month'
      : report.series.length > WEEKLY_ABOVE
        ? 'week'
        : 'day';
  const seriesHint =
    unit === 'day'
      ? 'Every day in the range, including the quiet ones.'
      : `By ${unit}: this range has more days than a chart can show one by one.`;

  return html`
<div class="db-toolbar">
  ${segment(
    RANGES.map((option) => ({
      label: option.label,
      href: `${base}?range=${option.value}`,
      current: range === option.value,
    })),
  )}
  <div style="margin-inline-start:auto">
    ${button('Export CSV', {
      href: `${base}/export?range=${encodeURIComponent(range)}`,
      glyph: 'download',
    })}
  </div>
</div>

${spendBanner(spend, pageAllowed(context, 'settings'))}

<div class="db-grid db-grid--4" style="margin-bottom:16px">
  ${stat('Conversations', String(head.conversations))}
  ${stat('Resolved', percent(head.resolutionRate))}
  ${stat('Median reply', duration(head.medianLatencyMs))}
  ${stat('Cost', money(head.costUsd))}
</div>

${card(
  'Conversations over time',
  seriesHint,
  barChart(bucketSeries(report.series), `Conversations by ${unit}`),
)}
${underCard('lavender', `${head.resolved} of ${head.conversations} resolved by the agent`)}

<div class="db-grid db-grid--2" style="margin-top:16px">
  ${card(
    'What people ask about',
    'Topics the agent assigned, most common first.',
    rankedBars(
      report.topics.map((topic) => ({
        label: topic.topic,
        value: topic.count,
        suffix: String(topic.count),
      })),
    ),
  )}

  ${card(
    'Searches',
    'What people typed. Red means it found nothing.',
    report.searches.length === 0
      ? html`<p class="db-muted">No searches in this range.</p>`
      : html`<div class="db-bars">${join(
          report.searches.slice(0, 10).map(
            (row) => html`<div class="db-bars__row">
          <span class="db-truncate" title="${row.query}">${row.query}</span>
          <span>${row.zeroResults ? pill('bad', 'No results') : pill('neutral', 'Found')}</span>
          <span class="db-bars__value">${String(row.count)}</span>
        </div>`,
          ),
        )}</div>`,
  )}
</div>

<div style="margin-top:16px">
${card(
  'Articles doing the work',
  'Which docs the agent cites, and whether those answers landed.',
  report.articles.length === 0
    ? html`<p class="db-muted">No answers have cited an article in this range.</p>`
    : html`<div class="db-tablewrap" style="border:0">
        <table class="db-table">
          <thead><tr><th>Article</th><th>Collection</th><th>Cited</th><th>Helpful</th><th>Not helpful</th></tr></thead>
          <tbody>
            ${join(
              report.articles.map(
                (article) => html`
            <tr>
              <td>${
                articleLinks
                  ? html`<a href="${context.basePath}/knowledge/${slugPath(article.slug)}">${article.title}</a>`
                  : article.title
              }</td>
              <td class="db-muted">${article.collection}</td>
              <td class="db-nums">${String(article.citations)}</td>
              <td class="db-nums">${String(article.helpful)}</td>
              <td class="db-nums">${String(article.unhelpful)}</td>
            </tr>`,
              ),
            )}
          </tbody>
        </table>
      </div>`,
)}

${card(
  'Spend',
  options.ownKey === false
    ? 'By day and model.'
    : 'By day and model, from your own OpenRouter key.',
  report.spend.length === 0
    ? html`<p class="db-muted">Nothing spent in this range.</p>`
    : html`<div class="db-tablewrap" style="border:0">
        <table class="db-table">
          <thead><tr><th>Day</th><th>Kind</th><th>Model</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead>
          <tbody>
            ${join(
              report.spend.slice(0, 30).map(
                (row) => html`
            <tr>
              <td>${row.day}</td>
              <td>${pill('neutral', row.kind)}</td>
              <td class="db-muted">${row.model}</td>
              <td class="db-nums">${row.tokensIn.toLocaleString()}</td>
              <td class="db-nums">${row.tokensOut.toLocaleString()}</td>
              <td class="db-nums">${money(row.costUsd)}</td>
            </tr>`,
              ),
            )}
          </tbody>
        </table>
      </div>`,
)}
</div>

<div class="db-grid db-grid--2" style="margin-top:16px">
  ${stat('Helpful votes', String(head.helpfulVotes))}
  ${stat('Not helpful', String(head.unhelpfulVotes))}
</div>`;
}

function spendBanner(spend: SpendStatus, settings: boolean): RawHtml | null {
  if (!spend.allowed) {
    return notice(
      'bad',
      settings
        ? html`The daily spend cap of ${money(spend.capUsd)} has been reached. The agent is answering
    from search alone until tomorrow, or until you raise the cap in Settings.`
        : html`The daily spend cap of ${money(spend.capUsd)} has been reached. The agent is answering
    from search alone until tomorrow.`,
    );
  }
  if (spend.warning) {
    return notice(
      'warn',
      html`${money(spend.spentTodayUsd)} of today's ${money(spend.capUsd)} cap used.`,
    );
  }
  return null;
}

/** The range presets the page and its export take; anything else is the default, 30 days. */
export function rangePreset(value: string | null): '7d' | '30d' | '90d' | 'today' | 'all' {
  const known = ['7d', '30d', '90d', 'today', 'all'] as const;
  return known.find((option) => option === value) ?? '30d';
}

/**
 * GET `/reports/export?range=`: conversations by day as CSV, the same file
 * the API's `/admin/reports/export` gives, from the dashboard itself, so
 * the button works behind the dashboard's own sign-in, embedded or not.
 */
export async function reportsExport(db: Db, url: URL): Promise<Response> {
  const range: DateRange = rangeFor(rangePreset(url.searchParams.get('range')));
  return new Response(seriesToCsv(await dailySeries(db, range)), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="helpwell-report.csv"',
      'cache-control': 'no-store',
    },
  });
}
