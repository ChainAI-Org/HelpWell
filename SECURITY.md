# Security

HelpWell runs inside your application and talks to your database, so we treat
security reports seriously and quickly.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
("Security" tab → "Report a vulnerability") rather than a public issue. You
will get an acknowledgement within three working days and a fix or a
mitigation as soon as one exists. Please give us a reasonable window before
disclosing.

## What is in scope

- The HTTP API, help center and dashboard handlers in `@helpwell/core`,
  `@helpwell/helpcenter` and `@helpwell/dashboard`
- The widget and its loader
- The CLI and the MCP server
- Anything that lets one visitor read or change another's data, bypass the
  host app's admin check, or make the agent act outside its documentation

## What the design already assumes

- Identity comes only from a token your server signed; an email address never
  merges or unlocks anything.
- Conversations, ratings and feedback can only be touched by the browser that
  owns them.
- Admin routes refuse cross-site requests and non-JSON bodies.
- Rate limits are keyed on the visitor cookie or the address, not on a header
  a caller can set.
- Webhook deliveries are signed (`x-helpwell-signature`, HMAC-SHA256).
- `DATABASE_URL` is never read; only `HELPWELL_DATABASE_URL`.

If you find a way around any of these, that is a vulnerability — please
report it.
