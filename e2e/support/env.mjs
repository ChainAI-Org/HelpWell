/**
 * The environment every process the end-to-end suite starts runs with.
 *
 * Machines that run this suite often hold real keys: a developer's OpenRouter
 * key, a GitHub token. The playground switches to a live model the moment it
 * sees OPENROUTER_API_KEY, so a key left in the environment would turn a test
 * run into real API calls and real spend. The same rules as vitest.setup.ts
 * at the repo root: named keys, anything shaped like a key or a token, and
 * the database URLs the CLI would otherwise connect to.
 */

const SECRETS = [
  'OPENROUTER_API_KEY',
  'GITHUB_TOKEN',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'LEADFUZE_API_KEY',
];
const SECRET_SHAPE = /_(API_KEY|TOKEN|SECRET)$/i;
const DATABASES = ['HELPWELL_DATABASE_URL', 'DATABASE_URL'];

/** Whether a variable must never reach a process the suite starts. */
export function isSecret(name) {
  return SECRETS.includes(name) || SECRET_SHAPE.test(name) || DATABASES.includes(name);
}

/** A copy of `env` with every secret removed. */
export function withoutSecrets(env = process.env) {
  const clean = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isSecret(name)) clean[name] = value;
  }
  return clean;
}

/** Removes the secrets from this process's own environment, so children inherit none. */
export function stripSecrets(env = process.env) {
  for (const name of Object.keys(env)) {
    if (isSecret(name)) delete env[name];
  }
}
