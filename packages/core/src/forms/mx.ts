/**
 * Does the email's domain accept mail? One DNS question: its MX records.
 *
 * A typo (`gmial.com`) and a made-up domain both fail it, which is most of
 * the value of checking an address without sending anything to it. The
 * resolver is injectable (`createHelpWellHandler({ forms: { resolveMx } })`)
 * for tests and for runtimes without Node's `dns` module; where there is
 * none, the check is skipped rather than failed. Answers are cached for an
 * hour per domain, so a burst of sign-ups from one company costs one lookup.
 */

/** The mail servers for a domain, or an empty list when it has none. Rejects when DNS fails. */
export type MxResolver = (domain: string) => Promise<string[]>;

/** `ok`: has a mail server. `none`: has none. `unchecked`: no resolver. `error`: DNS failed. */
export type MxResult = 'ok' | 'none' | 'unchecked' | 'error';

const TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 1000;
const TIMEOUT_MS = 3000;

const cache = new Map<string, { result: MxResult; at: number }>();

/** Node's resolver, loaded lazily so a browser or edge bundle never pulls `node:dns` in. */
async function nodeResolver(): Promise<MxResolver | null> {
  try {
    const dns = await import('node:dns');
    return async (domain) => {
      try {
        const records = await dns.promises.resolveMx(domain);
        return records.map((record) => record.exchange).filter(Boolean);
      } catch (error) {
        // "No such domain" and "no MX records" are answers, not failures.
        const code = (error as { code?: string }).code;
        if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENOTIMP') return [];
        throw error;
      }
    };
  } catch {
    return null;
  }
}

let defaultResolver: Promise<MxResolver | null> | null = null;

export async function checkMx(domain: string, resolver?: MxResolver | null): Promise<MxResult> {
  const clean = domain.trim().toLowerCase();
  if (!clean.includes('.')) return 'none';

  const cached = cache.get(clean);
  if (cached && Date.now() - cached.at < TTL_MS && !resolver) return cached.result;

  if (resolver === undefined) defaultResolver ??= nodeResolver();
  const resolve = resolver === undefined ? await defaultResolver : resolver;
  if (!resolve) return 'unchecked';

  let result: MxResult;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolve(clean),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MX lookup timed out')), TIMEOUT_MS);
      }),
    ]);
    result = records.length > 0 ? 'ok' : 'none';
  } catch {
    result = 'error';
  } finally {
    clearTimeout(timer);
  }

  // An injected resolver is a test's or a host's own, and its answers are not
  // shared with the default one's cache.
  if (!resolver && result !== 'error') {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
    cache.set(clean, { result, at: Date.now() });
  }
  return result;
}
