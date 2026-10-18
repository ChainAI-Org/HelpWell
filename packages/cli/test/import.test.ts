/**
 * `helpwell import`, `helpwell webhooks` and `--json`.
 *
 * Imports are exercised end to end against a real project folder: files on
 * disk in, Markdown files and a redirect map out. Platform APIs and the
 * crawler get a fake `fetch` that answers like the real service, because the
 * tests never touch the network.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, rowsOf } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectSource, runImport } from '../src/commands/import.js';
import { init } from '../src/commands/init.js';
import { parseCsv, readContactsFile } from '../src/importers/contacts.js';
import { crawlSite } from '../src/importers/crawl.js';
import { htmlTitle, htmlToMarkdown, mainContent } from '../src/importers/html-to-markdown.js';
import {
  gitbookToMarkdown,
  readGitbook,
  readNotion,
  stripNotionId,
} from '../src/importers/local.js';
import { importFromPlatform } from '../src/importers/platforms.js';
import { run } from '../src/run.js';

let dir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-import-'));
  stdout = [];
  stderr = [];
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HELPWELL_DATABASE_URL;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const path = join(dir, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function read(relative: string): string {
  return readFileSync(join(dir, relative), 'utf8');
}

/** A fake fetch answering from a table of URL -> response. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const route = routes[url];
    return route ? route() : new Response('not found', { status: 404 });
  }) as typeof fetch & { urls: string[] };
  impl.urls = urls;
  return impl;
}

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const html = (body: string) => () =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

/**
 * The one JSON document `--json` printed. Loosely typed on purpose: each test
 * asserts on the shape of the command it ran.
 */
// biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary result shapes
type Loose = any;
function printedJson(): { ok: boolean; command: string; result?: Loose; error?: Loose } {
  return JSON.parse(stdout.join(''));
}

describe('html to markdown', () => {
  it('converts the parts a help article is made of', () => {
    const markdown = htmlToMarkdown(
      `<h1>Exporting invoices</h1>
       <p>Open <strong>Billing</strong>, then <em>Invoices</em> &amp; press <code>Export</code>.</p>
       <ul><li>PDF</li><li>CSV<ul><li>UTF-8</li></ul></li></ul>
       <ol><li>One</li><li>Two</li></ol>
       <blockquote><p>Only owners can export.</p></blockquote>
       <pre><code class="language-bash">curl -X POST
  /invoices</code></pre>
       <p><a href="/help/refunds">Refunds</a> and <img src="/img/a.png" alt="Screen"></p>
       <table><tr><th>Plan</th><th>Seats</th></tr><tr><td>Pro</td><td>5</td></tr></table>
       <script>alert(1)</script>`,
      { baseUrl: 'https://help.acme.com/articles/1' },
    );
    expect(markdown).toBe(
      [
        '# Exporting invoices',
        '',
        'Open **Billing**, then _Invoices_ & press `Export`.',
        '',
        '- PDF',
        '- CSV',
        '   - UTF-8',
        '',
        '1. One',
        '2. Two',
        '',
        '> Only owners can export.',
        '',
        '```bash',
        'curl -X POST',
        '  /invoices',
        '```',
        '',
        '[Refunds](https://help.acme.com/help/refunds) and ![Screen](https://help.acme.com/img/a.png)',
        '',
        '| Plan | Seats |',
        '| --- | --- |',
        '| Pro | 5 |',
      ].join('\n'),
    );
  });

  it('drops scripts and unsafe links, finds the title and the article part of a page', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">x</a>')).toBe('x');
    const page = `<html><head><title>Refunds | Acme Help</title></head><body>
      <nav><a href="/">Home</a></nav><main><h1>Refunds</h1><p>Within 30 days.</p></main>
      <footer>© Acme</footer></body></html>`;
    expect(htmlTitle(page)).toBe('Refunds');
    expect(htmlToMarkdown(mainContent(page))).toBe('# Refunds\n\nWithin 30 days.');
    expect(htmlTitle('<title>Pricing – Acme</title>')).toBe('Pricing');
  });
});

describe('folders', () => {
  it('imports a Markdown folder into collections, and leaves existing files alone', async () => {
    await init({ cwd: dir, name: 'Acme' });
    write(
      'old/billing/refunds.md',
      '---\ntitle: Refunds\ndescription: Money back\n---\n\nWithin 30 days.',
    );
    write('old/billing/deep/tax.md', '# VAT and tax\n\nWe charge VAT.');
    write('old/intro.md', '# Welcome\n\nHello.');
    write('old/README.md', 'not an article');
    write('old/billing/shot.png', 'png-bytes');
    write('old/billing/with-image.md', '# Screens\n\n![The page](shot.png)');

    const result = await runImport({ cwd: dir, source: 'markdown', target: 'old' });
    expect(result.articles?.written.sort()).toEqual(
      [
        join('docs', 'billing', 'deep-tax.md'),
        join('docs', 'billing', 'refunds.md'),
        join('docs', 'billing', 'with-image.md'),
        join('docs', 'old', 'intro.md'),
      ].map((p) => expect.stringContaining(p)),
    );
    expect(read('docs/billing/refunds.md')).toContain('description: Money back');
    expect(read('docs/billing/deep-tax.md')).toContain('title: VAT and tax');
    // The body does not repeat the title it already has in frontmatter.
    expect(read('docs/billing/deep-tax.md')).not.toContain('# VAT and tax');
    expect(JSON.parse(read('docs/billing/_meta.json'))).toEqual({ title: 'Billing' });
    expect(read('docs/billing/with-image.md')).toContain(
      '![The page](../_images/billing/with-image-1.png)',
    );
    expect(read('docs/_images/billing/with-image-1.png')).toBe('png-bytes');

    const again = await runImport({ cwd: dir, source: 'markdown', target: 'old' });
    expect(again.articles?.written).toEqual([]);
    expect(again.articles?.skipped).toHaveLength(4);
  });

  it('works out what a folder is from what is in it', () => {
    write('a/SUMMARY.md', '* [Intro](README.md)');
    write('b/Billing 0123456789abcdef0123456789abcdef.md', '# Billing');
    write('c/page.html', '<h1>x</h1>');
    write('d/page.md', '# x');
    write('people.csv', 'id,email');
    expect(['a', 'b', 'c', 'd', 'people.csv'].map((p) => detectSource(join(dir, p)))).toEqual([
      'gitbook',
      'notion',
      'html',
      'markdown',
      'contacts',
    ]);
  });

  it('reads a GitBook repository from its SUMMARY.md, in order', () => {
    write(
      'book/SUMMARY.md',
      '# Summary\n\n## Getting started\n\n* [Welcome](README.md)\n* [Install](start/install.md)\n\n## Billing\n\n* [Invoices](billing/invoices.md)\n',
    );
    write('book/README.md', '# Welcome\n\n{% hint style="info" %}\nIt is quick.\n{% endhint %}');
    write('book/start/install.md', 'Run the installer.');
    write('book/billing/invoices.md', 'Download them.');
    const plan = readGitbook(join(dir, 'book'));
    expect(plan.articles.map((a) => [a.collection.title, a.title, a.order])).toEqual([
      ['Getting started', 'Welcome', 0],
      ['Getting started', 'Install', 1],
      ['Billing', 'Invoices', 2],
    ]);
    expect(plan.articles[0]!.body).toContain('> **Info:** It is quick.');
    expect(gitbookToMarkdown('{% embed url="https://x.test" %}')).toBe(
      '[https://x.test](https://x.test)',
    );
  });

  it('reads a Notion export without its page ids', () => {
    const id = '0123456789abcdef0123456789abcdef';
    write(`notion/Billing ${id}/Refunds ${id}.md`, '# Refunds\n\nWithin 30 days.');
    write(`notion/Billing ${id}.md`, '# Billing\n\nOverview.');
    const plan = readNotion(join(dir, 'notion'));
    expect(plan.articles.map((a) => [a.collection.title, a.title, a.slug])).toEqual(
      expect.arrayContaining([['Billing', 'Refunds', 'Refunds']]),
    );
    expect(stripNotionId(`Refunds ${id}.md`)).toBe('Refunds.md');
  });
});

describe('platforms', () => {
  it('imports Zendesk sections and articles across pages, with redirects and images', async () => {
    await init({ cwd: dir, name: 'Acme' });
    const base = 'https://acme.zendesk.com/api/v2/help_center/en-us';
    const doFetch = fakeFetch({
      [`${base}/sections.json?per_page=100`]: json({
        sections: [{ id: 1, name: 'Billing', description: 'Money', position: 2 }],
        next_page: null,
      }),
      [`${base}/articles.json?per_page=100`]: json({
        articles: [
          {
            title: 'Refunds',
            body: '<p>Within 30 days.</p><img src="https://cdn.test/r.png" alt="Form">',
            html_url: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
            section_id: 1,
            draft: false,
          },
        ],
        next_page: `${base}/articles.json?page=2&per_page=100`,
      }),
      [`${base}/articles.json?page=2&per_page=100`]: json({
        articles: [
          {
            title: 'Old plans',
            body: '<p>Gone.</p>',
            html_url: 'https://acme.zendesk.com/hc/en-us/articles/12-Old-plans',
            section_id: 1,
            draft: true,
          },
        ],
        next_page: null,
      }),
      'https://cdn.test/r.png': () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        }),
    });

    const result = await runImport({
      cwd: dir,
      source: 'zendesk',
      subdomain: 'acme',
      fetch: doFetch,
      env: {},
    });
    expect(result.articles).toMatchObject({
      found: 2,
      redirects: 2,
      images: { saved: 1, failed: 0 },
    });
    expect(read('docs/billing/old-plans.md')).toContain('status: draft');
    expect(read('docs/billing/refunds.md')).toContain('![Form](../_images/billing/refunds-1.png)');
    expect(JSON.parse(read('docs/billing/_meta.json'))).toEqual({
      title: 'Billing',
      description: 'Money',
      order: 2,
    });
    expect(JSON.parse(read('helpwell/redirects.json')).redirects).toContainEqual({
      from: 'https://acme.zendesk.com/hc/en-us/articles/11-Refunds',
      to: '/help/billing/refunds',
    });
  });

  it('reads Intercom with a bearer token from the environment and says when the token is missing', async () => {
    await expect(importFromPlatform('intercom', { env: {}, fetch: fakeFetch({}) })).rejects.toThrow(
      /INTERCOM_TOKEN/,
    );
    const seen: Headers[] = [];
    const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      const url = String(input);
      if (url.includes('/help_center/collections')) {
        return json({ data: [{ id: '7', name: 'Account' }], pages: { total_pages: 1 } })();
      }
      return json({
        data: [
          {
            title: 'Two-factor',
            body: '<p>Turn it on.</p>',
            state: 'published',
            parent_id: 7,
            url: 'https://help.acme.com/en/articles/1',
          },
        ],
        pages: { total_pages: 1 },
      })();
    }) as typeof fetch;
    const plan = await importFromPlatform('intercom', {
      env: { INTERCOM_TOKEN: 'tok' },
      fetch: doFetch,
    });
    expect(plan.articles).toEqual([
      expect.objectContaining({
        title: 'Two-factor',
        body: 'Turn it on.',
        collection: expect.objectContaining({ title: 'Account' }),
      }),
    ]);
    expect(seen[0]!.get('authorization')).toBe('Bearer tok');
  });

  it('crawls a help site from its sitemap into drafts, skipping listing pages', async () => {
    const article = (title: string) =>
      html(
        `<html><head><title>${title} | Acme</title></head><body><nav>Menu</nav><article><h1>${title}</h1><p>${'Useful words here. '.repeat(10)}</p></article></body></html>`,
      );
    const doFetch = fakeFetch({
      'https://help.acme.com/sitemap.xml': () =>
        new Response(
          '<urlset><url><loc>https://help.acme.com/docs/billing/refunds</loc></url><url><loc>https://help.acme.com/docs/billing</loc></url><url><loc>https://blog.acme.com/x</loc></url></urlset>',
          { headers: { 'content-type': 'application/xml' } },
        ),
      'https://help.acme.com/docs/billing/refunds': article('Refunds'),
      'https://help.acme.com/docs/billing': html(
        '<html><body><main><a href="/docs/billing/refunds">Refunds</a></main></body></html>',
      ),
    });
    const plan = await crawlSite('https://help.acme.com/docs', { fetch: doFetch });
    expect(plan.articles).toEqual([
      expect.objectContaining({
        title: 'Refunds',
        status: 'draft',
        collection: { title: 'Billing' },
        sourceUrl: 'https://help.acme.com/docs/billing/refunds',
      }),
    ]);
    expect(doFetch.urls).not.toContain('https://blog.acme.com/x');
  });
});

describe('contacts', () => {
  it('parses CSV the way spreadsheets write it', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
    expect(
      readContactsFile(
        'User ID,Email,Full name,Signed up at,Tags,Plan,Seats,Beta\nusr_1,a@b.co,Ada,2025-01-02,vip;beta,pro,4,true\n',
        'csv',
      ),
    ).toEqual([
      {
        id: 'usr_1',
        email: 'a@b.co',
        name: 'Ada',
        signedUpAt: '2025-01-02',
        tags: ['vip', 'beta'],
        attributes: { Plan: 'pro', Seats: 4, Beta: true },
      },
    ]);
  });

  it('imports a CSV, checks it first with --dry-run, and prints JSON', async () => {
    await init({ cwd: dir, name: 'Acme' });
    write(
      'people.csv',
      'id,email,name,plan\nusr_1,ada@acme.test,Ada,pro\n,no-id-no-email,,\nusr_2,,Bob,team\n',
    );
    stdout.length = 0;

    const check = await run(['import', 'contacts', 'people.csv', '--dry-run', '--json'], dir);
    expect(check.exitCode).toBe(0);
    const dry = printedJson();
    expect(dry).toMatchObject({
      ok: true,
      command: 'import',
      result: { kind: 'contacts', dryRun: true, contacts: { created: 2, updated: 0, rows: 3 } },
    });
    expect(dry.result.contacts.skipped).toEqual([
      { row: 2, reason: '"no-id-no-email" is not an email address' },
    ]);

    stdout.length = 0;
    await run(['import', 'people.csv', '--json'], dir);
    expect(printedJson().result.contacts).toMatchObject({ created: 2 });

    const handle = await createDb({ url: `pglite://${join(dir, 'helpwell', 'data')}` });
    try {
      const rows = rowsOf<{
        external_id: string;
        source: string;
        consent: string;
        attributes: Record<string, unknown>;
      }>(
        await handle.db.execute(
          sql`SELECT external_id, source, consent, attributes FROM helpwell.contacts ORDER BY external_id`,
        ),
      );
      expect(rows).toEqual([
        { external_id: 'usr_1', source: 'import', consent: 'unknown', attributes: { plan: 'pro' } },
        {
          external_id: 'usr_2',
          source: 'import',
          consent: 'unknown',
          attributes: { plan: 'team' },
        },
      ]);
    } finally {
      await handle.close();
    }
  });

  it('prints a setup prompt for preparing the export, with no secrets in it', async () => {
    const result = await runImport({ cwd: dir, prompt: true });
    expect(result.prompt).toContain('npx helpwell import contacts contacts.csv --dry-run');
    expect(result.prompt).toContain('Never ask me to paste a password');
  });
});

describe('--json', () => {
  it('prints exactly one JSON document on stdout, and the working on stderr', async () => {
    await init({ cwd: dir, name: 'Acme' });
    stdout.length = 0;
    stderr.length = 0;
    const result = await run(['migrate', '--json'], dir);
    expect(result.exitCode).toBe(0);
    const document = printedJson();
    expect(document.ok).toBe(true);
    expect(document.command).toBe('migrate');
    expect(document.result.total).toBeGreaterThan(4);
    expect(stderr.join('')).toContain('Migrating');
  });

  it('answers a failure as JSON with a code', async () => {
    const result = await run(['sync', '--json'], dir);
    expect(result.exitCode).toBe(1);
    expect(printedJson()).toMatchObject({
      ok: false,
      command: 'sync',
      error: { code: 'not_installed' },
    });
  });

  it('lists the commands, and refuses the interactive one', async () => {
    await run(['--json'], dir);
    const help = printedJson();
    expect(help.result.commands.map((c: { name: string }) => c.name)).toContain('import');
    stdout.length = 0;
    expect((await run(['dev', '--json'], dir)).exitCode).toBe(1);
    expect(printedJson().error.message).toContain('interactive');
  });

  it('prints the export itself when there is no --out, with secrets redacted', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await run(['migrate'], dir);
    stdout.length = 0;
    await run(['export', '--json'], dir);
    const document = printedJson();
    expect(document.result.anonymised).toBe(false);
    expect(Object.keys(document.result.data)).toContain('segments');
  });
});

describe('webhooks', () => {
  it('lists, retries and tests deliveries from the terminal', async () => {
    await init({ cwd: dir, name: 'Acme' });
    await run(['migrate'], dir);
    const handle = await createDb({ url: `pglite://${join(dir, 'helpwell', 'data')}` });
    try {
      await new SettingsStore(handle.db).update({
        webhooks: [{ url: 'https://hooks.test/in', events: [], secret: 'k' }],
      });
      await handle.db.execute(sql`
        INSERT INTO helpwell.webhook_deliveries (id, event, url, payload, body, status, attempts, next_attempt_at)
        VALUES ('whk_1', 'gap.created', 'https://hooks.test/in', '{}'::jsonb, '{"event":"gap.created"}',
                'failed', 1, now() + interval '1 hour')
      `);
    } finally {
      await handle.close();
    }
    const sent: string[] = [];
    vi.stubGlobal('fetch', (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response('ok');
    }) as typeof fetch);
    // Caught on the stand-in global fetch: the webhook guard is off, the
    // local-development switch the CLI reads from its environment.
    vi.stubEnv('HELPWELL_WEBHOOK_GUARD', 'off');
    try {
      stdout.length = 0;
      await run(['webhooks', 'retry', '--json'], dir);
      expect(printedJson().result).toMatchObject({ attempted: 0 });

      stdout.length = 0;
      await run(['webhooks', 'retry', '--now', '--json'], dir);
      expect(printedJson().result).toMatchObject({ attempted: 1, delivered: 1 });
      expect(sent).toEqual(['{"event":"gap.created"}']);

      stdout.length = 0;
      await run(['webhooks', 'test', '--json'], dir);
      expect(printedJson()).toMatchObject({ ok: true, command: 'webhooks test' });

      stdout.length = 0;
      await run(['webhooks', '--json'], dir);
      const list = printedJson().result as { event: string; status: string }[];
      expect(list.map((d) => [d.event, d.status])).toEqual([
        ['webhook.test', 'delivered'],
        ['gap.created', 'delivered'],
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
    expect(existsSync(join(dir, 'helpwell', 'data'))).toBe(true);
  });
});
