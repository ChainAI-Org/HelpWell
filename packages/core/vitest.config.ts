import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../vitest.aliases';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    name: 'core',
    // Strips real keys from the environment and blocks real OpenRouter and
    // GitHub calls before any test runs (see the file for why).
    setupFiles: ['../../vitest.setup.ts'],
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite spins up a fresh in-memory Postgres per suite; give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
