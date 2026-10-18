/**
 * The setup step the engage editor can need: the API serving the widget's
 * files, which the live preview loads its renderer from. Shown only when the
 * preview could not load, as a prompt for an AI assistant beside the notice.
 */

import type { SetupPromptSpec } from '@helpwell/core';

export function engagePreviewPromptSpec(options: { apiPath: string }): SetupPromptSpec {
  const api = options.apiPath.replace(/\/+$/, '') || '/api/helpwell';
  return {
    task: 'serving the HelpWell widget files from our API',
    goal: `The HelpWell API answers ${api}/assets/widget.js and ${api}/assets/engage-preview.js, so the widget loads on our pages and the dashboard's engage editor can draw its live preview.`,
    context: [
      'HelpWell is mounted in this app with createHelpWellHandler from @helpwell/core.',
      'The widget package, @helpwell/widget, ships its built files, and widgetAssets() from @helpwell/widget/server reads them so the handler can serve them.',
      `The files are served under ${api}/assets/. engage-preview.js is only ever loaded by the dashboard, never on a customer-facing page.`,
    ],
    steps: [
      'Find where createHelpWellHandler is called.',
      'Import widgetAssets from @helpwell/widget/server and pass assets: widgetAssets() in the handler options, as below. Keep every option already there.',
      'If @helpwell/widget is not a dependency yet, add it with the package manager this project uses.',
      'If you are working inside the HelpWell repository itself, run `pnpm build` so the widget files exist.',
      'Restart the app.',
    ],
    blocks: [
      {
        caption: 'The option to add:',
        language: 'ts',
        content: `import { widgetAssets } from '@helpwell/widget/server';\n\nconst handler = createHelpWellHandler({\n  // …the options already here…\n  assets: widgetAssets(),\n});`,
      },
    ],
    verify: [
      `Run \`curl -I <your app's origin>${api}/assets/engage-preview.js\` and check for a 200 with a JavaScript content type.`,
      'Open the dashboard, go to Engage, open any engagement: the preview beside the form draws it.',
    ],
  };
}
