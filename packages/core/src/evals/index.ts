/**
 * Evals: replay questions through the real agent and score the answers.
 * Exported through `@helpwell/core/agent`.
 */

export {
  type EvalCase,
  EvalCasesError,
  loadEvalCases,
  matchesRule,
  parseEvalCases,
} from './cases.js';
export { DEFAULT_RUBRIC, type GradeInput, type GradeResult, gradeAnswer } from './grade.js';
export {
  type EvalMode,
  type JudgedReply,
  type JudgeInput,
  judgeableWithoutModel,
  judgeCase,
} from './judge.js';
export {
  casesFromLastRun,
  type EvalRunOptions,
  type EvalRunResult,
  runEvalSuite,
} from './run.js';
export { starterEvalCases } from './starter.js';
