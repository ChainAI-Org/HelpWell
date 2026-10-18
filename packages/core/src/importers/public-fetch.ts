/**
 * The fetch an import run on a server reads the web with.
 *
 * `helpwell import` runs on someone's own machine and fetches whatever their
 * export links to. The same importers run inside a hosted dashboard read
 * addresses a stranger typed or an uploaded file named, which makes every
 * fetch a server-side request forgery surface: a crawl of
 * `http://169.254.169.254/` or an "image" on the private network would be
 * read from inside. So on a server they go through this: GET only, https
 * only, no private, loopback or link-local address among those a name
 * resolves to (checked by the resolver the connection itself uses), every
 * redirect checked the same way before it is followed, a time limit, and a
 * size limit that stops reading rather than buffering a huge answer.
 */

import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  guardedLookup,
  isPrivateAddress,
  type LookupFunction,
  localName,
} from '../api/status-page.js';

export interface PublicFetchOptions {
  /** The most one answer may be. Default 25 MB. */
  maxBytes?: number;
  /** How long one request may take, redirects included. Default 30 seconds. */
  timeoutMs?: number;
  /** How many redirects are followed. Default 5. */
  maxRedirects?: number;
  /** Swap the resolver, for tests. What it answers is still checked. */
  lookup?: LookupFunction;
}

/** Why a URL is refused before anything is resolved, or null. */
function problem(url: URL): string | null {
  if (url.protocol !== 'https:') return 'Only https:// addresses are read.';
  if (url.username || url.password) return 'An address with a password in it is not read.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? isPrivateAddress(host) : localName(host)) {
    return `${host} is not a public address.`;
  }
  return null;
}

/** A fetch that only ever reads public https addresses. See the module comment. */
export function publicFetch(options: PublicFetchOptions = {}): typeof fetch {
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const lookup = guardedLookup(options.lookup);

  const once = (url: URL, headers: Headers, signal: AbortSignal): Promise<Response> =>
    new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: 'GET',
          headers: Object.fromEntries(headers),
          lookup: lookup as never,
          timeout: timeoutMs,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const out = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            for (const item of Array.isArray(value) ? value : [value]) out.append(key, item);
          }
          if (status >= 300 && status < 400) {
            response.resume();
            resolve(new Response(null, { status, headers: out }));
            return;
          }
          if (Number(out.get('content-length') ?? 0) > maxBytes) {
            request.destroy(new Error('That answer is too large to read.'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              request.destroy(new Error('That answer is too large to read.'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            if (status < 200 || status > 599) {
              reject(new Error(`The server answered ${status}.`));
              return;
            }
            const empty = status === 204 || status === 205 || status === 304;
            resolve(
              new Response(empty ? null : new Uint8Array(Buffer.concat(chunks)), {
                status,
                headers: out,
              }),
            );
          });
          response.on('error', reject);
        },
      );
      const onAbort = () => request.destroy(new Error('The request was cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
      request.on('close', () => signal.removeEventListener('abort', onAbort));
      request.on('timeout', () =>
        request.destroy(new Error('The server took too long to answer.')),
      );
      request.on('error', reject);
      request.end();
    });

  return (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (init.method && init.method.toUpperCase() !== 'GET') {
      throw new Error('Only GET requests are made while importing.');
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    init.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      let url = new URL(input instanceof Request ? input.url : String(input));
      for (let hop = 0; ; hop++) {
        const refused = problem(url);
        if (refused) throw new Error(refused);
        const response = await once(url, headers, controller.signal);
        const location = response.headers.get('location');
        if (response.status < 300 || response.status >= 400 || !location) return response;
        if (init.redirect === 'manual' || init.redirect === 'error') return response;
        if (hop >= maxRedirects) throw new Error('Too many redirects.');
        url = new URL(location, url);
      }
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}
