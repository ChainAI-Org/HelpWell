/**
 * The loader's two pieces of arithmetic: where is the API, and where is the
 * bundle?
 *
 * It runs as an IIFE the moment it is imported, reading `document.currentScript`,
 * so each case sets up the page and the script tag, then imports a fresh copy
 * of the module. Every case names the page's address as well as the script's,
 * because the install that matters most is the one where they differ: a
 * customer's site loading the widget from an API on another host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Queued {
  q: unknown[][];
}

interface HappyWindow {
  happyDOM: { settings: Record<string, unknown>; setURL(url: string): void };
}

const happy = (window as unknown as HappyWindow).happyDOM;
const startedOn = location.href;

/** The page the visitor is on, and the loader tag in it. */
function pretendLoadedFrom(
  src: string | null,
  page = 'https://www.customer.com/pricing',
  data: Record<string, string> = {},
): void {
  happy.setURL(page);
  const script = src ? document.createElement('script') : null;
  if (script && src) {
    script.src = src;
    Object.assign(script.dataset, data);
  }
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
}

async function loadFresh(): Promise<Queued> {
  vi.resetModules();
  await import('../src/loader.js');
  return window.helpwell as unknown as Queued;
}

function initOptions(global: Queued): { apiUrl: string } {
  const call = global.q.find(([method]) => method === 'init');
  return call?.[1] as { apiUrl: string };
}

async function apiUrlFor(...args: Parameters<typeof pretendLoadedFrom>): Promise<string> {
  pretendLoadedFrom(...args);
  return initOptions(await loadFresh()).apiUrl;
}

/** The bundle tag the loader appends once the page has loaded. */
async function appendedTag(): Promise<HTMLScriptElement | null> {
  // No requestIdleCallback here, so the loader falls back to a 1ms timer.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const tags = document.head.querySelectorAll<HTMLScriptElement>('script[src]');
  return tags[tags.length - 1] ?? null;
}

beforeEach(() => {
  delete (window as { helpwell?: unknown }).helpwell;
  // The tag is inspected, not run: happy-dom would otherwise go and fetch it.
  happy.settings.disableJavaScriptFileLoading = true;
});

afterEach(async () => {
  pretendLoadedFrom(null, startedOn);
  vi.unstubAllGlobals();
  // The tag lands on a timer; let it, so it does not leak into the next case.
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (const tag of document.head.querySelectorAll('script')) tag.remove();
});

describe('working out where the API is', () => {
  it('on the same site, is the parent of assets/', async () => {
    expect(
      await apiUrlFor(
        'https://app.acme.com/api/helpwell/assets/loader.js',
        'https://app.acme.com/dashboard',
      ),
    ).toBe('https://app.acme.com/api/helpwell');
  });

  it('on another site, stays on the host that served the loader', async () => {
    // The bug this guards: the path alone sent every call to www.customer.com.
    const apiUrl = await apiUrlFor('https://api.example.com/api/helpwell/assets/loader.js');
    expect(apiUrl).toBe('https://api.example.com/api/helpwell');
    expect(apiUrl).not.toContain('customer.com');
  });

  it('keeps the port, and drops the cache-buster', async () => {
    expect(
      await apiUrlFor(
        'http://localhost:3917/api/helpwell/assets/loader.js?v=3#x',
        'http://127.0.0.1:3918/',
      ),
    ).toBe('http://localhost:3917/api/helpwell');
  });

  it('handles a deeper mount and a minified name', async () => {
    expect(await apiUrlFor('https://api.example.com/tools/support/api/assets/loader.min.js')).toBe(
      'https://api.example.com/tools/support/api',
    );
  });

  it('handles an API mounted at the root of its own host', async () => {
    expect(await apiUrlFor('https://support.acme.com/assets/loader.js')).toBe(
      'https://support.acme.com',
    );
  });

  it('takes an absolute data-api over its own address', async () => {
    expect(
      await apiUrlFor('https://cdn.example.com/api/helpwell/assets/loader.js', undefined, {
        api: 'https://hosted.example.com/cloud/p/abc/api',
      }),
    ).toBe('https://hosted.example.com/cloud/p/abc/api');
  });

  it('passes a relative data-api on as written, for the page to resolve', async () => {
    expect(
      await apiUrlFor('https://api.example.com/api/helpwell/assets/loader.js', undefined, {
        api: '/support/api',
      }),
    ).toBe('/support/api');
  });

  it("falls back to the page's own /api/helpwell when served from somewhere else entirely", async () => {
    expect(await apiUrlFor('https://cdn.example.com/static/loader.js')).toBe('/api/helpwell');
  });
});

describe('the widget calling the API the loader found', () => {
  /** Boots the real bundle entry after the loader, and returns its first call. */
  async function firstCall(): Promise<{ url: string; visitor: string | undefined }> {
    const calls: { url: string; visitor: string | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url: String(url), visitor: headers['x-helpwell-visitor'] });
        // Not a config, so the widget stops there without drawing anything.
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      }),
    );
    const global = await loadFresh();
    const { boot } = await import('../src/index.js');
    await boot(global as unknown as Parameters<typeof boot>[0]);
    const call = calls[0];
    if (!call) throw new Error('The widget made no call.');
    return call;
  }

  it('calls the API host from another site, with the visitor in a header', async () => {
    pretendLoadedFrom('https://api.example.com/api/helpwell/assets/loader.js');
    const call = await firstCall();
    expect(call.url).toBe('https://api.example.com/api/helpwell/config');
    // The widget sees the API is on another site, so the cookie is not enough.
    expect(call.visitor).toBe('new');
  });

  it('calls its own site on the same origin, with the cookie alone', async () => {
    pretendLoadedFrom(
      'https://app.acme.com/api/helpwell/assets/loader.js',
      'https://app.acme.com/dashboard',
    );
    const call = await firstCall();
    expect(call.url).toBe('https://app.acme.com/api/helpwell/config');
    expect(call.visitor).toBeUndefined();
  });

  it("resolves a relative data-api against the page, not the loader's host", async () => {
    pretendLoadedFrom('https://api.example.com/api/helpwell/assets/loader.js', undefined, {
      api: '/support/api',
    });
    const call = await firstCall();
    expect(new URL(call.url, location.href).href).toBe(
      'https://www.customer.com/support/api/config',
    );
    // Same site as the page, so the cookie carries the visitor.
    expect(call.visitor).toBeUndefined();
  });
});

describe('working out the bundle', () => {
  it('fetches its sibling widget.js, as a plain script', async () => {
    pretendLoadedFrom(
      'https://app.acme.com/api/helpwell/assets/loader.js?v=3',
      'https://app.acme.com/dashboard',
    );
    await loadFresh();
    const tag = await appendedTag();
    // The cache-buster travels with it: the two files are one version.
    expect(tag?.getAttribute('src')).toBe('https://app.acme.com/api/helpwell/assets/widget.js?v=3');
    // No crossorigin attribute: a CORS request would need headers the API only
    // sends for origins the host listed.
    expect(tag?.hasAttribute('crossorigin')).toBe(false);
    expect(tag?.onerror).toBeTypeOf('function');
  });

  it("fetches it from the loader's host when the page is on another site", async () => {
    pretendLoadedFrom('https://api.example.com/api/helpwell/assets/loader.js?v=3');
    await loadFresh();
    expect((await appendedTag())?.getAttribute('src')).toBe(
      'https://api.example.com/api/helpwell/assets/widget.js?v=3',
    );
  });

  it('never fetches itself again when served under another name', async () => {
    // Served as loader.global.js, the old replace() left the URL untouched
    // and the loader re-fetched itself, thousands of times.
    pretendLoadedFrom('https://app.acme.com/api/helpwell/assets/loader.global.js');
    await loadFresh();
    const tag = await appendedTag();
    expect(tag?.getAttribute('src')).toBe('/api/helpwell/assets/widget.js');
    expect(tag?.getAttribute('src')).not.toContain('loader');
  });

  it('lets data-src say exactly where the bundle is', async () => {
    pretendLoadedFrom('https://cdn.example.com/static/loader.js', undefined, {
      src: 'https://cdn.example/w.js',
    });
    await loadFresh();
    expect((await appendedTag())?.getAttribute('src')).toBe('https://cdn.example/w.js');
  });
});
