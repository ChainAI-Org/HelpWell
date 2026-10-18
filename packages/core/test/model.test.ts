import { describe, expect, it } from 'vitest';
import { OpenRouterModel } from '../src/agent.js';
import { type HelpWellError, isHelpWellError } from '../src/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenRouterModel', () => {
  it('constructs without a key and refuses each call instead, so the API can degrade', async () => {
    let calls = 0;
    const model = new OpenRouterModel({
      apiKey: '',
      fetch: async () => {
        calls++;
        return jsonResponse({});
      },
    });

    const error = (await model.chat({ model: 'm', messages: [] }).catch((e) => e)) as unknown;
    expect(isHelpWellError(error)).toBe(true);
    expect((error as HelpWellError).code).toBe('not_configured');
    await expect(model.embed({ model: 'm', input: ['x'] })).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(calls).toBe(0);
  });

  it('sends the key with a timeout signal, and only keeps tool arguments that are objects', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const model = new OpenRouterModel({
      apiKey: 'sk-test',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return jsonResponse({
          model: 'anthropic/claude-sonnet-4.5',
          choices: [
            {
              message: {
                content: 'Hi',
                tool_calls: [
                  { id: 'c1', function: { name: 'search_docs', arguments: '{"query":"export"}' } },
                  { id: 'c2', function: { name: 'read_changelog', arguments: '[1,2,3]' } },
                  { id: 'c3', function: { name: 'look_up_user', arguments: 'not json' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
        });
      },
    });

    const response = await model.chat({
      model: 'anthropic/claude-sonnet-4.5',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const first = seen[0]!;
    expect(first.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((first.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(first.init.signal).toBeInstanceOf(AbortSignal);
    expect(response.toolCalls.map((c) => c.arguments)).toEqual([{ query: 'export' }, {}, {}]);
    expect(response.wantsTools).toBe(true);
    expect(response.usage.costUsd).toBe(0.001);
  });

  it('gives up on a hung upstream, so the agent reaches its fallback', async () => {
    const model = new OpenRouterModel({
      apiKey: 'sk-test',
      timeoutMs: { chat: 20 },
      fetch: (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    });

    const error = (await model.chat({ model: 'm', messages: [] }).catch((e) => e)) as unknown;
    expect(isHelpWellError(error)).toBe(true);
    expect((error as HelpWellError).code).toBe('upstream_failed');
    expect((error as HelpWellError).message).toMatch(/did not answer/);
  });

  it('reports a rejected key as not_configured rather than as an outage', async () => {
    const model = new OpenRouterModel({
      apiKey: 'sk-bad',
      fetch: async () => jsonResponse({ error: { message: 'bad key' } }, 401),
    });
    await expect(model.embed({ model: 'm', input: ['x'] })).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('honours the caller’s own abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new OpenRouterModel({
      apiKey: 'sk-test',
      fetch: async (_url, init) => {
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return jsonResponse({});
      },
    });
    await expect(
      model.chat({ model: 'm', messages: [], signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'upstream_failed' });
  });
});
