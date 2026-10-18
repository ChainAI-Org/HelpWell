/**
 * How one engagement is doing: its counts for a range, where people leave a
 * tour, and what a survey's answers add up to, with every response in a
 * table and a CSV of the lot.
 */

import type {
  Engagement,
  EngagementResults,
  QuestionResult,
  SurveyEngagement,
  SurveySession,
} from '@helpwell/core/repos';
import { html, join, type RawHtml } from '@helpwell/ui';
import {
  button,
  card,
  empty,
  formatDateTime,
  percent,
  rankedBars,
  segment,
  stat,
} from '../components.js';
import type { DashboardContext } from '../layout.js';
import { KIND_LABELS } from './templates.js';

export const RANGES = ['7d', '30d', '90d'] as const;
export type Range = (typeof RANGES)[number];

export function rangeFrom(value: string | null): Range {
  return RANGES.find((r) => r === value) ?? '30d';
}

export function sinceFor(range: Range, now = new Date()): Date {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  return new Date(now.getTime() - days * 86_400_000);
}

const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export function resultsPage(
  context: DashboardContext,
  engagement: Engagement,
  results: EngagementResults,
  sessions: readonly SurveySession[],
  range: Range,
): RawHtml {
  const base = `${context.basePath}/engage/${encodeURIComponent(engagement.id)}`;
  const s = results.stats;
  const goal = engagement.kind === 'tour' || engagement.kind === 'survey' ? 'finished' : 'clicked';

  return html`<div class="db-toolbar">
  ${segment(
    RANGES.map((r) => ({
      label: RANGE_LABELS[r],
      href: `${base}/results?range=${r}`,
      current: r === range,
    })),
  )}
  <span style="flex:1"></span>
  ${button('Edit', { href: base, glyph: 'engage' })}
</div>
<div class="db-grid db-grid--4" style="margin-bottom:14px">
  ${stat('Impressions', String(s.seen))}
  ${stat('Clicks', String(s.clicked))}
  ${stat('Dismissals', String(s.dismissed))}
  ${stat('Completions', String(s.completed))}
</div>
${card(
  'Conversion',
  `The share of impressions that ${goal}${engagement.kind === 'hotspot' ? ' (opening the beacon counts)' : ''}.`,
  html`<p class="en-big db-nums">${percent(s.conversionRate, 1)}</p>
  <p class="db-muted">${s.conversions} of ${s.seen}, from ${s.people} ${s.people === 1 ? 'person' : 'people'}.</p>`,
)}
${results.funnel ? funnelCard(engagement, results.funnel) : null}
${results.survey ? surveyCards(context, engagement as SurveyEngagement, results, sessions, range) : null}`;
}

function funnelCard(
  engagement: Engagement,
  funnel: NonNullable<EngagementResults['funnel']>,
): RawHtml {
  if (funnel.every((step) => step.people === 0)) {
    return card(
      'Drop-off by step',
      null,
      html`<p class="db-muted">Nobody has started this tour in this range.</p>`,
    );
  }
  return card(
    'Drop-off by step',
    'How many people saw each step, and how many the step before lost.',
    rankedBars(
      funnel.map((step) => ({
        label: `Step ${step.step}`,
        value: step.people,
        suffix: `${step.people}${step.dropOff === null ? '' : ` (−${percent(step.dropOff)})`}`,
      })),
    ),
    engagement.kind === 'tour'
      ? html`<p class="db-field__hint">A step skipped because its element was missing counts as not seen.</p>`
      : null,
  );
}

function surveyCards(
  context: DashboardContext,
  survey: SurveyEngagement,
  results: EngagementResults,
  sessions: readonly SurveySession[],
  range: Range,
): RawHtml {
  const data = results.survey!;
  const csv = `${context.basePath}/engage/${encodeURIComponent(survey.id)}/responses.csv?range=${range}`;
  return html`${join(data.questions.map((q) => questionCard(q)))}
${card(
  `Responses (${data.sessions})`,
  'One row per person going through the survey, newest first. The most recent 50 are shown; the CSV has all of them in the range.',
  html`<div class="db-toolbar">${button('Export CSV', { href: csv, glyph: 'download' })}</div>`,
  sessions.length === 0
    ? empty('engage', 'No responses yet', 'Answers appear here as soon as they are given.')
    : html`<div class="db-tablewrap"><table class="db-table">
      <thead><tr><th>When</th><th>Who</th>${join(
        survey.survey.questions.map((q) => html`<th title="${q.prompt}">${q.id}</th>`),
      )}</tr></thead>
      <tbody>${join(
        sessions.slice(0, 50).map(
          (row) => html`<tr>
          <td class="db-nums">${formatDateTime(row.at, { locale: context.locale, timeZone: context.timeZone })}</td>
          <td>${
            row.contactId
              ? html`<a class="db-link" href="${context.basePath}/contacts/${encodeURIComponent(row.contactId)}">${row.name ?? row.email ?? 'Visitor'}</a>`
              : 'Anonymous'
          }</td>
          ${join(survey.survey.questions.map((q) => html`<td>${answerText(row, q.id)}</td>`))}
        </tr>`,
        ),
      )}</tbody>
    </table></div>`,
)}`;
}

function answerText(row: SurveySession, questionId: string): string {
  const a = row.answers[questionId];
  if (!a) return '—';
  const picked = a.score !== null ? String(a.score) : a.choices ? a.choices.join(', ') : a.choice;
  if (picked === null) return a.comment ?? '—';
  return a.comment ? `${picked}: ${a.comment}` : picked;
}

function questionCard(q: QuestionResult): RawHtml {
  const title = q.prompt || q.questionId;
  const answers = `${q.answers} ${q.answers === 1 ? 'answer' : 'answers'}`;
  if (q.answers === 0) {
    return card(title, answers, html`<p class="db-muted">No answers in this range.</p>`);
  }
  switch (q.kind) {
    case 'nps': {
      const nps = q.nps!;
      return card(
        title,
        `${answers}. NPS is the share of promoters (9 and 10) minus the share of detractors (0 to 6).`,
        html`<div class="db-grid db-grid--4">
          ${stat('NPS', nps.score === null ? '—' : String(nps.score))}
          ${stat('Promoters', String(nps.promoters))}
          ${stat('Passives', String(nps.passives))}
          ${stat('Detractors', String(nps.detractors))}
        </div>`,
        distribution(q),
        comments(q),
      );
    }
    case 'csat':
    case 'stars':
      return card(
        title,
        answers,
        html`<p class="en-big db-nums">${q.average === null ? '—' : q.average.toFixed(1)} <span class="db-muted">out of 5</span></p>`,
        distribution(q),
        comments(q),
      );
    case 'single':
    case 'multi':
      return card(
        title,
        q.kind === 'multi' ? `${answers}. Each person could pick several.` : answers,
        rankedBars(q.choices.map((c) => ({ label: c.choice, value: c.count }))),
        comments(q),
      );
    case 'text':
      return card(title, answers, comments(q));
  }
}

function distribution(q: QuestionResult): RawHtml {
  return html`<div style="margin-top:12px">${rankedBars(
    q.distribution.map((d) => ({ label: String(d.value), value: d.count })),
  )}</div>`;
}

function comments(q: QuestionResult): RawHtml | null {
  if (q.comments.length === 0) return null;
  return html`<ul class="en-comments">${join(
    q.comments.map(
      (c) =>
        html`<li>${c.score === null ? null : html`<span class="db-pill db-pill--neutral">${c.score}</span> `}${c.text}</li>`,
    ),
  )}</ul>`;
}

export function resultsHeader(engagement: Engagement): { title: string; subtitle: string } {
  return {
    title: engagement.name || engagement.id,
    subtitle: `${KIND_LABELS[engagement.kind]} results`,
  };
}
