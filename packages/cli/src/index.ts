/**
 * `helpwell` — the command line, also importable.
 *
 * Exported so a release script can call `sync` or `runEvals` directly rather
 * than shelling out and parsing output.
 */

export { bool, num, type ParsedArgs, parseArgs, str } from './args.js';
export { type AskOptions, ask, dev } from './commands/ask.js';
export { type CaptureOptions, type CaptureResult, capture } from './commands/capture.js';
export {
  type ChangelogDraft,
  type ChangelogOptions,
  type ChangelogSource,
  changelog,
} from './commands/changelog.js';
export {
  EXPORTED_TABLES,
  type ExportOptions,
  type MigrateSummary,
  type PruneSummary,
  redactSettings,
  runExport,
  runMigrate,
  runPrune,
} from './commands/data.js';
export {
  buildRepoContext,
  type DocsGenerateOptions,
  type DocsUpdateOptions,
  type DraftedArticle,
  docsGenerate,
  docsUpdate,
  type ProposedEdit,
  parseDrafts,
  parseJsonBlock,
  parseVerdict,
  type RepoContext,
} from './commands/docs.js';
export { type Check, type CheckState, type DoctorResult, doctor } from './commands/doctor.js';
export {
  type EvalCase,
  type EvalCaseResult,
  EvalCasesError,
  type EvalOptions,
  type EvalRunResult,
  loadCases,
  runEvals,
  type Verdict,
} from './commands/evals.js';
export {
  detectSource,
  IMPORT_SOURCES,
  type ImportOptions,
  type ImportResult,
  runImport,
} from './commands/import.js';
export { type InitOptions, type InitResult, init } from './commands/init.js';
export {
  type LinkOptions,
  type LinkResult,
  type LinkStatus,
  link,
  linkStatus,
  unlink,
} from './commands/link.js';
export {
  defaultPromptFacts,
  detectFramework,
  PROMPT_TOPICS,
  type PromptFacts,
  type PromptOptions,
  type PromptResult,
  type PromptTopic,
  prompt,
  readPromptFacts,
} from './commands/prompt.js';
export {
  type SettingsCommandOptions,
  settingsPull,
  settingsPush,
} from './commands/settings.js';
export { type SyncOptions, type SyncResult, sync } from './commands/sync.js';
export { webhooksList, webhooksRetry, webhooksTest } from './commands/webhooks.js';
export { parseCsv, readContactsFile } from './importers/contacts.js';
export { crawlSite } from './importers/crawl.js';
export { htmlTitle, htmlToMarkdown, mainContent } from './importers/html-to-markdown.js';
export { readGitbook, readHtmlFolder, readMarkdownFolder, readNotion } from './importers/local.js';
export {
  importFromPlatform,
  PLATFORM_KEYS,
  PLATFORMS,
  type Platform,
} from './importers/platforms.js';
export {
  type ImportedArticle,
  type ImportedCollection,
  type ImportPlan,
  type WriteResult,
  writeImport,
} from './importers/write.js';
export { installPromptSpec } from './install-prompt.js';
export { divertStdout, type JsonOutcome, runAsJson, writeJson } from './json.js';
export {
  CONFIG_FILE,
  findRoot,
  loadProject,
  NotInstalledError,
  type OpenDbResult,
  openDb,
  type Project,
  type ProjectConfig,
  type ProjectPaths,
  pathsFor,
  readShots,
  readSupportLink,
  redactUrl,
  type ScreenshotConfig,
  type Shot,
  type SupportLink,
  saveConfig,
} from './project.js';
// The README's generated blocks, for scripts/readme.mjs in the HelpWell repo.
export { GENERATED_BLOCKS, generatedFiles, updateGenerated } from './readme.js';
export { printHelp, type RunResult, run, VERSION } from './run.js';
