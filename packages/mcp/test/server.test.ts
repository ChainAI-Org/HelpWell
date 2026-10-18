import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db, DbHandle } from '@helpwell/core/db';
import { defaultDatabaseUrl } from '@helpwell/core/db';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LazyDatabase } from '../src/db.js';
import { callTool, TOOLS } from '../src/server.js';
import { TOOL_NAMES } from '../src/tools.js';
import { emptyDb, freshDb } from './helpers/db.js';
import { seed } from './helpers/seed.js';

let db: Db;

beforeAll(async () => {
  const handle = await freshDb();
  db = handle.db;
  await seed(db);
});

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('Expected a text content block.');
  return first.text;
}

describe('the advertised tools', () => {
  it('advertises exactly the tools the dispatcher can run', () => {
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('gives every tool a description, because that is all the model reads', () => {
    for (const tool of TOOLS) {
      expect(tool.description ?? '').not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('marks the arguments a tool cannot work without', () => {
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get('search_articles')?.inputSchema.required).toEqual(['query']);
    expect(byName.get('resolve_gap')?.inputSchema.required).toEqual(['id', 'articleSlug']);
    expect(byName.get('list_collections')?.inputSchema.required).toBeUndefined();
  });

  it('tells the agent that a collection id is the docs folder it writes into', () => {
    const description = TOOLS.find((tool) => tool.name === 'list_collections')?.description;
    expect(description).toMatch(/`id`/);
    expect(description).toMatch(/folder/);
    expect(description).toContain('docs/billing/<slug>.md');
  });

  it('is honest that conversation snippets are the customer’s own words', () => {
    const description = TOOLS.find((tool) => tool.name === 'recent_conversations')?.description;
    expect(description).toContain('[email]');
    expect(description).not.toMatch(/never included\.$/);
  });
});

describe('calling a tool', () => {
  it('answers with the result as JSON the host can parse', async () => {
    const result = await callTool(async () => db, 'list_collections', {});
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([
      expect.objectContaining({ id: 'billing', title: 'Billing and plans', articles: 2 }),
      expect.objectContaining({ id: 'account', title: 'Account', articles: 1 }),
    ]);
  });

  it('turns a tool failure into a readable error result rather than throwing', async () => {
    const result = await callTool(async () => db, 'read_article', { slug: 'nope/nope' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No published article at "nope\/nope"/);
  });

  it('answers an unknown tool with the list of real ones', async () => {
    const result = await callTool(async () => db, 'drop_tables', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('list_gaps');
  });

  it('passes arguments through to the tool', async () => {
    const result = await callTool(async () => db, 'recent_conversations', { limit: 1 });
    expect(JSON.parse(textOf(result))).toHaveLength(1);
  });
});

describe('when the database is unreachable', () => {
  it('reports the problem as a tool result instead of crashing the server', async () => {
    const database = new LazyDatabase({
      open: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    });
    const result = await callTool(database.resolver(), 'list_gaps', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('could not reach its database');
    expect(textOf(result)).toContain('ECONNREFUSED');
  });

  it('tries again on the next call, so starting Postgres late is enough to recover', async () => {
    let attempts = 0;
    const database = new LazyDatabase({
      open: async (): Promise<DbHandle> => {
        attempts += 1;
        if (attempts === 1) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        return freshDb();
      },
    });

    expect((await callTool(database.resolver(), 'list_collections', {})).isError).toBe(true);
    expect((await callTool(database.resolver(), 'list_collections', {})).isError).toBeFalsy();
    expect(attempts).toBe(2);
    await database.close();
  });

  it('only connects once after it succeeds', async () => {
    let attempts = 0;
    const database = new LazyDatabase({
      open: async (): Promise<DbHandle> => {
        attempts += 1;
        return freshDb();
      },
    });

    await callTool(database.resolver(), 'list_collections', {});
    await callTool(database.resolver(), 'list_collections', {});
    expect(attempts).toBe(1);
    await database.close();
  });

  it('says which database it looked in, and that `helpwell sync` creates it, when HelpWell is not there', async () => {
    const database = new LazyDatabase({ url: 'pglite://memory', open: () => emptyDb() });
    const result = await callTool(database.resolver(), 'list_gaps', {});
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('not installed in the database at pglite://memory');
    expect(text).toMatch(/`helpwell sync`/);
    expect(text).toMatch(/HELPWELL_DATABASE_URL/);
  });

  it('never prints a database password, even in that error', async () => {
    const database = new LazyDatabase({
      url: 'postgres://hw:s3cret@db.internal:5432/app',
      open: () => emptyDb(),
    });
    const text = textOf(await callTool(database.resolver(), 'list_gaps', {}));
    expect(text).toContain('postgres://hw:***@db.internal:5432/app');
    expect(text).not.toContain('s3cret');
  });

  it('hands the resolved url to whatever opens the connection', async () => {
    const seen: string[] = [];
    const database = new LazyDatabase({
      url: 'pglite://memory',
      open: async (url) => {
        seen.push(url);
        return freshDb();
      },
    });
    await callTool(database.resolver(), 'list_collections', {});
    expect(seen).toEqual(['pglite://memory']);
    await database.close();
  });
});

describe('which database it opens by default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is HELPWELL_DATABASE_URL when that is set, exactly as the CLI reads it', () => {
    vi.stubEnv('HELPWELL_DATABASE_URL', 'postgres://hw:pw@db.internal/app');
    expect(new LazyDatabase().url).toBe('postgres://hw:***@db.internal/app');
  });

  it("is the install's own helpwell/data when run inside a repo HelpWell is set up in", () => {
    vi.stubEnv('HELPWELL_DATABASE_URL', '');
    const root = mkdtempSync(join(tmpdir(), 'helpwell-mcp-'));
    mkdirSync(join(root, 'helpwell'));
    writeFileSync(join(root, 'helpwell', 'helpwell.config.json'), '{}');
    const nested = join(root, 'packages', 'web');
    mkdirSync(nested, { recursive: true });

    try {
      expect(defaultDatabaseUrl(nested)).toBe(`pglite://${join(root, 'helpwell', 'data')}`);
      expect(new LazyDatabase({ url: defaultDatabaseUrl(nested) }).url).toBe(
        `pglite://${join(root, 'helpwell', 'data')}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores the host app’s DATABASE_URL, which is usually production', () => {
    vi.stubEnv('HELPWELL_DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL', 'postgres://prod:pw@prod.internal/app');
    const root = mkdtempSync(join(tmpdir(), 'helpwell-mcp-'));
    try {
      expect(defaultDatabaseUrl(root)).toBe('pglite://memory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
