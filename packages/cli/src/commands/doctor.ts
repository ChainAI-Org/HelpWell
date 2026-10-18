/**
 * `helpwell doctor` — tell someone exactly why it is not working.
 *
 * Every check says what it looked at and what to do about it. A diagnostic
 * that only reports "failed" makes the person do the work twice (DX-11).
 */

import { existsSync } from 'node:fs';
import { readKnowledgeBase } from '@helpwell/core/content';
import { type Db, defaultDatabaseUrl, firstRow, schema, schemaExists } from '@helpwell/core/db';
import { searchArticles } from '@helpwell/core/search';
import { type Settings, SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { loadProject, NotInstalledError, openDb, redactUrl } from '../project.js';
import { fail, heading, ok, say, style, warn } from '../ui.js';
import { type BrowserState, browserFix, captureBrowserState } from './capture.js';

export type CheckState = 'pass' | 'warn' | 'fail';

export interface Check {
  name: string;
  state: CheckState;
  detail: string;
  /** What to do about it. Only set when there is something to do. */
  fix?: string;
}

export interface DoctorResult {
  checks: Check[];
  ok: boolean;
}

export async function doctor(options: {
  cwd: string;
  url?: string;
  /** Whether capture can run here. Tests hand in an answer instead of loading Playwright. */
  captureBrowser?: () => Promise<BrowserState>;
}): Promise<DoctorResult> {
  const checks: Check[] = [];

  let project: ReturnType<typeof loadProject>;
  try {
    project = loadProject(options.cwd);
    checks.push({
      name: 'Project',
      state: 'pass',
      detail: project.paths.root,
    });
  } catch (error) {
    if (error instanceof NotInstalledError) {
      return report([
        {
          name: 'Project',
          state: 'fail',
          detail: 'No helpwell.config.json found in this directory or any parent.',
          fix: 'Run `helpwell init`.',
        },
      ]);
    }
    throw error;
  }

  /* ------------------------------------------------------------- content */

  if (!existsSync(project.paths.docsDir)) {
    checks.push({
      name: 'Docs folder',
      state: 'fail',
      detail: `${project.paths.docsDir} does not exist.`,
      fix: 'Create it, or point `docs` in helpwell.config.json somewhere else.',
    });
  } else {
    const knowledgeBase = readKnowledgeBase(project.paths.docsDir);
    const drafts = knowledgeBase.articles.filter((a) => a.status === 'draft').length;
    checks.push({
      name: 'Docs folder',
      state: knowledgeBase.articles.length > 0 ? 'pass' : 'warn',
      detail:
        knowledgeBase.articles.length > 0
          ? `${knowledgeBase.articles.length} articles in ${knowledgeBase.collections.length} collections${drafts ? `, ${drafts} draft` : ''}`
          : 'No articles yet.',
      fix:
        knowledgeBase.articles.length === 0
          ? 'Run `helpwell docs generate` to draft some from your code.'
          : undefined,
    });
  }

  checks.push({
    name: 'Instructions',
    state: project.instructions.trim() ? 'pass' : 'warn',
    detail: project.instructions.trim()
      ? `${project.instructions.split('\n').length} lines`
      : 'instructions.md is empty, so the agent has no system prompt.',
    fix: project.instructions.trim() ? undefined : 'Run `helpwell init --force` to restore it.',
  });

  /* --------------------------------------------------------- screenshots */

  const shots = project.config.screenshots.shots.length;
  if (shots > 0) {
    const state = await (options.captureBrowser ?? captureBrowserState)();
    checks.push({
      name: 'Screenshots',
      state: state === 'ready' ? 'pass' : 'warn',
      detail:
        state === 'ready'
          ? `${shots} configured; Chromium is ready for \`helpwell capture\``
          : `${shots} configured, but ${state === 'no-playwright' ? 'Playwright is not installed' : 'Chromium is not downloaded'}, so \`helpwell capture\` cannot take them.`,
      fix: state === 'ready' ? undefined : browserFix(state).join('\n'),
    });
  }

  /* ------------------------------------------------------------- the key */

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  checks.push({
    name: 'OpenRouter key',
    state: apiKey ? 'pass' : 'warn',
    detail: apiKey
      ? `set, ${apiKey.slice(0, 7)}…`
      : 'not set. The agent will answer from search alone.',
    fix: apiKey ? undefined : 'Put your key in OPENROUTER_API_KEY.',
  });

  if (apiKey && !apiKey.startsWith('sk-or-')) {
    checks.push({
      name: 'Key format',
      state: 'warn',
      detail: 'That does not look like an OpenRouter key.',
      fix: 'OpenRouter keys start with sk-or-. An OpenAI key will not work here.',
    });
  }

  /* ------------------------------------------------------------ database */

  const dbUrl = options.url ?? defaultDatabaseUrl(project.paths.root);

  try {
    const handle = await openDb(project.paths, { url: options.url, migrate: false });
    try {
      const present = await schemaExists(handle.db);
      checks.push({
        name: 'Database',
        state: present ? 'pass' : 'fail',
        detail: present
          ? `connected to ${redactUrl(handle.url)}`
          : `connected, but the helpwell schema is not there yet`,
        fix: present
          ? undefined
          : 'Run `helpwell migrate`, or `helpwell sync`, which does it for you.',
      });

      if (present) {
        const settings = await new SettingsStore(handle.db).get();
        checks.push({
          name: 'Settings',
          state: 'pass',
          detail: `${settings.product.name}, answering with ${settings.agent.models.chat}`,
        });

        checks.push(await embeddingsCheck(handle.db, settings, apiKey));
        checks.push(await searchCheck(handle.db));
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    checks.push({
      name: 'Database',
      state: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      fix: 'Check HELPWELL_DATABASE_URL, or unset it to use the embedded database.',
    });
  }

  // The host app's DATABASE_URL is deliberately never read: it is usually
  // production. When it is set and nothing else is, say which database is
  // actually in use before somebody wonders where their conversations went.
  if (process.env.DATABASE_URL && !process.env.HELPWELL_DATABASE_URL && !options.url) {
    checks.push({
      name: 'DATABASE_URL',
      state: 'warn',
      detail: `set, but HelpWell does not use DATABASE_URL. It is using ${redactUrl(dbUrl)}.`,
      fix: 'Set HELPWELL_DATABASE_URL if HelpWell should share that database.',
    });
  }

  return report(checks);
}

function report(checks: Check[]): DoctorResult {
  heading('HelpWell doctor');
  say();

  const width = checks.reduce((max, check) => Math.max(max, check.name.length), 0);

  for (const check of checks) {
    const mark =
      check.state === 'pass'
        ? style.green('✓')
        : check.state === 'warn'
          ? style.yellow('!')
          : style.red('✗');
    say(`  ${mark} ${style.bold(check.name.padEnd(width))}  ${check.detail}`);
    for (const line of check.fix?.split('\n') ?? [])
      say(`    ${' '.repeat(width)}${style.dim(line)}`);
  }

  const failed = checks.filter((c) => c.state === 'fail');
  const warned = checks.filter((c) => c.state === 'warn');

  say();
  if (failed.length > 0) {
    fail(`${failed.length} ${failed.length === 1 ? 'problem' : 'problems'} to fix.`);
  } else if (warned.length > 0) {
    warn(`Working, with ${warned.length} thing${warned.length === 1 ? '' : 's'} worth a look.`);
  } else {
    ok('Everything checks out.');
  }
  say();

  return { checks, ok: failed.length === 0 };
}

/**
 * Is search actually working?
 *
 * This used to search for "how do I" and warn when nothing came back. Every
 * word in that phrase is an English stop word, so `websearch_to_tsquery`
 * reduces it to an empty query and it can never match anything — the check
 * warned about an empty index on every install, including one that had just
 * synced successfully.
 *
 * So: count the index first, and only then search, using words taken from an
 * article that is definitely in there. An empty index and broken search are
 * different problems with different fixes, and now they say so.
 */
async function searchCheck(db: Db): Promise<Check> {
  const indexed = await db
    .select({ slug: schema.articleIndex.slug, title: schema.articleIndex.title })
    .from(schema.articleIndex)
    .where(sql`status = 'published'`)
    .limit(1);

  const first = indexed[0];
  if (!first) {
    return {
      name: 'Search',
      state: 'warn',
      detail: 'nothing is indexed yet',
      fix: 'Run `helpwell sync`.',
    };
  }

  // This is an admin check, so it sees everything: a collection whose
  // _meta.json says `visibility: "identified"` is hidden from anonymous
  // searches, and must not read here as "search is broken".
  const hits = await searchArticles(db, first.title, { identified: true });
  if (hits.length === 0) {
    return {
      name: 'Search',
      state: 'fail',
      detail: `articles are indexed, but searching for "${first.title}" found none of them`,
      fix: 'Run `helpwell sync --force`. If that does not fix it, the full-text index is damaged.',
    };
  }

  return {
    name: 'Search',
    state: 'pass',
    detail: `full-text search returned ${hits.length} ${hits.length === 1 ? 'result' : 'results'}`,
  };
}

/**
 * Are embeddings on, and have they run?
 *
 * An empty `agent.models.embeddings` switches the semantic pass off on
 * purpose, and core then indexes text only and reports nothing embedded. That
 * is a choice rather than a problem, but a bare zero reads like a failure, so
 * it is spelled out here as well as in the sync summary.
 */
async function embeddingsCheck(db: Db, settings: Settings, apiKey: string): Promise<Check> {
  const model = settings.agent.models.embeddings;
  if (!model) {
    return {
      name: 'Embeddings',
      state: 'pass',
      detail: 'off (no embeddings model configured); search is full-text only',
    };
  }

  if (!apiKey) {
    return {
      name: 'Embeddings',
      state: 'pass',
      detail: `${model}, not run without OPENROUTER_API_KEY; search is full-text only`,
    };
  }

  // A missing embedding is SQL NULL or JSON null depending on who wrote the
  // row; only a real vector counts.
  const result = await db.execute<{ total: string | number; embedded: string | number }>(sql`
    SELECT count(*) AS total,
           count(*) FILTER (
             WHERE embedding IS NOT NULL AND jsonb_typeof(embedding) = 'array'
           ) AS embedded
    FROM helpwell.article_index
  `);
  const row = firstRow<{ total: string | number; embedded: string | number }>(result);
  const total = Number(row?.total ?? 0);
  const embedded = Number(row?.embedded ?? 0);

  if (total > 0 && embedded === 0) {
    return {
      name: 'Embeddings',
      state: 'warn',
      detail: `${model}, but none of the ${total} indexed articles has one`,
      fix: 'Run `helpwell sync` with the key set to embed them.',
    };
  }

  return {
    name: 'Embeddings',
    state: 'pass',
    detail: `${model}, ${embedded} of ${total} articles embedded`,
  };
}
