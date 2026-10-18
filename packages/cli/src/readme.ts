/**
 * The parts of the README and the docs that are generated from the code.
 *
 * The webhook table and the setup prompts in the docs drifted from the code
 * twice: an event the code sent was missing from the table, and prompts were
 * pasted in once and never updated. So they are no longer written by hand.
 * Each sits between two HTML comments, and `scripts/readme.mjs` rewrites
 * what is between them from the same functions the CLI and the dashboard
 * use. A test fails when a file is out of date, which is what keeps them from
 * drifting again.
 *
 *   <!-- generated:webhook-events ... -->
 *   ...generated...
 *   <!-- /generated:webhook-events -->
 */

import {
  formatSetupPrompt,
  formEmbedPromptSpec,
  remoteSupportPromptSpec,
  type SetupPromptSpec,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENTS,
} from '@helpwell/core';
import { engageCodePromptSpec } from '@helpwell/core/repos';
import { defaultPromptFacts, findTopic } from './commands/prompt.js';
import { mountSnippet } from './templates.js';

export interface GeneratedBlock {
  /** The file it lives in, relative to the repo root, with forward slashes. */
  file: string;
  /** The name in its markers. */
  name: string;
  content(): string;
}

/** A prompt in a fence longer than any run of backticks inside it. */
export function fencedPrompt(spec: SetupPromptSpec): string {
  const text = formatSetupPrompt(spec).replace(/\s+$/, '');
  const longest = Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}md\n${text}\n${fence}`;
}

/** Code in a fence longer than any run of backticks inside it. */
function fencedCode(language: string, content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${content.replace(/\s+$/, '')}\n${fence}`;
}

/** A `helpwell prompt` topic, filled in with the defaults, so it reads the same for everyone. */
function topicPrompt(name: string): string {
  const topic = findTopic(name);
  if (!topic) throw new Error(`No prompt topic "${name}"`);
  return fencedPrompt(topic.spec(defaultPromptFacts(), {}));
}

/** Every event the code sends, and what it means, as a Markdown table. */
export function webhookEventsTable(): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|');
  return [
    '| Event | When |',
    '|---|---|',
    ...WEBHOOK_EVENTS.map(
      (event) => `| \`${event}\` | ${cell(WEBHOOK_EVENT_DESCRIPTIONS[event])} |`,
    ),
  ].join('\n');
}

export const GENERATED_BLOCKS: readonly GeneratedBlock[] = [
  { file: 'README.md', name: 'prompt:install', content: () => topicPrompt('install') },
  // The quick start's mount code is what `init --framework next` prints.
  { file: 'README.md', name: 'mount:next', content: () => fencedCode('ts', mountSnippet('next')) },
  { file: 'README.md', name: 'prompt:widget', content: () => topicPrompt('widget') },
  { file: 'README.md', name: 'prompt:write-article', content: () => topicPrompt('write-article') },
  {
    file: 'README.md',
    name: 'prompt:changelog-token',
    content: () => topicPrompt('changelog-token'),
  },
  { file: 'README.md', name: 'prompt:capture', content: () => topicPrompt('capture') },
  { file: 'README.md', name: 'prompt:capture-login', content: () => topicPrompt('capture-login') },
  { file: 'README.md', name: 'prompt:import', content: () => topicPrompt('import') },
  { file: 'README.md', name: 'prompt:identity', content: () => topicPrompt('identity') },
  { file: 'README.md', name: 'webhook-events', content: webhookEventsTable },
  { file: 'README.md', name: 'prompt:webhooks', content: () => topicPrompt('webhooks') },
  { file: 'README.md', name: 'prompt:link', content: () => topicPrompt('link') },
  { file: 'docs/PRD.md', name: 'webhook-events', content: webhookEventsTable },
  {
    file: 'docs/engage.md',
    name: 'prompt:engage-code',
    content: () =>
      fencedPrompt(
        engageCodePromptSpec({
          engagementId: 'first-project',
          trigger: 'event',
          event: 'project_created',
        }),
      ),
  },
  {
    file: 'docs/forms.md',
    name: 'prompt:forms-embed',
    content: () =>
      fencedPrompt(
        formEmbedPromptSpec({ formId: 'newsletter', formName: 'Newsletter', platform: 'html' }),
      ),
  },
  {
    file: 'docs/support-extension.md',
    name: 'prompt:link',
    content: () =>
      fencedPrompt(
        remoteSupportPromptSpec({ url: 'https://support.example.com/api', product: 'prod_42' }),
      ),
  },
];

/** The files that have generated blocks. */
export function generatedFiles(): string[] {
  return [...new Set(GENERATED_BLOCKS.map((block) => block.file))];
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with every generated block of `file` rewritten. Throws when a block's
 * markers are missing, so a heading renamed by hand cannot silently stop a
 * block being generated.
 */
export function updateGenerated(
  text: string,
  file: string,
  blocks: readonly GeneratedBlock[] = GENERATED_BLOCKS,
): string {
  let out = text;
  for (const block of blocks.filter((b) => b.file === file)) {
    const pattern = new RegExp(
      // What is between the markers may be empty: a new block starts that way.
      `(<!-- generated:${literal(block.name)}(?: [^\\n]*?)? -->)\\n(?:[\\s\\S]*?\\n)?(<!-- /generated:${literal(block.name)} -->)`,
    );
    if (!pattern.test(out)) {
      throw new Error(
        `${file} has no generated block "${block.name}". It needs <!-- generated:${block.name} --> and <!-- /generated:${block.name} --> on lines of their own.`,
      );
    }
    // A function, so `$` in the content is never read as a replacement pattern.
    out = out.replace(pattern, (_match, open: string, close: string) =>
      [open, block.content(), close].join('\n'),
    );
  }
  return out;
}
