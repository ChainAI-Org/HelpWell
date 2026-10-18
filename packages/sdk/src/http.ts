/**
 * The one place a request is actually made.
 *
 * Both the public client and the admin namespace funnel through here so the
 * timeout, the bearer header, the cookie jar, the 204 case and the error
 * mapping exist once. Splitting it out of the client also lets the admin
 * namespace hold a reference to a transport rather than a back-pointer to its
 * parent.
 */

import { HelpWellApiError } from './errors.js';

export interface TransportOptions {
  baseUrl: string;
  adminToken?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Serialised as the JSON body. `undefined` sends no body at all. */
  json?: unknown;
  /** Adds `Authorization: Bearer`, and refuses up front when no token is set. */
  admin?: boolean;
  query?: QueryInput;
  /** Hand back the body as text rather than parsing it as JSON (the CSV export). */
  text?: boolean;
  /** A body sent as it is, with its own headers: an uploaded file. Wins over `json`. */
  bytes?: { body: Uint8Array; headers?: Record<string, string> };
}

export type QueryInput = Record<string, string | number | boolean | null | undefined>;

export class Transport {
  readonly #baseUrl: string;
  readonly #adminToken: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;
  /**
   * Cookies the server has set on this client, name to value.
   *
   * The public routes identify a caller by the `hw_visitor` cookie. A browser
   * sends it back without being asked; `fetch` on a server does not, and
   * without it every call is a brand-new anonymous visitor: a vote never
   * toggles, `track` leaves a stray contact per event, and an idea submitted
   * after `identify` is refused as anonymous. So the transport keeps the jar
   * itself, one per client instance, the way one browser would.
   */
  readonly #cookies = new Map<string, string>();

  constructor(options: TransportOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#adminToken = options.adminToken;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** The cookies this client would send right now, for tests and debugging. */
  get cookies(): ReadonlyMap<string, string> {
    return this.#cookies;
  }

  /** Forget every cookie, so the next call starts as a fresh anonymous visitor. */
  clearCookies(): void {
    this.#cookies.clear();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // Checked before the fetch so a missing token fails the same way whether
    // or not the server happens to be reachable.
    if (options.admin && !this.#adminToken) {
      throw new HelpWellApiError(
        401,
        'no_admin_token',
        'This call needs an admin token. Pass `adminToken` to the HelpWellClient constructor.',
      );
    }

    const headers: Record<string, string> = { ...options.bytes?.headers };
    if (options.json !== undefined && !options.bytes) headers['content-type'] = 'application/json';
    if (options.admin) headers.authorization = `Bearer ${this.#adminToken}`;
    if (this.#cookies.size > 0) headers.cookie = serialiseCookies(this.#cookies);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}${queryString(options.query)}`, {
        method: options.method ?? 'GET',
        headers,
        signal: controller.signal,
        body: options.bytes
          ? (options.bytes.body as Uint8Array<ArrayBuffer>)
          : options.json === undefined
            ? undefined
            : JSON.stringify(options.json),
      });

      // Remembered before the status is looked at: an error response can still
      // hand out a visitor cookie, and the next call should carry it.
      for (const cookie of setCookies(response.headers)) this.#remember(cookie);

      if (response.status === 204) return undefined as T;

      if (options.text && response.ok) return (await response.text()) as T;

      const payload = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | T
        | null;

      if (!response.ok) {
        const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
        throw new HelpWellApiError(
          response.status,
          error?.code ?? 'unknown',
          error?.message ?? `HelpWell answered ${response.status}.`,
        );
      }
      return payload as T;
    } catch (cause) {
      if (cause instanceof HelpWellApiError) throw cause;
      // DNS failure, a refused connection and our own abort are the same thing
      // to a caller: the request did not happen, so status 0 and retryable.
      throw new HelpWellApiError(
        0,
        controller.signal.aborted ? 'timeout' : 'network_error',
        controller.signal.aborted
          ? `HelpWell did not answer within ${this.#timeoutMs}ms.`
          : `Could not reach HelpWell at ${this.#baseUrl}.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Only the name and value are kept. Path, Secure and SameSite are a
   * browser's concerns; the one attribute that matters here is `Max-Age=0`,
   * which is how a server takes a cookie back.
   */
  #remember(header: string): void {
    const [pair = '', ...attributes] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) return;

    const expired = attributes.some((attribute) => {
      const [key, raw] = attribute.split('=');
      return key?.trim().toLowerCase() === 'max-age' && Number(raw?.trim()) <= 0;
    });
    if (expired) this.#cookies.delete(name);
    else this.#cookies.set(name, value);
  }
}

/* ---------------------------------------------------------------- helpers */

/**
 * Every `Set-Cookie` header on a response, one string each.
 *
 * `Headers.getSetCookie()` is the only faithful way to read them: `get()`
 * joins repeated headers with a comma, and a cookie's `Expires` attribute
 * contains one. The split fallback is for a runtime or a test double without
 * it, and only splits on a comma that starts a new `name=` pair.
 */
function setCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') return withGetter.getSetCookie();
  const joined = headers.get('set-cookie');
  if (!joined) return [];
  return joined.split(/,(?=\s*[^\s=;,]+=)/).map((part) => part.trim());
}

function serialiseCookies(jar: ReadonlyMap<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Drops undefined and null so `?limit=undefined` never reaches the server. */
export function queryString(query: QueryInput | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

/**
 * Slugs contain slashes ("billing/invoices") and the API routes them as one
 * wildcard parameter, so each segment is escaped but the separators are kept.
 */
export function encodeSlug(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('/');
}
