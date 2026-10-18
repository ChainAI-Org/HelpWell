import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../vitest.aliases';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    name: 'widget',
    // Strips real keys from the environment and blocks real OpenRouter and
    // GitHub calls before any test runs (see the file for why).
    setupFiles: ['../../vitest.setup.ts'],
    environment: 'happy-dom',
  },
});
