import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { remoteMcpRequest } from '../src/http.js';

const tools = [
  {
    name: 'read_article',
    description: 'Read one article',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];
const request = (body: unknown, headers = {}) =>
  new Request('https://help.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
const options = () => ({
  authenticate: vi.fn(async () => ({ workspace: 'one' })),
  tools,
  allowedOrigins: ['https://help.test'],
  callTool: vi.fn(async (actor: { workspace: string }) => ({
    content: [{ type: 'text' as const, text: actor.workspace }],
  })),
});
describe('remote Streamable HTTP', () => {
  it('completes the official SDK initialization, tool listing and call lifecycle', async () => {
    const opts = options();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('https://help.test/mcp'), {
      fetch: async (input, init) => remoteMcpRequest(new Request(input, init), opts),
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toEqual(tools);
      const result = await client.callTool({ name: 'read_article', arguments: {} });
      expect(result.content).toEqual([{ type: 'text', text: 'one' }]);
    } finally {
      await client.close();
    }
  });
  it('lists only the tools the authenticated host exposes', async () => {
    const opts = options();
    const response = await remoteMcpRequest(
      request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      opts,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).result.tools).toEqual(tools);
    expect(opts.authenticate).toHaveBeenCalledOnce();
    expect(opts.callTool).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('carries each request’s own principal, without session sharing', async () => {
    const opts = options();
    opts.authenticate
      .mockResolvedValueOnce({ workspace: 'one' })
      .mockResolvedValueOnce({ workspace: 'two' });
    const call = () =>
      remoteMcpRequest(
        request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'read_article', arguments: {} },
        }),
        opts,
      );
    expect((await (await call()).json()).result.content[0].text).toBe('one');
    expect((await (await call()).json()).result.content[0].text).toBe('two');
  });
  it('never lists tools before authentication', async () => {
    const opts = options();
    const response = await remoteMcpRequest(
      request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      { ...opts, authenticate: async () => new Response(null, { status: 401 }) },
    );
    expect(response.status).toBe(401);
    expect(opts.callTool).not.toHaveBeenCalled();
  });
  it('rejects a cross-origin browser before authentication', async () => {
    const opts = options();
    expect(
      (await remoteMcpRequest(request({}, { origin: 'https://attacker.test' }), opts)).status,
    ).toBe(403);
    expect(opts.authenticate).not.toHaveBeenCalled();
  });
  it('rejects batch and oversized messages', async () => {
    expect((await remoteMcpRequest(request([]), options())).status).toBe(400);
    expect((await remoteMcpRequest(request({ value: 'x'.repeat(70_000) }), options())).status).toBe(
      413,
    );
  });
  it('refuses tools outside the allowlist', async () => {
    const opts = options();
    const response = await remoteMcpRequest(
      request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'delete_everything' },
      }),
      opts,
    );
    expect((await response.json()).result.isError).toBe(true);
    expect(opts.callTool).not.toHaveBeenCalled();
  });
  it('does not disclose provider errors', async () => {
    const opts = options();
    opts.callTool.mockRejectedValue(new Error('postgres://user:private-secret@host/db'));
    const response = await remoteMcpRequest(
      request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_article' } }),
      opts,
    );
    const text = await response.text();
    expect(text).not.toContain('private-secret');
    expect(text).toContain('isError');
  });
  it('chooses the tools per principal and identifies the server to hosts', async () => {
    const opts = {
      ...options(),
      authenticate: vi.fn(async () => ({ workspace: 'reader' })),
      tools: (actor: { workspace: string }) => (actor.workspace === 'reader' ? [] : tools),
      info: { title: 'Help desk', websiteUrl: 'https://help.test' },
      instructions: 'Start with list_products.',
    };
    const init = await remoteMcpRequest(
      request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
      opts,
    );
    const result = (await init.json()).result;
    expect(result.serverInfo).toMatchObject({ name: 'helpwell', title: 'Help desk' });
    expect(result.instructions).toBe('Start with list_products.');
    const listed = await remoteMcpRequest(
      request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      opts,
    );
    expect((await listed.json()).result.tools).toEqual([]);
    const called = await remoteMcpRequest(
      request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_article' } }),
      opts,
    );
    expect((await called.json()).result.isError).toBe(true);
    expect(opts.callTool).not.toHaveBeenCalled();
  });
  it('says why an unlisted tool is unavailable when the host knows', async () => {
    const opts = {
      ...options(),
      tools: [],
      unlistedTool: (_principal: unknown, name: string) =>
        name === 'read_article' ? 'Switched off for this connection.' : undefined,
    };
    const call = async (name: string) =>
      (
        await (
          await remoteMcpRequest(
            request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }),
            opts,
          )
        ).json()
      ).result;
    expect((await call('read_article')).content[0].text).toBe('Switched off for this connection.');
    expect((await call('delete_everything')).content[0].text).toBe('Unknown tool.');
    expect(opts.callTool).not.toHaveBeenCalled();
  });
});
