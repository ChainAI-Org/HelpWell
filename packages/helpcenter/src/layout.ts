/**
 * The page shell: head, header, footer.
 *
 * Everything a help centre needs to be found — title, description, canonical,
 * Open Graph, and JSON-LD — is assembled here so no individual page has to
 * remember (HC-10).
 *
 * The theme lives here too: the favicon, the colour scheme a reader starts
 * in, and the switch that lets them change it. The reader's own choice is
 * remembered in their browser and applied before the first paint, so a page
 * never flashes the wrong scheme on its way to the right one.
 */

import { widgetMark, wordmark } from '@helpwell/tokens';
import { escapeHtml, html, icon, join, link, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { helpCenterStyles } from './styles.js';

export type HeroStyle = 'glow' | 'flat' | 'brand';
export type ThemeChoice = 'light' | 'dark' | 'system';

export interface SiteContext {
  /** Product name, shown in the brand lockup and every title. */
  productName: string;
  /** Where the help centre is mounted, e.g. "/help". No trailing slash; '' at the root. */
  basePath: string;
  /** Absolute origin, used for canonical and OG URLs. Empty is allowed. */
  origin: string;
  /**
   * The absolute URL the public reaches the help centre's root at, no
   * trailing slash: `https://help.acme.com`. Wins over `origin + basePath`
   * for every absolute link, so an install served on its own domain points
   * search engines and assistants there.
   */
  publicUrl?: string;
  logoUrl: string | null;
  /** The logo for the dark scheme; the light one is used in both when this is empty. */
  logoDarkUrl?: string | null;
  accent: string;
  font: string;
  radius: number;
  /** Link back to the product. */
  appUrl: string;
  poweredBy: boolean;
  search: boolean;
  changelogEnabled: boolean;
  roadmapEnabled: boolean;
  /** Inline the widget loader so the help centre can answer questions too. */
  widgetScriptUrl: string | null;
  apiPath: string;
  /** Helpful / not helpful at the end of an article. Defaults to on. */
  ratings?: boolean;
  /** "N min read" on articles and lists. Defaults to on. */
  readingTime?: boolean;
  /** Headings; falls back to the body font. */
  headlineFont?: string;
  /** Ground colour for the light scheme; anything but a hex colour is ignored. */
  background?: string;
  /** BCP 47 tag from settings, for `lang` and date formatting. Defaults to "en". */
  locale?: string;
  /** IANA zone from settings, for date formatting. */
  timeZone?: string;
  /** The top of the home page: a soft accent glow (the default), flat, or a solid brand block. */
  hero?: HeroStyle;
  /** Collection cards carry the tinted under card with count and freshness. Defaults to on. */
  underCards?: boolean;
  /**
   * The tints collection cards may use, in rotation order. A collection whose
   * own tint is not in the list takes the next one from it. Defaults to all four.
   */
  tints?: readonly string[];
  /** The colour scheme a reader starts in. They can switch; this is where they start. */
  defaultTheme?: ThemeChoice;
  /** The tab icon. Nothing means the browser's default. */
  faviconUrl?: string | null;
  /**
   * Who answers in the widget, for the "Ask" buttons. Absent when the widget
   * is not on the page, since a button to open nothing would be a lie.
   */
  agent?: { name: string; avatarUrl: string | null } | null;
  /** The changelog as one entry per version (the default) or under month headings. */
  changelogGroupBy?: 'version' | 'date';
  /** Where the self-hosted fonts are served, e.g. "/help/_fonts". Absent: system fonts only. */
  fontsPath?: string | null;
  /**
   * Where readers can write for help: "Contact support" in the footer and
   * after an article is voted unhelpful, as a mailto link. Null when none is
   * set, and when a support extension handles human replies.
   */
  supportEmail?: string | null;
}

export interface PageMeta {
  title: string;
  description?: string;
  /** Path within the help centre, e.g. "/billing/invoices". */
  path: string;
  /** JSON-LD, already an object. Serialised safely. */
  structuredData?: Record<string, unknown>;
  noIndex?: boolean;
}

export type NavKey = 'help' | 'changelog' | 'roadmap';

/** Where a reader's own light or dark choice is kept, in their browser only. */
const THEME_KEY = 'hw-help-theme';

/**
 * The absolute base every canonical, sitemap, feed and llms.txt link starts
 * with: the public URL when there is one, otherwise origin and mount path.
 * Empty when neither is known, and absolute links are then left out.
 */
export function publicBase(site: Pick<SiteContext, 'origin' | 'basePath' | 'publicUrl'>): string {
  if (site.publicUrl) return site.publicUrl;
  return site.origin ? `${site.origin}${site.basePath}` : '';
}

/** A link into the help centre: `/help/changelog`, or `/` when mounted at the root. */
export function siteLink(site: Pick<SiteContext, 'basePath'>, path = '/'): string {
  return link(site.basePath, path);
}

export function renderPage(site: SiteContext, meta: PageMeta, body: RawHtml, nav?: NavKey): string {
  const base = publicBase(site);
  const url = base ? `${base}${meta.path}` : '';
  const fullTitle =
    meta.path === '/' ? `${site.productName} help center` : `${meta.title} · ${site.productName}`;
  const theme =
    site.defaultTheme === 'light' || site.defaultTheme === 'dark' ? site.defaultTheme : null;
  const favicon = site.faviconUrl ? safeHref(site.faviconUrl) : '';

  return `<!doctype html>
<html lang="${langTag(site.locale)}"${theme ? ` data-hw-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
${meta.description ? `<meta name="description" content="${escapeHtml(meta.description)}">` : ''}
${meta.noIndex ? '<meta name="robots" content="noindex">' : ''}
${url ? `<link rel="canonical" href="${escapeHtml(url)}">` : ''}
${favicon && favicon !== '#' ? `<link rel="icon" href="${favicon}">` : ''}
<meta property="og:type" content="${meta.path === '/' ? 'website' : 'article'}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
${meta.description ? `<meta property="og:description" content="${escapeHtml(meta.description)}">` : ''}
${url ? `<meta property="og:url" content="${escapeHtml(url)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${site.changelogEnabled ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.productName)} changelog" href="${escapeHtml(siteLink(site, '/changelog/rss.xml'))}">` : ''}
${themeBootScript()}
<style>${helpCenterStyles({
    accent: site.accent,
    font: site.font,
    headlineFont: site.headlineFont,
    background: site.background,
    radius: site.radius,
    fontsPath: site.fontsPath ?? null,
  })}</style>
${meta.structuredData ? `<script type="application/ld+json">${jsonLd(meta.structuredData)}</script>` : ''}
</head>
<body>
<a class="hc-skip" href="#main">Skip to content</a>
${header(site, nav).value}
<main id="main">
${body.value}
</main>
${footer(site).value}
${themeSwitchScript(theme)}
${site.agent ? askScript() : ''}
${site.widgetScriptUrl ? `<script src="${safeHref(site.widgetScriptUrl)}" data-api="${escapeHtml(site.apiPath)}" defer></script>` : ''}
</body>
</html>`;
}

/** A language tag that is safe in an attribute and plausible as BCP 47; "en" otherwise. */
function langTag(locale: string | undefined): string {
  const tag = (locale ?? '').trim();
  return /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(tag) ? tag : 'en';
}

/**
 * The agent's avatar: the image from Settings, or the HelpWell mark itself,
 * bare. Never a mark inside a circle (design/GUIDE.md).
 */
export function agentAvatar(agent: { avatarUrl: string | null }, size = 24): RawHtml {
  const src = agent.avatarUrl ? safeHref(agent.avatarUrl) : '';
  if (src && src !== '#') {
    return html`<img class="hc-avatar" src="${raw(src)}" alt="" width="${size}" height="${size}">`;
  }
  return html`<span class="hc-avatar hc-avatar--mark" style="width:${size}px;height:${size}px" aria-hidden="true">${raw(
    widgetMark('var(--hw-accent)').replace(
      'role="img" aria-label="Open support"',
      'aria-hidden="true" focusable="false"',
    ),
  )}</span>`;
}

/**
 * "Ask Fern": opens the widget on this page. Rendered hidden and shown by
 * the script once the widget is there to open, so without JavaScript there
 * is no button that does nothing.
 */
export function askButton(site: SiteContext, label?: string): RawHtml | null {
  if (!site.agent) return null;
  return html`<button type="button" class="hc-ask" data-hc-ask hidden>${agentAvatar(site.agent, 22)}<span>${
    label ?? `Ask ${site.agent.name}`
  }</span></button>`;
}

function header(site: SiteContext, nav?: NavKey): RawHtml {
  const current = (key: NavKey) => (nav === key ? raw('aria-current="page"') : null);
  const links: RawHtml[] = [html`<a href="${siteLink(site)}" ${current('help')}>Help</a>`];
  if (site.changelogEnabled) {
    links.push(
      html`<a href="${siteLink(site, '/changelog')}" ${current('changelog')}>Changelog</a>`,
    );
  }
  if (site.roadmapEnabled) {
    links.push(html`<a href="${siteLink(site, '/roadmap')}" ${current('roadmap')}>Roadmap</a>`);
  }
  if (site.appUrl) {
    links.push(html`<a href="${raw(safeHref(site.appUrl))}">Back to ${site.productName}</a>`);
  }

  // A customer's own logo when they have uploaded one, otherwise their name in
  // the help centre's own type. Never the HelpWell mark: this is their site.
  // With a dark-scheme logo too, both are drawn and the scheme shows one (styles.ts).
  const dark = site.logoUrl && site.logoDarkUrl ? safeHref(site.logoDarkUrl) : '';
  const brand = site.logoUrl
    ? dark && dark !== '#'
      ? html`<img class="hc-logo--light" src="${raw(safeHref(site.logoUrl))}" alt="${site.productName}"><img class="hc-logo--dark" src="${raw(dark)}" alt="${site.productName}">`
      : html`<img src="${raw(safeHref(site.logoUrl))}" alt="${site.productName}">`
    : html`<span>${site.productName}</span>`;

  return html`<header class="hc-header">
  <div class="hc-header__inner">
    <a class="hc-brand" href="${siteLink(site)}">${brand}</a>
    <nav class="hc-nav">${join(links)}</nav>
    <button type="button" class="hc-theme" data-hc-theme hidden aria-label="Switch to dark mode">
      <span class="hc-theme__dark">${raw(icon('moon', 17))}</span><span class="hc-theme__light">${raw(icon('sun', 17))}</span>
    </button>
  </div>
</header>`;
}

function footer(site: SiteContext): RawHtml {
  // A person to write to, from the reader's own mail client. HelpWell sends
  // nothing; the address is only ever a link.
  const contact = site.supportEmail
    ? html`<a class="hc-footer__contact" href="${supportMailto(site.supportEmail)}">Contact support</a>`
    : null;

  if (!site.poweredBy) {
    return html`<footer class="hc-footer">
  <span>${site.productName} help center</span>${contact}
</footer>`;
  }

  // The credit link keeps the referrer (strict-origin-when-cross-origin by
  // default, so helpwell.ai sees only this help center's origin).
  return html`<footer class="hc-footer">
  <span class="hc-credit">Powered by <a href="https://helpwell.ai/?utm_source=helpwell-help-center&amp;utm_medium=powered-by" target="_blank" rel="noopener">${raw(wordmark('currentColor', 'hc-credit'))}</a></span>${contact}
</footer>`;
}

/**
 * A mailto link to the support address, with a subject when there is one.
 * The address was checked to be a plain one before it got here
 * (`publicSupportEmail`); the subject is encoded, so it cannot add headers.
 */
export function supportMailto(address: string, subject?: string): string {
  return subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`;
}

/**
 * Applies the reader's remembered scheme before anything paints. Storage can
 * be blocked (a private window, a strict browser), which simply means the
 * default applies.
 */
function themeBootScript(): string {
  return `<script>try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='light'||t==='dark')document.documentElement.setAttribute('data-hw-theme',t)}catch(e){}</script>`;
}

/**
 * The light and dark switch. It flips whatever the reader sees now (their
 * system's scheme when nothing is set) and remembers the choice.
 */
function themeSwitchScript(fallback: 'light' | 'dark' | null): string {
  return `<script>
(function () {
  var button = document.querySelector('[data-hc-theme]');
  if (!button) return;
  var root = document.documentElement;
  function current() {
    var set = root.getAttribute('data-hw-theme');
    if (set === 'light' || set === 'dark') return set;
    return ${JSON.stringify(fallback)} || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function label() {
    button.setAttribute('aria-label', current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  button.hidden = false;
  label();
  button.addEventListener('click', function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-hw-theme', next);
    try { localStorage.setItem(${JSON.stringify(THEME_KEY)}, next); } catch (e) {}
    label();
  });
})();
</script>`;
}

/** Shows the "Ask" buttons once the widget has loaded, and opens it from them. */
function askScript(): string {
  return `<script>
(function () {
  function show() {
    document.querySelectorAll('[data-hc-ask], [data-hc-ask-row]').forEach(function (el) { el.hidden = false; });
  }
  if (window.helpwell && window.helpwell.widget) show();
  else window.addEventListener('helpwell:ready', show, { once: true });
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-hc-ask]');
    if (!button || !window.helpwell) return;
    // Straight into a new conversation: the reader asked to ask.
    var widget = window.helpwell.widget;
    if (widget && typeof widget.open === 'function') widget.open({ name: 'chat', conversationId: null });
    else if (typeof window.helpwell === 'function') window.helpwell('open');
  });
})();
</script>`;
}

/**
 * JSON-LD has to survive being inside a `<script>` element, where the parser
 * ends the block at the first `</script` regardless of JSON quoting.
 */
function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
