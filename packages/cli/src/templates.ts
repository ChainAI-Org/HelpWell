/**
 * What `helpwell init` writes into a repo.
 *
 * Everything here is a starting point the team is meant to edit, so it is
 * written the way a person would write it rather than as a stub with TODOs.
 * The instructions in particular already contain the rules most people would
 * otherwise have to discover the hard way.
 */

import { formatSetupPrompt } from '@helpwell/core';
import { DEFAULT_INSTRUCTIONS, starterEvalCases } from '@helpwell/core/agent';
import {
  captureLoginSetupPrompt,
  captureSetupPrompt,
  writeArticleSetupPrompt,
} from '@helpwell/core/content';

export const instructionsTemplate = (productName: string): string =>
  DEFAULT_INSTRUCTIONS.replace(/\{\{\s*product\s*\}\}/g, productName);

export const playbookTemplate = (productName: string): string => `# Playbook

Tone, wording and the handful of cases the docs do not cover. The agent reads
this alongside its instructions, so keep it short — everything here competes
for attention with the articles it is quoting.

## Voice

- Plain, warm, and short. One idea per sentence.
- Say "you", not "the user". Say "${productName}", not "the platform".
- Never apologise twice in one answer.

## Things to get right

- Prices and limits change. Quote the article, never a number from memory.
- If someone sounds stuck rather than confused, acknowledge that before
  explaining anything.
- If the answer is "not yet", say so plainly and point at the roadmap.

## Cases the docs do not cover

Add them here as they come up. Each one is two lines: what someone asks, and
what a good answer sounds like.
`;

const FENCE = '```';

/** A fenced block whose fence is longer than any backtick run inside it. */
function fenced(language: string, content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}${language}\n${content.replace(/\s+$/, '')}\n${marks}`;
}

/**
 * The docs folder's README: how articles work, the block vocabulary, and how
 * screenshots are taken, annotated and served. Every setup step that needs a
 * change in the app comes with a prompt to hand to an AI assistant, and none
 * of them contains a credential.
 */
export const docsReadme = (
  productName: string,
  options: { docs?: string; appUrl?: string } = {},
): string => {
  const docs = options.docs ?? 'docs';
  const prompt = { docs, screenshots: `${docs}/_screenshots`, appUrl: options.appUrl };
  return `# ${productName} help articles

Every file in here is a help article. The folder is the collection, the file is
the article, and the front matter is the metadata.

    ${docs}/
      getting-started/
        installing.md
        your-first-week.md
      billing/
        invoices.md

Front matter:

${FENCE}yaml
---
title: Exporting invoices
description: Download a PDF of any invoice.
status: published        # or draft, or archived
order: 1                 # within the collection
appliesTo: Pro and above # optional
---
${FENCE}

After editing, run \`helpwell sync\` to reindex. The repo is the source of
truth: the dashboard's editor saves back into these files through your app
(see "Editing from the dashboard" below), never anywhere else.

## Blocks

Headings, lists, tables, code, links and images all work. The help center and
the widget also understand these blocks, and \`helpwell docs generate\` and
\`docs update\` know how to write them.

### Callouts

${FENCE}md
> [!TIP]
> Export before you close the month.
${FENCE}

\`NOTE\`, \`TIP\`, \`IMPORTANT\`, \`WARNING\` or \`CAUTION\`, as on GitHub. Text after
the marker becomes the title: \`> [!WARNING] Deleting is permanent\`.

### Steps

${FENCE}md
:::steps
### Open Billing
Go to **Settings**, then **Billing**.

![The billing page](../_screenshots/billing.png)

### Export
Click **Export** and pick a month.
:::
${FENCE}

Each heading starts a numbered step, and everything under it is that step.
Without headings, a numbered list inside \`:::steps\` is drawn as steps.

### Tabs

${FENCE}md
:::tabs
== macOS
Press **Cmd+K**.
== Windows
Press **Ctrl+K**.
:::
${FENCE}

In the widget, tabs show as collapsible sections with the first one open.

### Accordions

${FENCE}md
:::details How are refunds calculated?
Pro rata, to the day.
:::
${FENCE}

### Video

${FENCE}md
![Setting up billing](https://www.youtube.com/watch?v=VIDEO_ID)
${FENCE}

On a line of its own: a YouTube, Vimeo, Loom or Wistia link, or an \`.mp4\` or
\`.webm\` file, which can sit beside the article like an image. YouTube plays
from youtube-nocookie.com. In the widget such a video is a link that opens the
player, because the widget lives on your app's pages and a
third-party player does not belong there. Anywhere else in a sentence, a video
is a plain link.

## Screenshots

Reference a screenshot by its path from the article:

${FENCE}md
![The dashboard](../_screenshots/dashboard.png)
${FENCE}

\`helpwell sync\` rewrites that to where your API serves it,
\`/api/helpwell/screenshots/dashboard.png\`, so the same image loads in the help
center and in the widget. An image beside an article (\`./step-1.png\`) works the
same way, from \`/api/helpwell/media/\`. If your app mounts the API somewhere
else, set \`"apiPath"\` in \`helpwell/helpwell.config.json\`.

\`helpwell capture\` retakes the images, against your running app, so a release
can refresh them like anything else. List them under \`screenshots.shots\` in
\`helpwell/helpwell.config.json\`:

${FENCE}json
"screenshots": {
  "dir": "${docs}/_screenshots",
  "shots": [
    { "name": "dashboard", "path": "/dashboard", "waitFor": ".chart", "clip": ".main" },
    {
      "name": "billing",
      "path": "/settings/billing",
      "dark": true,
      "annotate": [
        { "type": "spotlight", "target": "#plan-card" },
        { "type": "step", "target": "#upgrade" },
        { "type": "arrow", "target": "#upgrade", "direction": "left", "text": "Upgrade here" }
      ]
    }
  ]
}
${FENCE}

Each shot needs a \`name\` (the file, without \`.png\`) and a \`path\` on the app.
\`waitFor\` and \`click\` take CSS selectors, \`clip\` crops to one, and
\`dark: true\` also writes \`<name>-dark.png\`.

### Annotations

\`annotate\` draws on the page just before the shot, in light and dark. Each
item points at a CSS selector in \`target\`, not at pixels, so it follows the
element when the layout moves.

| type | draws |
| --- | --- |
| \`rect\` | a box around the target |
| \`ellipse\` | an ellipse around it |
| \`arrow\` | an arrow pointing at it. \`direction\` is the way it points (\`down\` by default), \`text\` a caption at its tail, \`length\` in pixels |
| \`step\` | a numbered marker on its corner, numbered in order unless \`step\` sets the number |
| \`label\` | \`text\` beside it. \`direction\` is the side it sits on (\`bottom\` by default) |
| \`spotlight\` | dims everything but the target |
| \`blur\` | blurs it: an email, a key, a customer's name |

Every item can also take \`color\` (a hex colour; the widget accent by default),
\`offset\` (\`{ "x": 0, "y": 8 }\`) and \`padding\`. A target that matches nothing is
skipped and \`capture\` says which one; it is never drawn somewhere else. A
\`"blur": [".account-email"]\` list under \`screenshots\` blurs those selectors on
every shot.

### Pages behind a sign-in

${FENCE}json
"screenshots": {
  "login": {
    "url": "/login",
    "fill": [
      { "selector": "input[name=email]", "env": "HELPWELL_CAPTURE_EMAIL" },
      { "selector": "input[name=password]", "env": "HELPWELL_CAPTURE_PASSWORD" }
    ],
    "submit": "button[type=submit]",
    "success": "[data-testid=account-menu]"
  }
}
${FENCE}

The config names environment variables and never holds a value: a \`value\` in
\`fill\` is refused. HelpWell signs in once and reuses the session for every
shot. \`success\` is a selector that only exists once signed in; \`successUrl\`
(part of the URL the app lands on) works instead. Use a test account with demo
data. Two alternatives: \`"storageState": "helpwell/.auth/state.json"\`, a
Playwright storage-state file you keep out of git, and
\`"cookies": [{ "name": "session", "env": "APP_SESSION" }]\`.

### Set this up with an AI assistant

Screenshot capture:

${fenced('', formatSetupPrompt(captureSetupPrompt(prompt)))}

Capturing pages behind the sign-in:

${fenced('', formatSetupPrompt(captureLoginSetupPrompt(prompt)))}

## Editing from the dashboard

The dashboard's knowledge base can edit an article or start a new one, with a
live preview. Saving writes the file into this folder through a
\`writeArticle(path, markdown)\` hook your app passes to \`createDashboard\`, then
re-indexes it. Without the hook, the editor offers the file to copy or download
and names the path to save it to. Every change the index sees, from a sync or
the editor, is kept in the article's history with a diff.

### Set this up with an AI assistant

${fenced('', formatSetupPrompt(writeArticleSetupPrompt({ docs })))}
`;
};

export const firstArticle = (productName: string): string => `---
title: Welcome to ${productName}
description: What ${productName} does and how to get going.
status: published
order: 0
---

# Welcome to ${productName}

This is the first article in your help center. Replace it with something real,
or delete it and run \`helpwell docs generate\` to draft a set from your code.

## How this works

Articles are Markdown files in \`docs/\`. Edit them like any other file in your
repo, open a pull request, and run \`helpwell sync\` to reindex.

The assistant answers from these articles and nothing else. If it cannot find
an answer, it says so and logs the question as a gap, so you know what to write
next.
`;

/**
 * Twelve starter cases that hold for any product (core's `starterEvalCases`):
 * two answered from the welcome article, and ten about not inventing prices
 * or dates, saying so when the docs do not cover something, never echoing a
 * secret, and staying on topic.
 */
export const evalsTemplate = (productName: string): string =>
  `${JSON.stringify(
    {
      $schema: 'https://helpwell.dev/schema/evals.json',
      cases: starterEvalCases(productName),
    },
    null,
    2,
  )}\n`;

/** Where `helpwell init --ci` writes the workflow, from the repo root. */
export const EVALS_WORKFLOW_PATH = '.github/workflows/helpwell-evals.yml';

/**
 * An optional GitHub Actions workflow that runs the evals on every pull
 * request touching the docs or the agent's instructions, and fails the check
 * when the score drops below the threshold. `init` writes it only when asked.
 */
export const evalsWorkflowTemplate = (
  docs: string,
): string => `# HelpWell evals: replay helpwell/evals.json against your docs on every pull
# request that changes them, and fail the check when the score drops.
#
# Written by \`helpwell init --ci\`. Add OPENROUTER_API_KEY as a repository
# secret so the agent can answer; without it the run measures retrieval only.
# HELPWELL_DATABASE_URL is optional: unset, each run indexes the docs into a
# throwaway embedded database. Set it to record runs where the dashboard's
# Evals page can show them.
name: HelpWell evals

on:
  pull_request:
    paths:
      - '${docs.replace(/\/+$/, '')}/**'
      - 'helpwell/**'
  workflow_dispatch:

jobs:
  eval:
    runs-on: ubuntu-latest
    env:
      OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
      HELPWELL_DATABASE_URL: \${{ secrets.HELPWELL_DATABASE_URL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx helpwell sync
      - run: npx helpwell eval --ref \${{ github.sha }} --threshold 80
`;

/** Where `helpwell init --ci` writes the docs workflow, from the repo root. */
export const DOCS_WORKFLOW_PATH = '.github/workflows/helpwell-docs.yml';

/**
 * An optional GitHub Actions workflow for installs that are not hosted: on
 * every push to the main branch that changes code, `helpwell docs update`
 * rewrites the articles the push made wrong, and the workflow opens a pull
 * request with them. Nothing is merged or published without a person.
 */
export const docsWorkflowTemplate = (docs: string, branch = 'main'): string => {
  const folder = docs.replace(/\/+$/, '');
  return `# HelpWell docs: on every push to ${branch}, rewrite the help articles the
# change made wrong (helpwell docs update) and open a pull request with them.
#
# Written by \`helpwell init --ci\`. Add OPENROUTER_API_KEY as a repository
# secret: the model reads the diff and the articles. The pull request is
# opened with the workflow's own token, so allow it once under Settings,
# Actions, General, Workflow permissions: "Allow GitHub Actions to create and
# approve pull requests". Nothing is merged without a person.
name: HelpWell docs

on:
  push:
    branches: [${branch}]
    paths-ignore:
      - '${folder}/**'
      - 'helpwell/**'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: helpwell-docs
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    env:
      OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Rewrite the articles this push made wrong
        run: npx helpwell docs update --since "\${{ github.event.before || 'HEAD~1' }}"
      - name: Open a pull request with them
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          if git diff --quiet -- '${folder}'; then echo "Every article still reads correctly."; exit 0; fi
          branch="helpwell/docs-\${GITHUB_SHA::7}"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git switch -c "$branch"
          git add -- '${folder}'
          git commit -m "Update help articles for \${GITHUB_SHA::7}"
          git push origin "$branch"
          gh pr create --base ${branch} --head "$branch" --title "Update help articles for \${GITHUB_SHA::7}" --body "helpwell docs update rewrote the articles this push made wrong. Read them like any other change before you merge."
`;
};

export const envExample = `# The only key HelpWell needs. Yours, from openrouter.ai.
OPENROUTER_API_KEY=

# Where HelpWell stores conversations. Leave unset in development and it uses
# an embedded Postgres under helpwell/data. HelpWell never reads DATABASE_URL:
# that is your app's own database, and usually production.
# HELPWELL_DATABASE_URL=postgres://user:pass@host:5432/db

# Shared secret for signed identify tokens. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
HELPWELL_IDENTITY_SECRET=

# Optional. The admin token: enter it on the dashboard's sign-in page, or
# send it as a bearer token from scripts and CI. Until you replace the isAdmin
# that \`helpwell init\` printed with your app's own check, it is the only way
# in. At least 32 characters; generate it the same way.
# HELPWELL_ADMIN_TOKEN=

# Optional. Lets helpwell changelog read GitHub releases: read-only access
# to this repo's contents. Without it GitHub allows 60 requests an hour and
# cannot see a private repo. helpwell changelog --prompt walks through it.
# GITHUB_TOKEN=
`;

export const gitignoreAdditions = `
# HelpWell
helpwell/data/
# A capture session (screenshots.storageState): a live sign-in, never committed.
helpwell/.auth/
`;

/** The frameworks `init --framework` writes mount code for. */
export type TemplateFramework = 'next' | 'remix' | 'node' | 'hono';

/** One file of the mount code `init` prints. */
export interface MountFile {
  /** Where it goes, from the app's root. */
  path: string;
  content: string;
  /**
   * Lines to merge into a file the app already has (next.config.ts, the file
   * that creates the Hono app), rather than a file of their own.
   */
  merge?: boolean;
}

/**
 * The shared module: who is an admin, and the three handlers, made on the
 * first request.
 *
 * The admin check is the one part an app must replace, and the one part that
 * is dangerous to get wrong, so what ships fails closed. It used to be a
 * placeholder that read a `role=admin` cookie, which anyone can set in their
 * own browser, and a placeholder like that gets deployed. This one admits
 * only whoever holds HELPWELL_ADMIN_TOKEN, a secret a person put in the
 * server's environment themselves, and nobody at all until they have. The
 * dashboard's locked-out page takes the token in a form and keeps it in a
 * cookie, so a browser gets in too; the cookie holds the secret itself.
 *
 * The database opens on the first request rather than on import, because
 * `next build` imports every route to read its settings, and a build must
 * never open or migrate a database.
 */
function sharedModule(docs: string): string {
  return `import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHelpWellHandler } from '@helpwell/core';
import { ADMIN_COOKIE, readCookie } from '@helpwell/core/api';
import { createDb, migrate } from '@helpwell/core/db';
import { createDashboard } from '@helpwell/dashboard';
import { createHelpCenter } from '@helpwell/helpcenter';
import { widgetAssets } from '@helpwell/widget/server';

/** A file \`helpwell init\` wrote, or '' when it is not there. */
const read = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

/** HELPWELL_ADMIN_TOKEN, when it is long enough to be a secret: 32 characters or more. */
function adminToken(): string | undefined {
  const token = process.env.HELPWELL_ADMIN_TOKEN ?? '';
  return token.length >= 32 ? token : undefined;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Who may open the dashboard and call the admin API.
 *
 * TODO: replace with your app's own admin check, such as
 *   const isAdmin = async (request: Request) => (await getSession(request))?.role === 'admin';
 *
 * Until you do, this fails closed: the only admin is a request carrying
 * HELPWELL_ADMIN_TOKEN, as \`Authorization: Bearer <token>\` or in the
 * hw_admin cookie the dashboard sets once someone enters the token there,
 * and while that variable is unset or under 32 characters, nobody is. A
 * cookie only counts when it holds the token itself, so nobody can make one
 * up. The token keeps working after you replace this, because the API and
 * the dashboard are both given it as adminToken; leave it unset to turn it off.
 */
function isAdmin(request: Request): boolean {
  const token = adminToken();
  const bearer = /^Bearer\\s+(\\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  return [bearer, readCookie(request, ADMIN_COOKIE)].some(
    (presented) => !!token && !!presented && timingSafeEqual(digest(presented), digest(token)),
  );
}

async function start() {
  const { db } = await createDb({});
  await migrate(db);
  return {
    api: createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      // Serves the widget at /api/helpwell/assets/loader.js. No copy step.
      assets: widgetAssets(),
      // The agent's system prompt and playbook, from the files \`init\` wrote.
      instructions: read('helpwell/instructions.md'),
      playbook: read('helpwell/playbook.md'),
      // Serves the screenshots and images your articles reference.
      media: { docs: '${docs}', screenshots: '${docs}/_screenshots' },
      // The dashboard saves settings through this API, so it takes the same checks.
      isAdmin,
      adminToken: adminToken(),
      // Other sites that may call the API, such as the widget on another origin.
      // corsOrigins: ['https://www.example.com'],
    }),
    help: createHelpCenter({ db, basePath: '/help' }),
    dashboard: createDashboard({
      db,
      basePath: '/admin/helpwell',
      // Your app already knows who is signed in. HelpWell never adds a second login.
      isAdmin,
      // With a token set, the locked-out page offers a form to enter it.
      adminToken: adminToken(),
      // Lets the article editor save into the repo. Leave it out where the
      // server's disk is not the repo, and the editor offers a download instead.
      writeArticle: async (path, markdown) => {
        const file = join(process.cwd(), '${docs}', path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, markdown, 'utf8');
      },
    }),
  };
}

// One start per process, shared by every route and kept across the dev
// server's reloads. A start that fails is forgotten, so the next request retries.
const cache = globalThis as typeof globalThis & { __helpwell?: ReturnType<typeof start> };

/** HelpWell, opened and migrated on the first request, never on import. */
export function getHelpWell(): ReturnType<typeof start> {
  cache.__helpwell ??= start().catch((error: unknown) => {
    cache.__helpwell = undefined;
    throw error;
  });
  return cache.__helpwell;
}

export const api = async (request: Request) => (await getHelpWell()).api(request);
export const help = async (request: Request) => (await getHelpWell()).help(request);
export const dashboard = async (request: Request) => (await getHelpWell()).dashboard(request);`;
}

/**
 * Plain Node, Express, and anything that hands over a web Request.
 *
 * HelpWell's handlers take a web Request. Express and \`node:http\` hand over
 * Node's own request and response, so this converts between the two; the
 * body is read only for HelpWell's own paths, so the app's routes still get
 * theirs, and the response is streamed back as it is written.
 */
const NODE_ADAPTER = `import type { IncomingMessage, ServerResponse } from 'node:http';
import { api, dashboard, help } from './helpwell';

/** The handler for a path, or null for a path that stays your app's. */
function handlerFor(pathname: string) {
  const under = (base: string) => pathname === base || pathname.startsWith(\`\${base}/\`);
  if (under('/api/helpwell')) return api;
  if (under('/help')) return help;
  if (under('/admin/helpwell')) return dashboard;
  return null;
}

/**
 * For anything that hands you a web Request (SvelteKit's handle hook, Nuxt's
 * toWebRequest, Bun.serve, Deno.serve): HelpWell's Response, or null to go on
 * to your own routes.
 */
export async function helpwellFetch(request: Request): Promise<Response | null> {
  const handler = handlerFor(new URL(request.url).pathname);
  return handler ? handler(request) : null;
}

/**
 * For Express, \`app.use(helpwellNode)\` before any body parser. For plain
 * node:http, \`createServer((req, res) => helpwellNode(req, res, () => yourApp(req, res)))\`.
 */
export async function helpwellNode(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const url = new URL(req.url ?? '/', \`\${proto}://\${req.headers.host ?? 'localhost'}\`);
  const handler = handlerFor(url.pathname);
  if (!handler) return next();

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const chunks: Uint8Array[] = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req) chunks.push(chunk as Uint8Array);
  }
  const response = await handler(
    new Request(url, {
      method: req.method,
      headers,
      body: chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined,
    }),
  );

  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  if (response.body) {
    const reader = response.body.getReader();
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      res.write(part.value);
    }
  }
  res.end();
}`;

/** Next.js needs a route file per handler, with the runtime and caching settled. */
const nextRoute = (handler: string, methods: string[]) =>
  `import { ${handler} } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
${methods
  .map((method) =>
    method === 'OPTIONS'
      ? `// The preflight of a widget on another site (corsOrigins).\nexport const OPTIONS = ${handler};`
      : `export const ${method} = ${handler};`,
  )
  .join('\n')}`;

/**
 * Every file that mounts HelpWell in `framework`: the shared module, then
 * the API (every method it answers, the widget's cross-origin preflight
 * included), the help centre and the dashboard.
 */
export function mountFiles(framework: TemplateFramework, docs = 'docs'): MountFile[] {
  const shared = sharedModule(docs);
  switch (framework) {
    case 'next':
      return [
        { path: 'lib/helpwell.ts', content: shared },
        {
          path: 'app/api/helpwell/[[...route]]/route.ts',
          content: nextRoute('api', ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']),
        },
        { path: 'app/help/[[...slug]]/route.ts', content: nextRoute('help', ['GET']) },
        {
          path: 'app/admin/helpwell/[[...route]]/route.ts',
          content: nextRoute('dashboard', ['GET', 'POST']),
        },
        {
          path: 'next.config.ts',
          merge: true,
          content: `// In the config object: HelpWell loads its database driver at runtime,
// which a bundler cannot follow, so it stays out of the server bundle.
serverExternalPackages: ['@helpwell/core', '@helpwell/helpcenter', '@helpwell/dashboard', '@helpwell/widget'],`,
        },
      ];

    case 'remix': {
      const route = (handler: string, action: boolean, note = '') =>
        `import { ${handler} } from '~/lib/helpwell.server';

${note}export const loader = ({ request }: { request: Request }) => ${handler}(request);${
          action
            ? `\nexport const action = ({ request }: { request: Request }) => ${handler}(request);`
            : ''
        }`;
      return [
        { path: 'app/lib/helpwell.server.ts', content: shared },
        {
          path: 'app/routes/api.helpwell.$.tsx',
          content: route(
            'api',
            true,
            '// Both hand every request to HelpWell, whatever its method. Remix sends GET\n// and HEAD to the loader and POST, PATCH and DELETE to the action, but which\n// one gets OPTIONS (the preflight of a widget on another site) depends on the\n// Remix or React Router version, so neither one assumes it never will.\n',
          ),
        },
        { path: 'app/routes/help.$.tsx', content: route('help', false) },
        { path: 'app/routes/admin.helpwell.$.tsx', content: route('dashboard', true) },
      ];
    }

    case 'hono':
      return [
        { path: 'lib/helpwell.ts', content: shared },
        {
          path: 'the file that creates your Hono app',
          merge: true,
          content: `import { api, dashboard, help } from './lib/helpwell';

// Hono's "/x/*" does not match "/x" itself, hence both forms. \`all\` includes
// OPTIONS, the preflight of a widget on another site.
app.all('/api/helpwell/*', (c) => api(c.req.raw));
app.on('GET', ['/help', '/help/*'], (c) => help(c.req.raw));
app.on(['GET', 'POST'], ['/admin/helpwell', '/admin/helpwell/*'], (c) => dashboard(c.req.raw));`,
        },
      ];

    default:
      return [
        { path: 'lib/helpwell.ts', content: shared },
        { path: 'lib/helpwell-node.ts', content: NODE_ADAPTER },
      ];
  }
}

/** The mount code as `init` prints it: every file, each under a comment naming it. */
export function mountSnippet(framework: TemplateFramework, docs = 'docs'): string {
  return mountFiles(framework, docs)
    .map(
      (file) =>
        `// ${file.path}${file.merge ? ', merged into what is there' : ''}\n${file.content}`,
    )
    .join('\n\n');
}

/** The loader is served by the API handler, so it lives under the API path. */
export const widgetSnippet = (apiPath: string): string =>
  `<script src="${apiPath.replace(/\/+$/, '')}/assets/loader.js" defer></script>`;
