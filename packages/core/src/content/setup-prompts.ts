/**
 * The knowledge base's setup steps, as prompts for an AI assistant.
 *
 * Screenshot capture, capture behind a sign-in, and saving articles from the
 * dashboard each need a change in the customer's own repo. Plenty of people
 * will hand that to ChatGPT, Claude or a coding agent, so each has a prompt in
 * the shared shape: the docs README, the project README and the dashboard all
 * print these same specs, and none of them carries a credential. The sign-in
 * prompt names the environment variables and tells the assistant the person
 * fills them in themselves.
 */

import type { SetupPromptSpec } from '../setup-prompt.js';

export interface CapturePromptOptions {
  /** Where the app runs, from the config's `appUrl`. */
  appUrl?: string;
  /** The docs folder, relative to the repo root. */
  docs?: string;
  /** The screenshots folder, relative to the repo root. */
  screenshots?: string;
}

/** The environment variables the sign-in example reads. Names only, never values. */
export const CAPTURE_ENV = {
  email: 'HELPWELL_CAPTURE_EMAIL',
  password: 'HELPWELL_CAPTURE_PASSWORD',
} as const;

function folders(options: CapturePromptOptions) {
  const docs = options.docs ?? 'docs';
  return { docs, screenshots: options.screenshots ?? `${docs}/_screenshots` };
}

/** Taking the screenshots the articles use, with `helpwell capture`. */
export function captureSetupPrompt(options: CapturePromptOptions = {}): SetupPromptSpec {
  const { docs, screenshots } = folders(options);
  const appUrl = options.appUrl || 'http://localhost:3000';
  return {
    task: 'screenshot capture for our HelpWell help articles',
    goal: `\`npx helpwell capture\` takes the screenshots the help articles reference, from the running app, and writes them to ${screenshots}/, where the help center and the widget load them from.`,
    context: [
      `HelpWell is installed. Its config is helpwell/helpwell.config.json and the articles are Markdown files in ${docs}/.`,
      'Capture runs wherever the app runs: this machine, CI or a container. The server that answers HelpWell requests never needs a browser, and Docker is not required.',
      `The app runs at ${appUrl}: that is the config's appUrl. Change it there if the app runs somewhere else.`,
      'Each screenshot is one entry under screenshots.shots: a name (the file name without .png) and a path on the app. waitFor and click take CSS selectors, clip crops to one element, and dark: true also writes <name>-dark.png.',
      'annotate draws on the screenshot before it is taken: rect, ellipse, arrow, step (a numbered marker), label, spotlight and blur, each anchored to a CSS selector in target. A target that matches nothing is skipped with a warning, never drawn somewhere else.',
    ],
    steps: [
      'Install Playwright as a dev dependency and download Chromium: `npm i -D playwright`, then `npx playwright install chromium`. On Linux, in CI or in a Docker image, use `npx playwright install --with-deps chromium` so the system libraries are installed too. Run `npx helpwell doctor`: its Screenshots line should pass.',
      'If the screenshots should be retaken in CI (for example on each release), add a job that installs Chromium as above, starts the app, waits for it to answer, then runs `npx helpwell capture` and commits the changed images. Ask me first.',
      'Read the articles and pick the two or three screens they describe most. For each, find a stable CSS selector for the part worth showing: ids, data-testid attributes and aria labels, not generated class names.',
      'Add those shots under screenshots.shots in helpwell/helpwell.config.json, following the example below. Keep every shot that is already listed.',
      `Where an article describes one of those screens, reference the image by a path relative to the article, e.g. \`![The billing page](../${screenshots.startsWith(`${docs}/`) ? screenshots.slice(docs.length + 1) : '_screenshots'}/billing.png)\` from ${docs}/<collection>/<article>.md.`,
      'If a screen needs a signed-in user, stop and tell me: signing in is set up separately, with environment variables I fill in myself.',
      'Start the app, then run `npx helpwell capture`.',
    ],
    blocks: [
      {
        caption: 'An example screenshots block for helpwell/helpwell.config.json:',
        language: 'json',
        content: JSON.stringify(
          {
            screenshots: {
              dir: screenshots,
              shots: [
                {
                  name: 'billing',
                  path: '/settings/billing',
                  waitFor: '[data-testid="plan-card"]',
                  clip: 'main',
                  dark: true,
                  annotate: [
                    { type: 'rect', target: '[data-testid="plan-card"]' },
                    { type: 'step', target: '#upgrade', step: 1 },
                    {
                      type: 'arrow',
                      target: '#upgrade',
                      direction: 'left',
                      text: 'Upgrade here',
                    },
                    { type: 'blur', target: '.account-email' },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ),
      },
    ],
    rules: [
      'Never put a password, session cookie or token in helpwell.config.json or in any article.',
      'Only reference screenshots that are listed under screenshots.shots. Never invent an image path.',
    ],
    verify: [
      'Run `npx helpwell capture`. It should print "Wrote N screenshots" and no "could not be taken" lines.',
      `Open the new images in ${screenshots}/ and check each shows the intended screen, not a sign-in page or an error.`,
      'If it printed an annotation warning, a target matched nothing: fix that selector and run it again.',
      'Run `npx helpwell sync`, open an article that uses a screenshot in the help center, and check the image loads.',
    ],
  };
}

/** Capturing pages that sit behind the app's sign-in. */
export function captureLoginSetupPrompt(options: CapturePromptOptions = {}): SetupPromptSpec {
  const appUrl = options.appUrl || 'http://localhost:3000';
  return {
    task: 'signed-in screenshot capture for our HelpWell help articles',
    goal: '`npx helpwell capture` signs in to the app as a test account before it takes screenshots. The credentials come from environment variables and are never written into the repo.',
    context: [
      `The app runs at ${appUrl}.`,
      "The sign-in steps live under screenshots.login in helpwell/helpwell.config.json: url (the sign-in page), fill (each field's CSS selector and the name of the environment variable holding its value), submit (the button to press), and success (a selector that only exists once signed in) or successUrl (part of the URL the app lands on).",
      'HelpWell signs in once per run and reuses that session for every shot, light and dark.',
      'Instead of signing in, screenshots.storageState can name a Playwright storage-state file, and screenshots.cookies can set cookies whose values come from environment variables.',
    ],
    steps: [
      "Use a dedicated test account with demo data, never a real customer's account.",
      'Open the sign-in page and find CSS selectors for the email field, the password field and the submit button, plus one element that only appears after signing in.',
      'Add the login block below under screenshots in helpwell/helpwell.config.json, with the selectors you found.',
      `Add \`${CAPTURE_ENV.email}=\` and \`${CAPTURE_ENV.password}=\`, with no values, to .env.example. Then tell me to put the real values in my own .env file, or in the CI secrets if capture runs in CI.`,
      'Check that .env is in .gitignore.',
    ],
    blocks: [
      {
        caption: 'The login block, under screenshots in helpwell/helpwell.config.json:',
        language: 'json',
        content: JSON.stringify(
          {
            login: {
              url: '/login',
              fill: [
                { selector: 'input[name="email"]', env: CAPTURE_ENV.email },
                { selector: 'input[name="password"]', env: CAPTURE_ENV.password },
              ],
              submit: 'button[type="submit"]',
              success: '[data-testid="account-menu"]',
            },
          },
          null,
          2,
        ),
      },
    ],
    rules: [
      'Never write an email address, password, cookie value or token into helpwell.config.json, .env.example, an article, or this chat. Only the names of the environment variables go in the config.',
      'Never commit a storage-state file: it holds a live session.',
    ],
    verify: [
      'Once I have filled in my .env, run `npx helpwell capture`. It should print "Signed in" and no sign-in error.',
      'Open one of the new screenshots and check it shows the signed-in app, not the sign-in page.',
      'Run `git status` and check no file containing credentials is about to be committed.',
    ],
  };
}

export interface WriteArticlePromptOptions {
  /** The docs folder, relative to the repo root. */
  docs?: string;
}

/** Wiring the dashboard's Save button to the repo with a `writeArticle` hook. */
export function writeArticleSetupPrompt(options: WriteArticlePromptOptions = {}): SetupPromptSpec {
  const docs = options.docs ?? 'docs';
  return {
    task: 'saving help articles from the HelpWell dashboard into our repo',
    goal: `Pressing Save in the dashboard's article editor writes the Markdown file into ${docs}/, so an edit arrives as an ordinary change to review and commit.`,
    context: [
      'HelpWell never writes files itself. The app passes createDashboard a writeArticle(path, markdown) hook, the same way it passes writeInstructions.',
      'path is relative to the docs folder, always <collection>/<file>.md, and HelpWell has already checked it cannot leave that folder. markdown is the whole file, front matter included.',
      'After a save, HelpWell re-indexes that article and records a version in its history.',
      'The same hook can be passed to createHelpWellHandler, so scripts can save through the admin API (POST /admin/articles).',
    ],
    steps: [
      'Find where the app calls createDashboard (often lib/helpwell.ts).',
      'Add the writeArticle hook below to that call, keeping everything already passed.',
      "In production the server's disk is usually not the repo. There, either write through the Git host's API instead, or leave the hook out and the editor offers the file to download.",
      'If scripts should be able to save articles, pass the same function to createHelpWellHandler as writeArticle.',
    ],
    blocks: [
      {
        caption: 'The hook, for a server whose working directory is the repo:',
        language: 'ts',
        content: `import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DOCS = join(process.cwd(), '${docs}');

export const dashboard = createDashboard({
  // ...everything already passed here stays...
  writeArticle: async (path, markdown) => {
    const file = join(DOCS, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, markdown, 'utf8');
  },
});`,
      },
    ],
    rules: [
      'Write only inside the docs folder, and do not add any other endpoint that writes files.',
      "Keep the dashboard behind the app's existing admin check (isAdmin).",
    ],
    verify: [
      'Open the dashboard, go to Knowledge base, open an article, press Edit, change one word and save.',
      `Run \`git diff ${docs}/\` and check it shows exactly that change and nothing else.`,
      'Back on the article page, check the History card lists the new version.',
    ],
  };
}
