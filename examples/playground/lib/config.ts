/**
 * Server-only configuration: the repo paths HelpWell reads, the identity
 * secret, and the person the demo signs in as.
 *
 * Kept apart from lib/paths.ts because this module touches `node:path` and
 * `process.env`, neither of which belongs in a client bundle.
 */

import { join } from 'node:path';

/* ---------------------------------------------------------------- the repo */

/**
 * Ridgeline's own docs, in Ridgeline's own repo. HelpWell reads Markdown from
 * here and never keeps a second copy of it.
 */
export const DOCS_DIR = join(process.cwd(), 'helpwell', 'docs');
export const INSTRUCTIONS_FILE = join(process.cwd(), 'helpwell', 'instructions.md');
/** House rules the agent reads beside its instructions; edited on the dashboard's Playbook page. */
export const PLAYBOOK_FILE = join(process.cwd(), 'helpwell', 'playbook.md');
/** The questions the dashboard's Evals page replays, the same file `helpwell eval` reads. */
export const EVALS_FILE = join(process.cwd(), 'helpwell', 'evals.json');

/* ------------------------------------------------------------ the demo user */

/**
 * The person the "Sign in as Ada" toggle signs in as. These become the claims
 * inside the identify token. Everything that is not a reserved claim — id,
 * email, name, avatarUrl, consent, locale, timezone, createdAt — ends up in the
 * contact's `attributes`, which is what the dashboard shows beside their name.
 */
export const ADA = {
  id: 'usr_ada_okafor',
  email: 'ada@northwind.example',
  name: 'Ada Okafor',
  plan: 'Business',
  role: 'Admin',
  workspace: 'Northwind Labs',
  seats: 48,
  cardFeed: 'Amex Business',
  accounting: 'Xero',
  consent: 'granted',
  locale: 'en',
  timezone: 'Europe/London',
} as const;

/* -------------------------------------------------------------- environment */

/**
 * A real install puts a random value in HELPWELL_IDENTITY_SECRET and keeps it
 * out of the repo (see .env.example). This fallback exists only so the
 * identified path works with no .env.local at all.
 */
const DEV_IDENTITY_SECRET = 'ridgeline-playground-identity-secret-do-not-ship';
export const identitySecret = process.env.HELPWELL_IDENTITY_SECRET ?? DEV_IDENTITY_SECRET;

/** No key, no model: the playground scripts one instead. See lib/helpwell.ts. */
export const offline = !process.env.OPENROUTER_API_KEY;

/**
 * Other sites allowed to run the widget against this API, as comma-separated
 * origins. Empty by default, because Ridgeline's widget is same-origin. The
 * end-to-end suite sets it to load the widget from a second origin, which is
 * how a marketing site on another domain would embed it.
 */
export const corsOrigins = (process.env.HELPWELL_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
