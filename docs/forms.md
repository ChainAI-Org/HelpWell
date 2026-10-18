# Forms

Email capture for your site: newsletter sign-ups, lead magnets, discount
codes, giveaways, waitlists, webinar seats, feedback and exit offers. A form
can sit in your page, open from a button, pop up on a trigger, or live on the
widget's Home tab. Every submission is checked for bots before it counts, and
the ones that pass land on a contact, with the answers and the consent they
gave.

You build forms in the dashboard (**Forms**), with a live preview drawn by the
widget's own renderer. They are stored in the database, one version per save,
and **Export JSON** writes one to keep in your repo; **Import** (or
`admin.forms.import`) brings it back.

Nothing here sends email. A confirmation or a delivery email would need an
outbound sender, which HelpWell does not have: the thank-you, the code or the
download link is shown in the form itself, and your own systems can follow up
through the [webhooks](#webhooks) or the [extension hook](#the-extension-hook).

## Where a form shows

| Placement | How it gets there |
| --- | --- |
| Embedded | `<div data-helpwell-form="<id>"></div>` anywhere in a page. It is drawn in place, in its own shadow root, so the page's CSS and the form's never mix |
| Two-step | The embed draws a button; the form opens over the page when it is pressed |
| Pop-up, slide-in, floating bar, welcome mat | Shown by a trigger, to the audience, on the pages you choose (below). The pop-up and the welcome mat are modal: they hold focus and close on Escape |
| A button of your own | Any element with `data-helpwell-form-open="<id>"` opens the form as a pop-up |
| The widget's Home tab | A `form` block in **Settings → Widget → Home**, or **Add it to Home** in the builder |

The script is the widget's loader, once per page:

```html
<script src="/api/helpwell/assets/loader.js" defer></script>
<!-- or, for a site that wants forms and no chat launcher: -->
<script src="/api/helpwell/assets/loader.js" data-mode="forms" defer></script>
```

It finds embeds added later by a single-page app too.

## Building one

The builder has the engage editor's three columns:

1. **The form itself.** Its kind, then:
   - **Placement:** whether it pops up and as what, embedded, two-step, the close button, and the Home tab.
   - **Layout and style:** the picture (none, on top, left, right, or behind), fields stacked or in one row, one or two columns, alignment, the button's style and width, spacing, six colours, the font, corner radius and width, and the overrides **on a phone**.
   - **Content:** text, images, GIFs and video above the fields, and small print under the button.
   - **Fields:** a list you can drag to reorder, each opened on its own.
   - **After they submit**, and for a giveaway, the **Giveaway**.
   - **A/B test**, **Spam and bots**, **Details**, and **Put it on your site**.
2. **Who sees it, and when**: audience, trigger, frequency and goal, each a
   sentence that opens its controls.
3. **The live preview**: Desktop or Mobile, in each placement, before and after
   submitting, with the last 30 days' numbers under it.

Each kind starts from a template: `newsletter`, `lead_magnet`, `coupon`,
`giveaway`, `waitlist`, `webinar`, `feedback`, `exit_offer`, or `custom`. A new
form is saved switched off, so nothing shows until you press **Go live**.

### Fields

Every form has one `email` field, always required. Add any of `name`,
`first_name`, `last_name`, `phone`, `company`, `text`, `textarea`, `number`,
`date`, `dropdown`, `radio`, `checkbox` (one box, or several choices),
`hidden` and `consent`.

- **Saving answers.** A field with **Save the answer on the contact** writes its answer to a contact field (its id, or the one you name). A new field takes its type from the first answer, and appears in the contact field registry, where segments and engage conditions can use it.
- **Hidden fields.** A hidden field holds a fixed value, or captures a UTM parameter, the referrer, the page address or a query parameter.
- **Consent.** A consent box records `granted` or `denied` on the contact, and its wording is kept with the submission, word for word.
- **Tags.** The contact is tagged with the form's `tags` on every accepted submission.

### After they submit

| Action | What the person sees |
| --- | --- |
| `message` | The thank-you blocks |
| `redirect` | The thank-you for a moment, then `redirectUrl` |
| `coupon` | The code, with a copy button. It is sent only with an accepted submission, never with the form |
| `download` | A link that is signed for that submission and expires after `expiresHours`. The file is a URL of yours, or one you upload in the builder |
| `chat` | The thank-you, and the support chat opens |
| `form` | Another form in its place |

An uploaded lead magnet (a PDF, EPUB, ZIP, image or MP4, up to 25 MB) is
named in the definition as `upload:_forms/<hash>.<ext>`. It has no address of
its own: the API hands it out only through the signed link. It is kept in the
install's content source when the host gives one that can be written, and in
the docs folder under `_forms/` otherwise.

## Who, where and when

A pop-up form is targeted with the same rules as an engagement
([docs/engage.md](engage.md#who-where-and-when)): audience, contact
conditions, a segment, pages, referrer, UTM, device and language; a trigger
(page load, a delay, scroll depth, exit intent, time on page, inactivity, a
click, an event your app tracks, or only your code); a schedule, a frequency
and a priority.

- **The shared cap.** Pop-up forms share the cap on interruptions with engagements (**Engage → Limits**), both ways. A form that pops up counts toward it, and so does an engagement.
- **Embeds.** An embed is not an interruption. It shows wherever the element is, to its audience, and does not count toward the cap.
- **Already signed up.** With `suppressSubscribed`, someone who already submitted is not shown it again by a trigger, and an embed shows them the thank-you instead.
- **Checked on the server.** Every rule is checked on the server when the form is drawn. The page never receives the rules, the anti-abuse settings, the coupon code or the download address.

## Spam, bots and the verdict

A form is drawn with a one-time render token, signed by the server. A
submission without it, with a forged or expired one, or with one already used,
is refused. Every submission that is stored carries a **verdict**:

| Check | Refused as |
| --- | --- |
| The hidden bot field was filled in | `honeypot` (quietly: the bot is shown a thank-you) |
| Filled in faster than `abuse.minFillSeconds` | `too_fast` (quietly) |
| More than `abuse.perIpPerHour` from one network, or `abuse.perEmailPerDay` from one address | `rate_limited` (quietly). Past three times the limit it is refused outright |
| The address or its domain is blocked in **Settings → Agent** | `blocked_ip`, `blocked_domain` |
| A throwaway address, when **Settings → Agent** blocks them | `disposable` |
| The domain has no mail server (with `abuse.checkMx`) | `no_mx` |

With the bot check on (**Settings → Agent**, Turnstile), a submission also
needs to pass it.

A submission is **trusted** when it is accepted and not from a throwaway
address. Only trusted submissions:

- count as sign-ups and in conversion;
- earn giveaway entries and referral credit;
- reach the extension hook.

A repeat from the same address is stored as a `duplicate` and does not count
twice.

## Giveaways

- **Entries.** Each person enters once. Their entry has a share link. When a trusted person enters through it, the sharer gets `referralEntries` more, up to `maxEntries`.
- **Bonus actions.** Actions such as "follow us" or "visit this page" add entries. They are self-reported, and the entrant is told so.
- **The draw.** It is weighted by entries and reproducible. It records a seed and a hash of every eligible entry, so anyone with the seed and the entries gets the same winners.
- **Redrawing.** A redraw replaces one winner with a reason. The replaced winner stays in the record.
- **Rules.** Official rules are required, and linked under the button.

The **Giveaway** page lists entrants and winners, draws, redraws,
disqualifies, and exports both as CSV.

## A/B tests

A variant changes only what you fill in: the text above the fields, the
picture, the button's label or colour. Everything else is the form. Traffic
is split by the weights. Each visitor keeps the variant they first saw. The
results give each variant's conversion, and say which is winning and how
sure that is (a two-proportion test, from 30 people per variant).

## Results

**Results** covers 7, 30 or 90 days:

- **Totals:** views, unique views, trusted sign-ups and conversion (trusted over unique views);
- **By day:** sign-ups for each day;
- **By placement and page;**
- **Referrers:** where sign-ups came from;
- **Rejections:** what was refused, and why;
- **Giveaway:** entrants, entries, referrals and the viral coefficient.

**Submissions** lists every one with its verdict, filterable (trusted,
untrusted, rejected, repeats, a search, a variant, a placement, dates), with a
CSV export. Cells a spreadsheet would run as formulas are escaped.

## From your own code

In the browser:

```js
helpwell.forms.show('newsletter');            // open it as a pop-up now
helpwell.forms.on('submit', (event) => {       // after each submission on the page
  console.log(event.formId, event.submissionId, event.status);
});
// The queued form, which works before the widget has loaded:
helpwell('forms.show', 'newsletter');
```

`event.status` is `accepted`, `duplicate`, or `received` for a submission
refused without saying so (treat it as nothing). The page also gets a
`helpwell:form-submit` event on `window`.

On your server, `@helpwell/sdk` wraps the admin API as `admin.forms`:

```ts
const forms = await helpwell.admin.forms({ range: '30d' });
const form = await helpwell.admin.forms.create({ template: 'newsletter', id: 'newsletter' });
await helpwell.admin.forms.update(form.id, { enabled: true });
const csv = await helpwell.admin.forms.submissionsCsv(form.id, { status: 'trusted' });
const draw = await helpwell.admin.forms.draw('launch-giveaway', { count: 3, seed: 'launch-2026' });
```

It also has `get`, `delete`, `duplicate`, `versions`, `restore`, `export`,
`import`, `analytics`, `submissions`, `giveaway`, `redraw`, `disqualify` and
`prompts`. The routes are under `/admin/forms`.

### Webhooks

- **`form.submitted`.** Fires for every accepted submission, trusted or not. It has the answers, the consent, the page, the UTM parameters and the verdict, with `trusted` on it.
- **`giveaway.entered`.** Fires for each giveaway entry.

### The extension hook

A support extension can implement `formSubmitted(submission)`. It is called
once for each trusted submission, through the same durable queue as the
extension's other calls, so a failure is retried rather than lost. The
payload:

```ts
interface FormSubmissionEvent {
  id: string;                 // the submission
  formId: string;
  formName: string;
  formType: FormType;
  formVersion: number;
  variant: string;
  placement: FormPlacement;
  submittedAt: string;        // ISO 8601
  contactId: string;
  email: string;
  name: string | null;
  fields: Record<string, unknown>;      // every answer, by field id
  attributes: Record<string, unknown>;  // what was saved on the contact
  consent: { state: 'granted' | 'denied' | 'none'; text: string | null };
  verdict: FormVerdict;       // every check, and trusted: true
  page: { url: string | null; path: string | null };
  referrer: string | null;
  utm: Partial<Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string>>;
  giveaway: { entryId: string; entries: number; referralCode: string; referredBy: string | null } | null;
}
```

## Set this up with an AI assistant

The builder's **Put it on your site** card has four prompts, filled in with
the form you are editing: plain HTML, Next.js, WordPress, and a button that
opens the form. The trigger's **From your code** option has the button one
too. This is the one for plain HTML:

<!-- generated:prompt:forms-embed (do not edit: `pnpm readme` rewrites it from the code) -->
````md
You are helping me set up embedding the HelpWell form "Newsletter" on my site. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

The form "Newsletter" shows on the page, and a test submission appears in HelpWell under Forms, then Submissions.

## What you need to know

- The form is "Newsletter" (id "newsletter"), made in HelpWell, our product's help desk. HelpWell draws it, checks every submission for bots, and stores the submissions.
- HelpWell's script is /api/helpwell/assets/loader.js. It is loaded once per page, in the layout. If the site already has it (the HelpWell chat widget uses the same tag), do not add it again. If the site only wants forms and no chat launcher, the tag carries data-mode="forms".
- The script loads after the page has finished loading, so it never slows the page down, and it draws the form into any element with a data-helpwell-form attribute that it finds, including ones added later by a single-page app.
- If this site is on a different domain from the one HelpWell's API is on, the API has to allow this site's origin: in the app that mounts HelpWell, add the site's origin (for example https://www.acme.com) to corsOrigins in createHelpWellHandler({ ... }). Without it the form stays empty and the browser console reports a CORS error.

## Steps

1. Find the page (or the shared template) where the form should appear, and put the embed element exactly where it should show.
2. If the HelpWell script tag is not in the layout yet, paste it just before </body>, once, in the shared layout or footer.

## Use exactly as written

The embed, where the form goes:

```html
<div data-helpwell-form="newsletter"></div>
```

The script, once per page, only if it is not there yet:

```html
<script src="/api/helpwell/assets/loader.js" defer></script>
```

Or, for a site that wants forms but no chat launcher:

```html
<script src="/api/helpwell/assets/loader.js" data-mode="forms" defer></script>
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Keep the form id exactly "newsletter".
- Add the script tag at most once per page. Two copies do no harm, but they are untidy.
- Do not copy the form's HTML from the browser into the page: HelpWell draws it fresh each time, with a one-time token that proves the submission is real.

## Check your work

1. Open the page in a private window and wait a moment: the form appears where the element is.
2. Submit a test entry with a real address you own. The form shows its thank-you.
3. In HelpWell, open Forms, then "Newsletter", then Submissions: the test entry is at the top, marked trusted. (Submitted in under two seconds it is marked as a bot, so take your time.)

## When you are done

Tell me which file or page you changed, what you added, and whether the test submission arrived.
````
<!-- /generated:prompt:forms-embed -->

`GET /admin/forms/:id/prompts` (`admin.forms.prompts(id)`) returns all four,
formatted, for your own tooling.

## Moving a form between installs

**Export JSON** (or `GET /admin/forms/:id/export`) writes:

```json
{ "helpwell": "form", "formatVersion": 1, "id": "newsletter", "name": "Newsletter", "enabled": true, "definition": { } }
```

**Import** refuses an id that already exists unless you ask to replace it; then
the import is saved as that form's next version. **Versions** lists every save.
**Restore** brings an old one back as a new version, so history only grows.

Deleting a form that has submissions archives it instead, so what it collected
is kept. Deleting a contact deletes their submissions and giveaway entries.
