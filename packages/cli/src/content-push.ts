/**
 * After `helpwell sync`, tell the remote support extension what changed.
 *
 * A running server pushes its content manifest to a support extension by
 * itself (core's content sync), but only when it notices a change, which
 * takes up to a minute after the next request. `sync` runs outside the
 * server, so it pushes the manifest straight away itself, when this project
 * is connected to a remote support extension: all three HELPWELL_SUPPORT_*
 * values in the environment, or the URL and product `helpwell link` saved
 * with the token from HELPWELL_SUPPORT_TOKEN.
 *
 * Fail-open, like every call to an extension: the index is already written,
 * so a service that is down, refuses, or is not set up costs a line of
 * output and never fails the sync.
 */

import {
  buildContentManifest,
  createRemoteSupportExtension,
  failOpenSupport,
  pushContentSync,
  type RemoteSupportOptions,
  remoteSupportFromEnv,
  SUPPORT_TOKEN_ENV,
} from '@helpwell/core/api';
import type { Db } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import type { Project } from './project.js';

export interface ContentPushOptions {
  /** Where the HELPWELL_SUPPORT_* values are read. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Reaches the service; for tests. */
  fetch?: typeof fetch;
}

export type ContentPushResult =
  /** The manifest went to the service. */
  | { status: 'sent'; url: string }
  /** No remote support extension is connected: nothing to do. */
  | { status: 'not-linked' }
  /** `helpwell link` saved one, but the token is not in this environment. */
  | { status: 'no-token'; url: string }
  /** It was tried, and did not land. The server sends it again on its own. */
  | { status: 'failed'; url: string; reason: string };

/** Which remote support extension this project uses, if any, the way the server would pick it. */
function target(
  project: Project,
  env: Record<string, string | undefined>,
): RemoteSupportOptions | { url: string; token: null } | null {
  // All three in the environment win, as they do for the server.
  const fromEnv = remoteSupportFromEnv(env);
  if (fromEnv.options) return fromEnv.options;
  const link = project.config.support;
  if (!link) return null;
  const token = env[SUPPORT_TOKEN_ENV]?.trim() ?? '';
  return token ? { url: link.url, product: link.product, token } : { url: link.url, token: null };
}

export async function pushContentToSupport(
  project: Project,
  db: Db,
  options: ContentPushOptions = {},
): Promise<ContentPushResult> {
  const env = options.env ?? process.env;
  const chosen = target(project, env);
  if (!chosen) return { status: 'not-linked' };
  if (chosen.token === null) return { status: 'no-token', url: chosen.url };

  // Warnings are collected rather than printed: the sync says what happened
  // in its own words, once.
  const warnings: string[] = [];
  const logger = { warn: (message: string) => warnings.push(message) };
  try {
    const support = failOpenSupport(
      createRemoteSupportExtension({ ...chosen, db, fetch: options.fetch, logger }),
      { db, logger },
    );
    const settings = await new SettingsStore(db).get();
    await pushContentSync(support, await buildContentManifest(db, settings));
    // A call that lands starts replaying whatever the retry queue holds. It
    // is waited for here, because the sync closes the database next.
    await support.drainRetries();
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  return warnings.length === 0
    ? { status: 'sent', url: chosen.url }
    : { status: 'failed', url: chosen.url, reason: warnings[0]! };
}
