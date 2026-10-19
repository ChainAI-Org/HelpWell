/**
 * @helpwell/core — the engine behind the widget, the help center, the dashboard
 * and the CLI. Server-side only: it talks to the database and to the model.
 */

export { signIdentity } from './api/identity.js';
// Human support from a service over HTTPS, and the prompt that connects one.
export {
  checkRemoteSupport,
  createRemoteSupportExtension,
  type RemoteSupportOptions,
  type RemoteSupportPromptOptions,
  remoteSupportPromptSpec,
  SUPPORT_PRODUCT_ENV,
  SUPPORT_TOKEN_ENV,
  SUPPORT_URL_ENV,
} from './api/remote-extension.js';
// The one import most host apps need: mount this and HelpWell is running.
export {
  createHelpWellHandler,
  type HelpWellConfig,
  type HelpWellHandler,
  type StaticAsset,
} from './api.js';
// Reading GitHub releases for `helpwell changelog`, as a prompt for an AI assistant.
export {
  GITHUB_TOKEN_ENV,
  type GitHubTokenPromptOptions,
  githubTokenPromptSpec,
} from './changelog-prompts.js';
export {
  badRequest,
  forbidden,
  HelpWellError,
  type HelpWellErrorCode,
  isHelpWellError,
  notConfigured,
  notFound,
  unauthorized,
} from './errors.js';
// Embedding a form, and a button that opens one, as prompts for an AI assistant.
export {
  FORM_EMBED_PLATFORMS,
  type FormEmbedPlatform,
  type FormPromptOptions,
  formEmbedPromptSpec,
  formPopupButtonPromptSpec,
} from './forms/setup-prompts.js';
export { type IdPrefix, idPrefix, idTime, isId, newId } from './ids.js';
export {
  docsPromptSpec,
  evalCasesPromptSpec,
  firstAnswerPromptSpec,
  IDENTITY_SECRET_ENV,
  type InstallPromptOptions,
  identitySigningPromptSpec,
  loaderUrls,
  modelKeyPromptSpec,
  OPENROUTER_KEY_ENV,
  searchIndexPromptSpec,
  WIDGET_FRAMEWORKS,
  type WidgetFramework,
  widgetInstallPromptSpec,
} from './install-prompts.js';
export {
  contactImportPromptSpec,
  mcpSetupPromptSpec,
  WEBHOOK_EXAMPLES,
  webhookReceiverPromptSpec,
} from './integration-prompts.js';
export {
  formatSetupPrompt,
  type SetupPromptBlock,
  type SetupPromptSpec,
  type SetupPromptTable,
  STANDARD_SETUP_RULES,
} from './setup-prompt.js';
export {
  checkWebhookUrl,
  defaultWebhookFetch,
  guardedWebhookFetch,
  WEBHOOK_GUARD_ENV,
  type WebhookFetchConfig,
  type WebhookGuardOptions,
  WebhookRefusedError,
  webhookFetchFor,
  webhookGuardOff,
  webhookOptionsFor,
} from './webhook-guard.js';
export {
  announceChatTurn,
  type DeliveryOutcome,
  emitStoredWebhooks,
  emitWebhooks,
  listDeliveries,
  MAX_ATTEMPTS,
  type RetryResult,
  retryDelayMs,
  retryWebhooks,
  sendTestWebhook,
  sign,
  targetsFor,
  verifySignature,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENTS,
  WEBHOOK_TEST_EVENT,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookOptions,
} from './webhooks.js';
export {
  TURNSTILE_ORIGIN,
  type TurnstilePromptOptions,
  turnstilePromptSpec,
  WIDGET_VIDEO_ORIGINS,
  type WidgetCspPromptOptions,
  widgetCsp,
  widgetCspPromptSpec,
} from './widget-prompts.js';

export const VERSION = '0.1.1';
