/**
 * Setup prompts for the widget's outside dependencies: the Content-Security-
 * Policy a site needs for it (inline video and the bot check change it), and
 * the Cloudflare Turnstile bot check. Both are jobs done outside HelpWell (in
 * the site's CSP, the Cloudflare dashboard, the server's environment), so
 * each comes as a prompt a person can hand to an AI assistant. The dashboard
 * renders them with `setupPromptPanel`; putting the tag on the page is the
 * install prompt's job (`install-prompts.ts`).
 *
 * The CSP the widget needs is spelled out here once, as data (`widgetCsp`),
 * so the prompts, the docs and a test all read the same list.
 */

import { TURNSTILE_SECRET_ENV } from './api/human-check.js';
import type { SetupPromptSpec } from './setup-prompt.js';

/**
 * The video players the widget frames when `widget.media.inlineVideo` is on.
 * The same list as the help centre's `VIDEO_EMBED_ORIGINS` in `@helpwell/ui`,
 * written out here because core does not depend on the renderer.
 */
export const WIDGET_VIDEO_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.loom.com',
  'https://fast.wistia.net',
] as const;

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * The CSP directives a host page needs for the widget, given what is
 * switched on. `api` is the API's origin, or `'self'` when it is served from
 * the same site as the page (the usual install).
 */
export function widgetCsp(
  options: { api?: string; inlineVideo?: boolean; botCheck?: boolean } = {},
): Record<string, string[]> {
  const api = options.api || "'self'";
  const frames = [
    ...(options.inlineVideo ? WIDGET_VIDEO_ORIGINS : []),
    ...(options.botCheck ? [TURNSTILE_ORIGIN] : []),
  ];
  return {
    'script-src': [api, ...(options.botCheck ? [TURNSTILE_ORIGIN] : [])],
    'connect-src': [api],
    // The widget's stylesheet is a <style> element inside its shadow root.
    'style-src': ["'unsafe-inline'"],
    // Screenshots and images in answers and articles, from the API or any https host.
    'img-src': [api, 'https:'],
    'media-src': [api, 'https:'],
    // Plus Jakarta Sans, which the API serves itself for a page that lacks it.
    'font-src': [api],
    ...(frames.length > 0 ? { 'frame-src': frames } : {}),
  };
}

function cspRows(csp: Record<string, string[]>): { directive: string; add: string }[] {
  return Object.entries(csp).map(([directive, sources]) => ({
    directive,
    add: sources.join(' '),
  }));
}

export interface WidgetCspPromptOptions {
  productName?: string;
  /** Where the API is mounted, e.g. `/api/helpwell`. */
  apiPath?: string;
  /** The API's origin when the widget runs on another site; `'self'` otherwise. */
  apiOrigin?: string;
  inlineVideo?: boolean;
  botCheck?: boolean;
}

/**
 * Let the widget through a site's Content-Security-Policy, for what is
 * switched on: inline video players and the Turnstile challenge on top of
 * the basics. The install prompt covers putting the tag on the page; this is
 * the part that changes when a media or bot-check setting does.
 */
export function widgetCspPromptSpec(options: WidgetCspPromptOptions = {}): SetupPromptSpec {
  const product = options.productName || 'my app';
  const apiPath = (options.apiPath || '/api/helpwell').replace(/\/+$/, '');
  const csp = widgetCsp({
    api: options.apiOrigin,
    inlineVideo: options.inlineVideo,
    botCheck: options.botCheck,
  });
  const extras = [
    options.inlineVideo ? 'inline video players' : null,
    options.botCheck ? 'the Turnstile challenge' : null,
  ].filter(Boolean);
  return {
    task: `the Content-Security-Policy for the HelpWell widget on ${product}`,
    goal: `Every page that shows the HelpWell widget allows what the widget loads (its scripts, its API calls, images in answers${
      extras.length > 0 ? `, ${extras.join(' and ')}` : ''
    }), and nothing else in the policy is loosened.`,
    context: [
      `The HelpWell API is mounted at ${apiPath}${
        options.apiOrigin ? ` on ${options.apiOrigin}` : ', on the same site as the pages'
      }. It serves the widget's scripts and font, and answers its requests.`,
      'The widget draws its styles from a <style> element inside its Shadow DOM, which is why style-src needs unsafe-inline.',
      options.inlineVideo
        ? `Inline video is on: YouTube (no-cookie), Vimeo, Loom and Wistia players are framed in the panel, but only after a visitor clicks play. Their origins are ${WIDGET_VIDEO_ORIGINS.join(', ')}.`
        : 'Inline video is off: videos open on the provider site in a new tab, so no player is framed.',
      ...(options.botCheck
        ? [
            `The Turnstile bot check is on: the widget loads a script and a challenge frame from ${TURNSTILE_ORIGIN}.`,
          ]
        : []),
    ],
    steps: [
      'Find where the site sets its Content-Security-Policy: a response header (middleware, server config, a framework setting) or a <meta http-equiv> tag. If it sets none, stop and tell me: nothing needs to change.',
      "For each directive in the table, add the sources listed to the ones already there. If the directive is missing, add it with default-src's sources plus these.",
      'Deploy, or restart the dev server.',
    ],
    tables: [{ title: 'Content-Security-Policy additions', rows: cspRows(csp) }],
    rules: [
      'Only add sources. Do not remove or replace any source or directive already there.',
      "Do not add 'unsafe-eval' or a bare wildcard (*): the widget needs neither.",
    ],
    verify: [
      'Open a page with the widget and open the panel. The browser console shows no Content-Security-Policy violation.',
      ...(options.inlineVideo
        ? [
            'Open an answer or article with a YouTube, Vimeo, Loom or Wistia video and press play: the player loads inside the panel.',
          ]
        : []),
      ...(options.botCheck ? ['Send a test message from the widget: it gets an answer.'] : []),
    ],
    report: 'Say where the policy is set, and paste the directives you changed, before and after.',
  };
}

export interface TurnstilePromptOptions {
  productName?: string;
  apiPath?: string;
  origin?: string;
  /** Every domain the widget appears on. */
  domains?: string[];
}

/**
 * Turn on the Turnstile bot check: a site in Cloudflare, the site key in the
 * dashboard, the secret in the server's environment (by the person, never
 * through the assistant), and the CSP.
 */
export function turnstilePromptSpec(options: TurnstilePromptOptions = {}): SetupPromptSpec {
  const owner = options.productName ? `${options.productName}'s` : 'my';
  const apiPath = (options.apiPath || '/api/helpwell').replace(/\/+$/, '');
  const origin = (options.origin || 'https://your-app.example').replace(/\/+$/, '');
  const domains = options.domains?.filter(Boolean) ?? [];
  return {
    task: `the Cloudflare Turnstile bot check on ${owner} HelpWell support widget`,
    goal: 'The HelpWell widget runs a Cloudflare Turnstile challenge before the first message of each conversation, and the HelpWell server verifies it. A message sent without a challenge is refused, and a real one from the widget goes through.',
    context: [
      `The HelpWell API is mounted at ${apiPath}. The widget only loads Turnstile (${TURNSTILE_ORIGIN}) while the bot check is on.`,
      `The site key is public: it goes in the HelpWell dashboard. The secret key is private: it only ever goes in the server environment, as ${TURNSTILE_SECRET_ENV}. The bot check stays off until both are set.`,
      'A conversation proves itself once. Later messages in it, and the email a visitor leaves on it, need no second challenge.',
      ...(domains.length > 0 ? [`The widget appears on: ${domains.join(', ')}.`] : []),
    ],
    steps: [
      'In the Cloudflare dashboard, open Turnstile and add a widget (a "site") named after the product.',
      'Add every domain the HelpWell widget appears on, including staging. Cloudflare lets localhost through on its test keys only.',
      'Choose the Managed widget mode.',
      'Copy the site key. Tell me to paste it in the HelpWell dashboard under Settings, Abuse, set Bot check to Turnstile, and save.',
      `Tell me to add the secret key myself, as the environment variable ${TURNSTILE_SECRET_ENV} on the server that runs HelpWell, and then to restart or redeploy it. Do not ask me for the secret.`,
      `If the site sends a Content-Security-Policy, add ${TURNSTILE_ORIGIN} to script-src and frame-src.`,
    ],
    tables: [
      {
        title: 'Values',
        rows: [
          { setting: 'Turnstile widget mode', value: 'Managed' },
          {
            setting: 'HelpWell dashboard',
            value: 'Settings, Abuse: Bot check = Turnstile, site key',
          },
          { setting: 'Server environment variable', value: TURNSTILE_SECRET_ENV },
          { setting: 'CSP script-src', value: TURNSTILE_ORIGIN },
          { setting: 'CSP frame-src', value: TURNSTILE_ORIGIN },
          ...domains.map((domain) => ({ setting: 'Turnstile domain', value: domain })),
        ],
      },
    ],
    blocks: [
      {
        caption: 'The widget is told to run a challenge (expect "botCheck" with the site key):',
        language: 'bash',
        content: `curl -s ${origin}${apiPath}/config | grep -o '"botCheck":{[^}]*}'`,
      },
      {
        caption:
          'A message without a challenge is refused (expect a 403 with "humanCheck":"missing"):',
        language: 'bash',
        content: `curl -s -X POST ${origin}${apiPath}/chat -H 'content-type: application/json' -d '{"message":"bot check test"}'`,
      },
    ],
    rules: ['Never put the secret key in the dashboard, the config file, the repo or this chat.'],
    verify: [
      'The first curl prints a botCheck object with provider "turnstile".',
      'The second curl answers with an error whose details say humanCheck "missing".',
      'In a browser, send a test message from the widget: it gets an answer. The dashboard shows "secret set in environment: yes".',
    ],
    report:
      'List the domains you added in Cloudflare, say whether the CSP needed changes, and paste the output of both curl commands.',
  };
}
