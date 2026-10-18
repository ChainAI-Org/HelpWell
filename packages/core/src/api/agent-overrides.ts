/**
 * Agent overrides: how a support extension steers the AI beyond its playbook.
 *
 * A hosted service could once only steer the agent by writing instructions
 * into the playbook. `SupportExtension.agentOverrides` adds three levers,
 * and this module is where HelpWell decides how far they reach:
 *
 *   - tools can be switched off, never on. The install's own Settings are the
 *     ceiling: a tool its owner switched off stays off whatever a service
 *     says, so connecting one can only ever make the agent do less;
 *   - instructions are added after the install's own instructions, so the
 *     owner's words come first and a service adds to them rather than
 *     replacing them;
 *   - a name replaces the one in Settings wherever the agent is named: the
 *     widget's config, the help centre and the agent's own instructions.
 *
 * Anything else in what the service sends is ignored, and anything malformed
 * is dropped rather than half-applied. The fail-open wrapper (fail-open.ts)
 * caches the answer for a minute and turns any failure into "no overrides".
 */

import type { ToolName } from '../agent/tools.js';
import type { AgentTools } from '../agent/types.js';
import type { Settings } from '../settings/schema.js';
import type { AgentOverrides } from './support-extension.js';

/** How long one answer is reused. */
export const AGENT_OVERRIDES_TTL_MS = 60_000;
/** The longest instructions a service may add. */
const MAX_INSTRUCTIONS = 8_000;
/** The longest agent name a service may set; the widget shows at most this. */
const MAX_NAME = 60;

/** Each tool the model sees, and the Settings switch it answers to. */
const SETTING_BY_TOOL: Record<ToolName, keyof AgentTools> = {
  search_docs: 'searchDocs',
  read_changelog: 'readChangelog',
  look_up_user: 'lookUpUser',
  collect_email: 'collectEmail',
  mark_unresolved: 'markUnresolved',
  suggest_article: 'suggestArticle',
};

/** The tool names a service can use. */
export const AGENT_TOOL_NAMES = Object.keys(SETTING_BY_TOOL) as ToolName[];

/**
 * What a service sent, as overrides HelpWell will apply: known tools with a
 * boolean, and instructions as trimmed text. Null when nothing usable is left.
 */
export function cleanAgentOverrides(raw: unknown): AgentOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as { tools?: unknown; instructions?: unknown; name?: unknown };
  const out: AgentOverrides = {};

  if (input.tools && typeof input.tools === 'object' && !Array.isArray(input.tools)) {
    const tools: Partial<Record<ToolName, boolean>> = {};
    for (const [name, value] of Object.entries(input.tools as Record<string, unknown>)) {
      if (Object.hasOwn(SETTING_BY_TOOL, name) && typeof value === 'boolean') {
        tools[name as ToolName] = value;
      }
    }
    if (Object.keys(tools).length > 0) out.tools = tools;
  }

  if (typeof input.instructions === 'string') {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    const text = input.instructions.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (text) out.instructions = text.slice(0, MAX_INSTRUCTIONS);
  }

  if (typeof input.name === 'string') {
    // One plain line: a name never carries markup or line breaks into a prompt.
    const name = input.name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
      .replace(/[\u0000-\u001f\u007f<>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME)
      .trim();
    if (name) out.name = name;
  }

  return out.tools || out.instructions || out.name ? out : null;
}

/** Settings with the agent renamed, when the overrides name it. */
export function applyNameOverride(settings: Settings, overrides: AgentOverrides | null): Settings {
  const name = overrides?.name?.trim();
  if (!name || name === settings.agent.name) return settings;
  return { ...settings, agent: { ...settings.agent, name } };
}

/**
 * Settings with the overrides' tools switched off. A tool is on only when
 * Settings has it on and the overrides do not say `false`.
 */
export function applyToolOverrides(settings: Settings, overrides: AgentOverrides | null): Settings {
  const tools = overrides?.tools;
  if (!tools) return settings;
  const next: AgentTools = { ...settings.agent.tools };
  let changed = false;
  for (const name of AGENT_TOOL_NAMES) {
    const key = SETTING_BY_TOOL[name];
    if (tools[name] === false && next[key]) {
      next[key] = false;
      changed = true;
    }
  }
  if (!changed) return settings;
  return { ...settings, agent: { ...settings.agent, tools: next } };
}

/** The install's instructions, then the service's. */
export function withOverrideInstructions(
  instructions: string | undefined,
  overrides: AgentOverrides | null,
): string | undefined {
  const added = overrides?.instructions?.trim();
  if (!added) return instructions;
  return [instructions?.trim(), added].filter(Boolean).join('\n\n');
}
