import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // The SDK is a thin wrapper: leaving core external keeps one copy of jose and
  // drizzle in the customer's bundle rather than two.
  external: ['@helpwell/core'],
});
