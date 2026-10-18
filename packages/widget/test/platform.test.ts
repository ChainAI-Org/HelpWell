/**
 * Settings the widget now reads: the agent's name and avatar, and how the
 * changelog is grouped. Plus its self-hosted font.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WIDGET_FONT_FAMILY } from '../src/fonts.js';
import { widgetStyles } from '../src/styles.js';
import { mountWidget, unmount } from './helpers/mount.js';
import { flush } from './helpers/server.js';

afterEach(unmount);

const TWO_MONTHS = {
  items: [
    {
      id: 'chg_2',
      version: '2.2.0',
      title: 'Scheduled exports',
      summary: null,
      tags: [],
      coverUrl: null,
      publishedAt: '2026-09-10T12:00:00.000Z',
      read: true,
    },
    {
      id: 'chg_1',
      version: '2.1.0',
      title: 'Faster exports',
      summary: null,
      tags: [],
      coverUrl: null,
      publishedAt: '2026-08-20T12:00:00.000Z',
      read: true,
    },
  ],
  nextCursor: null,
};

describe('agent identity', () => {
  it("puts the agent's name in the chat header and the bare mark beside its replies", async () => {
    const w = await mountWidget({ config: { agent: { name: 'Ivy', avatarUrl: null } } });
    w.widget.open({ name: 'chat', conversationId: null });
    await flush();
    expect(w.text('.panel__agent .panel__title')).toBe('Ivy');
    expect(w.text('.panel__agentRole')).toBe('AI agent');
    await w.send('How do I export invoices?');

    const row = w.$('.msgGroup--agent .agentRow');
    expect(row).not.toBeNull();
    const avatar = row!.querySelector('.agentAvatar');
    expect(avatar?.classList.contains('agentAvatar--mark')).toBe(true);
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    // The mark is set on its own: no image, no circle around it.
    expect(avatar?.querySelector('svg')).not.toBeNull();
    expect(avatar?.querySelector('img')).toBeNull();
    expect(avatar?.querySelector('svg')?.getAttribute('aria-label')).toBeNull();
  });

  it('draws a custom avatar from Settings, and never a URL that is not http(s)', async () => {
    const w = await mountWidget({
      config: { agent: { name: 'Ivy', avatarUrl: 'https://cdn.example/ivy.png' } },
    });
    w.widget.open({ name: 'chat', conversationId: null });
    await flush();
    expect(w.$('.panel__agent img')?.getAttribute('src')).toBe('https://cdn.example/ivy.png');
    unmount();

    const bad = await mountWidget({
      config: { agent: { name: 'Ivy', avatarUrl: 'javascript:alert(1)' } },
    });
    bad.widget.open({ name: 'chat', conversationId: null });
    await flush();
    expect(bad.$('.panel__agent img')).toBeNull();
    expect(bad.$('.panel__agent .agentAvatar--mark')).not.toBeNull();
  });

  it('falls back to Fern and the mark when an older server says nothing', async () => {
    const w = await mountWidget();
    w.widget.open({ name: 'chat', conversationId: null });
    await flush();
    expect(w.text('.panel__agent .panel__title')).toBe('Fern');
  });
});

describe('changelog.groupBy', () => {
  it('leads each update with its version by default', async () => {
    const w = await mountWidget({ routes: { 'GET /changelog': TWO_MONTHS } });
    w.widget.open({ name: 'updates' });
    await flush(20);
    expect(w.$$('.entry__month')).toHaveLength(0);
    const top = w.$('.entry .entry__top');
    expect(top?.firstElementChild?.className).toBe('entry__version');
  });

  it('puts updates under month headings, date first, when grouped by date', async () => {
    const w = await mountWidget({
      config: { changelog: { groupBy: 'date' } } as never,
      routes: { 'GET /changelog': TWO_MONTHS },
    });
    w.widget.open({ name: 'updates' });
    await flush(20);
    const months = w.$$('.entry__month').map((el) => el.textContent);
    expect(months).toHaveLength(2);
    expect(months[0]).toMatch(/September|2026/);
    const top = w.$('.entry .entry__top');
    expect(top?.firstElementChild?.className).toBe('entry__date');
  });
});

describe('fonts', () => {
  it('falls back to the self-hosted face, named so it cannot restyle the page', () => {
    expect(WIDGET_FONT_FAMILY).toBe('HelpWell Plus Jakarta Sans');
    const css = widgetStyles({
      accent: '#7A3BEB',
      font: 'Inter',
      radius: 24,
      bubbleStyle: 'rounded',
    });
    expect(css).toContain(
      '--hw-font: "Inter", "Plus Jakarta Sans", "HelpWell Plus Jakarta Sans", system-ui',
    );
    // No @font-face inside the shadow root, where browsers ignore it.
    expect(css).not.toContain('@font-face');
  });
});
