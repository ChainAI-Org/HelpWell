/**
 * Render every HelpWell surface and photograph it.
 *
 * The README's screenshots come from here, so they are always of the code as
 * it is rather than a mock-up that drifted. It renders the real handlers
 * against a seeded in-memory database, writes each page to a file, and drives
 * headless Chrome over the lot.
 *
 *   node scripts/screenshots.mjs            # everything
 *   node scripts/screenshots.mjs widget     # only shots whose name matches
 *
 * Chrome is found automatically on Windows and macOS; set CHROME to override.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHelpWellHandler } from '@helpwell/core';
import { createDashboard } from '@helpwell/dashboard';
import { createHelpCenter } from '@helpwell/helpcenter';
import { seed } from './seed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
const workDir = join(root, '.screenshots-work');

const filter = process.argv[2] ?? '';

/* ------------------------------------------------------------------ chrome */

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;

  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) {
    throw new Error('Could not find Chrome. Set CHROME to its path and try again.');
  }
  return found;
}

const chrome = findChrome();

/**
 * Shoot one HTML file.
 *
 * Chrome refuses a relative --screenshot path, and silently writes nothing
 * rather than complaining, so the output path is always absolutised here.
 */
function shoot(htmlPath, pngPath, width, height) {
  mkdirSync(dirname(pngPath), { recursive: true });
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--virtual-time-budget=3000',
      `--window-size=${width},${height}`,
      `--screenshot=${resolve(pngPath)}`,
      `file:///${resolve(htmlPath).replace(/\\/g, '/')}`,
    ],
    { stdio: 'pipe' },
  );
}

/* ------------------------------------------------------------- page render */

/**
 * The surfaces render a full document, but a screenshot wants the page frozen:
 * no entry animations mid-flight, no skeleton still pulsing.
 */
function freeze(html) {
  return html.replace(
    '</head>',
    `<style>
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
  /* Skeletons exist for the moment before data lands; a screenshot is after. */
  .t-skel-skeleton { display: none !important; }
  .t-skel-content { position: static !important; opacity: 1 !important; filter: none !important; }
</style></head>`,
  );
}

async function renderToFile(handler, url, name) {
  const response = await handler(new Request(url));
  const html = await response.text();
  const path = join(workDir, `${name}.html`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, freeze(html), 'utf8');
  return path;
}

/* ------------------------------------------------------------ widget pages */

/**
 * The widget is a browser thing: it mounts into a shadow root and talks to the
 * API. To photograph it without a server, the page below stubs `fetch` with
 * the same JSON the API would return and loads the real built bundle.
 */
function widgetHost({ view, config, routes, mobile }) {
  const bundle = readFileSync(join(root, 'packages/widget/dist/widget.global.js'), 'utf8');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body {
    margin: 0;
    min-height: 100vh;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    background:
      radial-gradient(120% 90% at 12% 0%, #EDE7FB 0%, transparent 55%),
      radial-gradient(100% 80% at 95% 10%, #E4F3EE 0%, transparent 50%),
      #F3F1F9;
  }
  ${mobile ? '' : '.page { padding: 44px 52px; max-width: 560px; }'}
  ${mobile ? '.page { display: none }' : ''}
  .page h1 { font-size: 26px; letter-spacing: -.02em; color: #171425; margin: 0 0 8px; }
  .page p { color: #4F4B60; margin: 0 0 26px; max-width: 44ch; line-height: 1.6; }
  .rows { display: grid; gap: 10px; }
  .row {
    background: #fff; border: 1px solid rgba(23,20,37,.05); border-radius: 16px;
    padding: 16px 18px; display: flex; align-items: center; gap: 14px;
    box-shadow: 0 1px 2px rgba(23,20,37,.04);
  }
  .row b { font-size: 14px; color: #171425; font-weight: 650; }
  .row span { color: #8A85A0; font-size: 13px; }
  .row .amt { margin-left: auto; font-weight: 700; color: #171425; font-variant-numeric: tabular-nums; }
  .pill { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .ok { background: #E3F6EE; color: #177A52; }
  .wait { background: #FFF4E0; color: #9A6206; }
  * { animation: none !important; transition: none !important; }
  .t-skel-skeleton { display: none !important; }
  .t-skel-content { position: static !important; opacity: 1 !important; filter: none !important; }
</style></head>
<body>
<div class="page">
  <h1>Expenses</h1>
  <p>Everything you have submitted this month, and where it has got to.</p>
  <div class="rows">
    <div class="row"><b>Gravity Coffee</b><span>Client meeting</span><span class="pill ok">Approved</span><span class="amt">£14.20</span></div>
    <div class="row"><b>Northern Rail</b><span>Travel · Leeds</span><span class="pill ok">Approved</span><span class="amt">£86.50</span></div>
    <div class="row"><b>Figma</b><span>Software</span><span class="pill wait">Waiting</span><span class="amt">£45.00</span></div>
    <div class="row"><b>Hotel Vermeer</b><span>Travel · Amsterdam</span><span class="pill wait">Waiting</span><span class="amt">£212.80</span></div>
  </div>
</div>

<script>
// Answer the widget with exactly what the API would have said.
const ROUTES = ${JSON.stringify(routes)};
window.fetch = async (input) => {
  const url = new URL(String(input), 'http://localhost');
  const key = url.pathname.replace('/api/helpwell', '') + (url.search || '');
  const bare = url.pathname.replace('/api/helpwell', '');
  const body = ROUTES[key] ?? ROUTES[bare] ?? null;
  if (body === null) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
window.__HW_CONFIG = ${JSON.stringify(config)};
</script>
<script>${bundle}</script>
<script>
// Open the panel on the view this shot is meant to show, then freeze it.
addEventListener('helpwell:ready', () => {
  const widget = window.helpwell.widget;
  widget.open(${JSON.stringify(view)});

  // Page-level CSS does not cross a shadow boundary, so the widget's own
  // entry animations have to be stopped from inside its root. Without this
  // the screenshot catches every bubble part way through its fade.
  const freeze = document.createElement('style');
  // Only animations and transitions. Forcing opacity or transform here would
  // also flatten the wordmark's SVG translates and un-hide the launcher icon
  // the open state deliberately fades out.
  freeze.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important}' +
    '.t-skel-skeleton{display:none!important}' +
    '.t-skel-content{position:static!important;opacity:1!important;filter:none!important}';

  const stamp = () => {
    for (const host of [widget.shadowRoot, document.querySelector('helpwell-engage')?.shadowRoot]) {
      if (host && !host.querySelector('[data-freeze]')) {
        const copy = freeze.cloneNode(true);
        copy.setAttribute('data-freeze', '');
        host.appendChild(copy);
      }
    }
  };

  // Re-stamp as views render, so a later page load is frozen too.
  stamp();
  setInterval(stamp, 60);
});
</script>
</body></html>`;
}

/* ------------------------------------------------------------------- main */

const handle = await seed();
const { db } = handle;

const help = createHelpCenter({
  db,
  basePath: '/help',
  origin: 'https://ridgeline.example.com',
  apiPath: '/api/helpwell',
  // The repo link is a real feature and belongs in the screenshot.
  editUrlTemplate: 'https://github.com/ridgeline/app/edit/main/docs/{path}',
});

const api = createHelpWellHandler({ db, basePath: '/api/helpwell' });

/**
 * Ask the real API what a route returns.
 *
 * The widget fixtures below are hand-written because the widget runs in the
 * browser and cannot reach this process. Hand-written fixtures go stale: the
 * collections one quietly kept the old response shape through a change and
 * photographed a row of cards with no titles on them. Anything the real API
 * can answer should therefore come from the real API.
 */
async function fromApi(path) {
  const response = await api(new Request(`https://ridgeline.example.com/api/helpwell${path}`));
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

const dashboard = createDashboard({
  db,
  basePath: '/admin/helpwell',
  apiPath: '/api/helpwell',
  isAdmin: () => true,
  readInstructions: () =>
    readFileSync(join(root, 'packages/core/src/agent/prompt.ts'), 'utf8')
      .split('export const DEFAULT_INSTRUCTIONS = `')[1]
      ?.split('`;')[0]
      ?.replace(/\{\{\s*product\s*\}\}/g, 'Ridgeline') ?? '',
  repoUrlTemplate: 'https://github.com/ridgeline/app/blob/main/docs/{path}',
  docsDir: 'docs/',
});

const DESKTOP = [1440, 820];
const TALL = [1440, 1180];

/** Every shot: a name, how to render it, and the window to render it in. */
const SHOTS = [
  [
    'dashboard-conversations',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/conversations', 'dash-conversations'),
    DESKTOP,
  ],
  [
    'dashboard-conversation',
    () =>
      renderToFile(dashboard, 'http://x/admin/helpwell/conversations/cnv_1', 'dash-conversation'),
    TALL,
  ],
  [
    'dashboard-contacts',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/contacts', 'dash-contacts'),
    DESKTOP,
  ],
  [
    'dashboard-contact',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/contacts/con_ada', 'dash-contact'),
    DESKTOP,
  ],
  [
    'dashboard-knowledge',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/knowledge', 'dash-knowledge'),
    TALL,
  ],
  [
    'dashboard-gaps',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/gaps', 'dash-gaps'),
    DESKTOP,
  ],
  [
    'dashboard-reports',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/reports', 'dash-reports'),
    [1440, 1500],
  ],
  [
    'dashboard-changelog',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/changelog', 'dash-changelog'),
    DESKTOP,
  ],
  [
    'dashboard-roadmap',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/roadmap', 'dash-roadmap'),
    DESKTOP,
  ],
  [
    'dashboard-engage',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/engage', 'dash-engage'),
    DESKTOP,
  ],
  [
    'dashboard-evals',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/evals/evl_1', 'dash-evals'),
    DESKTOP,
  ],
  [
    'dashboard-settings-agent',
    () =>
      renderToFile(dashboard, 'http://x/admin/helpwell/settings?tab=agent', 'dash-settings-agent'),
    [1440, 1500],
  ],
  [
    'dashboard-settings-widget',
    () =>
      renderToFile(
        dashboard,
        'http://x/admin/helpwell/settings?tab=widget',
        'dash-settings-widget',
      ),
    [1440, 1400],
  ],
  [
    'dashboard-connections',
    () => renderToFile(dashboard, 'http://x/admin/helpwell/connections', 'dash-connections'),
    TALL,
  ],

  [
    'helpcenter-home',
    () => renderToFile(help, 'https://ridgeline.example.com/help', 'hc-home'),
    [1280, 1000],
  ],
  [
    'helpcenter-article',
    () =>
      renderToFile(
        help,
        'https://ridgeline.example.com/help/billing/exporting-invoices',
        'hc-article',
      ),
    [1280, 1150],
  ],
  [
    'helpcenter-search',
    () => renderToFile(help, 'https://ridgeline.example.com/help/search?q=export', 'hc-search'),
    [1280, 780],
  ],
  [
    'helpcenter-changelog',
    () => renderToFile(help, 'https://ridgeline.example.com/help/changelog', 'hc-changelog'),
    [1280, 1000],
  ],
  [
    'helpcenter-roadmap',
    () => renderToFile(help, 'https://ridgeline.example.com/help/roadmap', 'hc-roadmap'),
    [1280, 860],
  ],
];

/* --------------------------------------------------------- widget fixtures */

const widgetConfig = {
  product: { name: 'Ridgeline', locale: 'en' },
  widget: {
    position: 'bottom-right',
    offset: { x: 28, y: 28 },
    zIndex: 2147483000,
    tabs: { home: true, messages: true, help: true, updates: true, roadmap: true },
    appearance: {
      theme: 'light',
      accent: '#7A3BEB',
      bubbleStyle: 'rounded',
      pattern: 'waves',
      patternImageUrl: null,
      font: 'Plus Jakarta Sans',
      radius: 24,
      launcherIconUrl: null,
    },
    displayRules: { include: ['**'], exclude: [], audience: 'all', devices: ['desktop', 'mobile'] },
    preChat: {
      when: 'never',
      timing: 'before',
      fields: ['email', 'name'],
      requireEmail: true,
      consentLine: 'We use it for this conversation and nothing else.',
    },
    statusUrl: '',
  },
  helpCenter: {
    subpath: '/help',
    domain: '',
    search: true,
    askAgent: true,
    ratings: true,
    readingTime: true,
    poweredBy: true,
    theme: {},
  },
  changelog: {
    widgetTab: true,
    notification: 'badge',
    roadmapEnabled: true,
    whoCanSubmit: 'identified',
  },
  unread: 2,
};

const widgetRoutes = {
  '/config': widgetConfig,
  '/changelog/unread': { count: 2 },
  '/engage': { items: [] },
  '/collections': await fromApi('/collections'),
  '/conversations': {
    items: [
      {
        id: 'cnv_1',
        status: 'resolved',
        topic: 'Billing',
        lastMessageAt: new Date(Date.now() - 26 * 60_000).toISOString(),
        snippet: 'How do I export a whole year of invoices at once?',
      },
      {
        id: 'cnv_2',
        status: 'resolved',
        topic: 'Approvals',
        lastMessageAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        snippet: 'Can someone else approve while I am on holiday?',
      },
    ],
  },
  '/changelog?limit=3': {
    items: [
      {
        id: 'chg_2026_08',
        version: '3.2.0',
        title: 'Receipts read themselves',
        summary: 'Photograph a receipt and the amount, date and merchant fill in.',
        tags: ['Improved'],
        coverUrl: null,
        publishedAt: '2026-08-18T09:00:00.000Z',
        read: false,
      },
    ],
  },
  '/changelog?limit=10': {
    items: [
      {
        id: 'chg_2026_08',
        version: '3.2.0',
        title: 'Receipts read themselves',
        summary: 'Photograph a receipt and the amount, date and merchant fill in.',
        tags: ['Improved'],
        coverUrl: null,
        publishedAt: '2026-08-18T09:00:00.000Z',
        read: false,
      },
      {
        id: 'chg_2026_07',
        version: '3.1.0',
        title: 'Approve from your phone',
        summary: 'The approval queue now works properly on a small screen.',
        tags: ['New'],
        coverUrl: null,
        publishedAt: '2026-07-02T09:00:00.000Z',
        read: false,
      },
      {
        id: 'chg_2026_06',
        version: '3.0.4',
        title: 'Exports stopped timing out',
        summary: 'A year of invoices exports in about four seconds.',
        tags: ['Fixed'],
        coverUrl: null,
        publishedAt: '2026-06-11T09:00:00.000Z',
        read: true,
      },
    ],
    nextCursor: null,
  },
  '/roadmap': {
    in_progress: [
      {
        id: 'r1',
        title: 'Per-diem rates by country',
        body: 'Set a rate per country and per city.',
        status: 'in_progress',
        votesCount: 34,
        voted: true,
      },
      {
        id: 'r2',
        title: 'Mileage tracking from your phone',
        body: null,
        status: 'in_progress',
        votesCount: 28,
        voted: false,
      },
    ],
    planned: [
      {
        id: 'r3',
        title: 'Split an expense across projects',
        body: 'One receipt, several cost centres.',
        status: 'planned',
        votesCount: 61,
        voted: false,
      },
      {
        id: 'r4',
        title: 'Corporate card issuing',
        body: null,
        status: 'planned',
        votesCount: 47,
        voted: false,
      },
    ],
    under_review: [
      {
        id: 'r5',
        title: 'Recurring expenses',
        body: null,
        status: 'under_review',
        votesCount: 19,
        voted: false,
      },
    ],
    shipped: [
      {
        id: 'r7',
        title: 'Bulk receipt upload',
        body: null,
        status: 'shipped',
        votesCount: 55,
        voted: false,
      },
    ],
  },
  // Straight from the real route, so the article shot can never drift from
  // what the API actually returns.
  '/articles/billing/exporting-invoices': await fromApi('/articles/billing/exporting-invoices'),
  '/articles?collection=billing': await fromApi('/articles?collection=billing'),
};

const chatRoutes = {
  ...widgetRoutes,
  '/conversations/cnv_1': {
    id: 'cnv_1',
    status: 'resolved',
    messages: [
      {
        id: 'm1',
        role: 'customer',
        body: 'How do I export a whole year of invoices at once?',
        citations: [],
        feedback: null,
        createdAt: new Date(Date.now() - 300_000).toISOString(),
      },
      {
        id: 'm2',
        role: 'agent',
        body: 'Open **Billing → Invoices**, set the date range to the year you want, then press **Export**.\n\nAnything over a hundred invoices is sent to you as a zip rather than downloading directly, because the browser tends to give up part way through a download that large.',
        citations: [
          {
            slug: 'billing/exporting-invoices',
            title: 'Exporting invoices',
            collection: 'Billing',
          },
        ],
        feedback: 'helpful',
        createdAt: new Date(Date.now() - 290_000).toISOString(),
      },
    ],
  },
};

// The panel is 400px wide and sits 28px from the edge, so the window has to
// be wide enough to show it and the page it is sitting on.
const WIDGET = [1080, 780];

const WIDGET_SHOTS = [
  ['widget-home', { name: 'home' }, widgetRoutes, WIDGET, false],
  ['widget-chat', { name: 'chat', conversationId: 'cnv_1' }, chatRoutes, WIDGET, false],
  ['widget-help', { name: 'help' }, widgetRoutes, WIDGET, false],
  [
    'widget-article',
    { name: 'article', slug: 'billing/exporting-invoices', from: { name: 'help' } },
    widgetRoutes,
    WIDGET,
    false,
  ],
  ['widget-updates', { name: 'updates' }, widgetRoutes, WIDGET, false],
  ['widget-roadmap', { name: 'roadmap' }, widgetRoutes, WIDGET, false],
  // Under 480px the panel takes the whole screen, which is the mobile design.
  ['widget-mobile', { name: 'home' }, widgetRoutes, [400, 760], true],
];

/* ------------------------------------------------------------------- run */

rmSync(workDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const taken = [];

for (const [name, render, [width, height]] of SHOTS) {
  if (filter && !name.includes(filter)) continue;
  const htmlPath = await render();
  shoot(htmlPath, join(outDir, `${name}.png`), width, height);
  taken.push(name);
  process.stdout.write(`  ${name}\n`);
}

for (const [name, view, routes, [width, height], mobile] of WIDGET_SHOTS) {
  if (filter && !name.includes(filter)) continue;
  const html = widgetHost({ view, config: widgetConfig, routes, mobile });
  const htmlPath = join(workDir, `${name}.html`);
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html, 'utf8');
  shoot(htmlPath, join(outDir, `${name}.png`), width, height);
  taken.push(name);
  process.stdout.write(`  ${name}\n`);
}

await handle.close();
rmSync(workDir, { recursive: true, force: true });

process.stdout.write(`\n${taken.length} screenshots in docs/screenshots\n`);
