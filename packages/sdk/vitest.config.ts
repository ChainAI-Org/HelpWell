import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../vitest.aliases';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    name: 'sdk',
    // Strips real keys from the environment and blocks real OpenRouter and
    // GitHub calls before any test runs (see the file for why).
    setupFiles: ['../../vitest.setup.ts'],
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The live suite boots a real server over PGlite; give it room on a busy machine.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
