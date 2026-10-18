/**
 * Status pages: the three providers' shapes, and the guard that keeps a
 * status URL from being turned into a way to read the private network.
 */

import { describe, expect, it } from 'vitest';
import {
  clearStatusCache,
  fetchPublicJson,
  guardedLookup,
  isPrivateAddress,
  type LookupFunction,
  parseBetterStack,
  parseInstatus,
  parseStatusPage,
  parseStatuspage,
  readStatusPage,
  statusCandidates,
} from '../src/api/status-page.js';
import { defaultSettings, parseSettings } from '../src/settings/schema.js';
import { formatSetupPrompt } from '../src/setup-prompt.js';
import { turnstilePromptSpec, widgetCsp, widgetCspPromptSpec } from '../src/widget-prompts.js';

describe('parsers', () => {
  it('reads Atlassian Statuspage, including maintenance in progress', () => {
    expect(
      parseStatuspage({ status: { indicator: 'none', description: 'All Systems Operational' } }),
    ).toMatchObject({
      provider: 'statuspage',
      level: 'operational',
      message: 'All Systems Operational',
    });
    expect(
      parseStatuspage({ status: { indicator: 'critical', description: 'Major outage' } })?.level,
    ).toBe('major_outage');
    const maintenance = parseStatuspage({
      page: { url: 'https://status.acme.com' },
      status: { indicator: 'none', description: 'All Systems Operational' },
      incidents: [],
      scheduled_maintenances: [{ name: 'Database upgrade', status: 'in_progress' }],
    });
    expect(maintenance).toMatchObject({
      level: 'maintenance',
      incidents: [
        { name: 'Database upgrade', status: 'in_progress', url: 'https://status.acme.com' },
      ],
    });
  });

  it('reads Instatus, taking the worst active incident', () => {
    const status = parseInstatus({
      page: { name: 'Acme', url: 'https://acme.instatus.com', status: 'HASISSUES' },
      activeIncidents: [
        {
          name: 'Slow search',
          status: 'INVESTIGATING',
          impact: 'DEGRADEDPERFORMANCE',
          url: 'https://acme.instatus.com/a',
        },
        {
          name: 'API down',
          status: 'IDENTIFIED',
          impact: 'MAJOROUTAGE',
          url: 'https://acme.instatus.com/b',
        },
      ],
    });
    expect(status).toMatchObject({
      provider: 'instatus',
      level: 'major_outage',
      message: 'Slow search',
      incidents: [
        { name: 'Slow search', status: 'investigating' },
        { name: 'API down', status: 'identified' },
      ],
    });
    expect(parseInstatus({ page: { status: 'UP' } })?.level).toBe('operational');
    expect(parseInstatus({ page: { status: 'UNDERMAINTENANCE' } })?.level).toBe('maintenance');
  });

  it('reads Better Stack', () => {
    const status = parseBetterStack({
      data: { id: '1', type: 'status_page', attributes: { aggregate_state: 'downtime' } },
      included: [
        {
          type: 'status_report',
          attributes: { title: 'Checkout errors', aggregate_state: 'downtime' },
        },
        { type: 'status_report', attributes: { title: 'Old one', aggregate_state: 'resolved' } },
        { type: 'status_page_resource', attributes: { public_name: 'API' } },
      ],
    });
    expect(status).toMatchObject({
      provider: 'betterstack',
      level: 'major_outage',
      incidents: [{ name: 'Checkout errors' }],
    });
    expect(status?.incidents).toHaveLength(1);
  });

  it('recognises each shape without being told which it is, and nothing else', () => {
    expect(parseStatusPage({ status: { indicator: 'minor' } })?.provider).toBe('statuspage');
    expect(parseStatusPage({ page: { status: 'UP' } })?.provider).toBe('instatus');
    expect(
      parseStatusPage({ data: { attributes: { aggregate_state: 'operational' } } })?.provider,
    ).toBe('betterstack');
    expect(parseStatusPage('<html>')).toBeNull();
    expect(parseStatusPage({ status: { indicator: 'on fire' } })).toBeNull();
    expect(parseStatusPage(null)).toBeNull();
  });

  it('keeps only https links out of provider data', () => {
    const status = parseStatuspage({
      status: { indicator: 'minor' },
      incidents: [{ name: 'x', status: 'y', shortlink: 'javascript:alert(1)' }],
    });
    expect(status?.incidents[0]?.url).toBeNull();
  });
});

describe('candidates', () => {
  it('tries the likely provider first, and uses a .json URL as it is', () => {
    expect(statusCandidates('https://status.acme.com/')[0]).toBe(
      'https://status.acme.com/api/v2/summary.json',
    );
    expect(statusCandidates('https://acme.instatus.com')[0]).toBe(
      'https://acme.instatus.com/summary.json',
    );
    expect(statusCandidates('https://acme.betteruptime.com')[0]).toBe(
      'https://acme.betteruptime.com/index.json',
    );
    expect(statusCandidates('https://x.test/feed.json')).toEqual(['https://x.test/feed.json']);
    expect(() => statusCandidates('http://status.acme.com')).toThrow(/https/);
  });

  it('caches an unreadable page too, so it is not fetched on every load', async () => {
    clearStatusCache();
    let calls = 0;
    const fetchJson = async () => {
      calls++;
      throw new Error('down');
    };
    let now = 1_000_000;
    expect(
      await readStatusPage('https://status.acme.com', { fetchJson, now: () => now }),
    ).toBeNull();
    expect(calls).toBe(3);
    await readStatusPage('https://status.acme.com', { fetchJson, now: () => now });
    expect(calls).toBe(3);
    now += 61_000;
    await readStatusPage('https://status.acme.com', { fetchJson, now: () => now });
    expect(calls).toBe(6);
  });
});

describe('the SSRF guard', () => {
  it('knows the private, loopback, link-local and reserved ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a9fe:a9fe',
      'not an ip',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      '1.1.1.1',
      '8.8.8.8',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses anything but a public https URL before it connects', async () => {
    await expect(fetchPublicJson('http://status.acme.com/x.json')).rejects.toThrow(/https/);
    await expect(fetchPublicJson('https://127.0.0.1/x.json')).rejects.toThrow(/public/);
    await expect(fetchPublicJson('https://[::1]/x.json')).rejects.toThrow(/public/);
    await expect(fetchPublicJson('https://169.254.169.254/latest')).rejects.toThrow(/public/);
    await expect(fetchPublicJson('https://localhost/x.json')).rejects.toThrow(/public/);
    await expect(fetchPublicJson('https://db.internal/x.json')).rejects.toThrow(/public/);
    await expect(fetchPublicJson('https://status.acme.com:8443/x.json')).rejects.toThrow(/443/);
    await expect(fetchPublicJson('https://user:pw@status.acme.com/x')).rejects.toThrow(
      /credentials/,
    );
  });

  it('checks the address it actually connects to, so DNS cannot point it inward', async () => {
    const rebinding: LookupFunction = (_host, options, callback) => {
      if (options.all) callback(null, [{ address: '10.0.0.5', family: 4 }]);
      else callback(null, '10.0.0.5', 4);
    };
    await expect(
      fetchPublicJson('https://status.attacker.example/x.json', { lookup: rebinding }),
    ).rejects.toThrow(/private/);
  });

  it('passes a public answer through the lookup unchanged', async () => {
    const lookup = guardedLookup((_host, _options, callback) => callback(null, '93.184.215.14', 4));
    const result = await new Promise<{ error: unknown; address: unknown }>((resolve) =>
      lookup('example.com', {}, (error, address) => resolve({ error, address })),
    );
    expect(result).toEqual({ error: null, address: '93.184.215.14' });
  });
});

describe('settings', () => {
  it('defaults Home to the layout it had before blocks', () => {
    expect(defaultSettings().widget.home.blocks).toEqual([
      { type: 'search' },
      { type: 'conversation' },
      { type: 'newConversation' },
      { type: 'updates', title: "What's new", count: 3 },
      { type: 'status' },
    ]);
    expect(defaultSettings().widget.media.inlineVideo).toBe(false);
    expect(defaultSettings().widget.status).toEqual({
      mode: 'auto',
      level: 'operational',
      message: '',
    });
  });

  it('drops a block type it does not know, so a newer config still loads', () => {
    const settings = parseSettings({
      widget: {
        home: {
          blocks: [
            { type: 'search' },
            { type: 'hologram', beam: true },
            { type: 'links', items: [{ label: 'Docs', url: 'https://acme.com/docs' }] },
            { type: 'form', formId: 'frm_1' },
          ],
        },
      },
    });
    expect(settings.widget.home.blocks).toEqual([
      { type: 'search' },
      {
        type: 'links',
        title: '',
        items: [{ label: 'Docs', url: 'https://acme.com/docs', icon: '' }],
      },
      { type: 'form', formId: 'frm_1' },
    ]);
  });
});

describe('setup prompts', () => {
  it('names the CSP sources for what is switched on, and nothing more', () => {
    expect(widgetCsp()['frame-src']).toBeUndefined();
    expect(widgetCsp({ inlineVideo: true })['frame-src']).toContain('https://fast.wistia.net');
    expect(widgetCsp({ botCheck: true })['script-src']).toContain(
      'https://challenges.cloudflare.com',
    );
    const prompt = formatSetupPrompt(widgetCspPromptSpec({ inlineVideo: true, botCheck: true }));
    expect(prompt).toContain('https://www.youtube-nocookie.com');
    expect(prompt).toContain('frame-src');
  });

  it('tells the person to set the Turnstile secret themselves', () => {
    const prompt = formatSetupPrompt(
      turnstilePromptSpec({
        apiPath: '/api/helpwell',
        origin: 'https://app.acme.com',
        domains: ['app.acme.com'],
      }),
    );
    expect(prompt).toContain('HELPWELL_TURNSTILE_SECRET');
    expect(prompt).toContain('https://app.acme.com/api/helpwell/chat');
    expect(prompt).toContain('Do not ask me for the secret');
  });
});
