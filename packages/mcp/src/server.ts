/**
 * The MCP surface: tool descriptions for the host agent, and the adapter that
 * turns `runTool` into a protocol result.
 *
 * Descriptions matter more than they look. They are the only thing the model
 * reads before deciding whether to call a tool, so each one says what it is
 * for rather than what it returns.
 */

import { isHelpWellError } from '@helpwell/core';
import type { Db } from '@helpwell/core/db';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DbResolver } from './db.js';
import { type McpEnvironment, resolveEnvironment } from './project.js';
import type { ToolArgs } from './tools.js';
import { CONVERSATION_STATUSES, GAP_STATUSES, REPORT_RANGES, runTool } from './tools.js';

export const SERVER_NAME = 'helpwell';
export const SERVER_VERSION = '0.1.0';

export const TOOLS: Tool[] = [
  {
    name: 'search_articles',
    description:
      'Search the published help center for articles about a topic. Use this before writing ' +
      'documentation to check whether an answer already exists, and to find the slug of an ' +
      'article you want to read.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the customer would ask, in their words.' },
        limit: { type: 'integer', description: 'Maximum hits, 1-50. Defaults to 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_article',
    description:
      'Read the full markdown body of one published help center article by its slug, for ' +
      'example "billing/exporting-invoices".',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The article slug, including its collection.' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'list_collections',
    description:
      'List the help center collections — id, title, description, icon, tint and how many ' +
      'published articles each holds. Use it to decide where a new article belongs. The `id` ' +
      'is the folder name under the docs directory and the first segment of every slug in it: ' +
      'an article for collection "billing" is written to docs/billing/<slug>.md and gets the ' +
      'slug "billing/<slug>". `title` is only what readers see.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_gaps',
    description:
      'List the questions the support agent could not answer from the documentation. This is ' +
      'the backlog of articles that need writing, most-asked first.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [...GAP_STATUSES],
          description: 'Defaults to "new", the gaps nobody has handled yet.',
        },
      },
    },
  },
  {
    name: 'resolve_gap',
    description:
      'Mark a gap as drafted against the article that now answers it. Call this only after the ' +
      'article exists and has been indexed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The gap id from list_gaps.' },
        articleSlug: { type: 'string', description: 'Slug of the article that answers it.' },
      },
      required: ['id', 'articleSlug'],
    },
  },
  {
    name: 'recent_conversations',
    description:
      "Read recent support conversations — topic, tags, rating and the customer's last " +
      'message — to see what people are struggling with. Read-only. The contact record ' +
      '(name, email) is never included, and any email address typed into the message text ' +
      'is replaced with "[email]".',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many, 1-100. Defaults to 20.' },
        status: { type: 'string', enum: [...CONVERSATION_STATUSES] },
      },
    },
  },
  {
    name: 'report_summary',
    description:
      'Headline support numbers for a period: how many conversations, how many the agent ' +
      'resolved, votes, cost, and the topics people asked about most.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: [...REPORT_RANGES],
          description: 'Defaults to "30d".',
        },
      },
    },
  },
  {
    name: 'read_conversation',
    description:
      'Read one support conversation message by message, to see why an answer went wrong: ' +
      'what was asked, what the agent said, which articles it cited and which tools it used. ' +
      'The contact is never included, email addresses in messages read "[email]", and tool ' +
      'calls are listed by name only.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The conversation id.' } },
      required: ['id'],
    },
  },
  {
    name: 'create_article',
    description:
      'Write a new help article into the docs folder of this repo and index it, so ' +
      'search_articles and resolve_gap see it straight away; with OPENROUTER_API_KEY in the ' +
      'server environment it is embedded for semantic search too ("embedded" in the result). ' +
      'It is a draft unless status is "published"; a person reviews the file like any other ' +
      'change. Fails if the file exists.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description:
            'The folder id from list_collections, e.g. "billing". A new id makes a new collection.',
        },
        title: { type: 'string' },
        body: {
          type: 'string',
          description:
            'Markdown, without the title as a heading. It may be empty only for a draft: a published article needs a body.',
        },
        description: { type: 'string', description: 'One sentence shown under the title.' },
        slug: {
          type: 'string',
          description: 'The file name; derived from the title when omitted.',
        },
        status: {
          type: 'string',
          enum: ['draft', 'published'],
          description: 'Defaults to "draft".',
        },
      },
      required: ['collection', 'title', 'body'],
    },
  },
  {
    name: 'update_article',
    description:
      'Change an existing article in the docs folder by its slug, then re-index it, embedding ' +
      'it again when OPENROUTER_API_KEY is set. Only the fields passed change; the rest of the ' +
      'frontmatter is kept. An article that would end up published with an empty body is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'For example "billing/exporting-invoices".' },
        body: { type: 'string', description: 'The whole new Markdown body.' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published', 'archived'] },
      },
      required: ['slug'],
    },
  },
  {
    name: 'generate_changelog',
    description:
      'Draft a changelog entry the way `helpwell changelog` does, and save it as a draft for a ' +
      'person to publish: from the notes on a GitHub release, the commits since the previous ' +
      'tag, or the commits since the last published entry, as changelog.source in Settings says ' +
      '(unset: GitHub releases when the repo is on GitHub and has one, otherwise tags; manual drafts ' +
      'nothing). Needs the helpwell ' +
      'CLI in the repo and OPENROUTER_API_KEY in the server environment; GITHUB_TOKEN helps ' +
      'with GitHub releases.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['github_releases', 'tags', 'commits'],
          description:
            'github_releases (release notes), tags (commits since the previous tag) or commits ' +
            '(commits since the last published entry); defaults to changelog.source in Settings.',
        },
        since: {
          type: 'string',
          description:
            'Start ref, from git; defaults to the last published entry (commits) or the previous tag (tags).',
        },
        to: { type: 'string', description: 'End ref, from git; defaults to HEAD.' },
        release: {
          type: 'string',
          description:
            'Version to stamp, e.g. v1.5.0. With GitHub releases, the release to read; defaults to the latest.',
        },
        dryRun: { type: 'boolean', description: 'Return the draft and save nothing.' },
      },
    },
  },
  {
    name: 'capture_screenshots',
    description:
      'Retake the screenshots the docs reference, against the running app, the way `helpwell ' +
      'capture` does. Needs the helpwell CLI and Playwright in the repo.',
    inputSchema: {
      type: 'object',
      properties: {
        only: { type: 'string', description: 'Only shots whose name contains this.' },
        url: { type: 'string', description: 'Where the app is running; defaults to the config.' },
      },
    },
  },
  {
    name: 'import_docs',
    description:
      'Import articles from another help desk into the docs folder, the way `helpwell import` ' +
      'does: zendesk, intercom, helpscout, freshdesk, document360, crisp, a markdown, html, ' +
      'gitbook or notion folder, or crawl for a public help site. Platform keys come from the ' +
      'server environment. Files are written for review and not indexed until sync.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'zendesk, intercom, helpscout, freshdesk, document360, crisp, markdown, html, gitbook, notion or crawl.',
        },
        target: { type: 'string', description: 'A folder, or the URL to crawl.' },
        subdomain: { type: 'string', description: 'Zendesk or Freshdesk subdomain.' },
        locale: { type: 'string' },
        websiteId: { type: 'string', description: 'Crisp website id.' },
        max: { type: 'integer', description: 'Crawl: pages to read at most.' },
        dryRun: { type: 'boolean' },
        draft: { type: 'boolean', description: 'Write every article as a draft.' },
      },
      required: ['source'],
    },
  },
  {
    name: 'update_setting',
    description:
      'Change one HelpWell setting by its dotted path, e.g. "widget.appearance.accent" or ' +
      '"agent.spend.dailyCapUsd". Written to the database and to helpwell.config.json. ' +
      'Webhooks and anything secret are refused: a person changes those.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        value: { description: 'The new value, as JSON.' },
      },
      required: ['path', 'value'],
    },
  },
  {
    name: 'list_segments',
    description:
      'List the saved contact segments with their rules and how many contacts each matches ' +
      'now. Use a segment id to target engage messages or surveys.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'count_segment',
    description:
      'Count the contacts a saved segment matches, or check unsaved rules before saving them. ' +
      'Rules look like {"all":[{"field":"plan","op":"is","value":"pro"},{"event":"exported_csv","op":"at_least","count":3,"withinDays":7}]}.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A segment id from list_segments.' },
        rules: { type: 'object', description: 'Conditions to count instead of a saved segment.' },
      },
    },
  },
  {
    name: 'run_evals',
    description:
      'Replay the eval questions (helpwell/evals.json) through the real agent and score the ' +
      'answers, failures first: those are the docs to fix. Without OPENROUTER_API_KEY it checks ' +
      'retrieval only and costs nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A label stored with the run, e.g. a commit SHA.' },
        dryRun: { type: 'boolean', description: 'Score without recording the run.' },
        threshold: { type: 'integer', description: 'The score the run needs, 0-100.' },
      },
    },
  },
];

/**
 * Runs a tool and answers in MCP's shape.
 *
 * Nothing here throws. A protocol-level error would tell the host "the call
 * failed" and stop there; `isError` with a sentence tells the model what went
 * wrong and usually what to do instead, which is the difference between the
 * assistant retrying sensibly and giving up.
 */
export async function callTool(
  resolveDb: DbResolver,
  name: string,
  args: ToolArgs,
  env: McpEnvironment = resolveEnvironment(),
): Promise<CallToolResult> {
  let db: Db;
  try {
    db = await resolveDb();
  } catch (cause) {
    return errorResult(
      `HelpWell could not reach its database, so no tool can run yet. ${describe(cause)}`,
    );
  }

  try {
    const data = await runTool(db, name, args, env);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (cause) {
    return errorResult(describe(cause));
  }
}

export function createHelpWellMcpServer(
  resolveDb: DbResolver,
  env: McpEnvironment = resolveEnvironment(),
): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(resolveDb, request.params.name, request.params.arguments, env),
  );

  return server;
}

/* ---------------------------------------------------------------- helpers */

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** A HelpWellError's message is already written for a reader; nothing else is. */
function describe(cause: unknown): string {
  if (isHelpWellError(cause)) return cause.message;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
