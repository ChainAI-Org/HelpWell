/**
 * The model picker's catalogue route and the API's security headers.
 *
 * `GET /admin/models` reads OpenRouter's list with the install's own key.
 * Nothing here calls OpenRouter: every test hands the handler a fake fetch,
 * and passes `env: {}` so the machine's own key is never picked up.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHelpWellHandler,
  frameAncestorsDirective,
  MODEL_LIST_TTL_MS,
  type ModelList,
  OPENROUTER_MODELS_URL,
  resolveSecurityHeaders,
} from '../src/api.js';
import { createDb, type DbHandle, migrate } from '../src/db.js';
import { defaultSettings } from '../src/settings.js';

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ url: 'pglite://memory' });
  await migrate(handle.db);
});

afterAll(async () => {
  await handle.close();
});

const CATALOGUE = {
  data: [
    {
      id: 'acme/old-model',
      name: 'Acme: Old',
      created: 1_700_000_000,
      context_length: 32_000,
      pricing: { prompt: '0.000001', completion: '0.000002' },
      architecture: { output_modalities: ['text'] },
      supported_parameters: ['tools', 'temperature'],
    },
    {
      id: 'acme/new-model',
      name: 'Acme: New',
      created: 1_790_000_000,
      context_length: 1_000_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: { output_modalities: ['text'] },
      supported_parameters: ['temperature'],
    },
    {
      id: 'acme/painter',
      name: 'Acme: Painter',
      created: 1_795_000_000,
      pricing: { prompt: '0', completion: '0' },
      architecture: { output_modalities: ['image'] },
    },
    { id: 'not an id', name: 'Broken' },
    'nonsense',
  ],
};

const EMBEDDINGS = {
  data: [
    {
      id: 'acme/embed-small',
      name: 'Acme: Embed',
      created: 1_780_000_000,
      context_length: 8192,
      pricing: { prompt: '0.00000002', completion: '0' },
      architecture: { output_modalities: ['embeddings'] },
    },
  ],
};

function fakeFetch(answer: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return answer(url);
  }) as typeof fetch;
  return { fetcher, calls };
}

function handlerWith(options: {
  key?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  admin?: boolean;
  securityHeaders?: Parameters<typeof createHelpWellHandler>[0]['securityHeaders'];
}) {
  return createHelpWellHandler({
    db: handle.db,
    basePath: '/api/helpwell',
    env: {},
    openRouterKey: options.key,
    modelsFetch: options.fetcher,
    now: options.now,
    isAdmin: () => options.admin ?? true,
    securityHeaders: options.securityHeaders,
  });
}

async function models(handler: ReturnType<typeof handlerWith>, kind = 'chat'): Promise<ModelList> {
  const response = await handler(
    new Request(`http://localhost/api/helpwell/admin/models?kind=${kind}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ModelList;
}

describe('GET /admin/models', () => {
  it('says there is no list without a key, and calls nobody', async () => {
    const { fetcher, calls } = fakeFetch(() => Response.json(CATALOGUE));
    const list = await models(handlerWith({ fetcher }));
    expect(list).toMatchObject({ available: false, reason: 'no_key', models: [] });
    expect(calls).toEqual([]);
  });

  it('lists chat models newest first, with price per million, context and tool support', async () => {
    const { fetcher, calls } = fakeFetch(() => Response.json(CATALOGUE));
    const list = await models(handlerWith({ key: 'sk-or-test', fetcher }));
    expect(calls).toEqual([{ url: OPENROUTER_MODELS_URL, auth: 'Bearer sk-or-test' }]);
    expect(list.available).toBe(true);
    // The image model and the malformed entries are left out.
    expect(list.models.map((m) => m.id)).toEqual(['acme/new-model', 'acme/old-model']);
    expect(list.models[0]).toEqual({
      id: 'acme/new-model',
      name: 'Acme: New',
      created: new Date(1_790_000_000 * 1000).toISOString(),
      contextLength: 1_000_000,
      pricing: { prompt: 3, completion: 15 },
      tools: false,
    });
    expect(list.models[1]?.tools).toBe(true);
    // The key is never part of the answer.
    expect(JSON.stringify(list)).not.toContain('sk-or-test');
  });

  it('asks OpenRouter for embedding models when the picker wants those', async () => {
    const { fetcher, calls } = fakeFetch((url) =>
      Response.json(url.includes('embeddings') ? EMBEDDINGS : CATALOGUE),
    );
    const list = await models(handlerWith({ key: 'k', fetcher }), 'embeddings');
    expect(calls[0]?.url).toBe(`${OPENROUTER_MODELS_URL}?output_modalities=embeddings`);
    expect(list.models.map((m) => m.id)).toEqual(['acme/embed-small']);
    expect(list.models[0]?.pricing.prompt).toBe(0.02);
  });

  it('keeps the list for ten minutes, then reads it again', async () => {
    let now = new Date('2026-09-23T10:00:00Z');
    const { fetcher, calls } = fakeFetch(() => Response.json(CATALOGUE));
    const handler = handlerWith({ key: 'k', fetcher, now: () => now });
    await models(handler);
    now = new Date(now.getTime() + MODEL_LIST_TTL_MS - 1000);
    await models(handler);
    expect(calls).toHaveLength(1);
    now = new Date(now.getTime() + 2000);
    await models(handler);
    expect(calls).toHaveLength(2);
    // Chat and embeddings are cached apart.
    await models(handler, 'embeddings');
    expect(calls).toHaveLength(3);
  });

  it('says OpenRouter could not be reached, and does not ask again at once', async () => {
    let now = new Date('2026-09-23T10:00:00Z');
    const { fetcher, calls } = fakeFetch(() => new Response('down', { status: 503 }));
    const handler = handlerWith({ key: 'k', fetcher, now: () => now });
    expect(await models(handler)).toMatchObject({ available: false, reason: 'unreachable' });
    await models(handler);
    expect(calls).toHaveLength(1);
    now = new Date(now.getTime() + 61_000);
    await models(handler);
    expect(calls).toHaveLength(2);

    const throwing = fakeFetch(() => {
      throw new Error('offline');
    });
    expect(await models(handlerWith({ key: 'k', fetcher: throwing.fetcher }))).toMatchObject({
      available: false,
      reason: 'unreachable',
    });
  });

  it('is for admins only, and refuses an unknown kind', async () => {
    const { fetcher } = fakeFetch(() => Response.json(CATALOGUE));
    const locked = handlerWith({ key: 'k', fetcher, admin: false });
    const response = await locked(new Request('http://localhost/api/helpwell/admin/models'));
    expect(response.status).toBe(401);

    const open = handlerWith({ key: 'k', fetcher });
    const bad = await open(new Request('http://localhost/api/helpwell/admin/models?kind=audio'));
    expect(bad.status).toBe(400);
  });
});

describe('model defaults', () => {
  it('ships current OpenRouter models, with the fallback from another provider', () => {
    const models = defaultSettings().agent.models;
    expect(models.chat).toBe('anthropic/claude-sonnet-5');
    expect(models.docs).toBe('anthropic/claude-sonnet-5');
    expect(models.fallback).toBe('google/gemini-3.5-flash');
    expect(models.fallback.split('/')[0]).not.toBe(models.chat.split('/')[0]);
  });
});

describe('API security headers', () => {
  it('sends nosniff and a referrer policy on routes, errors and health', async () => {
    const handler = handlerWith({});
    for (const path of ['/api/helpwell/health', '/api/helpwell/nope', '/api/helpwell/config']) {
      const response = await handler(new Request(`http://localhost${path}`));
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
    }
  });

  it('lets the host replace one, drop one, or send none', async () => {
    const custom = handlerWith({
      securityHeaders: { 'referrer-policy': 'no-referrer', 'X-Content-Type-Options': null },
    });
    const response = await custom(new Request('http://localhost/api/helpwell/health'));
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBeNull();

    const none = handlerWith({ securityHeaders: false });
    const bare = await none(new Request('http://localhost/api/helpwell/health'));
    expect(bare.headers.get('referrer-policy')).toBeNull();
  });

  it('refuses a header value that would split the response', () => {
    expect(resolveSecurityHeaders({}, { 'x-test': 'a\r\nset-cookie: x=1' })).toEqual({});
    expect(resolveSecurityHeaders({}, { 'bad name': 'x' })).toEqual({});
  });

  it('writes frame-ancestors from a list, dropping anything that would end the directive', () => {
    expect(frameAncestorsDirective(["'self'", 'https://app.acme.com'])).toBe(
      "frame-ancestors 'self' https://app.acme.com",
    );
    expect(frameAncestorsDirective([])).toBe("frame-ancestors 'none'");
    expect(frameAncestorsDirective(["'self'; script-src *"])).toBe("frame-ancestors 'none'");
  });
});

describe('GET /config', () => {
  it('tells the widget who answers and how updates are grouped', async () => {
    const response = await handlerWith({})(new Request('http://localhost/api/helpwell/config'));
    const config = (await response.json()) as {
      agent: { name: string; avatarUrl: string | null };
      changelog: { groupBy: string };
    };
    expect(config.agent).toEqual({ name: 'Fern', avatarUrl: null });
    expect(config.changelog.groupBy).toBe('version');
  });
});
