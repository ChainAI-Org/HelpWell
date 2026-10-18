/**
 * Getting to the database without letting it take the server down.
 *
 * An MCP server is launched by the host agent, not by a person watching a
 * terminal. If it exits during startup because Postgres is not up yet, the
 * developer sees "server failed to start" and nothing about why. So the
 * connection is opened lazily on the first tool call, and a failure is a tool
 * result the agent can read and act on.
 */

import type { Db, DbHandle } from '@helpwell/core/db';
import { createDb, defaultDatabaseUrl, schemaExists } from '@helpwell/core/db';

export type DbResolver = () => Promise<Db>;

export interface LazyDatabaseOptions {
  /**
   * Defaults to core's `defaultDatabaseUrl()`: `HELPWELL_DATABASE_URL`, else
   * the embedded database under the install's own `helpwell/data` (found by
   * walking up from the working directory), else memory. That is the same
   * answer the CLI and the host app get, so the server opens the database
   * `helpwell sync` wrote to rather than an empty one of its own.
   */
  url?: string;
  /** Injected by tests so they can fail a connection on purpose. */
  open?: (url: string) => Promise<DbHandle>;
}

export class LazyDatabase {
  readonly #url: string;
  readonly #open: (url: string) => Promise<DbHandle>;
  #handle: Promise<DbHandle> | null = null;

  constructor(options: LazyDatabaseOptions = {}) {
    this.#url = options.url ?? defaultDatabaseUrl();
    this.#open = options.open ?? ((url) => createDb({ url }));
  }

  /** Where this server looks, with any password blanked, for logs and error text. */
  get url(): string {
    return redactUrl(this.#url);
  }

  /**
   * A success is cached forever; a failure is not. The common case is that the
   * developer starts their database a minute after their editor, and the agent
   * should recover on the next call rather than need a restart.
   */
  connect(): Promise<Db> {
    if (!this.#handle) {
      this.#handle = this.#openAndCheck().catch((cause: unknown) => {
        this.#handle = null;
        throw cause;
      });
    }
    return this.#handle.then((handle) => handle.db);
  }

  resolver(): DbResolver {
    return () => this.connect();
  }

  async close(): Promise<void> {
    const handle = this.#handle;
    this.#handle = null;
    if (!handle) return;
    // Swallow: a close that fails because the connection was already gone is
    // not something a shutdown path should turn into a non-zero exit.
    await handle.then((h) => h.close()).catch(() => undefined);
  }

  async #openAndCheck(): Promise<DbHandle> {
    const handle = await this.#open(this.#url);
    if (!(await schemaExists(handle.db))) {
      await handle.close().catch(() => undefined);
      throw new Error(
        `HelpWell is not installed in the database at ${this.url}: the "helpwell" schema ` +
          'is not there. Run `helpwell sync` from the repo HelpWell is set up in — it creates ' +
          'the database and indexes the docs (`helpwell migrate` creates it empty). If the ' +
          'install lives elsewhere, set HELPWELL_DATABASE_URL to that database, or start this ' +
          'server from inside the repo so it can find helpwell/helpwell.config.json.',
      );
    }
    return handle;
  }
}

/**
 * `postgres://user:secret@host/db` becomes `postgres://user:***@host/db`. A
 * `pglite://` path has nothing to hide and is shown whole, because "which
 * file did it open" is the whole question when the answer is "the wrong one".
 */
export function redactUrl(url: string): string {
  if (url.startsWith('pglite://')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
  }
}
