# Engage

Modals, banners, hotspots, tours and surveys, shown to the right people, on
the right pages, at the right moment. You build them in the dashboard
(**Engage**), with a live preview drawn by the widget itself. They are saved
in settings, so `helpwell settings pull` puts them in
`helpwell/helpwell.config.json`, where they are reviewed like code, and
`helpwell sync` sends them back.

Nothing here sends email, and HelpWell sends no chat messages of its own:
both would need an outbound sender, which HelpWell does not have. A support
extension can send chat messages and engagements of its own, which the
widget shows alongside these, under the same global cap
([support-extension.md](support-extension.md#proactive-messages)).

## What each kind is

Every message box is a list of **blocks**, so every kind can carry media:

| Block | Fields |
| --- | --- |
| `text` | `markdown`, rendered by the same safe renderer as articles. It can be personalised with `{{field}}` (see [Personalisation](#personalisation)) |
| `image` | `url` (https, or an uploaded file), `alt`, and an optional `link` |
| `gif` | `url`, `alt`. It is held still behind a button for people who ask for less motion |
| `video` | `url` (YouTube, Vimeo, Loom, Wistia, or an mp4 or webm file), `title`. Nothing loads from the video host until the visitor presses play |
| `buttons` | one or two `{ label, action, value, style, newTab }` |
| `divider` | nothing |

A button's `action` is one of:

- `url`: go to `value`;
- `dismiss`;
- `next`: the next slide or tour step;
- `tour`: start the tour whose id is `value`;
- `chat`: open the support chat;
- `article`: open the article whose slug is `value`.

### Modal

- `modal.slides` holds one or more `{ blocks }`.
- More than one slide is a carousel, with dots, Back and Next, swiping, and
  the arrow keys. The last slide's buttons are its call to action.
- `modal.size` is `small`, `medium`, `large` or `full`.
- `modal.mediaPosition` puts a slide's first image, GIF or video at the
  `top`, at the `side`, or in the `background`.
- `modal.progress` is how a carousel shows where the visitor is: `dots`, a
  `bar`, or a `count` ("2 of 4").

### Banner

- `banner.blocks` is the content.
- It sits at the `top` or `bottom`, and is `inline` (it pushes the page) or
  `floating`.
- Its tone is `accent`, `neutral`, `warning` or `custom`. A custom tone takes
  `background` and `color` as hex colours.
- `banner.sticky` (on by default) keeps it in view while the page scrolls.
  Off, a top banner scrolls away with the top of the page, and a bottom one
  waits at the end of it.
- `banner.countdown` counts down to `until` (a date and time) after the
  text, as "2d 04h 12m 09s". At zero the banner goes (`onEnd: "hide"`, the
  default) or stays showing zero (`"keep"`). A banner whose countdown has
  already run out and hides is not shown at all. In the editor the date is
  in the time zone from Settings.

### Hotspot

- A beacon on `hotspot.target`, a CSS selector. `hotspot.beacon` is a
  pulsing ring (`pulse`), a still `dot`, or a `question` mark badge.
- It opens a tooltip of `hotspot.blocks`, placed `auto`, `top`, `right`,
  `bottom` or `left`.
- It waits up to ten seconds for the element to render.

### Tour

`tour.steps` holds the steps, each `{ target, placement, page, advance, url, blocks }`.

- **Where tooltips sit.** `tour.placement` (`auto`, `top`, `right`,
  `bottom` or `left`) places every step's tooltip. A step's own
  `placement` is `tour` to follow it, which is the default, or a side of
  its own.

- **Moving on.** A step moves on by one of three things:
  - its Next button (`advance: "next"`);
  - a click on its element (`"click"`);
  - the visitor reaching a page that matches `url` (`"url"`). This is how a
    tour crosses pages.
- **Pinning a step.** `page` pins a step to a page. A resumed tour then waits
  on other pages instead of skipping the step.
- **Resuming.** Progress is kept in the browser, so a tour picks up where it
  was left.
- **Missing elements.** `tour.missingTarget` sets how long to wait for an
  element that is not there (`waitSeconds`), and then whether to `skip` the
  step or `stop` the tour (`action`).
- **Parts.** `spotlight`, `showProgress` and `allowSkip` switch those parts
  on or off.

### Survey

- `survey.questions` holds up to twenty questions.
- Each question is one of six kinds: `nps` (0 to 10), `csat` (1 to 5),
  `stars`, `single`, `multi` or `text`.
- `survey.intro` and `survey.thankYou` are blocks.
- `survey.placement` is a `corner` card, a `center`d dialog, or a `bar`
  along the bottom of the page.
- `survey.theme` is `brand` (white, with your accent colour), `light`
  (white and grey only) or `dark`.
- **Branching.** A question can branch: the first `{ choices }` or
  `{ min, max }` that matches the answer goes to `goto`, which is a later
  question or `end`.
- **Follow-up.** A score question can ask a follow-up comment, either of
  everyone or of detractors only (NPS 0 to 6, CSAT and stars 1 to 2).
- **Storage.** Each answer is stored the moment it is given, per question,
  tied together by a session id.

### Older configs

A config written for the first version, with `title`, `body`, `cta`, `paths`,
`audience` and `delayMs`, is upgraded to this shape when it is read, so it
keeps working.

```jsonc
{
  "engage": {
    "enabled": true,
    // The global cap, counted on the server. Hotspots do not count. 0 is no limit.
    "limits": { "perSession": 1, "perDay": 3, "minMinutesBetween": 10 },
    "engagements": [
      {
        "id": "reports-launch",
        "kind": "modal",
        "name": "Reports launch",
        "modal": {
          "size": "medium",
          "slides": [
            { "blocks": [
              { "type": "image", "url": "https://cdn.example.com/reports.png", "alt": "The reports page" },
              { "type": "text", "markdown": "## Meet reports\n\nSee how your team is doing." }
            ] },
            { "blocks": [
              { "type": "text", "markdown": "### Ready when you are" },
              { "type": "buttons", "buttons": [{ "label": "Create a report", "action": "url", "value": "/reports/new" }] }
            ] }
          ]
        },
        "targeting": {
          "audience": "identified",
          "conditions": { "all": [{ "field": "plan", "op": "is", "value": "pro" }] },
          "pages": { "include": ["/app/**"], "exclude": ["/app/billing"] }
        },
        "triggers": [{ "type": "delay", "seconds": 5 }, { "type": "exit" }],
        "schedule": { "start": "2026-10-01T09:00:00.000Z", "end": null },
        "frequency": "once",
        "priority": 50
      }
    ]
  }
}
```

## Who, where and when

### Who

`targeting.audience`, `conditions` and `segmentId` decide who sees it.

- The audience is everyone, signed-in people only, or anonymous visitors only.
- Contact conditions narrow it further. They use the same rule language as
  the contacts filter and segments.
- A saved segment narrows it too.
- An anonymous visitor has no attributes and is in no segment.

### Where

These all live under `targeting`:

- `pages`: path patterns. `*` matches within one part of a path and `**`
  across parts. Exclusions win.
- `referrer`: part of the referring address.
- `utm`: UTM values from the landing page, kept for the rest of the visit.
- `devices`: `desktop`, `mobile` or both.
- `languages`: browser language prefixes.

### When

`triggers` is a list of one to five triggers. Whichever fires first shows
it, and the rest are taken down. A config with the single `trigger` an
earlier version wrote is read as a list of one.

| `type` | Fields | Fires |
| --- | --- | --- |
| `load` | | as soon as the page loads |
| `delay` | `seconds` | that long after the page loads |
| `scroll` | `percent` | once the visitor has scrolled that far down |
| `exit` | | when the pointer leaves through the top of the window, on a desktop |
| `time_on_page` | `seconds` | after that long with the tab visible |
| `inactivity` | `seconds` | after that long without a click, key, scroll or touch |
| `click` | `selector` | when something matching the selector is clicked |
| `event` | `name` | when your app calls `helpwell('track', name)` |
| `manual` | | only when your app calls `helpwell.engage.show(id)` |

### Schedule, frequency and priority

- `schedule` has a `start` and an `end`.
- `frequency` is `"once"`, `"always"` or `{ "everyDays": 30 }`. Whatever it
  says, closing or finishing an engagement ends it for that person.
- `priority` decides which goes first when several qualify. Only one modal,
  survey or tour is on screen at a time; the rest wait their turn.

### Personalisation

Text, button labels and survey questions can carry `{{field}}`, filled in
from the visitor's contact record as the widget draws them:

```markdown
## Hi {{first_name|there}}

Your {{plan}} trial ends on Friday.
```

- A field is `first_name`, `last_name`, `name` or `email`, or any
  attribute your app sends with identify (`plan`, `company`...).
  `first_name` falls back to the first word of the name.
- What follows `|` is what is said when there is no value. With no fallback,
  a field with no value says nothing.
- Values are only sent for a visitor your app identified, and only for the
  fields the engagement uses. Anyone else sees the fallbacks.
- A value is always drawn as text. A name with Markdown in it cannot become
  a link or a heading.
- Survey choices are not personalised, because answers are stored against
  them.

In the editor, the **@** button on the text toolbar inserts a field, and the
preview fills fields with sample values.

### Where each rule is checked

1. When the page asks what it could show, the server checks who and where.
2. The trigger runs in the browser.
3. When the trigger fires, the widget claims the engagement. The server
   applies the frequency rule and the global cap, and records it as seen.
   The cap counts the engagements a support extension sent too, and theirs
   count yours.
4. Only then is it drawn.

## From your own code

```js
helpwell('track', 'project_created'); // fires event triggers, and is kept on the contact
helpwell.engage.show('reports-launch'); // show one now; who and schedule still apply
helpwell.engage.hide();                 // take everything off the screen
// The queued forms, which work before the widget has loaded:
helpwell('engage.show', 'reports-launch');
helpwell('engage.hide');
```

### Set this up with an AI assistant

The dashboard shows this prompt under **When**, filled in with the
engagement you are editing. This is the one for an event trigger:

<!-- generated:prompt:engage-code (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up a custom event trigger for a HelpWell engagement in our product. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

When "project_created" happens in the app, the page tells HelpWell, and the engagement "first-project" appears for the people it targets.

## What you need to know

- our product has the HelpWell widget installed: a <script src="/api/helpwell/assets/loader.js" defer></script> tag in the page layout. It defines a global `helpwell` function as soon as it runs, and queues calls made before the widget has loaded, so calling it early is safe.
- Calls never throw and never block the page. If the widget is not on a page, they do nothing.
- An engagement in HelpWell (id "first-project") is set to appear when the page reports the event "project_created". Reporting it is also recorded as a tracked event on the visitor's contact, which segments and conditions can use.

## Steps

1. Find the place in the app's front-end code where "project_created" happens: the success handler of the action, after the server confirms it, not the button's click handler.
2. Add the call below at that point. Keep the event name exactly "project_created": HelpWell matches it character for character.
3. If the code is TypeScript and `window.helpwell` is not typed, add the declaration shown below once, in a global .d.ts file.
4. Do not add the loader script again: it is already in the layout.

## Use exactly as written

The call to add:

```ts
window.helpwell?.('track', 'project_created');
// or, with details kept on the tracked event:
window.helpwell?.('track', 'project_created', { plan: 'pro' });
```

The TypeScript declaration, only if `window.helpwell` is not typed yet:

```ts
declare global {
  interface Window {
    helpwell?: ((method: string, ...args: unknown[]) => void) & {
      engage?: { show(id: string): void; hide(): void };
    };
  }
}
export {};
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Change only the front-end code that has to call the widget. Do not touch the HelpWell config or its API routes.
- Report the event once per time it really happens, not on every render.

## Check your work

1. Open the app in a browser, open the developer console, and run `helpwell('track', 'project_created')`. The engagement should appear (if it has already been dismissed for you, try a private window).
2. Now do the real thing in the app and check that it appears the same way.
3. In the HelpWell dashboard, open Engage, then this engagement's Results: Impressions has gone up.

## When you are done

Tell me which file and function you changed, the exact line you added, and whether both checks passed.
````
<!-- /generated:prompt:engage-code -->

For a manual show, the dashboard gives the same prompt with
`helpwell.engage.show(id)` in place of the `track` call.

## Results

Each engagement's **Results** covers the last 7, 30 or 90 days:

- impressions, clicks, dismissals and completions;
- conversion: a click for a modal, banner or hotspot, and finishing for a tour
  or survey;
- for a tour, how many people reached each step;
- for a survey:
  - the NPS score and its spread;
  - the CSAT and star averages;
  - how often each choice was picked;
  - the comments;
  - every response, with a CSV export.

The admin API serves the same numbers. `@helpwell/sdk` wraps each route:
`admin.engageStats`, `admin.engagementResults`, `admin.surveyResponses` and
`admin.surveyResponsesCsv`.

| Route | Returns |
| --- | --- |
| `GET /admin/engage/stats?range=30d` | counts per engagement |
| `GET /admin/engage/:id/results?range=30d` | counts, tour drop-off and survey results |
| `GET /admin/engage/:id/responses` | survey responses, one per session |
| `GET /admin/engage/:id/responses.csv` | the same, as CSV |

The widget uses five public routes:

- `GET /engage`, which also answers `fields`, the values of the
  placeholders its engagements use
- `GET /engage/:id`
- `POST /engage/:id/show`
- `POST /engage/:id/impression`
- `POST /surveys/:id/response`

A support extension's engagements go through the same routes under their
`proactive:<id>` names, so the widget draws both with one controller: they
take turns on screen, and a tour the extension started resumes after a
reload when the widget asks `GET /engage?resume=proactive:<id>`.

## The editor

Each engagement is edited on one page, in three columns:

1. **The message.** The kind comes first. Then how it looks and where it
   sits, for the whole of it (a modal's layout, size and progress; a
   banner's position and style; a beacon's look; where a tour's tooltips
   sit; a survey's placement and colours). Then its content: slides, steps
   or questions, each with only its own settings.
2. **Who sees it, and when.** The audience, the triggers, the frequency and
   the goal, each summed up in a line. Opening one shows its controls; the
   rest keep their settings. **Or when…** adds another trigger.
3. **The live preview**, pinned while the page scrolls, with the last 30
   days' numbers under it. It shows the slide or tour step being edited,
   with placeholders filled with sample values.

## Uploads and the preview

The editor uploads images and videos into the docs folder, under `_engage/`,
named by a hash of the file. The API serves them at `<api>/media/_engage/…`,
the same way as any article image. Commit them with the docs.

The live preview loads `<api>/assets/engage-preview.js`. The API serves it
when you pass `assets: widgetAssets()` from `@helpwell/widget/server`, the
same way it serves the widget itself.
