-- What a support extension needs HelpWell to remember between requests.
--
-- 1. `support_retries` is a small durable queue for extension calls that must
--    not be lost when the extension is briefly unreachable: mirroring a
--    conversation after a reply (`afterReply`), read receipts, and form
--    submissions. One row per piece of work, keyed so a conversation that
--    fails five times in a row is still one row. A row is claimed by pushing
--    `next_attempt_at` forward (a lease) rather than by holding a transaction
--    open, because the call it makes can take seconds and the embedded
--    database has a single connection. Rows are deleted once they succeed or
--    run out of attempts.
--
-- 2. `proactive_deliveries` records the chat messages and engagements a
--    support extension asked HelpWell to show a visitor. It is what lets a
--    reply prove it answers a message that visitor was actually shown, keeps
--    a dismissed message from coming back, and reports each seen, clicked and
--    dismissed to the extension once rather than on every page view.

CREATE TABLE IF NOT EXISTS helpwell.support_retries (
  kind            text NOT NULL,
  key             text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS support_retries_due_idx
  ON helpwell.support_retries (next_attempt_at);

CREATE TABLE IF NOT EXISTS helpwell.proactive_deliveries (
  contact_id   text NOT NULL,
  item_id      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('chat', 'engagement')),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  seen_at      timestamptz,
  clicked_at   timestamptz,
  dismissed_at timestamptz,
  replied_at   timestamptz,
  -- The conversation a reply to this item started, so a mirror can say so.
  conversation_id text,
  PRIMARY KEY (contact_id, item_id)
);

CREATE INDEX IF NOT EXISTS proactive_deliveries_delivered_idx
  ON helpwell.proactive_deliveries (delivered_at);

CREATE INDEX IF NOT EXISTS proactive_deliveries_conversation_idx
  ON helpwell.proactive_deliveries (conversation_id)
  WHERE conversation_id IS NOT NULL;
