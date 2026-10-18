/**
 * The CLI's half of screenshots and blocks: `sync` rewriting an article's
 * screenshot to the URL the API serves it at (end to end, through a real
 * handler), and `docs generate` / `docs update` knowing the block vocabulary
 * and the configured shots, and never keeping an image they invented.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHelpWellHandler } from '@helpwell/core';
import { FakeModel } from '@helpwell/core/agent';
import { createDb, schema } from '@helpwell/core/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  availableShots,
  BLOCK_VOCABULARY,
  docsGenerate,
  docsUpdate,
  keepKnownImages,
} from '../src/commands/docs.js';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { loadProject, mediaPathsFor } from '../src/project.js';
import { docsReadme, mountSnippet } from '../src/templates.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let dir: string;
let output: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-media-'));
  output = [];
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HELPWELL_DATABASE_URL;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  await init({ cwd: dir, name: 'Acme' });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, contents: string | Buffer): void {
  const path = join(dir, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function configure(change: (config: Record<string, unknown>) => void): void {
  const path = join(dir, 'helpwell', 'helpwell.config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  change(config);
  writeFileSync(path, JSON.stringify(config), 'utf8');
}

describe('sync, end to end', () => {
  it('rewrites a screenshot path to where the API serves it, and the API serves it', async () => {
    configure((config) => {
      config.apiPath = '/support/api';
    });
    write('docs/_screenshots/dashboard.png', PNG);
    write(
      'docs/getting-started/tour.md',
      '---\ntitle: The tour\n---\n\n![The dashboard](../_screenshots/dashboard.png)\n',
    );

    const result = await sync({ cwd: dir, settings: false });
    expect(result.articles).toBe(2);

    const handle = await createDb({ url: `pglite://${join(dir, 'helpwell', 'data')}` });
    try {
      const rows = await handle.db.select().from(schema.articleIndex);
      const tour = rows.find((row) => row.slug === 'getting-started/tour');
      expect(tour?.body).toBe('![The dashboard](/support/api/screenshots/dashboard.png)');
      expect(tour?.path).toBe('getting-started/tour.md');
      expect(tour?.source).toContain('../_screenshots/dashboard.png');

      const api = createHelpWellHandler({
        db: handle.db,
        basePath: '/support/api',
        media: { docs: join(dir, 'docs') },
      });
      const response = await api(
        new Request('http://localhost/support/api/screenshots/dashboard.png'),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
    } finally {
      await handle.close();
    }
  }, 240_000);

  it('knows where a screenshots folder outside the docs sits', () => {
    configure((config) => {
      config.screenshots = { dir: 'public/shots', shots: [] };
    });
    expect(mediaPathsFor(loadProject(dir))).toEqual({
      apiPath: '/api/helpwell',
      screenshots: '../public/shots',
    });
  });
});

describe('what the docs commands know about blocks and screenshots', () => {
  beforeEach(() => {
    configure((config) => {
      config.screenshots = {
        dir: 'docs/_screenshots',
        shots: [
          { name: 'billing', path: '/settings/billing', dark: true },
          { name: 'team', path: '/team' },
        ],
      };
    });
    write('docs/_screenshots/billing.png', PNG);
  });

  it('lists the configured shots by the path an article uses', () => {
    expect(availableShots(loadProject(dir))).toEqual([
      { ref: '../_screenshots/billing.png', path: '/settings/billing', captured: true },
      { ref: '../_screenshots/billing-dark.png', path: '/settings/billing', captured: false },
      { ref: '../_screenshots/team.png', path: '/team', captured: false },
    ]);
  });

  it('removes any image that is not an allowed shot, and leaves code alone', () => {
    const allowed = new Set(['../_screenshots/billing.png']);
    const { body, removed } = keepKnownImages(
      [
        'Open billing.',
        '',
        '![Billing](../_screenshots/billing.png)',
        '![Made up](../_screenshots/invented.png)',
        'Inline ![x](https://example.com/fake.png) here.',
        '`![literal](../_screenshots/nope.png)`',
        '```',
        '![fenced](../_screenshots/nope.png)',
        '```',
      ].join('\n'),
      allowed,
    );
    expect(removed).toEqual(['../_screenshots/invented.png', 'https://example.com/fake.png']);
    expect(body).toBe(
      [
        'Open billing.',
        '',
        '![Billing](../_screenshots/billing.png)',
        'Inline  here.',
        '`![literal](../_screenshots/nope.png)`',
        '```',
        '![fenced](../_screenshots/nope.png)',
        '```',
      ].join('\n'),
    );
  });

  it('teaches generate the blocks and the shots, and strips an invented screenshot', async () => {
    const model = new FakeModel([
      {
        text: JSON.stringify({
          articles: [
            {
              collection: 'Billing',
              title: 'Changing your plan',
              description: 'd',
              body: ':::steps\n### Open Billing\n![Billing](../_screenshots/billing.png)\n### Pick a plan\n![Plans](../_screenshots/plans.png)\n:::',
            },
          ],
        }),
      },
    ]);
    const written = await docsGenerate({ cwd: dir, model, count: 1 });

    const system = model.requests[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('[!WARNING]');
    expect(system).toContain(':::steps');
    expect(system).toContain(':::tabs');
    expect(system).toContain(':::details');
    expect(system).toContain('- ../_screenshots/billing.png: the page at /settings/billing');
    expect(system).toContain('- ../_screenshots/team.png: the page at /team');
    expect(system).toContain('Never invent an image path');

    const file = readFileSync(join(dir, 'docs/billing/changing-your-plan.md'), 'utf8');
    expect(file).toContain('![Billing](../_screenshots/billing.png)');
    expect(file).not.toContain('plans.png');
    expect(written[0]?.body).not.toContain('plans.png');
    expect(output.join('')).toContain('removed 1 image the model invented');
  });

  it('tells generate there are no screenshots when none are configured', async () => {
    configure((config) => {
      config.screenshots = { dir: 'docs/_screenshots', shots: [] };
    });
    const model = new FakeModel([{ text: '{"articles":[]}' }]);
    await docsGenerate({ cwd: dir, model, count: 1 });
    const system = model.requests[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('There are no screenshots to use. Do not add any image.');
  });

  it('lets update keep an article’s own images and the shots, and nothing else', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('config', 'user.email', 'tests@example.com');
    git('config', 'user.name', 'HelpWell tests');
    git('config', 'commit.gpgsign', 'false');
    write(
      'docs/billing/invoices.md',
      '---\ntitle: Invoices\nstatus: published\n---\n\nInvoices are generated on a monthly schedule and emailed to the billing contact.\n\n![Invoice](./invoice.png)\n',
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    write(
      'src/invoices.ts',
      '// Invoices are generated on a weekly schedule and emailed to the billing contact.\nexport const invoiceSchedule = "weekly";\n',
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'weekly invoices');
    const first = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();

    const model = new FakeModel([
      {
        text: JSON.stringify({
          stale: true,
          reason: 'Invoices are weekly now.',
          body: 'Invoices are generated weekly.\n\n![Invoice](./invoice.png)\n\n![Billing](../_screenshots/billing.png)\n\n![Invented](../_screenshots/weekly.png)',
        }),
      },
    ]);
    const proposals = await docsUpdate({ cwd: dir, model, since: first });
    expect(proposals).toHaveLength(1);

    const system = model.requests[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain(BLOCK_VOCABULARY[1]);
    // The model is shown the article as written, relative paths and all.
    const user = model.requests[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toContain('![Invoice](./invoice.png)');

    const file = readFileSync(join(dir, 'docs/billing/invoices.md'), 'utf8');
    expect(file).toContain('![Invoice](./invoice.png)');
    expect(file).toContain('![Billing](../_screenshots/billing.png)');
    expect(file).not.toContain('weekly.png');
    expect(output.join('')).toContain('removed 1 invented image');
  }, 240_000);
});

describe('the templates init writes', () => {
  it('documents every block, and the screenshot setup with prompts that carry no secret', () => {
    const readme = docsReadme('Acme');
    for (const syntax of [
      '> [!TIP]',
      ':::steps',
      ':::tabs',
      '== macOS',
      ':::details',
      'youtube.com/watch',
    ]) {
      expect(readme).toContain(syntax);
    }
    expect(readme).toContain('![The dashboard](../_screenshots/dashboard.png)');
    expect(readme).toContain('"annotate"');
    expect(readme).toContain('"login"');
    expect(readme.match(/### Set this up with an AI assistant/g)).toHaveLength(2);
    expect(readme).toContain('HELPWELL_CAPTURE_PASSWORD');
    expect(readme).toContain('Never ask me to paste a password');
    // A fence inside a prompt never closes the block the prompt sits in.
    expect(readme).toContain('````\nYou are helping me set up screenshot capture');
  });

  it('mounts media and the article hook in the snippet it prints', () => {
    const snippet = mountSnippet('next');
    expect(snippet).toContain("media: { docs: 'docs', screenshots: 'docs/_screenshots' }");
    expect(snippet).toContain('writeArticle: async (path, markdown) =>');
  });
});
