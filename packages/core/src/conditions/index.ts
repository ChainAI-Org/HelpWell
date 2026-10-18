/**
 * Conditions: one rule language for "which contacts does this apply to?"
 *
 * Segments (CT-07) store them, engage targeting and forms evaluate them, and
 * v3 email will count them. There are two ways to run one, and they always
 * agree:
 *
 *   - `evaluateConditions(rules, snapshot)` for one person at request time,
 *     in memory, with no database once the snapshot is built.
 *     `contactMatches(db, contactId, rules)` builds the snapshot for you, and
 *     treats a visitor with no contact row as anonymous.
 *   - `compileConditions(rules, { alias })` for many people at once: a SQL
 *     boolean to drop into any query over `helpwell.contacts`, used to count
 *     and page through a segment without loading every contact.
 *     `countMatchingContacts` and `matchingContactIds` wrap it, and fall back
 *     to reading contacts a page at a time when a rule cannot be compiled.
 *
 * The rule JSON (see types.ts for the full reference):
 *
 *   { "all": [                                   // or "any"; groups nest
 *       { "field": "plan", "op": "is", "value": "pro" },
 *       { "field": "seats", "op": "gte", "value": 3 },
 *       { "field": "signed_up", "op": "more_than_days_ago", "value": 30 },
 *       { "field": "tags", "op": "includes_any", "value": ["beta"] },
 *       { "field": "identified", "op": "is_true" },
 *       { "event": "exported_csv", "op": "at_least", "count": 3, "withinDays": 7 }
 *   ] }
 *
 * `field` is one of the built-in keys (email, name, signed_up, last_seen,
 * identified, tags, source, consent), otherwise an identify attribute by name;
 * `attributes.<name>` reaches an attribute whose name a built-in key took.
 *
 * Always run untrusted input through `parseConditions` first: it checks every
 * operator and value, caps nesting and size, and throws a 400-shaped
 * HelpWellError with a readable message. `checkFieldTypes` then checks the
 * operators against the field registry (fields/), for the builder's sake.
 *
 * Semantics worth knowing:
 *   - Text comparisons ignore case. Negative operators (is_not, not_contains,
 *     neq, excludes, not_happened, is_false) match a contact with no value.
 *   - Stored values are read leniently: "4" is a number, "true" is a boolean,
 *     epoch seconds and ISO strings are dates (zone-less means UTC). A value
 *     of the wrong type simply does not match; it never errors.
 *   - Relative dates and event windows count from `now`, which both paths
 *     take as an option so tests and previews can pin it.
 */

export { type CompileOptions, compileConditions, textArray } from './compile.js';
export { anonymousSnapshot, evaluateConditions, fieldValue } from './evaluate.js';
export {
  checkFieldTypes,
  MAX_CONDITIONS,
  MAX_DEPTH,
  parseConditions,
  referencedEvents,
} from './parse.js';
export {
  countMatchingContacts,
  type MatchStrategy,
  matchingContactIds,
  type ScanOptions,
} from './scan.js';
export { contactMatches, loadSnapshot, loadSnapshots } from './snapshot.js';
export {
  type AllGroup,
  type AnyGroup,
  BOOLEAN_OPERATORS,
  type BooleanOperator,
  type Condition,
  type ConditionGroup,
  type ConditionValue,
  type ContactSnapshot,
  childrenOf,
  DATE_OPERATORS,
  type DateOperator,
  EVENT_OPERATORS,
  type EvaluateOptions,
  type EventCondition,
  type EventOperator,
  FIELD_OPERATORS,
  type FieldCondition,
  type FieldOperator,
  isEventCondition,
  isFieldCondition,
  isGroup,
  LIST_OPERATORS,
  type ListOperator,
  NUMBER_OPERATORS,
  type NumberOperator,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
  TEXT_OPERATORS,
  type TextOperator,
} from './types.js';
export {
  isEmptyValue,
  readBoolean,
  readList,
  readNumber,
  readText,
  readTime,
} from './values.js';
