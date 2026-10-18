import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/db.ts',
    'src/settings.ts',
    'src/content.ts',
    'src/search.ts',
    'src/agent.ts',
    'src/api.ts',
    'src/repos.ts',
    // Importing a help centre from elsewhere: the CLI's and the dashboard's.
    'src/import.ts',
    // A small entry for callers that only format setup prompts.
    'src/setup-prompt.ts',
    // Reading GitHub releases and drafting changelog entries from them.
    'src/changelog.ts',
    // What docs generate and docs update share with hosts that read a repo through an API.
    'src/docs.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  // Gives the CJS build a real `import.meta.url` and the ESM build a real
  // `__dirname`, which is how migrate.ts finds its .sql files in either one.
  shims: true,
  clean: true,
  sourcemap: true,
  external: ['@electric-sql/pglite', 'postgres'],
  // The .sql migrations ship next to the built code. Copied here rather than
  // by a second command in the build script, so a build that fails part way
  // cannot leave a dist with code and no migrations — which is exactly what
  // happened once, and every migrate() then found nothing to run.
  onSuccess: 'node ./scripts/copy-migrations.mjs',
});
