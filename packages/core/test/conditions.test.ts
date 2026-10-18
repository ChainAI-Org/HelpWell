/**
 * Conditions: the parser refuses what it should, and the two ways of running a
 * rule — compiled SQL over many contacts, and in memory over one — give the
 * same answer for every operator.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonymousSnapshot,
  type Condition,
  type ConditionGroup,
  checkFieldTypes,
  contactMatches,
  countMatchingContacts,
  evaluateConditions,
  isEmptyValue,
  loadSnapshot,
  matchingContactIds,
  parseConditions,
  readBoolean,
  readList,
  readNumber,
  readText,
  readTime,
} from '../src/conditions/index.js';
import { rowsOf } from '../src/db/rows.js';
import type { Db } from '../src/db.js';
import { freshDb, type TestDb } from './helpers/db.js';

let t: TestDb;
let db: Db;

const NOW = new Date('2026-09-22T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

/** Every contact, by id, for the equivalence checks. */
const PEOPLE: {
  id: string;
  email?: string | null;
  name?: string | null;
  identified?: boolean;
  signedUpAt?: Date | null;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  source?: string;
  consent?: string;
  attributes?: Record<string, unknown>;
  tags?: string[];
  events?: { name: string; daysAgo: number }[];
}[] = [
  {
    id: 'con_a',
    email: 'ada@acme.com',
    name: 'Ada Lovelace',
    identified: true,
    signedUpAt: ago(400),
    lastSeenAt: ago(1),
    attributes: {
      plan: 'Pro',
      seats: 4,
      mrr: '$1,200.50',
      beta: true,
      roles: ['Admin', 'billing'],
      trial_ends_at: new Date(NOW.getTime() + 5 * DAY).toISOString(),
      site: 'https://acme.com',
    },
    tags: ['vip', 'beta'],
    events: [
      { name: 'exported_csv', daysAgo: 1 },
      { name: 'exported_csv', daysAgo: 2 },
      { name: 'exported_csv', daysAgo: 3 },
      { name: 'invited_user', daysAgo: 40 },
    ],
  },
  {
    id: 'con_b',
    email: 'bob@example.org',
    name: 'Bob',
    identified: true,
    signedUpAt: ago(10),
    lastSeenAt: ago(9),
    source: 'identify',
    consent: 'granted',
    attributes: { plan: 'team', seats: '12', beta: 'false', roles: 'member', mrr: 49 },
    tags: ['trial'],
    events: [{ name: 'exported_csv', daysAgo: 20 }],
  },
  {
    id: 'con_c',
    email: null,
    name: null,
    identified: false,
    firstSeenAt: ago(3),
    lastSeenAt: ago(0.5),
    attributes: {},
  },
  {
    id: 'con_d',
    email: 'dee@acme.com',
    name: '  ',
    identified: true,
    signedUpAt: null,
    firstSeenAt: ago(90),
    lastSeenAt: ago(60),
    source: 'import',
    attributes: {
      plan: '',
      seats: 'four',
      beta: 1,
      roles: [],
      trial_ends_at: 1_700_000_000,
      nested: { a: 1 },
      tags: ['attribute-tag'],
    },
    tags: [],
  },
  {
    id: 'con_e',
    email: 'eve@acme.com',
    identified: true,
    signedUpAt: new Date('2026-09-01T23:30:00Z'),
    lastSeenAt: ago(2),
    attributes: { plan: 'enterprise', seats: 250, roles: ['Admin'], trial_ends_at: '2026-09-25' },
    tags: ['vip'],
    events: [{ name: 'invited_user', daysAgo: 2 }],
  },
];

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
  for (const person of PEOPLE) {
    await db.execute(sql`
      INSERT INTO helpwell.contacts
        (id, email, name, identified, signed_up_at, first_seen_at, last_seen_at, source, consent, attributes)
      VALUES (${person.id}, ${person.email ?? null}, ${person.name ?? null}, ${person.identified ?? false},
              ${person.signedUpAt?.toISOString() ?? null}::timestamptz,
              ${(person.firstSeenAt ?? ago(500)).toISOString()}::timestamptz,
              ${(person.lastSeenAt ?? NOW).toISOString()}::timestamptz,
              ${person.source ?? 'widget'}, ${person.consent ?? 'unknown'},
              ${JSON.stringify(person.attributes ?? {})}::jsonb)
    `);
    for (const tag of person.tags ?? []) {
      await db.execute(
        sql`INSERT INTO helpwell.contact_tags (contact_id, tag) VALUES (${person.id}, ${tag})`,
      );
    }
    for (const [i, event] of (person.events ?? []).entries()) {
      await db.execute(sql`
        INSERT INTO helpwell.events (id, contact_id, name, created_at)
        VALUES (${`evt_${person.id}_${i}`}, ${person.id}, ${event.name},
                ${ago(event.daysAgo).toISOString()}::timestamptz)
      `);
    }
  }
  // An erased contact is never a member of anything.
  await db.execute(sql`
    INSERT INTO helpwell.contacts (id, attributes, deleted_at)
    VALUES ('con_z', '{"plan": "Pro"}'::jsonb, now())
  `);
});

afterAll(async () => {
  await t.close();
});

async function viaSql(rules: ConditionGroup): Promise<string[]> {
  const page = await matchingContactIds(db, rules, { limit: 1000, now: NOW, strategy: 'sql' });
  return page.ids.sort();
}

async function viaMemory(rules: ConditionGroup): Promise<string[]> {
  const page = await matchingContactIds(db, rules, { limit: 1000, now: NOW, strategy: 'memory' });
  return page.ids.sort();
}

describe('parseConditions', () => {
  it('accepts nested groups and fills in what an operator needs', () => {
    expect(
      parseConditions({
        all: [
          { field: 'plan', op: 'is', value: 'pro' },
          {
            any: [
              { event: 'exported_csv', op: 'at_least' },
              { field: 'beta', op: 'is_true' },
            ],
          },
          { field: 'seats', op: 'between', value: ['10', 2] },
        ],
      }),
    ).toEqual({
      all: [
        { field: 'plan', op: 'is', value: 'pro' },
        {
          any: [
            { event: 'exported_csv', op: 'at_least', count: 1 },
            { field: 'beta', op: 'is_true' },
          ],
        },
        { field: 'seats', op: 'between', value: [2, 10] },
      ],
    });
  });

  it('treats nothing as everyone and wraps a bare condition', () => {
    expect(parseConditions(null)).toEqual({ all: [] });
    expect(parseConditions({ field: 'tags', op: 'includes_any', value: 'vip' })).toEqual({
      all: [{ field: 'tags', op: 'includes_any', value: ['vip'] }],
    });
  });

  it('refuses unknown operators, missing values and malformed shapes with a readable message', () => {
    expect(() => parseConditions({ field: 'plan', op: 'like', value: 'x' })).toThrow(/not valid/);
    expect(() => parseConditions({ field: 'seats', op: 'gt' })).toThrow(/needs a number/);
    expect(() => parseConditions({ field: 'trial', op: 'before', value: 'soon' })).toThrow(
      /ISO date/,
    );
    expect(() => parseConditions({ field: 'x', op: 'within_last_days', value: 1.5 })).toThrow(
      /whole number/,
    );
    expect(() => parseConditions({ all: [{ nope: true }] })).toThrow(/not valid/);
    expect(() => parseConditions({ event: 'x', op: 'at_least', count: 0 })).toThrow(/not valid/);
  });

  it('caps depth and size', () => {
    let deep: Condition = { field: 'plan', op: 'is_empty' };
    for (let i = 0; i < 8; i++) deep = { all: [deep] };
    expect(() => parseConditions(deep)).toThrow(/deeper/);
    const wide = { any: Array.from({ length: 101 }, () => ({ field: 'plan', op: 'is_empty' })) };
    expect(() => parseConditions(wide)).toThrow(/More than 100/);
  });

  it('checks operators against registered field types, and lets unknown fields through', () => {
    const rules = parseConditions({
      all: [
        { field: 'seats', op: 'contains', value: '4' },
        { field: 'tags', op: 'includes_any', value: ['vip'] },
        { field: 'unregistered', op: 'gt', value: 3 },
      ],
    });
    const types = new Map([
      ['seats', 'number' as const],
      ['tags', 'list' as const],
    ]);
    expect(checkFieldTypes(rules, (field) => types.get(field))).toEqual([
      '"seats" is a number field, so "contains" does not apply to it',
    ]);
  });
});

describe('value readers', () => {
  const samples: unknown[] = [
    'Pro',
    '',
    '   ',
    4,
    -2.5,
    '12',
    '1,200',
    '$1,200.50',
    '4 seats',
    'v2',
    true,
    false,
    'true',
    'YES',
    '0',
    1,
    0,
    null,
    [],
    ['a', 1, true, { x: 1 }],
    {},
    { a: 1 },
    '2026-09-01',
    '2026-09-01T10:00:00',
    '2026-09-01T10:00:00+02:00',
    '2026-09-01 10:00:00Z',
    '2026-13-45',
    1_700_000_000,
    1_700_000_000_000,
    'not a date',
  ];

  it('reads every sample the same way in SQL and in JavaScript', async () => {
    for (const sample of samples) {
      const json = JSON.stringify(sample);
      const row = rowsOf<{
        text: string | null;
        num: string | number | null;
        time: string | Date | null;
        bool: boolean;
        list: string[];
        empty: boolean;
      }>(
        await db.execute(sql`
          SELECT helpwell.hw_text(v) AS text, helpwell.hw_num(v) AS num,
                 helpwell.hw_time(v) AS time, helpwell.hw_bool(v) AS bool,
                 helpwell.hw_list(v) AS list, helpwell.hw_empty(v) AS empty
          FROM (SELECT ${json}::jsonb AS v) AS s
        `),
      )[0]!;
      const label = `sample ${json}`;
      expect(row.text, label).toBe(readText(sample));
      expect(row.num === null ? null : Number(row.num), label).toBe(readNumber(sample));
      expect(row.time === null ? null : new Date(row.time).getTime(), label).toBe(readTime(sample));
      expect(Boolean(row.bool), label).toBe(readBoolean(sample));
      expect(row.list, label).toEqual(readList(sample));
      expect(Boolean(row.empty), label).toBe(isEmptyValue(sample));
    }
  });
});

describe('SQL and memory agree', () => {
  const cases: [string, Condition, string[]][] = [
    ['text is, ignoring case', { field: 'plan', op: 'is', value: 'pro' }, ['con_a']],
    [
      'text is not includes missing',
      { field: 'plan', op: 'is_not', value: 'pro' },
      ['con_b', 'con_c', 'con_d', 'con_e'],
    ],
    ['contains', { field: 'email', op: 'contains', value: 'ACME' }, ['con_a', 'con_d', 'con_e']],
    ['does not contain', { field: 'email', op: 'not_contains', value: 'acme' }, ['con_b', 'con_c']],
    ['starts with', { field: 'name', op: 'starts_with', value: 'ada' }, ['con_a']],
    ['ends with', { field: 'email', op: 'ends_with', value: '.org' }, ['con_b']],
    ['is empty', { field: 'name', op: 'is_empty' }, ['con_c', 'con_d', 'con_e']],
    ['is not empty', { field: 'plan', op: 'is_not_empty' }, ['con_a', 'con_b', 'con_e']],
    ['number eq reads text numbers', { field: 'seats', op: 'eq', value: 12 }, ['con_b']],
    [
      'number neq includes missing',
      { field: 'seats', op: 'neq', value: 4 },
      ['con_b', 'con_c', 'con_d', 'con_e'],
    ],
    ['gt', { field: 'seats', op: 'gt', value: 4 }, ['con_b', 'con_e']],
    ['gte', { field: 'seats', op: 'gte', value: 4 }, ['con_a', 'con_b', 'con_e']],
    ['lt', { field: 'seats', op: 'lt', value: 12 }, ['con_a']],
    ['lte', { field: 'seats', op: 'lte', value: 12 }, ['con_a', 'con_b']],
    ['between', { field: 'seats', op: 'between', value: [5, 300] }, ['con_b', 'con_e']],
    ['money in text', { field: 'mrr', op: 'gt', value: 1000 }, ['con_a']],
    ['date before', { field: 'signed_up', op: 'before', value: '2026-01-01' }, ['con_a']],
    [
      'date after',
      { field: 'signed_up', op: 'after', value: '2026-09-01' },
      ['con_b', 'con_c', 'con_e'],
    ],
    ['date on, a UTC day', { field: 'signed_up', op: 'on', value: '2026-09-01' }, ['con_e']],
    [
      'within the last N days',
      { field: 'last_seen', op: 'within_last_days', value: 3 },
      ['con_a', 'con_c', 'con_e'],
    ],
    [
      'more than N days ago',
      { field: 'signed_up', op: 'more_than_days_ago', value: 30 },
      ['con_a', 'con_d'],
    ],
    [
      'within the next N days',
      { field: 'trial_ends_at', op: 'within_next_days', value: 7 },
      ['con_a', 'con_e'],
    ],
    [
      'epoch seconds are dates',
      { field: 'trial_ends_at', op: 'before', value: '2024-01-01' },
      ['con_d'],
    ],
    [
      'boolean true, from text and numbers too',
      { field: 'beta', op: 'is_true' },
      ['con_a', 'con_d'],
    ],
    ['boolean false is not true', { field: 'beta', op: 'is_false' }, ['con_b', 'con_c', 'con_e']],
    ['identified', { field: 'identified', op: 'is_false' }, ['con_c']],
    [
      'list includes any',
      { field: 'roles', op: 'includes_any', value: ['admin'] },
      ['con_a', 'con_e'],
    ],
    [
      'list includes all',
      { field: 'roles', op: 'includes_all', value: ['admin', 'billing'] },
      ['con_a'],
    ],
    [
      'list excludes',
      { field: 'roles', op: 'excludes', value: ['admin'] },
      ['con_b', 'con_c', 'con_d'],
    ],
    [
      'a lone value is a list of one',
      { field: 'roles', op: 'includes_any', value: ['member'] },
      ['con_b'],
    ],
    ['empty list', { field: 'roles', op: 'is_empty' }, ['con_c', 'con_d']],
    ['tags', { field: 'tags', op: 'includes_any', value: ['VIP'] }, ['con_a', 'con_e']],
    ['no tags', { field: 'tags', op: 'is_empty' }, ['con_c', 'con_d']],
    [
      'a reserved name reaches the attribute',
      { field: 'attributes.tags', op: 'includes_any', value: ['attribute-tag'] },
      ['con_d'],
    ],
    ['source', { field: 'source', op: 'is', value: 'import' }, ['con_d']],
    ['consent', { field: 'consent', op: 'is', value: 'granted' }, ['con_b']],
    ['event happened', { event: 'exported_csv', op: 'happened' }, ['con_a', 'con_b']],
    ['event in a window', { event: 'exported_csv', op: 'happened', withinDays: 7 }, ['con_a']],
    [
      'event did not happen',
      { event: 'invited_user', op: 'not_happened' },
      ['con_b', 'con_c', 'con_d'],
    ],
    ['at least N times', { event: 'exported_csv', op: 'at_least', count: 3 }, ['con_a']],
    [
      'at least N times in a window',
      { event: 'exported_csv', op: 'at_least', count: 3, withinDays: 2 },
      [],
    ],
    [
      'any group',
      {
        any: [
          { field: 'plan', op: 'is', value: 'team' },
          { field: 'tags', op: 'includes_any', value: ['vip'] },
        ],
      },
      ['con_a', 'con_b', 'con_e'],
    ],
    [
      'all group',
      {
        all: [
          { field: 'identified', op: 'is_true' },
          { field: 'email', op: 'ends_with', value: 'acme.com' },
          {
            any: [
              { field: 'seats', op: 'gte', value: 100 },
              { event: 'exported_csv', op: 'at_least', count: 2 },
            ],
          },
        ],
      },
      ['con_a', 'con_e'],
    ],
    ['empty all is everyone', { all: [] }, ['con_a', 'con_b', 'con_c', 'con_d', 'con_e']],
    ['empty any is no one', { any: [] }, []],
  ];

  for (const [name, condition, expected] of cases) {
    it(name, async () => {
      const rules: ConditionGroup =
        'all' in condition || 'any' in condition
          ? (condition as ConditionGroup)
          : { all: [condition] };
      expect(await viaSql(rules)).toEqual(expected);
      expect(await viaMemory(rules)).toEqual(expected);
    });
  }

  it('counts the same both ways, and never counts an erased contact', async () => {
    const rules = parseConditions({ field: 'plan', op: 'is_not_empty' });
    expect(await countMatchingContacts(db, rules, { now: NOW })).toBe(3);
    expect(await countMatchingContacts(db, rules, { now: NOW, strategy: 'memory' })).toBe(3);
  });

  it('pages with a cursor on both paths', async () => {
    const rules = parseConditions({ all: [] });
    for (const strategy of ['sql', 'memory'] as const) {
      const first = await matchingContactIds(db, rules, { limit: 2, now: NOW, strategy });
      expect(first.ids).toEqual(['con_e', 'con_d']);
      const second = await matchingContactIds(db, rules, {
        limit: 2,
        now: NOW,
        strategy,
        after: first.nextCursor,
      });
      expect(second.ids).toEqual(['con_c', 'con_b']);
      const third = await matchingContactIds(db, rules, {
        limit: 2,
        now: NOW,
        strategy,
        after: second.nextCursor,
      });
      expect(third).toEqual({ ids: ['con_a'], nextCursor: null });
    }
  });
});

describe('one contact at request time', () => {
  it('builds a snapshot with only the events the rules need', async () => {
    const rules = parseConditions({ event: 'exported_csv', op: 'at_least', count: 2 });
    const snapshot = await loadSnapshot(db, 'con_a', rules, { now: NOW });
    expect(snapshot?.events).toHaveLength(2);
    expect(snapshot?.tags).toEqual(['beta', 'vip']);
    expect(evaluateConditions(rules, snapshot!, { now: NOW })).toBe(true);
  });

  it('treats a visitor with no contact as anonymous', async () => {
    const anonymous = parseConditions({ field: 'identified', op: 'is_false' });
    expect(await contactMatches(db, null, anonymous, { now: NOW })).toBe(true);
    expect(await contactMatches(db, 'con_missing', anonymous, { now: NOW })).toBe(true);
    expect(await contactMatches(db, 'con_a', anonymous, { now: NOW })).toBe(false);
    expect(evaluateConditions({ field: 'plan', op: 'is_empty' }, anonymousSnapshot())).toBe(true);
  });
});
