/**
 * Every secret an install uses comes from that install: its own config, or
 * its own `env`. Never from the process, when the host has given the install
 * an `env` of its own. The bot-check secret is the one checked here end to
 * end, because a leak there is silent: an install using another's Turnstile
 * secret simply fails every visitor, or passes them against the wrong site.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler, type HelpWellConfig, signIdentity } from '../src/api.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const open: TestDb[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const handle of open.splice(0)) await handle.close();
});

beforeEach(() => {
  // What a host process might have in its own environment. No install that
  // was given an `env` may see any of it.
  vi.stubEnv('HELPWELL_TURNSTILE_SECRET', 'the-host-process-secret');
  vi.stubEnv('HELPWELL_IDENTITY_SECRET', 'the-host-process-identity');
});

/** An install with the bot check asked for, recording every siteverify call. */
async function install(config: Partial<HelpWellConfig>) {
  const handle = await freshDb();
  open.push(handle);
  await new SettingsStore(handle.db).update({
    agent: { abuse: { botCheck: 'turnstile', turnstileSiteKey: '0x4AAAAsite' } },
  });
  const secrets: string[] = [];
  const verify = vi.fn(async (_url: string, init: RequestInit) => {
    secrets.push(new URLSearchParams(String(init.body)).get('secret') ?? '');
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  const handler = createHelpWellHandler({
    db: handle.db,
    adminToken: 'admin',
    model: new FakeModel([{ text: 'Open Billing.' }]),
    ...config,
    turnstile: { ...config.turnstile, fetch: verify as unknown as typeof fetch },
  });
  return {
    secrets,
    visitor: client(handler),
    admin: client(handler, { adminToken: 'admin' }),
  };
}

describe('the Turnstile secret, per install', () => {
  it("comes from each install's own env or config, never the process", async () => {
    const fromEnv = await install({ env: { HELPWELL_TURNSTILE_SECRET: 'secret-of-a' } });
    const fromConfig = await install({ env: {}, turnstile: { secret: 'secret-of-b' } });

    for (const each of [fromEnv, fromConfig]) {
      const chat = await each.visitor.call('/chat', {
        body: { message: 'hello', turnstileToken: 'good-token' },
      });
      expect(chat.status).toBe(200);
    }
    expect(fromEnv.secrets).toEqual(['secret-of-a']);
    expect(fromConfig.secrets).toEqual(['secret-of-b']);

    const sources = await Promise.all(
      [fromEnv, fromConfig].map(async (each) => {
        const checks = (await (await each.admin.call('/admin/widget/checks')).json()) as {
          botCheck: { active: boolean; secretSource: string };
        };
        return checks.botCheck;
      }),
    );
    expect(sources).toEqual([
      expect.objectContaining({ active: true, secretSource: 'environment' }),
      expect.objectContaining({ active: true, secretSource: 'config' }),
    ]);
  });

  it('stays off for an install with no secret of its own, whatever the process holds', async () => {
    const bare = await install({ env: {} });
    const config = (await (await bare.visitor.call('/config')).json()) as { botCheck?: unknown };
    expect(config.botCheck).toBeUndefined();
    const chat = await bare.visitor.call('/chat', { body: { message: 'hello' } });
    expect(chat.status).toBe(200);
    expect(bare.secrets).toEqual([]);
    const checks = (await (await bare.admin.call('/admin/widget/checks')).json()) as {
      botCheck: { secretSet: boolean };
    };
    expect(checks.botCheck.secretSet).toBe(false);
  });

  it('still reads the process environment for an install given no env, as a single install does', async () => {
    const single = await install({});
    await single.visitor.call('/chat', { body: { message: 'hello', turnstileToken: 'tok' } });
    expect(single.secrets).toEqual(['the-host-process-secret']);
  });
});

describe('the identity secret, per install', () => {
  it("verifies identify tokens with the install's own secret only", async () => {
    const a = await install({ env: { HELPWELL_IDENTITY_SECRET: 'identity-of-a' } });
    const b = await install({ env: {}, identitySecret: 'identity-of-b' });
    const bare = await install({ env: {} });

    const identify = async (target: typeof a, secret: string) =>
      (
        await target.visitor.call('/identify', {
          body: { token: await signIdentity({ id: 'user_1' }, secret) },
        })
      ).status;

    expect(await identify(a, 'identity-of-a')).toBe(200);
    expect(await identify(a, 'the-host-process-identity')).toBe(401);
    expect(await identify(b, 'identity-of-b')).toBe(200);
    expect(await identify(b, 'identity-of-a')).toBe(401);
    // No secret of its own: sign-in is not set up, rather than borrowing the host's.
    expect(await identify(bare, 'the-host-process-identity')).not.toBe(200);
  });
});
