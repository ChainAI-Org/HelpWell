/**
 * Per-request context.
 *
 * Built once per request and handed to every route. It resolves who is calling
 * and lazily exposes the engine pieces, so a route that only lists articles
 * never constructs a model client.
 */

import { sql } from 'drizzle-orm';
import { Agent } from '../agent/agent.js';
import { rateLimit } from '../agent/guards.js';
import type { ModelPort } from '../agent/model.js';
import { OpenRouterModel } from '../agent/model.js';
import type { AgentModels, ModelFactory, ModelPurpose } from '../agent/model-factory.js';
import type { AssetStore } from '../content/assets.js';
import type { WriteArticle } from '../content/editing.js';
import type { MediaDirs } from '../content/media.js';
import type { ContentSource } from '../content/source.js';
import type { Db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import type { MxResolver } from '../forms/mx.js';
import { hashIp } from '../ip-hash.js';
import type { Settings } from '../settings/schema.js';
import { SettingsStore } from '../settings/store.js';
import { webhookOptionsFor } from '../webhook-guard.js';
import {
  applyNameOverride,
  applyToolOverrides,
  withOverrideInstructions,
} from './agent-overrides.js';
import { assertSameOrigin } from './csrf.js';
import type { SupportLogger } from './fail-open.js';
import type { TurnstileConfig } from './human-check.js';
import {
  ADMIN_COOKIE,
  cookieHeader,
  ensureVisitor,
  readCookie,
  safeEqual,
  VISITOR_COOKIE,
} from './identity.js';
import type { RemoteSupportOptions } from './remote-extension.js';
import type { SecurityHeadersOption } from './security-headers.js';
import type { AgentOverrides, SupportExtension } from './support-extension.js';
import { presentedVisitorToken, verifyVisitorToken } from './visitor-token.js';

export interface HelpWellConfig {
  db: Db;
  /**
   * Optional human support integration: an extension object written
   * in-process, or `{ url, product, token }` for a remote support extension
   * reached over HTTPS (remote-extension.ts). Left out, HelpWell connects to
   * a remote one when HELPWELL_SUPPORT_URL, HELPWELL_SUPPORT_PRODUCT and
   * HELPWELL_SUPPORT_TOKEN are all set; `false` means none, whatever the
   * environment says. Whichever it is, every call goes through the fail-open
   * wrapper (fail-open.ts).
   */
  support?: SupportExtension | RemoteSupportOptions | false;
  /**
   * Where the support extension's warnings go: a half-set environment, a
   * refused or failing call, a retry given up on. Defaults to the console. A
   * host running many installs in one process passes each its own, so a
   * warning says which install it came from.
   */
  logger?: SupportLogger;
  /** Mount path, e.g. "/api/helpwell". Defaults to "/api/helpwell". */
  basePath?: string;
  /**
   * The address a browser reaches this API at, mount path included, e.g.
   * `https://app.acme.com/api/helpwell`. Image URLs in what the widget is
   * sent are made absolute against it, so an article's screenshot loads in
   * the widget on the customer's own site (public-urls.ts). Defaults to the
   * request's own origin and `basePath`; set it when a proxy in front
   * changes the host the request arrives with.
   */
  publicUrl?: string;
  /** Shared secret for signed identify tokens (WG-06). */
  identitySecret?: string;
  /**
   * Decides whether a request is an admin. The host app owns auth: HelpWell
   * never ships a login screen (DX-08). Returning false everywhere makes the
   * dashboard unreachable, which is the correct default for an unset install.
   */
  isAdmin?: (request: Request) => boolean | Promise<boolean>;
  /**
   * A shared secret for server-to-server admin calls — the SDK's admin client,
   * a release script — sent as `Authorization: Bearer`. Compared in constant
   * time. Also accepted from the `hw_admin` cookie, which is what a local dev
   * setup with no `isAdmin` uses. Never the only admin check in production:
   * set `isAdmin` for people, and this for machines.
   */
  adminToken?: string;
  /** OpenRouter key. Without it the agent degrades to search-only replies. */
  openRouterKey?: string;
  /** Override the model, for tests. */
  model?: ModelPort;
  /**
   * The model for each job, for a host that supplies its own: per install,
   * per purpose, metered however it likes. Takes precedence over `model` and
   * `openRouterKey`. Model names still come from Settings. See `ModelFactory`.
   */
  modelFactory?: ModelFactory;
  /**
   * Where the knowledge base's files are, when not in the docs folder on this
   * server's disk: `/screenshots/` and `/media/` are served from it, and an
   * article saved with no `writeArticle` hook is written to it if it is
   * writable. Index it with `syncContent`. See `ContentSource`.
   */
  content?: ContentSource;
  /**
   * Where images uploaded for articles are kept (`POST /admin/assets`, and
   * the dashboard's editor and importer, which take the same option): see
   * `AssetStore`. Unset, they are written through a writable `content`
   * source, or with none, into the docs folder under `_media/` when this
   * install can save articles; `false` takes no uploads.
   */
  assetStore?: AssetStore | false;
  /**
   * Where fallbacks for unset options are read from: OPENROUTER_API_KEY,
   * HELPWELL_IDENTITY_SECRET, HELPWELL_TURNSTILE_SECRET, HELPWELL_WEBHOOK_GUARD
   * and the support extension's three. Defaults to `process.env`. A host
   * running many installs in one process passes each install its own (or
   * `{}`), so no install picks up a key meant for the host.
   */
  env?: Record<string, string | undefined>;
  /**
   * The fetch every webhook delivery is sent with: new events, retries and
   * test deliveries, from the routes, the agent and the indexer alike.
   * Defaults to the built-in guard: https only, no private, loopback or
   * link-local address among those the name resolves to (checked on the
   * connection itself), and redirects never followed. A host that enforces
   * its own egress rules passes its own fetch. `false` sends with the plain
   * global fetch, for local development where a webhook points at localhost;
   * HELPWELL_WEBHOOK_GUARD=off in `env` does the same. See webhook-guard.ts.
   */
  webhookFetch?: typeof fetch | false;
  /**
   * The `Path` the visitor cookie is set with. Defaults to `/`. Installs that
   * share one hostname under different prefixes each set their own prefix,
   * covering both the API and the help centre, so one install's visitor
   * cookie is never sent to, or cleared by, another.
   */
  cookiePath?: string;
  /** instructions.md and playbook.md read from the repo at boot. */
  instructions?: string;
  playbook?: string;
  /** Open incident banner, if the host app tracks one. */
  incident?: { title: string; detail?: string } | null;
  /** Cookie flags. Off by default on http://localhost so dev works. */
  secureCookies?: boolean;
  /**
   * Static files to serve under `<basePath>/assets/`, keyed by file name.
   *
   * This is how the widget reaches the page without a copy step:
   * `assets: widgetAssets()` from `@helpwell/widget/server`, and the loader
   * is at `<basePath>/assets/loader.js`.
   */
  assets?: Record<string, StaticAsset>;
  /**
   * Origins allowed to call the API from a browser on another domain, with
   * credentials — a help centre on its own domain, say. The widget is served
   * by this API and is same-origin, so most installs leave this unset.
   */
  corsOrigins?: string[];
  /**
   * Security headers on every API response: `nosniff` and a
   * `strict-origin-when-cross-origin` referrer policy by default. An object
   * replaces (a string) or drops (null) single headers; `false` sends none,
   * for a host that sets its own at the proxy. See `security-headers.ts`.
   */
  securityHeaders?: SecurityHeadersOption;
  /**
   * The fetch the model picker reads OpenRouter's model list with
   * (`GET /admin/models`). Defaults to the global fetch; replace it in tests.
   */
  modelsFetch?: typeof fetch;
  /**
   * The folders article images and videos are served from, relative to the
   * working directory, so a screenshot an article references as
   * `../_screenshots/x.png` loads in the help centre and the widget. Served at
   * `<basePath>/screenshots/…` and `<basePath>/media/…`, which is what
   * `helpwell sync` rewrites those paths to. Defaults to `docs` and
   * `docs/_screenshots`; `false` serves nothing.
   */
  media?: MediaDirs | false;
  /**
   * Saves an article's Markdown in the repo, for `POST /admin/articles`. The
   * same hook the dashboard takes; see `WriteArticle`. Without it, saving
   * through the API answers 501 and nothing is written.
   */
  writeArticle?: WriteArticle;
  /**
   * Cloudflare Turnstile, for the widget's bot check. On when Settings say
   * `agent.abuse.botCheck: 'turnstile'`, or when `enabled` is true here. The
   * secret falls back to HELPWELL_TURNSTILE_SECRET and the site key to
   * Settings; with either missing the check stays off. `fetch` reaches
   * siteverify, and is there for tests. See `requireHuman`.
   */
  turnstile?: TurnstileConfig;
  /**
   * Reads a status page for `GET /status` and returns its parsed JSON. The
   * default is https only, refuses private and loopback addresses when it
   * connects, and gives up after 5 seconds or 256 KB. Replace it in tests.
   */
  fetchStatusPage?: (url: string) => Promise<unknown>;
  /**
   * Forms (forms/). `resolveMx` answers the MX lookup that checks an email's
   * domain can receive mail: Node's resolver by default, `null` to skip the
   * check (a runtime without DNS), or your own for tests.
   */
  forms?: { resolveMx?: MxResolver | null };
  now?: () => Date;
}

export interface StaticAsset {
  body: Uint8Array | string;
  /** The Content-Type to serve it with. */
  type: string;
}

/**
 * The config as routes see it: `support` resolved, once per handler, into the
 * fail-open extension HelpWell actually calls, or nothing.
 */
export type ResolvedHelpWellConfig = Omit<HelpWellConfig, 'support'> & {
  support?: SupportExtension;
};

export interface RequestContext {
  db: Db;
  config: ResolvedHelpWellConfig;
  request: Request;
  settingsStore: SettingsStore;
  settings: Settings;
  /** Cookies the response must set. Routes push, the handler flushes. */
  cookies: string[];
  isAdmin: boolean;
  /** Resolved contact id, creating an anonymous visitor on first touch. */
  contactId(): Promise<string>;
  /** Contact id if a valid one was presented, without creating one. */
  peekContactId(): string | null;
  /**
   * The key rate limits are counted against.
   *
   * A cookie (or, from a widget on another site, a signed visitor token)
   * the caller presented and we verified, or else the client IP as this
   * install's keyed hash (`ip:<hash>`, ip-hash.ts), so a counter's name never
   * holds an address. Never a contact id minted during this request: a caller who drops the
   * cookie gets a fresh contact each time, and a limit keyed on that would be
   * no limit at all.
   */
  visitorKey(): string;
  /** Tell the browser to forget its visitor cookie. */
  clearVisitor(): void;
  /**
   * The agent for this request. `overrides` are a support extension's
   * (api/agent-overrides.ts): tools it switched off, instructions it adds.
   */
  agent(additionalPlaybook?: string, overrides?: AgentOverrides | null): Agent;
  /**
   * The model port for a job, or null when this install has none: the
   * host's `modelFactory` when there is one, otherwise the install's own
   * (`model`, or OpenRouter when a key is set).
   */
  model(purpose: ModelPurpose): ModelPort | null;
  clientIp(): string | null;
}

/**
 * How many anonymous contacts one address may create in an hour. A real
 * visitor creates one; a script that drops its cookie on every call would
 * otherwise create one per request and fill the contacts table.
 */
const NEW_VISITORS_PER_IP_PER_HOUR = 120;

export async function createContext(
  request: Request,
  config: ResolvedHelpWellConfig,
  settingsStore: SettingsStore = new SettingsStore(config.db),
): Promise<RequestContext> {
  const settings = await settingsStore.get();
  const cookies: string[] = [];
  const ip = clientIp(request);

  // A cookie is only a claim. It is checked against the database once here,
  // so an erased contact's browser and a forged value are both simply
  // "no cookie", and a stale one is cleared rather than written to.
  const claimed = readCookie(request, VISITOR_COOKIE);
  const fromCookie = claimed ? await validVisitor(config.db, claimed) : null;
  if (claimed && !fromCookie) cookies.push(expiredCookie(request, config));
  // A widget on another site, where the cookie may never arrive, sends a
  // signed token in a header instead (visitor-token.ts). Read only when there
  // is no cookie to go by, and checked the same way once its signature is.
  const token = fromCookie ? null : presentedVisitorToken(request);
  const signed = token ? await verifyVisitorToken(config.db, token) : null;
  const presented = fromCookie ?? (signed ? await validVisitor(config.db, signed) : null);
  // An anonymous caller is counted by address, and a rate counter's name is
  // stored, so the address goes in as this install's keyed hash. Only worked
  // out when there is no visitor to count by instead.
  const anonymousKey = !presented && ip ? `ip:${await hashIp(config.db, ip)}` : null;

  let resolvedContactId: string | null = presented;
  let agentInstance: Agent | null = null;
  let ownModel: ModelPort | null = null;
  const fromFactory = new Map<ModelPurpose, ModelPort | null>();

  /** The install's one port, as it always was: built once per request. */
  const installModel = (): ModelPort => {
    ownModel ??= config.model ?? buildModel(config, settings);
    return ownModel;
  };

  const modelFor = (purpose: ModelPurpose): ModelPort | null => {
    const factory = config.modelFactory;
    if (factory) {
      if (!fromFactory.has(purpose)) fromFactory.set(purpose, factory(purpose) ?? null);
      return fromFactory.get(purpose) ?? null;
    }
    // An unset key does not throw until a call is made, so it is checked
    // here: a caller asking whether there is a model should hear no.
    if (config.model) return config.model;
    return openRouterKey(config) ? installModel() : null;
  };

  const isAdmin = await resolveAdmin(request, config);

  const context: RequestContext = {
    db: config.db,
    config,
    request,
    settingsStore,
    settings,
    cookies,
    isAdmin,

    peekContactId: () => resolvedContactId,

    async contactId() {
      if (resolvedContactId) return resolvedContactId;
      const minted = await rateLimit(
        config.db,
        `visitors:${ip ? await hashIp(config.db, ip) : 'unknown'}`,
        NEW_VISITORS_PER_IP_PER_HOUR,
        3_600_000,
      );
      if (!minted.allowed) {
        throw new HelpWellError('rate_limited', 'Too many new visitors from one address', {
          publicMessage: 'That is a bit too fast. Try again shortly.',
          details: { resetAt: minted.resetAt.toISOString() },
        });
      }
      resolvedContactId = await ensureVisitor(config.db, null);
      return resolvedContactId;
    },

    visitorKey: () => presented ?? anonymousKey ?? 'anonymous',

    clearVisitor() {
      resolvedContactId = null;
      cookies.push(expiredCookie(request, config));
    },

    agent(additionalPlaybook, overrides) {
      if (!agentInstance) {
        // With a factory, a purpose it has no port for gets one that refuses
        // every call, so the agent answers from search as with no key.
        const factory = config.modelFactory;
        agentInstance = new Agent({
          db: config.db,
          settings: applyNameOverride(
            applyToolOverrides(settings, overrides ?? null),
            overrides ?? null,
          ),
          model: factory ? (modelFor('chat') ?? unconfiguredModel()) : installModel(),
          models: factory ? agentModels(modelFor) : undefined,
          instructions: withOverrideInstructions(config.instructions, overrides ?? null),
          playbook: [config.playbook, additionalPlaybook].filter(Boolean).join('\n\n'),
          incident: config.incident ?? null,
          now: config.now,
          webhooks: webhookOptionsFor(config),
        });
      }
      return agentInstance;
    },

    model: modelFor,

    clientIp: () => ip,
  };

  return context;
}

/**
 * The agent's fallback and embeddings ports from a lookup by purpose: what
 * the agent and an eval run are given when a host's factory is in charge.
 */
export function agentModels(model: (purpose: ModelPurpose) => ModelPort | null): AgentModels {
  return { fallback: model('fallback'), embeddings: model('embeddings') };
}

/** The key the install's own OpenRouter port uses, or ''. */
function openRouterKey(config: HelpWellConfig): string {
  return config.openRouterKey ?? envOf(config).OPENROUTER_API_KEY ?? '';
}

/** Where this install reads environment fallbacks from. */
export function envOf(config: Pick<HelpWellConfig, 'env'>): Record<string, string | undefined> {
  return config.env ?? process.env;
}

/** A port with no key: every call fails with `not_configured`, and the agent degrades. */
function unconfiguredModel(): ModelPort {
  return new OpenRouterModel({ apiKey: '' });
}

async function validVisitor(db: Db, id: string): Promise<string | null> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`id = ${id} AND deleted_at IS NULL`)
    .limit(1);
  return rows[0]?.id ?? null;
}

function expiredCookie(request: Request, config: HelpWellConfig): string {
  return cookieHeader(VISITOR_COOKIE, '', {
    maxAge: 0,
    secure: config.secureCookies ?? isHttps(request),
  });
}

function isHttps(request: Request): boolean {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

function buildModel(config: HelpWellConfig, settings: Settings): ModelPort {
  return new OpenRouterModel({
    apiKey: openRouterKey(config),
    appName: settings.product.name,
    appUrl: settings.product.appUrl || undefined,
  });
}

async function resolveAdmin(request: Request, config: HelpWellConfig): Promise<boolean> {
  // A bearer token is how a server (the SDK's admin client, a CI job) proves
  // itself, and it works alongside the host app's own `isAdmin`: a browser
  // session and a script are different callers with different credentials.
  if (config.adminToken) {
    const presented = readCookie(request, ADMIN_COOKIE) ?? bearer(request);
    if (presented !== null && safeEqual(presented, config.adminToken)) return true;
  }
  if (config.isAdmin) return await config.isAdmin(request);
  return false;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Best-effort client IP for rate limiting. Only the first hop of
 * x-forwarded-for is used, and it is hashed with this install's key
 * (ip-hash.ts) before it is ever stored, a rate counter's name included.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? null;
}

/**
 * Throws unless the caller is an admin, and unless a state-changing request
 * came from this site. Admin sessions are the host app's cookies, and a
 * cookie is sent by a hostile page's form too; the origin check is what
 * stops that page from deleting a contact. Used by every /admin route.
 */
export function requireAdmin(context: RequestContext): void {
  if (!context.isAdmin) {
    throw new HelpWellError('unauthorized', 'Admin route called without admin rights', {
      publicMessage: 'You need to be signed in as an admin.',
    });
  }
  assertSameOrigin(context.request);
}
