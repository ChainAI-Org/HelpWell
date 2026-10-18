/**
 * The whole HTTP surface as one `(Request) => Response` function.
 *
 * Mount it wherever the host app likes:
 *
 *   const handler = createHelpWellHandler({ db, basePath: '/api/helpwell' });
 *   export const GET = handler;
 *   export const POST = handler;
 *
 * Besides the routes, it serves two kinds of file with no database involved:
 * the widget's own scripts and font under `/assets/`, and the images and
 * videos articles reference under `/screenshots/` and `/media/`, read from
 * the docs folders or from the host's content source. Every response carries
 * the security headers (security-headers.ts).
 *
 * Everything a handler remembers between requests (the proactive cache, the
 * support extension's retry queue) belongs to it alone, and its copy of the
 * settings belongs to its database (settings/store.ts), so a process can run
 * one handler per install without them meeting.
 */

import {
  DEFAULT_SCREENSHOTS,
  resolveMediaDirs,
  serveContentMedia,
  serveMedia,
} from '../content/media.js';
import { HelpWellError } from '../errors.js';
import { SettingsStore } from '../settings/store.js';
import { createContentSync } from './content-sync.js';
import {
  createContext,
  type HelpWellConfig,
  type RequestContext,
  type ResolvedHelpWellConfig,
} from './context.js';
import { errorResponse, json, Router } from './router.js';
import { adminRoutes } from './routes/admin.js';
import { articleRoutes } from './routes/articles.js';
import { publicRoutes } from './routes/public.js';
import {
  BASE_SECURITY_HEADERS,
  resolveSecurityHeaders,
  withSecurityHeaders,
} from './security-headers.js';
import { resolveSupport } from './support-setup.js';
import { VISITOR_HEADER, withVisitorToken } from './visitor-token.js';

export type HelpWellHandler = (request: Request) => Promise<Response>;

const DEFAULT_BASE = '/api/helpwell';

export function createHelpWellHandler(input: HelpWellConfig): HelpWellHandler {
  // The support extension, decided once: passed in, described by
  // `{ url, product, token }`, or found in the environment, and always
  // behind the fail-open wrapper (support-setup.ts).
  const config: ResolvedHelpWellConfig = { ...input, support: resolveSupport(input) };
  const basePath = normaliseBase(config.basePath ?? DEFAULT_BASE);

  const router = new Router<RequestContext>();
  publicRoutes(router);
  adminRoutes(router);
  articleRoutes(router, { basePath, media: config.media, content: config.content });

  // Resolved once: where `/screenshots/` and `/media/` are read from. A
  // content source, when the host gave one, replaces the folders.
  const media = resolveMediaDirs(config.media);
  const content = config.media === false ? undefined : config.content;
  const cookiePath = scopedCookiePath(config.cookiePath);

  // One store for the life of the handler. Its copy is the one every store on
  // this database shares, checked against the row on each request, so a save
  // made in the dashboard is what the very next widget request reads.
  const settingsStore = new SettingsStore(config.db);
  // What this install has published, pushed to a support extension that
  // takes it, now and then while requests come in (content-sync.ts).
  const contentSync = createContentSync({
    db: config.db,
    support: config.support,
    logger: config.logger,
    settings: () => settingsStore.get(),
  });

  // Copied once here so each response can hand the bytes straight to
  // `Response`. A file read off disk may be a view over a shared buffer, which
  // the Fetch types refuse; a fresh Uint8Array never is.
  const assets: Record<string, ServableAsset> = {};
  for (const [name, asset] of Object.entries(config.assets ?? {})) {
    assets[name] = {
      type: asset.type,
      body: typeof asset.body === 'string' ? asset.body : new Uint8Array(asset.body),
    };
  }

  const cors = new Set((config.corsOrigins ?? []).map((origin) => origin.replace(/\/+$/, '')));

  // Every response carries these, errors and files included; a route that
  // set its own (a media file's sandboxing policy) keeps it.
  const security = resolveSecurityHeaders(BASE_SECURITY_HEADERS, config.securityHeaders);

  return async function handler(request: Request): Promise<Response> {
    return withSecurityHeaders(await respond(request), security);
  };

  async function respond(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const allowOrigin = origin && cors.has(origin) ? origin : null;

    if (request.method === 'OPTIONS') return preflight(allowOrigin);

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return errorResponse(new HelpWellError('bad_request', 'Unparseable request URL'));
    }

    const path = stripBase(url.pathname, basePath);
    if (path === null) {
      return errorResponse(new HelpWellError('not_found', `Outside base path ${basePath}`));
    }

    // Answered before any context is built: these need no database, no
    // settings and no cookie. Liveness has to say "alive" even when the
    // schema is not there yet, and the widget files are the hottest path.
    if (path === '/health') {
      if (request.method === 'GET' || request.method === 'HEAD') {
        return withCors(json({ ok: true, name: 'helpwell' }), allowOrigin);
      }
      return withCors(methodNotAllowed(request.method, path, ['GET']), allowOrigin);
    }
    if (path.startsWith('/assets/') && (request.method === 'GET' || request.method === 'HEAD')) {
      return withCors(staticAsset(assets[path.slice('/assets/'.length)]), allowOrigin);
    }
    const mediaFile = /^\/(screenshots|media)\/(.+)$/.exec(path);
    if (mediaFile && (request.method === 'GET' || request.method === 'HEAD')) {
      const shots = mediaFile[1] === 'screenshots';
      const root = shots ? media.screenshots : media.docs;
      const file = decodePath(mediaFile[2] ?? '');
      return withCors(
        file === null
          ? errorResponse(new HelpWellError('not_found', 'No such file'))
          : content
            ? await serveContentMedia(
                content,
                shots ? `${DEFAULT_SCREENSHOTS}/${file}` : file,
                request,
              )
            : await serveMedia(root, file, request),
        allowOrigin,
      );
    }

    const match = router.match(request.method, path);
    if (!match) {
      const allowed = router.allowsPath(path);
      if (allowed.length > 0) {
        return withCors(methodNotAllowed(request.method, path, allowed), allowOrigin);
      }
      return withCors(
        errorResponse(new HelpWellError('not_found', `No route for ${path}`)),
        allowOrigin,
      );
    }

    let context: RequestContext;
    try {
      context = await createContext(request, config, settingsStore);
    } catch (error) {
      return withCors(errorResponse(error), allowOrigin);
    }
    contentSync?.tick();

    try {
      const response = await match.route.handler({
        request,
        params: match.params,
        query: url.searchParams,
        url,
        context,
      });
      return withCors(
        await withVisitorToken(withCookies(response, context.cookies, cookiePath), context),
        allowOrigin,
      );
    } catch (error) {
      return withCors(
        await withVisitorToken(
          withCookies(errorResponse(error), context.cookies, cookiePath),
          context,
        ),
        allowOrigin,
      );
    }
  }
}

/* ---------------------------------------------------------------- helpers */

/** A 405 that says what would have worked, which is what the status is for. */
function methodNotAllowed(method: string, path: string, allowed: string[]): Response {
  return json(
    new HelpWellError('bad_request', `${method} not allowed on ${path}`, {
      publicMessage: 'That is not something you can do here.',
    }).toJSON(),
    { status: 405, headers: { allow: allowed.join(', ') } },
  );
}

function normaliseBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Each segment of a URL path decoded, or null when one is not valid percent-encoding. */
function decodePath(path: string): string | null {
  try {
    return path.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/** Returns the path relative to the mount point, or null if outside it. */
function stripBase(pathname: string, basePath: string): string | null {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return null;
}

/**
 * The cookie path to scope HelpWell's cookies to, or null for `/`. Checked
 * once, when the handler is created, because a bad one is a config mistake:
 * anything that could end the attribute or start another is refused.
 */
function scopedCookiePath(path: string | undefined): string | null {
  if (path === undefined) return null;
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^\/[A-Za-z0-9._~!$&'()*+=:@%/-]*$/.test(trimmed)) {
    throw new HelpWellError('bad_request', `cookiePath is not a URL path: ${path}`);
  }
  return trimmed;
}

/**
 * A Response's headers are immutable once constructed in some runtimes, so
 * cookies are applied by rebuilding rather than mutating. Routes write every
 * cookie with `Path=/`; an install with its own `cookiePath` narrows it here.
 */
function withCookies(response: Response, cookies: string[], path: string | null = null): Response {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    headers.append(
      'set-cookie',
      path ? cookie.replace(/; Path=\/(?=;|$)/, `; Path=${path}`) : cookie,
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CORS, only for origins the host listed.
 *
 * The widget is same-origin by design — the API serves it — so most installs
 * never set `corsOrigins`. A help centre on its own domain, or a marketing
 * site embedding the widget, lists that origin and gets credentials with it,
 * and may read the visitor token a widget on another site keeps
 * (visitor-token.ts).
 */
function withCors(response: Response, allowOrigin: string | null): Response {
  if (!allowOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', allowOrigin);
  headers.set('access-control-allow-credentials', 'true');
  headers.set('access-control-expose-headers', VISITOR_HEADER);
  headers.append('vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

interface ServableAsset {
  body: Uint8Array<ArrayBuffer> | string;
  type: string;
}

/**
 * A static file, or a 404 that says which name would have worked.
 *
 * The widget bundle changes only when the package is upgraded, and its file
 * names do not change with it, so it is cached for a day and revalidated
 * rather than cached forever.
 */
function staticAsset(asset: ServableAsset | undefined): Response {
  if (!asset) {
    return errorResponse(
      new HelpWellError('not_found', 'No such asset', {
        publicMessage:
          'No such file. The widget is served as assets/loader.js and assets/widget.js.',
      }),
    );
  }
  const headers: Record<string, string> = {
    'content-type': asset.type,
    'cache-control': 'public, max-age=86400, must-revalidate',
    'cross-origin-resource-policy': 'cross-origin',
  };
  // A browser only uses a font from another origin when CORS says it may,
  // and the widget's fonts are public files (widgetAssets() carries them).
  if (asset.type.startsWith('font/')) headers['access-control-allow-origin'] = '*';
  return new Response(asset.body, { status: 200, headers });
}

function preflight(allowOrigin: string | null): Response {
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    // The widget's visitor token, and the name and type an attachment is sent with.
    'access-control-allow-headers': `content-type,authorization,${VISITOR_HEADER},x-helpwell-filename,x-helpwell-type`,
    'access-control-max-age': '600',
  };
  if (allowOrigin) {
    headers['access-control-allow-origin'] = allowOrigin;
    headers['access-control-allow-credentials'] = 'true';
    headers.vary = 'Origin';
  }
  return new Response(null, { status: 204, headers });
}
