/**
 * "Write with AI" in the engage editor's composer: the text of one block,
 * rewritten or written from scratch by the install's own model.
 *
 * It uses the same key and the same writing model (`agent.models.docs`) as
 * drafting an article from a gap (or the host's `modelFactory('docs')`), records what it cost in the spend ledger,
 * and stops at the daily cap like everything else that calls the model.
 * Without a key it says where to add one; it never asks for the key itself.
 * What comes back is Markdown for the composer to show: nothing is saved
 * until the person presses Save.
 */

import { recordSpend, spendStatus } from '@helpwell/core/agent';
import type { Settings } from '@helpwell/core/settings';
import { dashboardModel } from '../model.js';
import type { DashboardConfig } from '../server.js';

type Config = Pick<DashboardConfig, 'db' | 'model' | 'openRouterKey' | 'modelFactory' | 'env'>;

export type WriteResult =
  | { ok: true; markdown: string }
  | { ok: false; status: number; error: string };

const MAX_INPUT = 4_000;

export async function writeWithModel(
  config: Config,
  settings: Settings,
  input: { markdown: string; instruction: string; context: string },
): Promise<WriteResult> {
  const instruction = input.instruction.trim().slice(0, 600);
  if (!instruction)
    return { ok: false, status: 400, error: 'Say what to write, or pick one of the suggestions.' };

  // The host's own writing model when it passes a factory, else the install's key.
  const model = dashboardModel(config, settings, 'docs');
  if (!model) {
    return {
      ok: false,
      status: 501,
      error:
        'Writing needs a model key, and none is set. Add OPENROUTER_API_KEY on the Get set up page, then try again.',
    };
  }
  const budget = await spendStatus(config.db, settings.agent.spend);
  if (!budget.allowed) {
    return {
      ok: false,
      status: 429,
      error:
        'Today’s AI spending cap is reached. It resets at midnight UTC, or raise it in Settings.',
    };
  }

  const product = settings.product.name || 'the product';
  const writingModel = settings.agent.models.docs;
  try {
    const response = await model.chat({
      model: writingModel,
      maxTokens: 700,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            `You write the short messages ${product} shows people inside the app: pop-ups, banners, tooltips on a tour, survey intros.`,
            input.context.trim().slice(0, 300),
            'Follow the instruction. Keep it brief: a title line and a sentence or two at most, one line for a banner.',
            'Write plain Markdown only: a heading line (###), **bold**, _italic_, [links](url) and short lists. No images, no HTML, no code blocks.',
            'Keep any {{field}} tags and links that are already there. Do not invent facts, prices or dates that are not in the text.',
            'Reply with the Markdown alone: no preamble, no quotes around it.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        {
          role: 'user',
          content: `Instruction: ${instruction}\n\nThe text now (may be empty):\n${input.markdown.slice(0, MAX_INPUT)}`,
        },
      ],
    });
    await recordSpend(config.db, {
      kind: 'docs',
      model: response.model || writingModel,
      usage: response.usage,
    });
    const markdown = clean(response.text);
    if (!markdown)
      return { ok: false, status: 502, error: 'The model sent nothing back. Try again.' };
    return { ok: true, markdown };
  } catch {
    return { ok: false, status: 502, error: 'The model did not answer. Try again in a moment.' };
  }
}

/** A reply with a code fence or quotes around it, as models sometimes send, without them. */
function clean(text: string): string {
  let out = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(out);
  if (fence) out = fence[1]!.trim();
  if (/^".*"$/s.test(out)) out = out.slice(1, -1).trim();
  return out.slice(0, 10_000);
}
