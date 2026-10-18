# Remote MCP hosts

The `helpwell-mcp` binary remains a local stdio server. It works from a built checkout without publishing an npm package. `HELPWELL_PROJECT_DIR` selects the project; database credentials stay in the server environment. The binary never prints its database URL.

`@helpwell/mcp` also exports `remoteMcpRequest(request, options)`, a framework-neutral Streamable HTTP adapter using the official MCP SDK. This belongs to the open-source package and has no dependency on a hosted service.

The host supplies:

- `authenticate(request)`: validate its own bearer credential and return a principal, or return the appropriate rejection `Response`. This runs before every protocol request. Never rely on a previous MCP initialization as authentication.
- `tools`: the exact tools the principal is permitted to discover and call: a list, or a function of the principal (for example, fewer tools for a read-only grant).
- `callTool(principal, name, args)`: re-check resource permissions and run the tool against the principal's own database.
- `allowedOrigins`: trusted browser origins; requests from another origin are rejected. Server-to-server requests may omit Origin.
- `info` and `instructions` (optional): the server's display title, icons and website, and short guidance hosts may pass to their model.
- `unlistedTool` (optional): returns why a tool the principal cannot call is unavailable, shown to the model in place of "Unknown tool.".

A fresh protocol server handles each request. The adapter accepts one JSON-RPC message per POST, bounds request bodies, sanitizes tool errors, and closes the server after returning JSON. GET and DELETE are intentionally unsupported in stateless mode. It does not expose local file-writing tools automatically.

For a remote service connected to hosted assistant products, the host must provide its own OAuth authorization-code flow with PKCE, protected-resource and authorization-server discovery, audience checks, explicit permission consent, expiring credentials, refresh rotation, and revocation. The adapter deliberately does not invent a global shared token or bypass authentication for discovery of private tools. A self-hosted application can integrate its established identity provider.

For local desktop use, configure the command as `node /absolute/path/to/HelpWell/packages/mcp/dist/bin.js`, with `HELPWELL_PROJECT_DIR` pointing at the installation. Store environment secrets in the local assistant's secure configuration, never in a committed example.

No public repository or npm publication is required to use either entry point from this checkout.
