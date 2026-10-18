/**
 * A tiny browser: calls the handler and keeps the cookies it is given, so a
 * test can be "the same visitor" across requests, or deliberately not.
 */

import type { HelpWellHandler } from '../../src/api.js';

export type CallInit = Omit<RequestInit, 'body'> & {
  /** Send this as JSON, with the content type the API insists on. */
  body?: unknown;
  /** Raw body and content type, for tests about the content type itself. */
  raw?: { body: string; type: string };
};

export interface Client {
  call(path: string, init?: CallInit): Promise<Response>;
  /** The cookie pairs this client is holding. */
  jar: string[];
  /** Forget everything, as a new browser would. */
  reset(): void;
}

export function client(
  handler: HelpWellHandler,
  options: { base?: string; adminToken?: string; ip?: string } = {},
): Client {
  const base = options.base ?? 'http://localhost/api/helpwell';
  let jar: string[] = [];

  return {
    get jar() {
      return jar;
    },
    reset() {
      jar = [];
    },
    async call(path, init = {}) {
      const { body, raw, ...rest } = init;
      // A body means a POST unless the test says otherwise; fetch refuses a GET with one.
      if ((body !== undefined || raw) && !rest.method) rest.method = 'POST';
      const headers = new Headers(rest.headers);
      const cookies = [...jar];
      if (options.adminToken) cookies.push(`hw_admin=${options.adminToken}`);
      if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
      if (options.ip) headers.set('x-forwarded-for', options.ip);

      let payload: string | undefined;
      if (raw) {
        headers.set('content-type', raw.type);
        payload = raw.body;
      } else if (body !== undefined) {
        headers.set('content-type', 'application/json');
        payload = JSON.stringify(body);
      }

      const response = await handler(
        new Request(`${base}${path}`, { ...rest, headers, body: payload }),
      );

      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0] ?? '';
        const name = pair.split('=')[0] ?? '';
        const expired = /max-age=0/i.test(cookie);
        jar = jar.filter((c) => !c.startsWith(`${name}=`));
        if (!expired && pair.split('=')[1]) jar.push(pair);
      }
      return response;
    },
  };
}
