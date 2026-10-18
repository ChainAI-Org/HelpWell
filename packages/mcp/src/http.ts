import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  type Implementation,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { SERVER_NAME, SERVER_VERSION } from './server.js';

export type RemoteMcpTool = Tool & { securitySchemes?: { type: 'oauth2'; scopes: string[] }[] };
export type RemoteMcpResult = CallToolResult;

/**
 * A stateless Streamable HTTP adapter for hosts with their own authentication.
 * The host authenticates every request before this function can list or run tools.
 * A fresh server per request prevents one person's transport state crossing into another's.
 * No local file-writing tools are exposed implicitly: the host supplies its allowed tools.
 */
export async function remoteMcpRequest<Principal>(
  request: Request,
  options: {
    authenticate: (request: Request) => Promise<Principal | Response>;
    /** The tools this principal may discover and call: a list, or one chosen per principal. */
    tools: readonly Tool[] | ((principal: Principal) => readonly Tool[]);
    callTool: (
      principal: Principal,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<CallToolResult>;
    allowedOrigins: readonly string[];
    name?: string;
    /** More of the server's identity for hosts to show: title, icons, websiteUrl, version. */
    info?: Partial<Implementation>;
    /** Short guidance the host may give its model about using this server. */
    instructions?: string;
    /**
     * Why a tool this principal cannot call is unavailable ("switched off for this connection"),
     * shown to the model instead of "Unknown tool.". Return undefined for a name with no tool.
     */
    unlistedTool?: (principal: Principal, name: string) => string | undefined;
  },
): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !options.allowedOrigins.includes(origin))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  const principal = await options.authenticate(request);
  if (principal instanceof Response) return principal;
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!request.headers.get('content-type')?.includes('application/json'))
    return Response.json({ error: 'Use application/json' }, { status: 415 });
  // Bound the actual body, including chunked requests with no Content-Length.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        return Response.json({ error: 'Request too large' }, { status: 413 });
      }
      chunks.push(part.value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return Response.json({ error: 'Send one JSON-RPC message' }, { status: 400 });
  const tools = typeof options.tools === 'function' ? options.tools(principal) : options.tools;
  const server = new Server(
    { version: SERVER_VERSION, ...options.info, name: options.name ?? SERVER_NAME },
    {
      capabilities: { tools: {} },
      ...(options.instructions ? { instructions: options.instructions } : {}),
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!tools.some((tool) => tool.name === params.name))
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: options.unlistedTool?.(principal, params.name) ?? 'Unknown tool.',
          },
        ],
      };
    try {
      return await options.callTool(principal, params.name, params.arguments ?? {});
    } catch {
      // Provider errors can contain credentials or private URLs. Hosts may log a safe error code.
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'The request could not be completed. Check your access and arguments.',
          },
        ],
      };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });
    // Buffer the bounded JSON response before closing this request's server.
    const data = await response.arrayBuffer();
    return new Response(data.byteLength ? data : null, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' },
    });
  } finally {
    await server.close();
  }
}
