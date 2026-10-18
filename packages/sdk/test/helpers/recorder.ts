/**
 * A fake `fetch` that remembers what it was asked to do.
 *
 * The SDK's whole job is turning a method call into one correct HTTP request,
 * so the tests assert on the request rather than on a mocked return value.
 * live.test.ts covers the other half — that a real server answers with what
 * the types say — so this stays a recorder, not a simulator.
 */

export interface RecordedCall {
  method: string;
  /** Path and query relative to the base URL, which is what the routes match on. */
  path: string;
  url: URL;
  headers: Record<string, string>;
  /** The parsed JSON body, or undefined when none was sent. */
  body: unknown;
}

export interface QueuedReply {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface Recorder {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
  /** Asserts exactly one call happened and returns it. */
  only(): RecordedCall;
  /** What the next request answers with. Unqueued requests get 200 `{}`. */
  reply(body: unknown, status?: number, headers?: Record<string, string>): void;
  /** Like `reply`, but the body goes out as-is rather than JSON-encoded. */
  replyText(body: string, status?: number, headers?: Record<string, string>): void;
}

export const BASE = 'https://app.example.com/api/helpwell';

export function recorder(): Recorder {
  const calls: RecordedCall[] = [];
  const queue: (QueuedReply & { raw?: boolean })[] = [];

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) headers[key] = value;

    calls.push({
      method: init?.method ?? 'GET',
      path: `${url.pathname.replace('/api/helpwell', '')}${url.search}`,
      url,
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const next = queue.shift() ?? { status: 200, body: {}, headers: {} };
    if (next.status === 204) return new Response(null, { status: 204, headers: next.headers });
    if (next.raw) {
      return new Response(String(next.body), {
        status: next.status,
        headers: { 'content-type': 'text/csv; charset=utf-8', ...next.headers },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  };

  return {
    fetch: fetchImpl,
    calls,
    only() {
      if (calls.length !== 1) {
        throw new Error(`Expected exactly one request, saw ${calls.length}.`);
      }
      return calls[0] as RecordedCall;
    },
    reply(body, status = 200, headers = {}) {
      queue.push({ status, body, headers });
    },
    replyText(body, status = 200, headers = {}) {
      queue.push({ status, body, headers, raw: true });
    },
  };
}
