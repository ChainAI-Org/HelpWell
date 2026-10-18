-- Restoring an article to one of its earlier versions (WP20).
--
-- A restore never rewrites history: it saves the old words as the article's
-- newest version, like any other save, and the history keeps everything in
-- between. This says which version a restore brought back, so the history
-- can read "Restored from 12 March" rather than a bare "Changed".

ALTER TABLE helpwell.article_versions ADD COLUMN IF NOT EXISTS restored_from bigint;
