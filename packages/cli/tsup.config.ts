import { defineConfig } from 'tsup';

/**
 * One config, two entries. tsup runs an array config concurrently, so a second
 * config with `clean` could delete this one's output; the build script removes
 * dist once instead.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  platform: 'node',
  target: 'node20',
  external: ['@electric-sql/pglite', 'postgres', 'playwright'],
});
