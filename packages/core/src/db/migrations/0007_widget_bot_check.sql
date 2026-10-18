-- A conversation proves its visitor is human once.
--
-- With a bot check switched on (Cloudflare Turnstile), the first message of a
-- conversation carries a challenge token and the server verifies it. The
-- moment it passes is recorded here, so later messages, and the email the
-- visitor leaves on the same thread, do not each need a challenge of their
-- own. NULL means never verified: either the check was off when the
-- conversation started, or it has not passed yet.

ALTER TABLE helpwell.conversations ADD COLUMN IF NOT EXISTS bot_verified_at timestamptz;
