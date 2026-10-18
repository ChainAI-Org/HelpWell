# Ridgeline — HelpWell installed end to end

**Ridgeline** is a fictional expense-tracking SaaS. It exists so that HelpWell
has a realistic product to be installed into: a Next.js 15 app with a few
ordinary pages, a fake sign-in, and HelpWell mounted at three routes with a
script tag in the layout.

Nothing in `packages/` was changed to make this work. Everything under `app/`
and `lib/` is the kind of code a customer writes once and then forgets about.

## Run it

```bash
pnpm install
pnpm build                                   # the packages, including the widget
pnpm --filter @helpwell/playground dev
```

Then open <http://localhost:3000>.

No environment variables are needed. The API serves the widget itself, so
nothing is copied into `public/`; the database is PGlite (Postgres compiled to WASM, in memory, gone
when you stop the server), and without an `OPENROUTER_API_KEY` the agent answers
from a short script instead of a model — see
[Running with no API key](#running-with-no-api-key). Copy `.env.example` to
`.env.local` if you want to change any of that.

## Where to look

### `/` — the product

An ordinary expense dashboard. The only HelpWell code on the page is one script
tag in `app/layout.tsx`; the `data-tour` attributes on the table are anchors for
a product tour defined in settings.

- **The bubble in the corner** is the whole browser-side install. Ask it about
  receipts, approvals, per diem or SSO. The answers are grounded in the Markdown
  in `helpwell/docs/` and every answer carries citations back to it.
- **Ask it something the docs do not cover** ("can I import three years of
  history from Expensify?") and watch it decline to guess, mark the conversation
  unresolved, and log a gap.
- **Ask for a person** ("can someone from your team get back to me?") while
  signed out, and the agent calls its `collect_email` tool: the email card
  appears under its answer with the reason it gave, and the address you leave
  is saved to your contact. Ask again and it says the team already has it.
- **A tour** fires about a second after the page settles, on this path only.
  Signed in, stay a little longer and a short greeting says hello by your
  first name (`{{first_name|there}}` in the message), after the tour.
- **The widget's Home tab** shows every kind of Home block: search, your
  conversation, popular articles, a giveaway form, what's new, the status line,
  links and a card. All of it is `widget.home.blocks` in settings.
- **"Sign in as Ada"** in the header mints a signed identify token server-side
  and hands it to the widget as `data-token`. Reload and the widget knows who
  she is, her past conversations come back, and the dashboard shows her by name
  with her plan and seat count. "Sign out" puts you back to anonymous.

### `/help` — the help center

Server-rendered by `createHelpCenter`, mounted as a single route handler in
`app/help/[[...slug]]/route.ts`. Four collections, twelve articles, all of them
Markdown files in this repo.

Worth trying: the **search** box (including a query that finds nothing, which is
where gaps come from), the **changelog** — note the draft entry that appears in
the dashboard but not here — the **roadmap** with its four lanes and real votes,
and the machine-readable `/help/llms.txt` and `/help/sitemap.xml`.

### `/admin/helpwell` — the dashboard

Returns **401** until you click **"Sign in as an admin"** in the header. That
link sets a cookie that stands in for your app's session, and anyone can set a
cookie, so `lib/admin.ts` trusts it only while nobody else can reach the
server: `pnpm dev` listens on 127.0.0.1 alone, and it is not a production
build. Anywhere else (`next start`, `next dev` on every interface, a deployed
demo) the playground uses the fail-closed check `helpwell init` prints: set
`HELPWELL_ADMIN_TOKEN` (32 characters or more, `openssl rand -hex 32`) and enter
it on the dashboard's sign-in page. The server log says which check is on. A
real app passes its own session check as `isAdmin` instead.

Once in: **Conversations** (five seeded, plus anything you say to the widget, at
the top, each answer with its confidence and why), **Contacts** with their
identify attributes, **Knowledge** listing the twelve articles from the repo
(edit one and Save writes the Markdown back into `helpwell/docs/`), **Gaps**
ranked by how often they were asked, **Changelog** and **Roadmap** (both
editable), **Engage** with a tour, a three-slide modal, a banner counting down to
the period close, an NPS survey and a personalised greeting, and their
results, **Forms** with the giveaway and its draw,
**Evals** replaying `helpwell/evals.json`, **Playbook** editing
`helpwell/instructions.md` and `helpwell/playbook.md` in this repo (a change
takes effect on the next answer), **Reports**, and **Settings**.

### `/settings` and `/pricing` — more of the product

`/settings` is where the NPS survey fires, eight seconds in or on the way
out, whichever comes first, for identified visitors only. `/pricing` carries
the engage banner with its countdown, opens a three-slide "what's new" modal
once (after three seconds, or as soon as you scroll into the plans), and embeds the giveaway form with a single
`<div data-helpwell-form="business-giveaway">`.

### `/checkout` — the page with no widget

Deliberately empty corner. The widget's display rules exclude this path, so the
loader still runs and the bundle still downloads, and then the widget declines
to mount. The banner is excluded here too. The rule is in
`widget.displayRules.exclude` in settings — seeded in `lib/seed.ts`, editable in
the dashboard.

## How it is wired

| File | What it does |
| --- | --- |
| `app/api/helpwell/[[...route]]/route.ts` | `createHelpWellHandler` — the JSON API the widget talks to |
| `app/help/[[...slug]]/route.ts` | `createHelpCenter` — the public help center |
| `app/admin/helpwell/[[...route]]/route.ts` | `createDashboard` — the admin UI |
| `app/layout.tsx` | The script tag, with `data-token` while signed in |
| `lib/helpwell.ts` | Database, migrations, seeding, the three handlers |
| `lib/admin.ts` | `isAdmin`: the demo cookie on a loopback dev server, the admin token anywhere else |
| `lib/config.ts` / `lib/paths.ts` | Where the docs live, who Ada is, where things are mounted |
| `lib/identity.ts` | `signIdentity` — minting the identify token |
| `lib/seed.ts` | The demo content. A real install has none of this |
| `lib/follow-up.ts` | With no API key, the one scripted question that calls a tool (`collect_email`) |
| `helpwell/docs/` | The knowledge base: four folders of Markdown |
| `helpwell/instructions.md` | What the agent is told about Ridgeline |
| `helpwell/playbook.md` | House rules, and what to say about the cases the docs miss |
| `helpwell/evals.json` | The questions the Evals page replays, the same file `helpwell eval` reads |

Each of the three mounts is a thin re-export of a `(Request) => Response`
function. There is no HelpWell-specific middleware, no client-side router
integration, and no build step beyond copying two files.

### The database

`createDb({ url })` then `migrate(db, dir)`, once per process, behind a promise
cached on `globalThis` so `next dev`'s module reloads do not throw the database
away mid-session. The default is `pglite://memory`; set `HELPWELL_DATABASE_URL`
to `pglite://./.helpwell/db` to keep it between restarts, or to a `postgres://`
URL to put HelpWell's `helpwell` schema inside a database you already run.

Seeding is idempotent — fixed ids and `onConflictDoNothing` — so it is safe
against a persistent database too. Settings are only written when the database
is genuinely empty, so anything you change in the dashboard survives a restart.

### Running with no API key

Without `OPENROUTER_API_KEY` the playground passes a scripted model built on
`@helpwell/core`'s `FakeModel`, and the footer says so. It answers the way a
real model is asked to: it quotes the sentence of the top search result closest
to the question, cites it, and says how sure it is, judged by how much of the
question search matched. So a covered question is answered and resolved with a
citation and a confidence score, and one the docs miss is marked unresolved and
logged as a gap. Only the *wording* is canned: search, citations, confidence,
conversation history, spend accounting and gap detection are all the real code
paths. Set the key and restart to get a real model.

One question is scripted to use a tool, because a model that only quotes the
docs never calls one. Asking for someone to get back to you ("can someone from
your team get back to me?", "can I talk to a person?") makes the script call
`collect_email` with a short reason, the way a real model following
`helpwell/playbook.md` would, then answer from what the tool said: a card to
leave an email on, or, when the address is already on file, that the team has
it. Either way the conversation is left unresolved for the team. The wording
and the matching are in `lib/follow-up.ts`; the tool, the card and the saved
address are the real code paths.

## Notes and rough edges

- `next.config.ts` marks the `@helpwell/*` packages external for the server
  build. Bundling them breaks two things: `@helpwell/core` loads its database
  driver through `await import(name)`, which webpack cannot resolve, and it
  locates its migration `.sql` files relative to its own module URL, which
  becomes a Next chunk path. `serverExternalPackages` alone is not enough in a
  pnpm workspace, because the packages resolve outside `node_modules`.
- Seeded ids start `<prefix>_0seed…`. The leading digit matters: HelpWell ids
  begin with a base36 millisecond timestamp and the dashboard orders by
  `id DESC`, so a digit sorts all the seeded rows below anything you create
  while the playground is running.
