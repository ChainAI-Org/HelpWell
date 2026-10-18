# Support extensions

HelpWell answers visitors with its AI. It has no inbox, no human replies and no email of its own. A **support extension** is how human support plugs in: a service that takes over a conversation when a visitor asks for a person, mirrors every conversation so a team can see it, and shows the team's replies in the widget.

There are two kinds, and HelpWell treats them the same way:

- **An in-process extension**: an object you write that implements `SupportExtension` from `@helpwell/core/api`, passed to `createHelpWellHandler({ support })`.
- **A remote support extension**: any service that implements the HTTP protocol on this page. You give HelpWell its URL, a product id and a token, and HelpWell becomes its client. No code.

Whichever you use, HelpWell calls it through a fail-open layer, so the extension can never break the AI chat.

## Connect a remote support extension

The service gives you three values: its base URL, a product id, and a token. The token is a secret.

### With the CLI

```bash
npx helpwell link --url https://support.example.com/api --product prod_42
```

This saves the URL and product id in `helpwell/helpwell.config.json`, prints the three environment variables to set on the server, and checks the connection if `HELPWELL_SUPPORT_TOKEN` is set in your shell. The token is never written to the config file; `--token` is refused. Run it without flags to be asked for the values.

- `helpwell link --status` says where the connection points, whether the token is set, and whether the service answers.
- `helpwell link --prompt` also prints the setup as a prompt for an AI assistant.
- `helpwell unlink` removes the connection from the config file.
- `npx helpwell prompt link` prints the same prompt on its own, for a coding agent.

#### Set this up with an AI assistant

Paste this into ChatGPT, Claude or your coding agent. `helpwell link --prompt`
prints it filled in with the URL and product id you linked. It holds no token.

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
| HELPWELL_SUPPORT_URL | https://support.example.com/api |
| HELPWELL_SUPPORT_PRODUCT | prod_42 |
| HELPWELL_SUPPORT_TOKEN | — |

The same values as JSON:

```json
[
  {
    "Variable": "HELPWELL_SUPPORT_URL",
    "Value": "https://support.example.com/api"
  },
  {
    "Variable": "HELPWELL_SUPPORT_PRODUCT",
    "Value": "prod_42"
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
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://support.example.com/api/bridge/prod_42/playbook" -H "Authorization: Bearer $HELPWELL_SUPPORT_TOKEN" -H "content-type: application/json" -d '{}'
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

### On the server

The server reads the connection from its environment. All three must be set; with only some of them, HelpWell logs which one is missing and runs without human support.

| Variable | Value |
| --- | --- |
| `HELPWELL_SUPPORT_URL` | The service's base URL. `https://` is required, except for `http://localhost`. |
| `HELPWELL_SUPPORT_PRODUCT` | The product id. |
| `HELPWELL_SUPPORT_TOKEN` | The token. Server environment only: never in browser code, the repository or a log. |

Or pass the same values in code, which takes precedence over the environment:

```ts
import { createHelpWellHandler } from '@helpwell/core';

export const api = createHelpWellHandler({
  db,
  support: {
    url: process.env.HELPWELL_SUPPORT_URL!,
    product: process.env.HELPWELL_SUPPORT_PRODUCT!,
    token: process.env.HELPWELL_SUPPORT_TOKEN!,
  },
});
```

While an extension is connected, the support email in Settings (`product.supportEmail`) is not shown: the widget and the help center leave out their "Email us at" and "Contact support" links, and the extension's own flow is how people reach a person. The API knows this from `support`. The help center is a separate handler, so it reads the same three environment variables; a host that passes `support` in code passes `createHelpCenter({ humanSupport: true })` as well.

`support: false` turns human support off whatever the environment says. To build the client yourself, for a custom logger, timeouts or attachment limits, use `createRemoteSupportExtension({ url, product, token, db, logger?, timeouts?, circuit?, uploads?, fetch? })` from `@helpwell/core/api` and pass the result as `support`. `uploads` is `{ maxBytes, types }`, or `false` for no attachments; it defaults to the protocol's (`REMOTE_UPLOAD_LIMITS`: images, PDF, text, CSV, JSON, zip, video and Office files, up to 10 MB).

Check the connection from the server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$HELPWELL_SUPPORT_URL/bridge/$HELPWELL_SUPPORT_PRODUCT/playbook" \
  -H "Authorization: Bearer $HELPWELL_SUPPORT_TOKEN" -H "content-type: application/json" -d '{}'
```

It prints 200. A 401 means the token is wrong or was replaced; a 404, that the URL or product id is wrong.

## Failing open

Every call to an extension, in-process or remote, goes through the same wrapper (`failOpenSupport` in `@helpwell/core/api`). What a failure means depends on the call:

| Call | When it fails |
| --- | --- |
| `handleMessage` | The AI answers, as if there were no extension. |
| `afterReply` (mirror a conversation) | Queued, and replayed when the extension answers again. |
| `markSeen` (read receipts) | Queued, and replayed. |
| `formSubmitted` | Queued, and replayed. |
| `thread` | The widget shows HelpWell's own transcript. |
| `playbook` | The AI answers without the extra guidance. A remote extension serves its last good playbook for as long as it has one. |
| `presence` | Nobody is typing, and there is no notice. |
| `typing`, `contactCaptured`, `proactiveEvent`, `contentSync`, `catalog` | Ignored. The next content push carries everything again. |
| `agentOverrides` | No overrides: the AI answers with the install's own tools and instructions. |
| `proactive` | Nothing is shown. |
| `handoff` | The visitor is told the team could not be reached and that the assistant can keep helping. |
| `upload` | The visitor is told the file could not be stored. |

Two kinds of error pass through unchanged:

- An **ownership refusal** (a `HelpWellError` with code `forbidden`) is always a 403. It means "this is not your conversation", and hiding it would let a visitor believe a message landed.
- A **deliberate refusal** from `handoff` or `upload` (any 4xx `HelpWellError`) reaches the visitor with its own message.

Every call also has a ceiling: 15 seconds, or 30 for a handoff or an upload. A remote extension's own timeouts are shorter.

`agentOverrides` is asked before the AI answers and for the widget's config, and its answer, overrides or none, is reused for a minute. A help centre given the same function (`createHelpCenter({ agentOverrides })`) uses its `name` on the "Ask" buttons.

### The retry queue

Queued work is kept in the database (`helpwell.support_retries`), so a restart or a deploy loses nothing. There is one row per piece of work. Replaying a mirror always sends the conversation as it is now, and a conversation that fails ten times is still one row.

- **When.** The first retry waits 30 seconds, and the waits then grow to six hours. After 20 attempts (about three and a half days) the row is dropped, with a log line. The next reply on that conversation mirrors it again anyway.
- **Who drains it.** The queue is drained whenever a call to the extension succeeds, at most every five seconds. A host with a scheduler can also call `drainRetries()` on the wrapped extension.
- **An open circuit, or a rate limit.** A replay that is skipped because the circuit breaker is open, or turned away by a `429` (or the pause after one), costs no attempt and waits until the client may call again.
- **Size.** The queue holds at most 5,000 rows.

## The remote protocol

Version 1. Changes are additive: a client ignores fields and `reason` values it does not know, and so should a service. Any service that implements these actions works.

### Requests

```text
POST {url}/bridge/{product}/{action}
Authorization: Bearer {token}
Content-Type: application/json
```

- **Every action is a `POST` with a JSON body**, even `{}`. The one exception is `upload`, whose body is the file.
- **The client never follows a redirect**, so the token only goes where it was configured to go.

### Responses

| Status | Meaning | What the client does |
| --- | --- | --- |
| `2xx` | Answered. The body is a JSON object with `handled`. | Acts on it. A 2xx whose body is not JSON counts as a failure. |
| `4xx` (not `429`) | Refused: a wrong token, a malformed body, an unknown action. Body: `{ "error": { "code", "message" } }`. | Logs it, at most once a minute per action, and does not retry or count it towards the circuit breaker. A `404` on any action a service may not have (`proactive`, `proactive-event`, `typing`, `presence`, `upload`, `form-submitted`, `agent-overrides`, `content-sync`) means "not supported here": the client stops asking for ten minutes, and stops offering attachments while `upload` is missing. |
| `429` | Over the service's request limit. `Retry-After` says for how long, in seconds or as an HTTP date. | Pauses every call to the service until then (at most five minutes; a minute when there is no usable `Retry-After`), and fails open meanwhile exactly as for an outage: nothing is sent, queued work waits in the queue at no cost, and reads carry on without the service. One log line per pause. It does not count towards the circuit breaker. |
| `5xx` | Unavailable. | Fails open, counts a failure, and retries later where the table above says so. |

**Timeouts.** 10 seconds for `sync`, `handoff`, `form-submitted` and `content-sync`, 30 seconds for `upload`, and 5 seconds for everything else.

**Circuit breaker.** After 3 consecutive failures (a timeout, a network error, a 5xx, or a body that is not JSON), the client stops calling for 60 seconds, then lets one call through.

**Rate limits.** A `429` pauses every call from that client to the service for its `Retry-After`, capped at five minutes, so a bad header cannot stall it for good. A service that limits requests per product should answer `429` with `Retry-After` rather than `503`, so the client waits without counting a failure.

When `handled` is `false`, `reason` says why: `ai` (the AI has the conversation), `not_found`, `deleted`, `inactive`, or `retrying`. A write that is accepted but not yet applied also says `"queued": true`. A queued write needs no resend.

### `sync`: mirror a conversation

Sent after every AI answer, after a feedback change, when the visitor leaves an email, and before a handoff. The body is the whole conversation, so any sync repairs what an earlier one missed:

```json
{
  "sourceId": "cnv_…",
  "subject": "First customer message, up to 200 characters",
  "pageUrl": "https://example.com/billing",
  "unresolved": false,
  "contact": {
    "sourceId": "con_…",
    "name": "Jane Martin",
    "email": "jane@example.com",
    "attributes": { "plan": "Pro" },
    "timezone": "Europe/London",
    "locale": "en-GB"
  },
  "proactiveId": "hello_1",
  "messages": [
    {
      "sourceId": "msg_…",
      "kind": "ai",
      "body": "Open Billing, then Invoices.",
      "citations": [{ "slug": "billing/invoices", "title": "Exporting invoices", "collection": "billing" }],
      "metadata": { "feedback": null },
      "confidence": 0.82,
      "confidenceReason": "Cited two passages that match the question closely.",
      "createdAt": "2026-09-22T10:00:01.000Z"
    }
  ]
}
```

- **`messages`** are the conversation's latest 500, oldest first. `kind` is `customer`, `ai` or `event`.
- **`confidence`** (0 to 1) and **`confidenceReason`** are on AI answers only. They are HelpWell's own score of how grounded the answer is, so a service can apply its own threshold for bringing in a person. HelpWell has no threshold setting of its own.
- **`proactiveId`** is present when the conversation began as a reply to a proactive chat message.
- **`metadata.proactive: true`** marks the message that began such a conversation: the agent's own proactive message, which the service may already hold.
- **Contact email.** An address that is not a valid one is sent as `null`, so it cannot block the mirror.
- **Contact `timezone` and `locale`**, an IANA time zone and a language tag, are sent when the host app's identify call or the browser gave them, and `null` otherwise. A service can use them to send at a sensible local time and in the right language.

Answer `{ "handled": true }`.

### `message`: a visitor's message while a person has the conversation

```json
{ "sourceId": "cnv_…", "message": "Are you there?", "requestId": "3f9c…", "proactiveId": "hello_1" }
```

- **`requestId`** is the widget's id for this one send. A retry of the same send carries the same id, so deduplicate on it rather than on the text.
- **`proactiveId`** is only on the first message of a conversation started from a proactive chat message. The client sends a `sync` first, so the conversation is known before its first message arrives.
- **A new conversation's first message** is never sent: nobody has it yet, so the AI answers it and a `sync` follows.

Answer `{ "handled": true, "message": { "id": "…" } }` to take it, and the AI stays quiet. Or answer `{ "handled": false, "reason": "ai" }` to let the AI answer.

### `thread`: the transcript the widget shows

Body `{ "sourceId": "…" }`. Answer:

```json
{ "handled": true, "ticket": { "id": "…", "status": "open", "mode": "human" }, "messages": [ … ] }
```

- **Each message** has `id`, `kind` (`customer`, `ai`, `human` or `event`), `body`, `citations`, `author_name`, `created_at` and, for AI answers, `source_id`.
  - Other kinds are dropped.
  - An AI answer shows under its `source_id`, so the visitor's feedback reaches HelpWell's own message.
  - `attachments` with an `https` URL are passed through.
- **`handled: false`** means the widget shows HelpWell's own transcript.

### `handoff`: the visitor asks for a person

Body `{ "sourceId": "…" }`, always after a `sync`.

- `{ "handled": true }` or `"queued": true` is success.
- Anything else is shown to the visitor as "couldn't reach the team".

### `seen`: read receipts

Body `{ "sourceId": "…", "messageIds": ["…"] }`: 1 to 100 ids of `human` messages the visitor has seen.

### `playbook`: approved guidance for the AI

Body `{}`. Answer `{ "handled": true, "text": "…" }`, up to 40,000 characters.

- The text is added to the AI's instructions.
- The client reuses it for a minute.
- `helpwell link` also calls this action to check the connection.

### `proactive`: what to show this visitor now

```json
{
  "contactSourceId": "con_…",
  "anonymousId": "b_k3j…",
  "path": "/billing?tab=invoices",
  "identified": false,
  "device": "mobile",
  "referrer": "https://news.example.com/post",
  "utm": { "source": "newsletter", "medium": "email", "campaign": "launch" },
  "locale": "en-GB"
}
```

`contactSourceId` is `null` for a visitor HelpWell has no contact for yet. `anonymousId` is a random id the widget keeps in the browser. `device`, `referrer`, `utm` and `locale` are what the widget knows about the visit, the same values Settings engagements are targeted on; each is left out when unknown. The referrer and UTM values are the ones the visit landed with. Answer `{ "handled": true, "items": [ … ] }` with the items described under [Proactive messages](#proactive-messages), or `{ "handled": false }` for nothing. Answer an unknown contact with `handled: false`, not a 404.

### `proactive-event`: what the visitor did with an item

```json
{ "id": "hello_1", "event": "seen", "contactSourceId": "con_…", "anonymousId": "b_k3j…" }
```

`event` is `seen`, `clicked` or `dismissed`. Each is sent once per item and visitor.

### `typing`: the visitor is typing

Body `{ "sourceId": "…", "typing": true }`, at most one every three seconds, then `false` when they stop. Answer `{ "handled": true }`. Nothing is queued: typing that could not be delivered is not shown.

### `presence`: what the widget shows under the conversation

Body `{ "sourceId": "…" }`. Answer `{ "handled": true, "presence": { "typing": { "name": "Maya" } | null, "seenUpTo": "…", "notice": { "text": "…", "askEmail": true } } }`. The widget asks every few seconds while it is open. Anything the client cannot read, or `handled: false`, is nobody typing and no notice.

### `upload`: a file the visitor attached

The one action that is not JSON. The body is the file's bytes, and what it is goes in headers:

```text
POST {url}/bridge/{product}/upload
Authorization: Bearer {token}
Content-Type: application/octet-stream
X-HelpWell-Source-Id: {URI-encoded conversation id}
X-HelpWell-Filename: {URI-encoded file name}
X-HelpWell-Type: {the media type HelpWell read from the bytes}
```

HelpWell checks ownership, size and the file's real type first, never sends HTML, SVG, XML or script, and mirrors the conversation (`sync`) just before. Answer `201` with `{ "handled": true, "attachment": { "id", "url", "name", "type", "size" } }`; the `url` must be `https`. A `400` with a message refuses the file, and the visitor reads that message ("That file is larger than 10 MB."). An upload is never queued: the visitor is told it did not go through.

### `form-submitted`: someone submitted a form

The body is the submission, as `SupportExtension.formSubmitted` receives it (`FormSubmissionEvent` in `@helpwell/core/api`): the form, the person, their consent, the abuse verdict, where it came from, and any giveaway entry. Sent once per trusted submission, from the durable retry queue, so it can arrive more than once: deduplicate on `id`. Answer `{ "handled": true }`. An outage is retried; a `404` means the service takes no submissions.

### `agent-overrides`: steer the AI

Body `{}`. Answer:

```json
{ "handled": true, "tools": { "collect_email": false }, "instructions": "Mention the October sale when someone asks about pricing." }
```

- **`tools`** switches the agent's tools off by the names the model sees: `search_docs`, `read_changelog`, `look_up_user`, `collect_email`, `mark_unresolved`, `suggest_article`. `true` never switches on a tool the install's Settings switched off.
- **`instructions`** (up to 8,000 characters) are added after the install's own instructions.
- **`name`** (one line, up to 60 characters) replaces the agent's name from Settings: in the widget's config, in the agent's instructions, and on a help centre's "Ask" buttons when it is given the same overrides. Without it the name in Settings stays.
- Asked before the AI answers and for the widget's config, and reused for a minute. Any failure means no overrides.

### `content-sync`: what this install has published

HelpWell pushes this; the service cannot call into the install. Sent soon after the content changes (an article saved in the dashboard, a release published, a tour added) and at least once an hour while the install is serving requests. `helpwell sync` sends it itself straight after indexing, when the project is linked (the URL and product from `helpwell link`, or all three `HELPWELL_SUPPORT_*` values) and `HELPWELL_SUPPORT_TOKEN` is set where it runs; a push that fails never fails the sync. The body is the manifest (`ContentManifest` in `@helpwell/core/api`):

```json
{
  "version": 1,
  "generatedAt": "2026-10-01T09:00:00.000Z",
  "fingerprint": "5d41402abc4b2a76b9719d911017c592",
  "product": { "name": "Acme", "helpCenterUrl": "https://app.acme.com/help" },
  "articles": [
    {
      "slug": "billing/invoices",
      "title": "Exporting invoices",
      "description": "How to export",
      "collection": "billing",
      "url": "https://app.acme.com/help/billing/invoices",
      "updatedAt": "2026-09-30T16:00:00.000Z",
      "excerpt": "Open Billing, then Invoices…"
    }
  ],
  "changelog": [
    { "id": "rel_1", "version": "2.4.0", "title": "Faster exports", "date": "2026-09-30T09:00:00.000Z", "url": "https://app.acme.com/help/changelog/2.4.0", "summary": "Exports are twice as fast." }
  ],
  "roadmap": [{ "id": "idea_1", "title": "Dark mode", "status": "planned", "votes": 12, "url": "https://app.acme.com/help/roadmap" }],
  "catalog": {
    "tours": [{ "id": "setup-tour", "name": "Setting up", "enabled": true }],
    "surveys": [{ "id": "nps", "name": "NPS", "enabled": false }]
  }
}
```

- **Only what the public help center shows:** published articles outside collections for signed-in people only, published changelog entries, and the roadmap.
- **`excerpt`** is the first ~600 characters of the article, as plain text.
- **URLs** are absolute when the help center's address is known (its domain, or the product's address with the help center's path), and `null` otherwise.
- **`catalog`** lists the tours and surveys a proactive item can start by id: a chat button with `action: "tour"` and that id as its `value`.
- **`fingerprint`** changes whenever anything else does. Answer `{ "handled": true }`.

A host that indexes content itself (`syncContent`) can push straight away with `pushContentSync(support, await buildContentManifest(db, settings))`.

## Proactive messages

The open-source build sends nothing on its own. A support extension that wants a visitor to see something (a teammate saying hello, the agent offering help on the billing page, a pop-up a journey chose) returns it from `proactive`, and the widget pulls it.

- **When.** On page load, on each route change in a single-page app, and once a minute while the page is visible.
- **How.** Through `GET /proactive`, which caches each visitor's answer for 15 seconds.
- **Only when offered.** The widget asks only when `/config` says `support.proactive: true`, which is when the extension implements `proactive`.

### Chat items

```json
{
  "kind": "chat",
  "id": "hello_1",
  "sender": { "name": "Maya", "avatarUrl": "https://…/maya.png", "isAgent": false },
  "blocks": [
    { "type": "text", "markdown": "Hi {{first_name|there}}, saw you on the pricing page. Any questions?" },
    { "type": "buttons", "buttons": [
      { "label": "Yes, one", "action": "reply" },
      { "label": "Show me around", "action": "tour", "value": "setup-tour" }
    ] }
  ],
  "replyable": true,
  "display": "bubble",
  "triggers": [{ "type": "scroll", "percent": 60 }, { "type": "exit" }]
}
```

**What the visitor sees**

- With `display: "bubble"` (the default), an incoming bubble above the launcher, with a count on the launcher.
- With `display: "messenger"`, the widget's panel opens on a chat holding the message, as if it had just arrived. If the visitor already has the panel open, it waits as a bubble instead. It is shown this way once: seen, it is not offered again.
- The sender's avatar: their photo, their initials, or for the agent (`isAgent: true`) the product's mark.

**When**

- On page load, unless the item has a `trigger`, or `triggers` (any of them, whichever fires first), in the engagement trigger format: `delay`, `scroll`, `exit`, `time_on_page`, `inactivity`, `click` or `event`. `manual` is dropped, and an item whose triggers are all unusable is not shown.

**Blocks**

- `blocks` use the engagement block format: `text` (Markdown), `image`, `gif`, `video`, `buttons` (up to three) and `divider`, with the same link and media rules.
- A button can open a link (`url`), open the chat (`chat`), open an article (`article`), start one of the install's tours (`tour`, by an id from the `content-sync` catalog; any other id is dropped), dismiss the bubble (`dismiss`), or send a quick reply (`reply`).
- **Quick replies.** A `reply` button sends its `value`, or its label when there is none, as the visitor's first message, which starts the conversation as any reply does. Only on a `replyable` message.
- **Personalisation.** Text and labels can carry `{{field}}` or `{{field|fallback}}`: `first_name`, `last_name`, `name`, `email`, or any identify attribute. The widget fills them in as text, with values HelpWell sends only for a visitor the host app identified; anyone else sees the fallback. The message stored when a conversation starts is filled in the same way.

**Replying**

- Opening a `replyable` item starts a conversation with the message already in it. The visitor's first reply reaches `handleMessage` with `proactiveId` set.
- HelpWell passes a `proactiveId` only for an item it showed that visitor in the last seven days. It is used once.
- When the agent sent the message, it is stored as the conversation's first message, so the AI answers "yes please" knowing what was offered.
- When a teammate sent it, it is not stored, because the extension owns teammates' messages. It is given to the AI as context for that first answer.

### Engagement items

```json
{ "kind": "engagement", "id": "launch_1", "definition": { "kind": "modal", "trigger": { "type": "delay", "seconds": 3 }, "modal": { "slides": [{ "blocks": [ … ] }] } } }
```

- **Format.** `definition` is an engagement in the same format as `engage.engagements` in Settings: a modal, banner, hotspot, tour or survey.
  - HelpWell validates it and drops it if it is invalid.
  - It ignores the definition's targeting and schedule: the extension already chose this visitor.
  - It gives the engagement the id `proactive:<id>`.
- **Drawing.** The widget hands it to the same engage controller as Settings engagements, which arms its triggers (`triggers`, or the single `trigger`) and draws it, so the two kinds take turns on screen.
- **Claiming.** Before drawing, the widget claims it through `POST /engage/proactive:<id>/show` (or `POST /proactive/:id/show`), which applies the global engage cap (`engage.limits`). The cap counts both kinds in both directions: an extension's pop-up counts against a Settings one, and the other way round. Hotspots count for neither.
- **Recording.** Impressions are recorded under `proactive:<id>`, and the extension hears `seen`, `clicked` and `dismissed`.
- **Tours** it starts resume after a reload, as Settings tours do, until they are finished or closed.
- **Once only.** An engagement item is shown once. When engage is switched off in Settings, engagement items are dropped and chat items still show.

### Limits

- **Items.** At most 10 per answer, and at most 3 chat bubbles at once.
- **Ids.** An id is 1 to 64 letters, digits, `_`, `-`, `.` or `:`.
- **What stays gone.** A dismissed or opened chat item, and a shown or dismissed engagement item, is not shown to that visitor again, whatever the extension returns.
- **Where it is recorded.** Everything shown is recorded in `helpwell.proactive_deliveries` against the visitor's contact. A visitor without one gets one the first time there is something to show.

## Writing an in-process extension

Implement `SupportExtension` from `@helpwell/core/api`.

- **Required members:** `handleMessage`, `afterReply`, `handoff` and `thread`.
- **Optional members:** everything else. Each one switches on the matching feature and is absent otherwise:
  - `markSeen`, `playbook`, `typing` and `presence`;
  - `uploads` with `upload`;
  - `contactCaptured`;
  - `proactive` and `proactiveEvent`;
  - `formSubmitted`;
  - `agentOverrides`, which returns `{ tools?, instructions?, name? }` or null: `name` renames the agent in the widget, the help centre and its own instructions;
  - `contentSync`, which receives the content manifest, and `catalog`, which receives only its tours and surveys.
- **Ownership.** HelpWell checks it before calling you. Throw a `HelpWellError('forbidden', …)` only if you know better.
- **Failures.** Anything else you throw is handled as the table under [Failing open](#failing-open) says.

## Set this up with an AI assistant

`helpwell link --prompt` prints this with your real values. It contains no token.

````markdown
You are helping me set up the remote support extension for Acme's HelpWell server. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

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
| HELPWELL_SUPPORT_URL | https://support.example.com/api |
| HELPWELL_SUPPORT_PRODUCT | YOUR-PRODUCT-ID |
| HELPWELL_SUPPORT_TOKEN | — |

The same values as JSON:

```json
[
  {
    "Variable": "HELPWELL_SUPPORT_URL",
    "Value": "https://support.example.com/api"
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
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://support.example.com/api/bridge/YOUR-PRODUCT-ID/playbook" -H "Authorization: Bearer $HELPWELL_SUPPORT_TOKEN" -H "content-type: application/json" -d '{}'
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
