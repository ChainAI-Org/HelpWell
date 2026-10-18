/**
 * A support extension may rename the agent (`AgentOverrides.name`). The name
 * reaches the widget's config and the agent's own instructions; without one,
 * everything stays exactly as Settings say.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { applyNameOverride, cleanAgentOverrides } from '../src/api/agent-overrides.js';
import type { AgentOverrides, SupportExtension } from '../src/api/support-extension.js';
import { createHelpWellHandler, type HelpWellHandler } from '../src/api.js';
import { defaultSettings } from '../src/settings.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

let t: TestDb;
let handler: HelpWellHandler;
let visitor: Client;
let model: FakeModel;

function fakeSupport(overrides: AgentOverrides | null): SupportExtension {
  return {
    afterReply: async () => {},
    handleMessage: async () => null,
    handoff: async () => {},
    thread: async () => null,
    agentOverrides: async () => overrides,
  };
}

function setup(support?: SupportExtension) {
  model = new FakeModel([{ text: 'Open Billing, then Invoices.' }]);
  handler = createHelpWellHandler({
    db: t.db,
    basePath: '/api/helpwell',
    secureCookies: false,
    model,
    ...(support ? { support } : {}),
  });
  visitor = client(handler);
}

async function agentName(): Promise<string> {
  const config = (await (await visitor.call('/config')).json()) as { agent: { name: string } };
  return config.agent.name;
}

async function systemPrompt(): Promise<string> {
  const response = await visitor.call('/chat', { body: { message: 'How do I export?' } });
  expect(response.status).toBe(200);
  const system = model.requests[0]?.messages.find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
}

beforeEach(async () => {
  t = await freshDb();
});

afterEach(async () => {
  await t.close();
});

describe('cleanAgentOverrides: the name', () => {
  it('keeps a name on its own, trimmed', () => {
    expect(cleanAgentOverrides({ name: '  Juniper  ' })).toEqual({ name: 'Juniper' });
  });

  it('makes it one plain line, without markup, at most 60 characters', () => {
    expect(cleanAgentOverrides({ name: 'Ju\nni<b>per</b>\u0007' })).toEqual({
      name: 'Ju ni b per /b',
    });
    expect(cleanAgentOverrides({ name: 'x'.repeat(200) })?.name).toHaveLength(60);
  });

  it('drops an empty or non-text name', () => {
    expect(cleanAgentOverrides({ name: '   ' })).toBeNull();
    expect(cleanAgentOverrides({ name: 42 })).toBeNull();
    expect(cleanAgentOverrides({ name: '', instructions: 'Be brief.' })).toEqual({
      instructions: 'Be brief.',
    });
  });
});

describe('applyNameOverride', () => {
  it('renames the agent and leaves everything else alone', () => {
    const settings = defaultSettings();
    const renamed = applyNameOverride(settings, { name: 'Juniper' });
    expect(renamed.agent.name).toBe('Juniper');
    expect(renamed.agent.tools).toEqual(settings.agent.tools);
    expect(settings.agent.name).toBe('Fern');
  });

  it('returns the same settings without a name', () => {
    const settings = defaultSettings();
    expect(applyNameOverride(settings, null)).toBe(settings);
    expect(applyNameOverride(settings, { instructions: 'Be brief.' })).toBe(settings);
  });
});

describe('the name reaches the widget and the agent', () => {
  it('without a support extension, the name in Settings', async () => {
    setup();
    expect(await agentName()).toBe('Fern');
    expect(await systemPrompt()).toContain('You are Fern');
  });

  it('with an extension that names no one, the name in Settings', async () => {
    setup(fakeSupport({ tools: { collect_email: false } }));
    expect(await agentName()).toBe('Fern');
    expect(await systemPrompt()).toContain('You are Fern');
  });

  it("with an extension's name, that name in the config and the instructions", async () => {
    setup(fakeSupport({ name: 'Juniper' }));
    expect(await agentName()).toBe('Juniper');
    const prompt = await systemPrompt();
    expect(prompt).toContain('You are Juniper');
    expect(prompt).not.toContain('You are Fern');
  });

  it('a failing extension keeps the name in Settings', async () => {
    setup({
      ...fakeSupport(null),
      agentOverrides: async () => {
        throw new Error('down');
      },
    });
    expect(await agentName()).toBe('Fern');
  });
});
