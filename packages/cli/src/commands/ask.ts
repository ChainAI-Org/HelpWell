/**
 * `helpwell dev` and `helpwell ask` — talk to the agent from the terminal.
 *
 * The fastest way to find out whether the docs actually answer a question is
 * to ask it, and a terminal is quicker than opening a browser. `ask` answers
 * once and exits; `dev` keeps the conversation going.
 */

import { createInterface } from 'node:readline/promises';
import type { AgentModels, ModelPort } from '@helpwell/core/agent';
import { Agent, FakeModel, OpenRouterModel } from '@helpwell/core/agent';
import { SettingsStore } from '@helpwell/core/settings';
import { loadProject, openDb } from '../project.js';
import { traced } from '../traced.js';
import { detail, heading, say, style, warn } from '../ui.js';

export interface AskOptions {
  cwd: string;
  question?: string;
  url?: string;
  /**
   * Answer without a model: each reply quotes the top search result and cites
   * it, so search, citations, confidence and gaps can be checked with no key.
   */
  offline?: boolean;
}

export async function ask(options: AskOptions): Promise<string> {
  const { agent, close } = await openAgent(options);
  try {
    const reply = await agent.reply({ message: options.question ?? '' });
    printReply(reply);
    return reply.text;
  } finally {
    await close();
  }
}

export async function dev(options: AskOptions): Promise<void> {
  const { agent, close, offline } = await openAgent(options);

  heading('Talking to your agent');
  detail(
    offline
      ? 'Offline: each answer quotes the top search result, with no model. Ctrl-C to stop.'
      : 'Ctrl-C to stop.',
  );
  say();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let conversationId: string | null = null;

  try {
    for (;;) {
      const question = (await rl.question(`${style.violet('you')} `)).trim();
      if (!question) continue;
      if (question === 'exit' || question === 'quit') break;

      const reply = await agent.reply({ message: question, conversationId });
      conversationId = reply.conversationId;
      say();
      printReply(reply);
      say();
    }
  } catch (error) {
    // Ctrl-C closes the readline, which rejects the pending question.
    if (!(error instanceof Error && error.message.includes('closed'))) throw error;
  } finally {
    rl.close();
    await close();
  }
}

interface OpenAgentResult {
  agent: Agent;
  offline: boolean;
  close: () => Promise<void>;
}

async function openAgent(options: AskOptions): Promise<OpenAgentResult> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });
  const settings = await new SettingsStore(handle.db).get();

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const offline = options.offline === true || !apiKey;

  if (offline && !options.offline) {
    warn('No OPENROUTER_API_KEY, so answers quote the top search result instead of a model.');
  }

  // Offline still exercises the real grounding path: search runs, passages are
  // numbered and cited, confidence is scored, gaps are recorded. Only the
  // wording is scripted (core's FakeModel.grounded).
  const model: ModelPort = offline
    ? FakeModel.grounded(handle.db)
    : traced(new OpenRouterModel({ apiKey, appName: settings.product.name }));
  // Offline searches by text alone: a scripted model's vectors do not live in
  // the same space as the embeddings `helpwell sync` stored with a key, so a
  // semantic pass would rank by noise. And there is no second model to retry.
  const models: AgentModels | undefined = offline
    ? { embeddings: null, fallback: null }
    : undefined;

  const agent = new Agent({
    db: handle.db,
    settings,
    model,
    models,
    instructions: project.instructions,
    playbook: project.playbook,
  });

  return { agent, offline, close: () => handle.close() };
}

function printReply(reply: {
  text: string;
  citations: { title: string; slug: string }[];
  unresolved: boolean;
  degraded: boolean;
  confidence?: number;
  confidenceReason?: string;
}): void {
  say(`${style.green('agent')} ${reply.text || style.dim('(no answer)')}`);

  if (reply.citations.length > 0) {
    say();
    for (const citation of reply.citations) {
      say(`  ${style.dim('·')} ${citation.title} ${style.dim(citation.slug)}`);
    }
  }

  // The score the conversation review shows, so a docs change can be checked
  // from the terminal: it is what decides whether the answer resolves.
  if (typeof reply.confidence === 'number') {
    say();
    detail(`Confidence ${reply.confidence.toFixed(2)}: ${reply.confidenceReason ?? ''}`.trim());
  }

  if (reply.unresolved) {
    say();
    warn('Not covered by your docs. Logged as a gap.');
  }
  if (reply.degraded) {
    say();
    warn('The model was unavailable, so that came from search.');
  }
}
