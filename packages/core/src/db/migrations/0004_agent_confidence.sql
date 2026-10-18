-- How sure the agent was, answer by answer.
--
-- Until now "unresolved" was the only judgement stored, and it came almost
-- entirely from the model choosing to call mark_unresolved. Every agent message
-- now carries a 0-1 confidence score and the plain-language reason behind it,
-- built from how well search matched, whether the answer cited what it used,
-- and what the model said about its own answer (`certainty`). The score is
-- internal: open source applies one fixed threshold and shows the number
-- read-only in the conversation review. A hosted install may apply its own.
--
-- Customer and event rows leave all three empty, as do agent rows written
-- before this migration.

ALTER TABLE helpwell.messages ADD COLUMN IF NOT EXISTS confidence real;
ALTER TABLE helpwell.messages ADD COLUMN IF NOT EXISTS confidence_reason text;
-- answered | partial | not_covered, as the model reported it; null when it did not say
ALTER TABLE helpwell.messages ADD COLUMN IF NOT EXISTS certainty text;

ALTER TABLE helpwell.messages ADD CONSTRAINT messages_confidence_check
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
ALTER TABLE helpwell.messages ADD CONSTRAINT messages_certainty_check
  CHECK (certainty IS NULL OR certainty IN ('answered', 'partial', 'not_covered'));

-- An eval run without a model only measures retrieval, and a score from one is
-- not comparable with a score from a full run. Runs before this migration say
-- neither.
-- full | retrieval
ALTER TABLE helpwell.eval_runs ADD COLUMN IF NOT EXISTS mode text;
-- The chat model that answered, or null for a retrieval-only run
ALTER TABLE helpwell.eval_runs ADD COLUMN IF NOT EXISTS model text;
-- Every case the run was given, as written in evals.json, including any a
-- retrieval-only run had to leave out. It is what lets the dashboard repeat a
-- run: the server cannot read the repo's cases file.
ALTER TABLE helpwell.eval_runs ADD COLUMN IF NOT EXISTS suite jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE helpwell.eval_runs ADD CONSTRAINT eval_runs_mode_check
  CHECK (mode IS NULL OR mode IN ('full', 'retrieval'));
