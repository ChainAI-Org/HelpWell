<div align="center">

# HelpWell

**The Autonomous Help Desk.**

An open-source AI agent that answers your customers, writes and updates its
own knowledge base from your code, and learns from every question you train
it on.

The open-source alternative to Intercom, Zendesk, Help Scout, Freshdesk, Crisp
and Front, for teams that want AI-first customer support.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](LICENSE)

[Who it's for](#who-its-for) · [Quick start](#quick-start) · [Set it up with an AI assistant](#set-it-up-with-an-ai-assistant) · [What you get](#what-you-get) · [The CLI](#the-cli) · [How it works](#how-it-works) · [Configuration](#configuration) · [Docs](#docs) · [HelpWell Cloud](#helpwell-cloud)

</div>

---

Install HelpWell into your repo and your support runs itself:

- **It answers on its own.** The agent replies in a chat widget and a help
  center, from your docs and nothing else, and cites the article behind every
  answer. When the docs do not cover a question, it says so instead of
  guessing.
- **It writes and updates its own knowledge base.** `helpwell docs generate`
  drafts the first articles from your code. After that, every push rewrites
  the articles your change made wrong and opens a pull request, on your own
  OpenRouter key. Nothing merges without you.
- **You train it to answer.** Every question it could not answer becomes a
  gap, ranked by how often people ask it, and one click drafts the missing
  article from the ways they asked. Review its answers, write the cases your
  docs do not cover into its playbook, and score it against your own eval
  questions on every pull request.

The more you train it, the more questions it closes without you, and the
faster your customers get a good answer.

<img src="docs/screenshots/widget-chat.png" alt="The HelpWell widget answering a question on a customer's page, citing the article it used" width="100%">

### Who it's for

- **Teams going AI-first on support.** The agent is the first line, not an
  add-on to an inbox. Every answer carries a confidence score and the passages
  it used, so you can see why it said what it said, and fix the docs instead
  of the answer.
- **Companies with more than one product.** Each product gets its own agent,
  knowledge base, help center and widget, trained on its own code and docs, so
  answers never mix products up. Install it in each product's repo, or
  [run every product's install side by side](#running-many-installs-in-one-process)
  in one process.
- **Vibe coders shipping their own products.** You built it with a coding
  agent, and now people need help using it. Hand the install to that agent
  with [one prompt](#set-it-up-with-an-ai-assistant), let HelpWell write the
  docs from the code, and connect the [MCP server](packages/mcp/README.md) so
  your coding agent can read the gaps and write the missing articles itself.

### Self-hosted, and yours

Most support tools are a product you log into. Open-source HelpWell is a package you
install. Your articles are files in `docs/`, your agent's instructions are a
Markdown file you review in pull requests, and everything it ever says is
stored in your own database. There is no HelpWell account, no per-seat price,
and nothing leaves your infrastructure except the model call you pay for on
your own OpenRouter key.

HelpWell has no inbox and sends no email. If you want people answering too, a
[support extension](#support-extensions) plugs human support in: an object you
write, or a service HelpWell connects to over HTTPS.
[HelpWell Cloud](#helpwell-cloud) is one, with a team inbox, live chat and
email marketing built in.

---

## Quick start

You need Node 22 or newer. A Postgres server is optional to start: with
`HELPWELL_DATABASE_URL` unset, HelpWell keeps its data in an embedded Postgres
under `helpwell/data`, so the first run works on a laptop with nothing else
installed.

```bash
npm install helpwell @helpwell/core @helpwell/helpcenter @helpwell/dashboard @helpwell/widget
npx helpwell init --framework next    # or remix, hono, node
```

For a Postgres server, also `npm install postgres` and set
`HELPWELL_DATABASE_URL`. HelpWell never reads `DATABASE_URL`.

`init` writes seven files, adds `helpwell/data/` and `helpwell/.auth/` to your
`.gitignore`, prints the code that mounts HelpWell in your framework, and
stops. No database and no account. The one network call is a read-only
question to GitHub, when your repo's `origin` is there, about whether it
publishes releases, so it knows where changelog drafts should come from. You
can read the diff before anything talks to a model.

```
helpwell/
  helpwell.config.json   every setting, version controlled
  instructions.md        the agent's system prompt
  playbook.md            tone, and the cases your docs do not cover
  evals.json             twelve starter questions to score the agent against
docs/
  README.md              how articles work
  getting-started/welcome.md
.env.example
```

### Set it up with an AI assistant

Would you rather hand the install to ChatGPT, Claude or your coding agent?
This prompt does all of it: it detects the framework, installs the packages,
mounts the three handlers, adds the environment variables (you paste the
values yourself), adds the widget, builds the first index and checks the
result. Run inside your app, `npx helpwell prompt install` prints it filled in
with the framework and package manager it found. `npx helpwell prompt` lists
a prompt for every other setup step. None of them carries a secret.

<details>
<summary>The install prompt</summary>

<!-- generated:prompt:install (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up HelpWell, the self-hosted help desk, in my product's existing app. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

HelpWell runs inside the app: its API at /api/helpwell, the help center at /help and the dashboard at /admin/helpwell behind the app's own admin check. The widget loads on every page, the articles in docs/ are indexed, and `npx helpwell doctor` reports no failures.

## What you need to know

- HelpWell is a set of npm packages, not a service: no account, no separate server. Each part is a function that takes a web Request and returns a Response, mounted in the app like any route. It needs Node 22 or newer.
- I have not said what the app is built with: work it out from package.json.
- The package manager is npm unless the lockfile says otherwise.
- `npx helpwell init` writes helpwell/helpwell.config.json (every setting), helpwell/instructions.md (the agent's system prompt), helpwell/playbook.md, helpwell/evals.json (twelve starter eval cases), docs/README.md, a first article at docs/getting-started/welcome.md and .env.example, and adds helpwell/data/ (the local database) and helpwell/.auth/ to .gitignore. It touches nothing else and uses no network or database, apart from one read-only question to GitHub about releases when the repo's origin is there.
- The database: with HELPWELL_DATABASE_URL unset, HelpWell keeps its data in an embedded Postgres under helpwell/data, which is right for development. In production, set HELPWELL_DATABASE_URL to a Postgres database (the app's own is fine: HelpWell keeps to its own `helpwell` schema) and install the `postgres` package. HelpWell never reads DATABASE_URL.
- The AI is bring-your-own-key through OpenRouter, read from OPENROUTER_API_KEY. Without it the agent answers with the closest article and search still works.
- Signed-in people are recognised by a token the app's server signs with HELPWELL_IDENTITY_SECRET; that is a separate step once this works.
- The dashboard and the admin API have no login of their own: both take isAdmin(request), which should rest on the app's existing session. The isAdmin in the code `init` prints fails closed: until it is replaced, the only admin is someone holding HELPWELL_ADMIN_TOKEN (at least 32 characters), entered in the form the dashboard shows when it answers 401 or sent as a bearer token, and while that is unset nobody gets in. The token keeps working after isAdmin is replaced, because both handlers are given it as adminToken.

## Steps

1. Read package.json and the lockfile. Tell me the framework, the package manager, and whether HelpWell is already installed (a helpwell/ folder). If the app is not a Node app (Rails, Django, PHP), stop and ask me: HelpWell would then run as a small Node service beside it.
2. Install the packages with the command below, using the package manager the lockfile belongs to.
3. Run `npx helpwell init --framework <next | remix | hono | node>` from the repo root. It prints the mount code for that framework; keep that output.
4. Create the shared module (lib/helpwell.ts, or app/lib/helpwell.server.ts on Remix) from the code below. It already passes the agent's instructions and playbook, so edits to those files reach the agent. Then replace isAdmin with the app's real admin check, where its TODO says; the API and the dashboard both use it.
5. Create the other files below: the API under /api/helpwell, answering every method (OPTIONS too, for the preflight of a widget on another site), the help center under /help and the dashboard under /admin/helpwell. These are the files for Next.js; one marked "merged into what is there" is lines to add to a file the app already has.
6. Add OPENROUTER_API_KEY= and HELPWELL_IDENTITY_SECRET= to the env file the app loads (for example .env.local or .env), with no values, and make sure that file is in .gitignore. Then tell me to paste the values in myself: the key from https://openrouter.ai/keys, and a secret I generate with `openssl rand -hex 32`.
7. Add the widget script tag below to the root layout, just before the closing </body>, once.
8. Put the first articles in docs/: `npx helpwell import <source>` if I have a help center elsewhere (ask me), `npx helpwell docs generate` to draft them from the code once the key is set, or leave the welcome article for now.
9. Run `npx helpwell sync` to build the first search index.
10. Run `npx helpwell doctor`, start the app, and do the checks below.

## Exact values

### Environment variables

| name | needed | value |
| --- | --- | --- |
| OPENROUTER_API_KEY | for written answers; without it, search-only answers | <I paste it myself> |
| HELPWELL_IDENTITY_SECRET | to recognise signed-in people | <I paste it myself> |
| HELPWELL_DATABASE_URL | production; unset means the embedded database under helpwell/data | <I paste it myself> |
| HELPWELL_ADMIN_TOKEN | optional: the dashboard sign-in until isAdmin is replaced, and scripts and CI; at least 32 characters | <I paste it myself> |

The same values as JSON:

```json
[
  {
    "name": "OPENROUTER_API_KEY",
    "needed": "for written answers; without it, search-only answers",
    "value": "<I paste it myself>"
  },
  {
    "name": "HELPWELL_IDENTITY_SECRET",
    "needed": "to recognise signed-in people",
    "value": "<I paste it myself>"
  },
  {
    "name": "HELPWELL_DATABASE_URL",
    "needed": "production; unset means the embedded database under helpwell/data",
    "value": "<I paste it myself>"
  },
  {
    "name": "HELPWELL_ADMIN_TOKEN",
    "needed": "optional: the dashboard sign-in until isAdmin is replaced, and scripts and CI; at least 32 characters",
    "value": "<I paste it myself>"
  }
]
```

### Where each part is mounted

| path | what |
| --- | --- |
| /api/helpwell | the API, which also serves the widget script |
| /help | the public help center |
| /admin/helpwell | the dashboard, behind isAdmin |

The same values as JSON:

```json
[
  {
    "path": "/api/helpwell",
    "what": "the API, which also serves the widget script"
  },
  {
    "path": "/help",
    "what": "the public help center"
  },
  {
    "path": "/admin/helpwell",
    "what": "the dashboard, behind isAdmin"
  }
]
```

## Use exactly as written

Install:

```bash
npm install helpwell @helpwell/core @helpwell/helpcenter @helpwell/dashboard @helpwell/widget
```

Every file, as `init --framework next` prints it, the shared module first:

```ts
// lib/helpwell.ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHelpWellHandler } from '@helpwell/core';
import { ADMIN_COOKIE, readCookie } from '@helpwell/core/api';
import { createDb, migrate } from '@helpwell/core/db';
import { createDashboard } from '@helpwell/dashboard';
import { createHelpCenter } from '@helpwell/helpcenter';
import { widgetAssets } from '@helpwell/widget/server';

/** A file `helpwell init` wrote, or '' when it is not there. */
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
 * HELPWELL_ADMIN_TOKEN, as `Authorization: Bearer <token>` or in the
 * hw_admin cookie the dashboard sets once someone enters the token there,
 * and while that variable is unset or under 32 characters, nobody is. A
 * cookie only counts when it holds the token itself, so nobody can make one
 * up. The token keeps working after you replace this, because the API and
 * the dashboard are both given it as adminToken; leave it unset to turn it off.
 */
function isAdmin(request: Request): boolean {
  const token = adminToken();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
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
      // The agent's system prompt and playbook, from the files `init` wrote.
      instructions: read('helpwell/instructions.md'),
      playbook: read('helpwell/playbook.md'),
      // Serves the screenshots and images your articles reference.
      media: { docs: 'docs', screenshots: 'docs/_screenshots' },
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
        const file = join(process.cwd(), 'docs', path);
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
export const dashboard = async (request: Request) => (await getHelpWell()).dashboard(request);

// app/api/helpwell/[[...route]]/route.ts
import { api } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = api;
export const POST = api;
export const PATCH = api;
export const DELETE = api;
// The preflight of a widget on another site (corsOrigins).
export const OPTIONS = api;

// app/help/[[...slug]]/route.ts
import { help } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = help;

// app/admin/helpwell/[[...route]]/route.ts
import { dashboard } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = dashboard;
export const POST = dashboard;

// next.config.ts, merged into what is there
// In the config object: HelpWell loads its database driver at runtime,
// which a bundler cannot follow, so it stays out of the server bundle.
serverExternalPackages: ['@helpwell/core', '@helpwell/helpcenter', '@helpwell/dashboard', '@helpwell/widget'],
```

The widget, in the root layout:

```html
<script src="/api/helpwell/assets/loader.js" defer></script>
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never write a key, a secret or a database URL into source code, a committed file or this chat.
- Never point HELPWELL_DATABASE_URL at a database without asking me first.
- Never write an isAdmin that a request can pass on its own, with a cookie, header or query value anyone can set: it must rest on the app's existing session. If you cannot find the app's admin check, leave the fail-closed one in place and tell me.
- Do not commit helpwell/data/: it is the local database.

## Check your work

1. `npx helpwell doctor` shows no ✗ lines. It ends with "Everything checks out." or, until the key is set, "Working, with N things worth a look."
2. With the app running, `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/helpwell/config` prints 200 (use the app's own port).
3. Any page of the app shows the HelpWell launcher within a few seconds, and /help shows the welcome article.
4. /admin/helpwell opens the dashboard for an admin, and answers 401 when signed out. With HELPWELL_ADMIN_TOKEN set, that 401 page asks for the token, and entering it opens the dashboard.
5. The app's production build (`npm run build` or its equivalent) succeeds. HelpWell opens its database on the first request, never while building, so the build needs no database.
6. `curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: role=admin; admin=true" http://localhost:3000/admin/helpwell` prints 401: a cookie anyone can set never makes an admin.

## When you are done

Tell me the framework, every file you created or changed, which values I still need to paste into the env file, and what doctor and the checks showed.
````
<!-- /generated:prompt:install -->

</details>

### Mount it

HelpWell is three request handlers. Each takes a `Request` and returns a
`Response`, so it works the same in Next.js, Remix, Hono, Express or a plain
Node server. `helpwell init --framework <next | remix | hono | node>` prints
the files for your framework. On Next.js they are these: a shared module, and
a catch-all route for each handler.

<!-- generated:mount:next (do not edit: `pnpm readme` rewrites it from the code) -->
```ts
// lib/helpwell.ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHelpWellHandler } from '@helpwell/core';
import { ADMIN_COOKIE, readCookie } from '@helpwell/core/api';
import { createDb, migrate } from '@helpwell/core/db';
import { createDashboard } from '@helpwell/dashboard';
import { createHelpCenter } from '@helpwell/helpcenter';
import { widgetAssets } from '@helpwell/widget/server';

/** A file `helpwell init` wrote, or '' when it is not there. */
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
 * HELPWELL_ADMIN_TOKEN, as `Authorization: Bearer <token>` or in the
 * hw_admin cookie the dashboard sets once someone enters the token there,
 * and while that variable is unset or under 32 characters, nobody is. A
 * cookie only counts when it holds the token itself, so nobody can make one
 * up. The token keeps working after you replace this, because the API and
 * the dashboard are both given it as adminToken; leave it unset to turn it off.
 */
function isAdmin(request: Request): boolean {
  const token = adminToken();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
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
      // The agent's system prompt and playbook, from the files `init` wrote.
      instructions: read('helpwell/instructions.md'),
      playbook: read('helpwell/playbook.md'),
      // Serves the screenshots and images your articles reference.
      media: { docs: 'docs', screenshots: 'docs/_screenshots' },
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
        const file = join(process.cwd(), 'docs', path);
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
export const dashboard = async (request: Request) => (await getHelpWell()).dashboard(request);

// app/api/helpwell/[[...route]]/route.ts
import { api } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = api;
export const POST = api;
export const PATCH = api;
export const DELETE = api;
// The preflight of a widget on another site (corsOrigins).
export const OPTIONS = api;

// app/help/[[...slug]]/route.ts
import { help } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = help;

// app/admin/helpwell/[[...route]]/route.ts
import { dashboard } from '@/lib/helpwell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = dashboard;
export const POST = dashboard;

// next.config.ts, merged into what is there
// In the config object: HelpWell loads its database driver at runtime,
// which a bundler cannot follow, so it stays out of the server bundle.
serverExternalPackages: ['@helpwell/core', '@helpwell/helpcenter', '@helpwell/dashboard', '@helpwell/widget'],
```
<!-- /generated:mount:next -->

**Replace `isAdmin` before you deploy.** It decides who may open the
dashboard and call the admin API, and HelpWell has no login of its own, so it
should ask your app's session, as its TODO shows. The one `init` prints fails
closed: the only admin is whoever holds `HELPWELL_ADMIN_TOKEN` (at least 32
characters), and while it is unset, nobody is. In a browser, the dashboard's
401 page asks for the token and keeps it in an HttpOnly, `SameSite=Lax`
cookie, with a sign-out in the rail; a script sends it as
`Authorization: Bearer`. That is a shared secret, not an account, and it keeps
working once `isAdmin` is your own check, because both handlers are given it as
`adminToken`; leave the variable unset to turn it off. Never let `isAdmin`
trust a cookie or header by itself: anyone can set those.

The database opens on the first request, in `getHelpWell()`, so `next build`
(which imports every route) never connects to it or runs a migration.

`media` names the folders article images are served from (`false` serves
none), `corsOrigins` the other sites allowed to call the API, and
`writeArticle` is optional: without it, the editor offers the file to download
and names the path it belongs at. On Remix the routes are
`app/routes/api.helpwell.$.tsx`, `help.$.tsx` and `admin.helpwell.$.tsx`; on
Hono, `app.all` and `app.on`. `--framework node` adds `lib/helpwell-node.ts`,
with `helpwellNode(req, res, next)` for Express or `node:http`, and
`helpwellFetch(request)` for anything that hands you a web `Request`, such as
SvelteKit's `handle` hook or `Bun.serve`.

On a serverless host, include the docs folder in the deployed files (on
Vercel, `outputFileTracingIncludes`) so the screenshots are there to serve,
and `helpwell/redirects.json` too if you imported a help center.

> **On Next.js**, the `next.config.ts` line above keeps HelpWell out of the
> server bundle. It loads your database driver by name at runtime, which a
> bundler cannot follow. In a pnpm workspace that setting is not enough on its
> own, because the packages resolve outside `node_modules`.
> `examples/playground/next.config.ts` shows the webpack rule that covers it.

### Add the widget

One script tag, before the closing `</body>`. It is under 1 KB gzipped and
waits for the page to finish loading before it fetches anything, so support is
never on your critical path.

```html
<script src="/api/helpwell/assets/loader.js" defer></script>
```

The loader works out where the API is from its own URL, host included, so a
site on another domain uses the same tag with the full address. `data-api` is
only needed when the API lives somewhere other than where the script is served
from. Upgrading the widget is `npm update`; nothing is copied into your app.

A widget on a different site from the API only works once that site is listed
in `corsOrigins` on `createHelpWellHandler`: without it the browser refuses
every call. See [A widget on another site](#a-widget-on-another-site).

<details>
<summary>Set this up with an AI assistant: installing the widget</summary>

The dashboard's Get set up page has this prompt for plain HTML, Next.js (app
router), React (Vite), Vue, SvelteKit, Rails and Django, filled in with your
API's real path, and `npx helpwell prompt widget` prints it for the framework
your app uses. It holds no secrets.

<!-- generated:prompt:widget (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up the HelpWell support widget on my product's Plain HTML site. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

The HelpWell launcher appears on every page of the site, loaded by one script tag, and signed-in people are recognised through a signed identify token.

## What you need to know

- The site is built with Plain HTML.
- The HelpWell API is mounted at /api/helpwell. The widget loader is served from it at /api/helpwell/assets/loader.js.
- The loader is about 0.7 KB gzipped and waits for the page to finish loading before it fetches the widget, so it never slows the page down. It works out where the API is from its own URL, host included, so the same tag works on a site on another origin. A data-api attribute is only needed when the API lives somewhere other than where the loader is served from.
- Where it goes: In every page, just before the closing </body> tag. If the site has a shared footer or layout include, put it there once.
- Identity: When someone is signed in, have the server render their signed token into the tag as data-token="…", or call helpwell("identify", token) from a script after the loader tag.
- Identify tokens are signed on the server with the secret in HELPWELL_IDENTITY_SECRET. The browser only ever sees the signed token.
- When the site is on another origin than the HelpWell API, the API has to list the site in corsOrigins (createHelpWellHandler({ corsOrigins: ["https://www.example.com"] })), or the browser refuses every call. Browsers such as Safari block the API's cookie across sites, so the widget then keeps the visitor in an X-HelpWell-Visitor header instead; nothing else changes. Images in articles and answers come from the API as absolute URLs built from the address each request arrives at; behind a proxy that changes that address, set publicUrl (createHelpWellHandler({ publicUrl: "https://app.example.com/api/helpwell" })).
- Nothing else is needed: no npm package in the front end, and no file to copy into the app.

## Steps

1. Find the shared layout, footer include or template every page uses. If pages are separate files, add the tag to each one.
2. Paste the script tag just before </body>.
3. If the site sends a Content-Security-Policy header (look in the server config, middleware, next.config or a <meta http-equiv> tag), add the sources in the Content-Security-Policy table below to each directive, keeping what is already there. If it sends none, change nothing.
4. Start the site (or deploy it) and open any page.

## Exact values

### Values

| name | value |
| --- | --- |
| Loader URL (same origin) | /api/helpwell/assets/loader.js |
| Loader URL (another origin) | https://<the host that runs HelpWell>/api/helpwell/assets/loader.js |
| Identity secret variable | HELPWELL_IDENTITY_SECRET |

The same values as JSON:

```json
[
  {
    "name": "Loader URL (same origin)",
    "value": "/api/helpwell/assets/loader.js"
  },
  {
    "name": "Loader URL (another origin)",
    "value": "https://<the host that runs HelpWell>/api/helpwell/assets/loader.js"
  },
  {
    "name": "Identity secret variable",
    "value": "HELPWELL_IDENTITY_SECRET"
  }
]
```

### Content-Security-Policy additions

| directive | add |
| --- | --- |
| script-src | 'self' |
| connect-src | 'self' |
| style-src | 'unsafe-inline' |
| img-src | 'self' https: |
| media-src | 'self' https: |
| font-src | 'self' |

The same values as JSON:

```json
[
  {
    "directive": "script-src",
    "add": "'self'"
  },
  {
    "directive": "connect-src",
    "add": "'self'"
  },
  {
    "directive": "style-src",
    "add": "'unsafe-inline'"
  },
  {
    "directive": "img-src",
    "add": "'self' https:"
  },
  {
    "directive": "media-src",
    "add": "'self' https:"
  },
  {
    "directive": "font-src",
    "add": "'self'"
  }
]
```

## Use exactly as written

The tag:

```html
<script src="/api/helpwell/assets/loader.js" defer></script>
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never put the value of HELPWELL_IDENTITY_SECRET in front-end code, in the page, or in this chat. Only the server that signs tokens reads it.
- Add the tag once. Two loader tags load the widget twice.

## Check your work

1. Open the site. The HelpWell launcher appears in the bottom corner within a few seconds of the page loading.
2. The browser's network panel shows /api/helpwell/assets/loader.js and then a request to /api/helpwell/config, both answering 200.
3. "Install the widget" in the Get set up checklist on the HelpWell dashboard turns green, and names the page it saw.

## When you are done

Tell me which file you changed, where the tag went, whether signed-in people get a token, and what the verification showed.
````
<!-- /generated:prompt:widget -->

</details>

### Index your docs

```bash
export OPENROUTER_API_KEY=sk-or-...
npx helpwell sync
npx helpwell doctor
```

That is the whole install. `doctor` tells you what is wrong if anything is,
with the fix for each.

```
HelpWell doctor

  ✓ Project         /Users/you/acme
  ✓ Docs folder     12 articles in 4 collections
  ✓ Instructions    27 lines
  ✓ OpenRouter key  set, sk-or-v…
  ✓ Database        connected to postgres://acme:***@db.internal:5432/acme
  ✓ Settings        Acme, answering with anthropic/claude-sonnet-5
  ✓ Embeddings      openai/text-embedding-3-small, 12 of 12 articles embedded
  ✓ Search          full-text search returned 8 results

✓ Everything checks out.
```

---

## What you get

<img src="docs/media/tour.gif" alt="A tour of open-source HelpWell: helpwell init writing its files, the widget answering from the docs, the help center, the gaps the agent could not answer, a reviewed conversation and an article's history" width="100%">

### The widget

A support surface that mounts into a Shadow DOM, so nothing on your page can
restyle it and nothing it does can leak out. Five tabs, all optional.

| | |
|:--|:--|
| <img src="docs/screenshots/widget-home.png" alt="The widget's home tab, with search and a link into the open conversation" width="100%"> | **Home**<br><br>Search first, because most questions have already been answered. Then whatever conversation is still open, then a way to start a new one, then what changed recently. |
| <img src="docs/screenshots/widget-chat.png" alt="A chat thread with an answer and the article it cites" width="100%"> | **Chat**<br><br>Every answer cites the articles it came from, and every citation opens in place. Thumbs up or down on any answer, and the agent says plainly when it does not know. |
| <img src="docs/screenshots/widget-help.png" alt="The widget's help tab, browsing collections" width="100%"> | **Help**<br><br>The whole help center, without leaving the page. Search as you type, browse by collection, read an article in the panel. |
| <img src="docs/screenshots/widget-article.png" alt="An article open inside the widget, with its collection and reading time" width="100%"> | **An article, in place**<br><br>Read the whole thing without losing the page you were on. Related articles at the bottom, and a way back to the assistant if it did not cover your case. |
| <img src="docs/screenshots/widget-updates.png" alt="The widget's updates tab, showing the changelog with an unread marker" width="100%"> | **Updates**<br><br>Your changelog, with an unread dot on the launcher. Pages in as you scroll, so three years of releases is not a megabyte of HTML. |
| <img src="docs/screenshots/widget-roadmap.png" alt="The widget's roadmap tab, with four lanes and vote buttons" width="100%"> | **Roadmap**<br><br>Four lanes, one vote per person, and a way to suggest something. Votes land instantly and reconcile with the server. |

<img src="docs/screenshots/widget-mobile.png" alt="The widget on a phone, taking the whole screen" width="380" align="right">

**On a phone** the panel is the screen rather than a card floating on it, with
the composer above the keyboard and the tab bar clear of the home indicator.

Everything is themeable from the dashboard: accent colour, font, corner radius,
bubble shape, header pattern, and which corner it sits in. Dark mode follows
the reader unless you force it.

The launcher is the HelpWell mark, in your accent colour, or your own image if
you would rather.

Also in the widget:

- **Home is made of blocks** (`widget.home.blocks`): search, the open
  conversation, a new-conversation button, a list of articles, recent updates,
  a status row, a list of links, a card with an image and a button, and a
  [form](docs/forms.md).
- **Your own greeting** (`widget.greeting`): the title and subtitle at the top
  of Home. Left empty, they say "Hi there" and "How can we help with your
  product?".
- **Preview states** (`helpwell.widget.preview`): the widget with a message over
  the launcher, an unread badge, an answer with its source, the email card, a
  banner or a pop-up, from made-up local data, so a settings screen can show
  them. Nothing is sent or stored.
- **A status row** read from your Atlassian Statuspage, Instatus or Better
  Stack page, or a message you set by hand.
- **An email ask, only for people your app has not identified**: a pre-chat
  form (`widget.preChat`), or an inline card after an answer the docs did not
  cover. With a support email in Settings, the widget offers it under an
  unanswered question and on Home.
- **Where it shows**: include and exclude page patterns, signed-in or
  anonymous visitors, and devices, checked again on every route change.
- **A bot check** with Cloudflare Turnstile on your own keys, when you turn it
  on (`agent.abuse.botCheck`).
- **Human support, when a [support extension](#support-extensions) is
  connected**: "Talk to a person", replies from the team, typing, read
  receipts and attachments. Without one, none of that appears.

From your own code, `helpwell('open')`, `close`, `toggle`, `identify`,
`track`, `reset` and `destroy` are the whole API, plus
`helpwell.engage.show(id)` and `helpwell.engage.hide()` for
[engagements](docs/engage.md), and `helpwell.forms.show(id)` and
`helpwell.forms.on('submit', callback)` for [forms](docs/forms.md).

<br clear="all">

### The help center

Server-rendered, so a page is already in the response body rather than
assembled after three round trips. Indexable, linkable, and readable with
JavaScript switched off.

<img src="docs/screenshots/helpcenter-home.png" alt="The public help center home page, with search and collection cards" width="100%">

Each card is a folder in `docs/`. Drop a `_meta.json` beside the Markdown to
give it a name, a sentence, an icon and a colour, and to say where it sits in
the order. A folder without one still appears, titled from its own name.

A folder is a collection when it has a `_meta.json` or at least one article,
so a `_meta.json` alone sets one up before anything is written for it, and a
folder that only holds images (`docs/images`, say) is not one. If you upgraded
from a version that counted every folder, the next `helpwell sync` takes those
image folders out of the index and says so. Only the index changes: sync never
deletes, moves or edits a file.

```jsonc
// docs/getting-started/_meta.json
{ "title": "Getting started", "description": "Your first expense, and your first week.",
  "icon": "rocket", "tint": "lavender", "order": 1 }
```

<table>
<tr>
<td width="50%"><img src="docs/screenshots/helpcenter-article.png" alt="A help center article with a table of contents and a helpful/not helpful vote" width="100%"></td>
<td width="50%"><img src="docs/screenshots/helpcenter-search.png" alt="Help center search results with the matched terms highlighted" width="100%"></td>
</tr>
<tr>
<td><b>Articles</b> get a table of contents from their headings, anchors on
every section, related reading, and a helpful/not-helpful vote. An
"Edit this page" link points straight at the file in your repo.</td>
<td><b>Search</b> is a real page with its own URL, so a result can be shared and
indexed. Postgres full-text search, with the matched terms marked.</td>
</tr>
<tr>
<td><img src="docs/screenshots/helpcenter-changelog.png" alt="The public changelog page" width="100%"></td>
<td><img src="docs/screenshots/helpcenter-roadmap.png" alt="The public roadmap page with four lanes" width="100%"></td>
</tr>
<tr>
<td><b>Changelog</b> with an RSS feed, paged by link rather than infinite
scroll so every page is a URL.</td>
<td><b>Roadmap</b>, the same board the widget shows, for people who would
rather send someone a link.</td>
</tr>
</table>

It also serves `sitemap.xml` and `llms.txt`, so both search engines and AI
assistants are pointed at your real documentation rather than guessing. Set a
**public address** in Settings (Help center, `helpCenter.domain`, such as
`help.acme.com`) and every canonical link, the sitemap, the feed and llms.txt
name that address, whatever host a request arrived on; `publicUrl` on
`createHelpCenter` does the same in code and wins over the setting.

**The theme** is in the same place: the accent and page ground, the hero (a
glow of your accent, flat, or a solid brand block), collection cards on a
tinted under card that carries the article count and when the collection last
changed (or plain cards), which tints the cards may use, the scheme readers
start in (they can always switch, and their choice is remembered), your logo
and favicon. When the widget is on the help center, the home page and every
article offer "Ask" with the agent's own name and avatar. The type is Plus
Jakarta Sans with Bricolage Grotesque headings, served by the help center
itself from `<basePath>/_fonts/`: no request goes to Google Fonts or any other
third party.

#### Writing articles

Articles are plain Markdown, plus a handful of blocks the help center, the
widget and the dashboard preview all render, and that `docs generate` and
`docs update` know how to write:

````md
> [!TIP]
> Callouts use GitHub's alert syntax: NOTE, TIP, IMPORTANT, WARNING or CAUTION.

:::steps
### Open Billing
Each heading is a numbered step, with everything under it.

![The billing page](../_screenshots/billing.png)
### Export
Click **Export**.
:::

:::tabs
== macOS
Press Cmd+K.
== Windows
Press Ctrl+K.
:::

:::details How are refunds worked out?
A collapsible section.
:::

![A two-minute tour](https://www.youtube.com/watch?v=VIDEO_ID)
````

A video is an image line pointing at YouTube (played from
youtube-nocookie.com), Vimeo, Loom, Wistia or an `.mp4`/`.webm` file. The help
center embeds it, and its Content-Security-Policy allows exactly those
players as frames (`contentSecurityPolicy` on `createHelpCenter` replaces the
policy, or `false` sends none). The widget shows YouTube, Vimeo, Loom and Wistia as a
link that opens the player, since it lives on your app's pages; files still
play inline. Tabs in the widget are collapsible sections.

Screenshots are referenced by their path from the article, as above.
`helpwell sync` rewrites that path to where the API serves the file,
`/api/helpwell/screenshots/billing.png`, so the same image loads in the help
center and the widget; an image beside an article (`./step-1.png`) is served
from `/api/helpwell/media/`. The help center also serves both itself, at
`/help/_screenshots/` and `/help/_media/`, so it works on its own domain. Set
`"apiPath"` in `helpwell.config.json` if your API is mounted elsewhere. The
`docs/README.md` that `helpwell init` writes has the full reference.

### The dashboard

Mounted in your own app, behind your own auth. HelpWell has no accounts of its
own: your app's `isAdmin` decides who gets in, and the one other way is the
admin token, which the locked-out page asks for when you have set one.

#### Get set up

The first page you see is a checklist that checks itself against your install:
the model key is set, the docs folder has articles, they are indexed, the widget
has loaded on a real page, someone signed in was identified, and the agent has
answered a question. Webhooks and the MCP server are optional steps. Every step
comes with the human instructions and a prompt to hand to ChatGPT, Claude or a
coding agent, filled in with your API's real path and holding no secrets; the
widget step has one for plain HTML, Next.js, React (Vite), Vue, SvelteKit,
Rails and Django. Once every required step is done you can put the checklist
away, and the dashboard opens on Conversations instead.

#### Conversations

Not an inbox. Nobody is assigned anything and nothing is waiting on a reply.
It exists so a person can read what the agent said, correct a topic, tag a
pattern, and mark that they have looked.

<img src="docs/screenshots/dashboard-conversations.png" alt="The conversations list, showing who asked what and whether it was resolved" width="100%">

<img src="docs/screenshots/dashboard-conversation.png" alt="One conversation thread, with citations, model, latency and a review panel" width="100%">

Every message shows which articles it cited, which model answered, how long it
took, and what the customer thought of it. Every answer also carries a
confidence score from 0 to 1 and the reason for it, in a sentence: how well
search matched, whether the answer cited what it used, and whether the model
said it answered fully. It is there to read, not to configure. Open it and you
see every passage the answer was given, how search found each one (by words, by
meaning, or both), its similarity to the question, and whether the answer used
it, next to what that one reply cost and how many tokens it took.

#### Contacts

Two things and no more: what your app told us in an identify call, and what the
person did in the help center. HelpWell never enriches, scores or infers, and
there is deliberately no revenue column — that is your product's business, not
your help desk's.

<img src="docs/screenshots/dashboard-contacts.png" alt="The contacts list, showing who is identified, their plan and when they were last seen" width="100%">

<img src="docs/screenshots/dashboard-contact.png" alt="A contact, showing identify attributes, their conversations and their help center activity" width="100%">

Export everything HelpWell holds about someone as JSON, or erase them entirely,
from this page.

Every contact carries two labels: its **source** (how it first reached
HelpWell: the widget, an identify call, an import, a form or the API) and its
**consent** (not given, given or declined, with where that came from and when).
Both show on the contact, filter the list, and go out in every export,
including the CSV of the whole list.

The CSV also counts what each person gave you through forms:
`forms_submitted` and `last_form_submitted_at` (accepted submissions only),
`giveaways_entered`, and `giveaway_entries` (their total entries, bonuses
included). The per-person JSON export holds the rows themselves, under
`formSubmissions` and `giveawayEntries`.

**Segments** are saved filters, shown down the side of the list with their
member counts. Build one from the conditions above the list — "plan is pro and
signed up more than 30 days ago", "exported a CSV at least 3 times in the last
7 days", "has the tag beta" — then save it. Membership is worked out when asked,
never stored, so a segment is never stale; engage messages and surveys can
target one. The same rules are JSON anywhere you need them:

```jsonc
{ "all": [
  { "field": "plan", "op": "is", "value": "pro" },
  { "field": "signed_up", "op": "more_than_days_ago", "value": 30 },
  { "any": [
    { "field": "tags", "op": "includes_any", "value": ["beta"] },
    { "event": "exported_csv", "op": "at_least", "count": 3, "withinDays": 7 }
  ] }
] }
```

| Field type | Operators |
|---|---|
| Text, link | `is`, `is_not`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
| Number, money | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between` (`[low, high]`), `is_empty` |
| Date | `before`, `after`, `on`, `within_last_days`, `within_next_days`, `more_than_days_ago`, `is_empty` |
| Yes/no | `is_true`, `is_false` |
| List | `includes_any`, `includes_all`, `excludes`, `is_empty` |
| Event | `happened`, `not_happened`, `at_least` (`count`), each with an optional `withinDays` |

`field` is an attribute name or one of HelpWell's own: `email`, `name`,
`signed_up`, `last_seen`, `identified`, `tags`, `source` and `consent`. Text
comparisons ignore case, and a negative operator (`is_not`, `excludes`,
`not_happened`…) matches someone with no value at all.

Each attribute your app sends becomes a typed **field** — text, number,
yes/no, date, list, link or money — the first time it arrives, and keeps that
type. Change a type under Contacts, Fields and it is locked there, so a later
value of a different shape cannot quietly change what a segment means.

#### Knowledge base and gaps

<table>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard-knowledge.png" alt="The knowledge base, grouped by collection, showing index and embedding status" width="100%"></td>
<td width="50%"><img src="docs/screenshots/dashboard-gaps.png" alt="The gap list: questions the docs do not answer, ranked by how often they are asked" width="100%"></td>
</tr>
<tr>
<td>Your repo is the source of truth. This screen shows what is indexed right
now and whether each article has embeddings, and it can edit an article or
start one, with a live preview through the help center's own renderer. Save
writes the file through your app's <code>writeArticle</code> hook and
re-indexes it, embedding it straight away when there is a model key, so search
has the new words at once (if the provider is down it is saved as text and the
next sync embeds it); without the hook, the editor hands you the file and the
path it belongs at. An article with no body can be saved as a draft but not
published, here or through the admin API, so a draft the model could not
write never goes live as an empty page. Every change the index sees is kept as a version, with a diff that
marks the words that changed.</td>
<td><b>Gaps</b> are the questions your docs could not answer, deduplicated and
ranked by how often they are asked. This is the list of what to write next, and
it writes itself. Each one comes with a working title, and <b>Draft an
article</b> has the writing model draft it from every way it was asked, leaving
<code>[TODO: …]</code> wherever a fact is needed that nobody has written down.
The draft opens in the editor beside the questions customers asked; nothing is
written until you save it, and saving marks the gap drafted.</td>
</tr>
</table>

**Images.** Paste an image into the editor, drop one on it, or pick one with
Add an image: it is uploaded, and a Markdown image goes where the cursor was.
PNG, JPEG, GIF and WebP up to 10 MB are taken, recognised by their bytes; SVG
is refused, because it can carry script. Each is kept under `_media/` beside
the docs (named by a hash, so the same image twice is one file) and served
like a screenshot, or through your own `assetStore` (below). Screenshots from
`helpwell capture` work exactly as before.

**Restore.** Pick any version in an article's history to see what changed,
and Restore this version saves its words again as the newest version, through
the same hook as a save. Nothing in the history is rewritten or lost, so a
restore can itself be undone. The admin API does the same:
`POST /admin/articles/<slug>/versions/<id>/restore`.

**Redirects and Import, with no repo.** An install whose content is managed
for it (`contentMode: 'managed'`, below) has two more screens under Knowledge
base. Redirects lists the old help center addresses the help center sends on
to their articles, adds and removes one, and takes a whole redirects file.
Import from another help center runs `helpwell import` from the dashboard:
see [Moving from another help desk](#moving-from-another-help-desk).

##### Set this up with an AI assistant

To let the editor's Save button write into your repo, paste this into ChatGPT,
Claude or your coding agent (`npx helpwell prompt write-article` prints it):

<!-- generated:prompt:write-article (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up saving help articles from the HelpWell dashboard into our repo. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

Pressing Save in the dashboard's article editor writes the Markdown file into docs/, so an edit arrives as an ordinary change to review and commit.

## What you need to know

- HelpWell never writes files itself. The app passes createDashboard a writeArticle(path, markdown) hook, the same way it passes writeInstructions.
- path is relative to the docs folder, always <collection>/<file>.md, and HelpWell has already checked it cannot leave that folder. markdown is the whole file, front matter included.
- After a save, HelpWell re-indexes that article and records a version in its history.
- The same hook can be passed to createHelpWellHandler, so scripts can save through the admin API (POST /admin/articles).

## Steps

1. Find where the app calls createDashboard (often lib/helpwell.ts).
2. Add the writeArticle hook below to that call, keeping everything already passed.
3. In production the server's disk is usually not the repo. There, either write through the Git host's API instead, or leave the hook out and the editor offers the file to download.
4. If scripts should be able to save articles, pass the same function to createHelpWellHandler as writeArticle.

## Use exactly as written

The hook, for a server whose working directory is the repo:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DOCS = join(process.cwd(), 'docs');

export const dashboard = createDashboard({
  // ...everything already passed here stays...
  writeArticle: async (path, markdown) => {
    const file = join(DOCS, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, markdown, 'utf8');
  },
});
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Write only inside the docs folder, and do not add any other endpoint that writes files.
- Keep the dashboard behind the app's existing admin check (isAdmin).

## Check your work

1. Open the dashboard, go to Knowledge base, open an article, press Edit, change one word and save.
2. Run `git diff docs/` and check it shows exactly that change and nothing else.
3. Back on the article page, check the History card lists the new version.

## When you are done

Tell me what you changed, what you could not do, and anything I still need to do myself.
````
<!-- /generated:prompt:write-article -->

#### Reports

Six questions, in the order someone running support actually asks them.

<img src="docs/screenshots/dashboard-reports.png" alt="The reports screen: resolution rate, conversations over time, topics, searches, article performance and spend" width="100%">

Resolution rate, conversations over time, what people ask about, what they
searched for that found nothing, which articles are carrying the load, and what
it all cost — by day and by model, from your own key. Export CSV is served by
the dashboard itself, so it works wherever the dashboard does, embedded in
another app's shell included.

#### Changelog, roadmap and engage

<table>
<tr>
<td width="33%"><img src="docs/screenshots/dashboard-changelog.png" alt="The changelog admin list" width="100%"></td>
<td width="33%"><img src="docs/screenshots/dashboard-roadmap.png" alt="The roadmap board with four lanes" width="100%"></td>
<td width="33%"><img src="docs/screenshots/dashboard-engage.png" alt="The engage screen, showing a configured tour, banner and survey" width="100%"></td>
</tr>
<tr>
<td>Write entries by hand, or let <code>helpwell changelog</code> draft one
from what you shipped.</td>
<td>Move an idea between lanes. Moving it to Shipped is what announces it.</td>
<td>Modals (one slide or a carousel), banners, hotspots, multi-page tours and
branching surveys, with images, GIFs and video in any of them. Built in an
editor with a live preview, targeted by who, where and when, and saved in
settings so they can live in your repo.</td>
</tr>
</table>

Each engagement is aimed at people (identified or not, contact conditions, a
segment), places (pages, referrer, UTM, device, language) and a moment (page
load, a delay, scroll depth, exit intent, time on page, inactivity, a click, an
event your app tracks, or only when your code asks). A cap on how often anyone
is interrupted is enforced on the server. Results show impressions, clicks,
dismissals, completions and conversion, where people leave a tour, and every
survey answer, with a CSV. The whole format, and the prompt to hand to an AI
assistant for the one step that needs code, are in
[docs/engage.md](docs/engage.md).

#### Forms

Email capture: newsletter sign-ups, lead magnets, discount codes, giveaways,
waitlists and exit offers. A form sits in your page
(`<div data-helpwell-form="newsletter">`), opens from a button, pops up as a
modal, slide-in, bar or welcome mat on the same who, where and when rules as
engagements (and the same cap), or lives on the widget's Home tab. Each is
fully laid out and styled in a builder with a live preview, for desktop and
phone. You can A/B test variants, and each save is kept as a version you can
export as JSON.

Every submission needs a one-time signed token and is checked for bots:

- a hidden field;
- how fast it was filled in;
- rate limits;
- blocked and throwaway domains;
- a mail server on the domain.

Only trusted submissions count, reach the contact, and earn giveaway entries.
Giveaways add share links for bonus entries and a draw anyone can reproduce.
The builder hands you the embed code and a prompt for an AI assistant; the rest
is in [docs/forms.md](docs/forms.md).

#### Evals

An eval replays a set of real questions against your docs and scores the
answers, so a docs change is measurable rather than a feeling.

<img src="docs/screenshots/dashboard-evals.png" alt="An eval run, with failures listed first and the article each case expected" width="100%">

Failures are listed first, because those are the docs to fix. Run it in CI with
`--threshold 80` and a regression fails the build.

Run it from the dashboard too, with a progress bar as each case goes through.
Every case shows its verdict, each rule it was checked on with the grader's
notes, the answer itself and what it cited. Pick two runs to compare them case
by case: which got fixed, which regressed, and how each answer changed. The
dashboard runs the cases in `helpwell/evals.json` when your app passes it
`readEvalCases`, and otherwise repeats the cases the latest run used.

Each case in `helpwell/evals.json` is a question and the rules its answer is
held to. A case passes only when every rule it has passes; a weak result (the
agent cited an article, but not the one expected) counts half.

```jsonc
{
  "id": "no-invented-price",
  "question": "How much does the Pro plan cost per month?",
  "expect": null,                  // the slug to cite, or null: "the docs do not cover this"
  "expectUnresolved": true,        // it should say so and mark the conversation unresolved
  "must": [],                      // text the answer has to contain
  "mustNot": ["/[$€£]\\s?\\d/"],   // text it must never contain; "/regex/flags" or plain text
  "grade": "model",                // optional: the writing model scores it against the rubric
  "rubric": "Does not quote a price the docs do not state."
}
```

`helpwell init` writes twelve starter cases that hold for any product: answering
from the docs, never inventing a price or a date, marking what the docs do not
cover as unresolved, never repeating a pasted secret, and staying on topic.
Without an OpenRouter key a run measures retrieval only, says so, and leaves
out the cases only a model can judge.

#### Settings

Everything saves the moment you change it. There is no guardrails screen: the
agent's rules live in `instructions.md`, which is the system prompt, with
sensible defaults already written in. The **Playbook** page edits it and
`playbook.md` side by side with a preview, and saves through the
`writeInstructions` and `writePlaybook` hooks your app passes, so the files
stay in your repo.

Every setting in `helpwell.config.json` can be changed here, or is listed on
its tab as "Set in helpwell.config / environment" with the reason. Secrets
never appear: the dashboard shows whether each one is set and the environment
variable it is read from.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard-settings-agent.png" alt="Agent settings: instructions, models, tools and spend caps" width="100%"></td>
<td width="50%"><img src="docs/screenshots/dashboard-connections.png" alt="Connections: OpenRouter, embeddings, the repo and webhooks" width="100%"></td>
</tr>
<tr>
<td><b>The agent.</b> Its name and avatar, which models answer, which six
tools it may use, what it says when it cannot help, and a hard daily spend
cap. Models are picked from OpenRouter's live list, newest first, with each
one's price and context length, read with your own key and cached for ten
minutes; without a key it is a text box for the model id.</td>
<td><b>Connections.</b> OpenRouter, your repo, and your own webhooks, which
have a page of their own with every recent delivery. No app marketplace, no
OAuth dance, no third party holding your data.</td>
</tr>
</table>

<img src="docs/screenshots/dashboard-settings-widget.png" alt="Widget settings: accent colour, corner radius, position, tabs and the pages it appears on" width="100%">

**The widget.** Colour, shape, position, which tabs it shows and which pages it
appears on. Every change previews as you make it and saves without a button.

---

## The CLI

```
helpwell init           Install HelpWell into this repo
helpwell doctor         Check the install and say what is wrong
helpwell migrate        Create or update the database schema
helpwell sync           Index the docs in your repo
helpwell dev            Talk to your agent in the terminal
helpwell ask            Ask one question and print the answer
helpwell docs generate  Draft help articles from your repo
helpwell docs update    Rewrite articles the latest changes made wrong
helpwell changelog      Draft a changelog entry from what you shipped
helpwell capture        Retake the screenshots your docs use
helpwell eval           Replay real questions and score the answers
helpwell export         Write everything HelpWell holds to a JSON file
helpwell prune          Apply your retention rule and tidy up
helpwell settings pull  Copy the dashboard's settings into helpwell.config.json
helpwell settings push  Copy helpwell.config.json into the dashboard
helpwell import         Bring docs or contacts over from another tool
helpwell webhooks       See deliveries; `retry` and `test` them
helpwell prompt         Print any setup step as a prompt for an AI assistant
helpwell link           Connect a remote support extension; `unlink` forgets it
```

The MCP server is its own binary, `npx -y @helpwell/mcp` (`helpwell-mcp`):
`npx helpwell prompt mcp` sets it up in Claude Code, Claude Desktop or Cursor.
On [HelpWell Cloud](#helpwell-cloud) there is nothing to install: the hosted
MCP server adds the inbox, contacts, journeys and email, as
[its README explains](packages/mcp/README.md#using-helpwell-cloud).

Add `--json` to any command that prints a result and it prints one JSON
document on stdout instead — `{ "ok": true, "command": "sync", "result": … }`,
or `{ "ok": false, "error": { "code", "message" } }` with a non-zero exit —
while the progress a person would see goes to stderr. That is the form a
coding agent or a script should read.

Add `--verbose` to any command to see its working: every file `docs generate`
read (and what did not fit its budget), which articles `docs update` checked
or skipped and the words behind each decision, every model call with its
tokens, cost and time, every git command, the database it opened, and the
stack trace if something fails. It goes to stderr, so piped output stays
clean.

### Setup prompts

Every setup step that happens outside HelpWell has a prompt you can hand to
ChatGPT, Claude or a coding agent: the goal, what it needs to know, numbered
steps, the exact values, the rules (never ask for a secret), and how to check
the work. The dashboard shows each one beside its step, and `helpwell prompt`
prints them, filled in with your project: the product name, `apiPath`, the
docs folder and `appUrl` from `helpwell.config.json`, the framework
`package.json` points at, and the repo's GitHub remote.

```bash
npx helpwell prompt                        # list the topics
npx helpwell prompt install                # the whole install, for your framework
npx helpwell prompt widget --framework vue
npx helpwell prompt forms-embed --form newsletter --platform wordpress
npx helpwell prompt webhooks --copy        # to the clipboard
npx helpwell prompt identity --json        # the spec, for a script
```

The topics are `install`, `model-key`, `widget`, `identity`, `docs`,
`search-index`, `first-answer`, `evals`, `webhooks`, `mcp`, `import`,
`turnstile`, `csp`, `capture`, `capture-login`, `write-article`,
`forms-embed`, `engage-code`, `changelog-token` and `link`. The prompt goes to
stdout and the heading to stderr, so `npx helpwell prompt install > prompt.md`
saves just the prompt.

### Keeping the docs honest

Three of those are the reason HelpWell exists.

```bash
# Draft articles from what is actually in your repo. Everything lands as a
# draft; a person publishes.
helpwell docs generate --count 5

# After a release, rewrite the articles the change made wrong.
helpwell docs update --since v3.1.0

# Draft the changelog entry for what shipped: the latest GitHub release
# by default, or the commits since the last tag (see below).
helpwell changelog --release v3.2.0

# Retake every screenshot the docs reference, against your running app.
helpwell capture
```

None of them commit anything. They write files and stop, so the change arrives
as a pull request you read like any other.

`docs generate` reads your repo the way a new engineer would: the README, the
package manifest, route and handler files, anything that looks like a plan or
limits table, an OpenAPI file, the English copy in your locale files, the
changelog and the CLI's own `--help` — about 60k characters, with a cap per
source so no one file crowds out the rest, and nothing that looks like a
secret. It says what it read (`read 41 files, 58k chars`), writes drafts, and
adds a `_meta.json` for any new collection. `docs update` diffs the range,
keeps only the articles whose words overlap with what changed, and rewrites
those in place with their frontmatter and status untouched. Both are shown
the shots listed in your capture config and may reference those; an image
the model was not given is taken out before anything is written.

The rules both commands follow are in `@helpwell/core/docs`, for a server
that reads a repository through an API instead of a checkout: which files
to read and in what order (`assembleRepoContext` over a list of paths and a
reader), which changed files are worth reading (`isWatched`, with optional
globs), which articles a diff touches (`splitDiff`, `scoreArticles`,
`diffFor`), the prompts (`generatePrompt`, `articleCheckPrompt`) and reading
the answers (`parseDrafts`, `parseVerdict`). The same input drafts the same
articles either way.

### Keep the docs current on every push

Automatic updates are off until you turn them on. Once they are, every push
to `main` that changes code rewrites the articles it made wrong and opens a
pull request with them. Nothing merges without a person. It runs on your own
OpenRouter key, in your own GitHub Actions.

1. Run `npx helpwell init --ci` and commit the two workflow files it writes,
   `.github/workflows/helpwell-docs.yml` and `helpwell-evals.yml`.
2. Add your key: on GitHub, open your repository, then **Settings → Secrets and
   variables → Actions → New repository secret**. Name it `OPENROUTER_API_KEY`,
   paste your key from https://openrouter.ai/keys, and click **Add secret**.
3. Let the workflow open pull requests: **Settings → Actions → General →
   Workflow permissions**, tick **Allow GitHub Actions to create and approve
   pull requests**, and click **Save**. In an organization, an owner may have
   to allow it first under the organization's own **Settings → Actions →
   General**.
4. Check it: open the **Actions** tab, choose **HelpWell docs**, and click
   **Run workflow**. A green run that says "Every article still reads
   correctly" or opens a `helpwell/docs-…` pull request means it works.

Build the first set of articles yourself with `helpwell docs generate`; the
workflow keeps them current after that. It does not retake screenshots,
because it has no running app to photograph: run `helpwell capture` against
your app after a release that changes the screens (`helpwell doctor` checks
the setup). If you would rather not use Actions, run
`helpwell docs update --since <last release>` by hand after each release.

### Where changelog drafts come from

`helpwell changelog` reads what shipped from the place Settings, Changelog,
Source says (`changelog.source`):

| Source | What it drafts from |
| --- | --- |
| Not set (Detect it) | Worked out on each run: `github_releases` when `changelog.repo` is set or the `origin` remote is on github.com, otherwise `tags`. While that GitHub repository has no published release yet, it drafts from `tags` instead and says so in one line. `helpwell init` asks GitHub once and writes `github_releases` only when there is a release, and `tags` otherwise (no release, no network, a rate limit), so the config shows the choice and you can change it. |
| `github_releases` | The notes on the latest GitHub release of `changelog.repo` (`owner/name`; empty means the repo's `origin` remote), or the one `--release` names. Set explicitly, a repository with no release is an error rather than a quiet switch to tags. |
| `tags` | The commits from the previous tag (or the first commit) to `HEAD`. |
| `commits` | The commits since the last published entry, to `HEAD`: from the commit that entry's range ran to (every entry drafted from git records it), or, for an entry written by hand or drafted from a release, from its publish date. Before anything is published, from the previous tag. |
| `manual` | Nothing. The command says entries are written by hand, and needs no key to say it. |

`--since` and `--to` set the range for `tags` and `commits` by hand.
`--source` overrides the setting for one run. GitHub releases are read with
`GITHUB_TOKEN` from the environment when it is set. Without one, GitHub allows
60 requests an hour from an IP address, which a shared CI runner can use up,
and cannot see a private repository; the command says so when it runs
without one. The token needs read access to the repository's contents and
nothing else, and in GitHub Actions the workflow's own `secrets.GITHUB_TOKEN`
does the job. `helpwell changelog --prompt` prints the setup below, filled in
with your repository.

<details>
<summary>Set this up with an AI assistant: a GitHub token for changelog drafts</summary>

The same prompt is on the dashboard, under Settings, Changelog, while the
source is GitHub releases or Detect it, and `npx helpwell prompt
changelog-token` prints it with your repository. It holds no token.

<!-- generated:prompt:changelog-token (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up a GitHub token so HelpWell can read my product's releases. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

`helpwell changelog` reads the notes on <owner>/<repo>'s GitHub releases with GITHUB_TOKEN set, wherever it runs: in GitHub Actions, and on my machine if I run it there.

## What you need to know

- HelpWell's `helpwell changelog` drafts a customer-facing changelog entry from the notes on a GitHub release when `changelog.source` is `github_releases` in helpwell/helpwell.config.json, or is not set and the repo's origin remote is on GitHub. It calls GET https://api.github.com/repos/<owner>/<repo>/releases/latest (or /releases/tags/<tag> with --release) and never writes to GitHub.
- Without a token GitHub allows 60 requests an hour from one IP address, which shared CI runners use up, and a private repository cannot be read at all. With GITHUB_TOKEN set, HelpWell sends it and the limit is 5,000 an hour.
- Read access to the repository contents is all it needs.
- In GitHub Actions, the workflow's built-in token already works for the same repository: the job needs `permissions: contents: read` and the step needs GITHUB_TOKEN set from `secrets.GITHUB_TOKEN`. No personal token is needed there.
- I have not said which repository: ask me for its owner/name.

## Steps

1. Ask me where `helpwell changelog` runs: in GitHub Actions, on my machine, or both. Only set up those.
2. GitHub Actions, same repository: in the workflow job that runs `helpwell changelog`, add `permissions: contents: read` and set GITHUB_TOKEN on the step from `secrets.GITHUB_TOKEN`, as in the block below. Keep everything already in the workflow.
3. My machine, or CI outside GitHub: walk me through creating a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new with the settings in the table: only <owner>/<repo>, Contents read-only, nothing else, and the shortest expiry my team allows.
4. Tell me where to paste the token myself: as GITHUB_TOKEN in the repo's .env file (check .env is in .gitignore first), or in my CI provider's secret settings.
5. If `changelog.repo` in helpwell/helpwell.config.json is empty, set it to <owner>/<repo>. Leave `changelog.source` as `github_releases`, or unset; if it says tags or commits, ask me before changing it.

## Exact values

### The fine-grained token

| setting | value |
| --- | --- |
| Token type | Fine-grained personal access token |
| Resource owner | <owner> |
| Repository access | Only select repositories: <owner>/<repo> |
| Repository permissions: Contents | Read-only |
| Repository permissions: Metadata | Read-only (GitHub adds it) |
| Every other permission | No access |
| Environment variable | GITHUB_TOKEN |

The same values as JSON:

```json
[
  {
    "setting": "Token type",
    "value": "Fine-grained personal access token"
  },
  {
    "setting": "Resource owner",
    "value": "<owner>"
  },
  {
    "setting": "Repository access",
    "value": "Only select repositories: <owner>/<repo>"
  },
  {
    "setting": "Repository permissions: Contents",
    "value": "Read-only"
  },
  {
    "setting": "Repository permissions: Metadata",
    "value": "Read-only (GitHub adds it)"
  },
  {
    "setting": "Every other permission",
    "value": "No access"
  },
  {
    "setting": "Environment variable",
    "value": "GITHUB_TOKEN"
  }
]
```

## Use exactly as written

GitHub Actions: the job that drafts the entry

```yaml
jobs:
  changelog:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npx helpwell changelog
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Give the token read-only access to contents of this one repository. Never grant write, admin, workflow or organisation permissions.
- Never put the token in helpwell.config.json, a workflow file or any committed file. It lives in .env (git-ignored) or the CI secret store as GITHUB_TOKEN.

## Check your work

1. Run: curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/<owner>/<repo>/releases/latest (200 means it can read the latest release; 404 means there is no published release yet, or the token cannot see the repository).
2. Run: npx helpwell changelog --dry-run. It prints a draft made from the latest release and saves nothing.

## When you are done

Tell me where GITHUB_TOKEN is set, which repository it can read, when it expires, and what the dry run printed.
````
<!-- /generated:prompt:changelog-token -->

</details>

#### Drafting from releases in your own code

The release reader and the drafting are in `@helpwell/core/changelog`, so a
server can draft entries on its own schedule, or when GitHub says a release
was published, without the CLI. Entries go through the normal changelog repo
as drafts, and a release that already has an entry is skipped:

```ts
import { draftChangelogFromReleases } from '@helpwell/core/changelog';

const { results } = await draftChangelogFromReleases(db, {
  model,                      // a ModelPort: the install's own
  repo: 'acme/app',           // defaults to changelog.repo
  token: process.env.GITHUB_TOKEN,
  limit: 3,                   // the newest three releases; or `tag: 'v1.5.0'` for one
});
// results[i].status: created | exists | no_notes | internal | unusable
```

`fetchRelease`, `listReleases` and `hasPublishedRelease` read GitHub on their
own, and every function takes its own `fetch`, so nothing is read from the
environment.

### Screenshots

`helpwell capture` drives Chromium (Playwright, an optional peer dependency)
through the shots listed under `screenshots.shots` in
`helpwell/helpwell.config.json`, in light and, with `"dark": true`, dark.

```jsonc
"screenshots": {
  "dir": "docs/_screenshots",
  "blur": [".account-email"],
  "login": {
    "url": "/login",
    "fill": [
      { "selector": "input[name=email]", "env": "HELPWELL_CAPTURE_EMAIL" },
      { "selector": "input[name=password]", "env": "HELPWELL_CAPTURE_PASSWORD" }
    ],
    "submit": "button[type=submit]",
    "success": "[data-testid=account-menu]"
  },
  "shots": [
    {
      "name": "billing",
      "path": "/settings/billing",
      "clip": "main",
      "dark": true,
      "annotate": [
        { "type": "spotlight", "target": "#plan-card" },
        { "type": "step", "target": "#upgrade" },
        { "type": "arrow", "target": "#upgrade", "direction": "left", "text": "Upgrade here" },
        { "type": "blur", "target": ".card-number" }
      ]
    }
  ]
}
```

`annotate` draws on the page just before the shot: `rect`, `ellipse`,
`arrow`, `step` (a numbered marker), `label`, `spotlight` (dims everything
else) and `blur`. Each is anchored to a CSS selector, not pixels, so it
follows the element when the layout moves, and takes optional `text`,
`color`, `step`, `direction`, `offset` and `padding`. A target that matches
nothing is skipped with a warning, never drawn somewhere else.

`login` signs in once and reuses the session for every shot. The config only
ever names environment variables; a `value` written into it is refused.
`storageState` (a Playwright storage-state file you keep out of git) and
`cookies` (`{ "name": "session", "env": "APP_SESSION" }`) are the
alternatives.

Capture runs wherever the app runs: your machine, CI or a container. The
server that answers HelpWell requests never needs a browser, and Docker is not
required. `npm i -D playwright && npx playwright install chromium` sets it up;
on Linux, in CI or in a Docker image, use `npx playwright install --with-deps
chromium` for the system libraries too. `helpwell doctor` checks it once shots
are configured, and capture says exactly what is missing.

A retake never replaces a good picture with a wrong one: a page that answers
an error, or sends the browser to another host or a sign-in page, keeps the
last picture, and capture names the articles that still show it so you can
fix the sign-in or replace the image by hand. The article editor titles an
annotated copy of a screenshot `"Annotated copy of _screenshots/<name>.png"`;
when capture changes that screenshot, it names the articles to annotate again.

#### Set this up with an AI assistant

Paste this into ChatGPT, Claude or your coding agent to set up capture. It
names the environment variables you fill in yourself and holds no secret; the
`docs/README.md` that `helpwell init` writes has the same prompt, and one for
signing in, and `npx helpwell prompt capture` and `npx helpwell prompt
capture-login` print them with your project's paths.

<!-- generated:prompt:capture (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up screenshot capture for our HelpWell help articles. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

`npx helpwell capture` takes the screenshots the help articles reference, from the running app, and writes them to docs/_screenshots/, where the help center and the widget load them from.

## What you need to know

- HelpWell is installed. Its config is helpwell/helpwell.config.json and the articles are Markdown files in docs/.
- Capture runs wherever the app runs: this machine, CI or a container. The server that answers HelpWell requests never needs a browser, and Docker is not required.
- The app runs at http://localhost:3000: that is the config's appUrl. Change it there if the app runs somewhere else.
- Each screenshot is one entry under screenshots.shots: a name (the file name without .png) and a path on the app. waitFor and click take CSS selectors, clip crops to one element, and dark: true also writes <name>-dark.png.
- annotate draws on the screenshot before it is taken: rect, ellipse, arrow, step (a numbered marker), label, spotlight and blur, each anchored to a CSS selector in target. A target that matches nothing is skipped with a warning, never drawn somewhere else.

## Steps

1. Install Playwright as a dev dependency and download Chromium: `npm i -D playwright`, then `npx playwright install chromium`. On Linux, in CI or in a Docker image, use `npx playwright install --with-deps chromium` so the system libraries are installed too. Run `npx helpwell doctor`: its Screenshots line should pass.
2. If the screenshots should be retaken in CI (for example on each release), add a job that installs Chromium as above, starts the app, waits for it to answer, then runs `npx helpwell capture` and commits the changed images. Ask me first.
3. Read the articles and pick the two or three screens they describe most. For each, find a stable CSS selector for the part worth showing: ids, data-testid attributes and aria labels, not generated class names.
4. Add those shots under screenshots.shots in helpwell/helpwell.config.json, following the example below. Keep every shot that is already listed.
5. Where an article describes one of those screens, reference the image by a path relative to the article, e.g. `![The billing page](../_screenshots/billing.png)` from docs/<collection>/<article>.md.
6. If a screen needs a signed-in user, stop and tell me: signing in is set up separately, with environment variables I fill in myself.
7. Start the app, then run `npx helpwell capture`.

## Use exactly as written

An example screenshots block for helpwell/helpwell.config.json:

```json
{
  "screenshots": {
    "dir": "docs/_screenshots",
    "shots": [
      {
        "name": "billing",
        "path": "/settings/billing",
        "waitFor": "[data-testid=\"plan-card\"]",
        "clip": "main",
        "dark": true,
        "annotate": [
          {
            "type": "rect",
            "target": "[data-testid=\"plan-card\"]"
          },
          {
            "type": "step",
            "target": "#upgrade",
            "step": 1
          },
          {
            "type": "arrow",
            "target": "#upgrade",
            "direction": "left",
            "text": "Upgrade here"
          },
          {
            "type": "blur",
            "target": ".account-email"
          }
        ]
      }
    ]
  }
}
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never put a password, session cookie or token in helpwell.config.json or in any article.
- Only reference screenshots that are listed under screenshots.shots. Never invent an image path.

## Check your work

1. Run `npx helpwell capture`. It should print "Wrote N screenshots" and no "could not be taken" lines.
2. Open the new images in docs/_screenshots/ and check each shows the intended screen, not a sign-in page or an error.
3. If it printed an annotation warning, a target matched nothing: fix that selector and run it again.
4. Run `npx helpwell sync`, open an article that uses a screenshot in the help center, and check the image loads.

## When you are done

Tell me what you changed, what you could not do, and anything I still need to do myself.
````
<!-- /generated:prompt:capture -->

And for pages behind your sign-in:

<!-- generated:prompt:capture-login (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up signed-in screenshot capture for our HelpWell help articles. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

`npx helpwell capture` signs in to the app as a test account before it takes screenshots. The credentials come from environment variables and are never written into the repo.

## What you need to know

- The app runs at http://localhost:3000.
- The sign-in steps live under screenshots.login in helpwell/helpwell.config.json: url (the sign-in page), fill (each field's CSS selector and the name of the environment variable holding its value), submit (the button to press), and success (a selector that only exists once signed in) or successUrl (part of the URL the app lands on).
- HelpWell signs in once per run and reuses that session for every shot, light and dark.
- Instead of signing in, screenshots.storageState can name a Playwright storage-state file, and screenshots.cookies can set cookies whose values come from environment variables.

## Steps

1. Use a dedicated test account with demo data, never a real customer's account.
2. Open the sign-in page and find CSS selectors for the email field, the password field and the submit button, plus one element that only appears after signing in.
3. Add the login block below under screenshots in helpwell/helpwell.config.json, with the selectors you found.
4. Add `HELPWELL_CAPTURE_EMAIL=` and `HELPWELL_CAPTURE_PASSWORD=`, with no values, to .env.example. Then tell me to put the real values in my own .env file, or in the CI secrets if capture runs in CI.
5. Check that .env is in .gitignore.

## Use exactly as written

The login block, under screenshots in helpwell/helpwell.config.json:

```json
{
  "login": {
    "url": "/login",
    "fill": [
      {
        "selector": "input[name=\"email\"]",
        "env": "HELPWELL_CAPTURE_EMAIL"
      },
      {
        "selector": "input[name=\"password\"]",
        "env": "HELPWELL_CAPTURE_PASSWORD"
      }
    ],
    "submit": "button[type=\"submit\"]",
    "success": "[data-testid=\"account-menu\"]"
  }
}
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never write an email address, password, cookie value or token into helpwell.config.json, .env.example, an article, or this chat. Only the names of the environment variables go in the config.
- Never commit a storage-state file: it holds a live session.

## Check your work

1. Once I have filled in my .env, run `npx helpwell capture`. It should print "Signed in" and no sign-in error.
2. Open one of the new screenshots and check it shows the signed-in app, not the sign-in page.
3. Run `git status` and check no file containing credentials is about to be committed.

## When you are done

Tell me what you changed, what you could not do, and anything I still need to do myself.
````
<!-- /generated:prompt:capture-login -->

### Moving from another help desk

`helpwell import` brings articles over as Markdown files in your docs folder,
with a `_meta.json` for each new collection, images downloaded next to them,
and `helpwell/redirects.json` mapping every old URL to its new page. Nothing
is indexed until you run `helpwell sync`, so the import arrives as a change
you review. Run it twice and the second run skips what is already there.

```bash
helpwell import ./export                      # a folder: Markdown, HTML, GitBook or Notion
helpwell import zendesk --subdomain acme      # public help centers need no key
helpwell import intercom                      # INTERCOM_TOKEN in your environment
helpwell import helpscout                     # HELPSCOUT_DOCS_API_KEY
helpwell import freshdesk --subdomain acme    # FRESHDESK_API_KEY
helpwell import document360                   # DOCUMENT360_API_TOKEN
helpwell import crisp --website-id <id>       # CRISP_IDENTIFIER and CRISP_KEY
helpwell import crawl https://help.acme.com   # any public site, as drafts
helpwell import contacts contacts.csv --dry-run
```

Keys are read from your environment and never stored. A crawl writes drafts,
because a page scraped from someone else's theme wants a person, or a coding
agent, to tidy it before it is published.

**Old links keep working.** The help center serves `helpwell/redirects.json`:
a request that would be a 404 there, whose path matches an old URL in the
file, gets a 301 to the article it became, under whatever path the help center
is mounted at now and with its query string kept. Point the old help center's
domain at yours and `https://help.acme.com/hc/en-us/articles/11-Refunds` lands
on `/help/billing/refunds`. The file is read again whenever it changes, so a
new import is live without a restart; an existing page always wins over a
redirect.

```jsonc
// helpwell/redirects.json, as `helpwell import` writes it
{ "redirects": [
  { "from": "https://acme.zendesk.com/hc/en-us/articles/11-Refunds", "to": "/help/billing/refunds" }
] }
```

Only the path of `from` is matched. `to` must be a path in the help center:
an absolute URL, a `//host`, a backslash, a query, or anything that resolves
outside the help center is ignored, so the file cannot send anyone to another
site. `createHelpCenter({ redirects })` takes another file, the rules
themselves, or `false` for none; with a `content` source, nothing is read from
disk unless you name a file: the map is `_redirects.json` in the content
source instead, which the dashboard's Redirects screen edits. On a serverless
host, include the file in the deployed files, like the docs folder.

**Importing with no terminal.** An install whose content is managed for it
(`contentMode: 'managed'` and a writable content source) imports from the
dashboard: Knowledge base, Import. It runs the same importers as the CLI,
writes the articles and their `_meta.json` files through the content source,
the images through the asset store, and the old URLs into `_redirects.json`,
then indexes the knowledge base, showing its progress and a summary at the
end. It takes:

- an uploaded export, up to 100 MB: a ZIP of a folder of Markdown files (a
  docs repo, Mintlify, Docusaurus), a folder of HTML pages (most help desks'
  export), a GitBook repository with its `SUMMARY.md`, or a Notion export
  (Markdown or HTML, the ZIP inside a ZIP included), worked out from what is
  in it; or a single Markdown or HTML file;
- a public address: a Zendesk help center at its `zendesk.com` address, read
  through Zendesk's public API with its sections and draft states, or any
  other public help site, crawled page by page into drafts.

Intercom, Help Scout, Freshdesk, Document360 and Crisp need a key, so they
stay with the CLI, where the key lives in your environment. An archive is
read in memory with limits on its entries (20,000), each file (50 MB) and the
total (500 MB), and entries that climb out of it are dropped. Everything the
import reads from the web goes through a guarded fetch: https only, no
private or loopback address (checked as it connects), redirects checked the
same way, and a size limit. A host with its own egress rules passes
`importFetch` to `createDashboard`.

The import runs inside the form's request, with its progress streamed to the
page. A host that runs long work on workers passes `importJobs` instead:
`start` gets the checked form (the upload's bytes or the address, and the
draft and replace choices) and answers a job id, and `watch` yields that
job's progress and then its summary, which the page shows as before. The
worker can run the same import with `runImportJob` from
`@helpwell/dashboard`:

```ts
createDashboard({
  db, content,
  importJobs: {
    start: async (request) => ({ id: await queue.add('import', request) }),
    watch: (id) => queue.events(id), // { type: 'progress', text } … then { type: 'done', summary }
  },
});
// In the worker:
const summary = await runImportJob(config, request, { apiPath, onProgress });
```

Contacts come from a CSV or JSON file with `id` (your app's user id), `email`,
`name`, `signed_up` and `tags` columns; any other column becomes an attribute.
Imported people are labelled Import with consent not given, whatever the old
tool said, and a later sign-in finds them by the same user id. `--dry-run`
runs the whole import and rolls it back, so its counts are the real ones.

<details>
<summary>Set this up with an AI assistant: preparing a contacts export</summary>

`helpwell import --prompt` and `npx helpwell prompt import` print this too. It
holds no secrets.

<!-- generated:prompt:import (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up moving my contacts from my current support tool into HelpWell. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

A contacts.csv (or contacts.json) file in the shape HelpWell expects, imported with `npx helpwell import contacts`, with the counts checked.

## What you need to know

- The contacts come from my current support tool. Most tools export people as CSV from their contacts, users or customers screen.
- Every imported contact is labelled with the source "import" and consent "unknown". An import never records consent, whatever the old tool said.
- People are matched on id (my app's own user id, the same one my app signs into HelpWell identify tokens), then on email. Running the same import twice updates rather than duplicates.
- Any column that is not one of the named ones becomes an attribute with that name, and its type is inferred (number, date, true/false, list, link or text).

## Steps

1. Tell me where my current support tool exports contacts, then wait for me to download the export. Do not ask me to share API keys or passwords for my current support tool.
2. Map the export's columns onto the columns below. Rename columns; do not invent values. Leave a cell empty when the export has nothing for it.
3. Drop columns that hold passwords, payment card details, government ids or anything else sensitive.
4. Write the result to contacts.csv in the repo root (UTF-8, comma separated, one header row). Tags go in one cell, separated by semicolons.
5. Run `npx helpwell import contacts contacts.csv --dry-run` and show me the counts and any skipped rows.
6. When I confirm, run `npx helpwell import contacts contacts.csv`.
7. Delete contacts.csv afterwards, or make sure it is in .gitignore: it holds personal data.

## Exact values

### Columns HelpWell reads

| column | required | meaning | example |
| --- | --- | --- | --- |
| id | id or email | Your app's user id | usr_8412 |
| email | id or email | Email address | ada@example.com |
| name | no | Full name | Ada Lovelace |
| signed_up | no | When they signed up, ISO 8601 | 2025-03-04 |
| tags | no | Semicolon-separated tags | beta;agency |
| (anything else) | no | Becomes an attribute | plan = pro |

The same values as JSON:

```json
[
  {
    "column": "id",
    "required": "id or email",
    "meaning": "Your app's user id",
    "example": "usr_8412"
  },
  {
    "column": "email",
    "required": "id or email",
    "meaning": "Email address",
    "example": "ada@example.com"
  },
  {
    "column": "name",
    "required": "no",
    "meaning": "Full name",
    "example": "Ada Lovelace"
  },
  {
    "column": "signed_up",
    "required": "no",
    "meaning": "When they signed up, ISO 8601",
    "example": "2025-03-04"
  },
  {
    "column": "tags",
    "required": "no",
    "meaning": "Semicolon-separated tags",
    "example": "beta;agency"
  },
  {
    "column": "(anything else)",
    "required": "no",
    "meaning": "Becomes an attribute",
    "example": "plan = pro"
  }
]
```

## Use exactly as written

The same people as contacts.json, if JSON is easier:

```json
[
  {
    "id": "usr_8412",
    "email": "ada@example.com",
    "name": "Ada Lovelace",
    "signedUpAt": "2025-03-04",
    "tags": [
      "beta",
      "agency"
    ],
    "attributes": {
      "plan": "pro",
      "seats": 4
    }
  }
]
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never commit the export or contacts.csv to the repository.

## Check your work

1. The dry run reports created and updated counts that add up to the rows in the file, minus the skipped ones.
2. After the import, the Contacts screen in the HelpWell dashboard shows the people with the source "Import".

## When you are done

Tell me what you changed, what you could not do, and anything I still need to do myself.
````
<!-- /generated:prompt:import -->

</details>

### In CI

```yaml
- run: npx helpwell sync
- run: npx helpwell eval --ref ${{ github.sha }} --threshold 80
```

`sync` is safe on every deploy: articles are matched by content hash, so an
unchanged file costs nothing and does not burn an embedding.

`helpwell init --ci` writes `.github/workflows/helpwell-evals.yml`, which runs
exactly that on every pull request that touches the docs or `helpwell/`. It is
off by default, and needs an `OPENROUTER_API_KEY` repository secret to do more
than measure retrieval.

It also writes `.github/workflows/helpwell-docs.yml`: on every push to `main`
that changes code, `helpwell docs update --since` the commit before the push
rewrites the articles the change made wrong, and the workflow opens a pull
request with them on a `helpwell/docs-<commit>` branch. Nothing merges without
a person. [Keep the docs current on every push](#keep-the-docs-current-on-every-push)
has the steps to turn it on.

---

## How it works

```
your repo                     your database                your page
─────────                     ─────────────                ─────────
docs/**/*.md   ──sync──▶      helpwell.article_index   ◀──  help center
helpwell/                     helpwell.conversations        widget
  instructions.md             helpwell.gaps                 dashboard
  helpwell.config.json        …every table in one schema
```

**Every answer is grounded.** A question runs through search first. The
passages that come back are numbered, wrapped in tags with an explicit
instruction to treat them as data, and the model is told to answer only from
them. A passage is not a search snippet: it is the part of the article the
question is about, whole sections of its Markdown with lists and code intact,
cut only between blocks or sentences, and all of them together stay inside a
fixed budget (`PASSAGE_TOKEN_BUDGET`, 3,000 tokens). It cites the passages it used by number, and those are the citations the
customer sees: finding an article is not the same as using it. It also ends
every reply with a line the customer never sees, saying whether the docs
answered the question fully, partly or not at all.

**It knows when it does not know.** Every answer gets a confidence score from
how strongly search matched, whether the answer cited what it used, and what
the model said about its own answer. A conversation is left unresolved, and
the question recorded as a gap, when the score is low, when the model says the
docs do not cover it, or when it flags the conversation itself — rather than
inventing something. The threshold is built in, not a setting.

**Search works without embeddings.** Postgres full-text with weighted fields
does the first pass. It matches every word of the question when it can, and
falls back to any of the words, ranked by how many each article has, when a
wordy question matches nothing that way. If you have configured an embedding
model, a semantic pass runs alongside it and the two are merged with
reciprocal rank fusion. The semantic pass has a similarity floor, so an
article that merely shares a language with the question is not a match. No
pgvector extension required — cosine is computed in JavaScript over a few
hundred vectors, which is faster than the round trip to ask.

**It degrades rather than failing.** If the model is unavailable, the agent
answers from search and says that is what happened. If the daily spend cap is
reached, the same. A broken support widget never breaks the page it is on: if
the config request fails, the widget simply does not mount.

**It is built to face the public internet.** Identity comes from a token your
server signed, so a browser can never claim to be someone else, and an email
address is never enough to read another person's history. Conversations,
ratings and feedback can only be touched by the browser that owns them. Admin
routes refuse cross-site requests and non-JSON bodies, rate limits are keyed
on the visitor rather than on a header anyone can set, and one address can
mint only so many anonymous visitors an hour.

**Everything is in your database.** One schema, `helpwell`, and hand-written
numbered SQL migrations you can read before they run. No ORM journal, no
codegen, no magic.

### The packages

| Package | What it is |
|---|---|
| `@helpwell/core` | Schema, migrations, settings, search, the agent, and the HTTP API |
| `@helpwell/widget` | The Shadow DOM widget and its loader, under 1 KB gzipped |
| `@helpwell/helpcenter` | The public documentation site |
| `@helpwell/dashboard` | The admin UI |
| `@helpwell/ui` | Server-rendered HTML primitives the two share |
| `@helpwell/tokens` | Design tokens and the brand marks |
| `@helpwell/sdk` | A typed client, for scripts and your own server |
| `@helpwell/mcp` | An MCP server, so your coding agent can read the gaps, write articles, draft the changelog and run evals |
| `helpwell` | The CLI |

Nothing pulls in a UI framework. The widget is plain DOM; the help center and
dashboard render HTML strings on the server with small islands of vanilla
JavaScript. HelpWell can never argue with your app about a React version.

---

## Configuration

Everything lives in `helpwell/helpwell.config.json`, so settings are reviewed
in pull requests like anything else. `helpwell sync` pushes the file to the
database when the file is the newer of the two; if someone changed a setting
in the dashboard since, it says so and leaves it alone, and
`helpwell settings pull` or `push` settles it whichever way you meant. On a
fresh CI checkout every file looks new, so a team that edits settings in the
dashboard runs `helpwell sync --no-settings` there.

```jsonc
{
  "docs": "docs",
  "appUrl": "https://app.acme.com",
  "settings": {
    "product": { "name": "Acme", "appUrl": "https://app.acme.com" },
    "agent": {
      "models": {
        "chat": "anthropic/claude-sonnet-5",
        "fallback": "google/gemini-3.5-flash",
        "embeddings": "openai/text-embedding-3-small"
      },
      "tools": {
        "searchDocs": true,
        "readChangelog": true,
        "lookUpUser": true,
        "collectEmail": true,
        "markUnresolved": true,
        "suggestArticle": true
      },
      "spend": { "dailyCapUsd": 15, "warnAtPct": 80 }
    },
    "widget": {
      "appearance": { "accent": "#7A3BEB", "radius": 24 },
      "displayRules": {
        "include": ["**"],
        "exclude": ["/checkout/**", "/login"]
      }
    },
    "data": { "retentionMonths": 12 }
  }
}
```

### Telling HelpWell who someone is

Sign a token on your server and hand it to the widget. The browser can never
claim to be someone else.

```ts
import { signIdentity } from '@helpwell/core';

const token = await signIdentity(
  { id: user.id, email: user.email, name: user.name, plan: user.plan },
  process.env.HELPWELL_IDENTITY_SECRET,
);
```

```js
helpwell('identify', token);
```

Anything extra you pass is an attribute: shown on the contact, offered to the
agent, and filterable in segments. Attributes **merge**: a later token sets
the keys it carries, a key set to `null` is removed, and a key it leaves out is
kept, so a page that signs a lighter token cannot erase what another page
said. `createdAt` (ISO 8601) is when they signed up to your app, and
`consent: 'granted' | 'denied'` is recorded with the time and "identify" as
its source. If you never call `identify`, the widget asks for an email before
the first message — configurable, and off by default.

<details>
<summary>Set this up with an AI assistant: signing identify tokens</summary>

With the exact algorithm and code for Node, Python, Ruby and PHP. The secret is
read from `HELPWELL_IDENTITY_SECRET`, never written into the prompt. The same
prompt is on the dashboard's Get set up page, and `npx helpwell prompt identity`
prints it.

<!-- generated:prompt:identity (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up signed identify tokens, so HelpWell knows who is signed in to my product. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

My server signs a short-lived token for the signed-in person and hands it to the widget, and HelpWell verifies it, so conversations are tied to real accounts and nobody can pretend to be someone else.

## What you need to know

- The token is a JWT (RFC 7519) signed with HMAC-SHA256, "alg": "HS256", keyed with the UTF-8 bytes of the shared secret.
- The secret is in the environment variable HELPWELL_IDENTITY_SECRET, set to the same value on my app's server (which signs) and on the server that runs the HelpWell API at /api/helpwell (which verifies). If they are the same app, it is one variable.
- Required claim: "sub", my own user id as a string. Recommended: "iat" (now) and "exp" (at most 7 days later; HelpWell rejects expired tokens).
- Optional claims with a meaning: "email", "name", "avatarUrl", "createdAt" (when they signed up, ISO 8601), "consent" ("granted" or "denied"), "locale", "timezone". Any other claim becomes an attribute on the contact, e.g. "plan": "pro".
- Attributes merge: a claim that is present sets the value, a claim set to null removes it, and a claim left out is kept.
- The token reaches the widget either as data-token="…" on the loader script tag or through helpwell("identify", token) in the browser. On sign-out, call helpwell("reset").

## Steps

1. Tell me to generate a random secret myself (for example `openssl rand -hex 32` in a terminal) and paste it as HELPWELL_IDENTITY_SECRET into my env file and my host's environment settings. Do not ask me for it and do not generate it for me in this chat.
2. Find where my app knows who is signed in on the server (a session helper, current_user, request.user).
3. Add a function that signs the token for that person with the code below for my language. Sign on the server only.
4. Pass the token to the widget: render it into the loader tag as data-token, or expose it from an endpoint my front end calls after sign-in and hand it to helpwell("identify", token).
5. Call helpwell("reset") when someone signs out, so the next person on a shared computer starts fresh.

## Exact values

### Token

| field | value |
| --- | --- |
| header | {"alg":"HS256","typ":"JWT"} |
| sub | your user id, as a string (required) |
| iat / exp | issued now, expires within 7 days |
| email, name | optional, shown on the contact |
| anything else | optional, becomes an attribute |
| secret | the environment variable HELPWELL_IDENTITY_SECRET |

The same values as JSON:

```json
[
  {
    "field": "header",
    "value": "{\"alg\":\"HS256\",\"typ\":\"JWT\"}"
  },
  {
    "field": "sub",
    "value": "your user id, as a string (required)"
  },
  {
    "field": "iat / exp",
    "value": "issued now, expires within 7 days"
  },
  {
    "field": "email, name",
    "value": "optional, shown on the contact"
  },
  {
    "field": "anything else",
    "value": "optional, becomes an attribute"
  },
  {
    "field": "secret",
    "value": "the environment variable HELPWELL_IDENTITY_SECRET"
  }
]
```

## Use exactly as written

Node or TypeScript, with @helpwell/core:

```ts
import { signIdentity } from '@helpwell/core';

export function helpwellToken(user: { id: string | number; email?: string; name?: string }) {
  return signIdentity(
    { id: String(user.id), email: user.email, name: user.name },
    process.env.HELPWELL_IDENTITY_SECRET ?? '',
    { expiresIn: '7d' },
  );
}
```

Python, with PyJWT (pip install pyjwt):

```python
import os, time
import jwt

def helpwell_token(user):
    now = int(time.time())
    claims = {"sub": str(user.id), "email": user.email, "name": user.get_full_name(), "iat": now, "exp": now + 7 * 24 * 3600}
    return jwt.encode(claims, os.environ["HELPWELL_IDENTITY_SECRET"], algorithm="HS256")
```

Ruby, with the jwt gem (gem "jwt"):

```ruby
require "jwt"

def helpwell_token(user)
  now = Time.now.to_i
  claims = { sub: user.id.to_s, email: user.email, name: user.name, iat: now, exp: now + 7 * 24 * 3600 }
  JWT.encode(claims, ENV.fetch("HELPWELL_IDENTITY_SECRET"), "HS256")
end
```

PHP, with firebase/php-jwt (composer require firebase/php-jwt):

```php
use Firebase\JWT\JWT;

function helpwell_token($user): string {
    $now = time();
    $claims = ['sub' => (string) $user->id, 'email' => $user->email, 'name' => $user->name, 'iat' => $now, 'exp' => $now + 7 * 24 * 3600];
    return JWT::encode($claims, getenv('HELPWELL_IDENTITY_SECRET'), 'HS256');
}
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never send HELPWELL_IDENTITY_SECRET to the browser, log it, commit it, or put it in this chat.
- Sign tokens only for the person the server has already authenticated. Never sign a user id the browser sent.
- Do not use any algorithm other than HS256; HelpWell rejects everything else.

## Check your work

1. Sign in to the app and open the widget. The HelpWell dashboard's Contacts page lists you as signed in, with your email.
2. A request to /api/helpwell/identify with a token signed by a different secret answers 401.
3. "Identify signed-in people" on the dashboard's Get set up page turns green.

## When you are done

Tell me where the token is signed, how it reaches the widget, where the secret is read from, and the result of the checks.
````
<!-- /generated:prompt:identity -->

</details>

Your server can describe people too, by your own user id, before they ever
open the widget. An id HelpWell has not seen becomes a contact:

```ts
import { HelpWellClient } from '@helpwell/sdk';

const helpwell = new HelpWellClient({ baseUrl, adminToken: process.env.HELPWELL_ADMIN_TOKEN });
await helpwell.contacts.update('usr_8412', { attributes: { seats: 4 }, tags: { add: ['beta'] } });
await helpwell.contacts.track('usr_8412', 'exported_csv', { rows: 120 });
```

That is `PATCH /admin/contacts/usr_8412` and `POST /admin/events` underneath.
Tracked events, from here or from `helpwell('track', …)` in the browser, are
listed and counted under `GET /admin/events`, and segments can use them.

People are matched on the `id` in the token and nothing else. An email address
is shown, searched and offered to the agent, but it never merges two contacts,
so a visitor who types someone else's address gets a fresh contact rather than
that person's history. When a user signs out, call `helpwell('reset')`: it
ends the session and drops the visitor cookie, so the next person on that
browser starts clean.

### Webhooks

Anything that happens in HelpWell can be posted to a URL you own.

```jsonc
"webhooks": [
  {
    "url": "https://hooks.acme.com/helpwell",
    "secret": "…",
    "events": ["conversation.unresolved", "gap.created"]
  }
]
```

<!-- generated:webhook-events (do not edit: `pnpm readme` rewrites it from the code) -->
| Event | When |
|---|---|
| `conversation.created` | A visitor started a new conversation. |
| `conversation.unresolved` | The agent could not answer from the docs. |
| `message.created` | A message was added to a conversation, by the visitor or the agent. |
| `feedback.created` | Someone rated an answer, a conversation or an article (`kind` says which). |
| `gap.created` | A question the docs do not answer was logged for the first time. |
| `roadmap.idea` | Someone suggested a roadmap idea. |
| `survey.response` | Someone answered a survey question. A multi-question survey sends one per answer, with the same `sessionId`. |
| `changelog.published` | A changelog entry was published. |
| `article.published` | An article went live in the help center after a sync. |
| `form.submitted` | Someone submitted a form and it was accepted. `trusted` says whether it passed every anti-abuse check. |
| `giveaway.entered` | Someone entered a giveaway for the first time. |
<!-- /generated:webhook-events -->

An empty `events` list subscribes to all of them. Every delivery is a JSON
`POST` of `{ "event", "at", "data" }` with `x-helpwell-event`,
`x-helpwell-delivery`, `x-helpwell-attempt` and, when a secret is set,
`x-helpwell-signature` — `sha256=` and an HMAC of the exact body, the way
GitHub and Stripe sign theirs. Check it before trusting anything:

```ts
import { verifySignature } from '@helpwell/core';

const body = await request.text();
const signature = request.headers.get('x-helpwell-signature');
if (!(await verifySignature(secret, body, signature))) {
  return new Response('bad signature', { status: 401 });
}
```

Deliveries time out after five seconds and are logged with their response
status, so a webhook that is failing is visible in the dashboard rather than
silent. A failing webhook never fails the request that raised it.

A failed delivery is retried with the same body and delivery id, up to five
attempts in all, after 1, 4, 16 and 64 minutes. HelpWell runs inside your app
and has no worker, so a retry happens whenever it next sends a webhook, when
someone presses Retry on the dashboard (`POST /admin/webhooks/retry`), or when
`helpwell webhooks retry` runs; put that on a cron every few minutes if your
install is quiet. `helpwell webhooks test` and the Send test delivery button
on the dashboard's Webhooks page send a `webhook.test` event to check an
endpoint.

In a repo, webhooks live in `helpwell.config.json`, as above, and the
Webhooks page lists them. An install with no config file of its own
(`contentMode: 'managed'`) adds, pauses and removes them on that page instead:
HelpWell makes each one's signing secret and shows it once, when it is made
(or when you ask for a new one), and the address is checked by the same guard
as every send.

Whoever can edit settings can point a webhook anywhere, so every send (first
try, retry or test) goes through a guard that checks the address as it
connects: https only, no loopback, private or link-local address among those
the name resolves to, and no redirect followed. A refused delivery is logged
with the reason and not retried. Pointing a webhook at `http://localhost`
while you develop needs the guard off: set `HELPWELL_WEBHOOK_GUARD=off`, or
pass `webhookFetch: false` to `createHelpWellHandler` and `createDashboard`.
A host with its own egress rules passes its own fetch as `webhookFetch`
instead, and every send goes through that.

<details>
<summary>Set this up with an AI assistant: a webhook receiver</summary>

The same prompt is on the dashboard's Webhooks page, and
`npx helpwell prompt webhooks` prints it. It holds no secrets.

<!-- generated:prompt:webhooks (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up a webhook receiver for HelpWell in my app. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

An HTTPS endpoint in my app that accepts HelpWell webhook deliveries, rejects any whose signature does not verify, handles each event type, and answers 2xx within five seconds.

## What you need to know

- HelpWell sends one JSON POST per event: { "event": "<name>", "at": "<ISO time>", "data": { ... } }.
- Headers: x-helpwell-event (the event name), x-helpwell-delivery (a unique id; the same id is reused when a delivery is retried), x-helpwell-attempt (1 to 5), and x-helpwell-signature when a secret is set.
- x-helpwell-signature is "sha256=" followed by the hex HMAC-SHA256 of the exact raw request body, keyed with the webhook secret. Verify it over the raw bytes, before parsing JSON, with a constant-time comparison.
- A response that is not 2xx within five seconds counts as a failure. HelpWell retries up to five attempts in all, after 1, 4, 16 and 64 minutes.
- HelpWell only sends to a public https address: when it sends, it refuses http, localhost and private network addresses, and it never follows a redirect. To try the endpoint on my own machine, use a public https tunnel to it, or run HelpWell locally with HELPWELL_WEBHOOK_GUARD=off (for development only, never in production).
- In a Node or TypeScript app, `verifySignature(secret, rawBody, header)` from @helpwell/core does the check.

## Steps

1. Add a POST route for the webhook. Read the body as raw text; do not let a body parser consume it first.
2. Read the secret from the environment variable HELPWELL_WEBHOOK_SECRET. Tell me to paste the secret into my environment (for example .env.local, or my host's environment settings) myself; do not ask me for it.
3. Verify x-helpwell-signature against the raw body. Answer 401 and stop if it is missing or wrong.
4. Parse the JSON and switch on the event name. Handle the events in the table below that matter to me, and answer 200 to every other event, including webhook.test.
5. Make handling idempotent: store the x-helpwell-delivery id and ignore a delivery you have already processed.
6. Answer 200 as soon as the event is stored. Do slow work (emails, API calls) after responding or in a background job.
7. Add the endpoint URL to the "webhooks" list in helpwell/helpwell.config.json with the events it wants (an empty list means all of them), then run `npx helpwell sync`. Tell me to paste the same secret into that entry's "secret" field myself.
8. Send a test: the "Send test delivery" button on the Webhooks page of the HelpWell dashboard, or `npx helpwell webhooks test`.

## Exact values

### Events HelpWell sends

| event | when | example data |
| --- | --- | --- |
| conversation.created | A visitor started a new conversation. | {"conversationId":"cnv_m3k9f2a1x8qw4t","contactId":"con_m3k9e7b2p1zz0c","pageUrl":"/billing"} |
| conversation.unresolved | The agent could not answer from the docs. | {"conversationId":"cnv_m3k9f2a1x8qw4t","messageId":"msg_m3k9f2a2c1d2e3","question":"Can I get a refund for last month?","contactId":"con_m3k9e7b2p1zz0c"} |
| message.created | A message was added to a conversation, by the visitor or the agent. | {"id":"msg_m3k9f2a2c1d2e3","conversationId":"cnv_m3k9f2a1x8qw4t","role":"agent","body":"Open Billing, then Invoices, and choose Export.","unresolved":false,"contactId":"con_m3k9e7b2p1zz0c"} |
| feedback.created | Someone rated an answer, a conversation or an article (`kind` says which). | {"kind":"message","messageId":"msg_m3k9f2a2c1d2e3","conversationId":"cnv_m3k9f2a1x8qw4t","value":"helpful","comment":null,"contactId":"con_m3k9e7b2p1zz0c"} |
| gap.created | A question the docs do not answer was logged for the first time. | {"id":"gap_m3k9f3aa01bb02","question":"Do you support SAML single sign-on?","conversationId":"cnv_m3k9f2a1x8qw4t"} |
| roadmap.idea | Someone suggested a roadmap idea. | {"id":"rmp_m3k9f4cc03dd04","title":"Bulk export","body":null,"contactId":"con_m3k9e7b2p1zz0c"} |
| survey.response | Someone answered a survey question. A multi-question survey sends one per answer, with the same `sessionId`. | {"id":"srv_m3k9f5ee05ff06","surveyId":"nps-q3","sessionId":"m3k9f5a1x7qk2v9d0e","questionId":"q1","kind":"nps","score":9,"choice":null,"choices":null,"comment":"Fast answers.","contactId":"con_m3k9e7b2p1zz0c"} |
| changelog.published | A changelog entry was published. | {"id":"chg_m3k9f6gg07hh08","version":"v2.14.0","title":"Dark mode everywhere","summary":"The dashboard and the widget follow your system theme.","tags":["new"],"publishedAt":"2026-09-22T10:00:00.000Z"} |
| article.published | An article went live in the help center after a sync. | {"slug":"billing/exporting-invoices","title":"Exporting invoices","collection":"billing","description":"Download a PDF of any invoice."} |
| form.submitted | Someone submitted a form and it was accepted. `trusted` says whether it passed every anti-abuse check. | {"id":"fsb_m3k9f7ii09jj10","formId":"newsletter","formName":"Newsletter","formType":"newsletter","formVersion":3,"variant":"a","placement":"inline","submittedAt":"2026-09-22T10:05:00.000Z","contactId":"con_m3k9e7b2p1zz0c","email":"ada@example.com","name":"Ada","fields":{"email":"ada@example.com","first_name":"Ada","consent":true},"attributes":{"first_name":"Ada"},"consent":{"state":"granted","text":"Email me the monthly update."},"trusted":true,"verdict":{"turnstile":"off","honeypot":false,"fillMs":8420,"tooFast":false,"rateLimited":false,"disposable":false,"blockedDomain":false,"blockedIp":false,"mx":"ok","duplicate":false,"trusted":true,"reasons":[]},"page":{"url":"https://acme.example/blog/launch","path":"/blog/launch"},"referrer":"https://news.example/","utm":{"source":"newsletter","campaign":"launch"},"giveaway":null} |
| giveaway.entered | Someone entered a giveaway for the first time. | {"entryId":"gve_m3k9f8kk11ll12","formId":"giveaway","submissionId":"fsb_m3k9f7ii09jj10","contactId":"con_m3k9e7b2p1zz0c","email":"ada@example.com","entries":1,"referralCode":"k7qmw2xa","referredBy":"gve_m3k9f8aa01bb02","trusted":true} |
| webhook.test | Only when someone sends a test delivery. | {"message":"This is a test delivery from HelpWell."} |

The same values as JSON:

```json
[
  {
    "event": "conversation.created",
    "when": "A visitor started a new conversation.",
    "example data": "{\"conversationId\":\"cnv_m3k9f2a1x8qw4t\",\"contactId\":\"con_m3k9e7b2p1zz0c\",\"pageUrl\":\"/billing\"}"
  },
  {
    "event": "conversation.unresolved",
    "when": "The agent could not answer from the docs.",
    "example data": "{\"conversationId\":\"cnv_m3k9f2a1x8qw4t\",\"messageId\":\"msg_m3k9f2a2c1d2e3\",\"question\":\"Can I get a refund for last month?\",\"contactId\":\"con_m3k9e7b2p1zz0c\"}"
  },
  {
    "event": "message.created",
    "when": "A message was added to a conversation, by the visitor or the agent.",
    "example data": "{\"id\":\"msg_m3k9f2a2c1d2e3\",\"conversationId\":\"cnv_m3k9f2a1x8qw4t\",\"role\":\"agent\",\"body\":\"Open Billing, then Invoices, and choose Export.\",\"unresolved\":false,\"contactId\":\"con_m3k9e7b2p1zz0c\"}"
  },
  {
    "event": "feedback.created",
    "when": "Someone rated an answer, a conversation or an article (`kind` says which).",
    "example data": "{\"kind\":\"message\",\"messageId\":\"msg_m3k9f2a2c1d2e3\",\"conversationId\":\"cnv_m3k9f2a1x8qw4t\",\"value\":\"helpful\",\"comment\":null,\"contactId\":\"con_m3k9e7b2p1zz0c\"}"
  },
  {
    "event": "gap.created",
    "when": "A question the docs do not answer was logged for the first time.",
    "example data": "{\"id\":\"gap_m3k9f3aa01bb02\",\"question\":\"Do you support SAML single sign-on?\",\"conversationId\":\"cnv_m3k9f2a1x8qw4t\"}"
  },
  {
    "event": "roadmap.idea",
    "when": "Someone suggested a roadmap idea.",
    "example data": "{\"id\":\"rmp_m3k9f4cc03dd04\",\"title\":\"Bulk export\",\"body\":null,\"contactId\":\"con_m3k9e7b2p1zz0c\"}"
  },
  {
    "event": "survey.response",
    "when": "Someone answered a survey question. A multi-question survey sends one per answer, with the same `sessionId`.",
    "example data": "{\"id\":\"srv_m3k9f5ee05ff06\",\"surveyId\":\"nps-q3\",\"sessionId\":\"m3k9f5a1x7qk2v9d0e\",\"questionId\":\"q1\",\"kind\":\"nps\",\"score\":9,\"choice\":null,\"choices\":null,\"comment\":\"Fast answers.\",\"contactId\":\"con_m3k9e7b2p1zz0c\"}"
  },
  {
    "event": "changelog.published",
    "when": "A changelog entry was published.",
    "example data": "{\"id\":\"chg_m3k9f6gg07hh08\",\"version\":\"v2.14.0\",\"title\":\"Dark mode everywhere\",\"summary\":\"The dashboard and the widget follow your system theme.\",\"tags\":[\"new\"],\"publishedAt\":\"2026-09-22T10:00:00.000Z\"}"
  },
  {
    "event": "article.published",
    "when": "An article went live in the help center after a sync.",
    "example data": "{\"slug\":\"billing/exporting-invoices\",\"title\":\"Exporting invoices\",\"collection\":\"billing\",\"description\":\"Download a PDF of any invoice.\"}"
  },
  {
    "event": "form.submitted",
    "when": "Someone submitted a form and it was accepted. `trusted` says whether it passed every anti-abuse check.",
    "example data": "{\"id\":\"fsb_m3k9f7ii09jj10\",\"formId\":\"newsletter\",\"formName\":\"Newsletter\",\"formType\":\"newsletter\",\"formVersion\":3,\"variant\":\"a\",\"placement\":\"inline\",\"submittedAt\":\"2026-09-22T10:05:00.000Z\",\"contactId\":\"con_m3k9e7b2p1zz0c\",\"email\":\"ada@example.com\",\"name\":\"Ada\",\"fields\":{\"email\":\"ada@example.com\",\"first_name\":\"Ada\",\"consent\":true},\"attributes\":{\"first_name\":\"Ada\"},\"consent\":{\"state\":\"granted\",\"text\":\"Email me the monthly update.\"},\"trusted\":true,\"verdict\":{\"turnstile\":\"off\",\"honeypot\":false,\"fillMs\":8420,\"tooFast\":false,\"rateLimited\":false,\"disposable\":false,\"blockedDomain\":false,\"blockedIp\":false,\"mx\":\"ok\",\"duplicate\":false,\"trusted\":true,\"reasons\":[]},\"page\":{\"url\":\"https://acme.example/blog/launch\",\"path\":\"/blog/launch\"},\"referrer\":\"https://news.example/\",\"utm\":{\"source\":\"newsletter\",\"campaign\":\"launch\"},\"giveaway\":null}"
  },
  {
    "event": "giveaway.entered",
    "when": "Someone entered a giveaway for the first time.",
    "example data": "{\"entryId\":\"gve_m3k9f8kk11ll12\",\"formId\":\"giveaway\",\"submissionId\":\"fsb_m3k9f7ii09jj10\",\"contactId\":\"con_m3k9e7b2p1zz0c\",\"email\":\"ada@example.com\",\"entries\":1,\"referralCode\":\"k7qmw2xa\",\"referredBy\":\"gve_m3k9f8aa01bb02\",\"trusted\":true}"
  },
  {
    "event": "webhook.test",
    "when": "Only when someone sends a test delivery.",
    "example data": "{\"message\":\"This is a test delivery from HelpWell.\"}"
  }
]
```

## Use exactly as written

The signature check, in TypeScript (Next.js route handler shown):

```ts
import { verifySignature } from '@helpwell/core';

export async function POST(request: Request) {
  const body = await request.text();
  const ok = await verifySignature(
    process.env.HELPWELL_WEBHOOK_SECRET ?? '',
    body,
    request.headers.get('x-helpwell-signature'),
  );
  if (!ok) return new Response('bad signature', { status: 401 });

  const { event, data } = JSON.parse(body) as { event: string; data: Record<string, unknown> };
  const delivery = request.headers.get('x-helpwell-delivery');
  // if (await alreadyHandled(delivery)) return new Response('ok');
  switch (event) {
    case 'conversation.unresolved':
      // data.question is what the docs could not answer
      break;
    default:
      break;
  }
  return new Response('ok');
}
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never log the webhook secret or the signature header.
- Do not disable the signature check, even temporarily for testing.

## Check your work

1. A test delivery shows "Delivered" under Recent deliveries on the dashboard's Webhooks page.
2. A request with a wrong x-helpwell-signature gets 401.
3. Sending the same delivery twice is handled once.

## When you are done

Tell me the endpoint path, the events it handles, where the secret is read from, and the result of the test delivery.
````
<!-- /generated:prompt:webhooks -->

</details>

### Environment

```bash
OPENROUTER_API_KEY=sk-or-...        # the only key HelpWell needs; search-only answers without it
HELPWELL_DATABASE_URL=postgres://   # optional; embedded Postgres under helpwell/data if unset
HELPWELL_IDENTITY_SECRET=...        # for signed identify tokens
```

| Variable | Read by | What it is |
|---|---|---|
| `OPENROUTER_API_KEY` | the API, dashboard, CLI and MCP server | Your OpenRouter key. The only key HelpWell needs. |
| `HELPWELL_DATABASE_URL` | `createDb`, the CLI and the MCP server | A Postgres URL (install `postgres` too). Unset, an embedded Postgres under `helpwell/data`. |
| `HELPWELL_IDENTITY_SECRET` | the API | The shared secret identify tokens are signed with. |
| `HELPWELL_TURNSTILE_SECRET` | the API | The Cloudflare Turnstile secret, when the bot check is on. Config only; the site key is a setting. |
| `HELPWELL_ADMIN_TOKEN` | your mount code, as `adminToken` (and the `isAdmin` that `init` prints) | The admin token, at least 32 characters: entered on the dashboard's sign-in page, or sent as a bearer token by scripts and CI. |
| `HELPWELL_SUPPORT_URL`, `HELPWELL_SUPPORT_PRODUCT`, `HELPWELL_SUPPORT_TOKEN` | the API and help center | A remote [support extension](#support-extensions). All three, or none. |
| `HELPWELL_WEBHOOK_GUARD=off` | the API and dashboard | Development only: lets webhooks reach `http://` and `localhost`, which the guard refuses. Never in production. |
| `HELPWELL_PROJECT_DIR` | the MCP server | The repo root, when the MCP client starts somewhere else. |
| `GITHUB_TOKEN` | `helpwell changelog` and `init` | Optional. Reads GitHub releases with a higher rate limit, and private repos. |
| `INTERCOM_TOKEN`, `ZENDESK_API_TOKEN`, `HELPSCOUT_DOCS_API_KEY`, `FRESHDESK_API_KEY`, `DOCUMENT360_API_TOKEN`, `CRISP_IDENTIFIER`, `CRISP_KEY` | `helpwell import` | The platform you are importing from. Read, never stored. |
| `HELPWELL_DEBUG` | the CLI | Prints the stack trace when a command fails, like `--verbose`. |

Capture sign-in fields name their own variables in the config
(`HELPWELL_CAPTURE_EMAIL` and `HELPWELL_CAPTURE_PASSWORD` in the examples);
a webhook receiver you write reads its own secret, such as
`HELPWELL_WEBHOOK_SECRET`.

HelpWell reads `HELPWELL_DATABASE_URL` and nothing else. Your app's
`DATABASE_URL` is deliberately ignored, so support data can only land in a
database you pointed it at. Setting the two to the same value is the intended
production setup: one `helpwell` schema alongside your own tables.

### A widget on another site

When the widget runs on a different site from the API (the API on
`app.acme.com`, the widget on `www.acme.com`), list that site in
`corsOrigins`, or the browser refuses every call:

```ts
createHelpWellHandler({ db, corsOrigins: ['https://www.acme.com'] });
```

On `www.acme.com`, load the loader from the API's full address. It takes the
host from there, so the tag needs nothing else:

```html
<script src="https://app.acme.com/api/helpwell/assets/loader.js" defer></script>
```

Browsers such as Safari then block the API's visitor cookie across sites, so
the widget carries the visitor in an `X-HelpWell-Visitor` header instead. The
API signs it with a key it keeps in its own database, and reads it only when
no valid cookie arrives; identify still decides who someone is.

Images come from the API as absolute URLs, so a screenshot in an article, an
answer, a Home card, a changelog entry, an engagement or a form loads on
`www.acme.com` as well.
They are built from the request's own address. Behind a proxy that changes
the host, set `publicUrl` to the address browsers use:

```ts
createHelpWellHandler({ db, publicUrl: 'https://app.acme.com/api/helpwell' });
```

Nothing else changes. The details are under
[Running many installs](#running-many-installs-in-one-process).

### Support extensions

HelpWell answers visitors with its AI. It has no inbox, no human replies and
no email of its own. A **support extension** is how human support plugs in:
something that takes over a conversation when a visitor asks for a person,
mirrors every conversation so a team can see it, and shows the team's replies
in the widget.

- **In process**: an object implementing `SupportExtension` from
  `@helpwell/core/api`, passed as `createHelpWellHandler({ support })`.
- **Remote**: any service that implements the HTTP protocol in
  [docs/support-extension.md](docs/support-extension.md). Set
  `HELPWELL_SUPPORT_URL`, `HELPWELL_SUPPORT_PRODUCT` and
  `HELPWELL_SUPPORT_TOKEN` on the server, or run `npx helpwell link --url …
  --product …` (the token is never written to the config).

Either way HelpWell calls it through a fail-open layer: short timeouts, a
circuit breaker and a retry queue, so an extension that is down never breaks
the AI chat. A remote one that answers `429` is left alone for its
`Retry-After` (at most five minutes) and treated as down meanwhile. While one
is connected, the support email is not shown. Without
one, none of this exists and nothing in the UI mentions it.

<details>
<summary>Set this up with an AI assistant: connecting a remote support extension</summary>

`npx helpwell prompt link` and `helpwell link --prompt` print this with the URL
and product id you linked. It holds no token.

<!-- generated:prompt:link (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up the remote support extension for my app's HelpWell server. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

HelpWell hands conversations to the connected support service when a visitor asks for a person, mirrors every conversation to it, and shows its replies in the widget. If the service is ever unreachable, the AI keeps answering as before.

## What you need to know

- HelpWell is mounted at /api/helpwell with createHelpWellHandler from @helpwell/core.
- When no `support` option is passed to createHelpWellHandler, it connects using the three environment variables HELPWELL_SUPPORT_URL, HELPWELL_SUPPORT_PRODUCT and HELPWELL_SUPPORT_TOKEN. All three must be set.
- The token is a secret. I set HELPWELL_SUPPORT_TOKEN myself, on the server only.
- The connection fails open: short timeouts, and a circuit breaker that skips the service for a minute after three failures, so it can never break the widget.

## Steps

1. Find where the server's environment variables are set (a .env file, the hosting provider's settings, or the deployment config).
2. Set HELPWELL_SUPPORT_URL and HELPWELL_SUPPORT_PRODUCT to the values below.
3. Tell me where to paste the token as HELPWELL_SUPPORT_TOKEN. Do not ask me for it.
4. Check that createHelpWellHandler is not already passed a `support` option. If it is, stop and ask me.
5. Restart or redeploy the server.
6. Run the connection check below on the server, where the token is set.

## Exact values

### Server environment variables

| Variable | Value |
| --- | --- |
| HELPWELL_SUPPORT_URL | https://YOUR-SERVICE.example.com/api |
| HELPWELL_SUPPORT_PRODUCT | YOUR-PRODUCT-ID |
| HELPWELL_SUPPORT_TOKEN | — |

The same values as JSON:

```json
[
  {
    "Variable": "HELPWELL_SUPPORT_URL",
    "Value": "https://YOUR-SERVICE.example.com/api"
  },
  {
    "Variable": "HELPWELL_SUPPORT_PRODUCT",
    "Value": "YOUR-PRODUCT-ID"
  },
  {
    "Variable": "HELPWELL_SUPPORT_TOKEN",
    "Value": null
  }
]
```

## Use exactly as written

Connection check. It prints 200; 401 means the token is wrong or was replaced, 404 that the URL or product id is wrong:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://YOUR-SERVICE.example.com/api/bridge/YOUR-PRODUCT-ID/playbook" -H "Authorization: Bearer $HELPWELL_SUPPORT_TOKEN" -H "content-type: application/json" -d '{}'
```

Or, from the repo, with the token set in that shell:

```bash
npx helpwell link --status
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Keep HELPWELL_SUPPORT_TOKEN in the server environment only: never in browser code, the repository, helpwell.config.json or a log.
- Do not change or remove any other option passed to createHelpWellHandler.

## Check your work

1. The connection check prints 200.
2. GET /api/helpwell/config returns a "support" object with "human": true.
3. In the widget, ask a question and choose "Talk to a person": the conversation reaches the support service.

## When you are done

Tell me what you changed, what you could not do, and anything I still need to do myself.
````
<!-- /generated:prompt:link -->

</details>

### Security headers

Every response from the API, the help center and the dashboard carries
`X-Content-Type-Options: nosniff` and a referrer policy
(`strict-origin-when-cross-origin`; `same-origin` on the dashboard). The help
center's pages also send a Content-Security-Policy that frames only the video
players articles embed (`contentSecurityPolicy` replaces it). The dashboard
sends `frame-ancestors 'self'`, so only pages on its own origin may frame it,
and `script-src 'self'`: it has no inline scripts or `on*=` handlers, and
loads its scripts from its own `<basePath>/_assets/`. A host that frames it
under a policy of its own needs only `'self'` for scripts, never
`'unsafe-inline'`.

Each surface takes `securityHeaders`: a string replaces one header, `null`
drops it, and `false` sends none, for a host that sets them at its proxy. A
host that shows the dashboard inside its own app on another origin lists that
origin:

```ts
createDashboard({ db, isAdmin, frameAncestors: ["'self'", 'https://app.acme.com'] });
createHelpWellHandler({ db, securityHeaders: { 'referrer-policy': 'no-referrer' } });
createHelpCenter({ db, securityHeaders: false }); // your proxy sets them
```

### Running many installs in one process

A service that hosts HelpWell for many products runs one install per product,
each with its own database, side by side in one process. A single install
needs none of this; every option below is off unless you pass it.

```ts
import { createHelpWellHandler } from '@helpwell/core';
import { migrate } from '@helpwell/core/db';
import { syncContent } from '@helpwell/core/search';
import { createDashboard } from '@helpwell/dashboard';
import { createHelpCenter } from '@helpwell/helpcenter';

const base = `/i/${install.id}`;
const content = contentFor(install); // your ContentSource over wherever you keep files
const modelFactory = (purpose) => modelFor(install, purpose); // a ModelPort, or null

await migrate(db); // safe when several processes boot at once

const api = createHelpWellHandler({
  db, basePath: `${base}/api`, content, modelFactory,
  env: {},            // never fall back to your own process environment
  cookiePath: base,   // this install's visitor cookie stays under its own prefix
  corsOrigins: install.siteOrigins, // the customer's site, when the widget calls across sites
  publicUrl: `https://hosted.example${base}/api`, // images in widget content, absolute
  identitySecret: install.identitySecret,
  turnstile: { secret: install.turnstileSecret }, // the bot check's secret, per install
  webhookFetch: egressFetch,         // optional: your own guard for every webhook send
});
const help = createHelpCenter({
  db, basePath: `${base}/help`, apiPath: `${base}/api`, content,
  publicUrl: 'https://help.acme.com', // canonical, sitemap, feed and llms.txt links
});
const dashboard = createDashboard({
  db, basePath: `${base}/admin`, apiPath: `${base}/api`, content, modelFactory, env: {},
  embedded: true,                        // no rail or shell: your navigation wraps it
  pages: ['conversations', 'knowledge', 'settings'], // only these exist
  accent: '#0F766E',
  contentMode: 'managed',                // no repo behind it: no "run helpwell sync"
  webhookFetch: egressFetch,             // the same as the API's
  isAdmin,
});

// After content changes: what `helpwell sync` does, from the source.
await syncContent(db, content, {
  media: { apiPath: `${base}/api` },
  model: modelFactory('embeddings') ?? undefined,
  embeddingModel: settings.agent.models.embeddings,
});
```

- **`ContentSource`** (`@helpwell/core/content`) is `list(prefix?)`, `read`,
  `readText`, `stat`, and optionally `write`, `remove` and
  `stream(path, { start, end }?)`, over paths like `billing/invoices.md` and
  `_screenshots/export.png`. The API and the help center serve images and
  videos from it, streaming just the requested bytes when the source has
  `stream` (give it one if you keep videos: without it each response reads
  the whole file into memory), and the editor saves into it when there is no
  `writeArticle` hook. `createFileContentSource` (which streams) and
  `createMemoryContentSource` are the two that ship. The redirect map is a
  file in it too, `_redirects.json`, which the help center reads through it.
- **`AssetStore`** (`@helpwell/core/content`) is where uploaded images go:
  the editor's, the importer's and `POST /admin/assets`'s. Pass the same one
  as `assetStore` to `createHelpWellHandler` and `createDashboard`. It has one
  method, `put({ path, bytes, contentType })`, called with an image already
  checked (PNG, JPEG, GIF or WebP, 10 MB at most) and a path HelpWell chose,
  `_media/<hash>.<ext>`, to use as a key. Answer `{ url }` with the absolute
  address it is served at, and articles carry that URL; answer `{}` and the
  file is taken to be at that path in the content source, served at
  `<api>/media/_media/…` and `<help>/_media/_media/…`. Without one, uploads are
  written through a writable content source, which needs nothing more.
- **`pages`** can include `reports` and `webhooks`. Both work embedded: the
  Reports CSV comes from the dashboard, and the Webhooks page lists, tests and
  (with `contentMode: 'managed'`) adds webhooks, through `webhookFetch`.
- **`modelFactory(purpose)`** is asked for `chat`, `fallback`, `embeddings`,
  `docs` (drafting) and `grader` (evals). Returning null for a purpose behaves
  like a missing key: search-only answers, no retry, text search, no drafting.
  Model names still come from Settings.
- **`contentMode: 'managed'`** tells the dashboard there is no repo, config
  file or command line behind it: pages say an article is saved and goes live
  once indexed, instead of sending anyone to `helpwell sync`, a config file or
  the CLI. It also turns on what a repo does with files and commands instead:
  the Redirects screen, Import from another help center, and adding webhooks
  on the Webhooks page. The default, `'repo'`, is the self-hosted wording.
- **Settings are one view per database.** The API, the dashboard and the help
  center each keep a settings store, and every store on the same `db` handle
  shares one copy. Each read first checks the row's version (Postgres's
  `xmin`: one primary-key lookup), so a save through any of them, from
  another process on the same database, or by `helpwell sync` is what the
  very next request reads. Give each install its own `db`, and no copy is
  shared between two.
- **Secrets are per install.** The identity secret, the Turnstile secret
  (`turnstile.secret`), the OpenRouter key and the support token are read from
  the config you pass, then from that install's `env`, and never from your
  process environment once `env` is given. `HELPWELL_WEBHOOK_GUARD` is read
  from `env` too, so one install cannot switch the webhook guard off for
  another.
- **`webhookFetch`** carries every webhook the install sends: from the API's
  routes, the agent and the indexer, retries and test deliveries, and (passed
  to `createDashboard` too) what the dashboard sends. Without it, the built-in
  guard refuses anything but a public https address when it connects.
- **A widget on another site.** When the API is on your domain and the page
  on the customer's, browsers such as Safari block the visitor cookie. The
  widget notices the API is on another origin and carries the visitor in an
  `X-HelpWell-Visitor` header instead: the API answers each call with a
  signed token (signed with a key the install keeps in its own database),
  the widget keeps it in `localStorage` per API address and sends it back.
  The API accepts it only when no cookie arrives, checks it exactly as it
  checks the cookie, and issues it for whoever the visitor is after the call,
  so identify still decides who someone is. It hands a token only to a
  caller on another origin, never to a script on its own. List the site in
  `corsOrigins` so the browser may send and read the header; a same-site
  install keeps using the cookie alone.
- **`logger`** (`{ warn(message, detail?) }`) takes the support extension's
  warnings for one install: a half-set `HELPWELL_SUPPORT_*` environment, a
  failing or refused call, a retry given up on. It defaults to the console;
  pass each install its own so a warning says where it came from.
- **Nothing is shared between installs.** Settings, rate limits,
  conversations and content live in each install's database; caches belong to
  the handler that made them; a status page read through your own
  `fetchStatusPage` is never shown to another install.

---

## Docs

- [docs/engage.md](docs/engage.md): modals, banners, hotspots, tours and
  surveys: the format, targeting, triggers and results.
- [docs/forms.md](docs/forms.md): forms, embeds, the anti-abuse verdict,
  giveaways and A/B tests.
- [docs/support-extension.md](docs/support-extension.md): plugging human
  support in, and the remote protocol.
- [docs/PRD.md](docs/PRD.md): the requirements, and the status of each one.
- The `docs/README.md` that `helpwell init` writes: how articles, collections,
  blocks and screenshots work.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

---

## Try it

```bash
git clone https://github.com/ChainAI-Org/helpwell
cd helpwell
pnpm install
pnpm build
pnpm --filter @helpwell/playground dev
```

`examples/playground` is a small fake SaaS product with HelpWell fully
installed and seeded with realistic content. Visit `/` for the product with the
widget on it, `/help` for the help center, and `/admin/helpwell` for the
dashboard. It runs without an API key.

---

## What is not here

HelpWell open source is the whole product for a team that wants an agent, a
help center and a changelog in their own stack. Some things are deliberately
absent:

- **No human inbox, and no handoff of its own.** Conversations is a review
  log. When the agent cannot help it says so, records the gap, and the
  missing article is yours to write. Nobody is paged and nothing pretends a
  person is waiting. Set a support email in Settings and the widget offers it
  under that answer and on Home, and the help center as "Contact support":
  people write from their own mail client, and you answer from yours. Human
  support is a [support extension](#support-extensions) you add.
- **No email.** HelpWell sends none at all: no transport, no queue, no
  templates. It collects an address when someone offers one. Notifications
  are in-app.
- **No confidence thresholds or escalation rules to tune.** Every answer has a
  confidence score you can read in the conversation; the threshold is built
  in.
- **No accounts.** Your app decides who is an admin.
- **No telemetry.** HelpWell never phones home. Nothing leaves your server
  except the calls you set up: the model provider, your webhooks, your status
  page, Cloudflare when the bot check is on, a support extension when you
  connect one, a DNS lookup of a form address's domain, and GitHub when
  `helpwell changelog` reads your releases.

---

## Development

```bash
pnpm install
pnpm build          # every package
pnpm test           # every package's tests
pnpm typecheck
pnpm lint
pnpm readme         # rewrite the generated parts of this README and the docs
pnpm screenshots    # regenerate every image in this README
```

The webhook table and the setup prompts in this README and in `docs/` are
generated from the code, between `<!-- generated:… -->` markers. Edit the
code, then run `pnpm build && pnpm readme`; a test fails while any of them is
out of date.

Tests run against real Postgres via PGlite, not mocks, so migrations,
generated columns and full-text search are exercised exactly as they will be in
production. No test reaches the network.

---

## HelpWell Cloud

Open-source HelpWell is the AI side of support. When you want people on the
other side of the conversation too, and email that reaches customers after
they leave, [HelpWell Cloud](https://helpwell.ai) is the same product, hosted,
with a team inbox, live chat, email marketing, automations and contact
enrichment built in.

<img src="docs/media/cloud-live-chat.gif" alt="HelpWell Cloud: a visitor asks the widget a question, the AI answers from the docs, and the visitor leaves an email so the team can reply later" width="100%">

| | |
|:--|:--|
| <img src="docs/media/cloud-inbox.png" alt="The HelpWell Cloud team inbox: a customer conversation with the AI's answer, a teammate's reply and the customer's details" width="100%"> | **Live agent support**<br><br>A shared inbox for your team. People pick up where the AI stopped, in the same conversation, with internal notes, mentions, assignment and saved replies. Replies the visitor misses go out by email, and email replies come back to the same thread. Slack alerts, and replies from Slack. |
| <img src="docs/media/cloud-newsletter.gif" alt="Writing a newsletter in HelpWell Cloud: a one-line brief, three drafts written from the changelog and help center, then the editor" width="100%"> | **Email marketing**<br><br>On the Growth plan: newsletters written with AI from your changelog and help center, a block editor, your brand kit, subject-line tests, scheduling and reports. Forms with double opt-in, contacts and segments. Sent through your own Resend account. |
| <img src="docs/media/cloud-journey.gif" alt="Building an automation in HelpWell Cloud: starting from the recover a failed payment recipe and editing the journey" width="100%"> | **Automations**<br><br>Journeys that react to what customers do: emails, in-app messages, waits, conditions and splits, started from recipes like onboarding, trial ending and failed payment. |
| <img src="docs/media/cloud-enrichment.png" alt="Enrichment settings in HelpWell Cloud: the latest signup with job title, seniority, company, size, industry and LinkedIn filled in by LeadFuze, and an ICP score" width="100%"> | **Contact enrichment**<br><br>On the Growth plan, know who your users are. When someone signs up through a HelpWell form and confirms their email, Cloud looks them up once in LeadFuze and saves their job title, seniority, department, LinkedIn, location and company details (name, size, industry, revenue and country) on the contact. An ICP score ranks each signup, so you can segment, start journeys and get a Slack alert for strong ones. |

Cloud also hosts your help center on your own domain, keeps your docs current
from GitHub, and adds team reports. Your AI still runs on your own OpenRouter
key, so there is no per-answer charge. Plans and prices are at
[helpwell.ai/pricing](https://helpwell.ai/pricing).

Already self-hosting? Cloud is a [support extension](#support-extensions):
connect your install with `npx helpwell link`, and the AI keeps answering even
if Cloud is unreachable.

Your AI assistant comes too. Cloud has a hosted MCP server at
`https://app.helpwell.ai/mcp`, so Claude, ChatGPT, Codex, Cursor or any MCP
app can work the inbox, contacts, journeys and newsletters for you, with
nothing to install. [Switching your MCP server to Cloud](packages/mcp/README.md#using-helpwell-cloud)
takes three steps.

---

## An open-source alternative to

HelpWell covers the AI-support side of these tools: an autonomous agent that
answers from a knowledge base it keeps current itself, a help center, a chat widget, in-app messages, tours, surveys, a
roadmap and a changelog.

- **Help desks and live chat:** Intercom, Zendesk, Help Scout, Freshdesk,
  Freshchat, Crisp, Front, Tidio, Drift, LiveChat, tawk.to, Olark, Zoho Desk,
  HubSpot Service Hub, Kustomer, Gorgias, Re:amaze and Kayako.
- **AI support agents:** Intercom Fin, Ada, Decagon and Sierra.
- **Help centers and docs:** Document360, HelpDocs, GitBook and Mintlify.
- **Roadmaps and changelogs:** Canny, Featurebase and Beamer.
- **Product tours and surveys:** Appcues, Userpilot, Pendo, Chameleon and
  Delighted.
- **Open-source help desks:** Chatwoot and Zammad.

The open-source build has no human inbox and sends no email. A person answering
in the same conversation plugs in through a
[support extension](#support-extensions).

---

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0](LICENSE), the GNU
Affero General Public License v3.0.

You can run it, change it and ship it inside your own product. If you offer a
modified HelpWell to others over a network, the AGPL asks you to share those
changes under the same terms.

Bug reports and feature requests are welcome as issues. Pull requests from
outside the project are not accepted yet; [CONTRIBUTING.md](CONTRIBUTING.md)
explains why and how to help.

The fonts HelpWell serves, [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans)
and [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), are
© their authors and licensed under the [SIL Open Font License 1.1](https://openfontlicense.org).
They come from the `@fontsource-variable` packages, whose licence files ship
with them.
