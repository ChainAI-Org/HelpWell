/**
 * Boots Ridgeline (examples/playground) for the end-to-end suite.
 *
 * Production build, PGlite in memory, the scripted model: the same app a
 * developer runs, with nothing mocked inside HelpWell. Three things differ,
 * each so the run is safe and repeatable:
 *
 * - It runs from a scratch copy of the playground's `helpwell/` folder.
 *   `next start` leaves the working directory alone, and the playground finds
 *   its docs, playbook and eval cases from there, so an article a test saves
 *   lands in the copy, never in the repo, and every run starts from the same
 *   docs. The suite's own fixture articles (e2e/fixtures/docs) are added to
 *   the copy.
 * - Real keys are stripped from the environment (env.mjs) and the server
 *   runs behind offline-guard.mjs, so nothing it does reaches the network.
 * - The bot check's secret is Cloudflare's always-pass test secret, and a
 *   second origin may run the widget (HELPWELL_CORS_ORIGINS). Both do nothing
 *   until a test switches them on in Settings.
 *
 * The playground is rebuilt only when its own source is newer than the last
 * build: HelpWell's packages are loaded from their dist at runtime, not
 * bundled. E2E_BUILD=always|never overrides that.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withoutSecrets } from './env.mjs';
import {
  E2E_ADMIN_TOKEN,
  HOST_ORIGIN,
  PLAYGROUND_PORT,
  TURNSTILE_TEST_SECRET,
  WORK_DIR,
} from './ports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const playground = join(root, 'examples', 'playground');
const nextBin = join(playground, 'node_modules', 'next', 'dist', 'bin', 'next');

/* ------------------------------------------------------------- the build */

/** The newest modification time under `path`, or 0 when it does not exist. */
function newest(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = stat.mtimeMs;
  for (const entry of readdirSync(path)) latest = Math.max(latest, newest(join(path, entry)));
  return latest;
}

function needsBuild() {
  const mode = process.env.E2E_BUILD ?? 'auto';
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  const built = join(playground, '.next', 'BUILD_ID');
  if (!existsSync(built)) return true;
  const inputs = ['app', 'lib', 'components', 'next.config.ts', 'package.json', 'tsconfig.json'];
  const source = Math.max(...inputs.map((input) => newest(join(playground, input))));
  return source > statSync(built).mtimeMs;
}

const baseEnv = {
  ...withoutSecrets(process.env),
  NEXT_TELEMETRY_DISABLED: '1',
};

if (needsBuild()) {
  console.log('[e2e] building the playground');
  const build = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: playground,
    env: baseEnv,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

/* --------------------------------------------------------- the work dir */

rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });
cpSync(join(playground, 'helpwell'), join(WORK_DIR, 'helpwell'), { recursive: true });
cpSync(join(root, 'e2e', 'fixtures', 'docs'), join(WORK_DIR, 'helpwell', 'docs'), {
  recursive: true,
});

/* ------------------------------------------------------------ the server */

const guard = pathToFileURL(join(here, 'offline-guard.mjs')).href;
const env = {
  ...baseEnv,
  NODE_ENV: 'production',
  NODE_OPTIONS: `${baseEnv.NODE_OPTIONS ?? ''} --import "${guard}"`.trim(),
  HELPWELL_TURNSTILE_SECRET: TURNSTILE_TEST_SECRET,
  // A production build admits only the admin token (fixtures.ts signs in with it).
  HELPWELL_ADMIN_TOKEN: E2E_ADMIN_TOKEN,
  HELPWELL_CORS_ORIGINS: HOST_ORIGIN,
};

const log = createWriteStream(join(WORK_DIR, 'server.log'));
const server = spawn(
  process.execPath,
  [nextBin, 'start', playground, '--port', String(PLAYGROUND_PORT)],
  { cwd: WORK_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] },
);
server.stdout.on('data', (chunk) => {
  log.write(chunk);
  process.stdout.write(chunk);
});
server.stderr.on('data', (chunk) => {
  log.write(chunk);
  process.stderr.write(chunk);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
