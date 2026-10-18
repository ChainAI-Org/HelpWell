/**
 * The public changelog and roadmap pages.
 *
 * The changelog pages with a link rather than infinite scroll: on a full page
 * a "load more" link is a real URL, which the widget's scrolling feed cannot
 * be (CL-03).
 *
 * `changelog.groupBy` decides how the list reads: by version (each entry
 * led by its version tag) or by date (entries under month headings, each led
 * by its date, the version a quiet tag after it).
 */

import { html, icon, join, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { publicBase, type SiteContext, siteLink } from '../layout.js';
import { formatDate } from './article.js';

export interface ChangelogEntryView {
  id: string;
  version: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  coverUrl: string | null;
  publishedAt: Date | string | null;
  bodyHtml?: string;
}

export function changelogPage(
  site: SiteContext,
  data: { entries: ChangelogEntryView[]; nextCursor: string | null },
) {
  return html`
<div class="hc-shell hc-rise">
  <div class="hc-hero" style="padding-bottom:18px">
    <h1>What's new</h1>
    <p>Every change we ship to ${site.productName}.</p>
  </div>

  <div class="hc-narrow">
    ${
      data.entries.length === 0
        ? html`<div class="hc-empty"><h2>Nothing published yet</h2></div>`
        : site.changelogGroupBy === 'date'
          ? join(byMonth(site, data.entries))
          : join(data.entries.map((entry) => entryCard(site, entry)))
    }

    ${
      data.nextCursor
        ? html`<a class="hc-more" href="${siteLink(site, `/changelog?cursor=${encodeURIComponent(data.nextCursor)}`)}">Older updates</a>`
        : null
    }

    <p style="text-align:center;margin-top:26px;font-size:13.5px">
      <a href="${siteLink(site, '/changelog/rss.xml')}" style="display:inline-flex;align-items:center;gap:6px;color:var(--hw-muted);text-decoration:none">
        ${raw(icon('rss', 15))} Subscribe by RSS
      </a>
    </p>
  </div>
</div>`;
}

/** Entries under a heading for each month, in the product's locale and zone. */
function byMonth(site: SiteContext, entries: ChangelogEntryView[]): RawHtml[] {
  const out: RawHtml[] = [];
  let last = '';
  for (const entry of entries) {
    const month = monthLabel(entry.publishedAt, site);
    if (month && month !== last) {
      out.push(html`<h2 class="hc-month">${month}</h2>`);
      last = month;
    }
    out.push(entryCard(site, entry));
  }
  return out;
}

/** "September 2026". Empty for an entry with no date. */
export function monthLabel(
  value: Date | string | null,
  options: { locale?: string; timeZone?: string } = {},
): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const format = { year: 'numeric', month: 'long' } as const;
  try {
    return date.toLocaleDateString(options.locale?.trim() || 'en-GB', {
      ...format,
      timeZone: options.timeZone?.trim() || undefined,
    });
  } catch {
    return date.toLocaleDateString('en-GB', format);
  }
}

function entryCard(site: SiteContext, entry: ChangelogEntryView) {
  const version = entry.version ? html`<span class="hc-tag">${entry.version}</span>` : null;
  const date = html`<span class="hc-entry__date">${formatDate(entry.publishedAt ?? '', site)}</span>`;
  const byDate = site.changelogGroupBy === 'date';
  return html`
    <article class="hc-entry">
      <div class="hc-entry__top">
        ${byDate ? date : version}
        ${byDate ? version : date}
        ${join(entry.tags.map((tag) => html`<span class="hc-chip">${tag}</span>`))}
      </div>
      ${
        entry.coverUrl
          ? html`<img src="${raw(safeHref(entry.coverUrl))}" alt="" loading="lazy" style="border-radius:14px;margin-bottom:12px">`
          : null
      }
      <h2><a href="${siteLink(site, `/changelog/${encodeURIComponent(entry.version || entry.id)}`)}">${entry.title}</a></h2>
      ${entry.summary ? html`<p style="margin:0;color:var(--hw-ink2)">${entry.summary}</p>` : null}
    </article>`;
}

export function changelogEntryPage(site: SiteContext, entry: ChangelogEntryView) {
  return html`
<div class="hc-shell hc-rise">
  <nav class="hc-breadcrumb" aria-label="Breadcrumb">
    <a href="${siteLink(site, '/changelog')}">Changelog</a><span>/</span><span>${entry.title}</span>
  </nav>
  <article class="hc-narrow hc-article">
    <div class="hc-entry__top" style="margin-top:10px">
      ${entry.version ? html`<span class="hc-tag">${entry.version}</span>` : null}
      <span class="hc-entry__date">${formatDate(entry.publishedAt ?? '', site)}</span>
      ${join(entry.tags.map((tag) => html`<span class="hc-chip">${tag}</span>`))}
    </div>
    <h1>${entry.title}</h1>
    ${
      entry.coverUrl
        ? html`<img src="${raw(safeHref(entry.coverUrl))}" alt="" style="border-radius:16px;margin-bottom:20px">`
        : null
    }
    <div class="hc-body">${raw(entry.bodyHtml ?? '')}</div>
  </article>
</div>`;
}

/* -------------------------------------------------------------- roadmap */

export interface RoadmapCardView {
  id: string;
  title: string;
  body: string | null;
  votesCount: number;
}

export interface RoadmapView {
  under_review: RoadmapCardView[];
  planned: RoadmapCardView[];
  in_progress: RoadmapCardView[];
  shipped: RoadmapCardView[];
}

const LANES: { key: keyof RoadmapView; label: string; color: string }[] = [
  { key: 'in_progress', label: 'In progress', color: 'var(--hw-accent)' },
  { key: 'planned', label: 'Planned', color: 'var(--hw-info)' },
  { key: 'under_review', label: 'Under review', color: 'var(--hw-muted)' },
  { key: 'shipped', label: 'Shipped', color: 'var(--hw-good)' },
];

export function roadmapPage(site: SiteContext, board: RoadmapView) {
  const total = LANES.reduce((sum, lane) => sum + (board[lane.key]?.length ?? 0), 0);

  return html`
<div class="hc-shell hc-rise">
  <div class="hc-hero" style="padding-bottom:22px">
    <h1>Roadmap</h1>
    <p>What we are building next in ${site.productName}, and what has already shipped.</p>
  </div>

  ${
    total === 0
      ? html`<div class="hc-empty"><h2>Nothing on the roadmap yet</h2></div>`
      : html`<div class="hc-board">
          ${join(
            LANES.map(
              (lane) => html`
                <section>
                  <div class="hc-lane__head">
                    <span class="hc-lane__dot" style="background:${raw(lane.color)}"></span>
                    <span class="hc-lane__name">${lane.label}</span>
                    <span class="hc-lane__count">${(board[lane.key] ?? []).length}</span>
                  </div>
                  ${join(
                    (board[lane.key] ?? []).map(
                      (card) => html`
                        <div class="hc-idea">
                          <div style="flex:1;min-width:0">
                            <h3>${card.title}</h3>
                            ${card.body ? html`<p>${card.body}</p>` : null}
                          </div>
                          <div class="hc-votes">${raw(icon('arrowUp', 13))}${card.votesCount}<span>votes</span></div>
                        </div>`,
                    ),
                  )}
                </section>`,
            ),
          )}
        </div>`
  }

  <p style="text-align:center;margin-top:34px;color:var(--hw-muted);font-size:14px">
    Want to vote or suggest something? Open the assistant in the corner.
  </p>
</div>`;
}

/* ------------------------------------------------------------------ feeds */

export function changelogRss(site: SiteContext, entries: ChangelogEntryView[]): string {
  const base = publicBase(site);
  const items = entries
    .map((entry) => {
      const link = `${base}/changelog/${encodeURIComponent(entry.version || entry.id)}`;
      const date = entry.publishedAt ? new Date(entry.publishedAt).toUTCString() : '';
      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>
      ${date ? `<pubDate>${date}</pubDate>` : ''}
      <description>${escapeXml(entry.summary ?? '')}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.productName)} changelog</title>
    <link>${escapeXml(`${base}/changelog`)}</link>
    <description>Product updates for ${escapeXml(site.productName)}</description>
${items}
  </channel>
</rss>`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
