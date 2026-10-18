/**
 * The model the dashboard drafts articles and runs evals with, and what it
 * can tell about the install's secrets.
 *
 * The dashboard runs in the host app's server, next to the API, so it uses
 * the same key the API does: the one passed in code, or OPENROUTER_API_KEY.
 * A host that passes `modelFactory` supplies the ports itself, per purpose,
 * exactly as it does to the API. The dashboard never shows a key or any
 * other secret; it only knows whether each is set.
 */

import {
  type AgentModels,
  type ModelFactory,
  type ModelPort,
  type ModelPurpose,
  OpenRouterModel,
} from '@helpwell/core/agent';
import type { Settings } from '@helpwell/core/settings';
import type { SecretStatus } from './pages/settings.js';
import { TURNSTILE_SECRET_ENV } from './pages/settings.js';

export interface ModelConfig {
  model?: ModelPort;
  openRouterKey?: string;
  /** The host's own model per purpose; see `ModelFactory` in `@helpwell/core/agent`. */
  modelFactory?: ModelFactory;
  /**
   * Where the key and secrets are looked for when not passed in code.
   * Defaults to `process.env`; a host running many installs passes each its own.
   */
  env?: Record<string, string | undefined>;
  /** Tell the dashboard a secret is set when it is passed to the API in code rather than the environment. */
  secrets?: { identity?: boolean; turnstile?: boolean };
}

function envSet(config: ModelConfig, name: string): boolean {
  return Boolean((config.env ?? process.env)[name]?.trim());
}

export function hasModelKey(config: ModelConfig): boolean {
  if (config.modelFactory) return Boolean(config.modelFactory('chat'));
  return Boolean(
    config.model || config.openRouterKey?.trim() || envSet(config, 'OPENROUTER_API_KEY'),
  );
}

/**
 * The model to call for a job, or null when there is none: the host's
 * factory when it passed one, otherwise the install's key. `docs` (writing)
 * unless the caller says otherwise.
 */
export function dashboardModel(
  config: ModelConfig,
  settings: Settings,
  purpose: ModelPurpose = 'docs',
): ModelPort | null {
  if (config.modelFactory) return config.modelFactory(purpose) ?? null;
  if (config.model) return config.model;
  const apiKey =
    config.openRouterKey?.trim() || (config.env ?? process.env).OPENROUTER_API_KEY?.trim() || '';
  if (!apiKey) return null;
  return new OpenRouterModel({
    apiKey,
    appName: settings.product.name,
    appUrl: settings.product.appUrl || undefined,
  });
}

/**
 * What an eval run needs beyond its chat model: the grader, and the agent's
 * fallback and embeddings ports. Without a factory, nothing, and the run
 * uses the chat model for all of them as it always has.
 */
export function evalModels(
  config: ModelConfig,
  settings: Settings,
): { grader?: ModelPort; models?: AgentModels } {
  if (!config.modelFactory) return {};
  return {
    grader: dashboardModel(config, settings, 'grader') ?? undefined,
    models: {
      fallback: dashboardModel(config, settings, 'fallback'),
      embeddings: dashboardModel(config, settings, 'embeddings'),
    },
  };
}

export function secretStatus(config: ModelConfig): SecretStatus {
  return {
    openRouter: hasModelKey(config),
    identity: Boolean(config.secrets?.identity) || envSet(config, 'HELPWELL_IDENTITY_SECRET'),
    turnstile: Boolean(config.secrets?.turnstile) || envSet(config, TURNSTILE_SECRET_ENV),
    adminToken: envSet(config, 'HELPWELL_ADMIN_TOKEN'),
    databaseUrl: envSet(config, 'HELPWELL_DATABASE_URL'),
  };
}
