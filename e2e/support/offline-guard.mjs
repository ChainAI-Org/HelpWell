/**
 * Keeps the playground server off the network while the suite drives it.
 *
 * Loaded into the server with `NODE_OPTIONS=--import`, before Next or
 * HelpWell run a line. The suite has stripped the keys already (env.mjs), but
 * a key is not the only way out: the bot check asks Cloudflare, and a form
 * asks DNS whether an email's domain takes mail. So:
 *
 * - `fetch` to anywhere but this machine throws, loudly, and says where it
 *   was going. A test that needs a real service is a test that is wrong.
 * - Cloudflare's siteverify is answered here, the way Cloudflare answers its
 *   published test secrets (1x… always passes, 2x… always fails, 3x… says
 *   the token was spent). The server under test still runs its real check;
 *   only the far end is stood in for.
 * - MX lookups answer with a made-up mail server, so a form's deliverability
 *   check passes without asking real DNS.
 */

import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's documented test secrets, and what each one answers. */
const TEST_SECRETS = {
  '1x0000000000000000000000000000000AA': { success: true, 'error-codes': [] },
  '2x0000000000000000000000000000000AA': {
    success: false,
    'error-codes': ['invalid-input-response'],
  },
  '3x0000000000000000000000000000000AA': {
    success: false,
    'error-codes': ['timeout-or-duplicate'],
  },
};

function say(message) {
  process.stderr.write(`[e2e offline guard] ${message}\n`);
}

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return typeof input?.url === 'string' ? input.url : '';
}

async function siteverify(init) {
  const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
  const secret = body.get('secret') ?? '';
  const answer = TEST_SECRETS[secret] ?? {
    success: false,
    'error-codes': ['invalid-input-secret'],
  };
  say(`siteverify answered locally: success=${answer.success}`);
  return new Response(JSON.stringify({ ...answer, hostname: 'localhost' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function guardedFetch(input, init) {
  const href = urlOf(input);
  if (href.startsWith(SITEVERIFY)) return siteverify(init);

  let host = '';
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    // A relative URL cannot leave the machine.
  }
  if (host && !LOCAL_HOSTS.has(host)) {
    say(`refused a request to ${host}`);
    throw new Error(
      `The end-to-end suite refused a request to ${host}: tests never reach real services.`,
    );
  }
  return realFetch.call(globalThis, input, init);
};

/** Every domain has a mail server, and nobody asked the internet. */
async function fakeResolveMx(domain) {
  return [{ exchange: `mx.${domain}`, priority: 10 }];
}
dns.promises.resolveMx = fakeResolveMx;
dns.resolveMx = (domain, callback) => {
  fakeResolveMx(domain).then((records) => callback(null, records), callback);
};
syncBuiltinESMExports();

say('active: outbound fetch refused, siteverify and MX answered locally');
