/** Settings entry point: `import { defaultSettings } from '@helpwell/core/settings'`. */

export {
  type AgentSettings,
  type ChangelogSettings,
  DEFAULT_HOME_BLOCKS,
  type DisplayRules,
  defaultSettings,
  type Engagement,
  type EngageSettings,
  type HelpCenterSettings,
  type HomeBlock,
  mergeSettings,
  type PreChatSettings,
  parseSettings,
  type Settings,
  type SpendCaps,
  type StatusLevel,
  settingsSchema,
  type WidgetSettings,
  type WidgetStatusSettings,
} from './settings/schema.js';
export { SettingsStore } from './settings/store.js';
export { publicSupportEmail, supportAddress } from './settings/support-email.js';
