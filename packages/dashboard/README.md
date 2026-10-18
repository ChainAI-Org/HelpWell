# @helpwell/dashboard

The HelpWell dashboard: a setup checklist, conversations, contacts, the knowledge base, gaps, reports, evals, the agent's playbook and settings. Mounted in your own app, behind your own auth.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createDashboard } from '@helpwell/dashboard';

export const dashboard = createDashboard({
  db,
  basePath: '/admin/helpwell',
  apiPath: '/api/helpwell',
  isAdmin: (request) => session(request)?.role === 'admin',

  // Optional. Each hook keeps a file in your repo; leave one out and the
  // dashboard hands the file back to copy instead of writing it.
  writeArticle: (path, markdown) => writeFile(`docs/${path}`, markdown),
  readInstructions: () => readFile('helpwell/instructions.md', 'utf8'),
  writeInstructions: (value) => writeFile('helpwell/instructions.md', value),
  readPlaybook: () => readFile('helpwell/playbook.md', 'utf8'),
  writePlaybook: (value) => writeFile('helpwell/playbook.md', value),
  // The cases the Evals page runs; without it, a run repeats the latest run's cases.
  readEvalCases: () => readFile('helpwell/evals.json', 'utf8'),
});
```

`isAdmin` decides who gets in, and with nothing passed nobody does. The one other way in is `adminToken`: pass HELPWELL_ADMIN_TOKEN (at least 32 characters) and a request carrying it, as a bearer token or in the `hw_admin` cookie, is an admin. The locked-out page then offers a form to enter it, which sets that cookie (HttpOnly, `SameSite=Lax`, Secure except on http://localhost), and the rail gets a sign-out. Wrong tokens are rate-limited per address. Pass the same token to `createHelpWellHandler`, since the dashboard saves settings through the API. Without `adminToken` there is no form.

Drafting an article from a gap and running evals use the same OpenRouter key as the API: `OPENROUTER_API_KEY`, or `openRouterKey` here. Pass `model` to use another `ModelPort`, as tests do. The dashboard never shows a key or any other secret, only whether each one is set.

Every setting is either a control on some screen or listed in `CONFIG_ONLY` with the reason it is set in `helpwell.config.json` or the environment instead; `test/settings-coverage.test.ts` fails when a new setting is neither.

When the content has no repo behind it, as when a service hosts the install and saves articles, the playbook and settings into its own `content` source and hooks, pass `contentMode: 'managed'`. The pages then say an article is saved and goes live once indexed, and never send anyone to `helpwell sync`, `helpwell.config.json`, a repo or the CLI. The default, `'repo'`, is the wording above.

Test deliveries, retries and the `changelog.published` and `article.published` events a save raises go through `webhookFetch` when you pass one (the same option the API takes), and otherwise through the built-in guard, which refuses anything but a public https address. `webhookFetch: false`, or `HELPWELL_WEBHOOK_GUARD=off` in `env`, turns the guard off for local development.

Part of [HelpWell](https://github.com/ChainAI-Org/helpwell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/helpwell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
