import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  extractHeadings,
  hashContent,
  parseArticle,
  parseFrontmatter,
  readingMinutes,
  readKnowledgeBase,
  slugify,
  stringifyFrontmatter,
} from '../src/content.js';

/** U+FEFF, which some Windows editors write ahead of the first character. */
const BOM = String.fromCharCode(0xfeff);

describe('frontmatter', () => {
  it('reads the small subset articles actually use', () => {
    const { data, content } = parseFrontmatter(
      [
        '---',
        'title: Exporting invoices as CSV',
        'description: Download every invoice in a date range.',
        'order: 2',
        'draft: false',
        'tags: [billing, exports]',
        '---',
        '',
        '# Exporting invoices as CSV',
      ].join('\n'),
    );
    expect(data.title).toBe('Exporting invoices as CSV');
    expect(data.order).toBe(2);
    expect(data.draft).toBe(false);
    expect(data.tags).toEqual(['billing', 'exports']);
    expect(content).toBe('# Exporting invoices as CSV');
  });

  it('keeps a colon inside a title', () => {
    const { data } = parseFrontmatter('---\ntitle: Exports: the long guide\n---\nbody');
    expect(data.title).toBe('Exports: the long guide');
  });

  it('reads a list written across lines', () => {
    const { data } = parseFrontmatter('---\ntags:\n  - billing\n  - exports\n---\nbody');
    expect(data.tags).toEqual(['billing', 'exports']);
  });

  it('treats a file with no frontmatter as all body', () => {
    const { data, content } = parseFrontmatter('# Just a heading\n\nSome text.');
    expect(data).toEqual({});
    expect(content).toContain('# Just a heading');
  });

  it('ignores a byte order mark ahead of the fence', () => {
    const { data, content } = parseFrontmatter(`${BOM}---\nstatus: draft\n---\n# Draft`);
    expect(data.status).toBe('draft');
    expect(content).toBe('# Draft');

    const article = parseArticle(`${BOM}---\nstatus: draft\ntitle: X\n---\n# X`, {
      collection: 'c',
      file: 'x.md',
    });
    expect(article.status).toBe('draft');
    expect(article.body).not.toContain('---');
  });

  it('round-trips through stringify', () => {
    const source = stringifyFrontmatter(
      { title: 'Exports: the guide', order: 3, tags: ['billing'] },
      '# Body',
    );
    const { data, content } = parseFrontmatter(source);
    expect(data.title).toBe('Exports: the guide');
    expect(data.order).toBe(3);
    expect(data.tags).toEqual(['billing']);
    expect(content).toBe('# Body');
  });

  it('keeps a string that looks like a number or a boolean a string', () => {
    const source = stringifyFrontmatter(
      {
        version: '2.0',
        flag: 'true',
        nothing: 'null',
        empty: '',
        order: 3,
        done: true,
        tags: ['1'],
      },
      '# Body',
    );
    const { data } = parseFrontmatter(source);
    expect(data.version).toBe('2.0');
    expect(data.flag).toBe('true');
    expect(data.nothing).toBe('null');
    expect(data.empty).toBe('');
    expect(data.order).toBe(3);
    expect(data.done).toBe(true);
    expect(data.tags).toEqual(['1']);
  });

  it('round-trips a quote inside a quoted value', () => {
    const source = stringifyFrontmatter({ title: 'Say "hi": now' }, '# Body');
    expect(parseFrontmatter(source).data.title).toBe('Say "hi": now');
  });
});

describe('article parsing', () => {
  it('falls back to the first heading when there is no title', () => {
    const a = parseArticle('# Inviting teammates\n\nGo to Team.', {
      collection: 'team',
      file: 'inviting-teammates.md',
    });
    expect(a.title).toBe('Inviting teammates');
    expect(a.slug).toBe('team/inviting-teammates');
    expect(a.status).toBe('published');
  });

  it('takes an explicit slug when one is given', () => {
    const a = parseArticle('---\nslug: billing/export\n---\n# Export', {
      collection: 'billing',
      file: 'exporting-invoices-as-csv.md',
    });
    expect(a.slug).toBe('billing/export');
  });

  it('refuses a status the product does not have', () => {
    const a = parseArticle('---\nstatus: sideways\n---\n# X', {
      collection: 'billing',
      file: 'x.md',
    });
    expect(a.status).toBe('published');
  });
});

describe('headings', () => {
  it('numbers duplicate anchors so links stay unique', () => {
    const h = extractHeadings('## Setup\n\ntext\n\n## Setup\n');
    expect(h.map((x) => x.id)).toEqual(['setup', 'setup-1']);
  });

  it('ignores hashes inside a code fence', () => {
    const h = extractHeadings('## Real\n\n```bash\n# not a heading\n```\n\n## Also real\n');
    expect(h.map((x) => x.text)).toEqual(['Real', 'Also real']);
  });
});

describe('helpers', () => {
  it('rounds reading time up to at least a minute', () => {
    expect(readingMinutes('short')).toBe(1);
    expect(readingMinutes('word '.repeat(660))).toBe(3);
  });

  it('slugifies a title the way a URL wants it', () => {
    expect(slugify('Exporting invoices as CSV')).toBe('exporting-invoices-as-csv');
    expect(slugify('Plans & seats')).toBe('plans-seats');
  });

  it('hashes content so re-indexing can skip unchanged files', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

describe('reading a docs folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'helpwell-docs-'));

  mkdirSync(join(root, 'getting-started'), { recursive: true });
  mkdirSync(join(root, 'billing'), { recursive: true });
  writeFileSync(
    join(root, 'billing', '_meta.json'),
    JSON.stringify({ title: 'Billing & invoices', icon: 'credit-card', tint: 'peach', order: 1 }),
  );
  writeFileSync(
    join(root, 'billing', 'exporting-invoices-as-csv.md'),
    '---\ntitle: Exporting invoices as CSV\norder: 1\n---\n\n# Export a CSV\n\nOpen Billing.',
  );
  writeFileSync(
    join(root, 'billing', 'scheduled-exports.md'),
    '---\ntitle: Scheduled exports\norder: 2\nstatus: draft\n---\n\n# Scheduled exports',
  );
  writeFileSync(
    join(root, 'getting-started', 'welcome.md'),
    '---\ntitle: Welcome\n---\n\n# Welcome',
  );

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const kb = readKnowledgeBase(root);

  it('finds every collection and article', () => {
    expect(kb.collections.map((c) => c.id)).toEqual(['billing', 'getting-started']);
    expect(kb.articles).toHaveLength(3);
  });

  it('puts collections that set an order first, the rest alphabetically', () => {
    // billing sets order 1; getting-started sets none, so it follows.
    expect(kb.collections[0]!.order).toBe(1);
    expect(kb.collections[1]!.order).toBeNull();
  });

  it('never hands two collections the same tint', () => {
    const tints = kb.collections.map((c) => c.tint);
    expect(new Set(tints).size).toBe(tints.length);
  });

  it('reads _meta.json for the title, icon and tint', () => {
    const billing = kb.collections.find((c) => c.id === 'billing')!;
    expect(billing.title).toBe('Billing & invoices');
    expect(billing.icon).toBe('credit-card');
    expect(billing.tint).toBe('peach');
  });

  it('gives a collection without _meta.json sensible defaults', () => {
    const gs = kb.collections.find((c) => c.id === 'getting-started')!;
    expect(gs.title).toBe('Getting started');
    expect(gs.icon).toBe('book-open');
    expect(gs.tint).toBe('lavender');
  });

  it('orders articles by their order field', () => {
    const billing = kb.collections.find((c) => c.id === 'billing')!;
    expect(billing.articles.map((a) => a.title)).toEqual([
      'Exporting invoices as CSV',
      'Scheduled exports',
    ]);
  });

  it('keeps drafts in the list, flagged, so the dashboard can show them', () => {
    const draft = kb.articles.find((a) => a.slug === 'billing/scheduled-exports')!;
    expect(draft.status).toBe('draft');
  });

  it('returns empty rather than throwing when there are no docs yet', () => {
    expect(readKnowledgeBase(join(root, 'nope')).articles).toEqual([]);
  });
});
