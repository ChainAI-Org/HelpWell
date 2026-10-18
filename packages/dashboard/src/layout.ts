/**
 * The dashboard shell: the left rail, the page header, and the page itself.
 *
 * The rail is the only navigation. Every screen in the product is reachable
 * from it in one click, and the selected row is a lavender fill with violet
 * text rather than a grey block (design/GUIDE.md).
 *
 * A host that wraps the dashboard in its own navigation renders it embedded:
 * the same header and page with no rail and no shell around them.
 */

import { wordmark } from '@helpwell/tokens';
import { escapeHtml, html, icon, join, link, type RawHtml, raw } from '@helpwell/ui';
import { clientScript } from './client/index.js';
import type { ContentMode } from './content-mode.js';
import { dashboardStyles } from './styles.js';

export interface DashboardContext {
  /** Where the dashboard is mounted, e.g. "/admin/helpwell". No trailing slash. */
  basePath: string;
  /** Where the API is mounted, for the small islands that call it. */
  apiPath: string;
  productName: string;
  accent: string;
  /** Counts for the rail badges. Absent keys show no badge. */
  badges: Partial<Record<NavKey, number>>;
  /** BCP 47 tag from settings, for `lang` and date formatting. Defaults to "en". */
  locale?: string;
  /** IANA zone from settings, for date formatting. */
  timeZone?: string;
  /** Rail entries not to draw, e.g. "Get set up" once the checklist is put away. */
  hiddenNav?: NavKey[];
  /**
   * The only pages this dashboard serves, when the host limits them. The
   * rail and the palette offer nothing else. Unset: every page.
   */
  pages?: readonly NavKey[];
  /**
   * Draw pages without the rail and the outer shell, for a host that wraps
   * them in its own navigation. The header, the page and the island script
   * are unchanged; the palette is off, since the host owns navigation.
   */
  embedded?: boolean;
  /**
   * Leave out the page's own title and subtitle because the host already shows
   * the title above the dashboard. The action buttons stay. Standalone: false.
   */
  hideTitle?: boolean;
  /** Where content lives, for what pages say about saving: see content-mode.ts. Default `repo`. */
  contentMode?: ContentMode;
  /**
   * Where "Sign out" posts, for someone who came in with the admin token's
   * cookie (admin-token.ts). Unset for everyone else: the host's own sign-in
   * has its own way out.
   */
  signOutAction?: string;
  /**
   * What this person may do here, when the host limits it per request (`DashboardConfig.access`).
   * `content` is writing articles, answering gaps and changelog entries; `configure` is the
   * bulk and site-level tools (redirects, import, roadmap). Unset: both.
   */
  access?: DashboardAccess;
}

/** What one request may do in the dashboard. */
export interface DashboardAccess {
  content: boolean;
  configure: boolean;
}

/** Whether the person may `what`; true for a host that does not limit it. */
export function can(
  context: Pick<DashboardContext, 'access'>,
  what: keyof DashboardAccess,
): boolean {
  return context.access ? context.access[what] : true;
}

/** Whether the dashboard serves `key` at all. */
export function pageAllowed(context: Pick<DashboardContext, 'pages'>, key: NavKey): boolean {
  return !context.pages || context.pages.includes(key);
}

export type NavKey =
  | 'home'
  | 'playbook'
  | 'conversations'
  | 'contacts'
  | 'knowledge'
  | 'gaps'
  | 'changelog'
  | 'roadmap'
  | 'engage'
  | 'forms'
  | 'reports'
  | 'evals'
  | 'settings'
  | 'connections'
  | 'webhooks';

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: string;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Start',
    items: [{ key: 'home', label: 'Get set up', href: '/home', icon: 'rocket' }],
  },
  {
    title: 'Support',
    items: [
      {
        key: 'conversations',
        label: 'Conversations',
        href: '/conversations',
        icon: 'conversations',
      },
      { key: 'contacts', label: 'Contacts', href: '/contacts', icon: 'contacts' },
    ],
  },
  {
    title: 'Content',
    items: [
      { key: 'knowledge', label: 'Knowledge base', href: '/knowledge', icon: 'knowledge' },
      { key: 'gaps', label: 'Gaps', href: '/gaps', icon: 'gaps' },
      { key: 'changelog', label: 'Changelog', href: '/changelog', icon: 'changelog' },
      { key: 'roadmap', label: 'Roadmap', href: '/roadmap', icon: 'roadmap' },
      { key: 'engage', label: 'Engage', href: '/engage', icon: 'engage' },
      { key: 'forms', label: 'Forms', href: '/forms', icon: 'inbox' },
    ],
  },
  {
    title: 'Measure',
    items: [
      { key: 'reports', label: 'Reports', href: '/reports', icon: 'reports' },
      { key: 'evals', label: 'Evals', href: '/evals', icon: 'evals' },
    ],
  },
  {
    title: 'Configure',
    items: [
      { key: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
      { key: 'playbook', label: 'Playbook', href: '/playbook', icon: 'agent' },
      { key: 'connections', label: 'Connections', href: '/connections', icon: 'connections' },
      { key: 'webhooks', label: 'Webhooks', href: '/webhooks', icon: 'zap' },
    ],
  },
];

export interface PageHeader {
  title: string;
  subtitle?: string;
  /** Rendered on the right of the header: buttons, a segmented control. */
  actions?: RawHtml | null;
  /**
   * Drawn in place of the title and subtitle, e.g. an editor's breadcrumb
   * and status (editor-kit's `editorTopbar`). It must carry the page's h1;
   * `title` still names the browser tab.
   */
  lead?: RawHtml | null;
}

/**
 * A dashboard page in the shell. Its scripts are files the dashboard's own
 * handler serves under `<basePath>/_assets/`, so a page drawn here needs that
 * handler mounted at `basePath` for them to run.
 */
export function renderDashboard(
  context: DashboardContext,
  nav: NavKey,
  header: PageHeader,
  body: RawHtml,
): string {
  return `<!doctype html>
<html lang="${langTag(context.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(header.title)} · ${escapeHtml(context.productName)}</title>
<style>${dashboardStyles(context.accent, `${context.basePath}/_fonts`)}</style>
</head>
${
  // Embedded: no rail and no shell, because the host's own navigation wraps it.
  context.embedded
    ? `<body class="db-embedded" data-page="${nav}">`
    : `<body>
<a class="db-skip" href="#main">Skip to content</a>
<div class="db-shell">
${rail(context, nav).value}`
}
  <main id="main" class="db-main">
    ${topHeader(context, header)}
    <div class="db-page">
${body.value}
    </div>
  </main>
${context.embedded ? '' : '</div>'}
${islandScript(context)}
</body>
</html>`;
}

/** The page header: title, subtitle and actions. Without the title when the host draws it. */
function topHeader(context: Pick<DashboardContext, 'hideTitle'>, header: PageHeader): string {
  const actions = header.actions
    ? `<div class="db-top__actions">${header.actions.value}</div>`
    : '';
  if (context.hideTitle && !header.lead) {
    return actions ? `<header class="db-top db-top--bare">${actions}</header>` : '';
  }
  const lead = header.lead
    ? header.lead.value
    : `<h1>${escapeHtml(header.title)}</h1>
        ${header.subtitle ? `<p class="db-top__sub">${escapeHtml(header.subtitle)}</p>` : ''}`;
  return `<header class="db-top">
      <div>
        ${lead}
      </div>
      ${actions}
    </header>`;
}

/**
 * A page with no rail and no island: what someone who is not an admin sees.
 * The rail lists every screen and the script knows where the API is, and
 * neither is for them.
 */
export function renderBare(title: string, body: RawHtml, basePath?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · HelpWell</title>
<style>${dashboardStyles(undefined, basePath === undefined ? null : `${basePath}/_fonts`)}</style>
</head>
<body>
<main id="main" class="db-page">
${body.value}
</main>
</body>
</html>`;
}

/** A language tag that is safe in an attribute and plausible as BCP 47; "en" otherwise. */
function langTag(locale: string | undefined): string {
  const tag = (locale ?? '').trim();
  return /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(tag) ? tag : 'en';
}

function rail(context: DashboardContext, current: NavKey): RawHtml {
  const hidden = new Set(context.hiddenNav ?? []);
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => pageAllowed(context, item.key) && (!hidden.has(item.key) || item.key === current),
    ),
  })).filter((group) => group.items.length > 0);
  return html`  <nav class="db-rail" aria-label="Dashboard">
    <div class="db-lockup">${raw(wordmark('currentColor', 'db-lockup'))}</div>
    ${join(
      groups.map(
        (group) => html`
      <div class="db-navgroup">${group.title}</div>
      ${join(
        group.items.map((item) => {
          const count = context.badges[item.key];
          return html`
      <a class="db-nav" href="${link(context.basePath, item.href)}" ${
        item.key === current ? raw('aria-current="page"') : null
      }>
        ${raw(icon(item.icon, 17))}
        <span class="db-nav__label">${item.label}</span>
        ${count ? html`<span class="db-nav__count">${count}</span>` : null}
      </a>`;
        }),
      )}`,
      ),
    )}
    ${
      // A post, not a link, so another site cannot sign anyone out.
      context.signOutAction
        ? html`<form class="db-signout" method="post" action="${context.signOutAction}">
      <button class="db-nav" type="submit">Sign out</button>
    </form>`
        : null
    }
  </nav>`;
}

/**
 * The shell's client-side code, on every page: client/shell.ts, served as a
 * file (client/index.ts), with the API path and whether to offer the palette
 * on its tag. The palette's styles come with it.
 */
function islandScript(context: DashboardContext): string {
  return `${
    clientScript(context, 'shell', {
      api: context.apiPath,
      // Embedded, the host's navigation is the navigation: no palette over it.
      palette: context.embedded ? 'false' : 'true',
    }).value
  }
<style>
.db-palette {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(23,20,37,.4);
  display: grid; place-items: start center;
  padding-top: 14vh;
  animation: db-fadein 160ms ease-out both;
}
@keyframes db-fadein { from { opacity: 0 } to { opacity: 1 } }
.db-palette__box {
  width: min(520px, calc(100vw - 32px));
  background: var(--hw-surface);
  border-radius: 16px;
  box-shadow: var(--hw-shadow-float);
  overflow: hidden;
  animation: db-palettein 220ms cubic-bezier(.34,1.45,.64,1) both;
}
@keyframes db-palettein { from { opacity: 0; transform: translateY(-8px) scale(.97) } to { opacity: 1; transform: none } }
.db-palette__input { width: 100%; padding: 16px 18px; border: 0; outline: none; background: none; font-size: 15px; border-bottom: 1px solid var(--hw-hairline); }
.db-palette__list { list-style: none; margin: 0; padding: 6px; max-height: 320px; overflow-y: auto; }
.db-palette__list a { display: block; padding: 9px 12px; border-radius: 10px; font-weight: 600; font-size: 13.5px; }
.db-palette__list a:hover, .db-palette__list a[aria-current='true'] { background: var(--hw-accent-soft); color: var(--hw-deep-violet); }
</style>`;
}
