-- Contacts you can target: typed fields, segments, source and consent, and
-- webhook deliveries that retry.
--
-- Until now a contact's identify attributes were one opaque JSON blob that the
-- next identify call replaced wholesale, nothing could filter on them, and a
-- tracked event was only ever read back by the activity feed. This migration
-- gives the attributes a registry of typed fields, stores saved filters
-- (segments) as condition JSON, and adds the SQL helpers that let a condition
-- compile to a WHERE clause instead of loading every contact into memory.

-- ------------------------------------------------------------ contacts (CT-09)
-- When the person signed up to the host app, from the identify token's
-- `createdAt`. Null when the app never said; "signed up" then falls back to
-- the first time HelpWell saw them.
ALTER TABLE helpwell.contacts ADD COLUMN IF NOT EXISTS signed_up_at timestamptz;
-- Where the consent state came from (identify | api | import | form | widget)
-- and when it was last set. Null while consent is still "unknown".
ALTER TABLE helpwell.contacts ADD COLUMN IF NOT EXISTS consent_source text;
ALTER TABLE helpwell.contacts ADD COLUMN IF NOT EXISTS consent_at timestamptz;

-- identify() used to store whatever string the token carried. Anything that is
-- not one of the three states is treated as not having said.
UPDATE helpwell.contacts SET consent = 'unknown'
  WHERE consent NOT IN ('unknown', 'granted', 'denied');
ALTER TABLE helpwell.contacts ADD CONSTRAINT contacts_consent_check
  CHECK (consent IN ('unknown', 'granted', 'denied'));

-- How the contact first reached HelpWell. Set once, never overwritten.
UPDATE helpwell.contacts SET source = 'widget'
  WHERE source NOT IN ('widget', 'identify', 'import', 'form', 'api');
ALTER TABLE helpwell.contacts ADD CONSTRAINT contacts_source_check
  CHECK (source IN ('widget', 'identify', 'import', 'form', 'api'));

-- Conditions such as "exported a CSV at least three times in the last week"
-- look events up by contact and name together.
CREATE INDEX IF NOT EXISTS events_contact_name_idx
  ON helpwell.events (contact_id, name, created_at DESC);

-- ------------------------------------------------------------ contact fields
-- One row per attribute key anyone has ever sent, plus HelpWell's own fields.
-- The type is inferred the first time a key appears and then only changes when
-- a person changes it, which locks it: a later identify call carrying a string
-- where a number used to be must not quietly turn "seats > 3" into a text
-- comparison.
CREATE TABLE helpwell.contact_fields (
  key           text PRIMARY KEY,
  label         text NOT NULL,
  -- text | number | boolean | date | list | url | money
  type          text NOT NULL DEFAULT 'text',
  -- app (identify) | helpwell (built in) | import | form | api
  source        text NOT NULL DEFAULT 'app',
  locked        boolean NOT NULL DEFAULT false,
  hidden        boolean NOT NULL DEFAULT false,
  -- The most recent value seen, so a person choosing a type can see one.
  sample        jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_fields_type_check
    CHECK (type IN ('text', 'number', 'boolean', 'date', 'list', 'url', 'money')),
  CONSTRAINT contact_fields_source_check
    CHECK (source IN ('app', 'helpwell', 'import', 'form', 'api'))
);

-- HelpWell's own fields, so a condition can say "signed up more than 30 days
-- ago" or "has the tag beta" the same way it says "plan is pro".
INSERT INTO helpwell.contact_fields (key, label, type, source, locked) VALUES
  ('email', 'Email', 'text', 'helpwell', true),
  ('name', 'Name', 'text', 'helpwell', true),
  ('signed_up', 'Signed up', 'date', 'helpwell', true),
  ('last_seen', 'Last seen', 'date', 'helpwell', true),
  ('identified', 'Identified', 'boolean', 'helpwell', true),
  ('tags', 'Tags', 'list', 'helpwell', true),
  ('source', 'Source', 'text', 'helpwell', true),
  ('consent', 'Consent', 'text', 'helpwell', true)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------ segments (CT-07)
-- A saved filter. `rules` is a condition group from core/src/conditions, the
-- same JSON engage targeting and forms use, so a segment is reusable anywhere
-- a condition is.
CREATE TABLE helpwell.segments (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  rules       jsonb NOT NULL DEFAULT '{"all": []}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX segments_name_key ON helpwell.segments (lower(name));

-- ---------------------------------------------------------------- webhooks
-- Retries without a worker: a failed delivery keeps the exact bytes it sent
-- and when to try again. Whatever runs next (a later webhook, the admin
-- route, `helpwell webhooks retry`) picks up whatever is due. A null
-- next_attempt_at means delivered, or given up on.
ALTER TABLE helpwell.webhook_deliveries ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE helpwell.webhook_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE helpwell.webhook_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS webhook_retry_idx
  ON helpwell.webhook_deliveries (next_attempt_at)
  WHERE next_attempt_at IS NOT NULL;

-- --------------------------------------------------- condition value helpers
-- Attribute values are whatever JSON the host app sent: "4" and 4, "true" and
-- true, an ISO string or epoch seconds. These read a jsonb value as one type,
-- and answer null rather than raising when it is not that type, so one odd
-- value cannot fail a segment count. core/src/conditions/values.ts implements
-- the same rules in JavaScript; the tests hold the two to the same answers.

CREATE OR REPLACE FUNCTION helpwell.hw_text(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(value) IN ('string', 'number', 'boolean')
    THEN value #>> '{}' END
$$;

CREATE OR REPLACE FUNCTION helpwell.hw_num(value jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  raw text;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) = 'number' THEN RETURN (value #>> '{}')::numeric; END IF;
  IF jsonb_typeof(value) <> 'string' THEN RETURN NULL; END IF;
  raw := value #>> '{}';
  -- "4", "-2.5", "1,200" and "$1,200.50" are numbers; "v2" and "4 seats" are not.
  IF raw !~ '^\s*[$€£]?\s*-?[0-9][0-9,]*(\.[0-9]+)?\s*$' THEN RETURN NULL; END IF;
  RETURN replace(regexp_replace(raw, '[\s$€£]', '', 'g'), ',', '')::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION helpwell.hw_time(value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  raw text;
  n numeric;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) = 'number' THEN
    n := (value #>> '{}')::numeric;
    -- Epoch seconds below 1e11, epoch milliseconds above it.
    IF abs(n) < 100000000000 THEN RETURN to_timestamp(n::double precision); END IF;
    RETURN to_timestamp((n / 1000)::double precision);
  END IF;
  IF jsonb_typeof(value) <> 'string' THEN RETURN NULL; END IF;
  raw := btrim(value #>> '{}');
  -- ISO 8601 only. A zone-less value is read as UTC, never as the session's
  -- zone, so the answer does not depend on the database server's settings.
  IF raw !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  IF raw ~ '^\d{4}-\d{2}-\d{2}$' THEN
    raw := raw || 'T00:00:00Z';
  ELSIF raw !~ '(Z|z|[+-]\d{2}(:?\d{2})?)$' THEN
    raw := raw || 'Z';
  END IF;
  RETURN raw::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION helpwell.hw_bool(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    jsonb_typeof(value) IN ('boolean', 'string', 'number')
      AND lower(btrim(value #>> '{}')) IN ('true', 'yes', '1'),
    false)
$$;

CREATE OR REPLACE FUNCTION helpwell.hw_list(value jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) = 'array' THEN ARRAY(
      SELECT e #>> '{}' FROM jsonb_array_elements(value) AS e
      WHERE jsonb_typeof(e) IN ('string', 'number', 'boolean'))
    WHEN jsonb_typeof(value) IN ('string', 'number', 'boolean') THEN ARRAY[value #>> '{}']
    ELSE ARRAY[]::text[]
  END
$$;

CREATE OR REPLACE FUNCTION helpwell.hw_empty(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT value IS NULL
    OR jsonb_typeof(value) = 'null'
    OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^\s*$')
    OR (jsonb_typeof(value) = 'array' AND jsonb_array_length(value) = 0)
    OR (jsonb_typeof(value) = 'object' AND value = '{}'::jsonb)
$$;
