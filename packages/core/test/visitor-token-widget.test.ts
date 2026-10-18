/**
 * The widget's client against the real API, across sites: the API's cookies
 * are never delivered (Safari's third-party cookie blocking, done by simply
 * dropping them), so the only thing that can hold the visitor together is
 * the header token. The client is the widget's own, from its source.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError } from '../../widget/src/api.js';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler, type HelpWellHandler, signIdentity } from '../src/api.js';
import { createDb, type DbHandle, migrate } from '../src/db.js';

const API = 'https://api.hosted.example/p/acme/api';

let handle: DbHandle;
let handler: HelpWellHandler;

beforeEach(async () => {
  // Each client below is its own browser, so none may share a storage.
  vi.stubGlobal('localStorage', undefined);
  handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
  handler = createHelpWellHandler({
    db: handle.db,
    basePath: '/p/acme/api',
    model: new FakeModel(() => ({ text: 'Open Billing, then Export.' })),
    identitySecret: 'identity-secret',
    corsOrigins: ['https://www.acme.example'],
    env: {},
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await handle.close();
});

/** A browser on another site: requests go out with no cookies, whatever was set. */
function crossSiteFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('cookie');
    headers.set('origin', 'https://www.acme.example');
    return handler(new Request(String(input), { ...init, headers }));
  };
}

describe('the widget client and the API, on different sites', () => {
  it('keeps one visitor and their conversation with no cookies at all', async () => {
    const api = new Api({ baseUrl: API, fetch: crossSiteFetch(), visitorToken: true });
    await api.config();
    const first = await api.chat({ message: 'How do I export?' });
    await api.chat({ message: 'And then?', conversationId: first.conversationId });

    const thread = await api.conversation(first.conversationId);
    expect(thread.messages).toHaveLength(4);
    expect((await api.conversations()).items.map((c) => c.id)).toEqual([first.conversationId]);

    // Another browser, with its own token, cannot read it.
    const stranger = new Api({ baseUrl: API, fetch: crossSiteFetch(), visitorToken: true });
    await stranger.chat({ message: 'Hello' });
    await expect(stranger.conversation(first.conversationId)).rejects.toBeInstanceOf(ApiError);
  });

  it('carries identify over, and starts clean after reset', async () => {
    const api = new Api({ baseUrl: API, fetch: crossSiteFetch(), visitorToken: true });
    const { conversationId } = await api.chat({ message: 'Before signing in' });
    const signedIn = await api.identify(await signIdentity({ id: 'user_1' }, 'identity-secret'));
    expect(signedIn.identified).toBe(true);
    // The anonymous visitor became the signed-in contact, history and all.
    expect((await api.conversation(conversationId)).messages.length).toBeGreaterThan(0);

    await api.resetVisitor();
    expect((await api.conversations()).items).toEqual([]);
    await expect(api.conversation(conversationId)).rejects.toMatchObject({ status: 403 });
  });

  it('without the token, the same browser is a stranger on every call', async () => {
    const api = new Api({ baseUrl: API, fetch: crossSiteFetch(), visitorToken: false });
    const { conversationId } = await api.chat({ message: 'Hello' });
    await expect(api.conversation(conversationId)).rejects.toMatchObject({ status: 403 });
  });
});
