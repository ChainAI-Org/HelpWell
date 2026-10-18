/**
 * Putting a form on a site, as prompts for an AI assistant.
 *
 * Embedding a form is a few lines of HTML in someone else's codebase, which
 * plenty of people will hand to a coding agent or ask ChatGPT about for their
 * WordPress site. These are those prompts, in the shared shape
 * (setup-prompt.ts), filled in with the real form id and script tag, and each
 * ends with a check anyone can run: submit a test entry and see it arrive.
 *
 *   formEmbedPromptSpec        the inline embed, for plain HTML, Next.js or WordPress
 *   formPopupButtonPromptSpec  a two-step button or link that opens the form
 */

import { loaderUrls } from '../install-prompts.js';
import type { SetupPromptSpec } from '../setup-prompt.js';

export const FORM_EMBED_PLATFORMS = ['html', 'nextjs', 'wordpress'] as const;
export type FormEmbedPlatform = (typeof FORM_EMBED_PLATFORMS)[number];

export interface FormPromptOptions {
  formId: string;
  formName?: string;
  productName?: string;
  /** Where the HelpWell API is mounted, e.g. `/api/helpwell`. */
  apiPath?: string;
  /** The origin the API answers on, e.g. `https://app.acme.com`, when known. */
  origin?: string | null;
}

function scriptSrc(options: FormPromptOptions): string {
  const urls = loaderUrls({ apiPath: options.apiPath ?? '/api/helpwell', origin: options.origin });
  return urls.absolute ?? urls.path;
}

function commonContext(options: FormPromptOptions, src: string): string[] {
  const product = options.productName || 'our product';
  return [
    `The form is "${options.formName || options.formId}" (id "${options.formId}"), made in HelpWell, ${product}'s help desk. HelpWell draws it, checks every submission for bots, and stores the submissions.`,
    `HelpWell's script is ${src}. It is loaded once per page, in the layout. If the site already has it (the HelpWell chat widget uses the same tag), do not add it again. If the site only wants forms and no chat launcher, the tag carries data-mode="forms".`,
    'The script loads after the page has finished loading, so it never slows the page down, and it draws the form into any element with a data-helpwell-form attribute that it finds, including ones added later by a single-page app.',
    `If this site is on a different domain from the one HelpWell's API is on, the API has to allow this site's origin: in the app that mounts HelpWell, add the site's origin (for example https://www.acme.com) to corsOrigins in createHelpWellHandler({ ... }). Without it the form stays empty and the browser console reports a CORS error.`,
  ];
}

const checks = (formName: string) => [
  'Open the page in a private window and wait a moment: the form appears where the element is.',
  'Submit a test entry with a real address you own. The form shows its thank-you.',
  `In HelpWell, open Forms, then "${formName}", then Submissions: the test entry is at the top, marked trusted. (Submitted in under two seconds it is marked as a bot, so take your time.)`,
];

export function formEmbedPromptSpec(
  options: FormPromptOptions & { platform: FormEmbedPlatform },
): SetupPromptSpec {
  const src = scriptSrc(options);
  const id = options.formId;
  const name = options.formName || id;
  const embed = `<div data-helpwell-form="${id}"></div>`;
  const tag = `<script src="${src}" defer></script>`;
  const formsOnly = `<script src="${src}" data-mode="forms" defer></script>`;

  const byPlatform: Record<
    FormEmbedPlatform,
    { steps: string[]; blocks: SetupPromptSpec['blocks'] }
  > = {
    html: {
      steps: [
        'Find the page (or the shared template) where the form should appear, and put the embed element exactly where it should show.',
        'If the HelpWell script tag is not in the layout yet, paste it just before </body>, once, in the shared layout or footer.',
      ],
      blocks: [
        { caption: 'The embed, where the form goes:', language: 'html', content: embed },
        {
          caption: 'The script, once per page, only if it is not there yet:',
          language: 'html',
          content: tag,
        },
        {
          caption: 'Or, for a site that wants forms but no chat launcher:',
          language: 'html',
          content: formsOnly,
        },
      ],
    },
    nextjs: {
      steps: [
        'Put the embed element in the component where the form should appear. React renders it as a plain div; HelpWell fills it in.',
        'If the HelpWell script is not loaded yet, add it once in the root layout (app/layout.tsx) with next/script and strategy="afterInteractive".',
        'Do not render anything inside the div yourself; React would fight HelpWell over its contents.',
      ],
      blocks: [
        {
          caption: 'The embed, in the component:',
          language: 'tsx',
          content: `export function NewsletterSignup() {\n  return <div data-helpwell-form="${id}" />;\n}`,
        },
        {
          caption: 'The script, once, in app/layout.tsx, only if it is not there yet:',
          language: 'tsx',
          content: `import Script from 'next/script';\n\n// inside <body>, after {children}:\n<Script src="${src}" strategy="afterInteractive" />\n// or, for forms without the chat launcher:\n<Script src="${src}" data-mode="forms" strategy="afterInteractive" />`,
        },
      ],
    },
    wordpress: {
      steps: [
        'Edit the page or post where the form should appear. Add a "Custom HTML" block where it should show, and paste the embed element into it.',
        "If the HelpWell script is not on the site yet, add it once to every page: in the theme's footer (Appearance, then Theme File Editor, then footer.php, just before </body>), or with a plugin that inserts code in the footer, such as WPCode.",
        "Clear any page cache (WP Rocket, W3 Total Cache, the host's own cache) so visitors get the new page.",
      ],
      blocks: [
        { caption: 'For the Custom HTML block:', language: 'html', content: embed },
        {
          caption: 'For the footer, once, only if it is not there yet:',
          language: 'html',
          content: formsOnly,
        },
      ],
    },
  };

  const recipe = byPlatform[options.platform];
  return {
    task: `embedding the HelpWell form "${name}" on ${options.productName ? `${options.productName}'s site` : 'my site'}`,
    goal: `The form "${name}" shows on the page, and a test submission appears in HelpWell under Forms, then Submissions.`,
    context: commonContext(options, src),
    steps: recipe.steps,
    blocks: recipe.blocks,
    rules: [
      `Keep the form id exactly "${id}".`,
      'Add the script tag at most once per page. Two copies do no harm, but they are untidy.',
      "Do not copy the form's HTML from the browser into the page: HelpWell draws it fresh each time, with a one-time token that proves the submission is real.",
    ],
    verify: checks(name),
    report:
      'Tell me which file or page you changed, what you added, and whether the test submission arrived.',
  };
}

export function formPopupButtonPromptSpec(options: FormPromptOptions): SetupPromptSpec {
  const src = scriptSrc(options);
  const id = options.formId;
  const name = options.formName || id;
  return {
    task: `a button that opens the HelpWell form "${name}" as a popup`,
    goal: `Clicking a button or link on the site opens the form "${name}" over the page (a "two-step" opt-in), and a test submission appears in HelpWell.`,
    context: [
      ...commonContext(options, src),
      'Any element with data-helpwell-form-open set to the form id opens the form when clicked. It can be a button, a link or an image; it keeps its own look.',
      'From code, window.helpwell?.forms?.show(id) does the same, and window.helpwell?.forms?.on("submit", callback) runs after each submission.',
    ],
    steps: [
      'Find the button or link that should open the form (or add one), and give it the attribute below. Keep its existing text and styling.',
      'If it is a link, keep its href pointing somewhere sensible, such as the page the form is on, for people without JavaScript.',
      'If the HelpWell script tag is not in the layout yet, add it once, just before </body>.',
    ],
    blocks: [
      {
        caption: 'The attribute, on a button or a link:',
        language: 'html',
        content: `<button type="button" data-helpwell-form-open="${id}">Get the guide</button>\n<a href="/guide" data-helpwell-form-open="${id}">Get the guide</a>`,
      },
      {
        caption: 'Or from your own code:',
        language: 'ts',
        content: `window.helpwell?.forms?.show('${id}');\n\n// after each submission, if you want to know:\nwindow.helpwell?.forms?.on('submit', (event) => {\n  console.log('Submitted', event.formId, event.submissionId);\n});`,
      },
      {
        caption: 'The script, once per page, only if it is not there yet:',
        language: 'html',
        content: `<script src="${src}" defer></script>`,
      },
    ],
    rules: [`Keep the form id exactly "${id}".`],
    verify: [
      'Open the page in a private window and click the button: the form opens over the page.',
      ...checks(name).slice(1),
    ],
    report: 'Tell me which element you changed, and whether the test submission arrived.',
  };
}
