/**
 * The mount code `helpwell init` prints is code people paste and deploy, so
 * it is tested like code: each framework's files mount all three handlers
 * and pass the agent's instructions and playbook; the admin check really
 * runs, against the requests an attacker would send; and the files compile
 * against the packages' real types, as a strict app would compile them.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { init } from '../src/commands/init.js';
import { envExample, type MountFile, mountFiles, mountSnippet } from '../src/templates.js';

const FRAMEWORKS = ['next', 'remix', 'hono', 'node'] as const;
const PACKAGES = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/');
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/');

const shared = (files: MountFile[]) =>
  files.find((file) => /helpwell(\.server)?\.ts$/.test(file.path))!;

describe('the mount code for each framework', () => {
  it('mounts the API, the help centre and the dashboard, and answers the preflight', () => {
    const expected = {
      next: {
        paths: [
          'lib/helpwell.ts',
          'app/api/helpwell/[[...route]]/route.ts',
          'app/help/[[...slug]]/route.ts',
          'app/admin/helpwell/[[...route]]/route.ts',
          'next.config.ts',
        ],
        preflight: 'export const OPTIONS = api;',
      },
      remix: {
        paths: [
          'app/lib/helpwell.server.ts',
          'app/routes/api.helpwell.$.tsx',
          'app/routes/help.$.tsx',
          'app/routes/admin.helpwell.$.tsx',
        ],
        // Remix hands OPTIONS to the loader, which is the API handler.
        preflight: 'export const loader = ({ request }: { request: Request }) => api(request);',
      },
      hono: {
        paths: ['lib/helpwell.ts', 'the file that creates your Hono app'],
        preflight: "app.all('/api/helpwell/*', (c) => api(c.req.raw));",
      },
      node: {
        paths: ['lib/helpwell.ts', 'lib/helpwell-node.ts'],
        preflight: "if (under('/api/helpwell')) return api;",
      },
    };
    for (const framework of FRAMEWORKS) {
      const files = mountFiles(framework);
      expect(files.map((file) => file.path)).toEqual(expected[framework].paths);
      const all = files.map((file) => file.content).join('\n');
      expect(all, framework).toContain(expected[framework].preflight);
      for (const handler of ['api', 'help', 'dashboard']) {
        expect(all, `${framework} mounts ${handler}`).toMatch(
          new RegExp(`(${handler}\\((request|c\\.req\\.raw)\\)|= ${handler};|return ${handler};)`),
        );
      }
    }
    // Every method the API answers, on Next.js, where each is exported by name.
    const nextApi = mountFiles('next')[1]!.content;
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(nextApi).toContain(`export const ${method} = api;`);
    }
    expect(mountFiles('next')[3]!.content).toContain('export const POST = dashboard;');
  });

  it('passes the instructions and playbook, and one admin check to both the API and the dashboard', () => {
    for (const framework of FRAMEWORKS) {
      const module = shared(mountFiles(framework)).content;
      expect(module).toContain("instructions: read('helpwell/instructions.md'),");
      expect(module).toContain("playbook: read('helpwell/playbook.md'),");
      expect(module.match(/^\s+isAdmin,$/gm), framework).toHaveLength(2);
      expect(module.match(/^\s+adminToken: adminToken\(\),$/gm), framework).toHaveLength(2);
      expect(module).toContain('TODO: replace with your app');
      expect(module).toContain('export function getHelpWell()');
      // The old placeholder is gone: the only cookie read is the one holding the token.
      expect(module).not.toContain("headers.get('cookie')");
      expect(module).not.toContain('role=admin');
    }
  });

  it('uses the docs folder it is given', () => {
    const snippet = mountSnippet('next', 'handbook');
    expect(snippet).toContain("media: { docs: 'handbook', screenshots: 'handbook/_screenshots' }");
    expect(snippet).toContain("join(process.cwd(), 'handbook', path)");
  });

  it('names HELPWELL_ADMIN_TOKEN in .env.example, with no value', () => {
    expect(envExample).toMatch(/^# HELPWELL_ADMIN_TOKEN=$/m);
  });
});

describe('what `helpwell init` prints', () => {
  let dir: string;
  let output: string[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'helpwell-init-print-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  it('is the mount code for the docs folder given, with the admin check called out', async () => {
    output = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    await init({ cwd: dir, name: 'Acme', docs: 'handbook', framework: 'remix', env: {} });
    const printed = output.join('');
    expect(printed).toContain('app/routes/admin.helpwell.$.tsx');
    expect(printed).toContain("media: { docs: 'handbook', screenshots: 'handbook/_screenshots' }");
    expect(printed).toContain('isAdmin fails closed');
  });
});

/* ------------------------------------------------ the admin check, run */

/**
 * The shared module, compiled to JavaScript and run with HelpWell's packages
 * swapped for stubs that record what they were given. What runs is the
 * template's own text, so this is the code a person would deploy.
 * `@helpwell/core/api` is left real, so the cookie is read the way the
 * packages read it.
 */
const STUBS: Record<string, string> = {
  '@helpwell/core': `export function createHelpWellHandler(config) {
  globalThis.__helpwellTemplate.api = config;
  return async () => new Response('api');
}`,
  '@helpwell/core/db': `export async function createDb() {
  const record = globalThis.__helpwellTemplate;
  record.opened += 1;
  if (record.failNextOpen) {
    record.failNextOpen = false;
    throw new Error('the database is down');
  }
  return { db: { stub: true } };
}
export async function migrate() { globalThis.__helpwellTemplate.migrated = true; }`,
  '@helpwell/dashboard': `export function createDashboard(config) {
  globalThis.__helpwellTemplate.dashboard = config;
  return async () => new Response('dashboard');
}`,
  '@helpwell/helpcenter': `export function createHelpCenter(config) {
  globalThis.__helpwellTemplate.help = config;
  return async () => new Response('help');
}`,
  '@helpwell/widget/server': 'export function widgetAssets() { return {}; }',
};
const REAL = new Set(['@helpwell/core/api']);

type Handler = (request: Request) => Promise<Response>;

interface Recorded {
  opened: number;
  failNextOpen: boolean;
  migrated: boolean;
  api?: {
    isAdmin: (request: Request) => boolean;
    adminToken?: string;
    instructions: unknown;
    playbook: unknown;
  };
  dashboard?: {
    isAdmin: (request: Request) => boolean;
    adminToken?: string;
    writeArticle: unknown;
  };
  help?: { basePath: string };
}

interface SharedModule {
  api: Handler;
  help: Handler;
  dashboard: Handler;
  getHelpWell: () => Promise<unknown>;
}

async function loadShared(
  framework: (typeof FRAMEWORKS)[number],
  dir: string,
  record: Recorded,
): Promise<SharedModule> {
  const source = shared(mountFiles(framework)).content;
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace(/from (['"])(@helpwell\/[^'"]+)\1/g, (match, _quote, specifier: string) => {
    if (REAL.has(specifier)) return match;
    if (!(specifier in STUBS)) {
      throw new Error(`The template imports ${specifier}, which has no stub`);
    }
    return `from './stub-${specifier.replace(/\W+/g, '-')}.mjs'`;
  });
  for (const [specifier, stub] of Object.entries(STUBS)) {
    writeFileSync(join(dir, `stub-${specifier.replace(/\W+/g, '-')}.mjs`), stub, 'utf8');
  }
  const file = join(dir, `helpwell-${framework}.mjs`);
  writeFileSync(file, js, 'utf8');
  const global = globalThis as { __helpwellTemplate?: Recorded; __helpwell?: unknown };
  global.__helpwellTemplate = record;
  // Each framework's module starts from nothing, as a fresh process would.
  delete global.__helpwell;
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as SharedModule;
}

describe('the shared module the templates ship', () => {
  const TOKEN = 'f3b1c2d4e5a6978812345678901234567890abcdef0123456789abcdef012345';
  let dir: string;
  let saved: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'helpwell-template-run-'));
    saved = process.env.HELPWELL_ADMIN_TOKEN;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as { __helpwell?: unknown }).__helpwell;
    if (saved === undefined) delete process.env.HELPWELL_ADMIN_TOKEN;
    else process.env.HELPWELL_ADMIN_TOKEN = saved;
  });

  const request = (headers: Record<string, string> = {}) =>
    new Request('https://app.example.com/admin/helpwell', { headers });

  /** Every way a browser, or a script pretending to be one, could claim to be an admin by itself. */
  const crafted: Record<string, string>[] = [
    { cookie: 'role=admin' },
    { cookie: 'role=admin; admin=true; isAdmin=1; hw_admin=yes; helpwell_admin=1' },
    { cookie: `hw_admin=${TOKEN.slice(0, -1)}0` },
    { 'x-admin': 'true', 'x-role': 'admin', 'x-forwarded-for': '127.0.0.1', host: 'localhost' },
    { authorization: 'Bearer' },
    { authorization: 'Bearer ' },
    { authorization: 'Basic YWRtaW46YWRtaW4=' },
  ];

  for (const framework of FRAMEWORKS) {
    it(`${framework}: opens nothing on import, and once for every request after`, async () => {
      const record: Recorded = { opened: 0, failNextOpen: false, migrated: false };
      const module = await loadShared(framework, dir, record);
      // What `next build` does: import the module. Nothing is opened.
      expect(record.opened).toBe(0);
      expect(record.migrated).toBe(false);

      // The first start fails (the database is down); it is not kept.
      record.failNextOpen = true;
      await expect(module.api(request())).rejects.toThrow('the database is down');

      const responses = await Promise.all([
        module.api(request()),
        module.help(request()),
        module.dashboard(request()),
        module.api(request()),
      ]);
      expect(await Promise.all(responses.map((response) => response.text()))).toEqual([
        'api',
        'help',
        'dashboard',
        'api',
      ]);
      expect(record.opened).toBe(2);
      expect(record.migrated).toBe(true);
      expect(typeof record.api?.instructions).toBe('string');
      expect(typeof record.api?.playbook).toBe('string');
      expect(typeof record.dashboard?.writeArticle).toBe('function');
      expect(record.help?.basePath).toBe('/help');
    });

    it(`${framework}: admits only the admin token, as a bearer or in its cookie, and nobody until it is set`, async () => {
      delete process.env.HELPWELL_ADMIN_TOKEN;
      const record: Recorded = { opened: 0, failNextOpen: false, migrated: false };
      const module = await loadShared(framework, dir, record);
      await module.getHelpWell();
      // No token: the packages are given none, so the dashboard offers no form.
      expect(record.api?.adminToken).toBeUndefined();
      expect(record.dashboard?.adminToken).toBeUndefined();
      expect(record.api?.isAdmin).toBe(record.dashboard?.isAdmin);
      const isAdmin = record.dashboard!.isAdmin;

      for (const headers of [
        ...crafted,
        { authorization: `Bearer ${TOKEN}` },
        { cookie: `hw_admin=${TOKEN}` },
      ]) {
        expect(isAdmin(request(headers)), JSON.stringify(headers)).toBe(false);
      }

      process.env.HELPWELL_ADMIN_TOKEN = TOKEN;
      for (const headers of [...crafted, { authorization: `Bearer ${TOKEN}x` }]) {
        expect(isAdmin(request(headers)), JSON.stringify(headers)).toBe(false);
      }
      expect(isAdmin(request({ authorization: `Bearer ${TOKEN}` }))).toBe(true);
      expect(isAdmin(request({ authorization: `bearer ${TOKEN}` }))).toBe(true);
      // The cookie the dashboard's token form sets: it holds the secret itself.
      expect(isAdmin(request({ cookie: `theme=dark; hw_admin=${TOKEN}` }))).toBe(true);

      // A token anyone could guess is no token.
      process.env.HELPWELL_ADMIN_TOKEN = 'admin';
      expect(isAdmin(request({ authorization: 'Bearer admin' }))).toBe(false);
      expect(isAdmin(request({ cookie: 'hw_admin=admin' }))).toBe(false);
    });

    it(`${framework}: hands a long enough token to both packages, and a short one to neither`, async () => {
      process.env.HELPWELL_ADMIN_TOKEN = TOKEN;
      const record: Recorded = { opened: 0, failNextOpen: false, migrated: false };
      await (await loadShared(framework, dir, record)).getHelpWell();
      expect(record.api?.adminToken).toBe(TOKEN);
      expect(record.dashboard?.adminToken).toBe(TOKEN);

      process.env.HELPWELL_ADMIN_TOKEN = 'short';
      const short: Recorded = { opened: 0, failNextOpen: false, migrated: false };
      await (await loadShared(framework, dir, short)).getHelpWell();
      expect(short.api?.adminToken).toBeUndefined();
      expect(short.dashboard?.adminToken).toBeUndefined();
    });
  }
});

/* ------------------------------------------- the templates, compiled */

/** The compiler options a new Next.js app starts with, plus the paths each framework uses. */
function compilerOptions(dir: string): ts.CompilerOptions {
  const out = dir.replace(/\\/g, '/');
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      types: ['node'],
      typeRoots: [`${ROOT}node_modules/@types`],
      paths: {
        '@/*': [`${out}/*`],
        '~/*': [`${out}/app/*`],
        // The workspace's own packages, as an app that installed them sees them: their built types.
        '@helpwell/core': [`${PACKAGES}core/dist/index.d.ts`],
        '@helpwell/core/*': [`${PACKAGES}core/dist/*`],
        '@helpwell/dashboard': [`${PACKAGES}dashboard/dist/index.d.ts`],
        '@helpwell/helpcenter': [`${PACKAGES}helpcenter/dist/index.d.ts`],
        '@helpwell/widget/server': [`${PACKAGES}widget/dist/server.d.ts`],
      },
    },
    out,
  );
  expect(errors).toEqual([]);
  return options;
}

function compile(framework: (typeof FRAMEWORKS)[number]): string[] {
  const dir = mkdtempSync(join(tmpdir(), `helpwell-template-${framework}-`));
  try {
    const files: string[] = [];
    for (const file of mountFiles(framework)) {
      if (file.merge) continue;
      const path = join(dir, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content, 'utf8');
      files.push(path);
    }
    const program = ts.createProgram(files, compilerOptions(dir));
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const where = diagnostic.file
        ? `${diagnostic.file.fileName}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}: `
        : '';
      return `${where}${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the templates compile against the real types', () => {
  it('has the built types to compile against', () => {
    for (const types of [
      'core/dist/index.d.ts',
      'dashboard/dist/index.d.ts',
      'widget/dist/server.d.ts',
    ]) {
      expect(
        readFileSync(`${PACKAGES}${types}`, 'utf8').length,
        `${types} is missing: run \`pnpm build\` first`,
      ).toBeGreaterThan(0);
    }
  });

  for (const framework of ['next', 'remix', 'node'] as const) {
    it(`${framework}, under a strict Next.js-style tsconfig`, () => {
      expect(compile(framework)).toEqual([]);
    });
  }
});
