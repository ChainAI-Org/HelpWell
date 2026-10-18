/**
 * Every setting is editable in the dashboard, or visibly config-only.
 *
 * The product rule: a setting that exists in the schema either has a control
 * on some dashboard screen (a `data-patch="<path>"` control, or a form field
 * marked `data-setting="<path>"`), or is listed in `CONFIG_ONLY` with its
 * reason and shown on its screen as "Set in helpwell.config / environment".
 *
 * This walks every leaf of the settings schema, renders every screen that
 * edits settings, and fails on a setting that is neither, on a control that
 * points at a setting that does not exist, and on a secret with a control.
 * A new setting therefore cannot ship without someone deciding where it is
 * edited.
 */

import type { Db } from '@helpwell/core/db';
import {
  mergeSettings,
  parseSettings,
  SettingsStore,
  settingsSchema,
} from '@helpwell/core/settings';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIG_ONLY,
  createDashboard,
  type DashboardHandler,
  SETTINGS_TABS,
} from '../src/index.js';
import { freshDb } from './helpers/db.js';

const BASE = '/admin/helpwell';

/** The screens that edit settings. Engage is WP2's page once it lands; it is read the same way. */
const SCREENS = [
  ...SETTINGS_TABS.map((tab) => `/settings?tab=${tab.key}`),
  '/connections',
  '/webhooks',
  '/engage',
];

interface ZodLike {
  _def: {
    typeName?: string;
    innerType?: ZodLike;
    schema?: ZodLike;
    in?: ZodLike;
    shape?: () => Record<string, ZodLike>;
  };
}

/** Through defaults, preprocessors, optionals and pipes, to the type underneath. */
function unwrap(type: ZodLike): ZodLike {
  let current = type;
  for (let i = 0; i < 20; i++) {
    const def = current._def;
    const next =
      def.typeName === 'ZodDefault' ||
      def.typeName === 'ZodOptional' ||
      def.typeName === 'ZodNullable' ||
      def.typeName === 'ZodCatch' ||
      def.typeName === 'ZodReadonly'
        ? def.innerType
        : def.typeName === 'ZodEffects'
          ? def.schema
          : def.typeName === 'ZodPipeline'
            ? def.in
            : undefined;
    if (!next) return current;
    current = next;
  }
  return current;
}

/** Every leaf path: objects are walked, anything else (arrays included) is a setting. */
function leafPaths(type: ZodLike, prefix = ''): string[] {
  const inner = unwrap(type);
  if (inner._def.typeName === 'ZodObject' && inner._def.shape) {
    return Object.entries(inner._def.shape()).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

const LEAVES = leafPaths(settingsSchema as unknown as ZodLike);

let db: Db;
let dashboard: DashboardHandler;
let pages: Map<string, string>;

function attributes(page: string, name: string): string[] {
  return [...page.matchAll(new RegExp(`${name}="([^"]+)"`, 'g'))].map((match) => match[1]!);
}

beforeAll(async () => {
  db = (await freshDb()).db;
  await new SettingsStore(db).update({ product: { name: 'Acme' } });
  process.env.HELPWELL_IDENTITY_SECRET = 'shh-this-is-the-identity-secret';
  dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: () => true,
  });
  pages = new Map();
  for (const screen of SCREENS) {
    const response = await dashboard(new Request(`http://localhost${BASE}${screen}`));
    expect(response.status, screen).toBe(200);
    pages.set(screen, await response.text());
  }
});

afterAll(() => {
  delete process.env.HELPWELL_IDENTITY_SECRET;
});

describe('settings coverage', () => {
  it('finds the settings schema has the leaves it should', () => {
    // A sanity check on the walker itself, so a broken walk cannot pass vacuously.
    expect(LEAVES.length).toBeGreaterThan(80);
    for (const leaf of [
      'product.name',
      'agent.tools.searchDocs',
      'widget.home.blocks',
      'widget.status.mode',
      'widget.media.inlineVideo',
      'agent.abuse.turnstileSiteKey',
      'webhooks',
    ]) {
      expect(LEAVES).toContain(leaf);
    }
  });

  it('gives every setting a control, or lists it as config-only with a reason', () => {
    const bound = new Set<string>();
    const shownConfigOnly = new Set<string>();
    for (const page of pages.values()) {
      for (const path of attributes(page, 'data-patch')) bound.add(path);
      for (const path of attributes(page, 'data-setting')) bound.add(path);
      for (const path of attributes(page, 'data-config-only')) shownConfigOnly.add(path);
    }

    const missing = LEAVES.filter((leaf) => !bound.has(leaf) && !(leaf in CONFIG_ONLY));
    expect(missing, 'settings with no control and no CONFIG_ONLY entry').toEqual([]);

    const notShown = Object.keys(CONFIG_ONLY).filter((path) => !shownConfigOnly.has(path));
    expect(notShown, 'CONFIG_ONLY entries no screen shows').toEqual([]);

    const both = Object.keys(CONFIG_ONLY).filter((path) => bound.has(path));
    expect(both, 'settings that are both edited and called config-only').toEqual([]);
  });

  it('lists only real settings as config-only, each with a reason', () => {
    for (const [path, entry] of Object.entries(CONFIG_ONLY)) {
      expect(LEAVES, `${path} is not a setting`).toContain(path);
      expect(entry.reason.length, path).toBeGreaterThan(20);
    }
  });

  it('points every control at a setting that exists', () => {
    const stale: string[] = [];
    for (const [screen, page] of pages) {
      for (const path of [...attributes(page, 'data-patch'), ...attributes(page, 'data-setting')]) {
        if (!LEAVES.includes(path)) stale.push(`${screen}: ${path}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('says config-only where it says it, in the words the rule asks for', () => {
    const changelog = pages.get('/settings?tab=changelog') ?? '';
    expect(changelog).toContain('data-config-only="changelog.roadmap.statuses"');
    expect(changelog).toContain('Set in helpwell.config / environment');
    expect(pages.get('/webhooks')).toContain('data-config-only="webhooks"');
  });

  it('edits every setting something reads, rather than parking it as config-only', () => {
    // These were config-only only because nothing read them. They are read now
    // (the help centre, the widget, the changelog), so each is a real control.
    for (const path of [
      'helpCenter.domain',
      'helpCenter.theme.hero',
      'helpCenter.theme.underCards',
      'helpCenter.theme.tints',
      'helpCenter.theme.defaultTheme',
      'helpCenter.theme.faviconUrl',
      'helpCenter.theme.logoDarkUrl',
      'agent.avatarUrl',
      'changelog.groupBy',
    ]) {
      expect(CONFIG_ONLY, path).not.toHaveProperty([path]);
      expect(
        [...pages.values()].some((page) => page.includes(`data-patch="${path}"`)),
        path,
      ).toBe(true);
    }
    for (const entry of Object.values(CONFIG_ONLY)) {
      expect(entry.reason).not.toMatch(/nothing reads/i);
    }
  });

  it('never edits or shows a secret: only whether it is set, and where from', () => {
    for (const [screen, page] of pages) {
      expect(page, screen).not.toContain('shh-this-is-the-identity-secret');
      for (const path of attributes(page, 'data-patch')) {
        expect(path, screen).not.toMatch(/secret|apikey|api_key|token$/i);
      }
    }
    const connections = pages.get('/connections') ?? '';
    for (const env of [
      'OPENROUTER_API_KEY',
      'HELPWELL_IDENTITY_SECRET',
      'HELPWELL_TURNSTILE_SECRET',
      'HELPWELL_ADMIN_TOKEN',
      'HELPWELL_DATABASE_URL',
    ]) {
      expect(connections).toContain(`<code>${env}</code>`);
    }
    expect(connections).toMatch(
      /Identity signing secret<\/span>\s*<code>HELPWELL_IDENTITY_SECRET<\/code>\s*<span data-secret-state><span class="db-pill db-pill--good">Set: yes/,
    );
    expect(pages.get('/settings?tab=agent')).toContain('HELPWELL_TURNSTILE_SECRET');
  });

  it('saves what the JSON controls send: every option parses and validates', () => {
    const defaults = parseSettings({});
    let checked = 0;
    for (const page of pages.values()) {
      const selects = page.matchAll(
        /<select[^>]*data-patch="([^"]+)" data-patch-type="json">([\s\S]*?)<\/select>/g,
      );
      for (const [, path, options] of selects) {
        for (const [, value] of options!.matchAll(/<option value="([^"]*)"/g)) {
          const json = JSON.parse(value!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
          const patch = path!
            .split('.')
            .reduceRight<unknown>((inner, key) => ({ [key]: inner }), json);
          expect(() => mergeSettings(defaults, patch), `${path} = ${value}`).not.toThrow();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);

    // The home block editor's hidden value is the saved blocks, and saves back as they are.
    const widget = pages.get('/settings?tab=widget') ?? '';
    const hidden =
      /id="db-home-blocks" value="([^"]*)" data-patch="widget.home.blocks" data-patch-type="json"/.exec(
        widget,
      );
    expect(hidden).not.toBeNull();
    const blocks = JSON.parse(hidden![1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    expect(mergeSettings(defaults, { widget: { home: { blocks } } }).widget.home.blocks).toEqual(
      defaults.widget.home.blocks,
    );
  });
});
