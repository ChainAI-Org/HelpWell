/**
 * Many installs in one process, each with its own database: what a hosted
 * service runs. Nothing one install holds may reach another: not settings,
 * not rate limits, not content, not conversations, not cached status pages,
 * not the keys and secrets each is given. And migrations must be safe when
 * several of them boot at once.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { createHelpWellHandler, type HelpWellHandler, signIdentity } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import type { Db } from '../src/db/client.js';
import { loadMigrations, migrate, schema, schemaExists } from '../src/db.js';
import { syncContent } from '../src/search/sync.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface Install {
  db: TestDb;
  handler: HelpWellHandler;
  admin: Client;
  visitor: Client;
  model: FakeModel;
}

let a: Install;
let b: Install;

async function install(
  name: string,
  files: Record<string, string | Uint8Array>,
  extra: Partial<Parameters<typeof createHelpWellHandler>[0]> = {},
): Promise<Install> {
  const db = await freshDb();
  const content = createMemoryContentSource(files);
  await syncContent(db.db, content);
  const model = new FakeModel([
    { text: `Answer from ${name}.`, cites: [1], certainty: 'answered' },
  ]);
  const token = `admin-token-${name}`;
  const handler = createHelpWellHandler({
    db: db.db,
    adminToken: token,
    model,
    content,
    env: {},
    fetchStatusPage: async () => ({
      page: { name: name, url: 'https://status.shared.example' },
      status: { indicator: name === 'a' ? 'none' : 'major', description: `${name} status` },
    }),
    ...extra,
  });
  const admin = client(handler, { adminToken: token });
  await admin.call('/admin/settings', {
    method: 'PATCH',
    body: {
      product: { name: `Product ${name.toUpperCase()}` },
      changelog: { roadmap: { enabled: true, whoCanSubmit: 'anyone' } },
      // Both installs read the same status page URL.
      widget: { statusUrl: 'https://status.shared.example' },
    },
  });
  // The same address on both, as a visitor behind one NAT would be.
  return { db, handler, admin, visitor: client(handler, { ip: '198.51.100.7' }), model };
}

beforeEach(async () => {
  a = await install('a', {
    'billing/invoices.md': '---\ntitle: Exporting invoices\n---\n\nOpen Billing, then Export.\n',
    '_screenshots/a-only.png': PNG,
  });
  b = await install('b', {
    'shipping/tracking.md': '---\ntitle: Tracking a parcel\n---\n\nOpen Orders, then Track.\n',
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await a.db.close();
  await b.db.close();
});

describe('two installs in one process', () => {
  it('keep their own settings', async () => {
    const configA = (await (await a.visitor.call('/config')).json()) as {
      product: { name: string };
    };
    const configB = (await (await b.visitor.call('/config')).json()) as {
      product: { name: string };
    };
    expect(configA.product.name).toBe('Product A');
    expect(configB.product.name).toBe('Product B');

    await a.admin.call('/admin/settings', {
      method: 'PATCH',
      body: { product: { name: 'Renamed' } },
    });
    const again = (await (await b.visitor.call('/config')).json()) as { product: { name: string } };
    expect(again.product.name).toBe('Product B');
  });

  it('see a save at once in every handler of their own, and never in each other’s', async () => {
    // A second handler on install A's database: its help centre's, say, or
    // another route file of the same app, each with a store of its own.
    const alsoA = client(createHelpWellHandler({ db: a.db.db, env: {} }));
    const name = async (on: Client) =>
      ((await (await on.call('/config')).json()) as { product: { name: string } }).product.name;
    expect(await name(alsoA)).toBe('Product A');
    expect(await name(b.visitor)).toBe('Product B');

    await a.admin.call('/admin/settings', { method: 'PATCH', body: { product: { name: 'Now' } } });
    expect(await name(alsoA)).toBe('Now');
    expect(await name(a.visitor)).toBe('Now');
    expect(await name(b.visitor)).toBe('Product B');
  });

  it('count rate limits separately, even for the same visitor address', async () => {
    // No cookie kept between calls, so every one counts against the address.
    const idea = (install: Install, title: string) => {
      install.visitor.reset();
      return install.visitor.call('/roadmap', { body: { title } });
    };
    for (let i = 0; i < 5; i++) expect((await idea(a, `Idea ${i}`)).status).toBe(201);
    expect((await idea(a, 'One too many')).status).toBe(429);
    expect((await idea(b, 'First on B')).status).toBe(201);
  });

  it('search and serve only their own content', async () => {
    const searchA = (await (await a.visitor.call('/search?q=tracking')).json()) as {
      results: unknown[];
    };
    const searchB = (await (await b.visitor.call('/search?q=tracking')).json()) as {
      results: { slug: string }[];
    };
    expect(searchA.results).toEqual([]);
    expect(searchB.results.map((r) => r.slug)).toEqual(['shipping/tracking']);

    expect((await a.visitor.call('/screenshots/a-only.png')).status).toBe(200);
    expect((await b.visitor.call('/screenshots/a-only.png')).status).toBe(404);
  });

  it('keep conversations apart, and answer with their own model', async () => {
    const reply = await a.visitor.call('/chat', { body: { message: 'How do I export invoices?' } });
    const { conversationId, text } = (await reply.json()) as {
      conversationId: string;
      text: string;
    };
    expect(text).toContain('Answer from a');
    expect(a.model.requests).toHaveLength(1);
    expect(b.model.requests).toHaveLength(0);

    const listB = (await (await b.admin.call('/admin/conversations')).json()) as {
      items: unknown[];
    };
    expect(listB.items).toEqual([]);
    expect((await b.admin.call(`/admin/conversations/${conversationId}`)).status).toBe(404);
    expect((await a.admin.call(`/admin/conversations/${conversationId}`)).status).toBe(200);
  });

  it('accept only their own admin token', async () => {
    const crossed = client(b.handler, { adminToken: 'admin-token-a' });
    expect((await crossed.call('/admin/settings')).status).toBe(401);
  });

  it('read a shared status page URL through their own fetcher, not each other’s cache', async () => {
    const statusA = (await (await a.visitor.call('/status')).json()) as { level: string };
    const statusB = (await (await b.visitor.call('/status')).json()) as { level: string };
    expect(statusA.level).toBe('operational');
    expect(statusB.level).not.toBe('operational');
  });

  it('never fall back to a secret in the host process’s environment', async () => {
    vi.stubEnv('HELPWELL_IDENTITY_SECRET', 'the-hosts-own-secret');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-the-hosts-own-key');
    const token = await signIdentity(
      { id: 'user_1', email: 'jo@acme.test' },
      'the-hosts-own-secret',
    );

    const isolated = createHelpWellHandler({ db: a.db.db, env: {} });
    expect((await client(isolated).call('/identify', { body: { token } })).status).toBe(501);

    const own = createHelpWellHandler({
      db: a.db.db,
      env: { HELPWELL_IDENTITY_SECRET: 'the-hosts-own-secret' },
    });
    expect((await client(own).call('/identify', { body: { token } })).status).toBe(200);

    // Without `env`, a single install reads the process environment as before.
    const single = createHelpWellHandler({ db: b.db.db });
    expect((await client(single).call('/identify', { body: { token } })).status).toBe(200);
  });

  it('scope the visitor cookie to their own path when given one', async () => {
    const scoped = createHelpWellHandler({ db: a.db.db, cookiePath: '/i/acme/' });
    const response = await scoped(
      new Request('http://localhost/api/helpwell/visitor', { method: 'POST' }),
    );
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('hw_visitor='));
    expect(cookie).toContain('Path=/i/acme;');
    expect(cookie).not.toContain('Path=/;');
    expect(() => createHelpWellHandler({ db: a.db.db, cookiePath: '/x; Domain=evil' })).toThrow();
  });
});

describe('several processes on one database', () => {
  it('see each other’s Settings saves on their next request', async () => {
    // Two handles on one database, sharing no memory, as two servers behind
    // a load balancer would.
    const pglite = new PGlite();
    try {
      const one = drizzle(pglite, { schema }) as unknown as Db;
      const two = drizzle(pglite, { schema }) as unknown as Db;
      await migrate(one);
      const token = 'admin-token-shared';
      const first = client(createHelpWellHandler({ db: one, adminToken: token, env: {} }), {
        adminToken: token,
      });
      const second = client(createHelpWellHandler({ db: two, env: {} }));
      const name = async () =>
        ((await (await second.call('/config')).json()) as { product: { name: string } }).product
          .name;
      const before = await name();

      await first.call('/admin/settings', {
        method: 'PATCH',
        body: { product: { name: 'Saved on the first server' } },
      });
      expect(before).not.toBe('Saved on the first server');
      expect(await name()).toBe('Saved on the first server');
    } finally {
      await pglite.close();
    }
  });
});

describe('migrations when several processes boot at once', () => {
  it('take the lock before creating anything, even the bookkeeping table', async () => {
    const statements: string[] = [];
    const pglite = new PGlite();
    const db = drizzle(pglite, {
      schema,
      logger: { logQuery: (query) => statements.push(query) },
    }) as unknown as Db;
    try {
      await migrate(db);
      const lock = statements.findIndex((q) => q.includes('pg_advisory_xact_lock'));
      const firstDdl = statements.findIndex((q) => /\bCREATE\b/i.test(q));
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(firstDdl).toBeGreaterThan(lock);
      expect(await schemaExists(db)).toBe(true);
    } finally {
      await pglite.close();
    }
  });

  it('migrate separate databases side by side, and the same one twice', async () => {
    const [one, two] = [await freshDb(), await freshDb()];
    try {
      const again = await Promise.all([migrate(one.db), migrate(two.db), migrate(one.db)]);
      for (const result of again) expect(result.applied).toEqual([]);
      expect(again[0]?.alreadyApplied).toHaveLength(loadMigrations().length);
    } finally {
      await one.close();
      await two.close();
    }
  });
});
