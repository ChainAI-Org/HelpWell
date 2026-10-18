/**
 * "Copy setup prompt": the panel that sits beside any setup step.
 *
 * A lot of people will hand setup to ChatGPT, Claude or a coding agent rather
 * than follow it themselves. This shows the same instructions as a single
 * prompt they can copy, built by `formatSetupPrompt` so every step reads the
 * same way to an assistant and none of them ever contains a secret.
 */

import { formatSetupPrompt, type SetupPromptSpec } from '@helpwell/core';
import { html, type RawHtml } from '@helpwell/ui';

export function setupPromptPanel(id: string, spec: SetupPromptSpec): RawHtml {
  const target = `setup-prompt-${id}`;
  return html`<section class="db-prompt">
  <button type="button" class="db-button db-agent-instruction" data-agent-instruction data-copy="${target}">Agent Instruction</button>
  <details>
  <summary>Set this up with an AI assistant</summary>
  <p class="db-prompt__hint">Copy these instructions into ChatGPT, Claude or your coding agent. They contain no keys or passwords.</p>
  <pre class="db-code db-prompt__text" id="${target}">${formatSetupPrompt(spec)}</pre>
  </details>
</section>`;
}
