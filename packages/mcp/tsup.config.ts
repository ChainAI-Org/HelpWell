import { defineConfig } from 'tsup';

/**
 * One config, not two. tsup runs an array of configs concurrently against the
 * same folder, so a `clean` in one of them races the other's output and the
 * binary occasionally ends up missing. Both entries in a single pass makes the
 * clean unambiguous; the shebang comes from the first line of bin.ts, which
 * tsup preserves and chmods.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  external: ['@electric-sql/pglite', 'postgres'],
});
