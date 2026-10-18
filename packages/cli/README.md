# helpwell

The command line for HelpWell, the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself.

```bash
npm install helpwell @helpwell/core @helpwell/helpcenter @helpwell/dashboard @helpwell/widget
npx helpwell init
npx helpwell docs generate
npx helpwell sync
```

`init` writes the config and the agent's instructions into your repo. `docs generate` reads your README, routes, plan definitions, UI copy and changelog and drafts articles from them. `sync` indexes the docs, sends what it indexed to a linked remote support extension straight away (when `HELPWELL_SUPPORT_TOKEN` is set where it runs), and pushes `helpwell.config.json` settings only when the file is newer than what the dashboard has saved; `helpwell settings pull` and `helpwell settings push` settle it explicitly. `link` connects a remote support extension for human support: it saves the service's URL and product id in the config, never the token (`HELPWELL_SUPPORT_TOKEN` stays in the server's environment), and checks the connection; see [docs/support-extension.md](../../docs/support-extension.md). Run `npx helpwell --help` for the rest.

`helpwell ask "how do I export invoices?"` asks the agent one question from the terminal, and `helpwell dev` keeps a conversation going. With `--offline`, or with no `OPENROUTER_API_KEY` set, neither needs a model or a key: each answer quotes the top search hit and cites it, and a question nothing matches is logged as a gap. Everything except the wording is real, so you can see what search finds, which article is cited, and the confidence score before you spend anything.

Part of [HelpWell](https://github.com/ChainAI-Org/HelpWell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/HelpWell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
