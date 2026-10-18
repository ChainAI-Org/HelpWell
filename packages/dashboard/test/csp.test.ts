/**
 * The dashboard runs under `script-src 'self'`: no page carries an inline
 * script or an `on*=` handler, every script it loads is one of its own
 * served files, and those files are served with a name that changes when
 * they do.
 *
 * The pages are found the way a person would find them: from every rail
 * entry and Settings tab, following each link and preview frame under the
 * mount path, on an install with something in every list. Then the pages no
 * link reaches (signed out, the admin token form, a refused post, a form
 * sent back with errors) are checked by name.
 */

import { createMemoryContentSource } from '@helpwell/core/content';
import { type Db, schema } from '@helpwell/core/db';
import {
  createChangelogEntry,
  createContact,
  createForm,
  FORM_TEMPLATES,
  recordImpression,
  submitIdea,
} from '@helpwell/core/repos';
import { syncContent } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeAll, describe, expect, it } from 'vitest';
import { clientScriptFile } from '../src/client/index.js';
import { SHELL_JS } from '../src/client/shell.js';
import { TEMPLATES } from '../src/engage/templates.js';
import { createDashboard, type DashboardHandler, SETTINGS_TABS } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';
const ADMIN_TOKEN = 'csp-test-admin-token-0123456789abcdef0123456789';

let db: Db;
let dashboard: DashboardHandler;

const get = (path: string, init: { admin?: boolean; headers?: Record<string, string> } = {}) =>
  dashboard(
    new Request(`${ORIGIN}${path.startsWith(BASE) ? path : `${BASE}${path}`}`, {
      headers: { ...(init.admin === false ? {} : { 'x-admin': 'yes' }), ...init.headers },
    }),
  );

beforeAll(async () => {
  const handle = await freshDb();
  db = handle.db;
  const content = createMemoryContentSource({
    'billing/invoices.md':
      '---\ntitle: Exporting invoices\ndescription: Download a PDF.\n---\n\nOpen **Billing**, then Invoices.\n',
    'setup/start.md': '---\ntitle: Getting started\n---\n\nInvite your team.\n',
  });
  dashboard = createDashboard({
    db,
    basePath: BASE,
    apiPath: '/api/helpwell',
    isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    adminToken: ADMIN_TOKEN,
    content,
    readInstructions: () => '# Instructions\n\nAnswer only from the docs.',
    writeInstructions: () => {},
    readPlaybook: () => '# House rules\n\nBe brief.',
    writePlaybook: () => {},
    readEvalCases: () => ({ cases: [{ id: 'export', question: 'How do I export invoices?' }] }),
    env: {},
  });

  await new SettingsStore(db).update({
    product: { name: 'Acme' },
    engage: {
      engagements: TEMPLATES.map((template) => ({
        ...template.definition,
        id: template.key,
        kind: template.kind,
      })),
    },
  });
  await syncContent(db, content);

  const contact = await createContact(db, {
    source: 'identify',
    email: 'ada@example.com',
    name: 'Ada',
    attributes: { plan: 'pro' },
    identified: true,
  });
  await db.insert(schema.conversations).values({
    id: 'cnv_1',
    contactId: contact,
    status: 'unresolved',
    messageCount: 2,
  });
  await db.insert(schema.messages).values([
    { id: 'msg_1', conversationId: 'cnv_1', role: 'customer', body: 'How do I export invoices?' },
    {
      id: 'msg_2',
      conversationId: 'cnv_1',
      role: 'agent',
      body: 'Open **Billing**, then Invoices.',
      citations: [{ slug: 'billing/invoices', title: 'Exporting invoices', collection: 'billing' }],
      confidence: 0.8,
    },
  ]);
  await db.insert(schema.gaps).values({ id: 'gap_1', question: 'Do you support SSO?', asks: 3 });
  await createChangelogEntry(db, {
    version: '1.2.0',
    title: 'Faster exports',
    summary: 'Twice as fast.',
    body: 'Exports are faster.',
    tags: ['exports'],
    status: 'published',
  });
  await submitIdea(db, { title: 'Dark mode', body: 'Please.' });
  await recordImpression(db, {
    engagementId: TEMPLATES[0]!.key,
    contactId: null,
    state: 'seen',
    step: 1,
  });
  for (const template of FORM_TEMPLATES.slice(0, 3)) {
    await createForm(db, { template: template.key, enabled: false }, { skipChecks: true });
  }
  await db.insert(schema.evalRuns).values({
    id: 'evl_1',
    score: 100,
    passed: 1,
    weak: 0,
    failed: 0,
    costUsd: '0',
    mode: 'retrieval',
    cases: [
      {
        id: 'export',
        question: 'How do I export invoices?',
        verdict: 'pass',
        answer: 'Open Billing.',
        cited: 'billing/invoices',
        expected: 'billing/invoices',
        ms: 12,
      },
    ],
  });
}, 120_000);

/* ------------------------------------------------------------- reading */

interface Tag {
  name: string;
  attributes: Map<string, string>;
  source: string;
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const START_TAG = new RegExp(
  `<([a-zA-Z][\\w:-]*)((?:\\s+${ATTRIBUTE.source.replace(/\((?!\?)/g, '(?:')})*)\\s*/?>`,
  'g',
);

/**
 * Every start tag on a page, attributes and all. Style sheets are left out,
 * and every `<` that opens a tag must have been read as one, so a tag the
 * pattern misread fails the test instead of slipping past it.
 */
function startTags(page: string, where: string): Tag[] {
  const markup = page.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style>');
  const tags: Tag[] = [];
  for (const match of markup.matchAll(START_TAG)) {
    const attributes = new Map<string, string>();
    for (const a of (match[2] ?? '').matchAll(ATTRIBUTE)) {
      attributes.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
    }
    tags.push({ name: match[1]!.toLowerCase(), attributes, source: match[0].slice(0, 160) });
  }
  const opened = markup.match(/<[a-zA-Z]/g)?.length ?? 0;
  expect(tags.length, `every tag on ${where} was read`).toBe(opened);
  return tags;
}

/** What makes a page need `'unsafe-inline'`, or anything beyond `'self'`, to run. */
function problems(page: string, where: string): string[] {
  const found: string[] = [];
  for (const tag of startTags(page, where)) {
    for (const [name] of tag.attributes) {
      if (/^on[a-z]/.test(name)) found.push(`${where}: an ${name} handler in ${tag.source}`);
    }
    for (const name of ['href', 'src', 'action', 'formaction']) {
      const value = tag.attributes.get(name);
      if (value && /^\s*javascript:/i.test(value)) found.push(`${where}: a javascript: ${name}`);
    }
    if (tag.name === 'iframe' && tag.attributes.has('srcdoc')) {
      found.push(`${where}: an iframe with srcdoc`);
    }
  }
  for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = new Map(
      [...(match[1] ?? '').matchAll(ATTRIBUTE)].map((a) => [
        a[1]!.toLowerCase(),
        a[2] ?? a[3] ?? a[4] ?? '',
      ]),
    );
    // A data block is never run, so `script-src` does not apply to it.
    if (attributes.get('type')?.toLowerCase() === 'application/json') continue;
    const src = attributes.get('src');
    if (!src) found.push(`${where}: an inline script: ${match[0].slice(0, 120)}`);
    else if (match[2]!.trim()) found.push(`${where}: a script with a src and a body`);
  }
  return found;
}

/** The links, frames and scripts a page points at under the mount path. */
function targets(page: string): { links: string[]; scripts: string[] } {
  const links: string[] = [];
  const scripts: string[] = [];
  for (const tag of startTags(page, 'a page')) {
    const url = tag.attributes.get(tag.name === 'a' ? 'href' : 'src');
    if (!url) continue;
    const decoded = url.replace(/&amp;/g, '&');
    if (!decoded.startsWith(`${BASE}/`)) continue;
    if (tag.name === 'script') scripts.push(decoded);
    else if (tag.name === 'a' || tag.name === 'iframe') links.push(decoded);
  }
  return { links, scripts };
}

/* --------------------------------------------------------------- pages */

describe('every dashboard page', () => {
  it('has no inline script or handler, and every script it loads is served', async () => {
    const start = [
      '/home',
      '/playbook',
      '/playbook?file=playbook',
      '/conversations',
      '/contacts',
      '/knowledge',
      '/knowledge/new',
      '/gaps',
      '/changelog',
      '/changelog/new',
      '/roadmap',
      '/roadmap/new',
      '/engage',
      '/engage/new',
      '/forms',
      '/forms/new',
      '/reports',
      '/evals',
      '/connections',
      '/no-such-page',
      ...SETTINGS_TABS.map((tab) => `/settings?tab=${tab.key}`),
    ].map((path) => `${BASE}${path}`);

    const queue = [...start];
    const seen = new Set(queue);
    const perPath = new Map<string, number>();
    const scripts = new Set<string>();
    const found: string[] = [];
    let pages = 0;

    while (queue.length > 0 && pages < 260) {
      const path = queue.shift()!;
      const response = await get(path);
      if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) continue;
      pages++;
      expect(response.headers.get('content-security-policy'), path).toContain("script-src 'self'");
      const page = await response.text();
      found.push(...problems(page, path));
      const next = targets(page);
      for (const src of next.scripts) scripts.add(src);
      for (const link of next.links) {
        const url = new URL(link, ORIGIN);
        if (/\.(csv|json)$|\/export$|\/_assets\/|\/_fonts\//.test(url.pathname)) continue;
        const key = `${url.pathname}${url.search}`;
        if (seen.has(key)) continue;
        // Enough of each list's filters and pages to see every variant.
        const count = perPath.get(url.pathname) ?? 0;
        if (count >= 8) continue;
        perPath.set(url.pathname, count + 1);
        seen.add(key);
        queue.push(key);
      }
    }

    expect(found).toEqual([]);
    // Enough of the product was reached for this to mean something.
    expect(pages).toBeGreaterThan(60);
    for (const path of [
      `${BASE}/engage/_preview`,
      `${BASE}/forms/_preview`,
      `${BASE}/conversations/cnv_1`,
      `${BASE}/evals/evl_1`,
      `${BASE}/knowledge/billing/invoices`,
      `${BASE}/engage/${TEMPLATES[0]!.key}`,
      `${BASE}/engage/${TEMPLATES[0]!.key}/results`,
    ]) {
      expect(seen, `${path} was reached`).toContain(path);
    }
    for (const name of [
      'shell',
      'editor-mark',
      'editor-kit',
      'engage',
      'forms',
      'model-picker',
      'eval-run',
      'article-preview',
      'playbook-preview',
      'widget-checks',
      'home-blocks',
      'preview-frame',
    ] as const) {
      expect(scripts, `${name} is used`).toContain(`${BASE}/_assets/${clientScriptFile(name)}`);
    }

    for (const src of scripts) {
      const response = await get(src, { admin: false });
      expect(response.status, src).toBe(200);
      expect(response.headers.get('content-type'), src).toBe('text/javascript; charset=utf-8');
    }
  }, 600_000);

  it('holds for the pages no link reaches', async () => {
    const pages: [string, Response][] = [
      ['signed out', await get('/conversations', { admin: false })],
      [
        'a stale admin cookie',
        await get('/conversations', { admin: false, headers: { cookie: 'hw_admin=wrong' } }),
      ],
      [
        'a cross-site post',
        await dashboard(
          new Request(`${ORIGIN}${BASE}/gaps`, {
            method: 'POST',
            headers: {
              'x-admin': 'yes',
              origin: 'https://evil.example',
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'id=gap_1&status=dismissed',
          }),
        ),
      ],
      [
        'a changelog entry sent back with errors',
        await dashboard(
          new Request(`${ORIGIN}${BASE}/changelog/new`, {
            method: 'POST',
            headers: {
              'x-admin': 'yes',
              origin: ORIGIN,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'title=&body=x',
          }),
        ),
      ],
      [
        'embedded',
        await createDashboard({ db, isAdmin: () => true, embedded: true })(
          new Request(`${ORIGIN}/admin/helpwell/settings`),
        ),
      ],
    ];
    const found: string[] = [];
    for (const [where, response] of pages) {
      const page = await response.text();
      expect(page, where).toContain('<html');
      expect(response.headers.get('content-security-policy'), where).toContain("script-src 'self'");
      found.push(...problems(page, where));
    }
    expect(found).toEqual([]);
    // The admin token form is on the signed-out page, and is a plain form.
    const signedOut = await (await get('/conversations', { admin: false })).text();
    expect(signedOut).toContain('type="password"');
    expect(signedOut).not.toContain('<script');
  });

  it('would catch an inline script or handler', () => {
    expect(problems('<p>Hi</p><script>alert(1)</script>', 'x')).toHaveLength(1);
    expect(problems('<img src="/a.png" onerror="alert(1)">', 'x')).toHaveLength(1);
    expect(problems('<button type="button"\n  onClick=\'go()\'>Go</button>', 'x')).toHaveLength(1);
    expect(problems('<a href="javascript:alert(1)">x</a>', 'x')).toHaveLength(1);
    expect(problems('<script type="application/json">{"a":1}</script>', 'x')).toEqual([]);
    expect(problems(`<script src="${BASE}/_assets/shell.0.js"></script>`, 'x')).toEqual([]);
    expect(() => problems('<div a=">"<b>', 'x')).toThrow();
  });
});

/* --------------------------------------------------------------- files */

describe('the served scripts', () => {
  const current = () => `/_assets/${clientScriptFile('shell')}`;

  it('are public, and cached for a year under the name of their contents', async () => {
    const response = await get(current(), { admin: false });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(SHELL_JS);
    const etag = response.headers.get('etag')!;
    expect(current()).toContain(etag.replace(/"/g, ''));

    const again = await get(current(), { admin: false, headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');

    const head = await dashboard(new Request(`${ORIGIN}${BASE}${current()}`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('answer an older name with the current file, not cached, and nothing else at all', async () => {
    const old = await get('/_assets/shell.000000000000.js', { admin: false });
    expect(old.status).toBe(200);
    expect(old.headers.get('cache-control')).toBe('no-cache');
    expect(await old.text()).toBe(SHELL_JS);

    for (const path of [
      '/_assets/nothing.000000000000.js',
      '/_assets/shell.js',
      '/_assets/..server.000000000000.js',
      '/_assets/shell.0000000000000.js',
    ]) {
      expect((await get(path, { admin: false })).status, path).toBe(404);
    }
    // Not even a name the route reads: the signed-out page, like any other.
    expect((await get('/_assets/..%2Fserver.000000000000.js', { admin: false })).status).toBe(401);
    const post = await dashboard(
      new Request(`${ORIGIN}${BASE}${current()}`, { method: 'POST', headers: { origin: ORIGIN } }),
    );
    expect(post.status).not.toBe(200);
  });
});
