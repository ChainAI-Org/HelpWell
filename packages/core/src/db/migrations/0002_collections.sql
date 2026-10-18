-- Collection metadata.
--
-- An article row carries only its collection id, which is the folder name. The
-- title, description, icon, tint and ordering all live in that folder's
-- _meta.json, and until this table existed they were read at sync time and
-- then thrown away — so the help centre could only ever show "getting-started"
-- where the folder had asked for "Getting started".
--
-- `helpwell sync` writes one row per folder. A collection with no row still
-- appears, because every read falls back to the id; this table only ever makes
-- the presentation better.

CREATE TABLE helpwell.collection_index (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text,
  -- Lucide icon name (KB-23)
  icon        text NOT NULL DEFAULT 'book-open',
  -- lavender | peach | butter | mint (KB-23)
  tint        text NOT NULL DEFAULT 'lavender',
  -- Folders that did not pick an order sort last; 1000 is that "last".
  order_index integer NOT NULL DEFAULT 1000,
  -- Whether the agent may answer from this collection.
  ask_agent   boolean NOT NULL DEFAULT true,
  -- public | identified
  visibility  text NOT NULL DEFAULT 'public',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_index_order_idx ON helpwell.collection_index (order_index, title);
