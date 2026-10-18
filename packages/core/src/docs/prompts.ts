/**
 * The instructions a docs-writing model gets: drafting new articles from a
 * repository's material, and checking one article against a code change.
 * The article-writing prompt says "help-centre" on purpose: test fakes match
 * on it.
 */

import { BLOCK_VOCABULARY, type ShotReference, screenshotGuidance } from './blocks.js';

export interface GeneratePromptInput {
  product: string;
  count: number;
  about?: string;
  existing: string[];
  shots: ShotReference[];
}

export function generatePrompt(input: GeneratePromptInput): string {
  const lines = [
    `You write help-centre articles for ${input.product}.`,
    '',
    "Below is material from the product's own repository: its README, package manifest, route and handler source, plan and limit definitions, UI copy, changelog, CLI help, and the help articles that already exist. Source comments are as trustworthy as the code.",
    '',
    `Write ${input.count} new articles a customer would search for.`,
    '',
    'Rules:',
    '- Everything must come from the material. Do not invent features, prices, limits or steps. If the material does not say, leave it out.',
    '- Include the concrete facts you find — limits, prices, schedules, defaults, file formats, error messages — and say which plan, role or permission a feature needs. Those facts are what people search for.',
    '- The title is what someone would type into a search box, not a feature name.',
    '- Open with the answer. No preamble.',
    '- Second person, short sentences. The body is Markdown with no H1; use H2 for steps or sections when it helps.',
    '- Put each article in the collection a help center would have: Getting started, Billing, Account, and so on.',
    `- These already exist, so do not repeat them: ${input.existing.join('; ') || 'none yet'}`,
  ];
  if (input.about) lines.push(`- Only write about: ${input.about}`);
  lines.push('', ...BLOCK_VOCABULARY, '', ...screenshotGuidance(input.shots));
  lines.push(
    '',
    'Return JSON only, with nothing around it, shaped:',
    '{"articles":[{"collection":"Billing","title":"...","description":"one line","body":"Markdown, no H1"}]}',
  );
  return lines.join('\n');
}

/** The system prompt that asks whether one article is still right after a change. */
export function articleCheckPrompt(shots: ShotReference[]): string {
  return `You are checking whether one help article is still accurate after a code change.

Reply with JSON only:
{"stale": true|false, "reason": "one sentence", "body": "the corrected Markdown, or null"}

Say stale only when the diff genuinely contradicts the article or adds
something it should mention. A diff that touches unrelated code is not a
reason to rewrite anything. Keep the author's voice and structure; change the
smallest amount that makes it right. Keep every image, video and block the
article already has unless the change makes it wrong.

${[...BLOCK_VOCABULARY, '', ...screenshotGuidance(shots)].join('\n')}`;
}

/** The user message for `articleCheckPrompt`: the article and the diff it is judged against. */
export function articleCheckMessage(
  article: { title: string; body: string },
  diff: string,
): string {
  return `<article title="${article.title}">\n${article.body}\n</article>\n\n<diff>\n${diff}\n</diff>`;
}
