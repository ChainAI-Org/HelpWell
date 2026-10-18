/**
 * The whole of HelpWell's installation into Ridgeline, in one file.
 *
 * A host app needs exactly three things: a database, the three handlers, and an
 * answer to "who is an admin". Everything below is that, plus the seeding a
 * playground needs and a real install would not have, plus the optional hooks
 * that let the dashboard write back to the repo: instructions, the playbook
 * and articles, and the eval cases it replays.
 *
 * Why a module-level singleton: `next dev` re-evaluates modules on change, and
 * a fresh PGlite instance per reload would throw the database away mid-session.
 * Hanging the boot promise off `globalThis` survives that. It also guarantees
 * `migrate()` and `seed()` run exactly once per process rather than once per
 * request, because every caller awaits the same promise.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHelpWellHandler, type HelpWellConfig, type HelpWellHandler } from '@helpwell/core';
import { FakeModel, type GroundedFinding } from '@helpwell/core/agent';
import type { MediaDirs, WriteArticle } from '@helpwell/core/content';
import { createDb, type Db, migrate } from '@helpwell/core/db';
import { createDashboard, type DashboardHandler } from '@helpwell/dashboard';
import { createHelpCenter, type HelpCenterHandler } from '@helpwell/helpcenter';
import { widgetAssets } from '@helpwell/widget/server';
import { chooseAdminCheck } from './admin';
import {
  corsOrigins,
  DOCS_DIR,
  EVALS_FILE,
  INSTRUCTIONS_FILE,
  identitySecret,
  offline,
  PLAYBOOK_FILE,
} from './config';
import { withFollowUp } from './follow-up';
import { API_PATH, DASHBOARD_PATH, HELP_PATH } from './paths';
import { seed } from './seed';

/* ------------------------------------------------------------ no API key */

/**
 * How Fern words an answer when there is no OPENROUTER_API_KEY.
 *
 * Core's `FakeModel.grounded` does the rest, the same way `helpwell ask
 * --offline` does: it runs the search the agent has just run, quotes the
 * sentence of the top passage closest to the question, cites it, and says
 * how sure it is, read off how much of the question search matched. That is
 * what keeps "can we import three years of history from Expensify?"
 * unresolved and on the Gaps list, rather than quoting whichever article
 * mentions importing.
 *
 * Only this wording is Ridgeline's: the retrieval, the citation, the
 * confidence score, the conversation saved to the dashboard, the spend ledger
 * and the gap are all the real code paths. The first answer also says why the
 * wording is scripted; after that the playground stops repeating itself.
 */
function ridgelineWording({ level, top, quote, turn }: GroundedFinding): string {
  const note =
    turn === 0
      ? [
          '',
          'Worth saying up front: this playground is running without an `OPENROUTER_API_KEY`,',
          'so my wording comes from a short script rather than from a model. Everything',
          'around it is real: the search behind it, the citation, the conversation saved',
          'to the dashboard, and the gap logged when the docs do not cover something.',
        ]
      : [];

  if (!top || level === 'not_covered') {
    return [
      "I couldn't find an answer to that in the Ridgeline help center, so I won't guess.",
      ...(top
        ? ['', `The closest article, **${top.title}**, only shares a word or two with it.`]
        : []),
      '',
      "I've marked this unresolved, so it shows up on the team's Gaps list in the dashboard.",
      ...note,
    ].join('\n');
  }

  return [
    quote
      ? `Here is what the help center says, from **${top.title}**:`
      : `The closest article in the help center is **${top.title}**.`,
    ...(quote ? ['', `> ${quote}`] : []),
    '',
    level === 'answered'
      ? 'The article is linked under this message.'
      : 'That may only cover part of what you asked. The article is linked under this message.',
    ...note,
  ].join('\n');
}

/* ------------------------------------------------------- the repo hooks */

/**
 * Where article images and videos are served from: the docs folder, with
 * screenshots in its `_screenshots/`. The API serves them under
 * /api/helpwell/screenshots and /media, and the help centre under
 * /help/_screenshots and /_media, so a picture an article links to relatively
 * loads in both.
 */
const MEDIA: MediaDirs = { docs: DOCS_DIR };

/**
 * The dashboard's article editor saves here. A playground runs inside the repo
 * it documents, so writing the Markdown straight into helpwell/docs/ is the
 * whole hook; a production install would commit through its Git host instead.
 * HelpWell has already checked that `path` stays inside the docs folder, and
 * re-indexes the article and records a version once this returns.
 */
const writeArticle: WriteArticle = async (path, markdown) => {
  const file = join(DOCS_DIR, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, markdown, 'utf8');
};

/**
 * helpwell/evals.json, for the dashboard's Evals page. Missing is fine: the
 * page then repeats the last run's cases, or starts from the starter set.
 */
async function readEvalCases(): Promise<unknown> {
  try {
    return await readFile(EVALS_FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/* ------------------------------------------------------------------- boot */

export interface HelpWellHandlers {
  db: Db;
  api: HelpWellHandler;
  helpCenter: HelpCenterHandler;
  dashboard: DashboardHandler;
}

/**
 * instructions.md and playbook.md, held in memory so an edit made in the
 * dashboard takes effect on the next answer without a restart. The files on
 * disk stay the source of truth — that is the point of HelpWell keeping config
 * in the repo.
 */
let instructions = '';
let playbook = '';

async function boot(): Promise<HelpWellHandlers> {
  const { db } = await createDb({
    // pglite://memory needs no setup and disappears with the process, which is
    // what a playground wants. Point HELPWELL_DATABASE_URL at a postgres:// URL
    // (or pglite://./.helpwell/db) to keep what you do here.
    url: process.env.HELPWELL_DATABASE_URL ?? 'pglite://memory',
  });

  // Safe on every boot: migrate() records what it has applied and skips it.
  await migrate(db);
  await seed(db);

  instructions = await readFile(INSTRUCTIONS_FILE, 'utf8').catch(() => '');
  playbook = await readFile(PLAYBOOK_FILE, 'utf8').catch(() => '');

  // The stand-in for your app's own auth: the demo cookie on this machine
  // alone, the admin token anywhere else. A real Ridgeline would write
  // `isAdmin: (request) => session(request)?.role === 'admin'` against the
  // session it already has. See lib/admin.ts.
  const admin = chooseAdminCheck();

  const apiConfig: HelpWellConfig = {
    db,
    basePath: API_PATH,
    // The API serves the widget itself at /api/helpwell/assets/, so nothing
    // is copied into public/ and an upgrade is `pnpm update`.
    assets: widgetAssets(),
    // Empty unless HELPWELL_CORS_ORIGINS names another site running the widget.
    corsOrigins,
    identitySecret,
    isAdmin: admin.isAdmin,
    adminToken: admin.adminToken,
    openRouterKey: process.env.OPENROUTER_API_KEY,
    // Getters, because `createContext` reads these once per request: an edit
    // saved in the dashboard is live on the very next answer.
    get instructions() {
      return instructions;
    },
    get playbook() {
      return playbook;
    },
    // With a key this stays undefined and the agent builds an OpenRouterModel.
    // Created once per process, so the note about the script is made once.
    // Asking for a person is the one question it answers with a tool
    // (lib/follow-up.ts).
    model: offline
      ? withFollowUp(FakeModel.grounded(db, { wording: ridgelineWording }))
      : undefined,
    media: MEDIA,
    // The same hook the dashboard has, so a script can save an article
    // through the admin API (POST /api/helpwell/admin/articles) too.
    writeArticle,
  };

  return {
    db,
    api: createHelpWellHandler(apiConfig),

    helpCenter: createHelpCenter({
      db,
      basePath: HELP_PATH,
      apiPath: API_PATH,
      editUrlTemplate: 'https://github.com/ridgeline/ridgeline/edit/main/helpwell/docs/{path}',
      media: MEDIA,
    }),

    dashboard: createDashboard({
      db,
      basePath: DASHBOARD_PATH,
      apiPath: API_PATH,
      isAdmin: admin.isAdmin,
      // With HELPWELL_ADMIN_TOKEN set, the sign-in page asks for it.
      adminToken: admin.adminToken,
      docsDir: 'helpwell/docs/',
      repoUrlTemplate: 'https://github.com/ridgeline/ridgeline/blob/main/helpwell/docs/{path}',
      readInstructions: () => instructions,
      writeInstructions: async (value) => {
        instructions = value;
        await writeFile(INSTRUCTIONS_FILE, value, 'utf8');
      },
      readPlaybook: () => playbook,
      writePlaybook: async (value) => {
        playbook = value;
        await writeFile(PLAYBOOK_FILE, value, 'utf8');
      },
      readEvalCases,
      writeArticle,
    }),
  };
}

const cache = globalThis as typeof globalThis & {
  __ridgelineHelpWell?: Promise<HelpWellHandlers>;
};

/** Every route handler starts here. The first caller boots, the rest queue up. */
export function helpwell(): Promise<HelpWellHandlers> {
  cache.__ridgelineHelpWell ??= boot();
  return cache.__ridgelineHelpWell;
}
