/**
 * The playbook: the agent's instructions and house rules, with a preview.
 *
 * Both are Markdown files in the repo, `helpwell/instructions.md` (the system
 * prompt) and `helpwell/playbook.md` (house rules, added under the prompt),
 * because prompt changes should be reviewed like code. The host app hands the
 * dashboard a read and a write hook for each, exactly as it does for
 * articles, and HelpWell itself never touches the disk. Without a write hook
 * the editor still previews, and Save hands the file back to copy.
 *
 * The preview shows the file the way the agent reads it: `{{agent}}`,
 * `{{product}}` and `{{tone}}` filled in from Settings.
 */

import type { SetupPromptSpec } from '@helpwell/core';
import { DEFAULT_INSTRUCTIONS, renderInstructions } from '@helpwell/core/agent';
import type { Settings } from '@helpwell/core/settings';
import { html, type RawHtml, raw, renderMarkdown } from '@helpwell/ui';
import { clientScript } from '../client/index.js';
import { button, card, notice, segment, textArea } from '../components.js';
import { byMode, managedContent } from '../content-mode.js';
import type { DashboardContext } from '../layout.js';
import { htmlPage, json, readJsonBody, redirect } from '../respond.js';
import { setupPromptPanel } from '../setup-prompt.js';
import { previewStyles } from './knowledge.js';

export type PlaybookFile = 'instructions' | 'playbook';

export interface PlaybookHooks {
  readInstructions?: () => Promise<string> | string;
  writeInstructions?: (value: string) => Promise<void> | void;
  readPlaybook?: () => Promise<string> | string;
  writePlaybook?: (value: string) => Promise<void> | void;
}

const FILES: Record<
  PlaybookFile,
  { label: string; path: string; what: string; placeholder: string }
> = {
  instructions: {
    label: 'Instructions',
    path: 'helpwell/instructions.md',
    what: "The agent's system prompt. The defaults already tell it to answer only from your docs, to cite what it used, and to say when it does not know. {{agent}}, {{product}} and {{tone}} are filled in from Settings.",
    placeholder: DEFAULT_INSTRUCTIONS,
  },
  playbook: {
    label: 'Playbook',
    path: 'helpwell/playbook.md',
    what: 'House rules added under the instructions: your tone, what to say about refunds or pricing, the cases your docs do not cover. The agent reads them as rules, not as facts to quote.',
    placeholder:
      '# Playbook\n\n- Refunds: point people to the billing page; never promise one.\n- Say "workspace", not "account".',
  },
};

export function isPlaybookFile(value: string | null): value is PlaybookFile {
  return value === 'instructions' || value === 'playbook';
}

export async function readFile(hooks: PlaybookHooks, file: PlaybookFile): Promise<string> {
  const read = file === 'instructions' ? hooks.readInstructions : hooks.readPlaybook;
  return read ? await read() : '';
}

export function canRead(hooks: PlaybookHooks, file: PlaybookFile): boolean {
  return Boolean(file === 'instructions' ? hooks.readInstructions : hooks.readPlaybook);
}

export function canWrite(hooks: PlaybookHooks, file: PlaybookFile): boolean {
  return Boolean(file === 'instructions' ? hooks.writeInstructions : hooks.writePlaybook);
}

/** Save through the host's hook. False when there is none. */
export async function writeFile(
  hooks: PlaybookHooks,
  file: PlaybookFile,
  value: string,
): Promise<boolean> {
  const write = file === 'instructions' ? hooks.writeInstructions : hooks.writePlaybook;
  if (!write) return false;
  await write(value);
  return true;
}

/** The Markdown as the agent reads it, rendered for the preview. */
export function previewHtml(file: PlaybookFile, markdown: string, settings: Settings): string {
  const text =
    file === 'instructions'
      ? renderInstructions(markdown.trim() || DEFAULT_INSTRUCTIONS, {
          agent: settings.agent,
          productName: settings.product.name,
        })
      : markdown;
  return renderMarkdown(text).html;
}

export function playbookPage(
  context: DashboardContext,
  settings: Settings,
  view: {
    file: PlaybookFile;
    content: string;
    readable: boolean;
    writable: boolean;
    saved?: boolean;
    unsaved?: boolean;
    /** No write hook: the file to copy, with where it goes. */
    download?: string | null;
  },
): RawHtml {
  const meta = FILES[view.file];
  const base = `${context.basePath}/playbook`;
  const usingDefault = view.file === 'instructions' && !view.content.trim();
  // With no repo, these are not files anyone opens: they are named, not pathed.
  const managed = managedContent(context);
  const name = managed ? html`the ${meta.label.toLowerCase()}` : html`<code>${meta.path}</code>`;

  return html`
<div class="db-toolbar">
  ${segment(
    (Object.keys(FILES) as PlaybookFile[]).map((key) => ({
      label: FILES[key].label,
      href: `${base}?file=${key}`,
      current: key === view.file,
    })),
  )}
</div>

${
  view.saved
    ? notice(
        'good',
        managed
          ? 'Saved. The agent uses it from the next answer.'
          : `Saved to ${meta.path}. The agent uses it from the next answer.`,
      )
    : null
}
${view.download !== undefined && view.download !== null ? downloadCard(context, meta.path, view.download) : null}
${
  !view.readable
    ? notice(
        'info',
        html`This install does not pass the dashboard a way to read ${name}, so the editor starts ${
          view.file === 'instructions' ? 'from the default instructions' : 'empty'
        }.${managed ? '' : ' Wire it up below and it shows the file in your repo.'}`,
      )
    : usingDefault
      ? notice(
          'info',
          html`${managed ? 'The instructions are' : html`<code>${meta.path}</code> is`} empty, so the agent uses the default instructions shown here.`,
        )
      : null
}

<form method="post" action="${base}" id="db-playbook" class="db-editor" data-preview="${base}/_preview" data-file="${view.file}" ${view.unsaved ? raw('data-helpwell-dirty') : null}>
  <input type="hidden" name="file" value="${view.file}">
  <div class="db-split db-split--editor">
    <aside>
      ${card(
        meta.label,
        meta.what,
        html`${managed ? null : html`<dl class="db-kv"><dt>File</dt><dd><code>${meta.path}</code></dd></dl>`}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          ${button(view.writable ? 'Save' : managed ? 'Get a copy' : 'Get the file', { glyph: view.writable ? 'check' : 'download', tone: 'primary', name: 'action', value: 'save' })}
          ${button('Refresh preview', { name: 'action', value: 'preview', glyph: 'eye' })}
        </div>`,
      )}
      ${card(
        'How the prompt is put together',
        null,
        html`<ol class="db-steps">
          <li>The instructions, with the name, product and tone filled in.</li>
          <li>The playbook, under "House rules".</li>
          <li>Who the person is, from identify(), and the page they are on.</li>
          <li>The help articles search found, numbered so the answer can cite them.</li>
          <li>How to format the reply. HelpWell adds this itself, so editing ${managed ? 'these' : 'these files'} can never break citations or the confidence score.</li>
        </ol>`,
      )}
      ${
        (view.writable && view.readable) || managed
          ? null
          : card(
              'Edit it from here',
              'Pass the dashboard a read and a write hook for these files.',
              setupPromptPanel('playbook-hooks', playbookHooksPrompt(context)),
            )
      }
    </aside>
    <div class="db-editor__panes">
      ${card(
        'Markdown',
        null,
        textArea('content', usingDefault ? DEFAULT_INSTRUCTIONS : view.content, {
          rows: 24,
          code: true,
          placeholder: meta.placeholder,
        }),
      )}
      ${card(
        'Preview',
        'As the agent reads it.',
        html`<div class="db-preview" id="db-preview" aria-live="polite">${raw(
          previewHtml(view.file, usingDefault ? DEFAULT_INSTRUCTIONS : view.content, settings),
        )}</div>`,
      )}
    </div>
  </div>
</form>
${previewStyles()}
${previewScript(context)}`;
}

function downloadCard(context: DashboardContext, path: string, content: string): RawHtml {
  if (managedContent(context)) {
    return card(
      'Keep a copy of this',
      null,
      html`<p style="margin:0 0 10px">Nothing was saved: this install cannot save it from here.
      Copy it so your changes are not lost.</p>
    <pre class="db-code" id="db-save-file" style="white-space:pre-wrap;max-height:320px;overflow:auto">${content}</pre>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="db-btn" data-copy="db-save-file"><span>Copy it</span></button>
    </div>`,
    );
  }
  return card(
    'Save this file in your repo',
    null,
    html`<p style="margin:0 0 10px">Nothing was saved: this install has no write hook for it.
      Put this at <code id="db-save-path">${path}</code> and redeploy.</p>
    <pre class="db-code" id="db-save-file" style="white-space:pre-wrap;max-height:320px;overflow:auto">${content}</pre>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="db-btn" data-copy="db-save-file"><span>Copy the file</span></button>
      <button type="button" class="db-btn" data-copy="db-save-path"><span>Copy the path</span></button>
    </div>`,
  );
}

/** Wire the four hooks into createDashboard. No secrets involved. */
export function playbookHooksPrompt(context: DashboardContext): SetupPromptSpec {
  return {
    task: 'editing the HelpWell agent instructions and playbook from the dashboard',
    goal: "The HelpWell dashboard's Playbook page reads helpwell/instructions.md and helpwell/playbook.md from the repo, saves edits back to them, and the agent uses a saved change on its next answer.",
    context: [
      'HelpWell never writes files itself. The app passes createDashboard readInstructions, writeInstructions, readPlaybook and writePlaybook, and the API handler reads the same files as instructions and playbook.',
      `The dashboard is mounted at ${context.basePath} and the API at ${context.apiPath}.`,
      'On a serverless host the disk is not the repo: leave the write hooks out there (the page then hands the file back to commit), or have them commit through the GitHub API.',
    ],
    steps: [
      'Find where the app calls createHelpWellHandler and createDashboard (often lib/helpwell.ts).',
      'Read both files once at boot into variables, and pass the API handler getters for them, so an edit is live on the next answer without a restart.',
      'Pass createDashboard the four hooks shown below. The write hooks update the variable and the file.',
      'Restart the app.',
    ],
    blocks: [
      {
        caption: 'lib/helpwell.ts (the relevant parts):',
        language: 'ts',
        content: `import { readFile, writeFile } from 'node:fs/promises';

const files = { instructions: 'helpwell/instructions.md', playbook: 'helpwell/playbook.md' };
let instructions = await readFile(files.instructions, 'utf8').catch(() => '');
let playbook = await readFile(files.playbook, 'utf8').catch(() => '');

export const api = createHelpWellHandler({
  db,
  basePath: '${context.apiPath}',
  get instructions() { return instructions; },
  get playbook() { return playbook; },
});

export const dashboard = createDashboard({
  db,
  basePath: '${context.basePath}',
  apiPath: '${context.apiPath}',
  isAdmin,
  readInstructions: () => instructions,
  writeInstructions: async (value) => { instructions = value; await writeFile(files.instructions, value, 'utf8'); },
  readPlaybook: () => playbook,
  writePlaybook: async (value) => { playbook = value; await writeFile(files.playbook, value, 'utf8'); },
});`,
      },
    ],
    rules: ['Do not change isAdmin or any other option already passed.'],
    verify: [
      "The dashboard's Playbook page shows the contents of helpwell/instructions.md.",
      'Saving an edit there changes the file on disk, and the page says "Saved".',
    ],
  };
}

/** Live preview, as the article editor has: posted as JSON as someone types (client/previews.ts). */
function previewScript(context: DashboardContext): RawHtml {
  return clientScript(context, 'playbook-preview');
}

/** The largest file the preview or save will take. Far beyond any prompt. */
export const MAX_PLAYBOOK = 256 * 1024;

/* ---------------------------------------------------------------- routes */

function header(context: DashboardContext) {
  return {
    title: 'Playbook',
    subtitle: byMode(
      context,
      "The agent's instructions and house rules, in your repo.",
      "The agent's instructions and house rules.",
    ),
  };
}

export async function playbookScreen(
  config: PlaybookHooks,
  context: DashboardContext,
  url: URL,
  settings: Settings,
): Promise<Response> {
  const requested = url.searchParams.get('file');
  const file: PlaybookFile = isPlaybookFile(requested) ? requested : 'instructions';
  return htmlPage(
    context,
    'playbook',
    header(context),
    playbookPage(context, settings, {
      file,
      content: await readFile(config, file),
      readable: canRead(config, file),
      writable: canWrite(config, file),
      saved: url.searchParams.get('saved') === '1',
    }),
  );
}

/** Save a file through its hook, or the live preview (`_preview`, JSON). */
export async function playbookPost(
  config: PlaybookHooks,
  context: DashboardContext,
  rest: string[],
  request: Request,
  settings: Settings,
): Promise<Response> {
  if (rest[0] === '_preview') {
    const read = await readJsonBody<{ file?: unknown; markdown?: unknown }>(request, MAX_PLAYBOOK);
    if ('response' in read) return read.response;
    const { file, markdown } = read.body;
    if (typeof markdown !== 'string') return json({ error: 'markdown is required.' }, 400);
    const which: PlaybookFile = file === 'playbook' ? 'playbook' : 'instructions';
    return json({ html: previewHtml(which, markdown, settings) });
  }

  const form = await request.formData();
  const requested = String(form.get('file') ?? '');
  const file: PlaybookFile = isPlaybookFile(requested) ? requested : 'instructions';
  // Browsers send a textarea with CRLF line endings; the repo wants LF.
  const content = String(form.get('content') ?? '')
    .replace(/\r\n/g, '\n')
    .slice(0, MAX_PLAYBOOK);
  const view = {
    file,
    content,
    unsaved: true,
    readable: canRead(config, file),
    writable: canWrite(config, file),
  };

  if (form.get('action') === 'preview') {
    return htmlPage(context, 'playbook', header(context), playbookPage(context, settings, view));
  }
  if (!(await writeFile(config, file, content))) {
    return htmlPage(
      context,
      'playbook',
      header(context),
      playbookPage(context, settings, { ...view, download: content }),
    );
  }
  return redirect(`${context.basePath}/playbook?file=${file}&saved=1`);
}
