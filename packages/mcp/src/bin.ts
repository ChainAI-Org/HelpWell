#!/usr/bin/env node
/**
 * The `helpwell-mcp` executable: stdio in, stdio out, nothing else.
 *
 * Kept to wiring only. stdout belongs to the protocol, so everything meant for
 * a human goes to stderr, and startup does not touch the database at all — see
 * db.ts for why. Which database is decided by core's `defaultDatabaseUrl`, the
 * same rule the CLI and the host app follow, so `helpwell sync` and this
 * server agree on where the docs are.
 */

import { defaultDatabaseUrl } from '@helpwell/core/db';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LazyDatabase } from './db.js';
import { resolveEnvironment } from './project.js';
import { createHelpWellMcpServer } from './server.js';

async function main(): Promise<void> {
  // HELPWELL_PROJECT_DIR points a server started outside the repo (Claude
  // Desktop starts it in the home folder) at the install, for the database
  // and for the tools that write files.
  const env = resolveEnvironment();
  const database = new LazyDatabase({ url: defaultDatabaseUrl(env.root ?? process.cwd()) });
  const server = createHelpWellMcpServer(database.resolver(), env);

  const stop = (): void => {
    void database.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await server.connect(new StdioServerTransport());
  process.stderr.write('helpwell-mcp: ready\n');
}

main().catch(() => {
  process.stderr.write('helpwell-mcp could not start. Check the local configuration.\n');
  process.exit(1);
});
