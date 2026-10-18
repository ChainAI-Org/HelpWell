/**
 * Settings → Widget, in the order people set a widget up: the Home screen first (the greeting, the
 * tabs, the blocks), then the Launcher, then look and behavior, and the placement numbers last, in
 * a folded "Advanced placement" nobody has to open.
 */

import type { Db } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHELL_JS } from '../src/client/shell.js';
import { textInput } from '../src/components.js';
import { createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const BASE = '/admin/helpwell';

let db: Db;
let dashboard: DashboardHandler;

const widgetTab = async () => {
  const response = await dashboard(new Request(`http://localhost${BASE}/settings?tab=widget`));
  expect(response.status).toBe(200);
  return response.text();
};

/** Where `needle` first appears in the page, failing loudly when it does not. */
const at = (page: string, needle: string) => {
  const index = page.indexOf(needle);
  expect(index, needle).toBeGreaterThan(-1);
  return index;
};

beforeAll(async () => {
  db = (await freshDb()).db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
  dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: () => true,
  });
});

afterAll(async () => {
  await new SettingsStore(db).update({
    widget: { greeting: { title: '', subtitle: '' } },
  });
});

describe('the widget tab', () => {
  it('is in four parts, in order: Home screen, Launcher, Look and behavior, Advanced placement', async () => {
    const page = await widgetTab();
    const titles = [...page.matchAll(/<h2 class="wg-group__title"[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => m[1],
    );
    expect(titles).toEqual(['Home screen', 'Launcher', 'Look and behavior']);
    const home = at(page, 'id="wg-home"');
    const launcher = at(page, 'id="wg-launcher"');
    const more = at(page, 'id="wg-more"');
    const advanced = at(page, 'id="wg-advanced"');
    expect(home).toBeLessThan(launcher);
    expect(launcher).toBeLessThan(more);
    expect(more).toBeLessThan(advanced);
    // The placement numbers were the first thing on the page; none is above the fold now.
    expect(page).not.toContain('Where it sits');
  });

  it('starts with the greeting, then the tabs, then the Home blocks', async () => {
    const page = await widgetTab();
    const title = at(page, 'data-patch="widget.greeting.title"');
    const subtitle = at(page, 'data-patch="widget.greeting.subtitle"');
    const tabs = at(page, 'data-patch="widget.tabs.home"');
    const blocks = at(page, 'data-patch="widget.home.blocks"');
    expect(at(page, 'id="wg-home"')).toBeLessThan(title);
    expect(title).toBeLessThan(subtitle);
    expect(subtitle).toBeLessThan(tabs);
    expect(tabs).toBeLessThan(blocks);
    expect(blocks).toBeLessThan(at(page, 'id="wg-launcher"'));
    // The status line is configured with the Home screen it appears on.
    expect(at(page, 'data-patch="widget.status.mode"')).toBeLessThan(at(page, 'id="wg-launcher"'));
  });

  it('shows the standard greeting as the placeholders, and saves as you type', async () => {
    const page = await widgetTab();
    const title = /<input[^>]*data-patch="widget.greeting.title"[^>]*>/.exec(page)?.[0] ?? '';
    const subtitle = /<input[^>]*data-patch="widget.greeting.subtitle"[^>]*>/.exec(page)?.[0] ?? '';
    expect(title).toContain('placeholder="Hi there"');
    expect(title).toContain('value=""');
    expect(title).toContain('maxlength="80"');
    expect(title).toContain(' data-live');
    expect(subtitle).toContain('placeholder="How can we help with {{ product.name }}?"');
    expect(subtitle).toContain('value=""');
    expect(subtitle).toContain('maxlength="160"');
    expect(subtitle).toContain(' data-live');
    // The words that can be filled in are said where it is edited: the Liquid spelling email
    // uses, and the original single braces, which still work.
    expect(page).toContain('{{ product.name }}');
    expect(page).toContain('{{ contact.first_name }}');
    expect(page).toContain('{product}');
    expect(page).toContain('{first_name}');
  });

  it('shows a saved greeting in its boxes, escaped', async () => {
    await new SettingsStore(db).update({
      widget: { greeting: { title: 'Welcome "friend"', subtitle: '<b>Ask</b> {product}' } },
    });
    const page = await widgetTab();
    expect(page).toContain('value="Welcome &quot;friend&quot;"');
    expect(page).toContain('value="&lt;b&gt;Ask&lt;/b&gt; {product}"');
    expect(page).not.toContain('<b>Ask</b>');
  });

  it('puts the corner and the launcher image under Launcher', async () => {
    const page = await widgetTab();
    const launcher = at(page, 'id="wg-launcher"');
    const more = at(page, 'id="wg-more"');
    for (const patch of ['widget.position', 'widget.appearance.launcherIconUrl']) {
      const where = at(page, `data-patch="${patch}"`);
      expect(where, patch).toBeGreaterThan(launcher);
      expect(where, patch).toBeLessThan(more);
    }
    // The rest of the look stays with the look.
    expect(at(page, 'data-patch="widget.appearance.accent"')).toBeGreaterThan(more);
  });

  it('folds the distances and the stacking order away, last, closed', async () => {
    const page = await widgetTab();
    const fold = /<details class="db-card wg-fold" id="wg-advanced"([^>]*)>/.exec(page);
    expect(fold, 'a <details> with the id wg-advanced').not.toBeNull();
    expect(fold?.[1]).not.toContain('open');
    expect(page).toContain('<span class="db-card__title">Advanced placement</span>');
    const advanced = at(page, 'id="wg-advanced"');
    for (const patch of ['widget.offset.x', 'widget.offset.y', 'widget.zIndex']) {
      expect(at(page, `data-patch="${patch}"`), patch).toBeGreaterThan(advanced);
    }
    // Nothing else comes after it that is a setting.
    const after = page.slice(advanced);
    expect([...after.matchAll(/data-patch="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'widget.offset.x',
      'widget.offset.y',
      'widget.zIndex',
    ]);
    const lastGroup = page.lastIndexOf('<section class="wg-group"');
    expect(lastGroup).toBeLessThan(advanced);
  });

  it('keeps every control it had', async () => {
    const page = await widgetTab();
    for (const patch of [
      'widget.position',
      'widget.offset.x',
      'widget.offset.y',
      'widget.zIndex',
      'widget.appearance.accent',
      'widget.appearance.theme',
      'widget.appearance.font',
      'widget.appearance.bubbleStyle',
      'widget.appearance.pattern',
      'widget.appearance.patternImageUrl',
      'widget.appearance.radius',
      'widget.appearance.launcherIconUrl',
      'widget.tabs.home',
      'widget.tabs.messages',
      'widget.tabs.help',
      'widget.tabs.updates',
      'widget.tabs.roadmap',
      'widget.home.blocks',
      'widget.statusUrl',
      'widget.status.mode',
      'widget.status.level',
      'widget.status.message',
      'widget.media.inlineVideo',
      'widget.displayRules.include',
      'widget.displayRules.exclude',
      'widget.displayRules.audience',
      'widget.displayRules.devices',
      'widget.preChat.when',
      'widget.preChat.timing',
      'widget.preChat.fields',
      'widget.preChat.requireEmail',
      'widget.preChat.consentLine',
    ]) {
      expect(page, patch).toContain(`data-patch="${patch}"`);
    }
  });
});

describe('a box that saves as you type', () => {
  it('is marked data-live only when asked, and only when it saves at all', () => {
    expect(textInput('a', 'v', { patch: 'x.y', live: true }).toString()).toContain(' data-live');
    expect(textInput('a', 'v', { patch: 'x.y' }).toString()).not.toContain('data-live');
    expect(textInput('a', 'v', { live: true }).toString()).not.toContain('data-live');
  });

  it('is saved by the shell a moment after typing stops, once, and without a banner', () => {
    expect(SHELL_JS).toContain("closest('[data-patch][data-live]')");
    expect(SHELL_JS).toContain("new Event('change', { bubbles: true })");
    // What was already saved is not sent again when the box is left.
    expect(SHELL_JS).toContain('el.defaultValue');
    expect(SHELL_JS).toContain("el.setAttribute('data-saved', String(value))");
  });
});
