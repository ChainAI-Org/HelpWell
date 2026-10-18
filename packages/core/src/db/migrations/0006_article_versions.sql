-- Article history, and what the article editor needs to round-trip a file.
--
-- `helpwell sync` matches articles by content hash, so the moment a hash
-- changes is the moment an article changed. Each change is kept here as a
-- snapshot of what the file said, which is what the dashboard's history and
-- diffs read (KB-16, KB-22). Git is still the full history; this is the part
-- of it the index saw, readable without a checkout of the repo.
--
-- The index also keeps each file as written and where it lives. The body it
-- searches has its image paths rewritten to served URLs, and an editor that
-- loaded that body and saved it back would write API paths into the repo.

ALTER TABLE helpwell.article_index ADD COLUMN IF NOT EXISTS path text;
ALTER TABLE helpwell.article_index ADD COLUMN IF NOT EXISTS source text;

CREATE TABLE helpwell.article_versions (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL,
  -- Relative to the docs folder, e.g. billing/invoices.md
  path         text,
  -- A hash of the file as written, so a sync that only rewrote image URLs
  -- does not record a version nobody made.
  content_hash text NOT NULL,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'published',
  -- The Markdown body as written, without front matter.
  body         text NOT NULL DEFAULT '',
  -- The whole file as written, front matter included, when the indexer had it.
  source       text,
  -- sync | dashboard | api
  origin       text NOT NULL DEFAULT 'sync',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX article_versions_slug_idx ON helpwell.article_versions (slug, id DESC);

-- Every article already indexed starts its history with what it says now.
INSERT INTO helpwell.article_versions (slug, content_hash, title, description, status, body, created_at)
SELECT slug, coalesce(content_hash, ''), title, description, status, body, updated_at
FROM helpwell.article_index;
