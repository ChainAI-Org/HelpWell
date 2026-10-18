/**
 * The shared docs pieces a host uses when it reads a repository through an
 * API instead of a checkout: which changed files are watched, what context a
 * model gets, and which articles a diff touches.
 */

import { describe, expect, it } from 'vitest';
import {
  assembleRepoContext,
  contextCandidates,
  globToRegExp,
  isListed,
  isLockfile,
  isWatched,
  relevantArticles,
  splitDiff,
  summariseManifest,
} from '../src/docs.js';

describe('watched paths', () => {
  it('watches the whole repo by default, minus tests, lockfiles, generated, vendor and secrets', () => {
    expect(isWatched('src/billing/invoices.ts')).toBe(true);
    expect(isWatched('README.md')).toBe(true);
    expect(isWatched('src/billing/invoices.test.ts')).toBe(false);
    expect(isWatched('test/fixtures/a.json')).toBe(false);
    expect(isWatched('pnpm-lock.yaml')).toBe(false);
    expect(isWatched('apps/web/yarn.lock')).toBe(false);
    expect(isWatched('src/generated/client.ts')).toBe(false);
    expect(isWatched('vendor/lib.js')).toBe(false);
    expect(isWatched('dist/app.js')).toBe(false);
    expect(isWatched('.env.production')).toBe(false);
    expect(isWatched('.github/workflows/ci.yml')).toBe(false);
    expect(isWatched('public/logo.png')).toBe(false);
    expect(isLockfile('Cargo.lock')).toBe(true);
  });

  it('leaves out the docs folder, which syncs on its own', () => {
    expect(isWatched('docs/billing/refunds.md', [], 'docs')).toBe(false);
    expect(isWatched('docs-site/index.ts', [], 'docs')).toBe(true);
  });

  it('narrows to globs, with ! taking paths out again', () => {
    const globs = ['src/billing/', 'app/**/*.tsx', '!src/billing/internal/**'];
    expect(isWatched('src/billing/plans.ts', globs)).toBe(true);
    expect(isWatched('app/settings/page.tsx', globs)).toBe(true);
    expect(isWatched('app/page.tsx', globs)).toBe(true);
    expect(isWatched('src/billing/internal/ledger.ts', globs)).toBe(false);
    expect(isWatched('src/auth/login.ts', globs)).toBe(false);
    expect(isWatched('src/x.ts', ['!src/x.ts'])).toBe(false);
    expect(isWatched('src/y.ts', ['!src/x.ts'])).toBe(true);
  });

  it('turns globs into anchored expressions', () => {
    expect(globToRegExp('*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/billing').test('src/billing/plans.ts')).toBe(true);
    expect(globToRegExp('src/bill').test('src/billing/plans.ts')).toBe(false);
  });
});

describe('repository context from a list of paths and a reader', () => {
  const files: Record<string, string> = {
    'README.md': '# Acme\nAcme sends invoices.',
    'package.json': JSON.stringify({ name: 'acme', description: 'Invoices', dependencies: {} }),
    'src/routes/invoices.ts': "router.get('/invoices', list)",
    'src/server-ish.ts': "app.post('/export', exportInvoices)",
    'src/util.ts': 'export const x = 1;',
    'config/plans.json': '{"pro": {"invoices": 500}}',
    '.env': 'SECRET=1',
    'docs/billing.md': 'an article',
  };

  it('reads the same sources the CLI reads, in the same order', () => {
    const listed = Object.keys(files).filter((path) => isListed(path, 'docs'));
    expect(listed).not.toContain('.env');
    expect(listed).not.toContain('docs/billing.md');
    const context = assembleRepoContext(listed, (path) => files[path] ?? null, {
      manifest: summariseManifest(files['package.json'] ?? null),
      articles: [{ path: 'billing/refunds.md', title: 'Refunds', body: 'Ask us.' }],
    });
    const order = context.sources.map((source) => source.path);
    expect(order).toEqual([
      'README.md',
      'package.json',
      'docs/billing/refunds.md',
      'src/routes/invoices.ts',
      'src/server-ish.ts',
      'config/plans.json',
    ]);
    expect(context.text).not.toContain('dependencies');
  });

  it('ranks the files worth fetching first for a host that pays per read', () => {
    const ranked = contextCandidates(Object.keys(files).filter((p) => isListed(p, 'docs')));
    expect(ranked.slice(0, 2)).toEqual(['README.md', 'package.json']);
    expect(ranked.indexOf('src/routes/invoices.ts')).toBeLessThan(ranked.indexOf('src/util.ts'));
  });
});

describe('which articles a diff touches', () => {
  it('picks the article that shares the changed words', () => {
    const diff = [
      'diff --git a/src/invoices/export.ts b/src/invoices/export.ts',
      '+export function exportInvoiceCsv(invoice: Invoice) { return csvColumns(invoice) }',
      '+// Invoice exports now include the currency column',
    ].join('\n');
    const articles = [
      {
        title: 'Export invoices as CSV',
        body: 'Each invoice export lists the columns and the currency.',
        headings: [],
      },
      { title: 'Reset your password', body: 'Use the sign in page.', headings: [] },
    ];
    const chunks = splitDiff(diff);
    expect(chunks).toHaveLength(1);
    expect(relevantArticles(articles, diff).map((a) => a.title)).toEqual([
      'Export invoices as CSV',
    ]);
  });
});
