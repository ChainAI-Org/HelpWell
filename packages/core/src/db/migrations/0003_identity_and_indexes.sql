-- Identity, and the indexes the queries were already asking for.
--
-- Email uniqueness now applies to identified contacts only. An anonymous
-- visitor can type any address into the pre-chat form, and two browsers used
-- by one person before signing in are legitimately two anonymous rows with the
-- same email. Making that address unique across anonymous rows did two bad
-- things: it let a stranger "reserve" someone's email so that person's real
-- sign-in was merged into the stranger's record, and it turned a second
-- browser into a 500. Identity comes from the signed token's external id, and
-- only that; email is a label on the record, unique among the people the host
-- app has actually vouched for.

DROP INDEX IF EXISTS helpwell.contacts_email_key;
CREATE UNIQUE INDEX contacts_email_key ON helpwell.contacts (lower(email))
  WHERE email IS NOT NULL AND identified = true AND deleted_at IS NULL;

-- Reports scan conversations by when they started and messages by when they
-- were written; the existing indexes lead with other columns.
CREATE INDEX IF NOT EXISTS conversations_started_idx
  ON helpwell.conversations (started_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_idx
  ON helpwell.messages (created_at DESC);

-- Foreign keys that erasure, export and the activity feed look up by contact.
CREATE INDEX IF NOT EXISTS searches_contact_idx
  ON helpwell.searches (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS article_ratings_contact_idx
  ON helpwell.article_ratings (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS survey_responses_contact_idx
  ON helpwell.survey_responses (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS roadmap_items_created_by_idx
  ON helpwell.roadmap_items (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS roadmap_items_changelog_idx
  ON helpwell.roadmap_items (changelog_entry_id) WHERE changelog_entry_id IS NOT NULL;
