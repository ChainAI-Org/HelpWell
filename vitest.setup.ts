/**
 * The safety net every test file runs behind, in every package.
 *
 * Machines that run this suite often have real keys in their environment: a
 * developer's OpenRouter key, a GitHub token, a Stripe secret. A test that
 * forgets to stub one would spend real money, or leak data to a real
 * service, and nothing would say so. So before any test file loads, the keys
 * are taken out of `process.env`, and a request to the two services the code
 * under test knows how to reach fails loudly instead of going out.
 *
 * Tests that need a key set a fake one themselves; they run after this, so it
 * sticks. Tests that need OpenRouter or GitHub pass a fake model or a fake
 * `fetch`, as they always should have. Each package's `vitest.config.ts`
 * registers this file, so it applies whether the suite runs from the repo
 * root or from inside one package.
 */

/** Named outright, and anything shaped like a key or a token. */
const SECRETS = [
  'OPENROUTER_API_KEY',
  'GITHUB_TOKEN',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'LEADFUZE_API_KEY',
];
const SECRET_SHAPE = /_(API_KEY|TOKEN)$/i;
/**
 * Not keys, but just as dangerous: the CLI and the MCP server connect to
 * whatever database these name, and on a developer's machine that can be
 * production. Tests use PGlite.
 */
const DATABASES = ['HELPWELL_DATABASE_URL', 'DATABASE_URL'];

for (const name of Object.keys(process.env)) {
  if (SECRETS.includes(name) || SECRET_SHAPE.test(name) || DATABASES.includes(name)) {
    delete process.env[name];
  }
}

/** Hosts a test must never reach. Each has a fake in the code it would be called from. */
const REAL_SERVICES = ['openrouter.ai', 'api.github.com'];

function hostOf(input: unknown): string | null {
  try {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : typeof (input as { url?: unknown })?.url === 'string'
            ? (input as { url: string }).url
            : null;
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  const guarded = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const host = hostOf(input);
    const blocked = REAL_SERVICES.find(
      (service) => host === service || host?.endsWith(`.${service}`),
    );
    if (blocked) {
      throw new Error(
        `A test tried to reach ${host}, a real service. Pass a fake instead: FakeModel for ` +
          'OpenRouter, a stub fetch for GitHub (see vitest.setup.ts at the repo root).',
      );
    }
    return realFetch.call(globalThis, input, init);
  }) as typeof fetch;
  globalThis.fetch = guarded;
}
