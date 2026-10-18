/**
 * Setup instructions a person can hand to an AI assistant.
 *
 * Every setup step in HelpWell (installing the widget, adding DNS records,
 * connecting a key) can be copied as one self-contained prompt and pasted into
 * ChatGPT, Claude or a coding agent, which then does the work or walks the
 * person through it. They all share this one shape so an assistant always gets
 * the goal, the exact values, the limits and a way to check its work, and so a
 * prompt never carries a secret: an assistant is told where a person pastes a
 * key, never handed one.
 */

export interface SetupPromptTable {
  /** What the rows are, e.g. "DNS records to add at Cloudflare". */
  title: string;
  /** One object per row. Every row should have the same keys; they become the columns. */
  rows: Record<string, string | number | null>[];
}

export interface SetupPromptBlock {
  caption: string;
  /** Fence language, e.g. `bash`, `ts`, `html`. */
  language: string;
  content: string;
}

export interface SetupPromptSpec {
  /** The job, as a noun phrase: "email sending for Acme". */
  task: string;
  /**
   * What the assistant helps with, before the task: "set up" when absent ("set up email sending
   * for Acme"), or for instructions about using a screen rather than setting one up, "work on"
   * ("work on the support inbox").
   */
  verb?: string;
  /** What "done" looks like, in a sentence or two. */
  goal: string;
  /** Facts the assistant should rely on: product, domain, detected DNS provider, stack. */
  context?: string[];
  /** In order. Each step is one action. */
  steps: string[];
  /** Exact values to enter. Rendered as a table and repeated as JSON for assistants with API access. */
  tables?: SetupPromptTable[];
  /** Code or commands to use exactly as written. */
  blocks?: SetupPromptBlock[];
  /** Limits specific to this task. The standard ones are always added. */
  rules?: string[];
  /** How to confirm it worked, in order. */
  verify?: string[];
  /** What to report back when finished. */
  report?: string;
}

/** Added to every prompt: the limits that keep an assistant from doing damage. */
export const STANDARD_SETUP_RULES = [
  'Never ask me to paste a password, API key, token or other secret into this chat. Never print, log, screenshot, commit or save secrets in files. With my authorization and secure tool access, transfer a key directly from its provider into the intended masked setting or secret manager; otherwise tell me exactly where to paste it myself.',
  'Only add or change what these instructions list. Do not delete or edit anything else. If something already there conflicts with these instructions, stop and ask me.',
  'Use the values exactly as given. Do not shorten, reformat or "correct" them.',
  'If a step fails, tell me the exact error message instead of guessing a workaround.',
] as const;

const cell = (value: string | number | null): string =>
  value === null || value === '' ? '—' : String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function table(input: SetupPromptTable): string {
  const columns = [...new Set(input.rows.flatMap((row) => Object.keys(row)))];
  if (columns.length === 0) return '';
  const lines = [
    `| ${columns.map(cell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...input.rows.map((row) => `| ${columns.map((c) => cell(row[c] ?? null)).join(' | ')} |`),
  ];
  return [
    `### ${input.title}`,
    '',
    ...lines,
    '',
    'The same values as JSON:',
    '',
    fence('json', JSON.stringify(input.rows, null, 2)),
  ].join('\n');
}

/** A fence longer than any backtick run inside, so content can never close it early. */
function fence(language: string, content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}${language}\n${content.replace(/\s+$/, '')}\n${marks}`;
}

const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join('\n');

/** The prompt as Markdown, ready to paste into any assistant. */
export function formatSetupPrompt(spec: SetupPromptSpec): string {
  const sections = [
    `You are helping me ${spec.verb?.trim() || 'set up'} ${spec.task}. Work through the steps in order. Do what you can yourself if you have access to the tools involved; otherwise tell me exactly what to click or type. Pause and tell me whenever a step needs something only I can do, like signing in or pasting a secret.`,
    `## Goal\n\n${spec.goal}`,
  ];
  if (spec.context?.length) sections.push(`## What you need to know\n\n${bullets(spec.context)}`);
  sections.push(`## Steps\n\n${numbered(spec.steps)}`);
  if (spec.tables?.length)
    sections.push(`## Exact values\n\n${spec.tables.map(table).filter(Boolean).join('\n\n')}`);
  if (spec.blocks?.length)
    sections.push(
      `## Use exactly as written\n\n${spec.blocks.map((block) => `${block.caption}\n\n${fence(block.language, block.content)}`).join('\n\n')}`,
    );
  sections.push(`## Rules\n\n${bullets([...STANDARD_SETUP_RULES, ...(spec.rules ?? [])])}`);
  if (spec.verify?.length) sections.push(`## Check your work\n\n${numbered(spec.verify)}`);
  sections.push(
    `## When you are done\n\n${spec.report ?? 'Tell me what you changed, what you could not do, and anything I still need to do myself.'}`,
  );
  return `${sections.join('\n\n')}\n`;
}
