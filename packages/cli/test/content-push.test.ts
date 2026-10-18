/**
 * `helpwell sync` sends the new content to a remote support extension straight
 * away, when the project is connected to one, and never fails because of it.
 * The service is a fake fetch: nothing leaves the machine.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';

let dir: string;
let output: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-push-'));
  output = [];
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HELPWELL_DATABASE_URL;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  await init({ cwd: dir, name: 'Acme' });
  const article = join(dir, 'docs', 'billing', 'invoices.md');
  mkdirSync(join(article, '..'), { recursive: true });
  writeFileSync(
    article,
    '---\ntitle: Exporting invoices\nstatus: published\n---\n\nOpen Billing, then Invoices.\n',
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function link(url = 'https://support.example.test', product = 'acme'): void {
  const path = join(dir, 'helpwell', 'helpwell.config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.support = { url, product };
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function service(answer: (url: string) => Response = () => Response.json({ ok: true })) {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      auth: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    return answer(url);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const printed = () => output.join('');

describe('sync and the remote support extension', () => {
  it('does nothing when no extension is connected', async () => {
    const { fetch, calls } = service();
    const result = await sync({ cwd: dir, support: { env: {}, fetch } });
    expect(result.support).toBe('not-linked');
    expect(calls).toEqual([]);
    expect(printed()).not.toContain('support extension');
  });

  it('sends the manifest to the linked extension, with the token from the environment', async () => {
    link();
    const { fetch, calls } = service();
    const result = await sync({
      cwd: dir,
      support: { env: { HELPWELL_SUPPORT_TOKEN: 'tok_test' }, fetch },
    });
    expect(result.support).toBe('sent');
    const push = calls.find((call) => call.url.includes('content-sync'));
    expect(push?.url.startsWith('https://support.example.test')).toBe(true);
    expect(push?.auth).toBe('Bearer tok_test');
    expect(JSON.stringify(push?.body)).toContain('billing/invoices');
    expect(printed()).toContain('Sent the published content to the remote support extension');
  });

  it('uses all three environment values when they are set, as the server does', async () => {
    const { fetch, calls } = service();
    const result = await sync({
      cwd: dir,
      support: {
        env: {
          HELPWELL_SUPPORT_URL: 'https://other.example.test',
          HELPWELL_SUPPORT_PRODUCT: 'acme',
          HELPWELL_SUPPORT_TOKEN: 'tok_env',
        },
        fetch,
      },
    });
    expect(result.support).toBe('sent');
    expect(calls.some((call) => call.url.startsWith('https://other.example.test'))).toBe(true);
  });

  it('says so when the link has no token here, and sends nothing', async () => {
    link();
    const { fetch, calls } = service();
    const result = await sync({ cwd: dir, support: { env: {}, fetch } });
    expect(result.support).toBe('no-token');
    expect(calls).toEqual([]);
    expect(printed()).toContain('HELPWELL_SUPPORT_TOKEN is not set here');
  });

  it('never fails the sync when the service is down', async () => {
    link();
    const { fetch } = service(() => new Response('down', { status: 503 }));
    const result = await sync({
      cwd: dir,
      support: { env: { HELPWELL_SUPPORT_TOKEN: 'tok_test' }, fetch },
    });
    expect(result.support).toBe('failed');
    expect(result.articles).toBeGreaterThan(0);
    expect(printed()).toContain('did not take the content');

    const throwing = service(() => {
      throw new Error('offline');
    });
    const again = await sync({
      cwd: dir,
      support: { env: { HELPWELL_SUPPORT_TOKEN: 'tok_test' }, fetch: throwing.fetch },
    });
    expect(again.support).toBe('failed');
  });
});
