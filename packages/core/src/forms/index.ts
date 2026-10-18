/**
 * Forms: email capture, giveaways and their analytics.
 *
 *   schema.ts         the definition format: fields, look, placements, success, variants, giveaway
 *   check.ts          whether a definition is complete, with field paths for the editor
 *   templates.ts      a starting point per kind of form
 *   display.ts        which forms a page view shows, on the engage targeting engine and cap
 *   tokens.ts         the signed render token, download links and giveaway entry keys
 *   answers.ts        what a visitor typed, checked and typed
 *   abuse.ts          the verdict: honeypot, fill time, rate limits, domains, MX, repeats
 *   submit.ts         one submission, start to finish
 *   hook.ts           the extension hook's payload, sent through the durable queue
 *   giveaway.ts       entries, referrals, bonus actions, fair draws
 *   variants.ts       A/B assignment and which variant is winning
 *   analytics.ts      views, conversion, pages, referrers, rejections
 *   submissions.ts    the submissions list and the CSV exports
 *   setup-prompts.ts  embed and popup-button prompts for an AI assistant
 *   files.ts          uploaded lead magnets and media, through the content source or the docs folder
 *
 * Storage (create, save a version, export, import) is repos/forms.ts. All of
 * it rides on the `@helpwell/core/repos` entry point.
 */

export {
  type FormVerdict,
  HARD_LIMIT_FACTOR,
  type Judged,
  type JudgeInput,
  judgeSubmission,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
  type RejectReason,
  rejectionMessage,
  SILENT_REASONS,
} from './abuse.js';
export {
  type FormAnalytics,
  type FormSummaryStats,
  type FormTotals,
  formAnalytics,
  formsOverview,
  type GiveawayStats,
  giveawayStats,
  normalisePage,
  recordBlocked,
  recordView,
} from './analytics.js';
export { type CheckedAnswers, checkAnswers, isEmail, type VisitDetails } from './answers.js';
export { checkForm, type FormProblem } from './check.js';
export {
  claimForm,
  type FormClaim,
  type FormClaimRefusal,
  formImpressionId,
  formsForVisit,
  recordFormOutcome,
  submittedForms,
} from './display.js';
export { eraseFormData } from './erase.js';
export {
  FORM_FILE_REF,
  FORM_FILES_FOLDER,
  type FormFileStore,
  MAX_FORM_FILE_BYTES,
  readFormFile,
  type StoredFile,
  sniffFormFile,
  storeFile,
  storeFormFile,
} from './files.js';
export {
  claimBonusAction,
  type Draw,
  drawWinners,
  type EnterResult,
  type EntryState,
  enterGiveaway,
  entryState,
  entryTotal,
  findEntry,
  type GiveawayEntry,
  type GiveawayWinner,
  getEntry,
  giveawayOpen,
  listEntries,
  listWinners,
  redrawWinner,
  setDisqualified,
  snapshotText,
  weightedPicks,
} from './giveaway.js';
export { type FormSubmissionEvent, notifyFormSubmitted } from './hook.js';
export { checkMx, type MxResolver, type MxResult } from './mx.js';
export {
  type BonusAction,
  CAPTURES,
  type Capture,
  FIELD_KINDS,
  type FieldKind,
  FORM_FONTS,
  FORM_ID,
  FORM_PLACEMENTS,
  FORM_TYPES,
  type Form,
  type FormAbuse,
  type FormContent,
  type FormDefinition,
  type FormField,
  type FormLayout,
  type FormMobile,
  type FormPlacement,
  type FormPlacements,
  type FormStyle,
  type FormSuccess,
  type FormType,
  type FormVariant,
  formDefinitionSchema,
  type GiveawaySettings,
  isTriggered,
  type PublicForm,
  parseFormDefinition,
  publicForm,
  SHARE_TARGETS,
  type ShareTarget,
  SUCCESS_ACTIONS,
  type SuccessAction,
  TRIGGERED_PLACEMENTS,
  type TriggeredPlacement,
  variantIds,
  withVariant,
} from './schema.js';
export {
  FORM_EMBED_PLATFORMS,
  type FormEmbedPlatform,
  type FormPromptOptions,
  formEmbedPromptSpec,
  formPopupButtonPromptSpec,
} from './setup-prompts.js';
export {
  csvCell,
  entrantsCsv,
  type FormSubmission,
  getSubmission,
  listSubmissions,
  type SubmissionFilters,
  type SubmissionPage,
  submissionsCsv,
  winnersCsv,
} from './submissions.js';
export {
  type SubmitContext,
  type SubmitInput,
  type SubmitOutcome,
  type SubmitResponse,
  submitForm,
} from './submit.js';
export { FORM_TEMPLATES, type FormTemplate, formTemplate } from './templates.js';
export {
  RENDER_TOKEN_MAX_AGE_MS,
  type RenderClaims,
  type RenderTokenProblem,
  shortHash,
  signEntryKey,
  signedDownloadPath,
  signRenderToken,
  verifyDownload,
  verifyEntryKey,
  verifyRenderToken,
} from './tokens.js';
export {
  assignVariant,
  compareVariants,
  type VariantResult,
  type VariantVerdict,
  zTestConfidence,
} from './variants.js';
