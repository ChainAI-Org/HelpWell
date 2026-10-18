/**
 * The one engage step that needs code in the customer's app: telling the
 * widget when something happened, or asking it to show an engagement now.
 *
 * Every other trigger (page load, delay, scroll depth, exit intent, time on
 * page, inactivity, a click on a selector) needs nothing but the widget's
 * script tag. A custom event and a manual show need a line in the app, which
 * plenty of people will hand to a coding agent, so this is that prompt in the
 * shared shape. The dashboard's editor shows it under Trigger, filled in with
 * the event name or engagement id being edited, and docs/engage.md prints it.
 */

import type { SetupPromptSpec } from '../setup-prompt.js';

export interface EngageCodePromptOptions {
  productName?: string;
  /** Where the HelpWell API is mounted, e.g. `/api/helpwell`. */
  apiPath?: string;
  /** The engagement being set up. */
  engagementId?: string;
  /** `event`: the page reports an event. `manual`: the page shows it by id. */
  trigger: 'event' | 'manual';
  /** The event name, for `event`. */
  event?: string;
}

export function engageCodePromptSpec(options: EngageCodePromptOptions): SetupPromptSpec {
  const product = options.productName || 'our product';
  const api = (options.apiPath || '/api/helpwell').replace(/\/+$/, '');
  const id = options.engagementId || 'your-engagement-id';
  const event = options.event || 'project_created';
  const isEvent = options.trigger === 'event';

  const context = [
    `${product} has the HelpWell widget installed: a <script src="${api}/assets/loader.js" defer></script> tag in the page layout. It defines a global \`helpwell\` function as soon as it runs, and queues calls made before the widget has loaded, so calling it early is safe.`,
    'Calls never throw and never block the page. If the widget is not on a page, they do nothing.',
    isEvent
      ? `An engagement in HelpWell (id "${id}") is set to appear when the page reports the event "${event}". Reporting it is also recorded as a tracked event on the visitor's contact, which segments and conditions can use.`
      : `An engagement in HelpWell (id "${id}") is set to appear only when the page asks for it by id. Its audience and schedule still apply: if this visitor is not in its audience, or it is outside its dates, nothing shows.`,
  ];

  const steps = isEvent
    ? [
        `Find the place in the app's front-end code where "${event}" happens: the success handler of the action, after the server confirms it, not the button's click handler.`,
        `Add the call below at that point. Keep the event name exactly "${event}": HelpWell matches it character for character.`,
        'If the code is TypeScript and `window.helpwell` is not typed, add the declaration shown below once, in a global .d.ts file.',
        'Do not add the loader script again: it is already in the layout.',
      ]
    : [
        `Find the place in the app's front-end code where the engagement should appear, for example after onboarding finishes or when a feature is first opened.`,
        `Add the call below at that point. Keep the id exactly "${id}".`,
        'To take it off the screen from code (for example when the view changes), call `helpwell.engage.hide()`.',
        'If the code is TypeScript and `window.helpwell` is not typed, add the declaration shown below once, in a global .d.ts file.',
        'Do not add the loader script again: it is already in the layout.',
      ];

  const call = isEvent
    ? `window.helpwell?.('track', '${event}');\n// or, with details kept on the tracked event:\nwindow.helpwell?.('track', '${event}', { plan: 'pro' });`
    : `window.helpwell?.engage?.show('${id}');\n// the same call in the queue form, which works before the widget has loaded:\nwindow.helpwell?.('engage.show', '${id}');`;

  return {
    task: isEvent
      ? `a custom event trigger for a HelpWell engagement in ${product}`
      : `showing a HelpWell engagement from ${product}'s own code`,
    goal: isEvent
      ? `When "${event}" happens in the app, the page tells HelpWell, and the engagement "${id}" appears for the people it targets.`
      : `The app shows the HelpWell engagement "${id}" at the moment it chooses, by calling the widget.`,
    context,
    steps,
    blocks: [
      { caption: 'The call to add:', language: 'ts', content: call },
      {
        caption: 'The TypeScript declaration, only if `window.helpwell` is not typed yet:',
        language: 'ts',
        content: `declare global {\n  interface Window {\n    helpwell?: ((method: string, ...args: unknown[]) => void) & {\n      engage?: { show(id: string): void; hide(): void };\n    };\n  }\n}\nexport {};`,
      },
    ],
    rules: [
      'Change only the front-end code that has to call the widget. Do not touch the HelpWell config or its API routes.',
      isEvent
        ? 'Report the event once per time it really happens, not on every render.'
        : 'Call show once per time the engagement should appear, not on every render.',
    ],
    verify: [
      isEvent
        ? `Open the app in a browser, open the developer console, and run \`helpwell('track', '${event}')\`. The engagement should appear (if it has already been dismissed for you, try a private window).`
        : `Open the app in a browser, open the developer console, and run \`helpwell.engage.show('${id}')\`. The engagement should appear.`,
      'Now do the real thing in the app and check that it appears the same way.',
      `In the HelpWell dashboard, open Engage, then this engagement's Results: Impressions has gone up.`,
    ],
    report:
      'Tell me which file and function you changed, the exact line you added, and whether both checks passed.',
  };
}
