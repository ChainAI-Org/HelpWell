/**
 * Which support extension a handler uses, decided once when it is created.
 *
 * Three ways in, in this order: an extension object passed as `support`;
 * connection details (`{ url, product, token }`) passed as `support`, which
 * become a remote support extension; or, with no `support` at all, the same
 * three values from the environment. `support: false` turns all of it off.
 * Whichever it is comes back wrapped by the fail-open layer, which is the
 * only way routes ever call an extension.
 *
 * A half-set environment is reported once and ignored rather than crashing
 * the host app: human support is an extra, and the AI works without it.
 * Connection details passed in code are the developer's own, so a bad one
 * (plain http, no token) throws at startup where they will see it.
 */

import type { HelpWellConfig } from './context.js';
import {
  consoleSupportLogger,
  type FailOpenSupport,
  failOpenSupport,
  isFailOpen,
  type SupportLogger,
} from './fail-open.js';
import {
  createRemoteSupportExtension,
  isRemoteSupportOptions,
  remoteSupportFromEnv,
} from './remote-extension.js';
import type { SupportExtension } from './support-extension.js';

export function resolveSupport(
  config: HelpWellConfig,
  options: { env?: Record<string, string | undefined>; logger?: SupportLogger } = {},
): FailOpenSupport | undefined {
  // Per call (tests), then per install (`HelpWellConfig.logger`), then the console.
  const logger = options.logger ?? config.logger ?? consoleSupportLogger;
  const raw = config.support;
  if (raw === false) return undefined;

  let extension: SupportExtension | undefined;
  if (raw === undefined) {
    const fromEnv = remoteSupportFromEnv(options.env ?? config.env ?? process.env);
    if (fromEnv.problem) logger.warn(fromEnv.problem);
    if (fromEnv.options) {
      try {
        extension = createRemoteSupportExtension({ ...fromEnv.options, db: config.db, logger });
      } catch (error) {
        logger.warn(`the remote support extension is not connected: ${(error as Error).message}`);
      }
    }
  } else if (isRemoteSupportOptions(raw)) {
    extension = createRemoteSupportExtension({ ...raw, db: config.db, logger });
  } else {
    extension = raw;
  }

  if (!extension) return undefined;
  if (isFailOpen(extension)) return extension;
  return failOpenSupport(extension, {
    db: config.db,
    logger,
    now: config.now,
  });
}
