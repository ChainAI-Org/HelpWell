/**
 * The dashboard as a request handler.
 *
 * Reads go straight to the repos, writes go through plain HTML forms and
 * redirect afterwards, so the back button works and a refresh never re-submits.
 * JavaScript is small and per page: the shell's island (saving settings as
 * they change, confirmations, copying, the command palette) on every page,
 * plus a script of its own on the few screens a form cannot serve, such as
 * the model picker, the block editors and the live previews. No bundle, and
 * nothing inline: each is a file under `_assets/` (client/index.ts).
 *
 * It also serves its own fonts (`_fonts/`) and those scripts, both public
 * since neither says anything about the install, and sends security headers
 * on every response: `nosniff`, a same-origin referrer policy, and a policy
 * of `script-src 'self'` and `frame-ancestors 'self'`, which a host that
 * embeds the dashboard in its own shell widens with `frameAncestors`.
 *
 * Authentication is the host app's: `isAdmin` decides, and with nothing
 * configured the answer is no. HelpWell ships no login screen (DX-08).
 */

import { isHelpWellError, webhookOptionsFor } from '@helpwell/core';
import {
  countGaps,
  getGap,
  listGaps,
  pruneRateCounters,
  setGapStatus,
  spendStatus,
} from '@helpwell/core/agent';
import {
  assertSameOrigin,
  BASE_SECURITY_HEADERS,
  frameAncestorsDirective,
  resolveSecurityHeaders,
  type SecurityHeadersOption,
  withSecurityHeaders,
} from '@helpwell/core/api';
import type { AssetStore, ContentSource, WriteArticle } from '@helpwell/core/content';
import { type Db, type RoadmapStatus, rowsOf } from '@helpwell/core/db';
import {
  addTag,
  CHANGELOG_STATUSES,
  type ChangelogStatus,
  createChangelogEntry,
  deleteChangelogEntry,
  getChangelogEntry,
  getConversation,
  getRoadmap,
  listChangelog,
  listConversations,
  markReviewed,
  pruneConversations,
  ROADMAP_STATUSES,
  rangeFor,
  removeTag,
  reportBundle,
  setConversationStatus,
  setRoadmapStatus,
  setTopic,
  submitIdea,
  updateChangelogEntry,
} from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { decodeSegments, mountPath, type RawHtml, stripMountPath } from '@helpwell/ui';
import { serveWebFont } from '@helpwell/ui/fonts';
import { sql } from 'drizzle-orm';
import { createAdminTokenGate } from './admin-token.js';
import { knowledgePost, knowledgeScreen } from './articles.js';
import { serveClientScript } from './client/index.js';
import { button, empty } from './components.js';
import { byMode, type ContentMode } from './content-mode.js';
import type { ImportJobs } from './import-jobs.js';
import {
  type DashboardAccess,
  type DashboardContext,
  type NavKey,
  type PageHeader,
  pageAllowed,
  renderDashboard,
} from './layout.js';
import { hasModelKey, type ModelConfig, secretStatus } from './model.js';
import { contactsPost, contactsView } from './pages/contacts.js';
import {
  type ConversationsQuery,
  conversationPage,
  conversationsPage,
} from './pages/conversations.js';
import { engagePost, engageScreen } from './pages/engage.js';
import { evalsPost, evalsScreen } from './pages/evals.js';
import { formsPost, formsScreen } from './pages/forms.js';
import { gapDraftPost } from './pages/gap-draft.js';
import { homePost, homeScreen, rootLocation, setupDismissed } from './pages/home.js';
import { type GapFlash, gapsPage, isGapStatus } from './pages/knowledge.js';
import { playbookPost, playbookScreen } from './pages/playbook.js';
import {
  changelogAdminPage,
  changelogEditorPage,
  roadmapAdminPage,
  roadmapEditorPage,
} from './pages/publishing.js';
import { rangePreset, reportsExport, reportsPage } from './pages/reports.js';
import { connectionsPage, SETTINGS_TABS, settingsPage } from './pages/settings.js';
import {
  recentDeliveries,
  webhooksPagePost,
  webhooksPost,
  webhooksScreen,
} from './pages/webhooks.js';

export interface DashboardConfig extends ModelConfig {
  db: Db;
  /** Where the dashboard is mounted, e.g. "/admin/helpwell". */
  basePath?: string;
  /** Where the API is mounted, for the settings island and CSV export. */
  apiPath?: string;
  /**
   * Decides whether a request may see the dashboard. The host app owns auth.
   * With nothing supplied the dashboard is closed, which is the right default.
   */
  isAdmin?: (request: Request) => boolean | Promise<boolean>;
  /**
   * Narrows what a request that passed `isAdmin` may do, so the pages hide the controls it cannot
   * use: `content` for articles, gaps and changelog entries, `configure` for redirects, import
   * and the roadmap. The host still refuses the requests; this only keeps the pages honest.
   * Unset: both.
   */
  access?: (request: Request) => DashboardAccess | Promise<DashboardAccess>;
  /** Read instructions.md from the repo, so the agent tab can show it. */
  readInstructions?: () => Promise<string> | string;
  /** Persist an edited instructions.md back to the repo. */
  writeInstructions?: (value: string) => Promise<void> | void;
  /** Read playbook.md (house rules) from the repo, for the Playbook page. */
  readPlaybook?: () => Promise<string> | string;
  /** Persist an edited playbook.md back to the repo. */
  writePlaybook?: (value: string) => Promise<void> | void;
  /**
   * helpwell/evals.json, so the Evals page runs the cases in the repo: its
   * text or its parsed JSON. Without it a run repeats the latest run's cases.
   */
  readEvalCases?: () => unknown;
  /** "Open in the repo" links, e.g. `https://github.com/acme/app/blob/main/docs/{path}`. */
  repoUrlTemplate?: string | null;
  /** Where the docs live, shown on Connections. */
  docsDir?: string;
  /**
   * Save an article's Markdown in the repo, so the editor's Save button
   * writes the file. `path` is relative to the docs folder
   * (`billing/invoices.md`) and already checked; see `WriteArticle`. Without
   * it, Save hands the file back with the path to put it at.
   */
  writeArticle?: WriteArticle;
  /** The screenshots folder, relative to the repo root like `docsDir`, when not `<docsDir>/_screenshots`. */
  screenshotsDir?: string;
  /**
   * Where the knowledge base's files are, when not in `docsDir` on this
   * server's disk: the same source the API is given. The editor saves
   * through it when there is no `writeArticle` hook and it is writable, and
   * the setup checklist counts the articles in it.
   */
  content?: ContentSource;
  /**
   * Where images pasted, dropped or picked in the article editor are kept,
   * and the images an import brings over: the same option as the API's
   * `assetStore`; see `AssetStore` in @helpwell/core/content. Unset, they are
   * written through a writable `content` source, or with none, into
   * `docsDir` under `_media/` when Save writes articles; `false` takes none.
   */
  assetStore?: AssetStore | false;
  /**
   * The fetch "Import from another help center" reads a public help centre
   * and downloads its images with. Defaults to a guarded fetch: https only,
   * no private, loopback or link-local address (checked on the connection),
   * a few redirects each checked the same way, and a size cap. A host with
   * its own egress rules passes its own.
   */
  importFetch?: typeof fetch;
  /**
   * Run "Import from another help center" as the host's own jobs rather than
   * inside the form's request: `start` is handed the checked form, `watch`
   * streams its progress to the same page. Unset, the import runs in the
   * request, as `runImportJob`, which a host's worker can call too. See
   * import-jobs.ts.
   */
  importJobs?: ImportJobs;
  /**
   * Render pages without the left rail and the outer shell, so a host can
   * wrap them in its own navigation. Links stay under `basePath`; the
   * settings island and forms work as before.
   */
  embedded?: boolean;
  /**
   * Leave out each page's own title and subtitle, for a host that already
   * shows the page title above the dashboard. The page's action buttons stay.
   * Standalone dashboards keep their headings.
   */
  hideTitle?: boolean;
  /**
   * Serve only these pages. Any other answers 404, reads and writes alike,
   * and is left out of the rail. Unset: every page.
   */
  pages?: NavKey[];
  /** The dashboard's accent colour, in place of the widget accent from Settings. A hex colour. */
  accent?: string;
  /**
   * Who may show the dashboard in a frame, as CSP `frame-ancestors` sources.
   * Default `["'self'"]`: only pages on its own origin. A host that embeds it
   * in an app on another origin lists that origin, e.g.
   * `["'self'", 'https://app.acme.com']`; `[]` means nobody.
   */
  frameAncestors?: string[];
  /**
   * The security headers on every response, beyond `frameAncestors`. An
   * object replaces (a string) or drops (null) single headers; `false` sends
   * none, for a host that sets its own at the proxy.
   */
  securityHeaders?: SecurityHeadersOption;
  /**
   * Where the knowledge base, playbook and settings live, which decides what
   * the pages tell people about saving. `repo` (the default): files in a
   * repo, indexed by `helpwell sync`, with the CLI alongside. `managed`: a
   * writable `content` source (and read/write hooks) with no repo behind it,
   * such as a hosted install: saved here, live once indexed, no CLI to run.
   */
  contentMode?: ContentMode;
  /**
   * The fetch the dashboard's webhook sends go through: test deliveries,
   * retries, and the `changelog.published` and `article.published` events a
   * save raises. The same option, and the same default guard, as
   * `HelpWellConfig.webhookFetch`; pass the API's value here too.
   */
  webhookFetch?: typeof fetch | false;
  /**
   * HELPWELL_ADMIN_TOKEN, as a second way in beside `isAdmin`: a request
   * carrying it (as a bearer token, or in the `hw_admin` cookie) is an admin,
   * and the locked-out page offers a form to enter it, which sets that cookie.
   * Pass the same value to `createHelpWellHandler`, since the dashboard saves
   * settings through the API. Under 32 characters it is ignored. Without it
   * there is no form. See admin-token.ts.
   */
  adminToken?: string;
}

/**
 * The dashboard's headers: its pages are admin-only, so nothing leaks and
 * nothing frames it, and scripts come only from its own origin. No page has
 * an inline script or handler (client/index.ts), so `'unsafe-inline'` is not
 * needed here or in the policy of a host that frames it.
 */
function dashboardSecurityHeaders(config: DashboardConfig): Record<string, string> {
  const ancestors = config.frameAncestors ?? ["'self'"];
  const defaults: Record<string, string> = {
    ...BASE_SECURITY_HEADERS,
    'referrer-policy': 'same-origin',
    'content-security-policy': `script-src 'self'; ${frameAncestorsDirective(ancestors)}; base-uri 'self'; object-src 'none'`,
  };
  // The old header for old browsers, only where it can say the same thing.
  if (ancestors.length === 1 && ancestors[0] === "'self'")
    defaults['x-frame-options'] = 'SAMEORIGIN';
  if (ancestors.length === 0) defaults['x-frame-options'] = 'DENY';
  return resolveSecurityHeaders(defaults, config.securityHeaders);
}

export type DashboardHandler = (request: Request) => Promise<Response>;

function isChangelogStatus(value: string): value is ChangelogStatus {
  return (CHANGELOG_STATUSES as readonly string[]).includes(value);
}

function isRoadmapStatus(value: string): value is RoadmapStatus {
  return (ROADMAP_STATUSES as readonly string[]).includes(value);
}

type Settings = Awaited<ReturnType<SettingsStore['get']>>;

export function createDashboard(config: DashboardConfig): DashboardHandler {
  const store = new SettingsStore(config.db);
  const basePath = mountPath(config.basePath ?? '/admin/helpwell');
  const apiPath = mountPath(config.apiPath ?? '/api/helpwell');
  const security = dashboardSecurityHeaders(config);
  const gate = createAdminTokenGate({ db: config.db, token: config.adminToken, basePath, apiPath });

  return async function handler(request: Request): Promise<Response> {
    return withSecurityHeaders(await respond(request), security);
  };

  async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = stripMountPath(url.pathname, basePath);
    if (path === null) return new Response('Not found', { status: 404 });

    // The fonts are public files, and the sign-in page is set in them too.
    const font = /^\/_fonts\/([A-Za-z0-9._-]+)$/.exec(path);
    if (font && (request.method === 'GET' || request.method === 'HEAD')) {
      return serveWebFont(font[1]!, request);
    }
    // So are the pages' scripts: the same for every install (client/index.ts).
    const script = /^\/_assets\/([A-Za-z0-9._-]+)$/.exec(path);
    if (script && (request.method === 'GET' || request.method === 'HEAD')) {
      return serveClientScript(script[1]!, request);
    }

    // Entering the admin token is how a browser becomes an admin without
    // `isAdmin`, so its two posts answer before the check.
    const gated = await gate.route(request, path);
    if (gated) return gated;

    const allowed =
      gate.admits(request) || (config.isAdmin ? await config.isAdmin(request) : false);
    if (!allowed) return gate.lockedOut(request);

    const settings = await store.get();
    // Once the setup checklist is put away, the rail stops offering it.
    const setupDone = await setupDismissed(config.db);
    const context: DashboardContext = {
      basePath,
      apiPath,
      productName: settings.product.name,
      accent: config.accent ?? settings.widget.appearance.accent,
      badges: await badgeCounts(config.db),
      locale: settings.product.locale,
      timeZone: settings.product.timezone,
      hiddenNav: setupDone ? ['home'] : [],
      pages: config.pages,
      embedded: config.embedded,
      ...(config.hideTitle ? { hideTitle: true } : {}),
      contentMode: config.contentMode ?? 'repo',
      ...(config.access ? { access: await config.access(request) } : {}),
      signOutAction: gate.signOutAction(request),
    };

    // A malformed escape (`/admin/helpwell/%zz`) is a bad URL, not a crash.
    const segments = decodeSegments(path);
    if (segments === null) {
      return page(context, 'conversations', { title: 'Not found' }, notFoundBody(context), 404);
    }
    const section = segments[0] ?? '';

    // A page the host left out is not here at all, for a read or a write.
    if (section && !pageAllowed(context, section as NavKey)) {
      return page(context, 'conversations', { title: 'Not found' }, notFoundBody(context), 404);
    }

    // Everything that changes state is a POST, and every POST redirects.
    if (request.method === 'POST') {
      // The admin's session cookie rides along on a form another site
      // auto-submits. The browser's own headers say where the form came from.
      try {
        assertSameOrigin(request);
      } catch (error) {
        if (isHelpWellError(error) && error.code === 'forbidden') return crossSite(context);
        throw error;
      }
      if (section === 'knowledge') {
        return knowledgePost(config, context, segments.slice(1), request);
      }
      if (section === 'engage') {
        return engagePost(config, store, context, segments.slice(1), request);
      }
      if (section === 'forms') return formsPost(config, store, context, segments.slice(1), request);
      if (section === 'home') return homePost(config, context, request, settings);
      if (section === 'playbook') {
        return playbookPost(config, context, segments.slice(1), request, settings);
      }
      if (section === 'evals') {
        return evalsPost(config, context, segments.slice(1), request, settings);
      }
      if (section === 'gaps' && segments[1] && segments[2] === 'draft') {
        return gapDraftPost(config, context, segments[1], settings);
      }
      if (section === 'webhooks') {
        return webhooksPagePost(
          config.db,
          store,
          context,
          await request.formData(),
          config,
          webhookOptionsFor(config),
        );
      }
      return handlePost(config, store, context, segments, request);
    }

    switch (section) {
      case '': {
        // The setup checklist is the front door until it is put away; with
        // pages limited, the first page there is.
        const front: NavKey = setupDone ? 'conversations' : 'home';
        return redirect(
          pageAllowed(context, front) || !config.pages?.[0]
            ? rootLocation(basePath, setupDone)
            : `${basePath}/${config.pages[0]}`,
        );
      }

      case 'home':
        return homeScreen(config, context, url, settings);

      case 'playbook':
        return playbookScreen(config, context, url, settings);

      case 'conversations':
        return segments[1]
          ? conversationScreen(config.db, context, segments[1])
          : conversationsScreen(config.db, context, url);

      case 'contacts': {
        // The list, segments, fields and one person: pages/contacts.ts.
        const view = await contactsView(config.db, context, segments.slice(1), url);
        return page(context, 'contacts', view.header, view.body, view.status);
      }

      case 'knowledge':
        return knowledgeScreen(config, context, segments.slice(1), url);

      case 'gaps':
        return gapsScreen(config.db, context, url);

      case 'changelog':
        if (segments[1] === 'new') return changelogNewScreen(context);
        return segments[1]
          ? changelogEditScreen(config.db, context, segments[1])
          : changelogScreen(config.db, context, url);

      case 'roadmap':
        return segments[1] === 'new'
          ? page(context, 'roadmap', { title: 'Add to the roadmap' }, roadmapEditorPage(context))
          : roadmapScreen(config.db, context);

      case 'engage':
        // The list, the gallery, the editor and results: pages/engage.ts.
        return engageScreen(config, store, context, segments.slice(1), url);

      case 'forms':
        // The list, the builder, results, submissions, giveaways: pages/forms.ts.
        return formsScreen(config, store, context, segments.slice(1), url);

      case 'reports':
        if (segments[1] === 'export') return reportsExport(config.db, url);
        return reportsScreen(config.db, context, url, settings);

      case 'evals':
        return evalsScreen(config, context, segments.slice(1), url, settings);

      case 'settings':
        return settingsScreen(config, context, url, settings);

      case 'connections':
        return connectionsScreen(config, context, settings);

      case 'webhooks':
        return webhooksScreen(config.db, settings, context, url, config);

      default:
        return page(
          context,
          'conversations',
          { title: 'Not found' },
          empty('alert', 'No such page', 'Pick something from the rail on the left.'),
          404,
        );
    }
  }

  /* ------------------------------------------------------------- screens */

  function page(
    context: DashboardContext,
    nav: NavKey,
    header: PageHeader,
    body: RawHtml,
    status = 200,
  ): Response {
    return new Response(renderDashboard(context, nav, header, body), {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  function crossSite(context: DashboardContext): Response {
    return page(
      context,
      'conversations',
      { title: 'Request refused' },
      empty(
        'alert',
        'That request did not come from this site',
        'Nothing was changed. Go back to the dashboard and try again from there.',
        button('Back to the dashboard', {
          href: `${context.basePath}/conversations`,
          glyph: 'back',
        }),
      ),
      403,
    );
  }

  async function conversationsScreen(db: Db, context: DashboardContext, url: URL) {
    const raw = url.searchParams.get('status');
    const status: 'resolved' | 'unresolved' | undefined =
      raw === 'resolved' || raw === 'unresolved' ? raw : undefined;
    const query: ConversationsQuery = {
      status,
      q: url.searchParams.get('q') ?? undefined,
      topic: url.searchParams.get('topic')?.trim() || undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    };
    const result = await listConversations(db, {
      status: query.status,
      search: query.q,
      topic: query.topic,
      cursor: query.cursor,
      limit: 25,
    });
    return page(
      context,
      'conversations',
      {
        title: 'Conversations',
        subtitle: 'Every answer the agent gave, so you can check its work.',
      },
      conversationsPage(context, result, query),
    );
  }

  async function conversationScreen(db: Db, context: DashboardContext, id: string) {
    const thread = await getConversation(db, id);
    if (!thread) {
      return page(context, 'conversations', { title: 'Conversation' }, notFoundBody(context), 404);
    }
    return page(
      context,
      'conversations',
      {
        title: thread.topic ?? 'Conversation',
        subtitle: thread.contact.name ?? thread.contact.email ?? 'Anonymous visitor',
        actions: button('All conversations', {
          href: `${context.basePath}/conversations`,
          glyph: 'back',
        }),
      },
      conversationPage(context, thread),
    );
  }

  /** The notice after a gap changed status: `?done=<status>&gap=<id>` from the redirect. */
  async function gapFlashOf(db: Db, url: URL): Promise<GapFlash | null> {
    const done = url.searchParams.get('done');
    const id = url.searchParams.get('gap');
    const from = url.searchParams.get('status') ?? 'new';
    if (!isGapStatus(done) || !id || !isGapStatus(from)) return null;
    const gap = await getGap(db, id);
    return gap && gap.status === done ? { id, question: gap.question, done, from } : null;
  }

  async function gapsScreen(db: Db, context: DashboardContext, url: URL) {
    const raw = url.searchParams.get('status');
    const status = raw === 'drafted' || raw === 'dismissed' ? raw : 'new';
    const [gaps, counts] = await Promise.all([listGaps(db, { status, limit: 100 }), countGaps(db)]);
    const flash = await gapFlashOf(db, url);
    return page(
      context,
      'gaps',
      {
        title: 'Gaps',
        subtitle: 'Questions your docs do not answer yet, ranked by how often they are asked.',
      },
      gapsPage(context, gaps, { status, canDraft: hasModelKey(config), counts, flash }),
    );
  }

  async function changelogScreen(db: Db, context: DashboardContext, url: URL) {
    const result = await listChangelog(db, {
      includeUnpublished: true,
      limit: 25,
      cursor: isoCursor(url.searchParams.get('cursor')),
    });
    return page(
      context,
      'changelog',
      { title: 'Changelog', subtitle: 'What you shipped, in your customers’ words.' },
      changelogAdminPage(context, result),
    );
  }

  function changelogNewScreen(context: DashboardContext) {
    return page(
      context,
      'changelog',
      { title: 'New entry' },
      changelogEditorPage(context, {
        id: null,
        version: null,
        title: '',
        summary: null,
        body: '',
        tags: [],
        status: 'draft',
        publishedAt: null,
      }),
    );
  }

  async function changelogEditScreen(db: Db, context: DashboardContext, id: string) {
    const entry = await getChangelogEntry(db, id, { includeUnpublished: true });
    if (!entry) return page(context, 'changelog', { title: 'Entry' }, notFoundBody(context), 404);
    return page(
      context,
      'changelog',
      {
        title: entry.title,
        actions: button('All entries', { href: `${context.basePath}/changelog`, glyph: 'back' }),
      },
      changelogEditorPage(context, entry),
    );
  }

  async function roadmapScreen(db: Db, context: DashboardContext) {
    const board = await getRoadmap(db, { limitPerColumn: 200 });
    return page(
      context,
      'roadmap',
      { title: 'Roadmap', subtitle: 'What customers voted for, and what you decided to build.' },
      roadmapAdminPage(context, board),
    );
  }

  async function reportsScreen(db: Db, context: DashboardContext, url: URL, settings: Settings) {
    const preset = rangePreset(url.searchParams.get('range'));
    const [report, spend] = await Promise.all([
      reportBundle(db, rangeFor(preset)),
      spendStatus(db, settings.agent.spend),
    ]);
    return page(
      context,
      'reports',
      { title: 'Reports', subtitle: 'Is the agent actually helping, and what is it costing?' },
      reportsPage(context, report, spend, preset, { ownKey: !config.modelFactory }),
    );
  }

  async function settingsScreen(
    config: DashboardConfig,
    context: DashboardContext,
    url: URL,
    settings: Settings,
  ) {
    // An unknown tab is the first one, not an empty page.
    const requested = url.searchParams.get('tab');
    const tab = SETTINGS_TABS.find((option) => option.key === requested)?.key ?? 'general';
    return page(
      context,
      'settings',
      { title: 'Settings', subtitle: 'Saved the moment you change something.' },
      settingsPage(context, settings, tab, secretStatus(config)),
    );
  }

  async function connectionsScreen(
    config: DashboardConfig,
    context: DashboardContext,
    settings: Settings,
  ) {
    const [result, deliveries] = await Promise.all([
      config.db.execute(sql`
        SELECT count(*) AS articles, max(updated_at) AS last_sync FROM helpwell.article_index
      `),
      recentDeliveries(config.db),
    ]);
    const row = rowsOf<{ articles: number | string; last_sync: string | Date | null }>(result)[0];

    return page(
      context,
      'connections',
      {
        title: 'Connections',
        subtitle: byMode(
          context,
          'What HelpWell talks to: your model provider, your repo and your own webhooks.',
          'What HelpWell talks to: your model provider and your own webhooks.',
        ),
      },
      connectionsPage(context, settings, {
        openRouterConfigured: hasModelKey(config),
        secrets: secretStatus(config),
        repo: row
          ? {
              name: config.docsDir ?? 'docs/',
              articles: Number(row.articles),
              lastSync: row.last_sync ? new Date(row.last_sync) : null,
            }
          : null,
        deliveries,
      }),
    );
  }
}

/* ----------------------------------------------------------------- posts */

async function handlePost(
  config: DashboardConfig,
  store: SettingsStore,
  context: DashboardContext,
  segments: string[],
  request: Request,
): Promise<Response> {
  const form = await request.formData();
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : '';
  };
  const section = segments[0] ?? '';
  const back = `${context.basePath}/${segments.map(encodeURIComponent).join('/')}`;

  if (section === 'conversations' && segments[1]) {
    const id = segments[1];
    const removeTagValue = value('removeTag');
    if (removeTagValue) {
      await removeTag(config.db, id, removeTagValue);
      return redirect(back);
    }
    const status = value('status');
    if (status === 'resolved' || status === 'unresolved') {
      await setConversationStatus(config.db, id, status);
    }
    await setTopic(config.db, id, value('topic').trim() || null);
    await markReviewed(config.db, id, form.get('reviewed') !== null);
    const tag = value('tag').trim();
    if (tag) await addTag(config.db, id, tag, 'human');
    return redirect(back);
  }

  if (section === 'contacts') {
    return contactsPost(config.db, context, segments.slice(1), form);
  }

  if (section === 'gaps') {
    const status = value('status');
    const from = isGapStatus(value('from')) ? value('from') : 'new';
    if (!isGapStatus(status)) return redirect(`${context.basePath}/gaps?status=${from}`);
    await setGapStatus(config.db, value('id'), status);
    // Back to the same list, with a notice naming what changed and an Undo.
    const query = new URLSearchParams({ status: from, done: status, gap: value('id') });
    return redirect(`${context.basePath}/gaps?${query.toString()}`);
  }

  if (section === 'changelog') {
    const id = segments[1] && segments[1] !== 'new' ? segments[1] : null;

    if (value('action') === 'delete' && id) {
      await deleteChangelogEntry(config.db, id);
      return redirect(`${context.basePath}/changelog`);
    }

    const status = value('status') || 'draft';
    const draft = {
      version: value('version').trim() || null,
      title: value('title').trim(),
      summary: value('summary').trim() || null,
      body: value('body'),
      tags: value('tags')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    // Re-render with the message rather than losing what they typed.
    const errors: Record<string, string> = {};
    if (!draft.title) errors.title = 'An entry needs a title.';
    if (!isChangelogStatus(status)) errors.status = 'Pick a status from the list.';
    if (!isChangelogStatus(status) || Object.keys(errors).length > 0) {
      return new Response(
        renderDashboard(
          context,
          'changelog',
          { title: id ? 'Edit entry' : 'New entry' },
          changelogEditorPage(context, { id, publishedAt: null, status, ...draft }, errors),
        ),
        { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    const input = { ...draft, status };
    const webhooks = webhookOptionsFor(config);
    if (id) {
      await updateChangelogEntry(config.db, id, input, { webhooks });
      return redirect(`${context.basePath}/changelog/${encodeURIComponent(id)}`);
    }
    const created = await createChangelogEntry(config.db, input, { webhooks });
    return redirect(`${context.basePath}/changelog/${encodeURIComponent(created)}`);
  }

  if (section === 'roadmap') {
    if (segments[1] === 'new') {
      const title = value('title').trim();
      const status = value('status') || 'under_review';
      const errors: Record<string, string> = {};
      if (!title) errors.title = 'Give it a title.';
      if (!isRoadmapStatus(status)) errors.status = 'Pick a lane from the list.';
      if (!isRoadmapStatus(status) || Object.keys(errors).length > 0) {
        return new Response(
          renderDashboard(
            context,
            'roadmap',
            { title: 'Add to the roadmap' },
            roadmapEditorPage(context, errors, {
              title: value('title'),
              body: value('body'),
              status: isRoadmapStatus(status) ? status : 'planned',
            }),
          ),
          { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      const id = await submitIdea(config.db, { title, body: value('body') || undefined });
      if (status !== 'under_review') await setRoadmapStatus(config.db, id, status);
      return redirect(`${context.basePath}/roadmap`);
    }

    const status = value('status');
    if (status) {
      if (!isRoadmapStatus(status)) {
        return new Response(
          renderDashboard(
            context,
            'roadmap',
            { title: 'Roadmap' },
            empty(
              'alert',
              'That is not a lane',
              'Nothing was moved. Pick one of the four lanes on the board.',
              button('Back to the roadmap', { href: `${context.basePath}/roadmap`, glyph: 'back' }),
            ),
          ),
          { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      await setRoadmapStatus(config.db, value('id'), status);
    }
    return redirect(`${context.basePath}/roadmap`);
  }

  if (section === 'connections' && value('action').startsWith('webhook-')) {
    return redirect(
      await webhooksPost(
        config.db,
        await store.get(),
        context,
        value('action'),
        webhookOptionsFor(config),
      ),
    );
  }

  if (section === 'settings') {
    if (value('action') === 'instructions' && config.writeInstructions) {
      await config.writeInstructions(value('instructions'));
      return redirect(`${context.basePath}/settings?tab=agent`);
    }
    if (value('action') === 'maintenance') {
      const settings = await store.get();
      await Promise.all([
        pruneConversations(config.db, settings.data.retentionMonths),
        pruneRateCounters(config.db),
      ]);
      return redirect(`${context.basePath}/settings?tab=data`);
    }
    return redirect(`${context.basePath}/settings`);
  }

  return redirect(back);
}

/* -------------------------------------------------------------- plumbing */

async function badgeCounts(db: Db): Promise<Partial<Record<NavKey, number>>> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM helpwell.conversations
        WHERE status = 'unresolved' AND deleted_at IS NULL AND reviewed_at IS NULL) AS unreviewed,
      (SELECT count(*) FROM helpwell.gaps WHERE status = 'new') AS gaps
  `);
  const row = rowsOf<{ unreviewed: number | string; gaps: number | string }>(result)[0];
  const badges: Partial<Record<NavKey, number>> = {};
  if (Number(row?.unreviewed ?? 0) > 0) badges.conversations = Number(row?.unreviewed);
  if (Number(row?.gaps ?? 0) > 0) badges.gaps = Number(row?.gaps);
  return badges;
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

function notFoundBody(context: DashboardContext): RawHtml {
  return empty(
    'alert',
    'That is not here',
    'It may have been deleted.',
    button('Back to conversations', { href: `${context.basePath}/conversations`, glyph: 'back' }),
  );
}

function redirect(location: string): Response {
  // 303 so the browser follows with GET: a refresh must never re-submit.
  return new Response(null, { status: 303, headers: { location } });
}
