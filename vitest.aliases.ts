/**
 * Tests import sibling packages from source, not from their built `dist`.
 *
 * Without this, a change to core is invisible to the dashboard's tests until
 * core is rebuilt, and a stale build can pass or fail a suite for reasons that
 * have nothing to do with the code under test. Builds and published packages
 * are unaffected: this only applies inside Vitest.
 *
 * `@helpwell/widget/server` is left alone on purpose: it serves the built
 * browser bundle, which only exists in `dist`.
 */
import { fileURLToPath } from 'node:url';

const packages = fileURLToPath(new URL('./packages/', import.meta.url)).replace(/\\/g, '/');

export const sourceAliases = [
  {
    find: /^@helpwell\/core\/(db|settings|content|search|agent|api|repos|import|setup-prompt|changelog|docs)$/,
    replacement: `${packages}core/src/$1.ts`,
  },
  { find: /^@helpwell\/core$/, replacement: `${packages}core/src/index.ts` },
  { find: /^@helpwell\/ui\/fonts$/, replacement: `${packages}ui/src/font-files.ts` },
  {
    find: /^@helpwell\/(ui|sdk|helpcenter|dashboard|mcp|tokens)$/,
    replacement: `${packages}$1/src/index.ts`,
  },
];
