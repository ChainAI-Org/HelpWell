/**
 * Setup prompts for the integrations a developer wires up outside HelpWell:
 * a webhook receiver, the MCP server in their editor, and moving contacts in
 * from another tool.
 *
 * Each returns a `SetupPromptSpec` for `formatSetupPrompt`, so the dashboard,
 * the CLI and the docs hand an assistant the same instructions. None of them
 * carries a secret: they name the environment variable and say where the
 * person pastes the value.
 */

import type { SetupPromptSpec } from './setup-prompt.js';
import {
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENTS,
  WEBHOOK_TEST_EVENT,
  type WebhookEvent,
} from './webhooks.js';

/** One realistic `data` object per event, for receivers to be written against. */
export const WEBHOOK_EXAMPLES: Readonly<Record<WebhookEvent, Record<string, unknown>>> = {
  'conversation.created': {
    conversationId: 'cnv_m3k9f2a1x8qw4t',
    contactId: 'con_m3k9e7b2p1zz0c',
    pageUrl: '/billing',
  },
  'conversation.unresolved': {
    conversationId: 'cnv_m3k9f2a1x8qw4t',
    messageId: 'msg_m3k9f2a2c1d2e3',
    question: 'Can I get a refund for last month?',
    contactId: 'con_m3k9e7b2p1zz0c',
  },
  'message.created': {
    id: 'msg_m3k9f2a2c1d2e3',
    conversationId: 'cnv_m3k9f2a1x8qw4t',
    role: 'agent',
    body: 'Open Billing, then Invoices, and choose Export.',
    unresolved: false,
    contactId: 'con_m3k9e7b2p1zz0c',
  },
  'feedback.created': {
    kind: 'message',
    messageId: 'msg_m3k9f2a2c1d2e3',
    conversationId: 'cnv_m3k9f2a1x8qw4t',
    value: 'helpful',
    comment: null,
    contactId: 'con_m3k9e7b2p1zz0c',
  },
  'gap.created': {
    id: 'gap_m3k9f3aa01bb02',
    question: 'Do you support SAML single sign-on?',
    conversationId: 'cnv_m3k9f2a1x8qw4t',
  },
  'roadmap.idea': {
    id: 'rmp_m3k9f4cc03dd04',
    title: 'Bulk export',
    body: null,
    contactId: 'con_m3k9e7b2p1zz0c',
  },
  // One answer to one question. A multi-question survey sends one per
  // question, tied together by `sessionId`; a multiple-choice answer carries
  // `choices`, with `choice` as the same picks joined by ", ".
  'survey.response': {
    id: 'srv_m3k9f5ee05ff06',
    surveyId: 'nps-q3',
    sessionId: 'm3k9f5a1x7qk2v9d0e',
    questionId: 'q1',
    kind: 'nps',
    score: 9,
    choice: null,
    choices: null,
    comment: 'Fast answers.',
    contactId: 'con_m3k9e7b2p1zz0c',
  },
  'changelog.published': {
    id: 'chg_m3k9f6gg07hh08',
    version: 'v2.14.0',
    title: 'Dark mode everywhere',
    summary: 'The dashboard and the widget follow your system theme.',
    tags: ['new'],
    publishedAt: '2026-09-22T10:00:00.000Z',
  },
  'article.published': {
    slug: 'billing/exporting-invoices',
    title: 'Exporting invoices',
    collection: 'billing',
    description: 'Download a PDF of any invoice.',
  },
  'form.submitted': {
    id: 'fsb_m3k9f7ii09jj10',
    formId: 'newsletter',
    formName: 'Newsletter',
    formType: 'newsletter',
    formVersion: 3,
    variant: 'a',
    placement: 'inline',
    submittedAt: '2026-09-22T10:05:00.000Z',
    contactId: 'con_m3k9e7b2p1zz0c',
    email: 'ada@example.com',
    name: 'Ada',
    fields: { email: 'ada@example.com', first_name: 'Ada', consent: true },
    attributes: { first_name: 'Ada' },
    consent: { state: 'granted', text: 'Email me the monthly update.' },
    trusted: true,
    verdict: {
      turnstile: 'off',
      honeypot: false,
      fillMs: 8420,
      tooFast: false,
      rateLimited: false,
      disposable: false,
      blockedDomain: false,
      blockedIp: false,
      mx: 'ok',
      duplicate: false,
      trusted: true,
      reasons: [],
    },
    page: { url: 'https://acme.example/blog/launch', path: '/blog/launch' },
    referrer: 'https://news.example/',
    utm: { source: 'newsletter', campaign: 'launch' },
    giveaway: null,
  },
  'giveaway.entered': {
    entryId: 'gve_m3k9f8kk11ll12',
    formId: 'giveaway',
    submissionId: 'fsb_m3k9f7ii09jj10',
    contactId: 'con_m3k9e7b2p1zz0c',
    email: 'ada@example.com',
    entries: 1,
    referralCode: 'k7qmw2xa',
    referredBy: 'gve_m3k9f8aa01bb02',
    trusted: true,
  },
};

/**
 * Build a webhook receiver that checks the signature. `url` and `stack` are
 * facts about the person's app when the caller knows them.
 */
export function webhookReceiverPromptSpec(
  options: {
    productName?: string;
    url?: string;
    stack?: string;
    /**
     * The install has no config file (`contentMode: 'managed'`): webhooks
     * are added on the dashboard's Webhooks page, which makes the secret.
     */
    managed?: boolean;
  } = {},
): SetupPromptSpec {
  const product = options.productName || 'my app';
  const register = options.managed
    ? [
        'Tell me to add the endpoint on the Webhooks page of the HelpWell dashboard myself, with the events it wants (none ticked means all of them). The page makes the signing secret and shows it once; tell me to paste it into HELPWELL_WEBHOOK_SECRET myself.',
        'Send a test: the "Send test delivery" button on the Webhooks page of the HelpWell dashboard.',
      ]
    : [
        'Add the endpoint URL to the "webhooks" list in helpwell/helpwell.config.json with the events it wants (an empty list means all of them), then run `npx helpwell sync`. Tell me to paste the same secret into that entry\'s "secret" field myself.',
        'Send a test: the "Send test delivery" button on the Webhooks page of the HelpWell dashboard, or `npx helpwell webhooks test`.',
      ];
  return {
    task: `a webhook receiver for HelpWell in ${product}`,
    goal: 'An HTTPS endpoint in my app that accepts HelpWell webhook deliveries, rejects any whose signature does not verify, handles each event type, and answers 2xx within five seconds.',
    context: [
      'HelpWell sends one JSON POST per event: { "event": "<name>", "at": "<ISO time>", "data": { ... } }.',
      'Headers: x-helpwell-event (the event name), x-helpwell-delivery (a unique id; the same id is reused when a delivery is retried), x-helpwell-attempt (1 to 5), and x-helpwell-signature when a secret is set.',
      'x-helpwell-signature is "sha256=" followed by the hex HMAC-SHA256 of the exact raw request body, keyed with the webhook secret. Verify it over the raw bytes, before parsing JSON, with a constant-time comparison.',
      'A response that is not 2xx within five seconds counts as a failure. HelpWell retries up to five attempts in all, after 1, 4, 16 and 64 minutes.',
      'HelpWell only sends to a public https address: when it sends, it refuses http, localhost and private network addresses, and it never follows a redirect. To try the endpoint on my own machine, use a public https tunnel to it, or run HelpWell locally with HELPWELL_WEBHOOK_GUARD=off (for development only, never in production).',
      'In a Node or TypeScript app, `verifySignature(secret, rawBody, header)` from @helpwell/core does the check.',
      ...(options.stack ? [`The app is built with ${options.stack}.`] : []),
      ...(options.url ? [`The endpoint should live at ${options.url}.`] : []),
    ],
    steps: [
      'Add a POST route for the webhook. Read the body as raw text; do not let a body parser consume it first.',
      "Read the secret from the environment variable HELPWELL_WEBHOOK_SECRET. Tell me to paste the secret into my environment (for example .env.local, or my host's environment settings) myself; do not ask me for it.",
      'Verify x-helpwell-signature against the raw body. Answer 401 and stop if it is missing or wrong.',
      'Parse the JSON and switch on the event name. Handle the events in the table below that matter to me, and answer 200 to every other event, including webhook.test.',
      'Make handling idempotent: store the x-helpwell-delivery id and ignore a delivery you have already processed.',
      'Answer 200 as soon as the event is stored. Do slow work (emails, API calls) after responding or in a background job.',
      ...register,
    ],
    tables: [
      {
        title: 'Events HelpWell sends',
        rows: [
          ...WEBHOOK_EVENTS.map((event) => ({
            event,
            when: WEBHOOK_EVENT_DESCRIPTIONS[event],
            'example data': JSON.stringify(WEBHOOK_EXAMPLES[event]),
          })),
          {
            event: WEBHOOK_TEST_EVENT,
            when: 'Only when someone sends a test delivery.',
            'example data': JSON.stringify({ message: 'This is a test delivery from HelpWell.' }),
          },
        ],
      },
    ],
    blocks: [
      {
        caption: 'The signature check, in TypeScript (Next.js route handler shown):',
        language: 'ts',
        content: `import { verifySignature } from '@helpwell/core';

export async function POST(request: Request) {
  const body = await request.text();
  const ok = await verifySignature(
    process.env.HELPWELL_WEBHOOK_SECRET ?? '',
    body,
    request.headers.get('x-helpwell-signature'),
  );
  if (!ok) return new Response('bad signature', { status: 401 });

  const { event, data } = JSON.parse(body) as { event: string; data: Record<string, unknown> };
  const delivery = request.headers.get('x-helpwell-delivery');
  // if (await alreadyHandled(delivery)) return new Response('ok');
  switch (event) {
    case 'conversation.unresolved':
      // data.question is what the docs could not answer
      break;
    default:
      break;
  }
  return new Response('ok');
}`,
      },
    ],
    rules: [
      'Never log the webhook secret or the signature header.',
      'Do not disable the signature check, even temporarily for testing.',
    ],
    verify: [
      'A test delivery shows "Delivered" under Recent deliveries on the dashboard\'s Webhooks page.',
      'A request with a wrong x-helpwell-signature gets 401.',
      'Sending the same delivery twice is handled once.',
    ],
    report:
      'Tell me the endpoint path, the events it handles, where the secret is read from, and the result of the test delivery.',
  };
}

/** Connect HelpWell's MCP server to Claude Desktop, Claude Code or Cursor. */
export function mcpSetupPromptSpec(options: { projectDir?: string } = {}): SetupPromptSpec {
  const dir = options.projectDir || '/absolute/path/to/your/repo';
  const server = (env: Record<string, string>) =>
    JSON.stringify(
      { mcpServers: { helpwell: { command: 'npx', args: ['-y', '@helpwell/mcp'], env } } },
      null,
      2,
    );
  return {
    task: 'the HelpWell MCP server for my coding agent',
    goal: 'My coding agent can call HelpWell tools (search the docs, list gaps, write articles, draft the changelog, list segments) against the HelpWell installed in my repo.',
    context: [
      'The server is the npm package @helpwell/mcp, started with `npx -y @helpwell/mcp`. It talks over stdio and needs no port.',
      'It finds the install by walking up from its working directory to helpwell/helpwell.config.json. When the client starts it somewhere else (Claude Desktop does), set HELPWELL_PROJECT_DIR to the repo root.',
      'HELPWELL_DATABASE_URL is only needed when HelpWell uses a Postgres server rather than the embedded database under helpwell/data. It contains a password: I paste it myself.',
      'OPENROUTER_API_KEY is only needed for the tools that call a model (generate_changelog, run_evals), and lets create_article and update_article embed an article for semantic search as they save it. I paste it myself.',
      `The repo is at ${dir}.`,
    ],
    steps: [
      'Ask me which client I use: Claude Code, Claude Desktop or Cursor. Only configure that one.',
      'Claude Code: from the repo root run `claude mcp add helpwell --scope project -- npx -y @helpwell/mcp`. That writes .mcp.json in the repo.',
      'Claude Desktop: open Settings, Developer, Edit Config, and merge the Claude Desktop block below into claude_desktop_config.json. Keep any servers already there.',
      'Cursor: create or edit .cursor/mcp.json in the repo and merge the Cursor block below.',
      'Where a block has "<paste yourself>", tell me which file to open so I can paste the value myself, or delete that line if I do not need it.',
      'Restart the client so it starts the server.',
    ],
    tables: [
      {
        title: 'Environment variables',
        rows: [
          {
            name: 'HELPWELL_PROJECT_DIR',
            needed: 'when the client does not start in the repo',
            value: dir,
          },
          {
            name: 'HELPWELL_DATABASE_URL',
            needed: 'only with a Postgres server',
            value: '<paste yourself>',
          },
          {
            name: 'OPENROUTER_API_KEY',
            needed: 'for generate_changelog and run_evals, and to embed saved articles',
            value: '<paste yourself>',
          },
        ],
      },
    ],
    blocks: [
      {
        caption: 'Claude Code, from the repo root:',
        language: 'bash',
        content: 'claude mcp add helpwell --scope project -- npx -y @helpwell/mcp',
      },
      {
        caption: 'Claude Desktop, merged into claude_desktop_config.json:',
        language: 'json',
        content: server({
          HELPWELL_PROJECT_DIR: dir,
          HELPWELL_DATABASE_URL: '<paste yourself, or delete this line>',
          OPENROUTER_API_KEY: '<paste yourself, or delete this line>',
        }),
      },
      {
        caption: 'Cursor, merged into .cursor/mcp.json in the repo:',
        language: 'json',
        content: server({ OPENROUTER_API_KEY: '<paste yourself, or delete this line>' }),
      },
    ],
    rules: [
      'Do not commit a file that contains a database URL or an API key. If .mcp.json or .cursor/mcp.json would hold one, put the value in my shell environment instead and leave it out of the file.',
    ],
    verify: [
      'The client lists a "helpwell" server with tools such as search_articles and list_gaps.',
      'Calling list_collections returns the folders under the docs directory.',
    ],
  };
}

/** Move contacts out of another tool and into HelpWell with `helpwell import contacts`. */
export function contactImportPromptSpec(options: { tool?: string } = {}): SetupPromptSpec {
  const tool = options.tool || 'my current support tool';
  return {
    task: `moving my contacts from ${tool} into HelpWell`,
    goal: 'A contacts.csv (or contacts.json) file in the shape HelpWell expects, imported with `npx helpwell import contacts`, with the counts checked.',
    context: [
      `The contacts come from ${tool}. Most tools export people as CSV from their contacts, users or customers screen.`,
      'Every imported contact is labelled with the source "import" and consent "unknown". An import never records consent, whatever the old tool said.',
      "People are matched on id (my app's own user id, the same one my app signs into HelpWell identify tokens), then on email. Running the same import twice updates rather than duplicates.",
      'Any column that is not one of the named ones becomes an attribute with that name, and its type is inferred (number, date, true/false, list, link or text).',
    ],
    steps: [
      `Tell me where ${tool} exports contacts, then wait for me to download the export. Do not ask me to share API keys or passwords for ${tool}.`,
      "Map the export's columns onto the columns below. Rename columns; do not invent values. Leave a cell empty when the export has nothing for it.",
      'Drop columns that hold passwords, payment card details, government ids or anything else sensitive.',
      'Write the result to contacts.csv in the repo root (UTF-8, comma separated, one header row). Tags go in one cell, separated by semicolons.',
      'Run `npx helpwell import contacts contacts.csv --dry-run` and show me the counts and any skipped rows.',
      'When I confirm, run `npx helpwell import contacts contacts.csv`.',
      'Delete contacts.csv afterwards, or make sure it is in .gitignore: it holds personal data.',
    ],
    tables: [
      {
        title: 'Columns HelpWell reads',
        rows: [
          {
            column: 'id',
            required: 'id or email',
            meaning: "Your app's user id",
            example: 'usr_8412',
          },
          {
            column: 'email',
            required: 'id or email',
            meaning: 'Email address',
            example: 'ada@example.com',
          },
          { column: 'name', required: 'no', meaning: 'Full name', example: 'Ada Lovelace' },
          {
            column: 'signed_up',
            required: 'no',
            meaning: 'When they signed up, ISO 8601',
            example: '2025-03-04',
          },
          {
            column: 'tags',
            required: 'no',
            meaning: 'Semicolon-separated tags',
            example: 'beta;agency',
          },
          {
            column: '(anything else)',
            required: 'no',
            meaning: 'Becomes an attribute',
            example: 'plan = pro',
          },
        ],
      },
    ],
    blocks: [
      {
        caption: 'The same people as contacts.json, if JSON is easier:',
        language: 'json',
        content: JSON.stringify(
          [
            {
              id: 'usr_8412',
              email: 'ada@example.com',
              name: 'Ada Lovelace',
              signedUpAt: '2025-03-04',
              tags: ['beta', 'agency'],
              attributes: { plan: 'pro', seats: 4 },
            },
          ],
          null,
          2,
        ),
      },
    ],
    rules: ['Never commit the export or contacts.csv to the repository.'],
    verify: [
      'The dry run reports created and updated counts that add up to the rows in the file, minus the skipped ones.',
      'After the import, the Contacts screen in the HelpWell dashboard shows the people with the source "Import".',
    ],
  };
}
