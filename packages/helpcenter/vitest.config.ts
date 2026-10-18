import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../vitest.aliases';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    name: 'helpcenter',
    // Strips real keys from the environment and blocks real OpenRouter and
    // GitHub calls before any test runs (see the file for why).
    setupFiles: ['../../vitest.setup.ts'],
    // Every suite boots PGlite behind the help centre; give it room on a busy machine.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
