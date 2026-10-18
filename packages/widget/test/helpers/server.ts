/**
 * A stand-in for the HelpWell API.
 *
 * The widget tests drive real DOM against real fetch calls, so the thing they
 * need is a server that answers, not a mocked client. Routes here mirror the
 * shapes `packages/core` actually returns.
 */

import type { WidgetConfig } from '../../src/api.js';

export interface FakeServerOptions {
  config?: Partial<WidgetConfig>;
  /** Force a route to fail, to exercise the error states. */
  fail?: Set<string>;
  /** Extra or replacement routes, keyed `METHOD /path`. */
  routes?: Record<string, unknown>;
}

export interface FakeServer {
  fetch: typeof globalThis.fetch;
  calls: { method: string; path: string; body: unknown }[];
  /** Replace a route's answer mid-test. */
  set(path: string, value: unknown): void;
  fail(path: string): void;
  unfail(path: string): void;
  /** Answer a path with a specific status and body, for the awkward cases. */
  status(path: string, status: number, body?: unknown): void;
  /** Hold a path's answer for a while, to race it against something else. */
  delay(path: string, ms: number): void;
}

export function baseConfig(): WidgetConfig {
  return {
    product: { name: 'Acme', locale: 'en' },
    widget: {
      position: 'bottom-right',
      offset: { x: 24, y: 24 },
      zIndex: 2_147_483_000,
      tabs: { home: true, messages: true, help: true, updates: true, roadmap: true },
      appearance: {
        theme: 'light',
        accent: '#7A3BEB',
        bubbleStyle: 'rounded',
        pattern: 'waves',
        patternImageUrl: null,
        font: 'Plus Jakarta Sans',
        radius: 24,
        launcherIconUrl: null,
      },
      displayRules: {
        include: ['**'],
        exclude: [],
        audience: 'all',
        devices: ['desktop', 'mobile'],
      },
      preChat: {
        when: 'never',
        timing: 'before',
        fields: ['email', 'name'],
        requireEmail: true,
        consentLine: 'We use it for this conversation and nothing else.',
      },
      statusUrl: '',
    },
    helpCenter: {
      subpath: '/help',
      domain: '',
      search: true,
      askAgent: true,
      ratings: true,
      readingTime: true,
      poweredBy: true,
      theme: {},
    },
    changelog: {
      widgetTab: true,
      notification: 'badge',
      roadmapEnabled: true,
      whoCanSubmit: 'identified',
    },
    unread: 0,
  };
}

const message = (id: string, role: 'customer' | 'agent', body: string) => ({
  id,
  role,
  body,
  citations: [],
  feedback: null,
  createdAt: '2026-03-01T00:00:00.000Z',
});

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const config = deepMerge(baseConfig(), options.config ?? {}) as WidgetConfig;
  const failing = options.fail ?? new Set<string>();
  const forced = new Map<string, { status: number; body: unknown }>();
  const delays = new Map<string, number>();
  const calls: FakeServer['calls'] = [];
  // Unread is real state here: the widget decrements optimistically and then
  // re-reads, so a static count would hide an ordering bug rather than catch one.
  let unread = config.unread;

  const routes = new Map<string, unknown>([
    ['GET /config', config],
    ['POST /identify', { contactId: 'con_test', identified: true }],
    ['GET /conversations', { items: [] }],
    [
      'GET /conversations/cnv_a',
      {
        id: 'cnv_a',
        status: 'open',
        messages: [message('msg_a1', 'customer', 'first thread'), message('msg_a2', 'agent', 'A')],
      },
    ],
    [
      'GET /conversations/cnv_b',
      {
        id: 'cnv_b',
        status: 'open',
        messages: [message('msg_b1', 'customer', 'second thread'), message('msg_b2', 'agent', 'B')],
      },
    ],
    [
      'GET /collections',
      {
        items: [
          {
            id: 'billing',
            collection: 'billing',
            title: 'Billing',
            description: 'Invoices and receipts.',
            icon: 'credit-card',
            tint: 'peach',
            articles: 2,
          },
          // No description, so the card falls back to the article count.
          {
            id: 'setup',
            collection: 'setup',
            title: 'Setup',
            description: null,
            icon: 'book-open',
            tint: 'lavender',
            articles: 1,
          },
        ],
      },
    ],
    [
      'GET /articles',
      {
        items: [
          {
            slug: 'billing/invoices',
            title: 'Exporting invoices',
            description: 'Download a PDF.',
            collection: 'Billing',
            reading_minutes: 2,
          },
        ],
      },
    ],
    [
      'GET /articles/billing/invoices',
      {
        article: {
          slug: 'billing/invoices',
          title: 'Exporting invoices',
          description: 'Download a PDF.',
          collection: 'Billing',
          body: '# Exporting\n\nOpen **Billing**, then Invoices.',
          headings: [],
          applies_to: null,
          reading_minutes: 2,
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        related: [],
      },
    ],
    [
      'GET /search',
      {
        query: 'invoice',
        results: [
          {
            slug: 'billing/invoices',
            title: 'Exporting invoices',
            collection: 'Billing',
            description: 'Download a PDF.',
            snippet: 'export <mark>invoices</mark> as a PDF',
            score: 1,
          },
        ],
      },
    ],
    [
      'GET /changelog',
      {
        items: [
          {
            id: 'chg_1',
            version: '2.1.0',
            title: 'Faster exports',
            summary: 'Invoices export in half the time.',
            tags: ['Improved'],
            coverUrl: null,
            publishedAt: '2026-02-01T00:00:00.000Z',
            read: false,
          },
        ],
        nextCursor: null,
      },
    ],
    [
      'GET /roadmap',
      {
        under_review: [],
        planned: [
          {
            id: 'rmp_1',
            title: 'Dark mode',
            body: 'For late nights.',
            status: 'planned',
            votesCount: 4,
            voted: false,
          },
        ],
        in_progress: [],
        shipped: [],
      },
    ],
    [
      'GET /changelog/chg_1',
      {
        id: 'chg_1',
        version: '2.1.0',
        title: 'Faster exports',
        summary: 'Invoices export in half the time.',
        body: 'Exports now stream, so a big month is **much** quicker.',
        tags: ['Improved'],
        coverUrl: null,
        publishedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    ['POST /roadmap/rmp_1/vote', { voted: true, votesCount: 5 }],
    ['GET /engage', { items: [] }],
    [
      'POST /chat',
      {
        conversationId: 'cnv_1',
        messageId: 'msg_1',
        text: 'Open Billing, then Invoices.',
        citations: [
          { slug: 'billing/invoices', title: 'Exporting invoices', collection: 'Billing' },
        ],
        unresolved: false,
        degraded: false,
      },
    ],
  ]);
  for (const [key, value] of Object.entries(options.routes ?? {})) routes.set(key, value);

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/helpwell', '') || '/';
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;

    calls.push({
      method,
      path: path + url.search,
      // A file upload is the raw bytes, not JSON.
      body:
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ? init.body : undefined,
    });

    const held = delays.get(path);
    if (held) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, held);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }

    if (failing.has(path)) {
      return jsonResponse({ error: { code: 'offline', message: 'Support is unavailable.' } }, 503);
    }

    const force = forced.get(path);
    if (force) return jsonResponse(force.body ?? null, force.status);

    if (path === '/changelog/unread' && method === 'GET') {
      return jsonResponse({ count: unread });
    }
    if (method === 'POST' && /^\/changelog\/[^/]+\/read$/.test(path)) {
      unread = Math.max(0, unread - 1);
      return new Response(null, { status: 204 });
    }
    if (path === '/changelog/read-all' && method === 'POST') {
      const marked = unread;
      unread = 0;
      return jsonResponse({ marked });
    }

    if (routes.has(key)) {
      const value = routes.get(key);
      // A route can answer with a raw Response, for bodies that are not JSON.
      return value instanceof Response ? value.clone() : jsonResponse(value);
    }

    // Anything not explicitly scripted succeeds with no content, the way
    // impressions and feedback do.
    if (method !== 'GET') return new Response(null, { status: 204 });
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
  };

  return {
    fetch: fetchImpl,
    calls,
    set(path, value) {
      routes.set(path, value);
    },
    fail(path) {
      failing.add(path);
    },
    unfail(path) {
      failing.delete(path);
    },
    status(path, status, body) {
      forced.set(path, { status, body });
    },
    delay(path, ms) {
      delays.set(path, ms);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const existing = out[key];
    out[key] =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? deepMerge(existing, value)
        : value;
  }
  return out;
}

/** Let queued microtasks and timers settle before asserting on the DOM. */
export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
