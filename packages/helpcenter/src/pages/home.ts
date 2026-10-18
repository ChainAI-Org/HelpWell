/**
 * The help centre home page and the search results page.
 *
 * Search is a real page with its own URL rather than a dropdown, so a result
 * can be linked to, opened in a tab, and indexed (HC-04).
 *
 * The home page carries the help centre theme from Settings: the hero style,
 * and collection cards with or without the tinted under card. The under card
 * says how many articles a collection has and when it last changed, because
 * docs that keep themselves current are the point, and the date shows it.
 */

import { html, icon, iconOr, join, type RawHtml, raw, slugPath } from '@helpwell/ui';
import { askButton, type SiteContext, siteLink } from '../layout.js';

export interface CollectionCard {
  id: string;
  title: string;
  description: string | null;
  icon: string;
  tint: string;
  articles: number;
  /** When an article in it last changed. Shown on the under card. */
  updatedAt?: Date | string | null;
}

const ALL_TINTS = ['lavender', 'peach', 'butter', 'mint'] as const;

/**
 * Each collection's tint within the palette Settings allow. A collection
 * keeps its own tint when the palette has it; one whose tint is not in the
 * palette takes the next in rotation, skipping the tint of the card before
 * it where it can, so neighbours do not match.
 */
export function paletteTints<T extends { tint: string }>(
  collections: readonly T[],
  palette: readonly string[] | undefined,
): T[] {
  const allowed = (palette ?? ALL_TINTS).filter((tint) =>
    (ALL_TINTS as readonly string[]).includes(tint),
  );
  const pool = allowed.length > 0 ? allowed : [...ALL_TINTS];
  let cursor = 0;
  let previous: string | null = null;
  return collections.map((collection) => {
    let tint = collection.tint;
    if (!pool.includes(tint)) {
      tint = pool[cursor % pool.length]!;
      if (tint === previous && pool.length > 1) {
        cursor++;
        tint = pool[cursor % pool.length]!;
      }
      cursor++;
    }
    previous = tint;
    return { ...collection, tint };
  });
}

export interface ArticleCard {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  readingMinutes: number;
}

export function homePage(
  site: SiteContext,
  data: { collections: CollectionCard[]; popular: ArticleCard[] },
) {
  const hero = site.hero === 'flat' || site.hero === 'brand' ? site.hero : 'glow';
  const collections = paletteTints(data.collections, site.tints);
  return html`
<div class="hc-shell hc-rise">
  <div class="hc-hero hc-hero--${hero}">
    <h1>How can we help?</h1>
    <p>${
      site.agent
        ? `Search the ${site.productName} docs, or ask ${site.agent.name}, our AI assistant.`
        : `Search the ${site.productName} docs.`
    }</p>
    ${site.search ? searchForm(site) : null}
    ${askButton(site)}
  </div>

  ${
    collections.length === 0
      ? html`<div class="hc-empty">
          <h2>Nothing here yet</h2>
          <p>Articles live in the product repo. Add one and it appears here.</p>
        </div>`
      : html`<div class="hc-section">
          <h2>Browse by topic</h2>
          <div class="hc-grid">
            ${join(collections.map((entry) => collectionCard(site, entry)))}
          </div>
        </div>`
  }

  ${
    data.popular.length > 0
      ? html`<div class="hc-section">
          <h2>Most read</h2>
          <ul class="hc-list">
            ${join(data.popular.map((article) => articleRow(site, article)))}
          </ul>
        </div>`
      : null
  }
</div>`;
}

export function searchPage(
  site: SiteContext,
  data: {
    query: string;
    results: { slug: string; title: string; collection: string; snippet: string }[];
  },
) {
  return html`
<div class="hc-shell hc-rise">
  <div class="hc-hero" style="padding-bottom:24px">
    <h1>Search</h1>
    ${searchForm(site, data.query)}
  </div>

  <div class="hc-narrow">
    ${
      data.results.length === 0
        ? html`<div class="hc-empty">
            <h2>Nothing matched "${data.query}"</h2>
            <p>Try fewer words, or ask the assistant in the corner.</p>
          </div>`
        : html`
          <p style="color:var(--hw-muted);font-size:14px;margin:0 0 8px">
            ${data.results.length} ${data.results.length === 1 ? 'result' : 'results'} for "${data.query}"
          </p>
          <ul class="hc-list">
            ${join(
              data.results.map(
                (hit) => html`
                  <li>
                    <a href="${siteLink(site, `/${slugPath(hit.slug)}`)}">
                      <div class="hc-list__main">
                        <p class="hc-list__title">${hit.title}</p>
                        <!-- The snippet arrives with <mark> already in it and
                             everything else escaped by the search layer. -->
                        <p class="hc-list__sub">${raw(hit.snippet)}</p>
                      </div>
                      <span class="hc-list__meta">${hit.collection}</span>
                    </a>
                  </li>
                `,
              ),
            )}
          </ul>`
    }
  </div>
</div>`;
}

export function collectionPage(
  site: SiteContext,
  data: { collection: CollectionCard; articles: ArticleCard[] },
) {
  return html`
<div class="hc-shell hc-rise">
  <nav class="hc-breadcrumb" aria-label="Breadcrumb">
    <a href="${siteLink(site)}">Help</a><span>/</span><span>${data.collection.title}</span>
  </nav>
  <div class="hc-narrow">
    <h1 style="font-size:30px;letter-spacing:-.02em;margin:6px 0 4px">${data.collection.title}</h1>
    ${
      data.collection.description
        ? html`<p style="color:var(--hw-ink2);font-size:15.5px;margin:0 0 24px">${data.collection.description}</p>`
        : html`<div style="height:20px"></div>`
    }
    ${
      data.articles.length === 0
        ? html`<div class="hc-empty"><h2>No articles in this collection yet</h2></div>`
        : html`<ul class="hc-list">${join(data.articles.map((a) => articleRow(site, a)))}</ul>`
    }
  </div>
</div>`;
}

/** A collection on the home page: an under card by default, a plain card when Settings say so. */
function collectionCard(site: SiteContext, entry: CollectionCard): RawHtml {
  const href = siteLink(site, `/c/${encodeURIComponent(entry.id)}`);
  const count = `${entry.articles} ${entry.articles === 1 ? 'article' : 'articles'}`;
  const inner = html`
    <span class="hc-card__icon">${raw(iconOr(entry.icon, 'knowledge', 20))}</span>
    <h2>${entry.title}</h2>
    ${entry.description ? html`<p>${entry.description}</p>` : null}`;

  if (site.underCards === false) {
    return html`
      <a class="hc-card" data-tint="${entry.tint}" href="${href}">
        ${inner}
        <span class="hc-card__count">${count}</span>
      </a>`;
  }

  const fresh = entry.updatedAt ? updatedAgo(entry.updatedAt, site.locale) : '';
  return html`
    <a class="hc-ucard" data-tint="${entry.tint}" href="${href}">
      <div class="hc-card">${inner}</div>
      <span class="hc-umeta">${count}${fresh ? html`<span aria-hidden="true">·</span>updated ${fresh}` : null}</span>
    </a>`;
}

/**
 * "2 days ago", in the product's locale. Pages are cached for minutes, not
 * days, so a day's resolution never reads wrong. A locale the runtime does
 * not know falls back to English rather than failing the page.
 */
export function updatedAgo(value: Date | string, locale?: string, now = Date.now()): string {
  const then = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((now - then) / 86_400_000);
  let format: Intl.RelativeTimeFormat;
  try {
    format = new Intl.RelativeTimeFormat(locale?.trim() || 'en', { numeric: 'auto' });
  } catch {
    format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  if (days < 1) return format.format(0, 'day');
  if (days < 7) return format.format(-days, 'day');
  if (days < 30) return format.format(-Math.floor(days / 7), 'week');
  if (days < 365) return format.format(-Math.floor(days / 30), 'month');
  return format.format(-Math.floor(days / 365), 'year');
}

function articleRow(site: SiteContext, article: ArticleCard) {
  return html`
    <li>
      <a href="${siteLink(site, `/${slugPath(article.slug)}`)}">
        <div class="hc-list__main">
          <p class="hc-list__title">${article.title}</p>
          ${article.description ? html`<p class="hc-list__sub">${article.description}</p>` : null}
        </div>
        ${
          (site.readingTime ?? true)
            ? html`<span class="hc-list__meta">${article.readingMinutes} min</span>`
            : null
        }
      </a>
    </li>`;
}

function searchForm(site: SiteContext, value = '') {
  // A plain GET form, so search works with JavaScript switched off and the
  // result page has a URL that can be shared.
  return html`
    <form class="hc-search" action="${siteLink(site, '/search')}" method="get" role="search">
      ${raw(icon('search'))}
      <input type="search" name="q" value="${value}" placeholder="Search for help…" aria-label="Search the help center" autocomplete="off">
    </form>`;
}
