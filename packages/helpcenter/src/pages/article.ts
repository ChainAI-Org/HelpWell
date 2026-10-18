/**
 * An article page.
 *
 * Body, a table of contents built from the headings, related reading, and the
 * helpful/not-helpful vote. The vote is the only interactive part, and it is
 * progressive: without JavaScript the page still reads correctly, it just
 * cannot be rated. A "No" vote offers the support email, when there is one,
 * so a reader the article failed has somewhere to go.
 */

import type { Heading } from '@helpwell/ui';
import { html, icon, join, raw, safeHref, slugPath } from '@helpwell/ui';
import { askButton, publicBase, type SiteContext, siteLink, supportMailto } from '../layout.js';

export interface ArticleView {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  /** What the collection is called. Falls back to the folder id. */
  collectionTitle?: string;
  bodyHtml: string;
  headings: Heading[];
  appliesTo: string | null;
  readingMinutes: number;
  updatedAt: Date | string;
  /** Link to the file in the product repo, when one is configured (HC-08). */
  editUrl: string | null;
}

export interface RelatedArticle {
  slug: string;
  title: string;
}

export function articlePage(site: SiteContext, article: ArticleView, related: RelatedArticle[]) {
  const toc = article.headings.filter((heading) => heading.depth >= 2 && heading.depth <= 4);

  return html`
<div class="hc-shell hc-rise">
  <nav class="hc-breadcrumb" aria-label="Breadcrumb">
    <a href="${siteLink(site)}">Help</a><span>/</span>
    <a href="${siteLink(site, `/c/${encodeURIComponent(article.collection)}`)}">${article.collectionTitle ?? article.collection}</a>
    <span>/</span><span>${article.title}</span>
  </nav>

  <div class="hc-layout">
    <article class="hc-article">
      <h1>${article.title}</h1>
      <div class="hc-article__meta">
        ${(site.readingTime ?? true) ? html`<span>${article.readingMinutes} min read</span>` : null}
        <span>Updated ${formatDate(article.updatedAt, site)}</span>
        ${article.appliesTo ? html`<span class="hc-chip">${article.appliesTo}</span>` : null}
        ${
          article.editUrl
            ? html`<a href="${raw(safeHref(article.editUrl))}" target="_blank" rel="noopener noreferrer">Edit this page</a>`
            : null
        }
      </div>

      <!-- Rendered by the strict Markdown pass; raw HTML in the source has
           already been escaped to text. -->
      <div class="hc-body">${raw(article.bodyHtml)}</div>

      ${ratingBlock(site, article)}

      ${
        site.agent
          ? html`<p class="hc-still" data-hc-ask-row hidden>Still stuck? ${askButton(site)}</p>`
          : null
      }

      ${
        related.length > 0
          ? html`<div class="hc-section hc-related">
              <h2>Related</h2>
              <ul class="hc-list">
                ${join(
                  related.map(
                    (item) => html`
                      <li><a href="${siteLink(site, `/${slugPath(item.slug)}`)}">
                        <div class="hc-list__main"><p class="hc-list__title">${item.title}</p></div>
                      </a></li>`,
                  ),
                )}
              </ul>
            </div>`
          : null
      }
    </article>

    ${
      toc.length > 1
        ? html`<aside class="hc-toc">
            <h2>On this page</h2>
            <ol>
              ${join(
                toc.map(
                  // Heading text is plain; the template escapes it exactly once.
                  (heading) => html`
                    <li data-depth="${heading.depth}"><a href="#${heading.id}">${heading.text}</a></li>`,
                ),
              )}
            </ol>
          </aside>`
        : null
    }
  </div>
</div>
${ratingScript(site, article.slug)}`;
}

function ratingBlock(site: SiteContext, article: Pick<ArticleView, 'slug' | 'title'>) {
  if (!(site.ratings ?? true)) return null;
  // Shown by the script once someone says No. The subject names the article,
  // so whoever reads the email knows which one fell short.
  const contact = site.supportEmail
    ? html`<p class="hc-rate__contact" data-hc-rate-contact hidden>Still need help? <a href="${supportMailto(
        site.supportEmail,
        `Question about "${article.title}"`,
      )}">Contact support</a></p>`
    : null;
  return html`
    <div class="hc-rate" id="hc-rate" data-slug="${article.slug}">
      <p>Was this article helpful?</p>
      <div class="hc-rate__buttons">
        <button type="button" data-value="up" aria-pressed="false">${raw(icon('thumbUp', 15))} Yes</button>
        <button type="button" data-value="down" aria-pressed="false">${raw(icon('thumbDown', 15))} No</button>
      </div>
      ${contact}
    </div>`;
}

/**
 * Fifteen lines of vanilla JS rather than a framework: this is the only
 * behaviour on the page, and it should not cost a bundle.
 */
function ratingScript(site: SiteContext, slug: string) {
  if (!(site.ratings ?? true)) return null;
  return html`<script>
(function () {
  var block = document.getElementById('hc-rate');
  if (!block) return;
  block.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-value]');
    if (!button) return;
    var value = button.getAttribute('data-value');
    Array.prototype.forEach.call(block.querySelectorAll('button'), function (other) {
      other.setAttribute('aria-pressed', String(other === button));
    });
    block.querySelector('p').textContent =
      value === 'up' ? 'Thanks for letting us know.' : 'Thanks, we will improve this.';
    var contact = block.querySelector('[data-hc-rate-contact]');
    if (contact) contact.hidden = value !== 'down';
    fetch(${raw(JSON.stringify(`${site.apiPath}/articles/${slugPath(slug)}/rating`))}, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: value })
    }).catch(function () {});
  });
})();
</script>`;
}

const DATE_FORMAT = { year: 'numeric', month: 'long', day: 'numeric' } as const;

/**
 * A date in the product's locale and time zone. Both come from a settings
 * text box, and an unknown one makes `toLocaleDateString` throw, so the
 * fallback is the format the page always had.
 */
export function formatDate(
  value: Date | string,
  options: { locale?: string; timeZone?: string } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleDateString(options.locale?.trim() || 'en-GB', {
      ...DATE_FORMAT,
      timeZone: options.timeZone?.trim() || undefined,
    });
  } catch {
    return date.toLocaleDateString('en-GB', DATE_FORMAT);
  }
}

/** JSON-LD for an article, so search engines show it as a help document. */
export function articleStructuredData(
  site: SiteContext,
  article: ArticleView,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: article.title,
    description: article.description ?? undefined,
    dateModified: new Date(article.updatedAt).toISOString(),
    articleSection: article.collection,
    publisher: { '@type': 'Organization', name: site.productName },
    mainEntityOfPage: publicBase(site)
      ? `${publicBase(site)}/${slugPath(article.slug)}`
      : undefined,
  };
}
