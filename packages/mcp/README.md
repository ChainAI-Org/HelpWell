# @helpwell/mcp

An MCP server that gives a coding agent such as Claude Code, Claude Desktop or Cursor read and write access to a local HelpWell: search the docs, work the gap list, write and edit articles, draft the changelog, retake screenshots, import docs from another help desk, change a setting, count a segment and run the evals.

```bash
# Claude Code, from the repo root
claude mcp add helpwell --scope project -- npx -y @helpwell/mcp
```

```json
{ "mcpServers": { "helpwell": { "command": "npx", "args": ["-y", "@helpwell/mcp"] } } }
```

Run it from the repo HelpWell is installed in, or set `HELPWELL_PROJECT_DIR` to that repo when the client starts it somewhere else (Claude Desktop does). It finds the database the same way the CLI does: `HELPWELL_DATABASE_URL` if set, otherwise the embedded database under `helpwell/data` in the install. That is the database `helpwell sync` writes to, so the tools see the docs you indexed. Outside any install it falls back to an empty in-memory database, and the first tool call says so.

## Using HelpWell Cloud

This server works on a HelpWell you host yourself. [HelpWell Cloud](https://helpwell.ai), the hosted version, has its own MCP server, so there is nothing to install or run:

1. In HelpWell Cloud, open **Settings → AI assistants**. The server address is `https://app.helpwell.ai/mcp`.
2. Add that address to Claude, ChatGPT, Codex, Cursor or any app that supports MCP as a remote connector, and sign in to HelpWell when it asks. There is no API key to paste.
3. Choose the workspace, **Read only** or **Read and manage**, and the areas of tools the assistant gets: the support inbox, the help center, contacts, in-app messages and forms, journeys, email marketing (on the Growth plan), email setup and workspace setup.

The assistant works with your role's permissions, asks before it emails anyone, and never sees your API keys or passwords. Change its areas or disconnect it in **Settings → AI assistants** at any time.

If you moved everything to Cloud, remove this server from your client so the assistant does not find two help centers. If you keep self-hosting and linked the install to Cloud with `npx helpwell link`, keep both: this one for the docs in your repo, the hosted one for the inbox, contacts and email.

## Tools

| Tool | What it is for |
| --- | --- |
| `search_articles` | Check whether an answer already exists, and find a slug to read. |
| `read_article` | The full markdown body of one published article. |
| `list_collections` | Where a new article belongs. The `id` is the docs folder name. |
| `list_gaps` | Questions the agent could not answer: the backlog, most-asked first. |
| `resolve_gap` | Mark a gap as drafted against the article that now answers it. |
| `recent_conversations` | What people are struggling with. Contact details are never included. |
| `read_conversation` | One conversation, message by message. No contact, emails blanked, tool calls by name only. |
| `report_summary` | Headline numbers for a period, and the topics asked about most. |
| `create_article` | Write a new article into the docs folder and index it, embedded for semantic search when `OPENROUTER_API_KEY` is set. A draft unless asked otherwise. |
| `update_article` | Change an article's body or frontmatter in place, then re-index and re-embed it. |
| `generate_changelog` | Draft a changelog entry from a GitHub release or from git history, as `helpwell changelog` does. Always a draft. |
| `capture_screenshots` | Retake the screenshots the docs use, as `helpwell capture` does. |
| `import_docs` | Bring articles over from Zendesk, Intercom, Help Scout, Freshdesk, Document360, Crisp, a folder or a crawl. |
| `update_setting` | Change one setting by its dotted path, in the database and in `helpwell.config.json`. |
| `list_segments` | The saved contact segments, their rules and member counts. |
| `count_segment` | How many contacts a segment, or rules not yet saved, match. |
| `run_evals` | Replay `helpwell/evals.json` through the agent and score it, failures first. |

Articles are files, so a new or changed article arrives as a change in the repo for a person to review, the same as one written by hand. `generate_changelog`, `capture_screenshots` and `import_docs` run the repo's own `helpwell` CLI with `--json`, so they need `helpwell` installed there.

Some things are deliberately not tools. Webhooks and anything secret cannot be changed through `update_setting`, because they decide where customer data goes; contacts cannot be imported through `import_docs`, because they are personal data. A person does those in the dashboard or a terminal.

## Set this up with an AI assistant

Paste this into your coding agent or assistant. It holds no keys: it tells you where to paste them yourself. `mcpSetupPrompt()` from this package returns the same text.

````md
You are helping me set up the HelpWell MCP server for my coding agent. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.

## Goal

My coding agent can call HelpWell tools (search the docs, list gaps, write articles, draft the changelog, list segments) against the HelpWell installed in my repo.

## What you need to know

- The server is the npm package @helpwell/mcp, started with `npx -y @helpwell/mcp`. It talks over stdio and needs no port.
- It finds the install by walking up from its working directory to helpwell/helpwell.config.json. When the client starts it somewhere else (Claude Desktop does), set HELPWELL_PROJECT_DIR to the repo root.
- HELPWELL_DATABASE_URL is only needed when HelpWell uses a Postgres server rather than the embedded database under helpwell/data. It contains a password: I paste it myself.
- OPENROUTER_API_KEY is only needed for the tools that call a model (generate_changelog, run_evals), and lets create_article and update_article embed an article for semantic search as they save it. I paste it myself.
- The repo is at /absolute/path/to/your/repo.

## Steps

1. Ask me which client I use: Claude Code, Claude Desktop or Cursor. Only configure that one.
2. Claude Code: from the repo root run `claude mcp add helpwell --scope project -- npx -y @helpwell/mcp`. That writes .mcp.json in the repo.
3. Claude Desktop: open Settings, Developer, Edit Config, and merge the Claude Desktop block below into claude_desktop_config.json. Keep any servers already there.
4. Cursor: create or edit .cursor/mcp.json in the repo and merge the Cursor block below.
5. Where a block has "<paste yourself>", tell me which file to open so I can paste the value myself, or delete that line if I do not need it.
6. Restart the client so it starts the server.

## Exact values

### Environment variables

| name | needed | value |
| --- | --- | --- |
| HELPWELL_PROJECT_DIR | when the client does not start in the repo | /absolute/path/to/your/repo |
| HELPWELL_DATABASE_URL | only with a Postgres server | <paste yourself> |
| OPENROUTER_API_KEY | for generate_changelog and run_evals, and to embed saved articles | <paste yourself> |

The same values as JSON:

```json
[
  {
    "name": "HELPWELL_PROJECT_DIR",
    "needed": "when the client does not start in the repo",
    "value": "/absolute/path/to/your/repo"
  },
  {
    "name": "HELPWELL_DATABASE_URL",
    "needed": "only with a Postgres server",
    "value": "<paste yourself>"
  },
  {
    "name": "OPENROUTER_API_KEY",
    "needed": "for generate_changelog and run_evals, and to embed saved articles",
    "value": "<paste yourself>"
  }
]
```

## Use exactly as written

Claude Code, from the repo root:

```bash
claude mcp add helpwell --scope project -- npx -y @helpwell/mcp
```

Claude Desktop, merged into claude_desktop_config.json:

```json
{
  "mcpServers": {
    "helpwell": {
      "command": "npx",
      "args": [
        "-y",
        "@helpwell/mcp"
      ],
      "env": {
        "HELPWELL_PROJECT_DIR": "/absolute/path/to/your/repo",
        "HELPWELL_DATABASE_URL": "<paste yourself, or delete this line>",
        "OPENROUTER_API_KEY": "<paste yourself, or delete this line>"
      }
    }
  }
}
```

Cursor, merged into .cursor/mcp.json in the repo:

```json
{
  "mcpServers": {
    "helpwell": {
      "command": "npx",
      "args": [
        "-y",
        "@helpwell/mcp"
      ],
      "env": {
        "OPENROUTER_API_KEY": "<paste yourself, or delete this line>"
      }
    }
  }
}
```

## Rules

- Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.
- Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.
- Use the values exactly as given. Do not shorten, reformat or "correct" them.
- If a step fails, tell me the exact error message instead of guessing a workaround.
- Do not commit a file that contains a database URL or an API key. If .mcp.json or .cursor/mcp.json would hold one, put the value in my shell environment instead and leave it out of the file.

## Check your work

1. The client lists a "helpwell" server with tools such as search_articles and list_gaps.
2. Calling list_collections returns the folders under the docs directory.

## When you are done

Tell me what you changed, what you could not do, and anything I still need to do myself.
````

Part of [HelpWell](https://github.com/ChainAI-Org/helpwell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/helpwell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
