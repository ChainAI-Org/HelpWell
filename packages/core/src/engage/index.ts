/**
 * Engage: modals, banners, hotspots, tours and surveys.
 *
 *   schema.ts      the definition format, and the first version's upgrade
 *   rules.ts       targeting, trigger, schedule and frequency shapes (shared with forms)
 *   targeting.ts   the engine that checks a visit against those rules (shared with forms)
 *   check.ts       whether a definition is complete, with field paths for the editor
 *   surveys.ts     storing answers per question, and survey results
 *   stats.ts       impressions, conversions, tour drop-off
 *   personalize.ts `{{field}}` placeholders, and the values the widget fills them with
 *
 * The runtime half (choosing what a page view shows, claiming one under the
 * global cap, recording impressions) is repos/engage.ts. Both ride on the
 * `@helpwell/core/repos` entry point.
 */

export { checkEngagement, type EngagementProblem } from './check.js';
export { isSafeLink, isSafeMediaUrl, type VideoProvider, videoProvider } from './media.js';
export {
  fieldValues,
  fillPlaceholders,
  PERSONAL_FIELDS,
  PLACEHOLDER,
  personalFields,
  placeholderKeys,
} from './personalize.js';
export {
  AUDIENCES,
  type Audience,
  conditionsSchema,
  DEVICES,
  type Device,
  type Frequency,
  frequencySchema,
  instantSchema,
  pageRules,
  type Schedule,
  scheduleSchema,
  type Targeting,
  TRIGGER_TYPES,
  type Trigger,
  type TriggerType,
  targetingSchema,
  triggerSchema,
  UTM_KEYS,
  type UtmKey,
} from './rules.js';
export {
  type BannerEngagement,
  BLOCK_TYPES,
  type Block,
  type BlockType,
  BUTTON_ACTIONS,
  type Button,
  type ButtonAction,
  blockSchema,
  CHAT_BUTTON_ACTIONS,
  type ChatBlock,
  type ChatButton,
  type ChatButtonAction,
  chatBlockSchema,
  chatButtonSchema,
  countdownOver,
  countsTowardsLimits,
  ENGAGEMENT_KINDS,
  type EngageLimits,
  type Engagement,
  type EngagementKind,
  type EngageSettings,
  engageLimits,
  engagementSchema,
  engageSettings,
  type HotspotEngagement,
  isDetractor,
  MAX_TEXT,
  MAX_TRIGGERS,
  type ModalEngagement,
  parseEngagement,
  QUESTION_KINDS,
  type QuestionKind,
  SCALES,
  type Slide,
  type SurveyBranch,
  type SurveyEngagement,
  type SurveyQuestion,
  type TourEngagement,
  type TourStep,
  triggersSchema,
  upgradeEngagement,
} from './schema.js';
export { type EngageCodePromptOptions, engageCodePromptSpec } from './setup-prompts.js';
export {
  convertsOnCompletion,
  type EngagementResults,
  engagementResults,
  statsFor,
  type TourStepStat,
  tourFunnel,
} from './stats.js';
export {
  LEGACY_QUESTION_ID,
  type NpsBreakdown,
  type QuestionResult,
  type SurveyResults,
  type SurveySession,
  type SurveySessionAnswer,
  surveyResults,
  surveySessions,
  surveySessionsCsv,
  validateSurveyAnswer,
} from './surveys.js';
export {
  AudienceCache,
  allowedByFrequency,
  inSchedule,
  matchesAudience,
  matchesPlace,
  type Seen,
  selectTargeted,
  type Targetable,
  type VisitContext,
  visitFromQuery,
} from './targeting.js';
