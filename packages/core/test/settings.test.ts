import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { migrate, schema } from '../src/db.js';
import {
  defaultSettings,
  mergeSettings,
  parseSettings,
  publicSupportEmail,
  SettingsStore,
  supportAddress,
} from '../src/settings.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;

beforeAll(async () => {
  t = await freshDb();
});

afterAll(async () => {
  await t.close();
});

describe('defaults', () => {
  const s = defaultSettings();

  it('boots a fresh install with a working agent persona', () => {
    expect(s.agent.name).toBe('Fern');
    expect(s.agent.models.chat).toContain('/');
    expect(s.agent.tools.searchDocs).toBe(true);
  });

  it('ships spend caps switched on, because a runaway loop spends real money', () => {
    expect(s.agent.spend.dailyCapUsd).toBeGreaterThan(0);
    expect(s.agent.spend.messagesPerConversation).toBeGreaterThan(0);
    expect(s.agent.spend.messagesPerVisitorPerHour).toBeGreaterThan(0);
  });

  it('never asks an identified visitor for their email', () => {
    expect(s.widget.preChat.when).toBe('unknown_only');
  });

  it('shows every widget tab and the roadmap', () => {
    expect(Object.values(s.widget.tabs).every(Boolean)).toBe(true);
    expect(s.changelog.roadmap.enabled).toBe(true);
  });

  it('has no telemetry setting, because nothing phones home', () => {
    expect(s.data).not.toHaveProperty('telemetry');
    // A config file written before it was removed still loads.
    expect(parseSettings({ data: { retentionMonths: 6, telemetry: true } }).data).toEqual({
      retentionMonths: 6,
    });
  });
});

describe('the Home greeting', () => {
  it('is unset by default, so the widget keeps its own words', () => {
    expect(defaultSettings().widget.greeting).toEqual({ title: '', subtitle: '' });
    // A config file or a row written before the setting existed is the same as unset.
    expect(parseSettings({ widget: { position: 'bottom-left' } }).widget.greeting).toEqual({
      title: '',
      subtitle: '',
    });
    expect(parseSettings({ widget: { greeting: {} } }).widget.greeting).toEqual({
      title: '',
      subtitle: '',
    });
  });

  it('keeps what is set, trimmed, with {product} and {first_name} as written', () => {
    const s = parseSettings({
      widget: {
        greeting: { title: '  Welcome, {first_name}  ', subtitle: 'Ask about {product}.' },
      },
    });
    expect(s.widget.greeting).toEqual({
      title: 'Welcome, {first_name}',
      subtitle: 'Ask about {product}.',
    });
    // Spaces alone are the same as unset.
    expect(parseSettings({ widget: { greeting: { title: '   ' } } }).widget.greeting.title).toBe(
      '',
    );
  });

  it('caps the title at 80 characters and the subtitle at 160', () => {
    expect(() => parseSettings({ widget: { greeting: { title: 'a'.repeat(81) } } })).toThrow();
    expect(
      parseSettings({ widget: { greeting: { title: 'a'.repeat(80) } } }).widget.greeting.title,
    ).toHaveLength(80);
    expect(() => parseSettings({ widget: { greeting: { subtitle: 'a'.repeat(161) } } })).toThrow();
    expect(
      parseSettings({ widget: { greeting: { subtitle: 'a'.repeat(160) } } }).widget.greeting
        .subtitle,
    ).toHaveLength(160);
  });

  it('merges one line without clearing the other, and an empty string clears it', () => {
    const base = parseSettings({ widget: { greeting: { title: 'Hello', subtitle: 'Hi again' } } });
    const next = mergeSettings(base, { widget: { greeting: { title: 'Welcome' } } });
    expect(next.widget.greeting).toEqual({ title: 'Welcome', subtitle: 'Hi again' });
    const cleared = mergeSettings(next, { widget: { greeting: { subtitle: '' } } });
    expect(cleared.widget.greeting).toEqual({ title: 'Welcome', subtitle: '' });
  });

  it('is stored and read back through the settings store', async () => {
    const store = new SettingsStore(t.db);
    await store.update({ widget: { greeting: { title: 'Welcome back' } } });
    expect((await store.get()).widget.greeting).toEqual({ title: 'Welcome back', subtitle: '' });
    await store.update({ widget: { greeting: { title: '' } } });
    expect((await store.get()).widget.greeting.title).toBe('');
  });
});

describe('parsing', () => {
  it('fills in everything a half-written file left out', () => {
    const s = parseSettings({ product: { name: 'Lumen' } });
    expect(s.product.name).toBe('Lumen');
    expect(s.agent.name).toBe('Fern');
    expect(s.widget.position).toBe('bottom-right');
  });

  it('drops keys it does not know rather than failing the boot', () => {
    const s = parseSettings({ product: { name: 'Lumen', mystery: 42 } });
    expect(s.product).not.toHaveProperty('mystery');
  });

  it('rejects a value that is the wrong shape', () => {
    expect(() => parseSettings({ agent: { spend: { dailyCapUsd: 'lots' } } })).toThrow();
  });

  it('merges deeply without flattening a sibling', () => {
    const base = parseSettings({ agent: { name: 'Fern', tone: 'Warm' } });
    const next = mergeSettings(base, { agent: { tone: 'Direct' } });
    expect(next.agent.tone).toBe('Direct');
    expect(next.agent.name).toBe('Fern');
    expect(next.agent.models.chat).toBe(base.agent.models.chat);
  });

  it('replaces arrays instead of concatenating them', () => {
    const base = parseSettings({ widget: { displayRules: { exclude: ['/admin/**'] } } });
    const next = mergeSettings(base, { widget: { displayRules: { exclude: ['/checkout/*'] } } });
    expect(next.widget.displayRules.exclude).toEqual(['/checkout/*']);
  });
});

describe('what the dashboard posts', () => {
  it('splits a comma-separated string into the list fields the page sends', () => {
    const s = parseSettings({
      agent: { abuse: { blockedDomains: 'spam.test, junk.test\nmore.test, ' } },
      widget: { displayRules: { include: '/app/**, /docs/**', exclude: '' } },
      changelog: { categories: 'New,Improved , Fixed' },
    });
    expect(s.agent.abuse.blockedDomains).toEqual(['spam.test', 'junk.test', 'more.test']);
    expect(s.widget.displayRules.include).toEqual(['/app/**', '/docs/**']);
    expect(s.widget.displayRules.exclude).toEqual([]);
    expect(s.changelog.categories).toEqual(['New', 'Improved', 'Fixed']);
  });

  it('still takes the arrays a config file has', () => {
    const s = parseSettings({
      agent: { abuse: { blockedDomains: ['spam.test'] } },
      widget: { displayRules: { include: ['**'], exclude: ['/checkout/**'] } },
    });
    expect(s.agent.abuse.blockedDomains).toEqual(['spam.test']);
    expect(s.widget.displayRules.exclude).toEqual(['/checkout/**']);
    expect(defaultSettings().widget.displayRules.include).toEqual(['**']);
  });

  it('merges a comma string patch onto saved settings', () => {
    const next = mergeSettings(defaultSettings(), {
      widget: { displayRules: { exclude: '/checkout/**, /login' } },
    });
    expect(next.widget.displayRules.exclude).toEqual(['/checkout/**', '/login']);
  });

  it('refuses an accent that is not a hex colour, with a message the page can show', () => {
    expect(() => parseSettings({ widget: { appearance: { accent: 'red' } } })).toThrow(
      /hex colour/,
    );
    expect(() =>
      parseSettings({ helpCenter: { theme: { accent: 'url(javascript:alert(1))' } } }),
    ).toThrow();
    expect(
      parseSettings({ helpCenter: { theme: { accent: '#0EA5E9' } } }).helpCenter.theme.accent,
    ).toBe('#0EA5E9');
    expect(
      parseSettings({ widget: { appearance: { accent: '#abc' } } }).widget.appearance.accent,
    ).toBe('#abc');
  });

  it('strips from a font name the characters that could end a style block', () => {
    const s = parseSettings({
      helpCenter: {
        theme: {
          headlineFont: 'Inter"; </style><script>alert(1)</script>',
          bodyFont: "'Plus Jakarta Sans'",
        },
      },
      widget: { appearance: { font: '<b>Inter</b>' } },
    });
    expect(s.helpCenter.theme.headlineFont).toContain('Inter');
    expect(s.helpCenter.theme.headlineFont).not.toMatch(/[<>"']/);
    expect(s.helpCenter.theme.bodyFont).toBe('Plus Jakarta Sans');
    expect(s.widget.appearance.font).not.toMatch(/[<>]/);
  });
});

describe('store', () => {
  it('returns defaults before anything is saved', async () => {
    const store = new SettingsStore(t.db);
    const s = await store.get();
    expect(s.agent.name).toBe('Fern');
  });

  it('saves a patch and reads it back', async () => {
    const store = new SettingsStore(t.db, { ttlMs: 0 });
    await store.update({ product: { name: 'Lumen' }, agent: { tone: 'Direct' } });

    const fresh = new SettingsStore(t.db, { ttlMs: 0 });
    const s = await fresh.get();
    expect(s.product.name).toBe('Lumen');
    expect(s.agent.tone).toBe('Direct');
    expect(s.agent.name).toBe('Fern');
  });

  it('keeps one row however many times it is written', async () => {
    const store = new SettingsStore(t.db, { ttlMs: 0 });
    await store.update({ product: { name: 'One' } });
    await store.update({ product: { name: 'Two' } });
    const rows = await t.db.execute('SELECT count(*)::int AS n FROM helpwell.settings');
    const n = (Array.isArray(rows) ? rows[0] : (rows as { rows: { n: number }[] }).rows[0]) as {
      n: number;
    };
    expect(n.n).toBe(1);
  });

  it('shows a save to every store on the same database at once, however long they cache', async () => {
    const api = new SettingsStore(t.db, { ttlMs: 60_000 });
    const dashboard = new SettingsStore(t.db, { ttlMs: 60_000 });
    await api.get();
    await dashboard.update({ product: { name: 'Saved in the dashboard' } });
    expect((await api.get()).product.name).toBe('Saved in the dashboard');
  });

  it('merges a save onto the database copy, not a stale cache', async () => {
    const a = new SettingsStore(t.db);
    await a.update({ product: { name: 'From A' } });
    const b = new SettingsStore(t.db);
    await b.update({ product: { name: 'From B' } });

    const merged = await a.update({ agent: { tone: 'Direct' } });
    expect(merged.product.name).toBe('From B');
    expect(merged.agent.tone).toBe('Direct');
    expect((await a.get()).product.name).toBe('From B');
  });

  it('shares one query between concurrent reads, and one copy between stores', async () => {
    const store = new SettingsStore(t.db);
    const [x, y] = await Promise.all([store.get(), store.get()]);
    expect(x).toBe(y);
    // Unchanged, the row is not read again: the copy already held is handed out.
    expect(await new SettingsStore(t.db).get()).toBe(x);
  });

  it('never hands a read that started before a save to a caller after it', async () => {
    // The first read gets its answer from the database, then is held back
    // before returning it, the way a slow connection would.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdNext = false;
    const slow = new Proxy(t.db, {
      get(target, key, receiver) {
        if (key !== 'execute') return Reflect.get(target, key, receiver);
        return async (query: Parameters<typeof target.execute>[0]) => {
          const hold = holdNext;
          holdNext = false;
          const result = await target.execute(query);
          if (hold) await held;
          return result;
        };
      },
    });
    const reader = new SettingsStore(slow);
    await new SettingsStore(slow).update({ product: { name: 'Before' } });

    holdNext = true;
    const early = reader.get();
    await new SettingsStore(slow).update({ product: { name: 'After' } });
    const late = reader.get();
    release();

    expect((await early).product.name).toBe('Before');
    expect((await late).product.name).toBe('After');
    expect((await reader.get()).product.name).toBe('After');
  });

  it('lets a caller drop the copy so the next read fetches the row', async () => {
    const store = new SettingsStore(t.db);
    const before = await store.get();
    store.invalidate();
    const after = await store.get();
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  it('sees a save from another process on the same database on its next read', async () => {
    // Two handles on one database share no memory, as two servers would not.
    const client = new PGlite();
    try {
      const one = drizzle(client, { schema }) as unknown as Db;
      const two = drizzle(client, { schema }) as unknown as Db;
      await migrate(one);
      const reader = new SettingsStore(two);
      await new SettingsStore(one).update({ product: { name: 'First' } });
      expect((await reader.get()).product.name).toBe('First');

      await new SettingsStore(one).update({ product: { name: 'Second' } });
      expect((await reader.get()).product.name).toBe('Second');

      // Even a write that went round the store, which is still a new row version.
      await one.execute(
        sql`UPDATE helpwell.settings SET data = jsonb_set(data, '{product,name}', '"By hand"')`,
      );
      expect((await reader.get()).product.name).toBe('By hand');

      // A cache window is the one way to trade that away, for a busy host.
      const lagging = new SettingsStore(two, { ttlMs: 60_000 });
      await lagging.get();
      await new SettingsStore(one).update({ product: { name: 'Third' } });
      expect((await lagging.get()).product.name).toBe('By hand');
      expect((await reader.get()).product.name).toBe('Third');
    } finally {
      await client.close();
    }
  });

  it('keeps separate installs apart', async () => {
    const other = await freshDb();
    try {
      const mine = new SettingsStore(t.db);
      const theirs = new SettingsStore(other.db);
      await mine.update({ product: { name: 'Mine' } });
      await theirs.update({ product: { name: 'Theirs' } });
      expect((await mine.get()).product.name).toBe('Mine');
      expect((await new SettingsStore(other.db).get()).product.name).toBe('Theirs');
    } finally {
      await other.close();
    }
  });

  it('reports when settings were last saved, and null before they ever were', async () => {
    const empty = await freshDb();
    try {
      const store = new SettingsStore(empty.db);
      expect(await store.updatedAt()).toBeNull();
      await store.update({ product: { name: 'Stamped' } });
      const at = await store.updatedAt();
      expect(at).toBeInstanceOf(Date);
      expect(Math.abs(Date.now() - at!.getTime())).toBeLessThan(60_000);
    } finally {
      await empty.close();
    }
  });
});

describe('the support email visitors are shown', () => {
  const withEmail = (supportEmail: string) => parseSettings({ product: { supportEmail } });

  it('is the address when there is one and nobody else answers people', () => {
    expect(publicSupportEmail(withEmail(' help@acme.test '), { humanSupport: false })).toBe(
      'help@acme.test',
    );
    expect(publicSupportEmail(withEmail(''), { humanSupport: false })).toBeNull();
  });

  it('is never shown when a support extension handles human replies', () => {
    expect(publicSupportEmail(withEmail('help@acme.test'), { humanSupport: true })).toBeNull();
  });

  it('is only ever a plain address, since it lands in a mailto link', () => {
    for (const value of [
      'javascript:alert(1)',
      'help@acme.test?bcc=all@acme.test',
      'help@acme.test, boss@acme.test',
      '<help@acme.test>',
      'help at acme dot test',
      'help@localhost',
    ]) {
      expect(supportAddress(value), value).toBeNull();
    }
    expect(supportAddress('first.last+support@mail.acme.co.uk')).toBe(
      'first.last+support@mail.acme.co.uk',
    );
  });
});
