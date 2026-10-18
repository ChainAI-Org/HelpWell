/**
 * A very small router.
 *
 * HelpWell mounts inside somebody else's app, so it takes a Request and returns
 * a Response and nothing more: no Express, no framework assumptions, works the
 * same in Next.js, Remix, Hono or a plain Node server (DX-02).
 */

import { HelpWellError, isHelpWellError } from '../errors.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteMatch<Ctx> {
  request: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  url: URL;
  context: Ctx;
}

export type RouteHandler<Ctx> = (match: RouteMatch<Ctx>) => Promise<Response> | Response;

interface Route<Ctx> {
  method: Method;
  segments: string[];
  handler: RouteHandler<Ctx>;
}

export class Router<Ctx> {
  #routes: Route<Ctx>[] = [];

  add(method: Method, pattern: string, handler: RouteHandler<Ctx>): this {
    this.#routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler<Ctx>) {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: RouteHandler<Ctx>) {
    return this.add('POST', pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler<Ctx>) {
    return this.add('PATCH', pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler<Ctx>) {
    return this.add('DELETE', pattern, handler);
  }

  /** Returns null when no route matches, so the host app can 404 its own way. */
  match(
    method: string,
    path: string,
  ): { route: Route<Ctx>; params: Record<string, string> } | null {
    const segments = split(path);
    for (const route of this.#routes) {
      if (route.method !== method) continue;
      const params = matchSegments(route.segments, segments);
      if (params) return { route, params };
    }
    return null;
  }

  /** Does any route exist at this path under another method? For a 405. */
  allowsPath(path: string): Method[] {
    const segments = split(path);
    return this.#routes
      .filter((route) => matchSegments(route.segments, segments) !== null)
      .map((route) => route.method);
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Match a pattern against a path.
 *
 * A `*name` segment takes one or more segments, which is how an article slug
 * with a slash in it ("billing/exporting-invoices") survives as a single
 * parameter. Anything after the star in the pattern is literal and must match
 * the end of the path: `/articles/*slug/rating` takes "billing/invoices" as the
 * slug and requires "rating" to follow. An earlier version let the star eat
 * everything, so every article vote was stored under "billing/invoices/rating"
 * and matched no article.
 */
function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  const star = pattern.findIndex((p) => p.startsWith('*'));

  const head = star === -1 ? pattern : pattern.slice(0, star);
  const tail = star === -1 ? [] : pattern.slice(star + 1);

  if (star === -1 && pattern.length !== actual.length) return null;
  // The star needs at least one segment of its own.
  if (star !== -1 && actual.length < head.length + tail.length + 1) return null;

  for (let i = 0; i < head.length; i++) {
    if (!matchOne(head[i]!, actual[i]!, params)) return null;
  }

  if (star === -1) return params;

  const tailStart = actual.length - tail.length;
  for (let i = 0; i < tail.length; i++) {
    if (!matchOne(tail[i]!, actual[tailStart + i]!, params)) return null;
  }

  const name = pattern[star]!.slice(1) || 'rest';
  try {
    params[name] = actual.slice(head.length, tailStart).map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  return params;
}

function matchOne(p: string, a: string, params: Record<string, string>): boolean {
  if (p.startsWith(':')) {
    try {
      params[p.slice(1)] = decodeURIComponent(a);
    } catch {
      return false;
    }
    return true;
  }
  return p === a;
}

/* ---------------------------------------------------------------- helpers */

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

export function noContent(init: ResponseInit = {}): Response {
  return new Response(null, { status: 204, ...init });
}

/** Turn any thrown value into the one error shape the API promises. */
export function errorResponse(error: unknown): Response {
  if (isHelpWellError(error)) {
    return json(error.toJSON(), { status: error.status });
  }
  // Never leak an internal message to a customer's browser.
  const wrapped = new HelpWellError('internal', String(error), { cause: error });
  return json(wrapped.toJSON(), { status: 500 });
}

/** Bodies above this are not something a support widget sends. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Read a JSON body, and only a JSON body.
 *
 * Insisting on the content type is a CSRF defence in its own right: a
 * cross-site HTML form can only send `text/plain` or form encodings, so a
 * forged request that reaches a route through here is refused before any
 * origin check runs. The size cap keeps a hostile body from becoming a
 * multi-megabyte prompt.
 */
export async function readJson<T>(request: Request): Promise<T> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new HelpWellError('bad_request', 'Body must be application/json');
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    throw new HelpWellError('bad_request', 'Body is too large');
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new HelpWellError('bad_request', 'Body could not be read');
  }
  if (text.length > MAX_BODY_BYTES) {
    throw new HelpWellError('bad_request', 'Body is too large');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HelpWellError('bad_request', 'Body must be JSON');
  }
}

/* ------------------------------------------------------------- validation */

/**
 * A query-string integer with a floor, a ceiling and a default. Anything that
 * is not a whole number in range is a 400, not a NaN that reaches SQL.
 */
export function intParam(
  query: URLSearchParams,
  name: string,
  options: { default: number; min?: number; max: number },
): number {
  const raw = query.get(name);
  if (raw === null || raw === '') return options.default;
  const value = Number(raw);
  const min = options.min ?? 1;
  if (!Number.isInteger(value) || value < min || value > options.max) {
    throw new HelpWellError(
      'bad_request',
      `${name} must be a whole number from ${min} to ${options.max}`,
    );
  }
  return value;
}

/** A query-string date, or null when absent. Unparseable is a 400. */
export function dateParam(query: URLSearchParams, name: string): Date | null {
  const raw = query.get(name);
  if (raw === null || raw === '') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new HelpWellError('bad_request', `${name} must be an ISO 8601 date`);
  }
  return date;
}

/** One of a fixed set of strings, or a 400 that lists the set. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  const match = allowed.find((option) => option === value);
  if (match === undefined) {
    throw new HelpWellError('bad_request', `${name} must be one of: ${allowed.join(', ')}`);
  }
  return match;
}
