-- Engage v2: surveys with several questions, and a cap on how often anyone
-- is interrupted.
--
-- A survey used to be one question, so one row was one response. It can now
-- be up to twenty, with branching, so each answer is its own row: the
-- question it answers, and the session (one visitor going through the survey
-- once) that ties a set of answers together. An answer is saved as soon as it
-- is given, which is what lets a half-finished survey still count. Rows from
-- before this have neither, and read as the first question of a session of
-- their own.
--
-- Impressions gain the widget's session id, so "at most two per session"
-- can be counted on the server rather than trusted to the browser.

ALTER TABLE helpwell.survey_responses ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE helpwell.survey_responses ADD COLUMN IF NOT EXISTS question_id text;
-- Multiple choice: every option picked. `choice` keeps them joined with
-- ", " for anything that reads one string.
ALTER TABLE helpwell.survey_responses ADD COLUMN IF NOT EXISTS choices jsonb;

-- Answering the same question twice in one session (a retry after a network
-- error) replaces the first answer instead of counting twice.
CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_answer_idx
  ON helpwell.survey_responses (survey_id, session_id, question_id)
  WHERE session_id IS NOT NULL AND question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS survey_responses_question_idx
  ON helpwell.survey_responses (survey_id, question_id, created_at DESC);

ALTER TABLE helpwell.engage_impressions ADD COLUMN IF NOT EXISTS session_id text;

-- The global cap counts what one person was shown recently.
CREATE INDEX IF NOT EXISTS engage_impressions_shown_idx
  ON helpwell.engage_impressions (contact_id, created_at DESC)
  WHERE state = 'seen';
