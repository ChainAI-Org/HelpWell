import { describe, expect, it } from 'vitest';
import { HelpWellApiError, HelpWellClient } from '../src/index.js';
import { BASE } from './helpers/recorder.js';

/** A fetch that always answers the same way, whatever it is asked. */
function answering(body: BodyInit | null, init: ResponseInit): typeof globalThis.fetch {
  return async () => new Response(body, init);
}

function clientThatGets(fetchImpl: typeof globalThis.fetch, timeoutMs?: number): HelpWellClient {
  return new HelpWellClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs });
}

describe('mapping an error response', () => {
  it('carries the status, code and message the API sent', async () => {
    const client = clientThatGets(
      answering(JSON.stringify({ error: { code: 'not_found', message: 'No article there.' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(client.article('nope')).rejects.toMatchObject({
      name: 'HelpWellApiError',
      status: 404,
      code: 'not_found',
      message: 'No article there.',
    });
  });

  it('still produces a usable error when the body is not the error shape', async () => {
    const client = clientThatGets(answering('<html>502 Bad Gateway</html>', { status: 502 }));
    const error = await client.config().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HelpWellApiError);
    expect(error).toMatchObject({ status: 502, code: 'unknown' });
    expect((error as HelpWellApiError).message).toContain('502');
  });

  it('treats a 204 as success with nothing in it', async () => {
    const client = clientThatGets(answering(null, { status: 204 }));
    await expect(client.track('ping')).resolves.toBeUndefined();
  });

  it('maps an error on a text route the same way as on a JSON one', async () => {
    const client = new HelpWellClient({
      baseUrl: BASE,
      adminToken: 't',
      fetch: answering(JSON.stringify({ error: { code: 'unauthorized', message: 'No.' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(client.admin.exportReport()).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });
});

describe('when the request never reaches a server', () => {
  it('reports status 0 and names the base url it tried', async () => {
    const client = clientThatGets(() => Promise.reject(new TypeError('fetch failed')));
    await expect(client.config()).rejects.toMatchObject({ status: 0, code: 'network_error' });
    await expect(client.config()).rejects.toThrow(BASE);
  });

  it('aborts a stalled request and says how long it waited', async () => {
    const hanging: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const client = clientThatGets(hanging, 10);
    await expect(client.config()).rejects.toMatchObject({ status: 0, code: 'timeout' });
    await expect(client.config()).rejects.toThrow(/10ms/);
  });

  it('does not leave the timer running once the request is answered', async () => {
    // If the timeout were not cleared, an unref'd timer would keep the process
    // alive well past the test; resolving quickly under a long timeout is the
    // observable half of that.
    const client = clientThatGets(answering('{}', { status: 200 }), 60_000);
    await expect(client.config()).resolves.toEqual({});
  });
});

describe('deciding whether to retry', () => {
  it('says yes when the request never landed, was throttled, or the server broke', () => {
    for (const status of [0, 429, 500, 502, 503, 504]) {
      expect(new HelpWellApiError(status, 'x', 'x').retryable).toBe(true);
    }
  });

  it('says no when the caller is the problem', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(new HelpWellApiError(status, 'x', 'x').retryable).toBe(false);
    }
  });

  it('says no for 501, because a feature that is not configured stays that way', () => {
    expect(new HelpWellApiError(501, 'not_configured', 'No identity secret.').retryable).toBe(
      false,
    );
  });
});
