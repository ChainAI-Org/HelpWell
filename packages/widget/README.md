# @helpwell/widget

The HelpWell support widget. One script tag mounts a Shadow DOM panel with chat, the help center, your changelog and your roadmap.

```html
<script src="/api/helpwell/assets/loader.js" defer></script>
```

The loader is under 1 KB, waits for the page to finish loading, and only then fetches the bundle. Import `Widget` from this package instead if you would rather control it from your own code.

The loader finds the API from its own address, host included. Served from `https://app.acme.com/api/helpwell/assets/loader.js`, it calls `https://app.acme.com/api/helpwell` whichever site the page is on, so a site on another domain uses the same tag with the full URL. A few attributes on the tag change what it does:

| Attribute | What it does |
|:--|:--|
| `data-api` | Where the API is. Only needed when the API lives somewhere other than where the script is served from, a copy of the loader on a CDN say. A relative value resolves against the page. |
| `data-src` | Where the bundle is, when it is not the loader's sibling `widget.js`. |
| `data-token` | A signed identity from your server, the same as `helpwell('identify', token)`. |
| `data-open="true"` | Opens the panel as soon as it is ready. |
| `data-theme` | `light`, `dark` or `system`, in place of the theme in Settings. |
| `data-mode="forms"` | Forms only: no launcher and no panel. |

## Talking to it

Everything goes through `window.helpwell(...)`, which queues until the widget has mounted:

```js
helpwell('identify', token); // a signed identity from your server
helpwell('open');            // also 'close', 'toggle'
helpwell('track', 'invoice.exported', { count: 3 });
helpwell('reset');           // call this on sign-out
helpwell('destroy');
```

`reset` forgets the visitor on the server (`POST /visitor/reset`) and clears the conversation and identity in the widget, so the next person at a shared computer starts clean rather than in someone else's thread.

### An API on another site

The visitor is normally a cookie the API sets. When the API is on another origin than the page (a hosted API, say, with the widget on your own domain), browsers such as Safari block or partition that cookie, so the widget carries the visitor in an `X-HelpWell-Visitor` header instead. It keeps the signed token the API answers with in `localStorage`, under the API's address, sends it on every call, and forgets it on `reset` or when the API says to. Nothing changes on the same origin: the cookie alone does the job there. The API must list your site in `corsOrigins`, and the tag loads the loader from the API's full address; it needs no `data-api`. `new Api({ baseUrl, visitorToken })` forces it either way.

One event lands on `window`: `helpwell:ready`, once the widget has mounted, with `{ widget }`.

## Home

The words at the top of Home are `widget.greeting`. Left empty, the widget says "Hi there" (or "Hi Ada" for a visitor your app identified by first name) over "How can we help with {product}?". Set `title` and `subtitle` to say something else. `{{ product.name }}` is your product's name, and `{{ contact.first_name }}` is the visitor's first name, or "there" when your app has not said; `{{ contact.first_name | default: "friend" }}` picks another word. Only these two are filled in; anything else in braces is shown as written. The original `{product}` and `{first_name}` keep working.

```json
{
  "widget": {
    "greeting": {
      "title": "Welcome, {{ contact.first_name }}",
      "subtitle": "Ask us anything about {{ product.name }}."
    }
  }
}
```

The Home tab is a list of blocks, drawn in order, set in `widget.home.blocks` (in `helpwell/helpwell.config.json` or the dashboard). The default is what Home has always shown: search, the open conversation, a button to ask, what's new, and status.

```json
{
  "widget": {
    "home": {
      "blocks": [
        { "type": "search" },
        { "type": "conversation" },
        { "type": "newConversation" },
        { "type": "articles", "title": "Start here", "slugs": ["getting-started/install"] },
        { "type": "links", "title": "Elsewhere", "items": [{ "label": "API reference", "url": "https://acme.com/api", "icon": "article" }] },
        { "type": "card", "title": "Office hours", "body": "Thursdays at 4pm.", "image": "https://acme.com/office.png", "cta": { "label": "Book a slot", "url": "https://acme.com/book" } },
        { "type": "updates", "count": 3 },
        { "type": "status" }
      ]
    }
  }
}
```

`articles` takes a `collection` or a list of `slugs`, and a `limit`. A block type the widget does not know is skipped. Code that ships its own block registers a renderer:

```ts
import { registerHomeBlock } from '@helpwell/widget';

registerHomeBlock('form', (block, context) => {
  // Return an element, or null to draw nothing.
});
```

## Media in answers and articles

Answers, replies from your team, articles and updates all go through the same Markdown renderer as the help center. On top of it, the widget:

- loads images only from https (or your own site), lazily, always with alt text, and opens them in a lightbox on click. GIFs work;
- plays video files in place;
- shows YouTube, Vimeo, Loom and Wistia as a card that opens the video on the provider's site.

Set `widget.media.inlineVideo` to `true` to play those four in the panel instead. Nothing loads from the provider until the visitor presses play, and YouTube plays from its no-cookie domain. Your page's Content-Security-Policy then has to allow the players in `frame-src` (see below).

## Changelog announcements

`changelog.notification` picks how new entries are announced:

| Style | What the visitor sees |
|:--|:--|
| `badge` | A count on the launcher and a dot on the Updates tab. The default. |
| `popup` | The badge, plus a small card above the launcher for the newest entry. |
| `modal` | The badge, plus the newest entry in a dialog over the page. |
| `drawer` | The badge, plus a panel from the side of the page listing what is new. |
| `embed` | A feed inside your own page, wherever you put `<div data-helpwell-changelog></div>`, with "New" on unread entries. No launcher badge. |
| `none` | Nothing. |

The inline feed renders wherever the element is, for every style but `none`. `data-limit="10"` changes how many entries it shows (5 by default). Popups, modals and drawers wait until the page has settled, never cover the open panel, and show once: dismissing one marks what it showed as read.

"New" is tracked per visitor on the server once they have a HelpWell cookie. Before that, the browser keeps the record in `localStorage`.

## Status

Set `widget.statusUrl` to your status page and Home shows a status row, with a small dot on the launcher while something is wrong. HelpWell reads Atlassian Statuspage, Instatus and Better Stack pages, on the server, cached for a minute. It only fetches public https addresses. Set `widget.status.mode` to `manual` with a `level` and `message` to say it yourself.

## Email capture

When the agent needs an address to follow up (its `collect_email` tool), an email card appears in the thread under that answer. It shows the consent line from `widget.preChat.consentLine` and saves the address on the visitor's contact, not as a chat message. After that it folds down to "Thanks, we'll use you@example.com for this conversation", with a link to change it. With `widget.preChat.timing` set to `after`, the same card appears under the first answer. Visitors your app identified never see it. Blocked domains and disposable addresses are refused with the same rules as chat.

HelpWell itself sends no email. The address is there for your team.

## Previewing states

Some moments are hard to wait for: a message over the launcher, an answer with its source, the email card, a banner. `helpwell.widget.preview` shows each one on demand, from made-up local data, for a page that wants to show them (a settings screen beside a live widget, say).

```js
const { preview } = helpwell.widget;
preview.states;                         // [{ id: 'launcher', label: 'Launcher closed' }, ...]
await preview.show('badge', { count: 3 }); // the launcher with an unread badge
await preview.show('answer');           // an AI answer with the article it came from
preview.reset();                        // back to how the widget was
```

The states are `launcher`, `badge` (`count`: a number over 9 reads "9+"), `opening` (the panel's opening animation, again each time), `teammate`, `stacked`, `proactive`, `answer`, `email`, `banner` and `popup`. Each is drawn by the code a visitor's widget uses. Nothing is fetched, sent or stored: no conversation, visitor or contact is made, and a button in a made-up message only opens a chat that is on screen. One state shows at a time, and any live content (a support extension's messages, engagements) stands aside until `reset()`.

## Bot check (Cloudflare Turnstile)

With the bot check on, the widget runs a Cloudflare Turnstile challenge before the first message of each conversation, and the server verifies it before anything is stored or any model is called. A conversation proves itself once: later messages, and the email card on the same thread, need no second challenge. Most visitors never see the challenge; when Cloudflare wants a click, it appears above the composer.

1. In Cloudflare, open Turnstile and add a site with every domain the widget runs on. Choose Managed mode.
2. In the HelpWell dashboard, set Bot check to Turnstile and paste the site key.
3. Set the secret key as `HELPWELL_TURNSTILE_SECRET` in the server's environment (or pass `turnstile: { secret }` to `createHelpWellHandler`, or `env` for a host running many installs, each with its own), and restart. The secret never goes in settings.
4. If your site sends a Content-Security-Policy, add `https://challenges.cloudflare.com` to `script-src` and `frame-src`.

The check stays off until both keys are set, so a missing secret never locks visitors out. Nothing is loaded from Cloudflare while it is off.

Server code can use the same check for its own forms:

```ts
import { requireHuman } from '@helpwell/core/api';

await requireHuman(body.turnstileToken, context); // throws a 403 unless it passes
```

### Set this up with an AI assistant

Paste this into ChatGPT, Claude or a coding agent. Fill in your product name and URL where it says so.

````text
You are helping me set up the Cloudflare Turnstile bot check on my HelpWell support widget. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

The HelpWell widget runs a Cloudflare Turnstile challenge before the first message of each conversation, and the HelpWell server verifies it. A message sent without a challenge is refused, and a real one from the widget goes through.

## What you need to know

- The HelpWell API is mounted at /api/helpwell. The widget only loads Turnstile (https://challenges.cloudflare.com) while the bot check is on.
- The site key is public: it goes in the HelpWell dashboard. The secret key is private: it only ever goes in the server environment, as HELPWELL_TURNSTILE_SECRET. The bot check stays off until both are set.
- A conversation proves itself once. Later messages in it, and the email a visitor leaves on it, need no second challenge.

## Steps

1. In the Cloudflare dashboard, open Turnstile and add a widget (a "site") named after the product.
2. Add every domain the HelpWell widget appears on, including staging. Cloudflare lets localhost through on its test keys only.
3. Choose the Managed widget mode.
4. Copy the site key. Tell me to paste it in the HelpWell dashboard under Settings, Abuse, set Bot check to Turnstile, and save.
5. Tell me to add the secret key myself, as the environment variable HELPWELL_TURNSTILE_SECRET on the server that runs HelpWell, and then to restart or redeploy it. Do not ask me for the secret.
6. If the site sends a Content-Security-Policy, add https://challenges.cloudflare.com to script-src and frame-src.

## Exact values

### Values

| setting | value |
| --- | --- |
| Turnstile widget mode | Managed |
| HelpWell dashboard | Settings, Abuse: Bot check = Turnstile, site key |
| Server environment variable | HELPWELL_TURNSTILE_SECRET |
| CSP script-src | https://challenges.cloudflare.com |
| CSP frame-src | https://challenges.cloudflare.com |

The same values as JSON:

```json
[
  {
    "setting": "Turnstile widget mode",
    "value": "Managed"
  },
  {
    "setting": "HelpWell dashboard",
    "value": "Settings, Abuse: Bot check = Turnstile, site key"
  },
  {
    "setting": "Server environment variable",
    "value": "HELPWELL_TURNSTILE_SECRET"
  },
  {
    "setting": "CSP script-src",
    "value": "https://challenges.cloudflare.com"
  },
  {
    "setting": "CSP frame-src",
    "value": "https://challenges.cloudflare.com"
  }
]
```

## Use exactly as written

The widget is told to run a challenge (expect "botCheck" with the site key):

```bash
curl -s https://your-app.example/api/helpwell/config | grep -o '"botCheck":{[^}]*}'
```

A message without a challenge is refused (expect a 403 with "humanCheck":"missing"):

```bash
curl -s -X POST https://your-app.example/api/helpwell/chat -H 'content-type: application/json' -d '{"message":"bot check test"}'
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Never put the secret key in the dashboard, the config file, the repo or this chat.

## Check your work

1. The first curl prints a botCheck object with provider "turnstile".
2. The second curl answers with an error whose details say humanCheck "missing".
3. In a browser, send a test message from the widget: it gets an answer. The dashboard shows "secret set in environment: yes".

## When you are done

List the domains you added in Cloudflare, say whether the CSP needed changes, and paste the output of both curl commands.
````

## Content-Security-Policy

If your site sends a Content-Security-Policy, the widget needs these sources. `'self'` assumes the API is on the same site as your pages, which is the usual install.

| Directive | Add | Why |
|:--|:--|:--|
| `script-src` | `'self'` | The loader and the widget bundle. |
| `connect-src` | `'self'` | The widget's API calls. |
| `style-src` | `'unsafe-inline'` | The widget's styles are a `<style>` element in its Shadow DOM. |
| `img-src` | `'self' https:` | Screenshots and images in answers and articles. |
| `media-src` | `'self' https:` | Videos in articles. |
| `frame-src` | `https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://fast.wistia.net` | Only with `widget.media.inlineVideo` on. |
| `script-src`, `frame-src` | `https://challenges.cloudflare.com` | Only with the bot check on. |

`widgetCspPromptSpec()` from `@helpwell/core` builds a setup prompt with exactly the rows your settings need.

## Human support, attachments and typing

Open source has no inbox and stores no customer files. A host that supplies a `SupportExtension` to `createHelpWellHandler({ support })` switches these on, one optional member at a time:

- `handoff`, `thread`, `handleMessage`: the "Talk to a person" button, and replies from your team in the thread;
- `typing` and `presence`: "Maya is typing…", "Seen" under the last message they read, and a line of their own (with `askEmail`, the email card too). The widget polls every 3 seconds while the panel is in use, every 15 when idle, and not at all in a hidden tab;
- `uploads` and `upload`: the paperclip, drag-and-drop and pasted screenshots. HelpWell checks ownership, size and the file's real type from its bytes before `upload` is called, and never accepts HTML, SVG or script;
- `contactCaptured`: told when a visitor leaves an email on the card.

Without an extension none of these appear.

Part of [HelpWell](https://github.com/ChainAI-Org/HelpWell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/HelpWell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
