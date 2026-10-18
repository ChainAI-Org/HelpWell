/**
 * Which model does which job.
 *
 * A self-hosted install answers with one model port, built from its own
 * OpenRouter key, and picks the model names from Settings. A host running
 * many installs in one process needs more say than that: a port per install,
 * or per job, metered against each customer's own key. So everything that
 * calls a model asks for one by purpose, and a host that passes
 * `modelFactory` answers. Without one, nothing changes.
 *
 * The purpose says which job, not which model name: the name still comes
 * from Settings (`agent.models.chat`, `.docs`, `.fallback`, `.embeddings`).
 */

import type { ModelPort } from './model.js';

export type ModelPurpose = 'chat' | 'docs' | 'embeddings' | 'fallback' | 'grader';

export const MODEL_PURPOSES: readonly ModelPurpose[] = [
  'chat',
  'docs',
  'embeddings',
  'fallback',
  'grader',
];

/**
 * The port for one purpose, or null when this install has no model for it:
 * the agent then answers from search alone (`chat`), skips its retry
 * (`fallback`), searches by text only (`embeddings`), cannot draft (`docs`),
 * or grades with the chat model (`grader`).
 *
 * Called once per purpose per request at most, so it may build a fresh port
 * each time; it should not do anything slow.
 */
export type ModelFactory = (purpose: ModelPurpose) => ModelPort | null | undefined;

/** Ports for the agent's second and third jobs, when they differ from its chat model. */
export interface AgentModels {
  /** The retry after the chat model fails. Null: no retry. Left out: the chat port. */
  fallback?: ModelPort | null;
  /** Query embeddings for semantic search. Null: text search only. Left out: the chat port. */
  embeddings?: ModelPort | null;
}
