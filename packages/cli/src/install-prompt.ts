/**
 * The master setup prompt: HelpWell, installed into an app that already
 * exists, by an AI assistant.
 *
 * Every other setup prompt lives in core, because the dashboard shows it
 * beside a step of a running install. This one comes before there is any
 * install, dashboard or config to read, so it lives with the files `init`
 * writes, and reuses `init`'s own mount code rather than a second copy that
 * could drift from it. The README prints it (generated, see
 * scripts/readme.mjs) and `helpwell prompt install` prints it filled in with
 * what the CLI can see: the framework package.json points at and the package
 * manager's lockfile.
 *
 * Like every setup prompt it carries no secret: the person pastes the key and
 * the identity secret into their own env file.
 */

import { IDENTITY_SECRET_ENV, OPENROUTER_KEY_ENV, type SetupPromptSpec } from '@helpwell/core';
import { mountSnippet, widgetSnippet } from './templates.js';

/** The frameworks `init --framework` prints mount code for. */
export type MountFramework = 'next' | 'remix' | 'hono' | 'node';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface InstallPromptOptions {
  productName?: string;
  /** What the app is built with, when the CLI could tell. */
  framework?: MountFramework | null;
  /** How that was worked out, for the assistant: "next in package.json". */
  detected?: string | null;
  packageManager?: PackageManager;
  /** Where the API is mounted. */
  apiPath?: string;
  docs?: string;
}

/** Every package an app installs, the CLI included. One line, so none is forgotten. */
export const INSTALL_PACKAGES = [
  'helpwell',
  '@helpwell/core',
  '@helpwell/helpcenter',
  '@helpwell/dashboard',
  '@helpwell/widget',
] as const;

const FRAMEWORK_LABELS: Record<MountFramework, string> = {
  next: 'Next.js',
  remix: 'Remix (or React Router in framework mode)',
  hono: 'Hono',
  node: 'a server that takes a web Request and returns a Response',
};

export function installCommand(
  manager: PackageManager = 'npm',
  packages: readonly string[] = INSTALL_PACKAGES,
): string {
  const verb = manager === 'npm' ? 'install' : 'add';
  return `${manager} ${verb} ${packages.join(' ')}`;
}

/** Where the shared module goes, which the steps name. */
const SHARED_MODULE: Record<MountFramework, string> = {
  next: 'lib/helpwell.ts',
  remix: 'app/lib/helpwell.server.ts',
  hono: 'lib/helpwell.ts',
  node: 'lib/helpwell.ts',
};

export function installPromptSpec(options: InstallPromptOptions = {}): SetupPromptSpec {
  const product = options.productName?.trim() || 'my product';
  const manager = options.packageManager ?? 'npm';
  const api = (options.apiPath ?? '/api/helpwell').replace(/\/+$/, '') || '/api/helpwell';
  const docs = (options.docs ?? 'docs').replace(/\/+$/, '') || 'docs';
  const framework = options.framework ?? null;
  // Without a detected framework the prompt shows Next.js, the most common
  // host, and says `init` prints the code for the others.
  const shown: MountFramework = framework ?? 'next';

  return {
    task: `HelpWell, the self-hosted help desk, in ${product}'s existing app`,
    goal: `HelpWell runs inside the app: its API at ${api}, the help center at /help and the dashboard at /admin/helpwell behind the app's own admin check. The widget loads on every page, the articles in ${docs}/ are indexed, and \`npx helpwell doctor\` reports no failures.`,
    context: [
      'HelpWell is a set of npm packages, not a service: no account, no separate server. Each part is a function that takes a web Request and returns a Response, mounted in the app like any route. It needs Node 22 or newer.',
      framework
        ? `The app is built with ${FRAMEWORK_LABELS[framework]}${options.detected ? ` (${options.detected})` : ''}.`
        : 'I have not said what the app is built with: work it out from package.json.',
      `The package manager is ${manager}${manager === 'npm' ? ' unless the lockfile says otherwise' : ''}.`,
      `\`npx helpwell init\` writes helpwell/helpwell.config.json (every setting), helpwell/instructions.md (the agent's system prompt), helpwell/playbook.md, helpwell/evals.json (twelve starter eval cases), ${docs}/README.md, a first article at ${docs}/getting-started/welcome.md and .env.example, and adds helpwell/data/ (the local database) and helpwell/.auth/ to .gitignore. It touches nothing else and uses no network or database, apart from one read-only question to GitHub about releases when the repo's origin is there.`,
      "The database: with HELPWELL_DATABASE_URL unset, HelpWell keeps its data in an embedded Postgres under helpwell/data, which is right for development. In production, set HELPWELL_DATABASE_URL to a Postgres database (the app's own is fine: HelpWell keeps to its own `helpwell` schema) and install the `postgres` package. HelpWell never reads DATABASE_URL.",
      `The AI is bring-your-own-key through OpenRouter, read from ${OPENROUTER_KEY_ENV}. Without it the agent answers with the closest article and search still works.`,
      `Signed-in people are recognised by a token the app's server signs with ${IDENTITY_SECRET_ENV}; that is a separate step once this works.`,
      "The dashboard and the admin API have no login of their own: both take isAdmin(request), which should rest on the app's existing session. The isAdmin in the code `init` prints fails closed: until it is replaced, the only admin is someone holding HELPWELL_ADMIN_TOKEN (at least 32 characters), entered in the form the dashboard shows when it answers 401 or sent as a bearer token, and while that is unset nobody gets in. The token keeps working after isAdmin is replaced, because both handlers are given it as adminToken.",
    ],
    steps: [
      'Read package.json and the lockfile. Tell me the framework, the package manager, and whether HelpWell is already installed (a helpwell/ folder). If the app is not a Node app (Rails, Django, PHP), stop and ask me: HelpWell would then run as a small Node service beside it.',
      'Install the packages with the command below, using the package manager the lockfile belongs to.',
      `Run \`npx helpwell init --framework ${framework ?? '<next | remix | hono | node>'}\` from the repo root. It prints the mount code for that framework; keep that output.`,
      `Create the shared module (${framework ? SHARED_MODULE[framework] : 'lib/helpwell.ts, or app/lib/helpwell.server.ts on Remix'}) from the code below. It already passes the agent's instructions and playbook, so edits to those files reach the agent. Then replace isAdmin with the app's real admin check, where its TODO says; the API and the dashboard both use it.`,
      `Create the other files below: the API under ${api}, answering every method (OPTIONS too, for the preflight of a widget on another site), the help center under /help and the dashboard under /admin/helpwell. These are the files for ${FRAMEWORK_LABELS[shown]}; one marked "merged into what is there" is lines to add to a file the app already has.`,
      `Add ${OPENROUTER_KEY_ENV}= and ${IDENTITY_SECRET_ENV}= to the env file the app loads (for example .env.local or .env), with no values, and make sure that file is in .gitignore. Then tell me to paste the values in myself: the key from https://openrouter.ai/keys, and a secret I generate with \`openssl rand -hex 32\`.`,
      'Add the widget script tag below to the root layout, just before the closing </body>, once.',
      `Put the first articles in ${docs}/: \`npx helpwell import <source>\` if I have a help center elsewhere (ask me), \`npx helpwell docs generate\` to draft them from the code once the key is set, or leave the welcome article for now.`,
      'Run `npx helpwell sync` to build the first search index.',
      'Run `npx helpwell doctor`, start the app, and do the checks below.',
    ],
    tables: [
      {
        title: 'Environment variables',
        rows: [
          {
            name: OPENROUTER_KEY_ENV,
            needed: 'for written answers; without it, search-only answers',
            value: '<I paste it myself>',
          },
          {
            name: IDENTITY_SECRET_ENV,
            needed: 'to recognise signed-in people',
            value: '<I paste it myself>',
          },
          {
            name: 'HELPWELL_DATABASE_URL',
            needed: 'production; unset means the embedded database under helpwell/data',
            value: '<I paste it myself>',
          },
          {
            name: 'HELPWELL_ADMIN_TOKEN',
            needed:
              'optional: the dashboard sign-in until isAdmin is replaced, and scripts and CI; at least 32 characters',
            value: '<I paste it myself>',
          },
        ],
      },
      {
        title: 'Where each part is mounted',
        rows: [
          { path: api, what: 'the API, which also serves the widget script' },
          { path: '/help', what: 'the public help center' },
          { path: '/admin/helpwell', what: 'the dashboard, behind isAdmin' },
        ],
      },
    ],
    blocks: [
      { caption: 'Install:', language: 'bash', content: installCommand(manager) },
      {
        caption: `Every file, as \`init --framework ${shown}\` prints it, the shared module first:`,
        language: 'ts',
        content: mountSnippet(shown, docs),
      },
      {
        caption: 'The widget, in the root layout:',
        language: 'html',
        content: widgetSnippet(api),
      },
    ],
    rules: [
      'Never write a key, a secret or a database URL into source code, a committed file or this chat.',
      'Never point HELPWELL_DATABASE_URL at a database without asking me first.',
      "Never write an isAdmin that a request can pass on its own, with a cookie, header or query value anyone can set: it must rest on the app's existing session. If you cannot find the app's admin check, leave the fail-closed one in place and tell me.",
      'Do not commit helpwell/data/: it is the local database.',
    ],
    verify: [
      '`npx helpwell doctor` shows no ✗ lines. It ends with "Everything checks out." or, until the key is set, "Working, with N things worth a look."',
      `With the app running, \`curl -s -o /dev/null -w "%{http_code}\\n" http://localhost:3000${api}/config\` prints 200 (use the app's own port).`,
      'Any page of the app shows the HelpWell launcher within a few seconds, and /help shows the welcome article.',
      '/admin/helpwell opens the dashboard for an admin, and answers 401 when signed out. With HELPWELL_ADMIN_TOKEN set, that 401 page asks for the token, and entering it opens the dashboard.',
      "The app's production build (`npm run build` or its equivalent) succeeds. HelpWell opens its database on the first request, never while building, so the build needs no database.",
      `\`curl -s -o /dev/null -w "%{http_code}\\n" -H "Cookie: role=admin; admin=true" http://localhost:3000/admin/helpwell\` prints 401: a cookie anyone can set never makes an admin.`,
    ],
    report:
      'Tell me the framework, every file you created or changed, which values I still need to paste into the env file, and what doctor and the checks showed.',
  };
}
