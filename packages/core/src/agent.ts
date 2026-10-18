/** Agent entry point. */

export { Agent, type AgentDeps, type AgentReply, type ReplyInput } from './agent/agent.js';
export {
  CONFIDENCE_THRESHOLD,
  type Confidence,
  type ConfidenceInput,
  type Grounding,
  retrievalStrength,
  scoreConfidence,
} from './agent/confidence.js';
export {
  FakeModel,
  type GroundedModelOptions,
  type ScriptedTurn,
  type ScriptFn,
} from './agent/fake-model.js';
export { type DraftFromGapOptions, draftArticleFromGap, type GapDraft } from './agent/gap-draft.js';
export {
  countGaps,
  type GapListItem,
  getGap,
  keywords,
  listGaps,
  type RecordGapParams,
  type RecordGapResult,
  recordGap,
  SAME_QUESTION,
  setGapStatus,
  similarity,
  stem,
  suggestTitle,
} from './agent/gaps.js';
export {
  excerpt,
  type GroundedFinding,
  type GroundedMatch,
  type GroundedWording,
  groundedFinding,
  groundedReply,
  type PromptPassage,
  plainWording,
  promptPassages,
  questionOf,
} from './agent/grounded-script.js';
export {
  CERTAINTIES,
  type Certainty,
  type CertaintyReport,
  type CitablePassage,
  extractCertainty,
  inferCitation,
  type ParsedAnswer,
  parseAnswer,
} from './agent/grounding.js';
export {
  type AbuseCheck,
  type AbuseContext,
  type BlockReason,
  checkAbuse,
  hashIp,
  matchesIp,
  pruneRateCounters,
  type RateLimitResult,
  rateLimit,
  recordBlocked,
  recordSpend,
  type SpendStatus,
  spendStatus,
} from './agent/guards.js';
export {
  type ChatRequest,
  type ChatResponse,
  type EmbedRequest,
  type EmbedResponse,
  type ModelMessage,
  type ModelPort,
  type ModelToolCall,
  OpenRouterModel,
  type OpenRouterOptions,
  type ToolSpec,
  type Usage,
} from './agent/model.js';
export {
  type AgentModels,
  MODEL_PURPOSES,
  type ModelFactory,
  type ModelPurpose,
} from './agent/model-factory.js';
export { parseModelJson } from './agent/model-json.js';
export {
  estimateTokens,
  loadPassages,
  MAX_PASSAGE_TOKENS,
  PASSAGE_TOKEN_BUDGET,
  type Passage,
  type PassageOptions,
  SEARCH_TOOL_TOKEN_BUDGET,
} from './agent/passages.js';
export {
  buildSystemPrompt,
  DEFAULT_INSTRUCTIONS,
  type PromptContext,
  parsePageUrl,
  renderInstructions,
} from './agent/prompt.js';
export {
  runTool,
  type ToolContext,
  type ToolName,
  type ToolOutcome,
  toolsFor,
} from './agent/tools.js';
// Evals live in their own folder but ship with the agent: they run it.
export {
  casesFromLastRun,
  DEFAULT_RUBRIC,
  type EvalCase,
  EvalCasesError,
  type EvalMode,
  type EvalRunOptions,
  type EvalRunResult,
  type GradeInput,
  type GradeResult,
  gradeAnswer,
  type JudgedReply,
  type JudgeInput,
  judgeableWithoutModel,
  judgeCase,
  loadEvalCases,
  matchesRule,
  parseEvalCases,
  runEvalSuite,
  starterEvalCases,
} from './evals/index.js';
