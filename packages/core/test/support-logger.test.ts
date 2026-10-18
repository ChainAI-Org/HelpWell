/**
 * Where the support extension's warnings go. A host running many installs in
 * one process gives each handler its own logger, so a warning says which
 * install it came from and never lands in another install's log. Without
 * one, warnings go to the console, as they always have.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import type { SupportLogger } from '../src/api/fail-open.js';
import type { SupportExtension } from '../src/api/support-extension.js';
import { resolveSupport } from '../src/api/support-setup.js';
import { createHelpWellHandler } from '../src/api.js';
import type { Db } from '../src/db/client.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

/** Two of the three: the classic half-set environment. */
const HALF_SET = {
  HELPWELL_SUPPORT_URL: 'https://support.example.com/api',
  HELPWELL_SUPPORT_PRODUCT: 'prod_42',
};

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
});

afterAll(async () => {
  await t.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function recorder(): SupportLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    warn(message) {
      lines.push(message);
    },
  };
}

/** An in-process extension whose every answer fails, so the wrapper has something to report. */
function broken(name: string): SupportExtension {
  const fail = async (): Promise<never> => {
    throw new Error(`${name} is down`);
  };
  return { handleMessage: fail, afterReply: fail, handoff: fail, thread: fail };
}

describe('the support logger', () => {
  it('reports a half-set environment to the install’s own logger, not the console', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = recorder();
    expect(resolveSupport({ db, env: HALF_SET, logger })).toBeUndefined();
    expect(logger.lines).toEqual([expect.stringContaining('HELPWELL_SUPPORT_TOKEN')]);

    // The same through the handler, which is how a host meets it.
    const install = recorder();
    createHelpWellHandler({ db, env: HALF_SET, logger: install });
    expect(install.lines).toEqual([expect.stringContaining('HELPWELL_SUPPORT_TOKEN')]);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('prefers a logger passed for one call over the install’s', () => {
    const install = recorder();
    const call = recorder();
    resolveSupport({ db, env: HALF_SET, logger: install }, { logger: call });
    expect(call.lines).toHaveLength(1);
    expect(install.lines).toEqual([]);
  });

  it('falls back to the console when nobody passed one', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveSupport({ db, env: HALF_SET });
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('HELPWELL_SUPPORT_TOKEN'));
  });

  it('keeps two installs’ warnings apart', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loggers = { acme: recorder(), globex: recorder() };
    const handlers = Object.fromEntries(
      (['acme', 'globex'] as const).map((name) => [
        name,
        createHelpWellHandler({
          db,
          env: {},
          secureCookies: false,
          model: new FakeModel([{ text: 'Open Billing, then Invoices.' }]),
          support: broken(name),
          logger: loggers[name],
        }),
      ]),
    );

    const reply = await client(handlers.acme!).call('/chat', {
      body: { message: 'How do I export invoices?' },
    });
    // The extension failing never costs the visitor their answer.
    expect(reply.status).toBe(200);
    expect(loggers.acme.lines.length).toBeGreaterThan(0);
    expect(loggers.acme.lines.join('\n')).toContain('handleMessage');
    expect(loggers.globex.lines).toEqual([]);

    await client(handlers.globex!).call('/chat', { body: { message: 'And refunds?' } });
    expect(loggers.globex.lines.join('\n')).toContain('handleMessage');
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
