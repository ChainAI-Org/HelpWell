/**
 * Crawling a public help site into drafts (MG-02).
 *
 * For a platform with no API, or one nobody has a key for. It reads the
 * site's sitemap when there is one and follows links under the start URL when
 * there is not, keeps the article part of each page, and converts it. The
 * result is a set of drafts for a person or a coding agent to tidy, not a
 * finished help centre, so every crawled article is written as a draft.
 */

import { htmlTitle, htmlToMarkdown, mainContent } from './html-to-markdown.js';
import type { ImportedArticle, ImportPlan } from './plan.js';

export interface CrawlOptions {
  /** Stop after this many pages. Default 200. */
  max?: number;
  fetch?: typeof fetch;
  onProgress?: (text: string) => void;
}

const USER_AGENT = 'HelpWell-Import/1 (+https://github.com/ChainAI-Org/helpwell)';

async function get(
  doFetch: typeof fetch,
  url: string,
): Promise<{ type: string; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await doFetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml;q=0.9' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) return null;
    return { type: response.headers.get('content-type') ?? '', text: await response.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A URL without its hash and query, so one page is one key. */
function normalise(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}`;
}

function under(start: URL, candidate: URL): boolean {
  const prefix = start.pathname.replace(/\/+$/, '');
  return (
    candidate.origin === start.origin &&
    (prefix === '' || candidate.pathname === prefix || candidate.pathname.startsWith(`${prefix}/`))
  );
}

/** Pages listed in /sitemap.xml (one level of sitemap index followed). */
async function fromSitemap(doFetch: typeof fetch, start: URL): Promise<string[]> {
  const locs = (xml: string) =>
    [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  const root = await get(doFetch, `${start.origin}/sitemap.xml`);
  if (!root) return [];
  const urls: string[] = [];
  const nested = /<sitemapindex/i.test(root.text);
  for (const loc of locs(root.text)) {
    if (!nested) {
      urls.push(loc);
      continue;
    }
    const child = await get(doFetch, loc);
    if (child) urls.push(...locs(child.text));
  }
  return urls;
}

/** The collection a page belongs to: the path segment above it, under the start URL. */
function collectionFor(start: URL, page: URL): string {
  const prefix = start.pathname.replace(/\/+$/, '');
  const rest = page.pathname.slice(prefix.length).split('/').filter(Boolean);
  if (rest.length < 2) return 'General';
  const segment = decodeURIComponent(rest[rest.length - 2]!)
    .replace(/^\d+-/, '')
    .replace(/[-_]+/g, ' ');
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export async function crawlSite(startUrl: string, options: CrawlOptions = {}): Promise<ImportPlan> {
  const start = new URL(startUrl);
  const doFetch = options.fetch ?? fetch;
  const max = Math.max(1, Math.min(options.max ?? 200, 5000));
  const warnings: string[] = [];

  const seeded = (await fromSitemap(doFetch, start))
    .map((u) => {
      try {
        return new URL(u);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => u !== null && under(start, u));
  const queue: URL[] = seeded.length > 0 ? seeded : [start];
  const followLinks = seeded.length === 0;
  const seen = new Set(queue.map(normalise));
  const articles: ImportedArticle[] = [];
  let fetched = 0;

  while (queue.length > 0 && fetched < max) {
    const url = queue.shift()!;
    const page = await get(doFetch, url.href);
    fetched++;
    if (!page || !/html/i.test(page.type)) continue;

    if (followLinks) {
      for (const match of page.text.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
        try {
          const next = new URL(match[1]!, url);
          const key = normalise(next);
          if (
            under(start, next) &&
            !seen.has(key) &&
            !/\.(png|jpe?g|gif|svg|pdf|zip|css|js)$/i.test(next.pathname)
          ) {
            seen.add(key);
            queue.push(next);
          }
        } catch {
          // an href that is not a URL
        }
      }
    }

    const body = htmlToMarkdown(mainContent(page.text), { baseUrl: url.href });
    // Listing pages (a collection's table of contents) are mostly links.
    const words = body
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .split(/\s+/)
      .filter(Boolean).length;
    if (words < 25 || normalise(url) === normalise(start)) continue;
    articles.push({
      title:
        htmlTitle(page.text) ?? decodeURIComponent(url.pathname.split('/').pop() ?? 'Untitled'),
      body,
      collection: { title: collectionFor(start, url) },
      status: 'draft',
      sourceUrl: url.href,
    });
    options.onProgress?.(`${fetched} pages read, ${articles.length} articles`);
  }
  if (queue.length > 0) warnings.push(`Stopped at ${max} pages; pass --max to read more.`);
  return { source: 'crawl', articles, warnings };
}
