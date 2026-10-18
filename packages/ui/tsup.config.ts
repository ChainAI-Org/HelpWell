import { defineConfig } from 'tsup';

/**
 * Two entries. The index is browser-safe and bundled into the widget; `fonts`
 * reads the self-hosted font files off disk, so it is Node only and its own
 * import (`@helpwell/ui/fonts`).
 *
 * No `shims`: they would put Node's `path` and `url` into the chunk the two
 * entries share, and the widget's browser bundle would then fail to build.
 * `fonts` finds its own location without them (see `moduleUrl`).
 */
export default defineConfig({
  entry: { index: 'src/index.ts', fonts: 'src/font-files.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
