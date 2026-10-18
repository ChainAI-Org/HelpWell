# @helpwell/sdk

A typed server-side client for the HelpWell HTTP API, and the helper that signs identify tokens so the browser can never claim to be someone else.

```sh
npm install @helpwell/sdk
```

## The public client

Everything the widget and the help center can do, from your own server, a script or a cron job. One `HelpWellClient` is one visitor: the server hands it a visitor cookie on the first call and the client sends it back on every call after, the way a browser would, so votes toggle, tracked events land on one contact, and a conversation can be read back.

```ts
import { HelpWellClient } from '@helpwell/sdk';

const helpwell = new HelpWellClient({
  baseUrl: 'https://app.acme.com/api/helpwell',
  identitySecret: process.env.HELPWELL_IDENTITY_SECRET, // the same one the handler has
});

// Act as one of your users: sign a token for them, then identify with it.
// Every public call after this is recorded against that person.
const token = await helpwell.signFor({ id: user.id, email: user.email, name: user.name });
await helpwell.identify(token);

const { results } = await helpwell.search('export invoices');
const reply = await helpwell.chat({ message: 'How do I export invoices?' });
await helpwell.feedback(reply.messageId, 'helpful');
await helpwell.vote('rmp_…'); // once votes, twice takes it back
await helpwell.submitIdea('Dark mode'); // allowed because the client is identified
await helpwell.track('invoice_exported', { plan: 'pro' });
```

Use one client per user when a job acts for several; `forget()` drops the cookie so the next call starts a new anonymous visitor.

`signFor` is a convenience over the re-exported `signIdentity(claims, secret)`; use that directly if you would rather not give the client the secret.

## The admin client

The `/admin` routes are on `helpwell.admin.*`. They need an admin token: pass `adminToken` to `createHelpWellHandler` on the server and the same value to the client. The client sends it as `Authorization: Bearer`, and the server accepts it whether or not you also configured `isAdmin` for people signing in through your app — a dashboard session and a script are different callers with different credentials.

```ts
// On the server, where HelpWell is mounted:
createHelpWellHandler({
  db,
  isAdmin: (request) => session(request)?.role === 'admin', // your people
  adminToken: process.env.HELPWELL_ADMIN_TOKEN, // your machines
});

// In the script:
const helpwell = new HelpWellClient({
  baseUrl: 'https://app.acme.com/api/helpwell',
  adminToken: process.env.HELPWELL_ADMIN_TOKEN,
});

const { headline, topics } = await helpwell.admin.reports({ range: '7d' });
const gaps = await helpwell.admin.gaps({ status: 'new' });
await helpwell.admin.createChangelogEntry({ title: 'Faster exports', status: 'published' });
await helpwell.admin.maintenance(); // safe on a daily cron
```

Without a token, an admin call throws `HelpWellApiError` with code `no_admin_token` before any request is made.

### Contacts, segments and events

`helpwell.contacts` (the same object as `helpwell.admin.contacts`) takes HelpWell's contact id or your own user id. An update or event for a user id HelpWell has not seen creates the contact, so your backend can describe people before they open the widget.

```ts
await helpwell.contacts.update('usr_8412', {
  attributes: { seats: 4, trial: null }, // merged; null removes a key
  tags: { add: ['beta'], remove: ['trial'] },
  consent: 'granted', // recorded with "api" as its source and the time
});
await helpwell.contacts.track('usr_8412', 'exported_csv', { rows: 120 });

const page = await helpwell.contacts({ segment: 'seg_…' }); // or .list(), same thing
const csv = await helpwell.contacts.csv({ conditions: { field: 'plan', op: 'is', value: 'pro' } });

const segment = await helpwell.admin.createSegment({
  name: 'Power exporters',
  rules: { all: [{ event: 'exported_csv', op: 'at_least', count: 3, withinDays: 7 }] },
});
await helpwell.admin.previewSegment({ field: 'seats', op: 'gte', value: 10 }); // a count
await helpwell.admin.fields(); // every attribute, typed
await helpwell.admin.updateField('seats', { type: 'number' }); // locks the type
await helpwell.admin.eventCounts({ days: 30 });
await helpwell.admin.retryWebhooks({ force: true });
```

The rule language (`Condition`, `ConditionGroup`) is exported as types; the main README's Contacts section lists the operators.

### Forms

`helpwell.admin.forms` lists, creates and saves forms, and reads what they collected. A definition is the same JSON the dashboard's builder saves and **Export JSON** writes, so a form can live in your repo and be imported on deploy.

```ts
const forms = await helpwell.admin.forms({ range: '30d' }); // or .list(), with views and conversion
const form = await helpwell.admin.forms.create({ template: 'newsletter', id: 'newsletter' });
await helpwell.admin.forms.update(form.id, { enabled: true, expectedVersion: form.version });
await helpwell.admin.forms.import(exported, { overwrite: true }); // saved as the next version

const page = await helpwell.admin.forms.submissions('newsletter', { status: 'trusted' });
const csv = await helpwell.admin.forms.submissionsCsv('newsletter');
const results = await helpwell.admin.forms.analytics('newsletter', { range: '7d' });
const draw = await helpwell.admin.forms.draw('launch-giveaway', { count: 3, seed: 'launch-2026' });
```

Every submission carries its `verdict` (the bot checks) and `trusted`. See [docs/forms.md](https://github.com/ChainAI-Org/helpwell/blob/main/docs/forms.md).

## Errors

Every failure is a `HelpWellApiError` with `status`, `code` and `message`. `status` is 0 when the request never reached a server (`network_error`, `timeout`). `retryable` says whether trying again might help: offline, throttled, or a server-side failure — but not `not_configured` (501), which stays that way until someone sets a key.

## Types

The response types in `@helpwell/sdk` are the wire shapes: what a repo returns with every `Date` turned into an ISO string. They are pinned to core's types by a compile-time test, so a field added to a core repo shows up here in the same release.

Part of [HelpWell](https://github.com/ChainAI-Org/helpwell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/helpwell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
