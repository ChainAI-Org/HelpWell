-- Forms: email capture, giveaways and their analytics.
--
-- Engagements live in settings because they are only configuration. A form
-- has submissions, a view count and, for a giveaway, entries and winners, so
-- its definition lives here instead, next to what it collects:
--
-- 1. `forms` is one row per form with its current definition, and
--    `form_versions` every definition it has had. Saving writes a new
--    version; nothing is ever edited in place, so a submission can always
--    say which version of the form it came through.
--
-- 2. `form_views` counts views per day, form, variant, placement and page.
--    Aggregated rather than one row per view, because a popup on every page
--    of a busy site is a lot of rows for a number nobody reads one at a time.
--    `form_viewers` only remembers who has been counted today, so unique
--    views are unique per day; rows from before yesterday are dropped.
--    `blocked` counts submissions refused before anything was stored (no
--    valid render token, far over a rate limit).
--
-- 3. `form_submissions` keeps every submission that came through a rendered
--    form, with the anti-abuse verdict, whether it was trusted, and why not.
--    Only accepted ones touch a contact. `token_nonce` makes a render token
--    single-use: a double click or a replay finds the first submission.
--
-- 4. Giveaways: one entry per person per giveaway (`giveaway_entries`), who
--    referred whom (`giveaway_referrals`), and every draw and redraw
--    (`giveaway_winners`), with the seed and a hash of the entries it drew
--    from, so a draw can be shown to be fair after the fact.

CREATE TABLE IF NOT EXISTS helpwell.forms (
  id          text PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  type        text NOT NULL DEFAULT 'custom',
  enabled     boolean NOT NULL DEFAULT false,
  version     integer NOT NULL DEFAULT 1,
  definition  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS helpwell.form_versions (
  form_id    text NOT NULL REFERENCES helpwell.forms (id) ON DELETE CASCADE,
  version    integer NOT NULL,
  definition jsonb NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, version)
);

CREATE TABLE IF NOT EXISTS helpwell.form_views (
  form_id   text NOT NULL,
  day       date NOT NULL,
  variant   text NOT NULL DEFAULT '',
  placement text NOT NULL DEFAULT '',
  page      text NOT NULL DEFAULT '',
  views     integer NOT NULL DEFAULT 0,
  uniques   integer NOT NULL DEFAULT 0,
  blocked   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (form_id, day, variant, placement, page)
);

CREATE INDEX IF NOT EXISTS form_views_day_idx ON helpwell.form_views (day);

CREATE TABLE IF NOT EXISTS helpwell.form_viewers (
  form_id text NOT NULL,
  day     date NOT NULL,
  visitor text NOT NULL,
  PRIMARY KEY (form_id, day, visitor)
);

CREATE TABLE IF NOT EXISTS helpwell.form_submissions (
  id           text PRIMARY KEY,
  form_id      text NOT NULL,
  form_version integer NOT NULL DEFAULT 1,
  variant      text NOT NULL DEFAULT '',
  placement    text NOT NULL DEFAULT '',
  status       text NOT NULL CHECK (status IN ('accepted', 'rejected', 'duplicate')),
  trusted      boolean NOT NULL DEFAULT false,
  reasons      jsonb NOT NULL DEFAULT '[]'::jsonb,
  verdict      jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_id   text,
  email        text,
  name         text,
  fields       jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent      text NOT NULL DEFAULT 'none' CHECK (consent IN ('granted', 'denied', 'none')),
  consent_text text,
  page_url     text,
  page_path    text,
  referrer     text,
  utm          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash      text,
  token_nonce  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_nonce_idx
  ON helpwell.form_submissions (form_id, token_nonce)
  WHERE token_nonce IS NOT NULL;

CREATE INDEX IF NOT EXISTS form_submissions_form_idx
  ON helpwell.form_submissions (form_id, created_at DESC);

CREATE INDEX IF NOT EXISTS form_submissions_email_idx
  ON helpwell.form_submissions (form_id, lower(email))
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS form_submissions_contact_idx
  ON helpwell.form_submissions (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS helpwell.giveaway_entries (
  id              text PRIMARY KEY,
  form_id         text NOT NULL,
  submission_id   text NOT NULL,
  contact_id      text,
  email           text NOT NULL,
  referral_code   text NOT NULL,
  -- The entry whose link brought this person, when one did.
  referred_by     text,
  trusted         boolean NOT NULL DEFAULT false,
  disqualified    boolean NOT NULL DEFAULT false,
  bonus_referrals integer NOT NULL DEFAULT 0,
  bonus_actions   integer NOT NULL DEFAULT 0,
  -- Their total, capped at the giveaway's maximum: what a draw weighs.
  entries         integer NOT NULL DEFAULT 1,
  -- The self-reported bonus actions they claimed, by id.
  actions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_code_idx
  ON helpwell.giveaway_entries (form_id, referral_code);

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_person_idx
  ON helpwell.giveaway_entries (form_id, lower(email));

CREATE INDEX IF NOT EXISTS giveaway_entries_contact_idx
  ON helpwell.giveaway_entries (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS helpwell.giveaway_referrals (
  id                text PRIMARY KEY,
  form_id           text NOT NULL,
  referrer_entry_id text NOT NULL,
  referred_entry_id text NOT NULL UNIQUE,
  -- Only a trusted entry earns its referrer a bonus.
  credited          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS giveaway_referrals_form_idx
  ON helpwell.giveaway_referrals (form_id, referrer_entry_id);

CREATE TABLE IF NOT EXISTS helpwell.giveaway_winners (
  id            text PRIMARY KEY,
  form_id       text NOT NULL,
  draw_id       text NOT NULL,
  entry_id      text NOT NULL,
  position      integer NOT NULL,
  seed          text NOT NULL,
  -- SHA-256 of the eligible entries and their weights, in order.
  snapshot_hash text NOT NULL,
  snapshot_size integer NOT NULL,
  total_weight  integer NOT NULL,
  status        text NOT NULL DEFAULT 'selected' CHECK (status IN ('selected', 'redrawn')),
  -- Why this winner was redrawn, and the winner that replaced them.
  reason        text,
  replaced_by   text,
  -- The winner this one replaced, for a redraw.
  replaces      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  redrawn_at    timestamptz
);

CREATE INDEX IF NOT EXISTS giveaway_winners_form_idx
  ON helpwell.giveaway_winners (form_id, created_at);
