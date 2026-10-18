import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../vitest.aliases';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    name: 'cli',
    // Strips real keys from the environment and blocks real OpenRouter and
    // GitHub calls before any test runs (see the file for why).
    setupFiles: ['../../vitest.setup.ts'],
    environment: 'node',
    // Several of these boot a real on-disk PGlite and run migrations, which
    // takes a few seconds each and far longer on a busy machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
