/**
 * The fetch every webhook delivery goes through, and the guard it has by default.
 *
 * A webhook URL is typed by whoever can edit Settings, and the server POSTs to
 * it, which makes it a server-side request forgery surface: point one at
 * `http://169.254.169.254/` or a database on the private network and HelpWell
 * would knock on it from inside. A URL that was fine when it was saved can
 * resolve somewhere else by the time it is sent to, so the check happens when
 * each delivery is sent, on the connection itself: https only, no private,
 * loopback or link-local address among the ones the name resolves to (checked
 * by the resolver the connection uses, so the DNS answer cannot change between
 * the check and the connect), and a redirect is never followed.
 *
 * Every send goes through one fetch: new events, retries and test deliveries,
 * from the API's routes, the agent, the indexer and the dashboard alike. A host
 * with its own egress rules passes `webhookFetch` and that is used instead.
 * Local development, where a webhook points at localhost, turns the guard off
 * with `webhookFetch: false` or HELPWELL_WEBHOOK_GUARD=off.
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isPrivateAddress, type LookupFunction, localName } from './api/status-page.js';
import type { WebhookOptions } from './webhooks.js';

/** `off` (or `false`, `0`, `no`) sends webhooks with no guard. For local development only. */
export const WEBHOOK_GUARD_ENV = 'HELPWELL_WEBHOOK_GUARD';

/** How much of a subscriber's answer is read. Nothing uses it beyond the status. */
const MAX_RESPONSE_BYTES = 64 * 1024;
/** A backstop for a connection nothing else times out. Deliveries set their own, shorter. */
const SOCKET_TIMEOUT_MS = 10_000;

const HOW_TO_TURN_OFF = `For local development, set ${WEBHOOK_GUARD_ENV}=off or pass webhookFetch: false.`;

/**
 * A delivery the guard would not send. Recorded as the delivery's error, and
 * never retried: the same URL would be refused the same way.
 */
export class WebhookRefusedError extends Error {
  readonly code = 'EWEBHOOKREFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'WebhookRefusedError';
  }
}

/**
 * Why the guard refuses a URL before anything is resolved, or null when it
 * gets as far as DNS: not a URL, not https, a name that only means something
 * on the local network, or an address that is private on its face. Also
 * useful when a URL is saved, though the send-time check is the one that counts.
 */
export function checkWebhookUrl(url: string | URL): string | null {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return 'Webhook guard: that is not a URL.';
  }
  if (parsed.protocol !== 'https:') {
    return `Webhook guard: webhooks are only sent over https. ${HOW_TO_TURN_OFF}`;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? isPrivateAddress(host) : localName(host)) {
    return `Webhook guard: ${host} is not a public address. ${HOW_TO_TURN_OFF}`;
  }
  return null;
}

export interface WebhookGuardOptions {
  /** The resolver the connection uses. Swap it in tests; what it answers is still checked. */
  lookup?: LookupFunction;
}

/**
 * A fetch that only ever connects to public https addresses: the built-in
 * guard. It speaks enough of fetch for a webhook (a method, headers, a body,
 * a signal) and answers with a real `Response`; a redirect comes back as the
 * 3xx it is, never followed.
 */
export function guardedWebhookFetch(options: WebhookGuardOptions = {}): typeof fetch {
  const lookup = refusingLookup(options.lookup ?? (dnsLookup as LookupFunction));

  return (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const target = input instanceof Request ? input.url : String(input);
    const problem = checkWebhookUrl(target);
    if (problem) throw new WebhookRefusedError(problem);
    const url = new URL(target);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
    const body = await bodyBytes(init.body);
    if (body) headers.set('content-length', String(body.byteLength));
    const signal = init.signal ?? undefined;

    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const request = httpsRequest(
        url,
        {
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers),
          lookup: lookup as never,
          timeout: SOCKET_TIMEOUT_MS,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            // Past the cap the rest is dropped; the status is what matters.
            if (size >= MAX_RESPONSE_BYTES) return;
            size += chunk.length;
            chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              resolve(toResponse(response.statusCode ?? 0, response.headers, chunks));
            } catch (error) {
              reject(error);
            }
          });
          response.on('error', reject);
        },
      );
      const onAbort = () => request.destroy(abortReason(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      request.on('close', () => signal?.removeEventListener('abort', onAbort));
      request.on('timeout', () => request.destroy(new Error('The webhook endpoint timed out.')));
      request.on('error', reject);
      request.end(body);
    });
  }) as typeof fetch;
}

/** The plain global fetch, looked up when called so a test's stand-in is the one used. */
const plainFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

let sharedGuard: typeof fetch | null = null;

/** Whether an environment turns the guard off. */
export function webhookGuardOff(env: Record<string, string | undefined>): boolean {
  return /^(off|false|0|no)$/i.test(env[WEBHOOK_GUARD_ENV]?.trim() ?? '');
}

/**
 * What a delivery is sent with when nobody said: the built-in guard, or the
 * plain fetch when the environment turns the guard off.
 */
export function defaultWebhookFetch(
  env: Record<string, string | undefined> = process.env,
): typeof fetch {
  if (webhookGuardOff(env)) return plainFetch;
  sharedGuard ??= guardedWebhookFetch();
  return sharedGuard;
}

/** The part of an install's config that decides how its webhooks are sent. */
export interface WebhookFetchConfig {
  /** The install's own fetch, or `false` for none of the guard. See `HelpWellConfig.webhookFetch`. */
  webhookFetch?: typeof fetch | false;
  /** Where HELPWELL_WEBHOOK_GUARD is read. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** The fetch an install's deliveries go through: its own, the plain one, or the guard. */
export function webhookFetchFor(config: WebhookFetchConfig): typeof fetch {
  if (typeof config.webhookFetch === 'function') return config.webhookFetch;
  if (config.webhookFetch === false) return plainFetch;
  return defaultWebhookFetch(config.env ?? process.env);
}

/** The options every send for this install passes to `emitWebhooks` and friends. */
export function webhookOptionsFor(config: WebhookFetchConfig): WebhookOptions {
  return { fetch: webhookFetchFor(config) };
}

/* ---------------------------------------------------------------- helpers */

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A resolver that fails when any address the name resolves to is private.
 * Handed to the connection as its `lookup`, so the address checked is the
 * address it connects to.
 */
function refusingLookup(lookup: LookupFunction): LookupFunction {
  return (hostname, options, callback: LookupCallback) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family);
      const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
      if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a))) {
        const refused = new WebhookRefusedError(
          `Webhook guard: ${hostname} resolves to a private address. ${HOW_TO_TURN_OFF}`,
        );
        return callback(refused as unknown as NodeJS.ErrnoException, address, family);
      }
      callback(null, address, family);
    });
  };
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  // Anything else fetch accepts (a Blob, form data, a stream) is read the way fetch would.
  return Buffer.from(await new Response(body).arrayBuffer());
}

function toResponse(status: number, headers: IncomingHttpHeaders, chunks: Buffer[]): Response {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) out.append(key, item);
  }
  // A Response takes no body with these, and refuses a status outside 200-599.
  const empty = status === 204 || status === 205 || status === 304;
  if (status < 200 || status > 599) throw new Error(`The webhook endpoint answered ${status}.`);
  return new Response(empty ? null : new Uint8Array(Buffer.concat(chunks)), {
    status,
    headers: out,
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}
