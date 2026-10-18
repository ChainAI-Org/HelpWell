# Contributing

Thanks for looking. HelpWell is small enough to read in an afternoon, and the
best contributions keep it that way.

## How to help

The most useful things you can send are bug reports and feature requests.
Open an [issue](https://github.com/ChainAI-Org/helpwell/issues/new/choose):
the templates ask for what we need.

**We are not accepting pull requests yet.** The maintainers write every
change for now, and pull requests from outside the project are closed with a
pointer back to issues. If you have a fix in mind, describe it in an issue;
we will credit you when it lands.

The rest of this file is for working on the code in your own fork, which the
AGPL-3.0 lets you do freely.

## Setting up

```bash
pnpm install
pnpm build        # every package, in dependency order
pnpm test         # vitest against a real Postgres (PGlite), no network
pnpm typecheck
pnpm lint         # Biome
```

`pnpm dev` runs `examples/playground`, a fake SaaS product with HelpWell fully
installed and seeded, at http://localhost:3000. It needs no API key: until you
set `OPENROUTER_API_KEY`, the agent quotes and cites the top search result in a
scripted reply, so citations, confidence and gaps all behave as they would.

## How the repo is laid out

| Package | What it is |
|---|---|
| `packages/core` | Schema, migrations, settings, search, the agent, the HTTP API |
| `packages/widget` | The Shadow DOM widget and its loader |
| `packages/helpcenter` | The public documentation site |
| `packages/dashboard` | The admin UI |
| `packages/ui` | Server-rendered HTML primitives the two share |
| `packages/tokens` | Design tokens and the brand marks |
| `packages/sdk` | A typed client |
| `packages/mcp` | An MCP server for coding agents |
| `packages/cli` | `helpwell`, the CLI |

Nothing depends on a UI framework, and that is deliberate: the widget is plain
DOM, the help center and dashboard render HTML strings on the server. Please
do not add one.

## Ground rules

- **Tests run against the real database.** Migrations, generated columns and
  full-text search are exercised as they will be in production. If a change
  needs a fixture, add it to the test; do not mock the database.
- **Migrations are hand-written SQL**, numbered, in
  `packages/core/src/db/migrations`. Add a new file; never edit one that has
  shipped in a release.
- **The public API is `(Request) => Response`.** Anything that would tie
  HelpWell to one framework belongs in the host app, not here.
- **No network in tests.** The model is a `FakeModel`; webhook targets are
  stubbed. `vitest.setup.ts`, which every package's config registers, takes
  real keys and tokens (`OPENROUTER_API_KEY`, `GITHUB_TOKEN`, anything ending
  `_API_KEY` or `_TOKEN`) out of the environment before a test runs, and
  makes a request to OpenRouter or the GitHub API fail. A test that needs a
  key sets a fake one itself.
- **Every setting is editable or explained.** A new setting in the schema
  needs a control in the dashboard, or an entry in
  `packages/dashboard/src/config-only.ts` saying why it is config only.
  `settings-coverage.test.ts` fails otherwise.
- **Every setup step comes with a prompt.** Anything a person configures
  outside HelpWell also gets a prompt for an AI assistant, built with
  `formatSetupPrompt` from `@helpwell/core`, holding no secret, and reachable
  from `helpwell prompt <topic>`.
- **Generated docs are generated.** The webhook table and the setup prompts
  in the README and `docs/` sit between `<!-- generated:… -->` markers. Change
  the code, then run `pnpm build && pnpm readme`; a test fails while they are
  out of date.
- **What the open-source build does not do.** It sends no email, has no human
  inbox or replies of its own, and shows no confidence thresholds or
  escalation rules as settings. Human support plugs in through the
  `SupportExtension` hook (`packages/core/src/api/support-extension.ts`);
  keep that seam generic.

## Reporting a bug

Open an issue with the version, the framework you mounted HelpWell in, and the
smallest thing that reproduces it. `helpwell doctor` output helps.

## Security

Please do not open a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).

## Licence

HelpWell is made by Workado, LLC and released under the AGPL-3.0. See
[LICENSE](LICENSE).
