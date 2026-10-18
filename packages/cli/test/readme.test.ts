/**
 * The README's webhook table and the setup prompts in the README and docs are
 * generated from the code (src/readme.ts). This is what keeps them from
 * drifting: it fails while any of them differs from what the code would
 * write now. `pnpm build && pnpm readme` brings them up to date.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEBHOOK_EVENT_DESCRIPTIONS, WEBHOOK_EVENTS } from '@helpwell/core';
import { describe, expect, it } from 'vitest';
import {
  fencedPrompt,
  GENERATED_BLOCKS,
  generatedFiles,
  updateGenerated,
  webhookEventsTable,
} from '../src/readme.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('the generated parts of the README and docs', () => {
  for (const file of generatedFiles()) {
    it(`${file} is up to date with the code`, () => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const fresh = updateGenerated(text, file);
      expect(
        fresh === text,
        `${file} is out of date with the code. Run \`pnpm build && pnpm readme\`.`,
      ).toBe(true);
    });
  }

  it('lists every webhook event the code sends, with what it means', () => {
    const table = webhookEventsTable();
    for (const event of WEBHOOK_EVENTS) {
      expect(table).toContain(`| \`${event}\` | ${WEBHOOK_EVENT_DESCRIPTIONS[event]} |`);
    }
    expect(table).toContain('`form.submitted`');
    expect(table).toContain('`giveaway.entered`');
  });

  it('includes the master install prompt in the README', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('<!-- generated:prompt:install');
    expect(readme).toContain(
      "You are helping me set up HelpWell, the self-hosted help desk, in my product's existing app.",
    );
  });
});

describe('updateGenerated', () => {
  const block = GENERATED_BLOCKS.find((b) => b.name === 'webhook-events');
  const wrap = (inner: string) =>
    [
      '# Webhooks',
      '<!-- generated:webhook-events (do not edit) -->',
      inner,
      '<!-- /generated:webhook-events -->',
      'After.',
    ].join('\n');

  it('rewrites what is between the markers and nothing else, the same every time', () => {
    const only = block ? [block] : [];
    expect(only).toHaveLength(1);
    const once = updateGenerated(wrap('| stale | table |'), 'README.md', only);
    expect(updateGenerated(once, 'README.md', only)).toBe(once);
    expect(once.startsWith('# Webhooks\n<!-- generated:webhook-events (do not edit) -->\n')).toBe(
      true,
    );
    expect(once).toContain(webhookEventsTable());
    expect(once).not.toContain('stale');
    expect(once.endsWith('\n<!-- /generated:webhook-events -->\nAfter.')).toBe(true);
  });

  it('refuses a file whose markers are missing, rather than skipping the block', () => {
    expect(() => updateGenerated('# Nothing here\n', 'README.md')).toThrow(/no generated block/);
  });

  it('fences a prompt with more backticks than it contains', () => {
    const fenced = fencedPrompt({
      task: 'x',
      goal: 'y',
      steps: ['z'],
      blocks: [{ caption: 'c', language: 'md', content: '````\ninner\n````' }],
    });
    expect(fenced.startsWith('``````md\n')).toBe(true);
    expect(fenced.endsWith('\n``````')).toBe(true);
  });
});
