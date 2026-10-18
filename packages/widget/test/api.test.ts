/**
 * The client's one hard part, cancellation, and the boot path's one promise:
 * that it never throws into the page.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/api.js';
import { boot } from '../src/index.js';
import { createFakeServer, flush } from './helpers/server.js';

/** A fetch that never answers, but does listen for its signal. */
function hanging(seen: { signal?: AbortSignal }): typeof globalThis.fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      seen.signal = signal;
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
}

describe('Api.request', () => {
  it("passes the caller's signal through and reports a cancellation as one", async () => {
    const seen: { signal?: AbortSignal } = {};
    const api = new Api({ baseUrl: '/api/helpwell', fetch: hanging(seen) });
    const controller = new AbortController();

    const pending = api.request('/conversations/x', { signal: controller.signal });
    expect(seen.signal?.aborted).toBe(false);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'ApiError', code: 'aborted', status: 0 });
    expect(seen.signal?.aborted).toBe(true);
  });

  it('still gives up on its own when a request stalls', async () => {
    const seen: { signal?: AbortSignal } = {};
    const api = new Api({ baseUrl: '/api/helpwell', fetch: hanging(seen), timeoutMs: 5 });
    const controller = new AbortController();

    await expect(api.request('/config', { signal: controller.signal })).rejects.toMatchObject({
      code: 'offline',
    });
    expect(controller.signal.aborted).toBe(false);
  });

  it('returns null rather than throwing for a 200 that is not JSON', async () => {
    const api = new Api({
      baseUrl: '/api/helpwell',
      fetch: async () => new Response('<!doctype html><p>Sign in</p>', { status: 200 }),
    });
    await expect(api.config()).resolves.toBeNull();
  });
});

describe('boot', () => {
  afterEach(() => {
    (window.helpwell as { widget?: { destroy(): void } } | undefined)?.widget?.destroy();
    delete (window as { helpwell?: unknown }).helpwell;
    document.body.textContent = '';
    vi.restoreAllMocks();
  });

  it('drains the queue, installs the dispatcher and announces itself', async () => {
    const server = createFakeServer();
    const ready = vi.fn();
    window.addEventListener('helpwell:ready', ready, { once: true });

    const queue = {
      q: [['init', { apiUrl: '/api/helpwell', fetch: server.fetch }], ['open']],
    } as unknown as NonNullable<Window['helpwell']>;

    const widget = await boot(queue);
    await flush();

    expect(widget).not.toBeNull();
    expect(widget?.store.state.open).toBe(true);
    expect(window.helpwell?.widget).toBe(widget);
    expect(window.helpwell?.q).toEqual([]);
    expect(ready).toHaveBeenCalledTimes(1);

    // The shim is now the real thing.
    window.helpwell?.('close');
    expect(widget?.store.state.open).toBe(false);
  });

  it('resolves to null instead of throwing when starting fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A number where a URL should be blows up inside the constructor.
    const queue = { q: [['init', { apiUrl: 42 }]] } as unknown as NonNullable<Window['helpwell']>;
    await expect(boot(queue)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
