import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../vitest.aliases';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    name: 'mcp',
    // Strips real keys from the environment and blocks real OpenRouter and
    // GitHub calls before any test runs (see the file for why).
    setupFiles: ['../../vitest.setup.ts'],
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The tools are tested against a real PGlite Postgres, which takes a moment
    // to boot per suite.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
