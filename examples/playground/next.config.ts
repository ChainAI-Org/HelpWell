import { join } from 'node:path';
import type { NextConfig } from 'next';

/** Everything HelpWell publishes, plus the database engine it loads at runtime. */
const HELPWELL = /^@helpwell\/(core|helpcenter|dashboard|widget|ui|tokens)(\/|$)/;

const nextConfig: NextConfig = {
  /**
   * Keep HelpWell and PGlite out of the server bundle.
   *
   * `@helpwell/core` loads its database driver with `await import(name)` where
   * `name` is a variable, and finds its migration .sql files relative to its own
   * module URL. Neither survives being bundled: webpack cannot resolve an
   * expression, and the module URL becomes the path of a Next chunk.
   */
  serverExternalPackages: ['@electric-sql/pglite'],

  /**
   * `serverExternalPackages` alone is not enough in a workspace.
   *
   * Next only externalises modules whose resolved path lands inside
   * node_modules, and pnpm's workspace links resolve straight through to
   * ../../packages/core/dist — so the HelpWell packages get bundled anyway.
   * This says so explicitly. Delete it if you install HelpWell from npm;
   * listing the packages in `serverExternalPackages` is enough there.
   */
  webpack(config, { isServer }) {
    if (!isServer) return config;

    const existing = Array.isArray(config.externals) ? config.externals : [config.externals];

    config.externals = [
      (
        context: { request?: string },
        callback: (error?: unknown, result?: string) => void,
      ): void => {
        const request = context.request;
        if (request && HELPWELL.test(request)) {
          callback(undefined, `commonjs ${request}`);
          return;
        }
        callback();
      },
      ...existing,
    ];

    return config;
  },

  /**
   * This example lives two directories below the monorepo root. Without this,
   * Next walks up looking for a lockfile, finds whatever is in the home
   * directory, and traces the build from there.
   */
  outputFileTracingRoot: join(process.cwd(), '..', '..'),
};

export default nextConfig;
