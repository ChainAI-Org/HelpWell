/** HTTP API entry point. */

// Agent overrides and content sync, for a support extension (WP10a).
export {
  AGENT_OVERRIDES_TTL_MS,
  AGENT_TOOL_NAMES,
  applyNameOverride,
  applyToolOverrides,
  cleanAgentOverrides,
  withOverrideInstructions,
} from './api/agent-overrides.js';
export {
  buildContentManifest,
  type ContentSync,
  type ContentSyncOptions,
  contentFingerprint,
  createContentSync,
  engageCatalog,
  pushContentSync,
} from './api/content-sync.js';
export {
  clientIp,
  createContext,
  type HelpWellConfig,
  type RequestContext,
  type ResolvedHelpWellConfig,
  requireAdmin,
  type StaticAsset,
} from './api/context.js';
export { assertSameOrigin } from './api/csrf.js';
// Fail open, the durable retry queue, the remote support extension, and proactive items.
export {
  consoleSupportLogger,
  type FailOpenOptions,
  type FailOpenSupport,
  failOpenSupport,
  HANDOFF_UNAVAILABLE,
  isOwnershipError,
  type SupportLogger,
} from './api/fail-open.js';
export { createHelpWellHandler, type HelpWellHandler } from './api/handler.js';
export {
  type BotCheckStatus,
  botCheckStatus,
  type HumanCheckContext,
  publicBotCheck,
  requireHuman,
  requireHumanForConversation,
  TURNSTILE_CSP,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_SECRET_ENV,
  type TurnstileConfig,
  type TurnstileResult,
  verifyTurnstile,
} from './api/human-check.js';
export {
  ADMIN_COOKIE,
  cookieHeader,
  ensureVisitor,
  type IdentifyClaims,
  readCookie,
  safeEqual,
  signIdentity,
  type UpsertContactResult,
  upsertIdentifiedContact,
  VISITOR_COOKIE,
  verifyIdentity,
} from './api/identity.js';
export {
  blocksToMarkdown,
  type CleanOptions,
  type CleanProactiveItem,
  claimProactiveEngagement,
  cleanProactiveItems,
  PROACTIVE_ENGAGEMENT_PREFIX,
  type ProactiveClaim,
  resumableProactiveTours,
} from './api/proactive.js';
// Absolute image URLs in widget content, for a host that sends its own.
export {
  absoluteMarkdownMedia,
  absoluteMediaUrl,
  type PublicBase,
  publicBaseFor,
} from './api/public-urls.js';
export {
  checkRemoteSupport,
  createRemoteSupportExtension,
  isRemoteSupportOptions,
  PROACTIVE_MODEL,
  pendingHumanReply,
  REMOTE_UPLOAD_LIMITS,
  type RemoteSupportCheck,
  type RemoteSupportExtension,
  type RemoteSupportExtensionOptions,
  type RemoteSupportOptions,
  type RemoteSupportPromptOptions,
  type RemoteSupportTimeouts,
  type RemoteUploadLimits,
  remoteSupportFromEnv,
  remoteSupportPromptSpec,
  SUPPORT_PRODUCT_ENV,
  SUPPORT_TOKEN_ENV,
  SUPPORT_URL_ENV,
  SupportRefusedError,
  type SupportSnapshot,
  type SupportSnapshotMessage,
  SupportUnavailableError,
  supportBaseUrl,
  supportSnapshot,
} from './api/remote-extension.js';
export {
  errorResponse,
  json,
  type Method,
  noContent,
  type RouteHandler,
  type RouteMatch,
  Router,
  readJson,
} from './api/router.js';
export { adminRoutes } from './api/routes/admin.js';
export { type ArticleRoutesOptions, articleRoutes } from './api/routes/articles.js';
export {
  audienceRoutes,
  conditionsFromQuery,
  contactListOptions,
} from './api/routes/audience.js';
export { formsAdminRoutes } from './api/routes/forms-admin.js';
export { formsPublicRoutes, hasTriggeredForms } from './api/routes/forms-public.js';
export {
  fetchModelList,
  MODEL_LIST_TTL_MS,
  type ModelList,
  type ModelListKind,
  type ModelOption,
  modelRoutes,
  OPENROUTER_MODELS_URL,
} from './api/routes/models.js';
export { publicRoutes } from './api/routes/public.js';
export type { WidgetThreadState } from './api/routes/widget-contact.js';
export { currentStatus, type WidgetStatus } from './api/routes/widget-status.js';
export {
  BASE_SECURITY_HEADERS,
  frameAncestorsDirective,
  resolveSecurityHeaders,
  type SecurityHeaderOverrides,
  type SecurityHeadersOption,
  withSecurityHeaders,
} from './api/security-headers.js';
export {
  fetchPublicJson,
  isPrivateAddress,
  type PageStatus,
  parseStatusPage,
  readStatusPage,
  STATUS_MESSAGES,
  type StatusIncident,
} from './api/status-page.js';
export type {
  AgentOverrides,
  AgentToolName,
  ContentManifest,
  EngageCatalog,
  ProactiveBlock,
  ProactiveChatItem,
  ProactiveContext,
  ProactiveEngagementItem,
  ProactiveEvent,
  ProactiveEventContext,
  ProactiveItem,
  ProactiveSender,
  ProactiveTrigger,
  SupportAttachment,
  SupportExtension,
  SupportPresence,
  SupportThread,
  SupportThreadMessage,
} from './api/support-extension.js';
export {
  MAX_RETRY_ATTEMPTS,
  pendingRetries,
  type SupportRetry,
  type SupportRetryKind,
} from './api/support-retries.js';
export { resolveSupport } from './api/support-setup.js';
// The header-borne visitor token for a widget on another site.
export {
  presentedVisitorToken,
  signVisitorToken,
  VISITOR_HEADER,
  VISITOR_TOKEN_FORGET,
  VISITOR_TOKEN_MAX_AGE_S,
  VISITOR_TOKEN_REQUEST,
  verifyVisitorToken,
  withVisitorToken,
} from './api/visitor-token.js';
// What `SupportExtension.formSubmitted` receives, and the verdict inside it.
export type { FormVerdict } from './forms/abuse.js';
export type { FormSubmissionEvent } from './forms/hook.js';
