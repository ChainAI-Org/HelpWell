/**
 * Types the agent needs from settings, re-exported so agent modules do not
 * import the whole settings schema (and so a caller can hand-build them in a
 * test without constructing a full settings document).
 */

export type {
  AgentSettings,
  PreChatSettings,
  SpendCaps,
} from '../settings/schema.js';

import type { z } from 'zod';
import type { abuseSettings, agentTools } from '../settings/schema.js';

export type AbuseSettings = z.infer<typeof abuseSettings>;
export type AgentTools = z.infer<typeof agentTools>;
