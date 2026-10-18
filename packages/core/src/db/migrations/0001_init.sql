-- HelpWell 0001 — initial schema.
--
-- Everything lives in its own `helpwell` schema so the package can sit inside a
-- customer's existing database without colliding with their tables (DX-07).
-- Content (articles, capture scripts, engage rules) stays in the repo; this
-- database only holds what customers generate.

CREATE SCHEMA IF NOT EXISTS helpwell;

-- ---------------------------------------------------------------- settings
-- One row. Mirrors helpwell/settings.json so the dashboard can read and write
-- without a file round-trip; the CLI keeps the file authoritative.
CREATE TABLE helpwell.settings (
  id          text PRIMARY KEY DEFAULT 'default',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_single_row CHECK (id = 'default')
);

-- ---------------------------------------------------------------- contacts
CREATE TABLE helpwell.contacts (
  id           text PRIMARY KEY,
  external_id  text,
  email        text,
  name         text,
  avatar_url   text,
  -- Anything the app passed to identify(): plan, role, seats, signup date…
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- true once a signed identify call has vouched for them (CT-06)
  identified   boolean NOT NULL DEFAULT false,
  source       text NOT NULL DEFAULT 'widget',
  consent      text NOT NULL DEFAULT 'unknown',
  locale       text,
  timezone     text,
  country      text,
  city         text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE UNIQUE INDEX contacts_external_id_key ON helpwell.contacts (external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX contacts_email_key ON helpwell.contacts (lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX contacts_last_seen_idx ON helpwell.contacts (last_seen_at DESC);

CREATE TABLE helpwell.contact_tags (
  contact_id text NOT NULL REFERENCES helpwell.contacts (id) ON DELETE CASCADE,
  tag        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag)
);

-- ----------------------------------------------------------- conversations
-- A review log, not a work queue (IN-01): no assignee, no open/closed.
CREATE TABLE helpwell.conversations (
  id            text PRIMARY KEY,
  contact_id    text REFERENCES helpwell.contacts (id) ON DELETE SET NULL,
  -- resolved | unresolved  (set by the agent from the outcome and feedback)
  status        text NOT NULL DEFAULT 'unresolved',
  topic         text,
  page_url      text,
  -- sad | indifferent | happy | love  (AG-07)
  rating        text,
  rating_comment text,
  reviewed_at   timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  cost_usd      numeric(10, 6) NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT conversations_status_check CHECK (status IN ('resolved', 'unresolved'))
);

CREATE INDEX conversations_contact_idx ON helpwell.conversations (contact_id);
CREATE INDEX conversations_last_message_idx ON helpwell.conversations (last_message_at DESC);
CREATE INDEX conversations_status_idx ON helpwell.conversations (status);

CREATE TABLE helpwell.conversation_tags (
  conversation_id text NOT NULL REFERENCES helpwell.conversations (id) ON DELETE CASCADE,
  tag             text NOT NULL,
  -- 'agent' when the model suggested it, 'human' when someone typed it (IN-03)
  source          text NOT NULL DEFAULT 'agent',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag)
);

-- ---------------------------------------------------------------- messages
CREATE TABLE helpwell.messages (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES helpwell.conversations (id) ON DELETE CASCADE,
  -- customer | agent | event   (event rows render as the grey lines in a thread)
  role            text NOT NULL,
  body            text NOT NULL DEFAULT '',
  -- [{ slug, title, collection }] — what the answer was grounded in (AG-05)
  citations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ name, arguments, result }] — collapsed in the thread view
  tool_calls      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- helpful | not_helpful  (AG-07)
  feedback        text,
  feedback_comment text,
  model           text,
  tokens_in       integer,
  tokens_out      integer,
  cost_usd        numeric(10, 6),
  latency_ms      integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_role_check CHECK (role IN ('customer', 'agent', 'event')),
  CONSTRAINT messages_feedback_check CHECK (feedback IS NULL OR feedback IN ('helpful', 'not_helpful'))
);

CREATE INDEX messages_conversation_idx ON helpwell.messages (conversation_id, created_at);

-- ------------------------------------------------------------------ events
-- helpwell.track('exported_csv') plus internal activity (article viewed, …)
CREATE TABLE helpwell.events (
  id         text PRIMARY KEY,
  contact_id text REFERENCES helpwell.contacts (id) ON DELETE CASCADE,
  name       text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}'::jsonb,
  url        text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_contact_idx ON helpwell.events (contact_id, created_at DESC);
CREATE INDEX events_name_idx ON helpwell.events (name, created_at DESC);

-- ----------------------------------------------------------- article index
-- A search cache built from the repo files by `helpwell sync`. The markdown in
-- helpwell/docs stays canonical; this table exists so search is one query.
CREATE TABLE helpwell.article_index (
  slug        text PRIMARY KEY,
  collection  text NOT NULL,
  title       text NOT NULL,
  description text,
  body        text NOT NULL DEFAULT '',
  headings    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'published',
  applies_to  text,
  order_index integer NOT NULL DEFAULT 0,
  reading_minutes integer NOT NULL DEFAULT 1,
  -- cosine similarity happens in JS: a help centre is hundreds of articles, not
  -- millions, and this keeps pgvector out of the install requirements (KB-09).
  embedding   jsonb,
  content_hash text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  search_tsv  tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) STORED
);

CREATE INDEX article_index_tsv_idx ON helpwell.article_index USING gin (search_tsv);
CREATE INDEX article_index_collection_idx ON helpwell.article_index (collection, order_index);

CREATE TABLE helpwell.article_ratings (
  id         text PRIMARY KEY,
  slug       text NOT NULL,
  contact_id text REFERENCES helpwell.contacts (id) ON DELETE SET NULL,
  -- helpful | not_helpful, or one of the four faces when the survey style is set
  value      text NOT NULL,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX article_ratings_slug_idx ON helpwell.article_ratings (slug, created_at DESC);

-- ---------------------------------------------------------------- searches
CREATE TABLE helpwell.searches (
  id            text PRIMARY KEY,
  query         text NOT NULL,
  results_count integer NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'help_center',
  contact_id    text REFERENCES helpwell.contacts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX searches_created_idx ON helpwell.searches (created_at DESC);
CREATE INDEX searches_empty_idx ON helpwell.searches (lower(query)) WHERE results_count = 0;

-- -------------------------------------------------------------------- gaps
-- What Fern could not answer, ranked (KB-25). One row per canonical question;
-- the ways people phrased it accumulate in `variants`.
CREATE TABLE helpwell.gaps (
  id            text PRIMARY KEY,
  question      text NOT NULL,
  variants      jsonb NOT NULL DEFAULT '[]'::jsonb,
  asks          integer NOT NULL DEFAULT 1,
  -- new | drafted | dismissed
  status        text NOT NULL DEFAULT 'new',
  article_slug  text,
  suggested_collection text,
  suggested_title text,
  first_asked_at timestamptz NOT NULL DEFAULT now(),
  last_asked_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaps_status_check CHECK (status IN ('new', 'drafted', 'dismissed'))
);

CREATE INDEX gaps_rank_idx ON helpwell.gaps (status, asks DESC, last_asked_at DESC);

CREATE TABLE helpwell.gap_conversations (
  gap_id          text NOT NULL REFERENCES helpwell.gaps (id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES helpwell.conversations (id) ON DELETE CASCADE,
  asked_as        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gap_id, conversation_id)
);

-- --------------------------------------------------------------- changelog
CREATE TABLE helpwell.changelog_entries (
  id           text PRIMARY KEY,
  version      text,
  title        text NOT NULL,
  summary      text,
  body         text NOT NULL DEFAULT '',
  -- ["new", "improved", "fixed"]
  tags         jsonb NOT NULL DEFAULT '[]'::jsonb,
  status       text NOT NULL DEFAULT 'draft',
  cover_url    text,
  source_ref   text,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT changelog_status_check CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX changelog_published_idx ON helpwell.changelog_entries (published_at DESC)
  WHERE status = 'published';

CREATE TABLE helpwell.changelog_reads (
  entry_id   text NOT NULL REFERENCES helpwell.changelog_entries (id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES helpwell.contacts (id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, contact_id)
);

-- ----------------------------------------------------------------- roadmap
CREATE TABLE helpwell.roadmap_items (
  id                 text PRIMARY KEY,
  title              text NOT NULL,
  body               text,
  -- under_review | planned | in_progress | shipped
  status             text NOT NULL DEFAULT 'under_review',
  changelog_entry_id text REFERENCES helpwell.changelog_entries (id) ON DELETE SET NULL,
  votes_count        integer NOT NULL DEFAULT 0,
  created_by         text REFERENCES helpwell.contacts (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_status_check
    CHECK (status IN ('under_review', 'planned', 'in_progress', 'shipped'))
);

CREATE INDEX roadmap_rank_idx ON helpwell.roadmap_items (status, votes_count DESC);

CREATE TABLE helpwell.roadmap_votes (
  item_id    text NOT NULL REFERENCES helpwell.roadmap_items (id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES helpwell.contacts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, contact_id)
);

-- ------------------------------------------------------------------ engage
-- The rules themselves are JSON in helpwell/engage/. This records what people
-- actually saw, which is what EN-05 reports on.
CREATE TABLE helpwell.engage_impressions (
  id            text PRIMARY KEY,
  engagement_id text NOT NULL,
  contact_id    text REFERENCES helpwell.contacts (id) ON DELETE CASCADE,
  -- seen | clicked | dismissed | completed
  state         text NOT NULL,
  step          integer,
  url           text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engage_state_check CHECK (state IN ('seen', 'clicked', 'dismissed', 'completed'))
);

CREATE INDEX engage_impressions_idx
  ON helpwell.engage_impressions (engagement_id, state, created_at DESC);
CREATE INDEX engage_impressions_contact_idx ON helpwell.engage_impressions (contact_id, engagement_id);

CREATE TABLE helpwell.survey_responses (
  id         text PRIMARY KEY,
  survey_id  text NOT NULL,
  -- nps | csat | single
  kind       text NOT NULL DEFAULT 'nps',
  score      integer,
  choice     text,
  comment    text,
  contact_id text REFERENCES helpwell.contacts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX survey_responses_idx ON helpwell.survey_responses (survey_id, created_at DESC);

-- ---------------------------------------------------------------- webhooks
CREATE TABLE helpwell.webhook_deliveries (
  id            text PRIMARY KEY,
  event         text NOT NULL,
  url           text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  attempts      integer NOT NULL DEFAULT 0,
  response_code integer,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  CONSTRAINT webhook_status_check CHECK (status IN ('pending', 'delivered', 'failed'))
);

CREATE INDEX webhook_pending_idx ON helpwell.webhook_deliveries (status, created_at)
  WHERE status = 'pending';

-- ------------------------------------------------------------------- evals
CREATE TABLE helpwell.eval_runs (
  id         text PRIMARY KEY,
  ref        text,
  score      integer NOT NULL DEFAULT 0,
  passed     integer NOT NULL DEFAULT 0,
  weak       integer NOT NULL DEFAULT 0,
  failed     integer NOT NULL DEFAULT 0,
  cost_usd   numeric(10, 6) NOT NULL DEFAULT 0,
  median_ms  integer,
  -- [{ id, question, verdict, answer, cited, expected, ms }]
  cases      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eval_runs_created_idx ON helpwell.eval_runs (created_at DESC);

-- ------------------------------------------------------------------ spend
-- Every model call lands here so the daily cap in AG-20 is a sum, not a guess.
CREATE TABLE helpwell.spend_ledger (
  id         text PRIMARY KEY,
  day        date NOT NULL DEFAULT CURRENT_DATE,
  -- chat | docs | embedding | eval | image
  kind       text NOT NULL,
  model      text NOT NULL,
  tokens_in  integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd   numeric(10, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX spend_day_idx ON helpwell.spend_ledger (day, kind);

-- Blocked attempts are counted, never stored as conversations (AG-21).
CREATE TABLE helpwell.blocked_attempts (
  id         text PRIMARY KEY,
  reason     text NOT NULL,
  ip_hash    text,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blocked_day_idx ON helpwell.blocked_attempts (created_at DESC);

-- ------------------------------------------------------------- rate limits
-- A counter per (bucket, window) so limits survive a restart and work across
-- serverless instances, where an in-memory map would not.
CREATE TABLE helpwell.rate_counters (
  bucket     text NOT NULL,
  window_at  timestamptz NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_at)
);

CREATE INDEX rate_counters_window_idx ON helpwell.rate_counters (window_at);
