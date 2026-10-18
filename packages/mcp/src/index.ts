/**
 * @helpwell/mcp — HelpWell as tools a coding agent can call.
 *
 * The usual entry point is the `helpwell-mcp` binary. This module exists for
 * the host app that would rather embed the server in a process it already runs
 * than spawn one, and for tests.
 */

export type { DbResolver, LazyDatabaseOptions } from './db.js';
export { LazyDatabase } from './db.js';
export { type RemoteMcpResult, type RemoteMcpTool, remoteMcpRequest } from './http.js';
export {
  type CliOutcome,
  type CliRunner,
  cliRunner,
  findCliBin,
  type McpEnvironment,
  resolveEnvironment,
} from './project.js';
export {
  type ConversationTranscript,
  captureScreenshotsTool,
  countSegmentTool,
  createArticleTool,
  type EvalSummary,
  generateChangelogTool,
  importDocsTool,
  listSegmentsTool,
  readConversationTool,
  runEvalsTool,
  updateArticleTool,
  updateSettingTool,
  type WrittenArticle,
} from './write-tools.js';

import { formatSetupPrompt, mcpSetupPromptSpec } from '@helpwell/core';

/**
 * Instructions an assistant can follow to connect this server to Claude
 * Desktop, Claude Code or Cursor. Holds no secrets: it says where the person
 * pastes them.
 */
export function mcpSetupPrompt(options: { projectDir?: string } = {}): string {
  return formatSetupPrompt(mcpSetupPromptSpec(options));
}
export {
  callTool,
  createHelpWellMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS,
} from './server.js';
export type {
  ArticleBody,
  ArticleHit,
  CollectionSummary,
  ConversationStatus,
  ConversationSummary,
  GapStatus,
  GapSummary,
  ReportRange,
  ReportSummary,
  ResolvedGap,
  ToolArgs,
  ToolName,
} from './tools.js';
export {
  CONVERSATION_STATUSES,
  GAP_STATUSES,
  isToolName,
  listCollectionsTool,
  listGapsTool,
  REPORT_RANGES,
  readArticleTool,
  recentConversationsTool,
  reportSummaryTool,
  resolveGapTool,
  runTool,
  searchArticlesTool,
  TOOL_NAMES,
} from './tools.js';
