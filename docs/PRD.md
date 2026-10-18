# HelpWell — Product Requirements

**Status:** Draft 2 · 23 September 2026. Rewritten against the code. Where the
first draft and the code disagreed, this document follows the code, and every
requirement says whether it is built.
**Licence:** HelpWell is made by Workado, LLC. Licensed under the GNU Affero
General Public License v3.0 only (`AGPL-3.0-only`). Outside pull requests are
not accepted yet; issues are.
**One line:** The agent-driven help desk that lives in your repo. Docs,
screenshots and a changelog drafted from your code, and an AI agent that
answers customers from those docs and nothing else.

---

## How to read this document

- Every requirement has an ID (`KB-04`) so designs, issues and pull requests
  can point at it. The IDs are the first draft's, so older references still
  resolve.
- **Status** is one of:
  - **Done**: built as described. A note says where the code does it
    differently from the first draft.
  - **Partial**: part of it is built. The note says what is missing.
  - **Dropped**: not built, and the note says why. *Rule* means it breaks a
    product rule (section 2). *Deferred* means it is not in this release.
    *Changed* means something else does the job, named in the note.
- "The agent" is HelpWell's customer-facing AI. Its default name is **Fern**,
  which appears in sample copy only; the name is a setting. "The coding agent"
  means Claude Code, Codex, Cursor and the like, working in the customer's
  repo.
- Paths are relative to `packages/`. The status of each row was checked
  against the source on 23 September 2026.

---

## 1. Positioning

| | |
|---|---|
| **Tagline** | Customer support your coding agent sets up. |
| **Who it's for** | Anyone with a product that has a repo: SaaS first. Not for businesses without a codebase. |
| **Why it wins** | Everything is agent- and CLI-driven, from drafting the docs to configuring the widget, and every setup step comes with a prompt for an AI assistant. It's the help desk a vibe-coded app installs on day one. |
| **Reference points** | Resend (email for developers), Postiz (open source), Trigger.dev (tasks in your repo). |

## 2. Product rules

These hold everywhere in the code, and a change that breaks one is a bug.

1. **No email.** HelpWell sends no email: it has no transport, no queue and no
   templates. It may collect an address (the pre-chat form, the agent's
   inline email card, a form) so a person can write back from their own mail
   client.
2. **No human inbox, no human replies, no handoff UI of its own.**
   Conversations is a review log of what the agent said. A human support
   service plugs in through the `SupportExtension` seam (section 4.11); with
   none connected, nothing in the product mentions human support.
3. **No confidence thresholds or escalation rules as settings.** Every answer
   gets an internal confidence score, shown read-only in the conversation
   review. The threshold (`CONFIDENCE_THRESHOLD = 0.5` in
   `core/src/agent/confidence.ts`) is built in.
4. **Bring your own key.** The AI runs on the customer's own OpenRouter key.
   Without one, the agent answers with the closest article and search still
   works.
5. **Code and data stay with the customer.** No account, no telemetry,
   nothing phoned home. The only outbound calls are ones the customer sets
   up: the model provider, their webhooks, their status page, Cloudflare
   Turnstile, a support extension, a DNS lookup of a form address's domain,
   GitHub when `helpwell changelog` reads releases, and the importers.
6. **Every setting is editable or explained.** Each setting in the schema has
   a control in the dashboard, or is listed as config only with a reason
   (`dashboard/src/config-only.ts`, enforced by
   `dashboard/test/settings-coverage.test.ts`). Secrets never have a control.
7. **Every setup step is agent-friendly.** Anything a person configures
   outside HelpWell has a prompt for an AI assistant, built with
   `formatSetupPrompt` (`core/src/setup-prompt.ts`): the goal, the context,
   numbered steps, exact values, rules that include never asking for a secret,
   checks the assistant can run, and what to report. The dashboard shows it
   beside the step, the docs print it, and `helpwell prompt <topic>` prints it
   in a terminal.
8. **The mark is the avatar.** The launcher and the agent's default avatar are
   the HelpWell mark itself, never inside a circle.
9. **Selected state is a fill.** Selected rows and cards use a lavender fill
   (`#F0EAFE`) with the title in `#6A2FD6`, never a left accent rail.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Runtime | A set of npm packages installed into the host app: `npx helpwell init`, then three `(Request) => Response` handlers mounted in the app. | One install, no separate server, works in any framework that speaks web Request and Response. |
| Where content lives | Files are canonical: articles in `docs/`, and `helpwell/helpwell.config.json`, `instructions.md`, `playbook.md` and `evals.json`. The database holds what customers generate: conversations, contacts, events, ratings, survey answers, form submissions. | Coding agents edit files, and changes go through pull requests. |
| AI | Bring your own OpenRouter key. A model per job: chat, docs (drafting and grading), embeddings, and a fallback. | No AI cost on our side and no per-resolution pricing. |
| Customer identity | A JWT the host's server signs with `HELPWELL_IDENTITY_SECRET` (HS256), passed to the widget. Attributes merge. An email address never merges or unlocks anything. | Works with any stack, and a browser can never claim to be someone else. |
| Human support | Not built in. The `SupportExtension` seam lets an in-process object or a remote service over HTTPS take over conversations, fail-open. | Keeps the open-source product complete on its own, with a generic way to add people. |
| Licence | AGPL-3.0-only, copyright Workado, LLC. Issues and feature requests only; the maintainers write all code, so no CLA is needed yet. | Code stays open, and Workado, LLC keeps sole ownership while contributions are closed. |
| UI | Light dashboard with brand purple `#7A3BEB`, a soft lavender ground and white cards; charcoal dark mode. Server-rendered HTML with small islands of vanilla JavaScript; no UI framework anywhere. | Nothing to conflict with the host app's own React or Vue. |
| Motion | Nothing appears instantly: fade and rise for pages, spring slides for notices, scale and fade for menus. `prefers-reduced-motion` drops to 120 ms fades. | Your requirement. |

---

## 4. What ships

### 4.1 Packages

| Package | What it is |
|---|---|
| `@helpwell/core` | Schema, migrations, settings, search, the agent, evals, forms, engage, webhooks, the HTTP API and the setup prompt specs. Subpath exports: `/db`, `/settings`, `/content`, `/search`, `/agent`, `/api`, `/repos`, `/setup-prompt`. |
| `@helpwell/widget` | The Shadow DOM widget and its loader; `@helpwell/widget/server` serves both from the API. |
| `@helpwell/helpcenter` | The public, server-rendered help centre. |
| `@helpwell/dashboard` | The admin UI. |
| `@helpwell/ui` | Server-rendered HTML primitives, the Markdown renderer and the fonts. |
| `@helpwell/tokens` | Design tokens, the skeleton loader CSS and the brand marks. |
| `@helpwell/sdk` | A typed client for the public and admin API. |
| `@helpwell/mcp` | An MCP server for coding agents (`helpwell-mcp`). |
| `helpwell` | The CLI. |

`examples/playground` is a fake SaaS product ("Ridgeline") on Next.js with
HelpWell installed end to end, runnable without an API key.

### 4.2 In the host repo

`helpwell init` writes:

```
helpwell/
  helpwell.config.json   every setting, plus docs, screenshots, appUrl, apiPath, support
  instructions.md        the agent's system prompt, with the default rules written in
  playbook.md            tone, and the cases the docs do not cover
  evals.json             twelve starter eval cases
docs/
  README.md              how articles, collections, blocks and screenshots work
  getting-started/welcome.md
.env.example
```

It adds `helpwell/data/` (the embedded database) and `helpwell/.auth/` (a
capture session) to `.gitignore`, and with `--ci` writes
`.github/workflows/helpwell-evals.yml`. It prints the mount code for
`--framework next | remix | hono | node` and the widget's script tag; the host
passes `instructions` and `playbook` to `createHelpWellHandler`, and the
`readInstructions`, `writeInstructions`, `readPlaybook`, `writePlaybook`,
`readEvalCases` and `writeArticle` hooks to `createDashboard`, to connect
those files to the dashboard.

Articles are `docs/<collection>/<article>.md` with front matter (`title`,
`description`, `status`: published, draft or archived, `order`, `appliesTo`,
`slug`). A collection is a folder with at least one article or a
`_meta.json` (`title`, `description`, `icon`, `tint`, `order`, `askAgent`,
`visibility`). Screenshots go in `docs/_screenshots/`.

### 4.3 Environment variables

| Variable | Read by | What it is |
|---|---|---|
| `OPENROUTER_API_KEY` | API, dashboard, CLI, MCP | The model key. Optional: search-only answers without it. |
| `HELPWELL_DATABASE_URL` | `createDb`, CLI, MCP | A Postgres URL (with the `postgres` package). Unset: embedded PGlite under `helpwell/data`. `DATABASE_URL` is never read. |
| `HELPWELL_IDENTITY_SECRET` | API | The HS256 secret identify tokens are signed with. |
| `HELPWELL_TURNSTILE_SECRET` | API | The Turnstile secret. Config only; the site key is the setting `agent.abuse.turnstileSiteKey`. |
| `HELPWELL_ADMIN_TOKEN` | the host, as `adminToken` | A bearer token for scripts calling the admin API. |
| `HELPWELL_SUPPORT_URL`, `HELPWELL_SUPPORT_PRODUCT`, `HELPWELL_SUPPORT_TOKEN` | API, help centre | A remote support extension. All three or none; the token is never written to the config file. |
| `HELPWELL_WEBHOOK_GUARD=off` | API, dashboard | Development only: turns the webhook guard off (section 4.12). Read from the install's `env`. |
| `HELPWELL_PROJECT_DIR` | MCP | The repo root, when the MCP client starts elsewhere. |
| `GITHUB_TOKEN` | `helpwell changelog`, `init` | Optional; reads GitHub releases with a higher rate limit, and private repos. |
| `INTERCOM_TOKEN`, `ZENDESK_API_TOKEN`, `HELPSCOUT_DOCS_API_KEY`, `FRESHDESK_API_KEY`, `DOCUMENT360_API_TOKEN`, `CRISP_IDENTIFIER`, `CRISP_KEY` | `helpwell import` | The source platform's credentials. Read, never stored. |
| `HELPWELL_DEBUG` | CLI | Prints the stack trace on failure. |

Secrets are read from the config passed in code, then from the install's
`env`, and from `process.env` only when no `env` is given.

### 4.4 Settings

One schema (`core/src/settings/schema.ts`), stored in the database and in
`helpwell.config.json`. `helpwell sync` pushes the file when it is the newer
of the two; `helpwell settings pull` and `push` settle it either way.

| Group | What it holds |
|---|---|
| `product` | Name, public app URL, support email (shown as a mailto only, and hidden while a support extension handles replies), timezone, locale. |
| `helpCenter` | Public address (`domain`), subpath, and switches for search, Ask, ratings, reading time, "Powered by", sitemap and llms.txt. `theme`: background, accent, hero (glow, flat, brand), under cards, tints, headline and body fonts, default theme, logo, favicon. |
| `agent` | Name, avatar, tone, "introduce as an AI". `models`: chat, docs, embeddings, fallback. `tools`: searchDocs, readChangelog, lookUpUser, collectEmail, markUnresolved, suggestArticle. `spend`: daily cap, warn percentage, messages per conversation, messages per visitor per hour, maximum message length. `abuse`: signed-in only, bot check (off or Turnstile) and its site key, repeat throttling, blocked domains and IPs, disposable email blocking. |
| `widget` | Position, offset, z-index, the Home greeting (title and subtitle; unset keeps the built-in words), tabs (home, messages, help, updates, roadmap), appearance (theme, accent, bubble style, pattern, font, radius, launcher icon), display rules (include, exclude, audience, devices), pre-chat form (when, timing, fields, requireEmail, consent line), status page URL, Home blocks, inline video, status (auto or manual). |
| `changelog` | Source (github_releases, tags, commits, manual), repo, group by, categories, public page, widget tab, notification style (badge, drawer, modal, popup, embed, none), page size, roadmap (enabled, who can submit, statuses). |
| `engage` | On or off, the global limits (per session, per day, minutes between), and the engagements. |
| `data` | Retention in months (0 keeps everything; contacts are never pruned). |
| `webhooks` | URL, events, secret, active. |

Config only, with the reason shown in the dashboard: `version` (the file
format), `changelog.roadmap.statuses` (the four lanes are fixed) and
`webhooks` (each carries a secret, and the dashboard never edits one).

### 4.5 Webhook events

Every event in `WEBHOOK_EVENTS` (`core/src/webhooks.ts`), with its
description. This table is generated from the code.

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

A delivery is a JSON `POST` of `{ event, at, data }` with `x-helpwell-event`,
`x-helpwell-delivery`, `x-helpwell-attempt` and, with a secret,
`x-helpwell-signature` (`sha256=` and an HMAC of the exact body). It times out
after five seconds. A failure is retried with the same bytes and delivery id,
five attempts in all, after 1, 4, 16 and 64 minutes, on the next emission,
from `POST /admin/webhooks/retry`, or from `helpwell webhooks retry`. A test
delivery sends `webhook.test`, which nobody subscribes to.

### 4.6 Evals

- **Cases** live in `helpwell/evals.json`: an array, or `{ "cases": [...] }`.
  Each has an `id` and a `question`, and any of: `expect` (the slug the answer
  should cite, or `null` when the docs should not cover it), `must` and
  `mustNot` (substrings, or `/regex/flags`), `expectUnresolved`,
  `grade: "model"` with a `rubric`, and `note`.
- **Verdicts** are pass, weak (cited an article, but not the one expected;
  counts half) or fail. A case passes only when every rule it has passes.
- **Runs** replay each question through the real agent in a rolled-back
  transaction with webhooks off, record the answer, citations, latency and
  cost, and store the run (`eval_runs`, with its mode, model and suite).
  Without a key a run measures retrieval only and says so.
- **Where they run**: `helpwell eval [--ref] [--threshold]`, the dashboard's
  Evals page (live progress, graded results, run-vs-run compare), the MCP
  `run_evals` tool, `POST /admin/evals/run`, and CI through the workflow
  `helpwell init --ci` writes.
- `helpwell init` writes twelve starter cases that hold for any product.

### 4.7 Engage

Modals (one slide or a carousel with progress), banners (sticky, with an
optional countdown), hotspots with a beacon, multi-page tours, and surveys
(NPS, CSAT, stars, single and multiple choice, text, with branching). Content
is built from blocks: text, image, GIF, video, buttons and dividers.
Targeting covers who (audience, contact conditions, a segment), where (pages,
referrer, UTM, devices, languages) and when (up to five triggers: load, delay,
scroll depth, exit intent, time on page, inactivity, a click, a tracked event,
or only when code asks), with a schedule, frequency, priority and a global cap
enforced on the server. `{{field|fallback}}` personalises copy for identified
contacts. Results show impressions, clicks, dismissals, completions, tour
drop-off and survey answers, with a CSV. Engagements are JSON in
`engage.engagements`. The full format is in [engage.md](engage.md).

### 4.8 Forms

Nine kinds (newsletter, lead magnet, coupon, giveaway, waitlist, webinar,
feedback, exit offer, custom), shown inline (`data-helpwell-form`), behind a
button, as a pop-up, slide-in, bar or welcome mat on the same targeting and
cap as engagements, or as a Home block in the widget. Every submission needs a
one-time signed token and gets a verdict (Turnstile, honeypot, fill time, rate
limits, disposable and blocked domains and IPs, an MX lookup, duplicates);
only trusted submissions reach the contact, consent and giveaway entries.
Giveaways have referral links for bonus entries and a reproducible draw. A/B
variants, versions, JSON export and import, and analytics. No email is sent: a
lead magnet is a signed download link shown in the form. `form.submitted` and
`giveaway.entered` are webhooks, and `SupportExtension.formSubmitted` receives
each trusted submission. The full format is in [forms.md](forms.md).

### 4.9 Widget

A launcher (the HelpWell mark, or an uploaded image) and a panel in a Shadow
DOM with its own reset. Tabs: Home, Messages, Help, Updates and Roadmap, each
switchable. Home is made of blocks: search, the open conversation, a new
conversation, articles, updates, status, links, a card, and a form. Chat
answers cite their articles, take thumbs up or down, and say plainly when the
docs do not cover something; an unidentified visitor then gets an inline email
card, and the support email line when one is set. A status row reads
Statuspage, Instatus or Better Stack, or a manual message. Display rules, the
pre-chat form, Turnstile, inline video and the global engage cap all come from
settings. The JavaScript API is `helpwell('open' | 'close' | 'toggle' |
'identify' | 'track' | 'reset' | 'destroy')`, `helpwell.engage.show/hide` and
`helpwell.forms.show/on/off`. Under 480 px the panel is the whole screen. The
loader is under 1 KB gzipped and loads the bundle after the page.

### 4.10 Setup prompts

Every step a person configures outside HelpWell has a prompt spec in core,
shown in the dashboard beside the step and printed by `helpwell prompt
<topic>`, filled in with the project's name, `apiPath`, docs folder, `appUrl`
and the framework package.json points at. Topics: `install` (the master
prompt: detect the framework, install the packages, mount the handlers, set
the environment, add the widget, create the content, index and check),
`model-key`, `widget`, `identity`, `docs`, `search-index`, `first-answer`,
`evals`, `webhooks`, `mcp`, `import`, `turnstile`, `csp`, `capture`,
`capture-login`, `write-article`, `forms-embed`, `engage-code`,
`changelog-token` and `link`. `--json` prints the spec; `--copy` puts the
prompt on the clipboard. None carries a secret.

### 4.11 The support extension seam

`SupportExtension` (`core/src/api/support-extension.ts`) is the one way human
support plugs in. It is generic: nothing in the open-source product assumes
any particular service.

- **In process:** an object passed as `createHelpWellHandler({ support })`.
- **Remote:** any service implementing the HTTP protocol in
  [support-extension.md](support-extension.md), configured with the three
  `HELPWELL_SUPPORT_*` variables or `helpwell link`.
- **Required members:** `handleMessage`, `afterReply`, `handoff`, `thread`.
  **Optional:** `markSeen`, `playbook`, `uploads`, `upload`, `typing`,
  `presence`, `contactCaptured`, `proactive`, `proactiveEvent`,
  `formSubmitted`, `agentOverrides`, `contentSync`, `catalog`.
- **Fail-open:** short timeouts, a circuit breaker, and a retry queue
  (`support_retries`, backing off from 30 seconds to 6 hours, 20 attempts at
  most). An extension that is down never breaks the AI chat.
- With an extension connected, the widget offers "Talk to a person", the
  team's replies, typing, read receipts and attachments, and the support
  email is hidden. Proactive chat messages come from the extension's
  `proactive` hook. Without one, none of this appears.

### 4.12 Self-hosting and hosting

- **One install** mounts the three handlers in its own app. The Next.js
  bundle needs `serverExternalPackages`; on serverless hosts the docs folder
  is included in the deployed files.
- **Many installs in one process** (a service hosting HelpWell for many
  products) pass per install: `content` (a `ContentSource`), `modelFactory`,
  `env` (so nothing falls back to the process environment), `cookiePath`,
  `corsOrigins`, `identitySecret`, `turnstile.secret`, `publicUrl` on the help
  centre, and on the dashboard `embedded`, `pages`, `accent` and
  `contentMode`. `core/test/multi-instance.test.ts` proves two installs stay
  isolated.
- **`contentMode`** (`'repo'`, the default, or `'managed'`) tells the
  dashboard whether a repo, config file and CLI stand behind it. Managed
  pages never send anyone to `helpwell sync`, a config file or a command,
  and name no file in a repo, including in errors.
- **The webhook guard.** Whoever can edit settings can point a webhook
  anywhere, so every send (first try, retry, test) goes through
  `guardedWebhookFetch`: https only, no loopback, private or link-local
  address among those the name resolves to, checked at connect time, and no
  redirect followed. A refusal throws `WebhookRefusedError`, is logged with
  the reason, and is not retried. `HELPWELL_WEBHOOK_GUARD=off` in the
  install's `env` turns it off for development.
- **`webhookFetch`** on `createHelpWellHandler` and `createDashboard` replaces
  the guard with the host's own fetch (or `false` for the plain one); every
  webhook the install sends goes through it.
- **`X-HelpWell-Visitor`.** When the widget runs on another origin from the
  API, browsers such as Safari block the visitor cookie. The widget sends the
  header (`new` until it has a token), keeps the token in `localStorage` per
  API origin, and the API signs it with a per-install key in `install_state`.
  The API reads it only when there is no valid cookie, issues it only to
  cross-origin callers, and identify still decides who someone is. The site
  must be listed in `corsOrigins`.
- **`securityHeaders`**, `frameAncestors` and `contentSecurityPolicy` let a
  host adjust or drop the headers each surface sends.

---

## 5. Requirements and status

### 5.1 Install and developer experience

| ID | Requirement | Status | Notes |
|---|---|---|---|
| DX-01 | One-command install: `npx helpwell init` sets up the config, the `helpwell/` folder, the mounts and the widget. | Partial | `init` writes the files in 4.2 and prints the mount code and script tag. Missing: it does not detect the framework (it takes `--framework`, default `next`; `helpwell prompt install` does detect it) and does not write the route files itself. Migrations run on first open or with `helpwell migrate`. |
| DX-02 | Framework adapters, and a framework-agnostic widget. | Partial | Mount code for Next.js, Remix, Hono and any Request/Response server; widget install prompts for HTML, Next.js, React (Vite), Vue, SvelteKit, Rails and Django. Missing: SvelteKit, Nuxt and Express adapters, React/Vue wrapper packages. |
| DX-03 | A CLI for every job, with `--json` output for agents. | Done | Changed: one `changelog` command with `--publish` replaces `changelog generate`/`publish`; the MCP server is its own binary. Also `migrate`, `ask`, `prune`, `webhooks`, `link`, `unlink`, `settings pull/push` and `prompt`. `--json` everywhere except the interactive `dev`. |
| DX-04 | MCP server so coding agents can drive everything. | Partial | 17 tools: `search_articles`, `read_article`, `list_collections`, `list_gaps`, `resolve_gap`, `recent_conversations`, `read_conversation`, `report_summary`, `create_article`, `update_article`, `generate_changelog`, `capture_screenshots`, `import_docs`, `update_setting`, `list_segments`, `count_segment`, `run_evals`. Missing: annotate a screenshot. Proposal tools dropped with AG-09. |
| DX-05 | Agent discoverability: llms.txt, AGENTS.md, a Claude Code skill, Cursor rules, an MCP registry listing. | Partial | npm keywords, a setup prompt for every step, `helpwell prompt`, and the help centre's `llms.txt`. Missing: AGENTS.md, a Claude Code skill, Cursor rules, an MCP registry listing. |
| DX-06 | Config as code, written back by the dashboard. | Partial | Changed: one `helpwell/helpwell.config.json` holds structure and settings. The dashboard edits the database; `sync`, `settings pull` and `settings push` move settings between it and the file. No write-back to the file from the dashboard, and no commits through GitHub. |
| DX-07 | Postgres `helpwell` schema in the customer's database; PGlite for dev and tests. | Done | Reads `HELPWELL_DATABASE_URL`, never `DATABASE_URL`. Hand-written numbered SQL migrations under an advisory lock. |
| DX-08 | The host app decides who is an admin. | Done | `isAdmin(request)`, plus an `adminToken` for scripts (as a bearer) and for a browser: with a token passed to `createDashboard`, the locked-out page takes it once and keeps it in an HttpOnly, `SameSite=Lax` cookie, with wrong tokens rate-limited per address. A shared secret, not accounts. The fallback password was dropped (DS-13). |
| DX-09 | Public REST API and a typed SDK. | Done | Public and admin routes in `core/src/api/routes`; `@helpwell/sdk` with an admin client. |
| DX-10 | Webhooks for what happens in HelpWell. | Done | The 11 events in 4.5, signed, retried and guarded. Changed: `survey.answered` is `survey.response`, `feature_request.created` is `roadmap.idea`. `conversation.escalated` dropped (rule 3: no escalation); `proposal.created` dropped with AG-09. |
| DX-11 | Full export, and import for restores. | Partial | `helpwell export [--anonymise]` writes every table to JSON with secrets redacted. Missing: files in the export, and restoring from one. |
| DX-12 | Opt-in telemetry. | Dropped | Rule 5: no telemetry at all, and no setting for it. |
| DX-13 | `helpwell doctor` checks the install and prints fixes. | Partial | Checks the project, docs, instructions, key, database, settings, embeddings and search, and warns about `DATABASE_URL`. Missing: routes, DNS and capture sign-in. The dashboard's checklist sees the widget load. |
| DX-14 | Playground app. | Done | `examples/playground` (Next.js, "Ridgeline"), runnable without a key. |
| DX-15 | A setup wizard that gets the agent live. | Partial | Changed: the dashboard's Get set up checklist, checked against real facts (key, docs, index, widget seen, identify, first answer, and optional webhooks and MCP), each step with instructions and an AI prompt. Missing: a model pick, a display-rules step and a custom-domain step; it is a checklist, not an ordered wizard. |

### 5.2 Knowledge base

| ID | Requirement | Status | Notes |
|---|---|---|---|
| KB-01 | Docs live in the repo as Markdown with front matter; collections are folders with `_meta.json`. | Done | `docs/<collection>/<article>.md`, one level of collections. Articles have no icon; the collection does. |
| KB-02 | `helpwell docs generate` drafts articles from the codebase. | Partial | Reads the README, manifest, routes, plans, locale copy, OpenAPI, changelog and CLI help, and writes drafts. Missing: opening a pull request; the person commits the files. |
| KB-03 | Self-updating on release: `helpwell docs update`. | Partial | Diffs since the last tag, keeps the articles whose words overlap the change, rewrites the stale ones in place. Missing: the dashboard button, re-capturing screenshots, opening a PR, `publish: auto`, and a release hook. |
| KB-04 | Configurable prompt files for article generation. | Dropped | Deferred: the drafting prompts are in code; `instructions.md` and `playbook.md` steer the chat agent only. |
| KB-05 | The agent knows the block vocabulary. | Partial | Callouts (NOTE, TIP, IMPORTANT, WARNING, CAUTION), steps, tabs, details, code, tables and video embeds, and the drafting prompt lists them. Missing: image captions, URL preview cards, keyboard-key and button markup. |
| KB-06 | A rich editor in the dashboard that saves to the repo. | Partial | Changed: a Markdown editor with a live preview through the help centre's renderer; saves through the `writeArticle` hook or a writable content source, or offers the file to download. Missing: TipTap, slash commands, comments, drag handles, image upload. |
| KB-07 | Public help centre pages. | Partial | Home with search and collection cards, collection and article pages, breadcrumbs, table of contents, reading time, updated date, `appliesTo`, related articles, "Edit this page". Missing: a recently-updated list, prev/next, the left-rail tree. |
| KB-08 | Article ratings. | Partial | Helpful/not helpful at the end of each article (`helpCenter.ratings`). Missing: asking for a comment, and ratings in Reports. |
| KB-09 | Search: full-text and semantic, typeahead, no-result tracking, Ask. | Partial | Full-text (strict, then any-word) merged with embeddings for the agent; every search logged with its result count. Missing: semantic search on the help centre page, and typeahead there (the widget has both typeahead and Ask). |
| KB-10 | AI chat on the docs, on or off per site and per collection. | Partial | `helpCenter.askAgent` switches it per site. `askAgent: false` in `_meta.json` keeps a collection out of the agent's answers but does not hide the chat on its pages. |
| KB-11 | Icon libraries. | Partial | A built-in set of icons named after Lucide's. Missing: the full Lucide set and FontAwesome. |
| KB-12 | Theming and a "Powered by" badge. | Partial | Logo, favicon, accent, background, fonts, light/dark with a default; the badge links to the repo and `helpCenter.poweredBy` turns it off. Missing: custom CSS, header links, footer content. |
| KB-13 | Custom domain and subpath mode. | Partial | Subpath (`helpCenter.subpath`) and a public address (`helpCenter.domain`, or `publicUrl` in code) for canonical links, the sitemap, the feed and llms.txt. Missing: printing and verifying DNS records. |
| KB-14 | SEO. | Done | Sitemap, meta and Open Graph, canonical URLs, `llms.txt`, structured data, each switchable. |
| KB-15 | Redirects from old help-centre URLs. | Done | `helpwell import` writes `helpwell/redirects.json`, and the help centre answers a request that would be a 404 with a 301 to the new article when its path matches an old URL. Targets must be paths inside the help centre, so it is never an open redirect; the file is read again when it changes. |
| KB-16 | Article history with diffs and restore. | Partial | Changed: an `article_versions` table records every change the index sees (from sync, the dashboard or the API), with diffs in the dashboard and API. Missing: author, AI or human, the source PR, screenshot changes, restore. |
| KB-17 | Draft, published and archived; scheduled publish; preview links. | Partial | The three states; the help centre shows only published. Missing: scheduled publish and preview links. |
| KB-18 | Localised articles. | Dropped | Deferred. `product.locale` sets the page language and date formats only. |
| KB-19 | Logged-in-only or per-plan articles. | Partial | A collection can be `visibility: "identified"`. Missing: per article and per plan. |
| KB-20 | Import a help centre. | Partial | `helpwell import` from Markdown, HTML, GitBook and Notion folders, the Zendesk, Intercom, Help Scout, Freshdesk, Document360 and Crisp APIs, and a crawl of any public site; writes Markdown, `_meta.json` and redirects. Missing: a dashboard picker, Confluence, zip exports. |
| KB-21 | Search results page. | Partial | A real `/search` page with highlighted matches. Missing: collection filters, an Ask button, related reads on no results. |
| KB-22 | Doc update review screen in the dashboard. | Dropped | Deferred: `docs update` rewrites files, and the review is the pull request. |
| KB-23 | Collection style is data. | Partial | `_meta.json` holds title, description, icon, tint and order, and tints rotate through lavender, peach, butter and mint. Missing: editing it per collection in the dashboard. |
| KB-24 | Help centre theme settings. | Partial | Changed: stored in the settings (`helpCenter.theme`), not a `theme.ts`: background, accent, hero, under cards, tints, fonts, default theme, logo, favicon. Missing: a custom CSS escape hatch. |
| KB-25 | Content gaps screen. | Partial | Questions the agent could not answer, merged and ranked, with Draft an article (into the editor). Missing: searches with no results as gaps, and gaps in Reports. The daily digest is dropped (rule 1). |

### 5.3 Screenshots and media

| ID | Requirement | Status | Notes |
|---|---|---|---|
| SS-01 | Capture scripts in the repo. | Partial | Changed: shots are declared in `screenshots.shots` in the config (path, waitFor, click, clip, size, dark, annotate), run with Playwright. Missing: shots naming the article they feed. |
| SS-02 | Runs locally or in CI with sign-in. | Done | `helpwell capture` against `appUrl`, signed in through env-named fields, cookies or a storage-state file. Nothing is uploaded. |
| SS-03 | Re-capture only what changed on release, with a diff. | Dropped | Deferred. `--only` filters by name. |
| SS-04 | Annotations anchored to selectors. | Partial | rect, ellipse, arrow, numbered step, label, spotlight and blur, anchored to CSS selectors and skipped with a warning when missing. Missing: a separate editable layer (they are drawn into the image), a zoom inset. |
| SS-05 | Blur sensitive material. | Partial | `screenshots.blur` selectors and `blur` annotations. Missing: automatic masking of password, email and card fields. |
| SS-06 | Seeded demo data. | Dropped | Deferred; the capture prompt tells the assistant to use a demo test account. |
| SS-07 | Image model integration. | Dropped | Deferred. |
| SS-08 | Viewport and theme variants. | Partial | Any viewport, and `dark: true` writes a dark copy. Missing: a mobile preset, and the help centre choosing the copy for the reader's theme. |
| SS-09 | Videos and GIFs from the same scripts. | Dropped | Deferred. |
| SS-10 | A screenshots settings screen. | Dropped | Changed: capture is configured in `helpwell.config.json`, and the Knowledge base page has a Screenshots card with the setup prompts. |

### 5.4 Changelog

| ID | Requirement | Status | Notes |
|---|---|---|---|
| CL-01 | Pull releases from GitHub, tags or commits. | Partial | `changelog.source`: `github_releases`, `tags`, `commits` or `manual`, chosen at `init`. Missing: reading PR titles and bodies and a diff summary. |
| CL-02 | Customer-facing generation. | Done | A title, summary and body in the customer's voice, tagged with `changelog.categories` (New, Improved, Fixed). Internal-only changes draft nothing. |
| CL-03 | Draft or auto-publish. | Partial | Drafts by default, `--publish` per run. Missing: an auto-publish setting, a draft banner and a nav badge. |
| CL-04 | Rich editing of entries. | Partial | Changed: a Markdown body in the dashboard; images and video through Markdown. |
| CL-05 | Public changelog page. | Partial | Version tags, dates, tags, a page per entry, paging and RSS. Missing: filtering by type on the page (the API supports `?tag=`). |
| CL-06 | In-app changelog with unread state. | Done | Unread count on the launcher, dots on the Updates tab and entries, read receipts, a What's new drawer. |
| CL-07 | Notification templates. | Partial | `changelog.notification`: badge, drawer, modal, popup, embed or none. Missing: a per-release override, and a badge on the host app's own menu. |
| CL-08 | Updates tab in the widget. | Done | `changelog.widgetTab`. |
| CL-09 | Link shipped roadmap items to entries. | Partial | A roadmap item can be set to shipped with its entry through the admin API. Missing: automatic matching and a dashboard control. Notifying voters is dropped (rule 1). |
| CL-10 | Draft "this is fixed" replies to open conversations. | Dropped | Rule 2: there are no human replies to draft. |
| CL-11 | Release announcement email. | Dropped | Rule 1. |
| CL-12 | Paged loading everywhere the changelog renders. | Partial | The public page and the widget load 10 at a time. Missing: paging on the roadmap, which caps each lane at 50. |

### 5.5 The agent

| ID | Requirement | Status | Notes |
|---|---|---|---|
| AG-01 | Bring your own OpenRouter key, a model per job, a fallback. | Partial | `agent.models`: chat, docs, embeddings, fallback, with one retry on the fallback. Missing: a classification model (topics come from citations). |
| AG-02 | The agent's configuration in files. | Partial | `helpwell/instructions.md` and `playbook.md`, passed to the handler by the host; name, avatar, tone and tool switches are settings. Dropped (rule 3): `conditions.json` escalation rules and a confidence-threshold setting. |
| AG-03 | Context: docs, changelog, page, identified attributes, history, glossary. | Partial | Docs search before every answer, the changelog tool, the current page and identify attributes. Missing: earlier conversations and a glossary. |
| AG-04 | Tools, each switchable with a stated scope. | Partial | `search_docs`, `read_changelog`, `look_up_user`, `collect_email` (never offered to an identified visitor), `mark_unresolved`, `suggest_article`. Missing: open article, end conversation, custom tools in code (an extension's `agentOverrides` can only switch tools off). |
| AG-05 | Grounded answers. | Done | Numbered passages, cited by number; "inferred" citations when the wording follows a passage; a hidden certainty line. When the docs are silent it says so, logs a gap and marks the conversation unresolved. |
| AG-06 | The no-answer path. | Done | Says so, marks unresolved, logs a gap, and offers the email card or the support email (or a support extension's handoff). No escalation queue. |
| AG-07 | Feedback on answers and conversations. | Partial | Thumbs on every answer. Missing: "Did this solve it?" and a closing rating in the widget (the four-face rating exists in the API and SDK only). |
| AG-08 | Topic for every conversation. | Partial | Taken from the cited collection and editable. Missing: a topic for uncited conversations, a classifier. |
| AG-09 | Improvement proposals from negative signals, approved by a person. | Dropped | Deferred. The open-source loop is gaps and Draft an article (AG-17). |
| AG-10 | Anti-gaming for proposals. | Dropped | Deferred with AG-09. |
| AG-11 | Evals. | Partial | Section 4.6. Changed: cases are in `helpwell/evals.json`, and model grading applies to cases that ask for it. CI fails below an absolute `--threshold`, not on a drop. Missing: drafting cases from conversations and fixed gaps. |
| AG-12 | Guardrails. | Partial | Passages and user text framed as data, a rule against asking for secrets, per-visitor rate limits, abuse throttling, IPs stored only as keyed hashes. Missing: PII redaction in stored messages. |
| AG-13 | Drafted replies for humans. | Dropped | Rule 2. |
| AG-14 | Routing suggestions. | Dropped | Rule 2. |
| AG-15 | Answers in the customer's language. | Dropped | Deferred. |
| AG-16 | Learning from human replies. | Dropped | Rule 2: there are none to learn from. |
| AG-17 | The gaps list. | Done | Recorded, merged, ranked, with drafts from the dashboard, the API and MCP. |
| AG-18 | No separate guardrails screen; the rules live in `instructions.md`. | Done | `DEFAULT_INSTRUCTIONS` ships with the rules; the Playbook page edits the files through the host's hooks. |
| AG-19 | Human handoff to the customer's live chat tool. | Dropped | Changed (rule 2): no handoff hook with vendor presets and no `conversation.handoff` webhook. Handoff is a support extension's `handoff`; without one, the email card and the support email. |
| AG-20 | Spend caps. | Done | `agent.spend`: daily cap, warn percentage, per-conversation and per-visitor-per-hour limits, maximum length. At the cap it answers from search only. Today's spend is on Reports. No email to the admin (rule 1). |
| AG-21 | Spam and abuse protection. | Done | `agent.abuse`: signed-in only, Turnstile on the customer's keys, repeat throttling, blocked domains, IPs and disposable addresses; the honeypot and origin checks are always on. Blocked attempts are counted, never stored as conversations. |

### 5.6 Widget

| ID | Requirement | Status | Notes |
|---|---|---|---|
| WG-01 | Launcher, panel and display rules. | Partial | Position, offset, z-index; include and exclude globs (exclude wins), audience and devices, re-checked on every route change. Missing: regular expressions, and plan or role rules. |
| WG-02 | Home tab. | Done | "Hi <first name>", search, the open conversation, Ask a question, What's new, status: the default blocks. |
| WG-03 | Tabs: Home, Messages, Help, Updates, Roadmap. | Done | `widget.tabs`. |
| WG-04 | Chat. | Partial | Markdown, article citations, typing indicator, retry, history in Messages. Attachments only with a support extension. Missing: streaming and quick replies on answers. "Email me this answer" dropped (rule 1). |
| WG-05 | Stacked incoming messages. | Partial | Proactive messages from a support extension appear above the launcher, up to three, with the count on the badge. Missing: the overlapping stack with the fan-out, and sound. |
| WG-06 | Identify and track. | Done | `helpwell('identify', token)` with a server-signed JWT carrying the attributes; `helpwell('track', name, props)`. |
| WG-07 | Identify first, pre-chat form as the catch-all. | Done | `widget.preChat`: never or unknown visitors only, before or after the first message, email and name, required email, consent line. |
| WG-08 | Appearance. | Partial | Theme, accent, bubble style, pattern, five fonts, radius, launcher image. Missing: bubble colours per side, patterns in the feed (the header only), a custom font in the dashboard. |
| WG-09 | One avatar and name, everywhere. | Partial | `agent.name` and `agent.avatarUrl` in the header, bubbles and typing row; the default is the bare mark. Missing: the launcher uses its own image setting, and the dashboard thread does not show the avatar. |
| WG-10 | Article ratings and changelog read tracking in the widget. | Done | |
| WG-11 | Status and incident banner. | Partial | A status row from Statuspage, Instatus or Better Stack, or manual, with a dot on the launcher; the host can pass an incident the agent reads. Missing: a banner above every tab and the resolved banner. "Notify me" dropped (rule 1). |
| WG-12 | Accessibility. | Done | Keyboard, focus trap, ARIA live thread, reduced motion. |
| WG-13 | Performance budget. | Done | The loader is under 1 KB gzipped, has no imports, queues calls and fetches the bundle after load. It is about 0.7 KB, and a core test fails when the size the prompts state drifts more than 0.2 KB from the built loader. |
| WG-14 | Native iOS and Android SDKs. | Dropped | Deferred. |
| WG-15 | Framework wrappers and a script tag. | Partial | The script tag and an ESM `init()`. Missing: React, Vue and Svelte wrappers. |
| WG-16 | Home screen made of blocks. | Partial | Nine block types and `registerHomeBlock` for custom ones. Missing: roadmap, video, event, RSS, YouTube, social and banner blocks. |
| WG-17 | Block variants and sizes. | Partial | Blocks are JSON in `widget.home.blocks`. Missing: variants and home sizes. |
| WG-18 | Home screen builder with live preview. | Partial | Settings lists blocks with add, remove and reorder. Missing: drag, variant and size pickers, live preview. |
| WG-19 | Help, Updates and Roadmap tabs. | Partial | Help: search, collections and "Still stuck?". Updates: paged, with versions, tags and unread dots. Roadmap: four lanes, votes, suggestions. Missing: popular articles in Help, the Top filter, versions on shipped cards. |
| WG-20 | Mobile full screen. | Done | At 480 px and below, following the visible viewport, with safe-area padding. |
| WG-21 | Edge states. | Partial | The inline email card for unidentified visitors, and an answer from the docs with a notice when the model fails. Missing: "Leave my email" on an outage. Changed: handoff is a support extension's button. |
| WG-22 | Shadow DOM isolation. | Done | |
| WG-23 | Accessibility, in full. | Done | Everything in WG-12, visible focus, labelled icon buttons, ARIA tabs. No automated contrast check. |

### 5.7 Engage

| ID | Requirement | Status | Notes |
|---|---|---|---|
| EN-01 | Engagements by page. | Done | Modal, banner, hotspot, tour and survey. Changed: triggered chat messages come from a support extension's `proactive` hook, not a local type. |
| EN-02 | Trigger rules. | Partial | The triggers, targeting and frequency in 4.7. Missing: first visit, after N visits, has or has not seen X, new since a version. |
| EN-03 | Placement and multi-step slides. | Done | Centred modals with sizes, top or bottom banners, anchored hotspots and tour steps, survey corner, centre or bar; progress as dots, a bar or a count. |
| EN-04 | Templates and a preview in the dashboard. | Done | A template gallery, and a live preview drawn by the widget's own renderer. |
| EN-05 | Engage analytics. | Done | Seen, clicked, dismissed, completed, conversion, tour drop-off. |
| EN-06 | In-app surveys. | Partial | Six question kinds, branching, follow-ups, targeting, throttling, results and CSV, `survey.response`. Missing: results by segment. |
| EN-07 | Roadmap. | Partial | Widget tab and help centre page, `changelog.roadmap` settings, voting, suggestions, four statuses. Missing: versions and entry links on shipped cards in the widget. Notifying voters dropped (rule 1). |
| EN-08 | Engage as code. | Done | Changed: engagements are JSON in `engage.engagements` in the config, not a `helpwell/engage/` folder. |

### 5.8 Conversations (the review log)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| IN-01 | Conversations list: a review log, not a work queue. | Partial | Person, question, topic, resolved or unresolved, messages, time, reviewed; filters for status and topic, and search. Missing: tags in the list and a tag filter. |
| IN-02 | Thread view. | Partial | Messages, tool calls, feedback, citations, and the read-only confidence panel with every passage the answer was given. Missing: event rows (topic set, article cited), Copy email and a mailto on the contact card. |
| IN-03 | Tags, mark reviewed, draft an article. | Partial | Manual tags and Reviewed. Missing: agent-suggested tags, and drafting from a conversation (drafts start from gaps). |
| IN-04 | Contact panel, overlay or inline. | Partial | The name links to the contact page. Missing: the overlay and inline panel. |
| IN-05 | Human replies. | Dropped | Rule 2. The admin shows no composer, assignment or team inbox, and never mentions anything missing. |
| IN-06 | Internal notes. | Dropped | Rule 2. |
| IN-07 | Keyboard shortcuts in the list. | Dropped | Deferred. Ctrl or Cmd+K opens the command palette. |
| IN-08 | Daily digest. | Dropped | Rule 1. Nav badges count unreviewed unresolved conversations and new gaps instead. |

### 5.9 Contacts

| ID | Requirement | Status | Notes |
|---|---|---|---|
| CT-01 | Contact list with search and filters. | Done | Search by name, email or user id; identified or anonymous, tags, and a condition builder; CSV export. There is one product per install. |
| CT-02 | Profile from identify and help-centre activity. | Partial | Name, email, user id, signed up, last seen, location, locale and timezone, attributes, tags, source and consent, searches, ratings, updates read, surveys and events. Missing: roadmap votes. |
| CT-03 | Usage timeline and chart from tracked events. | Partial | Event counts per name on the contact and `GET /admin/contacts/:id/events`. Missing: a timeline and the 30-day chart. |
| CT-04 | Login attempts chart. | Dropped | Deferred. |
| CT-05 | Conversation history, survey answers, feature requests, changelog reads. | Partial | All but roadmap ideas and votes, which are in the export only. |
| CT-06 | Identified or visitor. | Done | |
| CT-07 | Segments reused across the product. | Done | Saved conditions with counts and members, used by engage and forms targeting, the MCP tools and the contacts list. Membership is worked out when asked. |
| CT-08 | Delete a contact, export their data. | Done | JSON export and erase from the contact page and the API. |
| CT-09 | Source and consent on every contact. | Done | Source: widget, identify, import, form, api. Consent: unknown, granted or denied, with where and when. |
| CT-10 | Retention and consent. | Partial | `data.retentionMonths` (default 12; contacts kept), `helpwell prune` and "Run housekeeping now", the identify `consent` claim, find-then-export-or-erase. Missing: a privacy-request panel and a deletion request from the widget. Nothing prunes on a schedule. |

### 5.10 Reports

| ID | Requirement | Status | Notes |
|---|---|---|---|
| RP-01 | Report cards with daily bars. | Partial | Conversations, resolved rate, median reply time, cost; conversations over time; helpful and not helpful. Missing: a card per metric and satisfaction. Open and closed chats dropped (rule 2). |
| RP-02 | Topic cloud. | Partial | Topics as ranked bars, and a topic filter on Conversations. Missing: the bubble cloud, the per-topic table and detail panel. |
| RP-03 | Agent performance. | Partial | Resolved rate, helpful votes, gaps, and the Evals page's history. Missing: helpful rate over time and gaps on Reports. Handoffs dropped (rule 2). |
| RP-04 | Content reports. | Partial | Articles doing the work, searches with no results, per-article performance, gaps. Missing: article views. |
| RP-05 | Engage and survey results. | Partial | Per engagement: impressions, clicks, dismissals, completions, conversion, tour drop-off, NPS summary, answers and CSV. Missing: NPS over time and by segment. |
| RP-06 | One date-range control. | Partial | Today, 7, 30 and 90 days and all time, in the URL, driving the CSV; the default is 30 days. Missing: the popover, calendar, custom dates and compare. |
| RP-07 | Product filter and CSV export. | Partial | The CSV of the daily series. No product filter: one product per install. |

### 5.11 Migration and importers

| ID | Requirement | Status | Notes |
|---|---|---|---|
| MG-01 | Programmatic importers. | Done | Zendesk, Intercom, Help Scout, Freshdesk, Document360 and Crisp through their APIs; GitBook and Notion exports; images downloaded. |
| MG-02 | Crawler and agent fill-in. | Partial | `helpwell import crawl <url>` writes drafts. Missing: an agent fill-in step. |
| MG-03 | Redirect map. | Done | Written to `helpwell/redirects.json` and served by the help centre (KB-15). |
| MG-04 | Contact and conversation import. | Partial | `helpwell import contacts <csv or json> [--dry-run]`, labelled source import and consent unknown. Conversation import dropped (rule 2). |

### 5.12 Dashboard shell and settings

| ID | Requirement | Status | Notes |
|---|---|---|---|
| DS-01 | Navigation. | Done | Changed: Get set up; Conversations, Contacts; Knowledge base, Gaps, Changelog, Roadmap, Engage, Forms; Reports, Evals; Settings, Playbook, Connections. Settings tabs: General, AI agent, Widget, Help centre, Changelog, Data. |
| DS-02 | Banners for what waits on a person. | Partial | Badges for unreviewed unresolved conversations and new gaps; the spend banner on Reports. Missing: changelog-draft and failed-capture banners. |
| DS-03 | Appearance settings with a live widget preview. | Partial | Every widget setting on the Widget tab, and the help centre look on its own tab. Missing: the live widget preview (engage and forms have theirs). |
| DS-04 | AI agent settings. | Partial | Name, tone, avatar, "introduce as an AI", models from OpenRouter's live list, tools, spend, abuse and bot check; instructions on the Playbook page; the eval runner on Evals. Missing: a test panel. |
| DS-05 | Docs, capture and changelog settings with repo links. | Partial | Help centre and Changelog tabs; "Open in the repo" on articles. Missing: capture settings (config only) and per-setting repo links. |
| DS-06 | Connections. | Done | OpenRouter, the embedding model, which secrets are set and where they are read from, the docs index, and webhooks with test and retry. |
| DS-07 | Data: export, import, delete. | Partial | Retention, housekeeping, and per-contact export and erase. Missing: whole-install export and import in the dashboard (the CLI has export). No telemetry toggle, by rule 5. |
| DS-08 | Light, dark and system. | Partial | Charcoal dark everywhere. The dashboard follows the OS with no toggle; the help centre and widget have both. |
| DS-09 | The motion system. | Partial | Page fade and rise, spring notices, field errors, bars, the palette. Missing: several of the listed pieces (drag with inertia, digit reels, the stacked fan-out). |
| DS-10 | Command palette. | Partial | Ctrl or Cmd+K jumps to any page. Missing: searching content and settings, and actions. |
| DS-11 | Settings pages. | Partial | General, Help centre (with the public address), Changelog and roadmap, Data. Missing: a DNS check, generation instructions, redirects, per-collection settings, restore and a danger zone. Changed: admins come from the host's `isAdmin`. |
| DS-12 | Empty states and first run. | Partial | Knowledge base and Changelog empty states name the action and the command; the prompts are on Get set up. |
| DS-13 | Standalone login with a fallback password. | Dropped | Changed: the host's `isAdmin` decides; without it, a closed page that shows how to add it. |
| DS-14 | Skeleton loading states. | Partial | The transitions.dev loader is kept verbatim in the tokens and used in the widget. The dashboard and help centre are server-rendered and have nothing to wait for. No spinners anywhere. |
| DS-15 | Animated error and validation states. | Partial | Field errors rise in, a failed save keeps the input, the widget queues messages offline. Missing: retry and copy on a failed save, typed-name confirms, the moved-article page logging a gap. |

### 5.13 Out of scope

The first draft also listed requirements for a separately hosted service and
for email (CL2-01 to CL2-17, AG2-01, EM-01 to EM-08): a team inbox, live
chat, routing, inbound email, Slack and social inboxes, a mobile app, a
browser copilot, broadcasts and lifecycle email. All are **Dropped** from this
project by rules 1 and 2. Anything that needs people answering plugs in
through the support extension seam (4.11), which stays generic.

---

## 6. Non-functional requirements

| Area | Requirement | Status | Notes |
|---|---|---|---|
| Privacy | Code, screenshots and conversations stay on the customer's servers. | Done | Rule 5. A support extension is opt-in and receives only what its protocol documents. |
| Security | Signed identity, host-decided admins, secrets from the environment, injection handling, abuse protection, Shadow DOM, CSP-friendly. | Done | HS256 identify tokens; `isAdmin` and `adminToken`; cross-site and non-JSON admin requests refused; security headers on every surface; the webhook guard; setup prompts never carry a secret. |
| Accessibility | WCAG 2.1 AA, keyboard-complete. | Partial | Keyboard, focus management, live regions, labelled controls, screen-reader tables for charts. Missing: an automated AA check. |
| Performance | Loader under 5 KB, panel under 150 KB gzipped, fast help centre and dashboard. | Partial | The loader is under 1 KB and the bundle about 77 KB gzipped; the dashboard has no client bundle. Missing: automated budgets. |
| Motion | Drawn-out, eased motion; reduced motion respected. | Done | The durations and easings are tokens (`tokens/src/motion.ts`). |
| Theming | Light and charcoal dark everywhere. | Partial | All three surfaces; no manual toggle in the dashboard. |
| i18n | UI strings externalised. | Dropped | Deferred: strings are English in code. |
| Testing | Unit tests per package, browser tests, evals in CI. | Partial | Vitest in every package against real Postgres (PGlite), with no network; `.github/workflows/ci.yml` runs the build, typecheck, Biome and the tests on Node 22 and 24. Missing when this was written: browser end-to-end tests and scheduled evals in CI, both in progress. |
| Docs | HelpWell documents itself with HelpWell. | Dropped | Deferred. |

## 7. Success metrics

| Metric | Target for v1 |
|---|---|
| External installs (not the owner's own products) | 100 in the first 90 days after launch |
| Time from `npx helpwell init` to the first agent answer | Under 10 minutes |
| Share of conversations resolved by the agent | Over 60% on the owner's own products |
| Screenshots needing manual fixes per release | Under 10% |

## 8. Design-system notes

- **Credit line** is "Powered by" plus the HelpWell wordmark (one colour,
  muted), never a GitHub logo. The repo link stays as text where it belongs.
- **Dark mode** is available on every screen.
- **Responsive** is required for every screen, with the widget full screen on
  phones.
- **Brand marks** (import sources, social rows) are real logos as inline
  single-path SVG in the brand colour, from simple-icons (CC0) or uxwing.
  Never letter tiles, never remote images.
- **Date range** is one shared component, never a different control per
  screen.
- **Brand lockup**: mark and wordmark as inline SVG; the purple fills use
  `currentColor` and the "Well" fill uses `--wm-ink`, so one colour setting
  recolours the lockup and dark mode flips `--wm-ink` to white.
- **Under cards are one component**: a tinted root with the white card nested
  inside and the metadata line on the tint's bottom edge. Use one only when
  that strip carries real information: on help-centre collections, the
  article count and the last-updated date.
- **Selected state** across lists, trees and nav: a lavender fill (`#F0EAFE`)
  with the title in deep violet at weight 700; in dark mode `#251E3B` and
  `#C9B8FF`. Never a left rail, bar or hairline accent.
- **Tokens** ship as CSS variables from `@helpwell/tokens` (light and charcoal
  dark), with the motion values as named easings and durations.

## 9. Open questions

1. **Outside contributions.** Pull requests are closed for now. Opening them
   needs a Contributor License Agreement (a standard template through
   cla-assistant), so outside code can never limit how Workado, LLC licenses
   HelpWell.
2. **Framework detection in `init`.** `helpwell prompt install` detects the
   framework; should `init` use the same detection instead of defaulting to
   Next.js?
