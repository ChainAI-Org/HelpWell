/**
 * The help centre as a request handler.
 *
 * Mounted the same way the API is: give it a database and a base path and it
 * answers `(Request) => Response`. Every page is assembled on the server, so
 * the first byte the browser sees already contains the answer (HC-01).
 */

import {
  type AgentOverrides,
  BASE_SECURITY_HEADERS,
  cleanAgentOverrides,
  readCookie,
  remoteSupportFromEnv,
  resolveSecurityHeaders,
  type SecurityHeadersOption,
  VISITOR_COOKIE,
  withSecurityHeaders,
} from '@helpwell/core/api';
import {
  type ContentSource,
  DEFAULT_SCREENSHOTS,
  type MediaDirs,
  resolveMediaDirs,
  serveContentMedia,
  serveMedia,
} from '@helpwell/core/content';
import { type Db, rowsOf, schema } from '@helpwell/core/db';
import {
  getChangelogEntry,
  getCollection,
  getRoadmap,
  isIdentified,
  listChangelog,
  listCollections,
  visibleArticles,
} from '@helpwell/core/repos';
import { recordSearch, searchArticles } from '@helpwell/core/search';
import { publicSupportEmail, SettingsStore } from '@helpwell/core/settings';
import {
  decodeSegments,
  fillPathTemplate,
  html,
  mountPath,
  type RawHtml,
  renderMarkdown,
  slugPath,
  stripMountPath,
  VIDEO_EMBED_ORIGINS,
  withoutRepeatedTitle,
} from '@helpwell/ui';
import { serveWebFont } from '@helpwell/ui/fonts';
import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type PageMeta, publicBase, renderPage, type SiteContext, siteLink } from './layout.js';
import { type ArticleView, articlePage, articleStructuredData } from './pages/article.js';
import {
  changelogEntryPage,
  changelogPage,
  changelogRss,
  escapeXml,
  roadmapPage,
} from './pages/changelog.js';
import { collectionPage, homePage, searchPage } from './pages/home.js';
import { helpCenterRedirects, type RedirectsOption } from './redirects.js';

export interface HelpCenterConfig {
  db: Db;
  /** Where the help centre is mounted. Defaults to the configured subpath. */
  basePath?: string;
  /**
   * Absolute origin for canonical URLs, the sitemap and the feed, e.g.
   * "https://acme.com". Defaults to the origin each request arrived on.
   */
  origin?: string;
  /**
   * The absolute URL the public reaches this help centre's root at, e.g.
   * "https://help.acme.com" or "https://acme.com/help". Every canonical
   * link, Open Graph URL, sitemap entry, feed link and llms.txt link starts
   * with it, whatever host or path the request itself arrived on, so one
   * install can be served on a custom domain and still name one address.
   * Wins over `origin`. Unset, the `helpCenter.domain` setting is used, read
   * on every request so a change in the dashboard applies at once.
   */
  publicUrl?: string;
  /**
   * Where the knowledge base's files are, when not on this server's disk:
   * `_screenshots/` and `_media/` are served from it instead of the folders
   * in `media`. The same source the API is given.
   */
  content?: ContentSource;
  /** Where the API is mounted, for the rating call and the widget. */
  apiPath?: string;
  /**
   * The widget loader, so visitors can ask a question from any page. Defaults
   * to where the API handler serves it; pass null to leave the widget off the
   * help centre.
   */
  widgetScriptUrl?: string | null;
  /**
   * Template for "Edit this page", e.g.
   * `https://github.com/acme/app/edit/main/docs/{path}` (HC-08).
   */
  editUrlTemplate?: string | null;
  /** Cache-Control for HTML. Defaults to a short shared cache. */
  cacheControl?: string;
  /**
   * The folders article screenshots and images are read from, relative to the
   * working directory, the same as the API's `media`. The help centre serves
   * them itself at `<basePath>/_screenshots/…` and `<basePath>/_media/…` and
   * points its pages there, so a help centre on its own domain shows them
   * without reaching the API. Defaults to `docs` and `docs/_screenshots`;
   * `false` leaves images loading from the API.
   */
  media?: MediaDirs | false;
  /**
   * The Content-Security-Policy header on every page. The default allows the
   * video players articles may embed (YouTube's no-cookie domain, Vimeo, Loom
   * and Wistia) as frames and nothing else, and no plugins. A string replaces
   * it; `false` sends none, for a host that sets its own (include
   * `VIDEO_EMBED_ORIGINS` from `@helpwell/ui` in its `frame-src`).
   */
  contentSecurityPolicy?: string | false;
  /**
   * The other security headers, on every response: `nosniff` and a
   * `strict-origin-when-cross-origin` referrer policy by default. Framing is
   * not restricted, because a help centre is often shown inside a product's
   * own pages; add `'content-security-policy'` framing rules through
   * `contentSecurityPolicy`. An object replaces (a string) or drops (null)
   * single headers; `false` sends none.
   */
  securityHeaders?: SecurityHeadersOption;
  /**
   * Whether a support extension answers people for this install, as the
   * API's `support` does. When it does, the help centre shows no support
   * email: the extension's own flow is how people reach a person. Unset, it
   * follows the environment the API connects a remote extension from
   * (HELPWELL_SUPPORT_URL, _PRODUCT and _TOKEN all set).
   */
  humanSupport?: boolean;
  /**
   * The same overrides a support extension gives the API
   * (`SupportExtension.agentOverrides`). Only the name is used here: it
   * replaces the agent's name from Settings on the "Ask" buttons and the home
   * page. A failure, or no name, keeps the name from Settings.
   */
  agentOverrides?(): Promise<AgentOverrides | null>;
  /**
   * Old URLs from a help centre moved here with `helpwell import`, answered
   * with a 301 to the article each became: the path of a JSON file (default
   * `helpwell/redirects.json`, relative to the working directory, read again
   * whenever it changes), the rules themselves, or `false` for none. Only a
   * request that would otherwise be a 404 is redirected, and only to a path
   * inside this help centre. With `content` set nothing is read from disk
   * unless a file is named here. See redirects.ts.
   */
  redirects?: RedirectsOption;
}

/** The policy every page is served with unless the host sets its own. */
export const DEFAULT_CONTENT_SECURITY_POLICY = [
  "base-uri 'self'",
  "object-src 'none'",
  `frame-src 'self' ${VIDEO_EMBED_ORIGINS.join(' ')}`,
].join('; ');

export type HelpCenterHandler = (request: Request) => Promise<Response>;

/**
 * Who is asking. The help centre knows a visitor only through the widget's
 * `hw_visitor` cookie, which carries their contact id. Whether they may see a
 * reserved collection follows from whether the host app identified that
 * contact; a missing, stale or invented cookie is an anonymous visitor.
 */
interface Visibility {
  contactId?: string | null;
}

/** `article_index` under the alias every visibility clause expects. */
const a = alias(schema.articleIndex, 'a');

export function createHelpCenter(config: HelpCenterConfig): HelpCenterHandler {
  const store = new SettingsStore(config.db);
  const media = resolveMediaDirs(config.media);
  // Passed in code, it is checked once and a bad one throws here, at boot.
  // From Settings it is read per request, and a bad one is ignored.
  const fixedPublicUrl = absoluteBase(config.publicUrl);
  const policy =
    config.contentSecurityPolicy === undefined
      ? DEFAULT_CONTENT_SECURITY_POLICY
      : config.contentSecurityPolicy;
  const security = resolveSecurityHeaders(BASE_SECURITY_HEADERS, config.securityHeaders);
  const humanSupport = config.humanSupport ?? remoteSupportFromEnv(process.env).options !== null;
  const redirects = helpCenterRedirects(config, store);

  /** The agent's name from the host's overrides, or null to keep the one in Settings. */
  async function agentName(): Promise<string | null> {
    if (!config.agentOverrides) return null;
    try {
      return cleanAgentOverrides(await config.agentOverrides())?.name ?? null;
    } catch {
      return null;
    }
  }

  // Every page carries the policy; the files it serves carry their own.
  // Every response carries the other security headers.
  return async function withPolicy(request: Request): Promise<Response> {
    let response = await handler(request);
    // An old URL from an imported help centre goes on to the article it became.
    if (response.status === 404) response = (await redirects(request)) ?? response;
    if (policy && response.headers.get('content-type')?.startsWith('text/html')) {
      response.headers.set('content-security-policy', policy);
    }
    return withSecurityHeaders(response, security);
  };

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const settings = await store.get();
    const basePath = mountPath(config.basePath ?? settings.helpCenter.subpath ?? '/help');
    const theme = settings.helpCenter.theme;
    const visibility: Visibility = { contactId: readCookie(request, VISITOR_COOKIE) };

    // The widget is on the page when the host serves one and Settings ask for
    // it; the "Ask" buttons are drawn only then.
    const widgetScriptUrl = !settings.helpCenter.askAgent
      ? null
      : config.widgetScriptUrl === undefined
        ? `${(config.apiPath ?? '/api/helpwell').replace(/\/+$/, '')}/assets/loader.js`
        : config.widgetScriptUrl;

    const site: SiteContext = {
      productName: settings.product.name,
      basePath,
      origin: config.origin ?? url.origin,
      publicUrl: fixedPublicUrl ?? domainBase(settings.helpCenter.domain),
      logoUrl: theme.logoUrl,
      logoDarkUrl: theme.logoDarkUrl,
      accent: theme.accent,
      background: theme.background,
      font: theme.bodyFont,
      headlineFont: theme.headlineFont,
      radius: settings.widget.appearance.radius,
      appUrl: settings.product.appUrl,
      poweredBy: settings.helpCenter.poweredBy,
      search: settings.helpCenter.search,
      ratings: settings.helpCenter.ratings,
      readingTime: settings.helpCenter.readingTime,
      changelogEnabled: settings.changelog.publicPage,
      roadmapEnabled: settings.changelog.roadmap.enabled,
      widgetScriptUrl,
      apiPath: config.apiPath ?? '/api/helpwell',
      locale: settings.product.locale,
      timeZone: settings.product.timezone,
      hero: theme.hero,
      underCards: theme.underCards,
      tints: theme.tints,
      defaultTheme: theme.defaultTheme,
      faviconUrl: theme.faviconUrl,
      agent: widgetScriptUrl
        ? { name: (await agentName()) ?? settings.agent.name, avatarUrl: settings.agent.avatarUrl }
        : null,
      changelogGroupBy: settings.changelog.groupBy,
      fontsPath: `${basePath}/_fonts`,
      supportEmail: publicSupportEmail(settings, { humanSupport }),
    };

    const path = stripMountPath(url.pathname, basePath);
    if (path === null) return notFound(site);

    // A malformed escape (`/help/%zz`) is a bad URL, not a server error.
    const segments = decodeSegments(path);
    if (segments === null) return notFound(site);

    const cache =
      config.cacheControl ?? 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

    // --- the self-hosted fonts ----------------------------------------------

    if (
      segments[0] === '_fonts' &&
      segments.length === 2 &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      return serveWebFont(segments[1]!, request);
    }

    // --- the screenshots and images articles reference --------------------

    if (
      (segments[0] === '_screenshots' || segments[0] === '_media') &&
      segments.length > 1 &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      if (config.media === false) return notFound(site);
      const shots = segments[0] === '_screenshots';
      const file = segments.slice(1).join('/');
      if (config.content) {
        return serveContentMedia(
          config.content,
          shots ? `${DEFAULT_SCREENSHOTS}/${file}` : file,
          request,
        );
      }
      return serveMedia(shots ? media.screenshots : media.docs, file, request);
    }

    // --- feeds and machine-readable files ---------------------------------

    if (path === '/sitemap.xml') {
      if (!settings.helpCenter.sitemap) return notFound(site);
      return xmlResponse(await sitemap(config.db, site, visibility), cache);
    }
    if (path === '/llms.txt' && settings.helpCenter.llmsTxt) {
      return textResponse(await llmsTxt(config.db, site, visibility), cache);
    }
    if (path === '/changelog/rss.xml') {
      // The feed is the changelog too: switching the page off switches it off.
      if (!site.changelogEnabled) return notFound(site);
      const page = await listChangelog(config.db, { limit: 50 });
      return xmlResponse(changelogRss(site, page.items), cache);
    }

    // --- pages -------------------------------------------------------------

    if (path === '/') {
      const [collectionCards, popular, freshness] = await Promise.all([
        listCollections(config.db, visibility),
        popularArticles(config.db, visibility),
        theme.underCards ? lastUpdated(config.db, visibility) : new Map<string, Date>(),
      ]);
      return page(
        site,
        {
          title: 'Help center',
          path: '/',
          description: `Help and documentation for ${site.productName}.`,
        },
        homePage(site, {
          collections: collectionCards.map((card) => ({
            ...card,
            updatedAt: freshness.get(card.id) ?? null,
          })),
          popular,
        }),
        'help',
        cache,
      );
    }

    if (segments[0] === 'search') {
      const query = url.searchParams.get('q')?.trim() ?? '';
      const results = query
        ? await searchArticles(config.db, query, {
            limit: 20,
            identified: await isIdentified(config.db, visibility.contactId ?? null),
          })
        : [];
      if (query) {
        await recordSearch(config.db, {
          query,
          resultsCount: results.length,
          source: 'help_center',
        });
      }
      return page(
        site,
        // Search results pages are not worth indexing, and indexing them
        // dilutes the articles they point at.
        { title: query ? `Search: ${query}` : 'Search', path: '/search', noIndex: true },
        searchPage(site, { query, results }),
        'help',
        'no-store',
      );
    }

    if (segments[0] === 'c' && segments[1]) {
      const id = segments[1];
      const [collection, articles] = await Promise.all([
        getCollection(config.db, id, visibility),
        articlesIn(config.db, id, visibility),
      ]);
      if (!collection || articles.length === 0) return notFound(site);
      return page(
        site,
        {
          title: collection.title,
          description: collection.description ?? undefined,
          path: `/c/${encodeURIComponent(id)}`,
        },
        collectionPage(site, { collection, articles }),
        'help',
        cache,
      );
    }

    if (segments[0] === 'changelog') {
      if (!site.changelogEnabled) return notFound(site);

      if (segments.length === 1) {
        const result = await listChangelog(config.db, {
          limit: settings.changelog.pageSize,
          cursor: isoCursor(url.searchParams.get('cursor')),
        });
        return page(
          site,
          {
            title: "What's new",
            path: '/changelog',
            description: `Product updates for ${site.productName}.`,
          },
          changelogPage(site, { entries: result.items, nextCursor: result.nextCursor }),
          'changelog',
          cache,
        );
      }

      const entry = await getChangelogEntry(config.db, segments[1]!);
      if (!entry) return notFound(site);
      return page(
        site,
        {
          title: entry.title,
          path: `/changelog/${encodeURIComponent(entry.version || entry.id)}`,
          description: entry.summary ?? undefined,
        },
        changelogEntryPage(site, { ...entry, bodyHtml: renderMarkdown(entry.body).html }),
        'changelog',
        cache,
      );
    }

    if (segments[0] === 'roadmap') {
      if (!site.roadmapEnabled) return notFound(site);
      const board = await getRoadmap(config.db, { limitPerColumn: 100 });
      return page(
        site,
        {
          title: 'Roadmap',
          path: '/roadmap',
          description: `What we are building next in ${site.productName}.`,
        },
        roadmapPage(site, board),
        'roadmap',
        cache,
      );
    }

    // Anything left is an article slug, which may contain a slash.
    const slug = segments.join('/');

    // An article linking to another by its file (`[Invoices](../billing/invoices.md)`)
    // resolves to the file's URL; the article lives at the same path without it.
    if (/\.mdx?$/.test(slug)) {
      return new Response(null, {
        status: 301,
        headers: { location: siteLink(site, `/${slugPath(slug.replace(/\.mdx?$/, ''))}`) },
      });
    }

    const article = await loadArticle(config.db, slug, config.editUrlTemplate ?? null, visibility, {
      apiPath: site.apiPath,
      basePath,
      serving: config.media !== false,
    });
    if (!article) return notFound(site);

    const [related, collection] = await Promise.all([
      relatedTo(config.db, article, visibility),
      getCollection(config.db, article.collection, visibility),
    ]);
    article.collectionTitle = collection?.title;

    return page(
      site,
      {
        title: article.title,
        path: `/${slugPath(article.slug)}`,
        description: article.description ?? undefined,
        structuredData: articleStructuredData(site, article),
      },
      articlePage(site, article, related),
      'help',
      cache,
    );
  }
}

/* ----------------------------------------------------------------- data */

/**
 * What to read next.
 *
 * Search first, because a genuine textual match is the best answer. Then top
 * up from the same collection: on a small help centre search often finds
 * nothing similar, and "Related: nothing" is worse than an obvious neighbour.
 */
async function relatedTo(db: Db, article: ArticleView, visibility: Visibility, limit = 3) {
  const hits = await searchArticles(db, `${article.title} ${article.description ?? ''}`, {
    limit: limit + 2,
    identified: await isIdentified(db, visibility.contactId ?? null),
  });

  const related = hits
    .filter((hit) => hit.slug !== article.slug)
    .map((hit) => ({ slug: hit.slug, title: hit.title }));

  if (related.length >= limit) return related.slice(0, limit);

  const taken = new Set([article.slug, ...related.map((item) => item.slug)]);
  const neighbours = await db
    .select({ slug: a.slug, title: a.title })
    .from(a)
    .where(
      sql`collection = ${article.collection} AND status = 'published'${visibleArticles(visibility)}`,
    )
    .orderBy(sql`order_index, title`);

  for (const neighbour of neighbours) {
    if (related.length >= limit) break;
    if (taken.has(neighbour.slug)) continue;
    related.push(neighbour);
  }
  return related;
}

/**
 * When each collection last changed: its newest published article's date,
 * as far as this visitor may see. For the under cards on the home page.
 */
async function lastUpdated(db: Db, visibility: Visibility): Promise<Map<string, Date>> {
  const rows = await db
    .select({ collection: a.collection, updatedAt: sql<string | Date>`max(${a.updatedAt})` })
    .from(a)
    .where(sql`status = 'published'${visibleArticles(visibility)}`)
    .groupBy(a.collection);
  const out = new Map<string, Date>();
  for (const row of rows) {
    const date = new Date(row.updatedAt);
    if (!Number.isNaN(date.getTime())) out.set(row.collection, date);
  }
  return out;
}

async function articlesIn(db: Db, collection: string, visibility: Visibility) {
  const rows = await db
    .select({
      slug: a.slug,
      title: a.title,
      description: a.description,
      collection: a.collection,
      readingMinutes: a.readingMinutes,
    })
    .from(a)
    .where(sql`collection = ${collection} AND status = 'published'${visibleArticles(visibility)}`)
    .orderBy(sql`order_index, title`);
  return rows;
}

/**
 * Most-cited articles stand in for most-read, which we do not track. The last
 * ninety days: recent enough to mean something, and bounded, so the home page
 * is not a scan of every message ever answered.
 */
async function popularArticles(db: Db, visibility: Visibility) {
  const result = await db.execute(sql`
    WITH cited AS (
      SELECT c->>'slug' AS slug
      FROM helpwell.messages m
      CROSS JOIN LATERAL jsonb_array_elements(m.citations) AS c
      WHERE m.role = 'agent' AND m.created_at >= now() - interval '90 days'
    )
    SELECT a.slug, a.title, a.description, a.collection, a.reading_minutes, count(cited.slug) AS n
    FROM helpwell.article_index a
    JOIN cited ON cited.slug = a.slug
    WHERE a.status = 'published'${visibleArticles(visibility)}
    GROUP BY a.slug, a.title, a.description, a.collection, a.reading_minutes
    ORDER BY n DESC
    LIMIT 5
  `);
  return rowsOf<{
    slug: string;
    title: string;
    description: string | null;
    collection: string;
    reading_minutes: number;
  }>(result).map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    collection: row.collection,
    readingMinutes: row.reading_minutes,
  }));
}

async function loadArticle(
  db: Db,
  slug: string,
  editUrlTemplate: string | null,
  visibility: Visibility,
  media: { apiPath: string; basePath: string; serving: boolean },
): Promise<ArticleView | null> {
  const [row] = await db
    .select()
    .from(a)
    .where(sql`slug = ${slug} AND status = 'published'${visibleArticles(visibility)}`)
    .limit(1);
  if (!row) return null;

  // The page draws the title above the body, so an opening `# Title` that
  // repeats it would say the article's name twice.
  const rendered = renderMarkdown(withoutRepeatedTitle(row.body, row.title));
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    collection: row.collection,
    bodyHtml: media.serving
      ? servedHere(rendered.html, media.apiPath, media.basePath)
      : rendered.html,
    headings: rendered.headings,
    appliesTo: row.appliesTo,
    readingMinutes: row.readingMinutes,
    updatedAt: row.updatedAt,
    // The file's real path when the index knows it; the slug came from front
    // matter otherwise. Encoded per segment, so neither can carry a quote or
    // a space into the link.
    editUrl: editUrlTemplate
      ? fillPathTemplate(editUrlTemplate, slugPath(row.path ?? `${row.slug}.md`))
      : null,
  };
}

/**
 * Point an article's media at the help centre's own copies. `helpwell sync`
 * wrote them as API URLs; this help centre serves the same files itself, so
 * its pages work even on a domain that cannot reach the API.
 */
function servedHere(bodyHtml: string, apiPath: string, basePath: string): string {
  let api = apiPath.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(api)) {
    try {
      // An absolute API URL still indexed its media under its path.
      api = new URL(api).pathname.replace(/\/+$/, '');
    } catch {
      return bodyHtml;
    }
  }
  return bodyHtml
    .split(`src="${api}/screenshots/`)
    .join(`src="${basePath}/_screenshots/`)
    .split(`src="${api}/media/`)
    .join(`src="${basePath}/_media/`);
}

/* ------------------------------------------------------- machine files */

async function sitemap(db: Db, site: SiteContext, visibility: Visibility): Promise<string> {
  const base = escapeXml(publicBase(site));
  const rows = await db
    .select({ slug: a.slug, updatedAt: a.updatedAt })
    .from(a)
    .where(sql`status = 'published'${visibleArticles(visibility)}`);

  const urls = [
    `  <url><loc>${base}/</loc></url>`,
    ...rows.map(
      (row) =>
        `  <url><loc>${base}/${escapeXml(slugPath(row.slug))}</loc><lastmod>${new Date(row.updatedAt).toISOString()}</lastmod></url>`,
    ),
  ];
  if (site.changelogEnabled) urls.push(`  <url><loc>${base}/changelog</loc></url>`);
  if (site.roadmapEnabled) urls.push(`  <url><loc>${base}/roadmap</loc></url>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

/**
 * llms.txt: a plain-text index for AI assistants, so someone asking ChatGPT
 * about the product gets pointed at the real docs (HC-11).
 */
async function llmsTxt(db: Db, site: SiteContext, visibility: Visibility): Promise<string> {
  const base = publicBase(site);
  const [rows, collections] = await Promise.all([
    db
      .select({
        slug: a.slug,
        title: a.title,
        description: a.description,
        collection: a.collection,
      })
      .from(a)
      .where(sql`status = 'published'${visibleArticles(visibility)}`)
      .orderBy(sql`collection, order_index, title`),
    listCollections(db, visibility),
  ]);

  const byCollection = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCollection.get(row.collection) ?? [];
    list.push(row);
    byCollection.set(row.collection, list);
  }

  // A heading an assistant reads should be the name a person would use, not
  // the folder it happens to live in.
  const titles = new Map(collections.map((c) => [c.id, c.title]));
  const sections = [...byCollection.entries()].map(([collection, items]) => {
    const lines = items.map(
      (item) =>
        `- [${item.title}](${base}/${slugPath(item.slug)})${item.description ? `: ${item.description}` : ''}`,
    );
    return `## ${titles.get(collection) ?? collection}\n\n${lines.join('\n')}`;
  });

  return `# ${site.productName}

> Documentation and help articles for ${site.productName}.

${sections.join('\n\n')}
`;
}

/* -------------------------------------------------------------- plumbing */

/**
 * `publicUrl` as a base: an absolute http(s) URL with no trailing slash, no
 * query and no fragment. A malformed one is a configuration mistake, so it
 * throws when the help centre is created rather than on a visitor's request.
 */
function absoluteBase(value: string | undefined): string | undefined {
  if (value === undefined || !value.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`publicUrl must be an absolute URL, e.g. https://help.acme.com: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`publicUrl must be an http or https URL: ${value}`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

const domainBases = new Map<string, string | undefined>();

/**
 * The `helpCenter.domain` setting as a public URL: `help.acme.com` means
 * `https://help.acme.com`, and a full URL is taken as written. A setting that
 * is not a usable address is ignored, falling back to the address each
 * request arrived on, because a typo in the dashboard must not take the help
 * centre down.
 */
export function domainBase(domain: string | undefined): string | undefined {
  const value = (domain ?? '').trim();
  if (!value) return undefined;
  if (domainBases.has(value)) return domainBases.get(value);
  let base: string | undefined;
  try {
    base = absoluteBase(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    // A host with no dot (a stray word) is not somewhere the public can reach.
    if (base && !new URL(base).hostname.includes('.')) base = undefined;
  } catch {
    base = undefined;
  }
  if (domainBases.size > 100) domainBases.clear();
  domainBases.set(value, base);
  return base;
}

/**
 * A cursor is an ISO timestamp this server issued. Anything else is dropped
 * rather than handed to `new Date`, which would turn a bad query string into
 * a 500.
 */
function isoCursor(value: string | null): string | undefined {
  if (!value) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function page(
  site: SiteContext,
  meta: PageMeta,
  body: RawHtml,
  nav: 'help' | 'changelog' | 'roadmap',
  cacheControl: string,
): Response {
  return new Response(renderPage(site, meta, body, nav), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl,
    },
  });
}

function notFound(site: SiteContext): Response {
  const body = renderPage(
    site,
    { title: 'Not found', path: '/404', noIndex: true },
    notFoundBody(site),
    'help',
  );
  return new Response(body, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function notFoundBody(site: SiteContext): RawHtml {
  return html`<div class="hc-shell hc-rise"><div class="hc-empty">
  <h2>We could not find that page</h2>
  <p>It may have moved. <a href="${siteLink(site)}">Start from the help center</a>, or ask the assistant in the corner.</p>
</div></div>`;
}

function xmlResponse(body: string, cacheControl: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': cacheControl },
  });
}

function textResponse(body: string, cacheControl: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cacheControl },
  });
}
