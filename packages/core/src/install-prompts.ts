/**
 * Setup prompts for the first-run steps: installing the widget, setting the
 * model key, and signing identify tokens.
 *
 * The dashboard's "Get set up" checklist shows these beside each step, and
 * the CLI can print them, so a person can hand the job to ChatGPT, Claude or
 * a coding agent. Each is filled in with what this install already knows (the
 * API's path, the product's name), says exactly how to check the work, and
 * never carries a secret: it names the environment variable and tells the
 * person to paste the value themselves.
 */

import type { SetupPromptSpec } from './setup-prompt.js';
import { widgetCsp } from './widget-prompts.js';

export type WidgetFramework =
  | 'html'
  | 'nextjs'
  | 'react-vite'
  | 'vue'
  | 'sveltekit'
  | 'rails'
  | 'django';

/** In the order the checklist offers them. */
export const WIDGET_FRAMEWORKS: readonly { key: WidgetFramework; label: string }[] = [
  { key: 'html', label: 'Plain HTML' },
  { key: 'nextjs', label: 'Next.js (app router)' },
  { key: 'react-vite', label: 'React (Vite)' },
  { key: 'vue', label: 'Vue' },
  { key: 'sveltekit', label: 'SvelteKit' },
  { key: 'rails', label: 'Rails' },
  { key: 'django', label: 'Django' },
];

export const IDENTITY_SECRET_ENV = 'HELPWELL_IDENTITY_SECRET';
export const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY';

/**
 * The widget loader's size once gzipped, in KB, as the widget prompts state
 * it. Core cannot read the widget's build, so the number is written here and
 * test/loader-size.test.ts gzips the built loader and fails when this is
 * more than 0.2 KB out.
 */
export const LOADER_GZIP_KB = 0.7;

export interface InstallPromptOptions {
  /** Where the HelpWell API is mounted, e.g. "/api/helpwell". */
  apiPath: string;
  /**
   * The origin the API answers on, e.g. "https://app.acme.com", when known.
   * The dashboard passes its own; the widget needs it on a site served from
   * anywhere else.
   */
  origin?: string | null;
  productName?: string;
  /** What the person will see when it worked, e.g. the checklist step's name. */
  dashboardHint?: string;
  /** The widget plays videos inline, so its CSP needs the players (`widget.media.inlineVideo`). */
  inlineVideo?: boolean;
  /** The Turnstile bot check is on, so its CSP needs Cloudflare (`agent.abuse.botCheck`). */
  botCheck?: boolean;
}

/** `/api/helpwell`, with one leading slash and no trailing one. */
function cleanPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed) return '/api/helpwell';
  return trimmed.startsWith('/') || /^https?:\/\//.test(trimmed) ? trimmed : `/${trimmed}`;
}

/** The loader's URL: the path as-is, and absolute when the origin is known. */
export function loaderUrls(options: Pick<InstallPromptOptions, 'apiPath' | 'origin'>): {
  path: string;
  absolute: string | null;
} {
  const api = cleanPath(options.apiPath);
  const path = `${api}/assets/loader.js`;
  if (/^https?:\/\//.test(api)) return { path, absolute: path };
  const origin = options.origin?.replace(/\/+$/, '') ?? '';
  return { path, absolute: /^https?:\/\/[^/]+$/.test(origin) ? `${origin}${path}` : null };
}

/* ---------------------------------------------------------------- widget */

interface FrameworkRecipe {
  where: string;
  steps: string[];
  blocks: { caption: string; language: string; content: string }[];
  identity: string;
}

function recipe(framework: WidgetFramework, src: string): FrameworkRecipe {
  const tag = `<script src="${src}" defer></script>`;
  switch (framework) {
    case 'html':
      return {
        where:
          'In every page, just before the closing </body> tag. If the site has a shared footer or layout include, put it there once.',
        steps: [
          'Find the shared layout, footer include or template every page uses. If pages are separate files, add the tag to each one.',
          'Paste the script tag just before </body>.',
        ],
        blocks: [{ caption: 'The tag:', language: 'html', content: tag }],
        identity:
          'When someone is signed in, have the server render their signed token into the tag as data-token="…", or call helpwell("identify", token) from a script after the loader tag.',
      };
    case 'nextjs':
      return {
        where: 'In the root layout, app/layout.tsx, with the next/script component.',
        steps: [
          'Open app/layout.tsx (or src/app/layout.tsx).',
          'Import Script from "next/script" and render it inside <body>, after {children}, with strategy="afterInteractive".',
          'For signed-in people, sign a token in the layout (it is a server component) and pass it as data-token. Never sign it in a client component.',
        ],
        blocks: [
          {
            caption: 'app/layout.tsx:',
            language: 'tsx',
            content: `import Script from 'next/script';
import { signIdentity } from '@helpwell/core';
import { getCurrentUser } from '@/lib/auth'; // however your app reads the session

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const token = user
    ? await signIdentity(
        { id: String(user.id), email: user.email, name: user.name },
        process.env.${IDENTITY_SECRET_ENV} ?? '',
      )
    : undefined;
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="${src}" strategy="afterInteractive" data-token={token} />
      </body>
    </html>
  );
}`,
          },
        ],
        identity:
          'The layout signs the token on the server and passes it as data-token; the loader reads it. Leave data-token out for visitors who are not signed in.',
      };
    case 'react-vite':
      return {
        where:
          'In index.html, inside <head> and before the script that starts the app, so the helpwell() queue exists before any component runs. defer keeps it off the critical path.',
        steps: [
          'Open index.html at the project root.',
          'Paste the script tag inside <head>, above <script type="module" src="/src/main.tsx">.',
          'For signed-in people, fetch a signed token from your own backend after sign-in and pass it to helpwell("identify", token). Call helpwell("reset") on sign-out.',
        ],
        blocks: [
          { caption: 'index.html, inside <head>:', language: 'html', content: tag },
          {
            caption: 'After sign-in, e.g. in your auth provider:',
            language: 'tsx',
            content: `useEffect(() => {
  if (!user) return;
  fetch('/api/helpwell-token', { credentials: 'include' })
    .then((response) => response.json())
    .then(({ token }) => window.helpwell?.('identify', token));
}, [user]);`,
          },
        ],
        identity:
          'The token comes from an endpoint on your backend that signs it (see the identity signing step); the browser never sees the secret.',
      };
    case 'vue':
      return {
        where:
          'In index.html, inside <head> and before the app script, so the helpwell() queue exists before any component runs.',
        steps: [
          'Open index.html at the project root.',
          'Paste the script tag inside <head>, above <script type="module" src="/src/main.ts">.',
          'For signed-in people, fetch a signed token from your own backend after sign-in and pass it to helpwell("identify", token). Call helpwell("reset") on sign-out.',
        ],
        blocks: [
          { caption: 'index.html, inside <head>:', language: 'html', content: tag },
          {
            caption: 'After sign-in, e.g. in a composable or the root component:',
            language: 'ts',
            content: `watch(user, async (current) => {
  if (!current) return window.helpwell?.('reset');
  const { token } = await fetch('/api/helpwell-token', { credentials: 'include' }).then((r) => r.json());
  window.helpwell?.('identify', token);
}, { immediate: true });`,
          },
        ],
        identity:
          'The token comes from an endpoint on your backend that signs it (see the identity signing step); the browser never sees the secret.',
      };
    case 'sveltekit':
      return {
        where: 'In src/app.html, inside <head>, so it is on every page.',
        steps: [
          'Open src/app.html.',
          'Paste the script tag inside <head>, after %sveltekit.head%.',
          'For signed-in people, sign a token in src/routes/+layout.server.ts, return it, and call helpwell("identify", token) in +layout.svelte on mount.',
        ],
        blocks: [
          { caption: 'src/app.html, inside <head>:', language: 'html', content: tag },
          {
            caption: 'src/routes/+layout.server.ts:',
            language: 'ts',
            content: `import { signIdentity } from '@helpwell/core';
import { ${IDENTITY_SECRET_ENV} } from '$env/static/private';

export async function load({ locals }) {
  const user = locals.user;
  return {
    helpwellToken: user
      ? await signIdentity({ id: String(user.id), email: user.email, name: user.name }, ${IDENTITY_SECRET_ENV})
      : null,
  };
}`,
          },
          {
            caption: 'src/routes/+layout.svelte:',
            language: 'svelte',
            content: `<script>
  import { onMount } from 'svelte';
  let { data, children } = $props();
  onMount(() => {
    if (data.helpwellToken) window.helpwell?.('identify', data.helpwellToken);
  });
</script>

{@render children()}`,
          },
        ],
        identity:
          'The layout load function signs the token on the server; the browser only receives the signed token.',
      };
    case 'rails':
      return {
        where:
          'In app/views/layouts/application.html.erb, just before </body>. HelpWell itself runs in a Node app, so use the absolute loader URL unless Rails proxies that path.',
        steps: [
          'Open app/views/layouts/application.html.erb.',
          'Paste the script tag just before </body>.',
          'For signed-in people, add a helper that signs the token (see the identity signing step) and render it as data-token.',
        ],
        blocks: [
          {
            caption: 'app/views/layouts/application.html.erb:',
            language: 'erb',
            content: `<script src="${src}" defer<% if current_user %> data-token="<%= helpwell_token(current_user) %>"<% end %>></script>`,
          },
        ],
        identity:
          'helpwell_token signs with the jwt gem on the server (see the identity signing step). Leave data-token out for visitors who are not signed in.',
      };
    case 'django':
      return {
        where:
          'In the base template every page extends (often templates/base.html), just before </body>. HelpWell itself runs in a Node app, so use the absolute loader URL unless Django proxies that path.',
        steps: [
          'Open the base template.',
          'Paste the script tag just before </body>.',
          'For signed-in people, add a context processor that signs the token (see the identity signing step) and render it as data-token.',
        ],
        blocks: [
          {
            caption: 'templates/base.html:',
            language: 'html',
            content: `<script src="${src}" defer{% if helpwell_token %} data-token="{{ helpwell_token }}"{% endif %}></script>`,
          },
        ],
        identity:
          'A context processor signs the token with PyJWT on the server (see the identity signing step). Leave data-token out for visitors who are not signed in.',
      };
  }
}

/** Install the widget on a site built with `framework`. */
export function widgetInstallPromptSpec(
  framework: WidgetFramework,
  options: InstallPromptOptions,
): SetupPromptSpec {
  const urls = loaderUrls(options);
  // Node frameworks usually serve HelpWell from the same app; Rails and Django
  // cannot, so they get the absolute URL when there is one.
  const src =
    (framework === 'rails' || framework === 'django') && urls.absolute ? urls.absolute : urls.path;
  const how = recipe(framework, src);
  const label = WIDGET_FRAMEWORKS.find((f) => f.key === framework)?.label ?? framework;
  const product = options.productName?.trim() || 'my product';
  const check =
    options.dashboardHint ??
    '"Install the widget" in the Get set up checklist on the HelpWell dashboard';

  return {
    task: `the HelpWell support widget on ${product}'s ${label} site`,
    goal: `The HelpWell launcher appears on every page of the site, loaded by one script tag, and signed-in people are recognised through a signed identify token.`,
    context: [
      `The site is built with ${label}.`,
      `The HelpWell API is mounted at ${cleanPath(options.apiPath)}. The widget loader is served from it at ${urls.path}${
        urls.absolute && urls.absolute !== urls.path
          ? ` (${urls.absolute} from any other origin)`
          : ''
      }.`,
      `The loader is about ${LOADER_GZIP_KB} KB gzipped and waits for the page to finish loading before it fetches the widget, so it never slows the page down. It works out where the API is from its own URL, host included, so the same tag works on a site on another origin. A data-api attribute is only needed when the API lives somewhere other than where the loader is served from.`,
      `Where it goes: ${how.where}`,
      `Identity: ${how.identity}`,
      `Identify tokens are signed on the server with the secret in ${IDENTITY_SECRET_ENV}. The browser only ever sees the signed token.`,
      'When the site is on another origin than the HelpWell API, the API has to list the site in corsOrigins (createHelpWellHandler({ corsOrigins: ["https://www.example.com"] })), or the browser refuses every call. Browsers such as Safari block the API\'s cookie across sites, so the widget then keeps the visitor in an X-HelpWell-Visitor header instead; nothing else changes. Images in articles and answers come from the API as absolute URLs built from the address each request arrives at; behind a proxy that changes that address, set publicUrl (createHelpWellHandler({ publicUrl: "https://app.example.com/api/helpwell" })).',
      'Nothing else is needed: no npm package in the front end, and no file to copy into the app.',
    ],
    steps: [
      ...how.steps,
      'If the site sends a Content-Security-Policy header (look in the server config, middleware, next.config or a <meta http-equiv> tag), add the sources in the Content-Security-Policy table below to each directive, keeping what is already there. If it sends none, change nothing.',
      'Start the site (or deploy it) and open any page.',
    ],
    tables: [
      {
        title: 'Values',
        rows: [
          { name: 'Loader URL (same origin)', value: urls.path },
          {
            name: 'Loader URL (another origin)',
            value: urls.absolute ?? `https://<the host that runs HelpWell>${urls.path}`,
          },
          { name: 'Identity secret variable', value: IDENTITY_SECRET_ENV },
        ],
      },
      {
        title: `Content-Security-Policy additions${
          options.inlineVideo || options.botCheck
            ? ` (with ${[options.inlineVideo ? 'inline video' : '', options.botCheck ? 'the bot check' : ''].filter(Boolean).join(' and ')} switched on)`
            : ''
        }`,
        rows: Object.entries(
          widgetCsp({
            api: src.startsWith('http') ? new URL(src).origin : "'self'",
            inlineVideo: options.inlineVideo,
            botCheck: options.botCheck,
          }),
        ).map(([directive, sources]) => ({ directive, add: sources.join(' ') })),
      },
    ],
    blocks: how.blocks,
    rules: [
      `Never put the value of ${IDENTITY_SECRET_ENV} in front-end code, in the page, or in this chat. Only the server that signs tokens reads it.`,
      'Add the tag once. Two loader tags load the widget twice.',
    ],
    verify: [
      'Open the site. The HelpWell launcher appears in the bottom corner within a few seconds of the page loading.',
      `The browser's network panel shows ${urls.path} and then a request to ${cleanPath(options.apiPath)}/config, both answering 200.`,
      `${check} turns green, and names the page it saw.`,
    ],
    report:
      'Tell me which file you changed, where the tag went, whether signed-in people get a token, and what the verification showed.',
  };
}

/* ------------------------------------------------------------- model key */

/** Set the OpenRouter key the agent answers with. The person pastes the key. */
export function modelKeyPromptSpec(options: InstallPromptOptions): SetupPromptSpec {
  const product = options.productName?.trim() || 'my product';
  return {
    task: `the OpenRouter key HelpWell answers ${product}'s support questions with`,
    goal: `${OPENROUTER_KEY_ENV} is set in the environment of the server that runs HelpWell, locally and in production, so the agent writes answers instead of falling back to search results.`,
    context: [
      'HelpWell is bring-your-own-key: it calls models through OpenRouter on my account, and I pay OpenRouter directly.',
      `The key is read from the environment variable ${OPENROUTER_KEY_ENV} by the server that mounts the HelpWell API (${cleanPath(options.apiPath)}).`,
      'Without the key, HelpWell still works: it answers with the closest help article and flags the question for the team.',
    ],
    steps: [
      'Tell me to create a key at https://openrouter.ai/keys myself, and to set a monthly credit limit on it there. Do not ask me for the key.',
      `For local development, tell me which env file to add ${OPENROUTER_KEY_ENV}= to (for example .env.local or .env) and to paste the key after the = myself. Make sure that file is in .gitignore.`,
      `For production, tell me where my host keeps environment variables (for example Vercel, Railway, Fly.io or Render project settings) and to add ${OPENROUTER_KEY_ENV} there myself.`,
      'Restart the local server, and redeploy production, so the new variable is read.',
      'Run `npx helpwell doctor` from the repo root.',
    ],
    tables: [
      {
        title: 'Environment variable',
        rows: [
          {
            name: OPENROUTER_KEY_ENV,
            value: '<I paste it myself>',
            where: 'every environment that runs HelpWell',
          },
        ],
      },
    ],
    rules: [
      'Never write the key into source code, a committed file, or this chat.',
      'Do not change any model settings; the defaults are fine to start with.',
    ],
    verify: [
      '`npx helpwell doctor` shows "OpenRouter key  set".',
      "The dashboard's Connections page shows OpenRouter as Connected.",
      '"Add your model key" on the dashboard\'s Get set up page turns green.',
    ],
    report: 'Tell me which files and host settings need the variable, and what doctor printed.',
  };
}

/* ------------------------------------------------------ docs and the index */

/** Put the first articles in the docs folder: written, generated or imported. */
export function docsPromptSpec(
  options: InstallPromptOptions & { docsDir?: string },
): SetupPromptSpec {
  const product = options.productName?.trim() || 'my product';
  const docs = (options.docsDir ?? 'docs').replace(/\/+$/, '') || 'docs';
  return {
    task: `the first help articles for ${product}`,
    goal: `The ${docs}/ folder in my repo holds help articles as Markdown files, one folder per collection, that HelpWell indexes and the agent answers from.`,
    context: [
      `Articles live in ${docs}/<collection>/<article>.md. A folder is a collection; a file one level down is an article. Anything in a folder starting with _ or . is ignored.`,
      'Each file starts with front matter: title (required), description (one line), status (published, draft or archived), order (a number).',
      'Write for a customer who is stuck: the title is what they would search for, the answer comes first, then the steps. Second person, short sentences.',
      '`npx helpwell docs generate` drafts a set of articles from the code. `npx helpwell import <source>` brings articles over from Zendesk, Intercom, Help Scout, Freshdesk, Document360, Crisp, GitBook, Notion, HTML or a URL.',
    ],
    steps: [
      'Ask me whether I already have help articles somewhere else. If I do, run `npx helpwell import` for that source and show me what it brought over.',
      `If I do not, run \`npx helpwell docs generate\` and show me the drafts it wrote under ${docs}/.`,
      'Check each article against the code. Remove anything that is not true of the product today, and never invent a price, a limit or a date.',
      'Set status: published on the ones that are ready.',
      'Run `npx helpwell sync` to index them.',
    ],
    blocks: [
      {
        caption: `An article, ${docs}/getting-started/inviting-your-team.md:`,
        language: 'md',
        content: `---
title: Inviting your team
description: Add teammates to your workspace and choose what they can do.
status: published
order: 1
---

Open **Settings**, then **Team**, and choose **Invite**.

## Choose a role

- **Admin** can change billing and settings.
- **Member** can use everything else.`,
      },
    ],
    rules: [
      'Only write what the code or my existing docs support. Leave a [TODO: …] where a fact is missing.',
    ],
    verify: [
      `\`ls ${docs}\` shows at least one collection folder with Markdown files in it.`,
      "The dashboard's Knowledge base page lists the articles.",
      '"Write your first articles" on the dashboard\'s Get set up page turns green.',
    ],
  };
}

/** Index the docs, and keep the index fresh when they change. */
export function searchIndexPromptSpec(
  options: InstallPromptOptions & { docsDir?: string },
): SetupPromptSpec {
  const docs = (options.docsDir ?? 'docs').replace(/\/+$/, '') || 'docs';
  return {
    task: 'the HelpWell search index for my docs',
    goal: `Every article in ${docs}/ is in HelpWell's search index, with embeddings so search matches on meaning as well as words, and the index is rebuilt automatically whenever the docs change.`,
    context: [
      '`npx helpwell sync` reads the docs folder, indexes every article, embeds the changed ones with the embedding model, and pushes helpwell/helpwell.config.json to the database.',
      `Embeddings need ${OPENROUTER_KEY_ENV} in the environment where sync runs. Without it, sync still builds full-text search.`,
      'Sync needs the same database the app uses: HELPWELL_DATABASE_URL when HelpWell uses a Postgres server, or nothing for the embedded database.',
    ],
    steps: [
      'Run `npx helpwell sync` from the repo root and show me the output.',
      'Run `npx helpwell doctor` and show me the Embeddings and Search lines.',
      'Add `npx helpwell sync` to the deploy (a build step, a release command, or a CI job on pushes that change the docs folder), so the index follows the repo.',
      `In CI, tell me to add ${OPENROUTER_KEY_ENV} and, if used, HELPWELL_DATABASE_URL as repository secrets myself.`,
    ],
    blocks: [
      {
        caption: 'A GitHub Actions job that syncs when the docs change:',
        language: 'yaml',
        content: `name: HelpWell sync
on:
  push:
    branches: [main]
    paths: ['${docs}/**', 'helpwell/**']
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx helpwell sync
        env:
          ${OPENROUTER_KEY_ENV}: \${{ secrets.${OPENROUTER_KEY_ENV} }}
          HELPWELL_DATABASE_URL: \${{ secrets.HELPWELL_DATABASE_URL }}`,
      },
    ],
    rules: ['Never print or commit a key or a database URL.'],
    verify: [
      '`npx helpwell doctor` shows every article embedded and "Search  full-text search returned" some results.',
      '"Build the search index" on the dashboard\'s Get set up page turns green.',
    ],
  };
}

/** Ask the agent a first question and check the answer, end to end. */
export function firstAnswerPromptSpec(options: InstallPromptOptions): SetupPromptSpec {
  const api = cleanPath(options.apiPath);
  const origin = options.origin?.replace(/\/+$/, '') ?? '';
  const base = /^https?:\/\//.test(api) ? api : `${origin || 'http://localhost:3000'}${api}`;
  return {
    task: `a first end-to-end test of the HelpWell agent for ${options.productName?.trim() || 'my product'}`,
    goal: 'One real question asked through the HelpWell API gets an answer that cites a help article, and the conversation shows up in the dashboard.',
    context: [
      `The API is at ${base}. POST ${api}/chat with {"message": "..."} asks the agent a question, exactly as the widget does.`,
      'A good answer cites at least one article: the response lists them under "citations". "unresolved": true means the docs did not cover it, and the question is now on the Gaps list.',
    ],
    steps: [
      'Pick a question one of the published help articles clearly answers. Tell me which article.',
      'Send it with the curl command below, with the question swapped in.',
      'Show me the answer text, the citations and whether it is unresolved.',
      'If it is unresolved, show me the article you expected, so I can check it is published and indexed.',
    ],
    blocks: [
      {
        caption: 'Ask a question:',
        language: 'bash',
        content: `curl -s -X POST ${base}/chat \\
  -H 'content-type: application/json' \\
  -d '{"message": "How do I invite my team?"}'`,
      },
    ],
    verify: [
      'The response has a non-empty "text" and at least one entry in "citations".',
      "The dashboard's Conversations page lists the question, with the answer and its citations.",
      '"Answer your first question" on the dashboard\'s Get set up page turns green.',
    ],
  };
}

/* ------------------------------------------------------------- eval cases */

/** Add eval cases to helpwell/evals.json and run them. */
export function evalCasesPromptSpec(
  options: InstallPromptOptions & { questions?: string[] },
): SetupPromptSpec {
  const product = options.productName?.trim() || 'my product';
  const questions = (options.questions ?? []).filter((q) => q.trim()).slice(0, 10);
  return {
    task: `eval cases for ${product}'s HelpWell support agent`,
    goal: 'helpwell/evals.json holds a case for each question below, each with rules that say what a right answer looks like, and `npx helpwell eval` runs them all.',
    context: [
      'Eval cases live in helpwell/evals.json in the repo: a JSON array of cases, or {"cases": [...]}. Every run replays each question through the real agent and records the results, which the dashboard\'s Evals page shows.',
      'Each case needs an "id" (short, unique, kebab-case) and a "question". The rest are optional rules, and a case is judged on the ones it has.',
      '"expect": the slug of the article the answer should cite, like "billing/exporting-invoices", or null when the docs should not cover the question (the agent must then say so and mark it unresolved).',
      '"must" and "mustNot": lists of text the answer has to contain or must never contain. Case-insensitive; write "/like this/i" for a regular expression.',
      '"expectUnresolved": true when the agent should flag it as not covered, false when it should answer.',
      '"grade": "model" with a "rubric": the writing model judges the answer against the rubric. Use it for things text cannot check, like "declines politely".',
      '"note": for people; the runner never reads it.',
      'Article slugs are the Markdown file paths under the docs folder without ".md", e.g. docs/billing/exporting-invoices.md is "billing/exporting-invoices".',
    ],
    steps: [
      'Open helpwell/evals.json. Keep every case already there.',
      ...(questions.length > 0
        ? ['Add one case for each question in the table below.']
        : [
            'Ask me which questions to add, or suggest five that real customers would ask, and wait for me to confirm.',
          ]),
      'For each question, find the article in the docs folder that answers it and set "expect" to its slug. If no article answers it, set "expect": null.',
      'Add "must" with one or two phrases a right answer has to include, taken from the article. Add "mustNot" for anything the docs do not say that an assistant might invent, such as a price.',
      'Run `npx helpwell eval` from the repo root and show me the score and any failed cases.',
    ],
    ...(questions.length > 0
      ? {
          tables: [
            { title: 'Questions to add', rows: questions.map((question) => ({ question })) },
          ],
        }
      : {}),
    blocks: [
      {
        caption: 'The shape of a case:',
        language: 'json',
        content: JSON.stringify(
          {
            id: 'export-invoices',
            question: 'How do I export my invoices?',
            expect: 'billing/exporting-invoices',
            must: ['Export CSV'],
            mustNot: ['/\\$\\d+/'],
          },
          null,
          2,
        ),
      },
    ],
    rules: [
      'Do not change or delete existing cases unless I ask.',
      'Do not edit articles to make a case pass. Tell me which articles need work instead.',
    ],
    verify: [
      '`npx helpwell eval` finishes and lists every new case by id.',
      "The run appears at the top of the dashboard's Evals page.",
    ],
    report: 'Tell me the cases you added, the score, and which cases failed and why.',
  };
}

/* -------------------------------------------------------------- identity */

/** Sign identify tokens on the server, in the language the app is written in. */
export function identitySigningPromptSpec(options: InstallPromptOptions): SetupPromptSpec {
  const product = options.productName?.trim() || 'my product';
  const api = cleanPath(options.apiPath);
  return {
    task: `signed identify tokens, so HelpWell knows who is signed in to ${product}`,
    goal: 'My server signs a short-lived token for the signed-in person and hands it to the widget, and HelpWell verifies it, so conversations are tied to real accounts and nobody can pretend to be someone else.',
    context: [
      'The token is a JWT (RFC 7519) signed with HMAC-SHA256, "alg": "HS256", keyed with the UTF-8 bytes of the shared secret.',
      `The secret is in the environment variable ${IDENTITY_SECRET_ENV}, set to the same value on my app's server (which signs) and on the server that runs the HelpWell API at ${api} (which verifies). If they are the same app, it is one variable.`,
      'Required claim: "sub", my own user id as a string. Recommended: "iat" (now) and "exp" (at most 7 days later; HelpWell rejects expired tokens).',
      'Optional claims with a meaning: "email", "name", "avatarUrl", "createdAt" (when they signed up, ISO 8601), "consent" ("granted" or "denied"), "locale", "timezone". Any other claim becomes an attribute on the contact, e.g. "plan": "pro".',
      'Attributes merge: a claim that is present sets the value, a claim set to null removes it, and a claim left out is kept.',
      'The token reaches the widget either as data-token="…" on the loader script tag or through helpwell("identify", token) in the browser. On sign-out, call helpwell("reset").',
    ],
    steps: [
      `Tell me to generate a random secret myself (for example \`openssl rand -hex 32\` in a terminal) and paste it as ${IDENTITY_SECRET_ENV} into my env file and my host's environment settings. Do not ask me for it and do not generate it for me in this chat.`,
      'Find where my app knows who is signed in on the server (a session helper, current_user, request.user).',
      'Add a function that signs the token for that person with the code below for my language. Sign on the server only.',
      'Pass the token to the widget: render it into the loader tag as data-token, or expose it from an endpoint my front end calls after sign-in and hand it to helpwell("identify", token).',
      'Call helpwell("reset") when someone signs out, so the next person on a shared computer starts fresh.',
    ],
    tables: [
      {
        title: 'Token',
        rows: [
          { field: 'header', value: '{"alg":"HS256","typ":"JWT"}' },
          { field: 'sub', value: 'your user id, as a string (required)' },
          { field: 'iat / exp', value: 'issued now, expires within 7 days' },
          { field: 'email, name', value: 'optional, shown on the contact' },
          { field: 'anything else', value: 'optional, becomes an attribute' },
          { field: 'secret', value: `the environment variable ${IDENTITY_SECRET_ENV}` },
        ],
      },
    ],
    blocks: [
      {
        caption: 'Node or TypeScript, with @helpwell/core:',
        language: 'ts',
        content: `import { signIdentity } from '@helpwell/core';

export function helpwellToken(user: { id: string | number; email?: string; name?: string }) {
  return signIdentity(
    { id: String(user.id), email: user.email, name: user.name },
    process.env.${IDENTITY_SECRET_ENV} ?? '',
    { expiresIn: '7d' },
  );
}`,
      },
      {
        caption: 'Python, with PyJWT (pip install pyjwt):',
        language: 'python',
        content: `import os, time
import jwt

def helpwell_token(user):
    now = int(time.time())
    claims = {"sub": str(user.id), "email": user.email, "name": user.get_full_name(), "iat": now, "exp": now + 7 * 24 * 3600}
    return jwt.encode(claims, os.environ["${IDENTITY_SECRET_ENV}"], algorithm="HS256")`,
      },
      {
        caption: 'Ruby, with the jwt gem (gem "jwt"):',
        language: 'ruby',
        content: `require "jwt"

def helpwell_token(user)
  now = Time.now.to_i
  claims = { sub: user.id.to_s, email: user.email, name: user.name, iat: now, exp: now + 7 * 24 * 3600 }
  JWT.encode(claims, ENV.fetch("${IDENTITY_SECRET_ENV}"), "HS256")
end`,
      },
      {
        caption: 'PHP, with firebase/php-jwt (composer require firebase/php-jwt):',
        language: 'php',
        content: `use Firebase\\JWT\\JWT;

function helpwell_token($user): string {
    $now = time();
    $claims = ['sub' => (string) $user->id, 'email' => $user->email, 'name' => $user->name, 'iat' => $now, 'exp' => $now + 7 * 24 * 3600];
    return JWT::encode($claims, getenv('${IDENTITY_SECRET_ENV}'), 'HS256');
}`,
      },
    ],
    rules: [
      `Never send ${IDENTITY_SECRET_ENV} to the browser, log it, commit it, or put it in this chat.`,
      'Sign tokens only for the person the server has already authenticated. Never sign a user id the browser sent.',
      'Do not use any algorithm other than HS256; HelpWell rejects everything else.',
    ],
    verify: [
      "Sign in to the app and open the widget. The HelpWell dashboard's Contacts page lists you as signed in, with your email.",
      `A request to ${api}/identify with a token signed by a different secret answers 401.`,
      '"Identify signed-in people" on the dashboard\'s Get set up page turns green.',
    ],
    report:
      'Tell me where the token is signed, how it reaches the widget, where the secret is read from, and the result of the checks.',
  };
}
