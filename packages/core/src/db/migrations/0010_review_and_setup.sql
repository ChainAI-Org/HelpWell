-- What the conversation review and the setup checklist need to remember.
--
-- 1. Each agent reply now keeps the passages it was shown: their slug, title,
--    the number the prompt gave them, how search found them (words, meaning
--    or both), the cosine similarity when the semantic pass ran, and whether
--    the answer cited each one. That is what lets a person reviewing a
--    conversation see how close every cited article really was. It is its own
--    column rather than extra keys on `citations` because citations go to the
--    visitor's browser and to webhooks, and retrieval detail is for the team.
--    Customer and event rows, and agent rows written before this, hold [].
--
-- 2. `install_state` is a handful of facts about this install that are not
--    settings: when the widget first loaded on a page, and what the dashboard's
--    "Get set up" checklist was told (dismissed, an optional step marked done).
--    Not in `helpwell.settings` because `helpwell sync` replaces that document
--    from the repo, and none of these belong in a config file.

ALTER TABLE helpwell.messages ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS helpwell.install_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
