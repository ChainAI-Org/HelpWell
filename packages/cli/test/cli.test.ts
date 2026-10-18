import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModel } from '@helpwell/core/agent';
import { createDb, type Db, migrate, schema } from '@helpwell/core/db';
import { createChangelogEntry } from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { getTableName } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/args.js';
import { capture } from '../src/commands/capture.js';
import { changelog } from '../src/commands/changelog.js';
import { EXPORTED_TABLES, runExport, runMigrate } from '../src/commands/data.js';
import {
  buildRepoContext,
  diffFor,
  docsGenerate,
  docsUpdate,
  gitDiff,
  lastRef,
  parseDrafts,
  parseJsonBlock,
  parseVerdict,
  relevantArticles,
  replaceBody,
  splitDiff,
} from '../src/commands/docs.js';
import { doctor } from '../src/commands/doctor.js';
import { EvalCasesError, loadCases, runEvals } from '../src/commands/evals.js';
import { init } from '../src/commands/init.js';
import { settingsPull, settingsPush } from '../src/commands/settings.js';
import { sync } from '../src/commands/sync.js';
import { parseGitHubRepo } from '../src/github-releases.js';
import { findRoot, loadProject, readShots, redactUrl } from '../src/project.js';
import { run } from '../src/run.js';
import { traced } from '../src/traced.js';
import { isVerbose, setVerbose } from '../src/ui.js';

let dir: string;

/** Everything the CLI prints, so tests can assert on what a person sees. */
let output: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-cli-'));
  output = [];
  // Never reach a real provider or a real database from a test, even on a
  // machine that has them configured.
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HELPWELL_DATABASE_URL;
  delete process.env.DATABASE_URL;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HELPWELL_DATABASE_URL;
  delete process.env.DATABASE_URL;
});

function printed(): string {
  return output.join('');
}

function write(relative: string, contents: string): void {
  const path = join(dir, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function configPath(): string {
  return join(dir, 'helpwell', 'helpwell.config.json');
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitInit(): void {
  git('init', '-q');
  git('config', 'user.email', 'tests@example.com');
  git('config', 'user.name', 'HelpWell tests');
  git('config', 'commit.gpgsign', 'false');
}

function gitCommit(message: string): string {
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

/** Open the project's embedded database directly, to inspect what a command left behind. */
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const handle = await createDb({ url: `pglite://${join(dir, 'helpwell', 'data')}` });
  try {
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

const SLOW = 120_000;

describe('parseArgs', () => {
  it('separates positionals from flags', () => {
    const parsed = parseArgs(['docs', 'generate', '--count', '3', '--dry-run']);
    expect(parsed.positionals).toEqual(['docs', 'generate']);
    expect(parsed.flags).toEqual({ count: '3', dryRun: true });
  });

  it('understands --key=value', () => {
    expect(parseArgs(['--name=Acme Co']).flags).toEqual({ name: 'Acme Co' });
  });

  it('reads --no-thing as false', () => {
    expect(parseArgs(['sync', '--no-embeddings']).flags).toEqual({ embeddings: false });
  });

  it('camel-cases a dashed flag', () => {
    expect(parseArgs(['--dry-run', '--app-url', 'x']).flags).toEqual({
      dryRun: true,
      appUrl: 'x',
    });
  });

  it('takes a value after a single short flag, but splits a cluster', () => {
    expect(parseArgs(['-o', 'out.json']).flags).toEqual({ o: 'out.json' });
    expect(parseArgs(['-abc']).flags).toEqual({ a: true, b: true, c: true });
  });

  it('passes everything after -- through untouched', () => {
    const parsed = parseArgs(['ask', '--', '--not-a-flag']);
    expect(parsed.rest).toEqual(['--not-a-flag']);
    expect(parsed.flags).toEqual({});
  });

  it('keeps a question with spaces as positionals', () => {
    const parsed = parseArgs(['ask', 'how', 'do', 'I', 'export']);
    expect(parsed.positionals.slice(1).join(' ')).toBe('how do I export');
  });

  it('never lets a switch swallow the word after it', () => {
    const parsed = parseArgs(['ask', '--offline', 'how do I export?']);
    expect(parsed.flags).toEqual({ offline: true });
    expect(parsed.positionals).toEqual(['ask', 'how do I export?']);
    expect(parseArgs(['eval', '--dry-run', '--threshold', '80']).flags).toEqual({
      dryRun: true,
      threshold: '80',
    });
    expect(parseArgs(['sync', '--force=false']).flags).toEqual({ force: 'false' });
    expect(parseArgs(['-v', 'sync']).positionals).toEqual(['sync']);
    expect(parseArgs(['changelog', '--release', '1.2.0']).flags).toEqual({ release: '1.2.0' });
  });
});

describe('init', () => {
  it('writes a complete, readable install', async () => {
    const result = await init({ cwd: dir, name: 'Acme' });

    expect(result.written).toContain('helpwell/helpwell.config.json');
    expect(result.written).toContain('helpwell/instructions.md');
    expect(result.written).toContain('helpwell/playbook.md');
    expect(result.written).toContain('docs/getting-started/welcome.md');
    expect(result.written).toContain('.env.example');

    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(config.settings.product.name).toBe('Acme');
    expect(config.docs).toBe('docs');
    expect(config.screenshots).toEqual({ dir: 'docs/_screenshots', shots: [] });
    expect(readFileSync(join(dir, 'docs/README.md'), 'utf8')).toContain('"shots"');
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).not.toMatch(/^DATABASE_URL/m);
  });

  it('puts the default rules in the instructions rather than a separate screen', () => {
    return init({ cwd: dir, name: 'Acme' }).then(() => {
      const instructions = readFileSync(join(dir, 'helpwell/instructions.md'), 'utf8');
      expect(instructions.length).toBeGreaterThan(200);
      expect(instructions).toMatch(/Acme/);
    });
  });

  it('keeps the local database out of git', async () => {
    await init({ cwd: dir, name: 'Acme' });
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('helpwell/data/');
  });

  it('does not clobber an existing .gitignore', async () => {
    write('.gitignore', 'node_modules\n');
    await init({ cwd: dir, name: 'Acme' });
    const ignore = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(ignore).toContain('node_modules');
    expect(ignore).toContain('helpwell/data/');
  });

  it('leaves existing files alone, and says which', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const second = await init({ cwd: dir, name: 'Acme' });
    expect(second.written).toHaveLength(0);
    expect(second.skipped).toContain('helpwell/instructions.md');
    expect(printed()).toContain('--force');
  });

  it('overwrites with --force', async () => {
    await init({ cwd: dir, name: 'Acme' });
    writeFileSync(join(dir, 'helpwell/instructions.md'), 'gone', 'utf8');
    await init({ cwd: dir, name: 'Acme', force: true });
    expect(readFileSync(join(dir, 'helpwell/instructions.md'), 'utf8')).not.toBe('gone');
  });

  it('writes nothing on a dry run', async () => {
    const result = await init({ cwd: dir, name: 'Acme', dryRun: true });
    expect(result.written.length).toBeGreaterThan(0);
    expect(existsSync(configPath())).toBe(false);
  });

  it('guesses the product name from package.json', async () => {
    write('package.json', JSON.stringify({ name: '@acme/expense-tracker' }));
    await init({ cwd: dir });
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(config.settings.product.name).toBe('Expense Tracker');
  });

  it('prints the mount snippet for the framework asked for', async () => {
    await init({ cwd: dir, name: 'Acme', framework: 'remix' });
    expect(printed()).toContain('app/routes/api.helpwell');
  });

  it('fills both app URLs from --app-url, and only then', async () => {
    await init({ cwd: dir, name: 'Acme', appUrl: 'https://app.acme.com' });
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(config.appUrl).toBe('https://app.acme.com');
    expect(config.settings.product.appUrl).toBe('https://app.acme.com');
  });
});

describe('finding the project', () => {
  it('walks up from a nested directory, the way git does', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const nested = join(dir, 'packages', 'web', 'src');
    mkdirSync(nested, { recursive: true });
    expect(findRoot(nested)).toBe(dir);
  });

  it('returns null outside a project', () => {
    expect(findRoot(dir)).toBeNull();
  });

  it('fills in anything an older config file is missing', async () => {
    await init({ cwd: dir, name: 'Acme' });
    write(
      'helpwell/helpwell.config.json',
      JSON.stringify({ settings: { product: { name: 'Acme' } } }),
    );
    const project = loadProject(dir);
    expect(project.config.settings.agent.models.chat).toBeTruthy();
    expect(project.config.docs).toBe('docs');
    expect(project.config.screenshots).toEqual({ dir: 'docs/_screenshots', shots: [] });
  });
});

describe('redactUrl', () => {
  it('hides the password', () => {
    expect(redactUrl('postgres://user:hunter2@db.example.com:5432/app')).toBe(
      'postgres://user:***@db.example.com:5432/app',
    );
  });

  it('leaves a url with no password alone', () => {
    expect(redactUrl('pglite://memory')).toBe('pglite://memory');
  });
});

describe('sync', () => {
  beforeEach(async () => {
    await init({ cwd: dir, name: 'Acme' });
    write(
      'docs/billing/invoices.md',
      `---
title: Exporting invoices
description: Download a PDF of any invoice.
status: published
---

Open Billing, then Invoices, then press Export.
`,
    );
  });

  it('indexes the repo and reports what it did', async () => {
    const result = await sync({ cwd: dir });
    expect(result.articles).toBe(2);
    expect(result.collections).toBe(2);
    expect(result.indexed).toBe(2);
    expect(printed()).toContain('Indexed 2 articles');
  });

  it('does nothing the second time, because nothing changed', async () => {
    await sync({ cwd: dir });
    const second = await sync({ cwd: dir });
    expect(second.indexed).toBe(0);
    expect(second.unchanged).toBe(2);
  });

  it('notices an edit', async () => {
    await sync({ cwd: dir });
    write(
      'docs/billing/invoices.md',
      `---
title: Exporting invoices
status: published
---

Open Billing, then Invoices, then press Download.
`,
    );
    const second = await sync({ cwd: dir });
    expect(second.indexed).toBe(1);
  });

  it('drops an article that was deleted from the repo', async () => {
    await sync({ cwd: dir });
    rmSync(join(dir, 'docs/billing/invoices.md'));
    const second = await sync({ cwd: dir });
    expect(second.removed).toBe(1);
  });

  it('stops counting a folder as a collection once it has no articles, and deletes no file', async () => {
    write('docs/billing/diagram.png', 'not really a png');
    await sync({ cwd: dir });
    // The folder keeps its image, but its one article goes.
    rmSync(join(dir, 'docs/billing/invoices.md'));
    const second = await sync({ cwd: dir });
    expect(second.collectionsRemoved).toBe(1);
    expect(printed()).toContain('1 folder is no longer a collection');
    expect(printed()).toContain('no file was touched');
    expect(existsSync(join(dir, 'docs/billing/diagram.png'))).toBe(true);
  });

  it('says why embeddings were skipped rather than failing', async () => {
    const result = await sync({ cwd: dir });
    expect(result.embedded).toBe(0);
    expect(printed()).toContain('OPENROUTER_API_KEY');
    expect(printed()).toContain('Full-text search works without embeddings');
  });

  it('says so plainly when there are no docs at all', async () => {
    rmSync(join(dir, 'docs'), { recursive: true });
    const result = await sync({ cwd: dir });
    expect(result.articles).toBe(0);
    expect(printed()).toContain('No articles found');
  });

  it('says embeddings are off when no model is configured, rather than showing a bare zero', async () => {
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.settings.agent.models.embeddings = '';
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');
    // A key is set, so the empty model is the only reason nothing is embedded.
    // Off means no provider is built, so nothing can reach the network.
    process.env.OPENROUTER_API_KEY = 'sk-or-not-a-real-key';

    const result = await sync({ cwd: dir });

    expect(result.embedded).toBe(0);
    expect(result.embeddings).toBe('off');
    expect(printed()).toContain('off (no embeddings model configured)');
    expect(printed()).not.toContain('skipped (no OPENROUTER_API_KEY)');
    expect(printed()).not.toContain('failed');
  });
});

describe('settings: which copy wins', () => {
  const past = new Date(Date.now() - 3_600_000);

  it('pushes the file when the database has nothing newer', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const result = await sync({ cwd: dir });
    expect(result.settings).toBe('pushed');
    expect(printed()).toContain('Pushed settings');
    const again = await sync({ cwd: dir });
    expect(again.settings).toBe('same');
    await withDb(async (db) => {
      expect((await new SettingsStore(db).get()).product.name).toBe('Acme');
    });
  });

  it(
    'leaves dashboard edits alone when the database is newer, and says how to resolve it',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await sync({ cwd: dir });
      utimesSync(configPath(), past, past);
      await withDb((db) =>
        new SettingsStore(db).update({ product: { name: 'From the dashboard' } }),
      );

      output = [];
      const result = await sync({ cwd: dir });
      expect(result.settings).toBe('kept');
      expect(printed()).toContain('newer than helpwell.config.json');
      expect(printed()).toContain('helpwell settings pull');
      await withDb(async (db) => {
        expect((await new SettingsStore(db).get()).product.name).toBe('From the dashboard');
      });
    },
    SLOW,
  );

  it(
    'pull writes the database copy into the file and keeps the other keys',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await sync({ cwd: dir });
      const raw = JSON.parse(readFileSync(configPath(), 'utf8'));
      raw.custom = { keep: true };
      writeFileSync(configPath(), JSON.stringify(raw), 'utf8');
      await withDb((db) =>
        new SettingsStore(db).update({ product: { name: 'From the dashboard' } }),
      );

      await settingsPull({ cwd: dir });

      const after = JSON.parse(readFileSync(configPath(), 'utf8'));
      expect(after.settings.product.name).toBe('From the dashboard');
      expect(after.custom).toEqual({ keep: true });
      expect(after.docs).toBe('docs');
      expect(loadProject(dir).config.settings.product.name).toBe('From the dashboard');
    },
    SLOW,
  );

  it(
    'push, and sync --settings, overwrite the database on purpose',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await sync({ cwd: dir });
      utimesSync(configPath(), past, past);
      await withDb((db) =>
        new SettingsStore(db).update({ product: { name: 'From the dashboard' } }),
      );

      const forced = await sync({ cwd: dir, settings: 'force' });
      expect(forced.settings).toBe('pushed');
      await withDb(async (db) => {
        expect((await new SettingsStore(db).get()).product.name).toBe('Acme');
        await new SettingsStore(db).update({ product: { name: 'Again' } });
      });

      await settingsPush({ cwd: dir });
      await withDb(async (db) => {
        expect((await new SettingsStore(db).get()).product.name).toBe('Acme');
      });
    },
    SLOW,
  );
});

describe('doctor', () => {
  it('tells someone to run init when there is no project', async () => {
    const result = await doctor({ cwd: dir });
    expect(result.ok).toBe(false);
    expect(printed()).toContain('helpwell init');
  });

  it('checks the browser for screenshots only once some are configured', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const missing = async () => 'no-browser' as const;
    let result = await doctor({ cwd: dir, captureBrowser: missing });
    expect(result.checks.map((check) => check.name)).not.toContain('Screenshots');
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.screenshots = { dir: 'docs/_screenshots', shots: [{ name: 'billing', path: '/b' }] };
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');
    result = await doctor({ cwd: dir, captureBrowser: missing });
    expect(result.checks.find((check) => check.name === 'Screenshots')).toMatchObject({
      state: 'warn',
      detail:
        '1 configured, but Chromium is not downloaded, so `helpwell capture` cannot take them.',
    });
    expect(printed()).toContain('npx playwright install --with-deps chromium');
    expect(printed()).toContain('npx helpwell prompt capture');
    result = await doctor({ cwd: dir, captureBrowser: async () => 'ready' });
    expect(result.checks.find((check) => check.name === 'Screenshots')?.state).toBe('pass');
  });

  it('passes a fresh, synced install', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await sync({ cwd: dir });
    const result = await doctor({ cwd: dir });

    expect(result.ok).toBe(true);
    const names = result.checks.map((check) => check.name);
    expect(names).toContain('Database');
    expect(names).toContain('Settings');
    expect(names).toContain('Search');

    // Everything must actually pass, not merely not fail. The tests here have
    // no OPENROUTER_API_KEY, and that one warning is the only one allowed:
    // a person who has just installed HelpWell correctly should not be handed
    // a list of things to look at.
    const notPassing = result.checks.filter(
      (check) => check.state !== 'pass' && check.name !== 'OpenRouter key',
    );
    expect(notPassing).toEqual([]);
  });

  it('says search is working, rather than warning about an index it has', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await sync({ cwd: dir });
    const search = (await doctor({ cwd: dir })).checks.find((c) => c.name === 'Search');

    expect(search?.state).toBe('pass');
    expect(search?.detail).toMatch(/returned \d+ result/);
  });

  it('says the index is empty when it is, rather than blaming search', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await runMigrate({ cwd: dir });
    const search = (await doctor({ cwd: dir })).checks.find((c) => c.name === 'Search');

    expect(search?.state).toBe('warn');
    expect(search?.detail).toContain('nothing is indexed');
    expect(search?.fix).toContain('helpwell sync');
  });

  it('warns about a missing key without failing', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await sync({ cwd: dir });
    const result = await doctor({ cwd: dir });
    const key = result.checks.find((check) => check.name === 'OpenRouter key');
    expect(key?.state).toBe('warn');
    expect(key?.fix).toContain('OPENROUTER_API_KEY');
    expect(result.ok).toBe(true);
  });

  it('spots a key that is not an OpenRouter key', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await sync({ cwd: dir });
    // Set after syncing: doctor is what inspects the key, not the indexer.
    process.env.OPENROUTER_API_KEY = 'sk-proj-anopenaikey';
    const result = await doctor({ cwd: dir });
    const format = result.checks.find((check) => check.name === 'Key format');
    expect(format?.state).toBe('warn');
    expect(format?.fix).toContain('sk-or-');
  });

  it('ignores DATABASE_URL, and says so', async () => {
    // A connection string nothing could reach. If it were adopted, migrate
    // would fail rather than open the embedded database.
    process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';
    await init({ cwd: dir, name: 'Acme' });
    await runMigrate({ cwd: dir });
    expect(existsSync(join(dir, 'helpwell', 'data'))).toBe(true);

    const result = await doctor({ cwd: dir });
    const check = result.checks.find((c) => c.name === 'DATABASE_URL');
    expect(check?.state).toBe('warn');
    expect(check?.detail).toContain('does not use DATABASE_URL');
    expect(check?.detail).toContain('pglite://');
    expect(result.ok).toBe(true);
  });

  it('says plainly when embeddings are off, rather than showing a silent zero', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.settings.agent.models.embeddings = '';
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');
    await sync({ cwd: dir });

    const check = (await doctor({ cwd: dir })).checks.find((c) => c.name === 'Embeddings');
    expect(check?.state).toBe('pass');
    expect(check?.detail).toContain('off (no embeddings model configured)');
  });

  it('still finds an identified-only collection in its search check', async () => {
    await init({ cwd: dir, name: 'Acme' });
    rmSync(join(dir, 'docs/getting-started'), { recursive: true });
    write(
      'docs/internal/_meta.json',
      '{ "title": "For customers who signed in", "visibility": "identified" }',
    );
    write(
      'docs/internal/renewals.md',
      '---\ntitle: Renewing an enterprise contract\nstatus: published\n---\n\nAsk your account manager.\n',
    );
    await sync({ cwd: dir });

    // Anonymous searches hide the collection; the admin check must not.
    const search = (await doctor({ cwd: dir })).checks.find((c) => c.name === 'Search');
    expect(search?.state).toBe('pass');
  });
});

describe('export', () => {
  it(
    'writes every table, with secrets redacted',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await sync({ cwd: dir });
      await withDb(async (db) => {
        await new SettingsStore(db).update({
          webhooks: [{ url: 'https://hooks.example.com/in', secret: 'shh-webhook-secret' }],
        });
        await db.insert(schema.events).values({
          id: 'evt_1',
          name: 'page_view',
          props: { plan: 'pro' },
          url: 'https://app.example.com/u/jane',
        });
      });

      const out = join(dir, 'export.json');
      const document = await runExport({ cwd: dir, out });
      const dump = JSON.parse(readFileSync(out, 'utf8'));

      expect(dump.product).toBe('Acme');
      expect(dump.anonymised).toBe(false);
      expect(dump.data.article_index).toHaveLength(1);

      // Every table in the schema, derived from the schema, minus settings.
      const inSchema = Object.values(schema)
        .filter(
          (value) =>
            typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
        )
        .map((table) => getTableName(table as never))
        .filter((name) => name !== 'settings');
      expect([...EXPORTED_TABLES].sort()).toEqual([...inSchema].sort());
      for (const table of EXPORTED_TABLES) expect(dump.data, table).toHaveProperty(table);
      expect(EXPORTED_TABLES).toEqual(
        expect.arrayContaining([
          'events',
          'webhook_deliveries',
          'blocked_attempts',
          'collection_index',
        ]),
      );
      expect(dump.data.events).toHaveLength(1);

      expect(dump.settings.webhooks[0].url).toBe('https://hooks.example.com/in');
      expect(dump.settings.webhooks[0].secret).toBe('<redacted>');
      expect(document).not.toContain('shh-');
    },
    SLOW,
  );

  it('redacts secrets on stdout too', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await runMigrate({ cwd: dir });
    await withDb((db) =>
      new SettingsStore(db).update({
        webhooks: [{ url: 'https://h.example.com', secret: 'shh-stdout' }],
      }),
    );
    await runExport({ cwd: dir, anonymise: true });
    expect(printed()).toContain('"exportedAt"');
    expect(printed()).not.toContain('shh-stdout');
  });

  it(
    'anonymises what people typed, not just who they are',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await runMigrate({ cwd: dir });
      await withDb(async (db) => {
        await db.insert(schema.contacts).values({
          id: 'con_1',
          email: 'jane@example.com',
          name: 'Jane',
          country: 'NZ',
          city: 'Wellington',
          locale: 'en-NZ',
          timezone: 'Pacific/Auckland',
        });
        await db.insert(schema.conversations).values({
          id: 'cnv_1',
          contactId: 'con_1',
          ratingComment: 'The agent was rude to me',
          pageUrl: 'https://app.example.com/u/jane',
        });
        await db.insert(schema.messages).values({
          id: 'msg_1',
          conversationId: 'cnv_1',
          role: 'customer',
          body: 'My card was charged twice',
          feedbackComment: 'Wrong answer entirely',
        });
        await db
          .insert(schema.searches)
          .values({ id: 'sch_1', query: 'refund my duplicate charge' });
        await db.insert(schema.gaps).values({
          id: 'gap_1',
          question: 'Can I get a refund for a duplicate charge?',
          variants: ['refund duplicate charge'],
        });
        await db.insert(schema.roadmapItems).values({
          id: 'rmp_1',
          title: 'Let me export to Xero',
          body: 'My accountant needs it',
        });
        await db.insert(schema.events).values({
          id: 'evt_1',
          name: 'page_view',
          props: { email: 'jane@example.com' },
          url: 'https://app.example.com/u/jane',
        });
      });

      const document = await runExport({
        cwd: dir,
        out: join(dir, 'export.json'),
        anonymise: true,
      });
      for (const secret of [
        'jane@example.com',
        'Jane',
        'Wellington',
        'Pacific/Auckland',
        'rude',
        'charged twice',
        'Wrong answer',
        'duplicate charge',
        'Xero',
        'accountant',
        '/u/jane',
      ]) {
        expect(document, secret).not.toContain(secret);
      }

      const dump = JSON.parse(document);
      expect(dump.anonymised).toBe(true);
      expect(dump.data.searches[0].query).toMatch(/^hashed:/);
      expect(dump.data.gaps[0].variants[0]).toMatch(/^hashed:/);
      expect(dump.data.messages[0].body).toMatch(/^\[\d+ chars\]$/);
      expect(dump.data.contacts[0].id).toBe('con_1');
      expect(dump.data.events[0].name).toBe('page_view');
      expect(dump.data.events[0].props).toEqual({});
    },
    SLOW,
  );
});

describe('parsing what a model returned', () => {
  it('finds JSON inside a fenced block', () => {
    expect(parseJsonBlock('Here you go:\n```json\n{"a":1}\n```\nHope that helps')).toEqual({
      a: 1,
    });
  });

  it('finds JSON with prose around it and no fence', () => {
    expect(parseJsonBlock('Sure! {"a":1} — let me know')).toEqual({ a: 1 });
  });

  it('returns null rather than throwing on nonsense', () => {
    expect(parseJsonBlock('I am afraid I cannot do that')).toBeNull();
  });

  it('reads drafted articles, skipping incomplete ones', () => {
    const drafts = parseDrafts(
      JSON.stringify({
        articles: [
          { collection: 'Billing', title: 'Invoices', description: 'd', body: 'b' },
          { title: 'No body' },
        ],
      }),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.collection).toBe('Billing');
  });

  it('defaults a draft with no collection to Help', () => {
    const drafts = parseDrafts(JSON.stringify([{ title: 'T', body: 'B' }]));
    expect(drafts[0]?.collection).toBe('Help');
  });

  it('reads a staleness verdict', () => {
    expect(parseVerdict('{"stale":true,"reason":"Price changed","body":"New text"}')).toEqual({
      stale: true,
      reason: 'Price changed',
      body: 'New text',
    });
  });

  it('treats a missing stale flag as not stale', () => {
    expect(parseVerdict('{"reason":"looks fine"}')?.stale).toBe(false);
  });
});

describe('docs generate: what the model is shown', () => {
  it('builds a budgeted context from the files that matter, and nothing secret', () => {
    write('README.md', '# Acme\nAcme tracks expenses.');
    write(
      'package.json',
      JSON.stringify({
        name: 'acme',
        description: 'Expenses',
        scripts: { dev: 'next dev' },
        dependencies: { 'left-pad': '1' },
      }),
    );
    write(
      'src/routes/invoices.ts',
      "// Invoices export as PDF.\nrouter.get('/invoices/:id/pdf', handler);",
    );
    write('src/http.ts', "app.post('/webhooks', receive); // Webhooks retry 5 times.");
    write('src/util.ts', 'export const add = (a, b) => a + b;');
    write('config/plans.ts', 'export const plans = { pro: { seats: 10 } };');
    write('locales/de.json', '{"export":"Rechnungen exportieren"}');
    write('locales/en.json', '{"export":"Export invoices"}');
    write('CHANGELOG.md', '## 1.2.0\n- PDF export');
    write('node_modules/left-pad/index.js', 'secret_should_not_appear');
    write('config/secrets.ts', 'export const key = "leaked-key";');
    write('src/routes/big.ts', `// ${'x'.repeat(10_000)}`);

    const context = buildRepoContext(dir);

    expect(context.text).toContain('Invoices export as PDF');
    expect(context.text).toContain('Webhooks retry 5 times');
    expect(context.text).not.toContain('a + b');
    expect(context.text).toContain('seats: 10');
    expect(context.text).toContain('Export invoices');
    expect(context.text.indexOf('locales/en.json')).toBeLessThan(
      context.text.indexOf('locales/de.json'),
    );
    expect(context.text).toContain('PDF export');
    expect(context.text).toContain('"dev": "next dev"');
    expect(context.text).not.toContain('left-pad');
    expect(context.text).not.toContain('secret_should_not_appear');
    expect(context.text).not.toContain('leaked-key');
    expect(context.text).toContain('[truncated]');
    expect(context.chars).toBeLessThanOrEqual(60_000);
    expect(context.files).toBeGreaterThanOrEqual(7);
  });

  it('lists files through git when it can, untracked ones included, ignored ones not', () => {
    gitInit();
    write('README.md', 'Acme');
    write('src/server.ts', "server.get('/', home); // Home page");
    write('ignored.ts', "app.get('/x', y); // IGNORED");
    write('.gitignore', 'ignored.ts\n');
    gitCommit('init');
    write('src/new-route.ts', "app.get('/new', n); // NEW UNTRACKED");

    const context = buildRepoContext(dir);
    expect(context.text).toContain('Home page');
    expect(context.text).toContain('NEW UNTRACKED');
    expect(context.text).not.toContain('IGNORED');
  });
});

describe('docs generate', () => {
  function drafts(articles: unknown[]): FakeModel {
    return new FakeModel([{ text: JSON.stringify({ articles }) }]);
  }

  it('drafts from the repo, names new collections, and reports collisions', async () => {
    await init({ cwd: dir, name: 'Acme' });
    write(
      'src/routes/billing.ts',
      "// Invoices are generated on the 1st of each month.\napp.get('/invoices', list);",
    );
    const model = drafts([
      {
        collection: 'Billing & Invoices',
        title: 'How do I export an invoice?',
        description: 'd',
        body: 'Open Billing.',
      },
      { collection: 'Getting started', title: 'Welcome', description: 'd', body: 'dup' },
      {
        collection: 'Billing & Invoices',
        title: 'When are invoices generated?',
        description: 'd',
        body: 'On the 1st.',
      },
    ]);

    const written = await docsGenerate({ cwd: dir, model, count: 5 });

    expect(written.map((w) => w.path)).toEqual([
      'docs/billing-invoices/how-do-i-export-an-invoice.md',
      'docs/billing-invoices/when-are-invoices-generated.md',
    ]);
    const meta = JSON.parse(readFileSync(join(dir, 'docs/billing-invoices/_meta.json'), 'utf8'));
    expect(meta).toEqual({ title: 'Billing & Invoices' });
    expect(existsSync(join(dir, 'docs/getting-started/_meta.json'))).toBe(false);
    expect(
      readFileSync(join(dir, 'docs/billing-invoices/how-do-i-export-an-invoice.md'), 'utf8'),
    ).toContain('status: draft');

    expect(printed()).toContain('skipped 1 that already exist: docs/getting-started/welcome.md');
    expect(printed()).toMatch(/read \d+ files, \d+k chars/);

    // The model was shown the route file's contents, comments included, and
    // the existing article's body, not just their names.
    const prompt = model.requests[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(prompt).toContain('generated on the 1st of each month');
    expect(prompt).toContain('This is the first article in your help center');
    expect(model.requests[0]?.maxTokens).toBeGreaterThan(1024);
  });

  it('files a draft into an existing collection by its title, and never touches its _meta.json', async () => {
    await init({ cwd: dir, name: 'Acme' });
    write('docs/billing/_meta.json', '{ "title": "Money", "order": 1 }');
    write('docs/billing/plans.md', '---\ntitle: Plans\n---\n\nTwo plans.\n');
    const model = drafts([
      { collection: 'Money', title: 'Refunds', description: 'd', body: 'Ask.' },
    ]);

    const written = await docsGenerate({ cwd: dir, model });

    expect(written[0]?.path).toBe('docs/billing/refunds.md');
    expect(readFileSync(join(dir, 'docs/billing/_meta.json'), 'utf8')).toBe(
      '{ "title": "Money", "order": 1 }',
    );
    expect(existsSync(join(dir, 'docs/money'))).toBe(false);
  });

  it('writes nothing on a dry run, but says what it would do', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const model = drafts([
      { collection: 'Account', title: 'Reset password', description: 'd', body: 'b' },
    ]);
    await docsGenerate({ cwd: dir, model, dryRun: true });
    expect(existsSync(join(dir, 'docs/account'))).toBe(false);
    expect(printed()).toContain('would create 1 new collection');
    expect(printed()).toContain('1 articles would be written');
  });
});

describe('docs update', () => {
  it('fails loudly when git cannot diff, instead of saying nothing changed', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await expect(docsUpdate({ cwd: dir, model: new FakeModel() })).rejects.toThrow(/git/);
    expect(printed()).not.toContain('Nothing has changed');
  });

  it('compares against the first commit when there are no tags, and rewrites the real files', async () => {
    await init({ cwd: dir, name: 'Acme' });
    gitInit();
    write(
      'src/invoices.ts',
      '// Billing: exportInvoice builds the invoice download.\nexport function exportInvoice() { return "CSV"; }',
    );
    write(
      'docs/billing/export.mdx',
      '---\ntitle: Exporting an invoice\nslug: billing/custom-slug\nstatus: published\n---\n\nexportInvoice builds the invoice download in Billing as a CSV file.\n',
    );
    write(
      'docs/billing/plain.md',
      'exportInvoice builds the invoice download in Billing as CSV.\n',
    );
    write(
      'docs/other/klingon.md',
      '---\ntitle: Klingon translations\n---\n\nWarp drive settings for the Klingon interface locale.\n',
    );
    gitCommit('init');
    write(
      'src/invoices.ts',
      '// Billing: exportInvoice builds the invoice download, now as PDF.\nexport function exportInvoice() { return "PDF"; }',
    );
    gitCommit('PDF');

    const model = new FakeModel([
      { text: '{"stale":true,"reason":"CSV became PDF","body":"exportInvoice builds a PDF."}' },
    ]);
    const edits = await docsUpdate({ cwd: dir, model });

    expect(printed()).toContain('first commit');
    // Four articles: the three above plus init's welcome article. Only the
    // two that talk about invoices go to the model.
    expect(printed()).toContain('checking 2 of 4 articles');
    expect(edits.map((e) => e.path).sort()).toEqual([
      'docs/billing/export.mdx',
      'docs/billing/plain.md',
    ]);
    expect(model.requests).toHaveLength(2);
    expect(readFileSync(join(dir, 'docs/billing/export.mdx'), 'utf8')).toBe(
      '---\ntitle: Exporting an invoice\nslug: billing/custom-slug\nstatus: published\n---\n\nexportInvoice builds a PDF.\n',
    );
    expect(readFileSync(join(dir, 'docs/billing/plain.md'), 'utf8')).toBe(
      'exportInvoice builds a PDF.\n',
    );
    expect(readFileSync(join(dir, 'docs/other/klingon.md'), 'utf8')).toContain('Warp drive');
  });

  it('leaves lockfiles, the docs and helpwell/ out of the diff', async () => {
    await init({ cwd: dir, name: 'Acme' });
    gitInit();
    write('package-lock.json', '{}');
    write('packages/web/pnpm-lock.yaml', 'a');
    write('yarn.lock', 'a');
    write('src/a.ts', '1');
    const first = gitCommit('init');
    write('package-lock.json', '{"changed":1}');
    write('packages/web/pnpm-lock.yaml', 'b');
    write('yarn.lock', 'b');
    write('src/a.ts', '2');
    write('docs/getting-started/welcome.md', 'changed');
    write('helpwell/instructions.md', 'changed');
    gitCommit('second');

    const diff = gitDiff(dir, first, join(dir, 'docs'));
    expect(diff).toContain('src/a.ts');
    expect(diff).not.toContain('package-lock.json');
    expect(diff).not.toContain('pnpm-lock.yaml');
    expect(diff).not.toContain('yarn.lock');
    expect(diff).not.toContain('welcome.md');
    expect(diff).not.toContain('instructions.md');

    expect(lastRef(dir).ref).toBe(first);
    git('tag', 'v1.0.0');
    expect(lastRef(dir)).toEqual({ ref: 'v1.0.0', label: 'v1.0.0' });
  });

  it('only sends the model articles that share vocabulary with the diff', () => {
    const articles = [
      {
        title: 'Exporting invoices',
        headings: [],
        body: 'Press Export to download an invoice as a PDF file from Billing.',
      },
      {
        title: 'Changing your password',
        headings: [],
        body: 'Open Account, then Security, then Password.',
      },
    ];
    const diff =
      '+ // invoices: the download is now a PDF file for billing\n+ function exportInvoice() {}';
    expect(relevantArticles(articles, diff).map((a) => a.title)).toEqual(['Exporting invoices']);
  });

  it('shows the model the files that mention the article first, and never a data dump', () => {
    const hunk = (path: string, body: string) =>
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}\n`;
    // A committed export that sorts before src/ and quotes every article: it
    // used to fill the whole 40k window and hide the change after it.
    const dump = hunk('export.json', `+${'"reminder invoice schedule" '.repeat(8_000)}`);
    const unrelated = hunk('src/auth.ts', '+ const SESSION_TTL = 3600; // password sessions');
    const relevant = hunk(
      'src/reminders.ts',
      '+ export const DEFAULT_REMINDER_DAYS = [3, 7, 14, 30]; // reminder schedule',
    );
    const chunks = splitDiff(`${dump}${unrelated}${relevant}`);
    expect(chunks.map((c) => c.path)).toEqual(['src/auth.ts', 'src/reminders.ts']);

    const article = {
      title: 'How do reminders work?',
      headings: [],
      body: 'A reminder goes out on a schedule of days after the due date.',
    };
    const shown = diffFor(article, chunks);
    expect(shown.indexOf('src/reminders.ts')).toBeLessThan(shown.indexOf('src/auth.ts'));
    expect(shown).toContain('[3, 7, 14, 30]');

    // One file, however long, cannot take the whole window.
    const long = hunk('src/big.ts', `+${'reminder schedule day '.repeat(3_000)}`);
    const withLong = diffFor(article, splitDiff(`${long}${relevant}`));
    expect(withLong).toContain('[3, 7, 14, 30]');
    expect(withLong).toContain('[truncated]');
  });

  it('keeps frontmatter byte for byte, and handles a file without any', () => {
    expect(replaceBody('---\ntitle: T\nslug: x/y\n---\n\nOld body.\n', 'New body.')).toBe(
      '---\ntitle: T\nslug: x/y\n---\n\nNew body.\n',
    );
    expect(replaceBody('---\r\ntitle: T\r\n---\r\n\r\nOld.\r\n', 'New.')).toBe(
      '---\r\ntitle: T\r\n---\r\n\nNew.\n',
    );
    expect(replaceBody('Just a body.\n', 'New body.')).toBe('New body.\n');
  });
});

describe('changelog', () => {
  const draftModel = () =>
    new FakeModel([
      {
        text: '{"title":"Export invoices as PDF","summary":"s","tags":["New"],"body":"You can now export.","customerVisible":true}',
      },
    ]);

  /** Point the project's changelog settings somewhere, in the file and the database. */
  async function source(changelog: Record<string, unknown>): Promise<void> {
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.settings.changelog = { ...config.settings.changelog, ...changelog };
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');
    await withDb(async (db) => {
      await migrate(db);
      await new SettingsStore(db).update({ changelog });
    });
  }

  it('asks for a key before it touches git, GitHub or the database', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const result = await run(['changelog', '--dry-run'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('OPENROUTER_API_KEY');
    expect(existsSync(join(dir, 'helpwell', 'data'))).toBe(false);
  });

  it(
    'falls back to the first commit and records resolved SHAs, so a rerun is a no-op',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await source({ source: 'commits' });
      gitInit();
      gitCommit('init');
      write('src/pdf.ts', 'export const pdf = true;');
      const head = gitCommit('Add PDF export');

      const first = await changelog({ cwd: dir, model: draftModel() });
      expect(first?.title).toBe('Export invoices as PDF');
      expect(printed()).toContain('1 commits');

      const second = await changelog({ cwd: dir, model: draftModel() });
      expect(second).toBeNull();
      expect(printed()).toContain('already an entry');

      await withDb(async (db) => {
        const rows = await db
          .select({ ref: schema.changelogEntries.sourceRef })
          .from(schema.changelogEntries);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.ref).toMatch(/^[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/);
        expect(rows[0]?.ref?.endsWith(head)).toBe(true);
      });
    },
    SLOW,
  );

  it('rejects a --since that is not a ref, rather than reporting no changes', async () => {
    await init({ cwd: dir, name: 'Acme' });
    gitInit();
    gitCommit('init');
    await expect(
      changelog({ cwd: dir, model: new FakeModel(), source: 'tags', since: 'v9.9.9' }),
    ).rejects.toThrow(/not a commit, tag or branch/);
  });

  it('drafts nothing when entries are written by hand, and needs no key to say so', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.settings.changelog.source = 'manual';
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');
    output.length = 0;

    const result = await run(['changelog'], dir);
    expect(result.exitCode).toBe(0);
    expect(printed()).toContain('changelog.source is manual');
    expect(printed()).not.toContain('OPENROUTER_API_KEY');
    expect(existsSync(join(dir, 'helpwell', 'data'))).toBe(false);
  });

  it('follows the dashboard when it switched the source to manual', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await withDb(async (db) => {
      await migrate(db);
      await new SettingsStore(db).update({ changelog: { source: 'manual' } });
    });
    const model = draftModel();
    expect(await changelog({ cwd: dir, model })).toBeNull();
    expect(printed()).toContain('changelog.source is manual');
    expect(model.requests).toHaveLength(0);
  });

  describe('from GitHub releases', () => {
    const RELEASE = {
      tag_name: 'v1.5.0',
      name: 'PDF export',
      body: '## What changed\n\n- Invoices can be exported as PDF (#412)\n- Bump eslint (#415)',
      html_url: 'https://github.com/acme/app/releases/tag/v1.5.0',
      published_at: '2026-09-20T10:00:00Z',
    };

    /** A stand-in for api.github.com: nothing leaves the process. */
    function github(answers: Record<string, () => Response> = {}) {
      const calls: { url: string; headers: Record<string, string> }[] = [];
      const fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
        const path = String(url).replace('https://api.github.com', '');
        const answer = answers[path];
        if (answer) return answer();
        if (path === '/repos/acme/app/releases/latest') return Response.json(RELEASE);
        return new Response('{"message":"Not Found"}', { status: 404 });
      }) as typeof globalThis.fetch;
      return { fetch, calls };
    }

    it('drafts from the latest release notes, with GITHUB_TOKEN, once', async () => {
      await init({ cwd: dir, name: 'Acme' });
      await source({ source: 'github_releases', repo: 'acme/app' });
      const { fetch, calls } = github();
      const model = draftModel();

      const draft = await changelog({
        cwd: dir,
        model,
        fetch,
        env: { GITHUB_TOKEN: 'ghp_test_not_real' },
      });
      expect(draft).toMatchObject({ title: 'Export invoices as PDF', version: 'v1.5.0' });
      expect(calls.map((c) => c.url)).toEqual([
        'https://api.github.com/repos/acme/app/releases/latest',
      ]);
      expect(calls[0]?.headers.authorization).toBe('Bearer ghp_test_not_real');
      expect(calls[0]?.headers.accept).toBe('application/vnd.github+json');
      // The model reads the notes, told that is what they are.
      expect(model.requests[0]?.messages[0]?.content).toContain('Turn these release notes');
      expect(model.requests[0]?.messages[1]?.content).toContain('Invoices can be exported as PDF');
      expect(printed()).not.toContain('No GITHUB_TOKEN');

      expect(await changelog({ cwd: dir, model: draftModel(), fetch, env: {} })).toBeNull();
      expect(printed()).toContain('already an entry for acme/app v1.5.0');
      await withDb(async (db) => {
        const rows = await db
          .select({
            ref: schema.changelogEntries.sourceRef,
            status: schema.changelogEntries.status,
          })
          .from(schema.changelogEntries);
        expect(rows).toEqual([{ ref: 'github:acme/app@v1.5.0', status: 'draft' }]);
      });
    });

    it('says what going without a token means, takes the repo from the remote, and reads a named release', async () => {
      await init({ cwd: dir, name: 'Acme' });
      gitInit();
      git('remote', 'add', 'origin', 'git@github.com:acme/app.git');
      const { fetch, calls } = github({
        '/repos/acme/app/releases/tags/v1.4.0': () =>
          Response.json({ ...RELEASE, tag_name: 'v1.4.0' }),
      });

      const draft = await changelog({
        cwd: dir,
        model: draftModel(),
        fetch,
        env: {},
        version: 'v1.4.0',
        dryRun: true,
      });
      expect(draft?.version).toBe('v1.4.0');
      expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/app/releases/tags/v1.4.0');
      expect(calls[0]?.headers).not.toHaveProperty('authorization');
      expect(printed()).toContain('No GITHUB_TOKEN');
      expect(printed()).toContain('60 requests an hour');
    });

    it('explains a missing repo, a repo with no releases, and a spent rate limit', async () => {
      await init({ cwd: dir, name: 'Acme' });
      await source({ source: 'github_releases', repo: 'acme/secret' });
      const missing = github();
      await expect(
        changelog({ cwd: dir, model: draftModel(), fetch: missing.fetch, env: {} }),
      ).rejects.toThrow(/no public repository acme\/secret.*set GITHUB_TOKEN/);

      const empty = github({
        '/repos/acme/secret/releases/latest': () => new Response('{}', { status: 404 }),
        '/repos/acme/secret': () => Response.json({ full_name: 'acme/secret' }),
      });
      await expect(
        changelog({ cwd: dir, model: draftModel(), fetch: empty.fetch, env: {} }),
      ).rejects.toThrow(/has no published release yet/);

      const limited = github({
        '/repos/acme/secret/releases/latest': () =>
          new Response('{"message":"API rate limit exceeded"}', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
          }),
      });
      await expect(
        changelog({ cwd: dir, model: draftModel(), fetch: limited.fetch, env: {} }),
      ).rejects.toThrow(/60 an hour.*Set GITHUB_TOKEN/);
    });

    it('asks for a repo when it was told to read releases and there is none to be found', async () => {
      await init({ cwd: dir, name: 'Acme' });
      await source({ source: 'github_releases' });
      await expect(
        changelog({ cwd: dir, model: draftModel(), fetch: github().fetch, env: {} }),
      ).rejects.toThrow(/changelog.repo is empty.*tags or commits/);
    });

    it('prints the token setup for an AI assistant, with the repo and no secret', async () => {
      await init({ cwd: dir, name: 'Acme' });
      await source({ source: 'github_releases', repo: 'acme/app' });
      const result = await run(['changelog', '--prompt'], dir);
      expect(result.exitCode).toBe(0);
      const text = printed();
      expect(text).toContain('Set this up with an AI assistant');
      expect(text).toContain('https://api.github.com/repos/acme/app/releases/latest');
      expect(text).toContain('Repository permissions: Contents');
      expect(text).toContain('Read-only');
      expect(text).toContain('Never ask me to paste');
      expect(text).not.toMatch(/ghp_[A-Za-z0-9]/);
    });
  });
});

describe('where the changelog drafts from', () => {
  const draftModel = () =>
    new FakeModel([
      {
        text: '{"title":"What changed","summary":"s","tags":["New"],"body":"Things.","customerVisible":true}',
      },
    ]);

  /** A GitHub that must not be called, for the runs that should stay on git. */
  const noGitHub = (async () => {
    throw new Error('GitHub was called');
  }) as unknown as typeof globalThis.fetch;

  /** A commit at a given moment, so a date range has something to cut. */
  function commitAt(message: string, when: string): string {
    const env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
    write(`src/${message.replace(/\W+/g, '-').toLowerCase()}.ts`, `// ${message}\n`);
    execFileSync('git', ['add', '-A'], { cwd: dir, env, stdio: 'ignore' });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir, env, stdio: 'ignore' });
    return git('rev-parse', 'HEAD');
  }

  /** What the model was given to read on its last call. */
  function readByModel(model: FakeModel): string {
    return String(model.requests.at(-1)?.messages[1]?.content ?? '');
  }

  /** A stand-in for api.github.com that answers every request the same way. */
  function githubAnswering(answer: () => Response) {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(String(url));
      return answer();
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  }
  const aRelease = () => Response.json({ tag_name: 'v2.0.0', name: 'v2', body: '- Dark mode' });

  it(
    'detects GitHub releases from a GitHub origin with releases, and init writes that down',
    async () => {
      gitInit();
      git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
      const asked = githubAnswering(aRelease);
      await init({ cwd: dir, name: 'Acme', fetch: asked.fetch, env: {} });
      expect(asked.calls).toEqual(['https://api.github.com/repos/acme/app/releases/latest']);
      const config = JSON.parse(readFileSync(configPath(), 'utf8'));
      expect(config.settings.changelog.source).toBe('github_releases');

      // The database has never been synced, so nothing is set there: the
      // command works the source out for itself, and reads the release.
      const { fetch, calls } = githubAnswering(aRelease);
      const draft = await changelog({
        cwd: dir,
        model: draftModel(),
        fetch,
        env: {},
        dryRun: true,
      });
      expect(draft?.version).toBe('v2.0.0');
      expect(calls).toEqual(['https://api.github.com/repos/acme/app/releases/latest']);
    },
    SLOW,
  );

  it(
    'has init write tags for a GitHub repo with no release, or when GitHub cannot be asked',
    async () => {
      gitInit();
      git('remote', 'add', 'origin', 'git@github.com:acme/app.git');
      const sourceAfterInit = async (fetch: typeof globalThis.fetch) => {
        await init({ cwd: dir, name: 'Acme', fetch, env: {}, force: true });
        return JSON.parse(readFileSync(configPath(), 'utf8')).settings.changelog.source;
      };
      const none = githubAnswering(() => new Response('{"message":"Not Found"}', { status: 404 }));
      expect(await sourceAfterInit(none.fetch)).toBe('tags');
      expect(none.calls).toHaveLength(1);
      const limited = githubAnswering(
        () =>
          new Response('{"message":"API rate limit exceeded"}', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
          }),
      );
      expect(await sourceAfterInit(limited.fetch)).toBe('tags');
      const offline = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof globalThis.fetch;
      expect(await sourceAfterInit(offline)).toBe('tags');
      // And with releases, for contrast.
      expect(await sourceAfterInit(githubAnswering(aRelease).fetch)).toBe('github_releases');
    },
    SLOW,
  );

  it(
    'drafts from git tags, with a note, when the detected GitHub repo has no release yet',
    async () => {
      gitInit();
      git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
      commitAt('init', '2026-01-01T10:00:00Z');
      git('tag', 'v1.0.0');
      commitAt('Add PDF export', '2026-01-02T10:00:00Z');
      const none = () => new Response('{"message":"Not Found"}', { status: 404 });
      await init({ cwd: dir, name: 'Acme', fetch: githubAnswering(none).fetch, env: {} });
      output.length = 0;

      // Nothing set in the database: detected, and the repo is on GitHub.
      const calls: string[] = [];
      const fetch = (async (url: string) => {
        calls.push(String(url));
        return String(url).endsWith('/repos/acme/app')
          ? Response.json({ full_name: 'acme/app' })
          : none();
      }) as unknown as typeof globalThis.fetch;
      const model = draftModel();
      const draft = await changelog({ cwd: dir, model, fetch, env: {}, dryRun: true });
      expect(draft?.title).toBe('What changed');
      expect(readByModel(model)).toContain('Add PDF export');
      expect(calls[0]).toBe('https://api.github.com/repos/acme/app/releases/latest');
      expect(printed()).toContain('No GitHub releases yet, drafting from git tags.');
      expect(printed()).toContain('from v1.0.0');
      // Quietly: nothing about tokens or the GitHub release it did not find.
      expect(printed()).not.toMatch(/GITHUB_TOKEN|on GitHub|no published release/);

      // Chosen, not detected, it is still an error.
      await expect(
        changelog({ cwd: dir, model: draftModel(), fetch, env: {}, source: 'github_releases' }),
      ).rejects.toThrow(/has no published release yet/);
    },
    SLOW,
  );

  it(
    'detects GitHub releases when changelog.repo is set, with no remote at all',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await withDb(async (db) => {
        await migrate(db);
        await new SettingsStore(db).update({ changelog: { repo: 'acme/app' } });
      });
      const calls: string[] = [];
      const fetch = (async (url: string) => {
        calls.push(String(url));
        return Response.json({ tag_name: 'v2.0.0', name: 'v2', body: '- Dark mode' });
      }) as unknown as typeof globalThis.fetch;
      await changelog({ cwd: dir, model: draftModel(), fetch, env: {}, dryRun: true });
      expect(calls).toEqual(['https://api.github.com/repos/acme/app/releases/latest']);
    },
    SLOW,
  );

  it(
    'falls back to git tags, quietly, when the repo is not on GitHub',
    async () => {
      gitInit();
      git('remote', 'add', 'origin', 'https://gitlab.com/acme/app.git');
      commitAt('init', '2026-01-01T10:00:00Z');
      git('tag', 'v1.0.0');
      commitAt('Add PDF export', '2026-01-02T10:00:00Z');
      await init({ cwd: dir, name: 'Acme' });
      expect(JSON.parse(readFileSync(configPath(), 'utf8')).settings.changelog.source).toBe('tags');
      output.length = 0;

      const model = draftModel();
      const draft = await changelog({ cwd: dir, model, fetch: noGitHub, env: {}, dryRun: true });
      expect(draft?.title).toBe('What changed');
      expect(readByModel(model)).toContain('Add PDF export');
      expect(printed()).toContain('from v1.0.0');
      expect(printed()).not.toMatch(/GitHub|GITHUB_TOKEN|changelog\.repo/);
    },
    SLOW,
  );

  it(
    'reads commits since the last published entry, where tags still reads since the tag',
    async () => {
      gitInit();
      commitAt('init', '2026-01-01T10:00:00Z');
      git('tag', 'v1.0.0');
      const pdf = commitAt('Add PDF export', '2026-01-02T10:00:00Z');
      await init({ cwd: dir, name: 'Acme' });
      await withDb(async (db) => {
        await migrate(db);
        await new SettingsStore(db).update({ changelog: { source: 'commits' } });
      });

      // Nothing published yet: from the previous tag, as for tags.
      const first = draftModel();
      await changelog({ cwd: dir, model: first, publish: true });
      expect(readByModel(first)).toContain('Add PDF export');
      expect(printed()).toContain('No changelog entry is published yet');

      commitAt('Add dark mode', '2026-01-03T10:00:00Z');
      const fix = commitAt('Fix the dark mode toggle', '2026-01-04T10:00:00Z');
      output.length = 0;

      const second = draftModel();
      await changelog({ cwd: dir, model: second });
      expect(readByModel(second)).toContain('Add dark mode');
      expect(readByModel(second)).toContain('Fix the dark mode toggle');
      expect(readByModel(second)).not.toContain('Add PDF export');
      expect(printed()).toContain(`the last entry, "What changed" (${pdf.slice(0, 7)})`);
      await withDb(async (db) => {
        const rows = await db
          .select({
            ref: schema.changelogEntries.sourceRef,
            status: schema.changelogEntries.status,
          })
          .from(schema.changelogEntries);
        // The draft records where it ran to, for the run after it is published.
        expect(rows.find((row) => row.status === 'draft')?.ref).toBe(`${pdf}...${fix}`);
      });

      // Tags ignores the entries: everything since v1.0.0.
      const tags = draftModel();
      await changelog({ cwd: dir, model: tags, source: 'tags', dryRun: true });
      expect(readByModel(tags)).toContain('Add PDF export');
      expect(readByModel(tags)).toContain('Add dark mode');
    },
    SLOW,
  );

  it(
    'reads commits since the last entry’s publish date when it recorded no commit',
    async () => {
      gitInit();
      commitAt('init', '2026-01-01T10:00:00Z');
      commitAt('Add PDF export', '2026-03-01T10:00:00Z');
      commitAt('Add dark mode', '2026-07-01T10:00:00Z');
      await init({ cwd: dir, name: 'Acme' });
      await withDb(async (db) => {
        await migrate(db);
        await new SettingsStore(db).update({ changelog: { source: 'commits' } });
        // Written by hand in the dashboard: no range, only a date.
        await createChangelogEntry(db, {
          title: 'PDF export',
          status: 'published',
          publishedAt: new Date('2026-06-01T00:00:00Z'),
        });
      });

      const model = draftModel();
      await changelog({ cwd: dir, model });
      expect(readByModel(model)).toContain('Add dark mode');
      expect(readByModel(model)).not.toContain('Add PDF export');
      expect(printed()).toContain('the last entry, "PDF export" (2026-06-01)');
      await withDb(async (db) => {
        const rows = await db
          .select({ ref: schema.changelogEntries.sourceRef })
          .from(schema.changelogEntries);
        const ref = rows.map((row) => row.ref).find(Boolean);
        expect(ref).toBe(`since:2026-06-01T00:00:00.000Z...${git('rev-parse', 'HEAD')}`);
      });

      // Run again before publishing: the same range, so no second draft.
      expect(await changelog({ cwd: dir, model: draftModel() })).toBeNull();
      expect(printed()).toContain('already an entry');
    },
    SLOW,
  );
});

describe('GitHub repositories', () => {
  it('reads owner/name from what people type and what git remote says', () => {
    expect(parseGitHubRepo('acme/app')).toBe('acme/app');
    expect(parseGitHubRepo('https://github.com/acme/app')).toBe('acme/app');
    expect(parseGitHubRepo('https://github.com/acme/app.git')).toBe('acme/app');
    expect(parseGitHubRepo('git@github.com:acme/my.app.git')).toBe('acme/my.app');
    expect(parseGitHubRepo('https://gitlab.com/acme/app')).toBeNull();
    expect(parseGitHubRepo('acme/app/../other')).toBeNull();
    expect(parseGitHubRepo('acme')).toBeNull();
  });
});

describe('eval cases', () => {
  it('reads a cases file', () => {
    write(
      'evals.json',
      JSON.stringify({
        cases: [
          { id: 'a', question: 'How do I export?', expect: 'billing/invoices' },
          { question: 'Unknown thing?', expect: null },
        ],
      }),
    );
    const cases = loadCases(join(dir, 'evals.json'));
    expect(cases).toHaveLength(2);
    expect(cases[0]?.expect).toBe('billing/invoices');
    expect(cases[1]?.id).toBe('case-2');
    expect(cases[1]?.expect).toBeNull();
  });

  it('accepts a bare array too', () => {
    write('evals.json', JSON.stringify([{ question: 'Q' }]));
    expect(loadCases(join(dir, 'evals.json'))).toHaveLength(1);
  });

  it('tells a missing file from a broken one', () => {
    expect(() => loadCases(join(dir, 'nope.json'))).toThrow(EvalCasesError);
    try {
      loadCases(join(dir, 'nope.json'));
    } catch (error) {
      expect((error as EvalCasesError).kind).toBe('missing');
    }
    write('broken.json', 'not json');
    try {
      loadCases(join(dir, 'broken.json'));
      expect.unreachable();
    } catch (error) {
      expect((error as EvalCasesError).kind).toBe('invalid');
      expect((error as EvalCasesError).message).toContain('broken.json');
    }
    write('shape.json', '{"nope": true}');
    expect(() => loadCases(join(dir, 'shape.json'))).toThrow(/expected an array/);
  });

  it('skips a case with no question', () => {
    write('evals.json', JSON.stringify([{ id: 'x' }, { question: '  ' }, { question: 'real' }]));
    expect(loadCases(join(dir, 'evals.json'))).toHaveLength(1);
  });
});

describe('eval', () => {
  async function installWithCases(cases: unknown[]): Promise<void> {
    await init({ cwd: dir, name: 'Acme' });
    await sync({ cwd: dir });
    write('helpwell/evals.json', JSON.stringify({ cases }));
  }

  it(
    'runs every case in a rolled-back transaction: nothing left behind, no rate limit accrued',
    async () => {
      // 25 cases: five more than the default per-visitor hourly limit, which
      // every case used to share.
      const cases: unknown[] = Array.from({ length: 24 }, (_, i) => ({
        id: `q${i}`,
        question: 'What is Acme?',
        expect: 'getting-started/welcome',
      }));
      cases.push({ id: 'unknown', question: 'Do you have a Klingon translation?', expect: null });
      await installWithCases(cases);

      const result = await runEvals({ cwd: dir, ref: 'abc123' });

      expect(result.cases).toHaveLength(25);
      expect(result.score).toBe(100);
      expect(result.belowThreshold).toBe(false);
      expect(result.costUsd).toBe(0);

      await withDb(async (db) => {
        for (const table of [
          schema.conversations,
          schema.messages,
          schema.searches,
          schema.gaps,
          schema.gapConversations,
          schema.rateCounters,
          schema.spendLedger,
        ]) {
          expect((await db.select().from(table)).length, getTableName(table)).toBe(0);
        }
        const runs = await db.select().from(schema.evalRuns);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.ref).toBe('abc123');
        expect(runs[0]?.cases).toHaveLength(25);
      });
    },
    SLOW,
  );

  it('reports a threshold failure through the result, never through process.exitCode', async () => {
    await installWithCases([{ id: 'x', question: 'What is Acme?', expect: 'billing/nothing' }]);
    const before = process.exitCode;
    const result = await run(['eval', '--threshold', '100'], dir);
    expect(result.exitCode).toBe(1);
    expect(process.exitCode).toBe(before);
    expect(printed()).toContain('below the threshold');
  });

  it('tells a missing cases file from a broken one, and only fails when a score was asked for', async () => {
    await init({ cwd: dir, name: 'Acme' });
    rmSync(join(dir, 'helpwell/evals.json'));

    expect((await run(['eval'], dir)).exitCode).toBe(0);
    expect(printed()).toContain('No eval cases file');

    expect((await run(['eval', '--threshold', '80'], dir)).exitCode).toBe(1);
    expect(printed()).toContain('that is a failure');

    write('helpwell/evals.json', 'not json');
    expect((await run(['eval'], dir)).exitCode).toBe(1);
    expect(printed()).toContain('Could not read');
  });

  it('starts a repo with twelve product-agnostic cases, and no workflow unless asked', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const file = JSON.parse(readFileSync(join(dir, 'helpwell', 'evals.json'), 'utf8')) as {
      cases: { id: string; question: string }[];
    };
    expect(file.cases).toHaveLength(12);
    expect(file.cases[0]?.question).toBe('What is Acme?');
    expect(loadCases(join(dir, 'helpwell', 'evals.json'))).toHaveLength(12);
    expect(existsSync(join(dir, '.github', 'workflows', 'helpwell-evals.yml'))).toBe(false);
    expect(existsSync(join(dir, '.github', 'workflows', 'helpwell-docs.yml'))).toBe(false);
    expect(printed()).toContain('helpwell init --ci');
  });

  it('writes the GitHub Actions workflow with --ci', async () => {
    const result = await run(['init', '--name', 'Acme', '--docs', 'help', '--ci'], dir);
    expect(result.exitCode).toBe(0);
    const workflow = readFileSync(join(dir, '.github', 'workflows', 'helpwell-evals.yml'), 'utf8');
    expect(workflow).toMatch(/npx helpwell eval --ref \$\{\{ github\.sha \}\} --threshold 80/);
    expect(workflow).toMatch(/OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/);
    expect(workflow).toContain("- 'help/**'");
    // And the docs workflow: docs update on pushes to main, then a pull request.
    const docs = readFileSync(join(dir, '.github', 'workflows', 'helpwell-docs.yml'), 'utf8');
    expect(docs).toContain('branches: [main]');
    expect(docs).toContain("- 'help/**'");
    expect(docs).toContain(
      `npx helpwell docs update --since "\${{ github.event.before || 'HEAD~1' }}"`,
    );
    expect(docs).toContain("git add -- 'help'");
    expect(docs).toContain('gh pr create --base main');
    expect(docs).toMatch(/OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/);
    expect(docs).not.toMatch(/sk-or-|ghp_|github_pat_/);
    expect(printed()).not.toContain('helpwell init --ci');
  });

  it(
    'measures retrieval only without a key, and leaves out what only a model can judge',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await sync({ cwd: dir });

      const result = await runEvals({ cwd: dir, dryRun: true });
      expect(result.mode).toBe('retrieval');
      expect(result.skipped.map((s) => s.id).sort()).toEqual([
        'never-asks-for-secrets',
        'no-invented-discount',
        'off-topic',
        'pasted-api-key',
        'pasted-password',
        'prompt-injection',
      ]);
      expect(result.cases).toHaveLength(6);
      expect(result.score).toBe(100);
      expect(printed()).toContain('retrieval only');
      expect(printed()).toContain('need a model to judge');
      expect(printed()).toContain('Dry run: nothing was recorded.');
      await withDb(async (db) => {
        expect(await db.select().from(schema.evalRuns)).toHaveLength(0);
      });
    },
    SLOW,
  );

  it(
    'runs every starter case, graded ones included, when there is a model',
    async () => {
      await init({ cwd: dir, name: 'Acme' });
      await sync({ cwd: dir });

      const model = new FakeModel((request) => {
        const system = request.messages[0]?.content ?? '';
        if (system.includes('You grade answers')) {
          return { text: '{"verdict":"pass","reason":"Fine."}' };
        }
        return { text: 'I can only help with Acme questions.', certainty: 'not_covered' };
      });
      const result = await runEvals({ cwd: dir, model, ref: 'ci-run' });
      expect(result.mode).toBe('full');
      expect(result.skipped).toEqual([]);
      expect(result.cases).toHaveLength(12);
      expect(result.costUsd).toBeGreaterThan(0);

      await withDb(async (db) => {
        const [row] = await db.select().from(schema.evalRuns);
        expect(row).toMatchObject({ ref: 'ci-run', mode: 'full' });
        const spend = await db.select().from(schema.spendLedger);
        expect(spend.map((s) => s.kind)).toEqual(['eval']);
      });
    },
    SLOW,
  );
});

describe('capture', () => {
  it('reads shots from screenshots.shots, and the old string form for the folder', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.screenshots = {
      dir: 'shots',
      shots: [{ name: 'dashboard', path: '/dashboard', waitFor: '.chart' }, { name: 'no-path' }],
    };
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');

    let project = loadProject(dir);
    expect(project.config.screenshots.shots).toEqual([
      { name: 'dashboard', path: '/dashboard', waitFor: '.chart', dark: false },
    ]);
    expect(project.paths.screenshotsDir).toBe(join(dir, 'shots'));

    config.screenshots = 'img';
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');
    project = loadProject(dir);
    expect(project.config.screenshots).toEqual({ dir: 'img', shots: [] });
    expect(project.paths.screenshotsDir).toBe(join(dir, 'img'));
  });

  it('parses the shots list, dropping anything that is not a shot', () => {
    const shots = readShots([
      { name: 'widget', path: '/', clip: '.panel', dark: true },
      { name: 'missing-path' },
      { name: 'help', path: '/help', width: 1200, click: ['#open'] },
    ]);
    expect(shots).toHaveLength(2);
    expect(shots[0]?.dark).toBe(true);
    expect(shots[1]?.click).toEqual(['#open']);
    expect(readShots({})).toEqual([]);
    expect(readShots(undefined)).toEqual([]);
  });

  it('fails when Playwright is missing, rather than quietly capturing nothing', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    config.screenshots = {
      dir: 'docs/_screenshots',
      shots: [{ name: 'dashboard', path: '/dashboard' }],
    };
    writeFileSync(configPath(), JSON.stringify(config), 'utf8');

    const result = await capture({ cwd: dir, chromium: async () => null });
    expect(result.ok).toBe(false);
    expect(result.skipped).toEqual(['dashboard']);
    expect(printed()).toContain('Playwright is not installed');
    expect(printed()).toContain('npx playwright install chromium');
    expect(printed()).toContain('npx helpwell prompt capture');
  });

  it('points at screenshots.shots when nothing is configured', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const result = await capture({ cwd: dir, chromium: async () => null });
    expect(result.ok).toBe(true);
    expect(printed()).toContain('screenshots.shots');
  });
});

describe('the dispatcher', () => {
  it('prints the command list with no arguments', async () => {
    const result = await run([], dir);
    expect(result.exitCode).toBe(0);
    expect(printed()).toContain('HelpWell');
    expect(printed()).toContain('sync');
    expect(printed()).toContain('doctor');
    expect(printed()).toContain('settings pull');
    expect(printed()).toContain('settings push');
  });

  it('prints the version', async () => {
    await run(['--version'], dir);
    expect(printed().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('explains one command', async () => {
    await run(['sync', '--help'], dir);
    expect(printed()).toContain('--no-embeddings');
  });

  it('shows the right screen for a two-word command', async () => {
    await run(['docs', 'update', '--help'], dir);
    expect(printed()).toContain('Rewrite articles the latest changes made wrong');
    expect(printed()).not.toContain('Draft help articles');

    output = [];
    await run(['docs', '--help'], dir);
    expect(printed()).toContain('Draft help articles');

    output = [];
    await run(['ask', '--help'], dir);
    expect(printed()).toContain('--offline');

    output = [];
    await run(['eval', '--help'], dir);
    expect(printed()).toContain('commit SHA');
    expect(printed()).not.toContain('--ref main');
  });

  it('fails clearly on an unknown command', async () => {
    const result = await run(['frobnicate'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('Unknown command: frobnicate');
  });

  it('rejects a framework it does not know', async () => {
    const result = await run(['init', '--framework', 'rails'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('Unknown framework: rails');
    expect(printed()).toContain('next, remix, node, hono');
    expect(existsSync(join(dir, 'helpwell'))).toBe(false);
  });

  it('tells you to run init when there is no project', async () => {
    const result = await run(['sync'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('helpwell init');
  });

  it('runs init and then sync end to end', async () => {
    expect((await run(['init', '--name', 'Acme'], dir)).exitCode).toBe(0);
    expect((await run(['sync'], dir)).exitCode).toBe(0);
    expect(printed()).toContain('Indexed 1 articles');
  });

  it('exits non-zero when doctor finds a real problem', async () => {
    const result = await run(['doctor'], dir);
    expect(result.exitCode).toBe(1);
  });

  it('refuses `ask` with no question', async () => {
    await run(['init', '--name', 'Acme'], dir);
    const result = await run(['ask'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('Ask what?');
  });

  it('passes everything after -- to ask as the question, offline switch and all', async () => {
    await run(['init', '--name', 'Acme'], dir);
    const result = await run(['ask', '--offline', '--', '--weird', 'question?'], dir);
    expect(result.exitCode).toBe(0);
    expect(printed()).toContain('agent');
    expect(printed()).not.toContain('Ask what?');
  });

  it('corrects an unknown docs subcommand', async () => {
    await run(['init', '--name', 'Acme'], dir);
    const result = await run(['docs', 'frobnicate'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('helpwell docs generate');
  });

  it('corrects an unknown settings subcommand', async () => {
    await run(['init', '--name', 'Acme'], dir);
    const result = await run(['settings'], dir);
    expect(result.exitCode).toBe(1);
    expect(printed()).toContain('helpwell settings pull');
  });
});

describe('the built binary', () => {
  // Resolved from this file, so it works whether vitest runs from the package
  // or from the workspace root.
  const binary = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'bin.js');

  it.runIf(existsSync(binary))('runs and prints help', () => {
    const out = execFileSync(process.execPath, [binary, '--help'], { encoding: 'utf8' });
    expect(out).toContain('Commands');
    expect(out).toContain('Install HelpWell into this repo');
    expect(out).toContain('Index the docs in your repo');
  });
});

describe('--verbose', () => {
  afterEach(() => setVerbose(false));

  it('is set per command, so one verbose run does not leak into the next', async () => {
    await run(['version', '--verbose'], dir);
    expect(isVerbose()).toBe(true);
    await run(['version'], dir);
    expect(isVerbose()).toBe(false);
  });

  it('is on the help screens', async () => {
    await run(['--help'], dir);
    expect(printed()).toContain('--verbose');
    output.length = 0;
    await run(['sync', '--help'], dir);
    expect(printed()).toContain('--verbose shows the working');
  });

  it('adds nothing unless asked', async () => {
    await init({ cwd: dir, name: 'Acme' });
    write('README.md', '# Acme\nAcme tracks expenses.');
    await docsGenerate({ cwd: dir, model: new FakeModel([{ text: '{"articles":[]}' }]) });
    expect(printed()).not.toContain('read README.md');
  });

  it('lists every file docs generate read, what was cut, and what did not fit', async () => {
    setVerbose(true);
    await init({ cwd: dir, name: 'Acme' });
    write('README.md', '# Acme\nAcme tracks expenses.');
    // Five 8k route files against a 20k routes budget: two whole, one cut,
    // one cut to what is left, and the fifth does not fit at all.
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      write(`src/routes/${name}.ts`, `// ${name}\n${`router.get('/${name}', h);\n`.repeat(400)}`);
    }
    await docsGenerate({ cwd: dir, model: new FakeModel([{ text: '{"articles":[]}' }]) });

    const out = printed();
    expect(out).toMatch(/read README\.md · \d+ chars/);
    expect(out).toContain('cut to fit');
    expect(out).toMatch(/over budget, not read: src\/routes\/[a-e]\.ts/);
  });

  it('shows each docs update decision, the words behind it, and the files each article saw', async () => {
    setVerbose(true);
    await init({ cwd: dir, name: 'Acme' });
    gitInit();
    write(
      'src/invoices.ts',
      '// Billing: exportInvoice builds the invoice download.\nexport function exportInvoice() { return "CSV"; }',
    );
    write(
      'docs/billing/plain.md',
      'exportInvoice builds the invoice download in Billing as CSV.\n',
    );
    write(
      'docs/other/klingon.md',
      '---\ntitle: Klingon translations\n---\n\nWarp drive settings for the Klingon interface locale.\n',
    );
    gitCommit('init');
    write(
      'src/invoices.ts',
      '// Billing: exportInvoice builds the invoice download, now as PDF.\nexport function exportInvoice() { return "PDF"; }',
    );
    gitCommit('PDF');

    await docsUpdate({
      cwd: dir,
      model: new FakeModel([{ text: '{"stale":false,"reason":"fine","body":null}' }]),
    });

    const out = printed();
    expect(out).toMatch(/git diff /);
    expect(out).toMatch(/check billing\/plain\.md · shares .*exportinvoice/);
    expect(out).toContain('skip  other/klingon.md · shares nothing with the diff');
    expect(out).toContain('billing/plain.md is judged against src/invoices.ts');
  });

  it('reports every model call with its model, tokens, cost and time', async () => {
    setVerbose(true);
    const model = traced(
      new FakeModel([
        {
          text: 'hello',
          toolCalls: [{ name: 'search_docs', arguments: {} }],
          usage: { tokensIn: 1200, tokensOut: 34, costUsd: 0.0123 },
        },
        { error: new Error('provider down') },
      ]),
    );

    await model.chat({ model: 'anthropic/claude-sonnet-4.5', messages: [] });
    await expect(
      model.chat({ model: 'anthropic/claude-sonnet-4.5', messages: [] }),
    ).rejects.toThrow('provider down');

    const out = printed();
    expect(out).toMatch(
      /model \S+ · 1,200 in \/ 34 out · \$0\.0123 · \d+ms · asked for search_docs/,
    );
    expect(out).toMatch(/model anthropic\/claude-sonnet-4\.5 failed after \d+ms: provider down/);
  });

  it('keeps model calls quiet without it', async () => {
    const model = traced(new FakeModel([{ text: 'hello' }]));
    await model.chat({ model: 'm', messages: [] });
    expect(printed()).toBe('');
  });
});
