/**
 * Reading a customer's public status page, for the widget's status row (WG-11).
 *
 * The URL comes from Settings, and the server fetches it, which makes this a
 * server-side request forgery surface: whoever can edit Settings could point
 * it at `http://169.254.169.254/` or a database on the private network and
 * read the answer back through `/status`. So the fetch is https only, on the
 * default port, never follows a redirect, and checks every address the name
 * resolves to AT CONNECT TIME (a DNS answer checked first and then resolved
 * again by the HTTP client could change in between). It also gives up after
 * five seconds or 256 KB, and only ever returns the few fields parsed out of
 * the JSON, never the body itself.
 *
 * Three providers are understood by the shape of what they return, so a
 * status page on a custom domain works without saying which it is:
 * Atlassian Statuspage (`/api/v2/summary.json`), Instatus (`/summary.json`)
 * and Better Stack (`/index.json`).
 */

import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { StatusLevel } from '../settings/schema.js';

export type { StatusLevel } from '../settings/schema.js';

export interface StatusIncident {
  name: string;
  /** The provider's own word for where it is, e.g. `investigating`. */
  status: string;
  url: string | null;
}

export interface PageStatus {
  provider: 'statuspage' | 'instatus' | 'betterstack';
  level: StatusLevel;
  message: string;
  incidents: StatusIncident[];
  updatedAt: string | null;
}

/** What the widget says for each level when the provider gave no wording of its own. */
export const STATUS_MESSAGES: Record<StatusLevel, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems are running slowly',
  partial_outage: 'Some systems are down',
  major_outage: 'We are having a major outage',
  maintenance: 'Scheduled maintenance in progress',
};

const MAX_INCIDENTS = 5;

/* --------------------------------------------------------------- parsers */

/** Whichever provider's shape this is, parsed; null for anything else. */
export function parseStatusPage(json: unknown): PageStatus | null {
  return parseStatuspage(json) ?? parseInstatus(json) ?? parseBetterStack(json);
}

const STATUSPAGE_LEVEL: Record<string, StatusLevel> = {
  none: 'operational',
  minor: 'degraded',
  major: 'partial_outage',
  critical: 'major_outage',
  maintenance: 'maintenance',
};

/** Atlassian Statuspage: `summary.json`, or the smaller `status.json`. */
export function parseStatuspage(json: unknown): PageStatus | null {
  const body = record(json);
  const status = record(body?.status);
  const indicator = text(status?.indicator);
  if (!body || !indicator || !(indicator in STATUSPAGE_LEVEL)) return null;

  const page = record(body.page);
  const maintenances = list(body.scheduled_maintenances).filter(
    (item) => text(record(item)?.status) === 'in_progress',
  );
  let level = STATUSPAGE_LEVEL[indicator]!;
  if (level === 'operational' && maintenances.length > 0) level = 'maintenance';

  const incidents = [...list(body.incidents), ...maintenances]
    .map(record)
    .filter((item): item is Record<string, unknown> => item !== null && Boolean(text(item.name)))
    .slice(0, MAX_INCIDENTS)
    .map((item) => ({
      name: text(item.name)!,
      status: text(item.status) ?? '',
      url: httpsOrNull(item.shortlink) ?? httpsOrNull(page?.url),
    }));

  return {
    provider: 'statuspage',
    level,
    message: text(status?.description) ?? STATUS_MESSAGES[level],
    incidents,
    updatedAt: text(page?.updated_at) ?? null,
  };
}

const INSTATUS_IMPACT: Record<string, StatusLevel> = {
  MAJOROUTAGE: 'major_outage',
  PARTIALOUTAGE: 'partial_outage',
  DEGRADEDPERFORMANCE: 'degraded',
};

/** Instatus: `summary.json`. */
export function parseInstatus(json: unknown): PageStatus | null {
  const body = record(json);
  const page = record(body?.page);
  const state = text(page?.status);
  if (!body || !state || !['UP', 'HASISSUES', 'UNDERMAINTENANCE'].includes(state)) return null;

  const active = list(body.activeIncidents).map(record).filter(isRecord);
  const maintenance = list(body.activeMaintenances).map(record).filter(isRecord);

  let level: StatusLevel = 'operational';
  if (state === 'UNDERMAINTENANCE') level = 'maintenance';
  if (state === 'HASISSUES' || active.length > 0) {
    level = 'degraded';
    for (const incident of active) {
      const impact = INSTATUS_IMPACT[text(incident.impact) ?? ''];
      if (impact && severity(impact) > severity(level)) level = impact;
    }
  }

  const incidents = [...active, ...maintenance]
    .filter((item) => Boolean(text(item.name)))
    .slice(0, MAX_INCIDENTS)
    .map((item) => ({
      name: text(item.name)!,
      status: (text(item.status) ?? '').toLowerCase(),
      url: httpsOrNull(item.url) ?? httpsOrNull(page?.url),
    }));

  return {
    provider: 'instatus',
    level,
    message: incidents[0]?.name ?? STATUS_MESSAGES[level],
    incidents,
    updatedAt: null,
  };
}

const BETTERSTACK_LEVEL: Record<string, StatusLevel> = {
  operational: 'operational',
  degraded: 'degraded',
  downtime: 'major_outage',
  maintenance: 'maintenance',
};

/** Better Stack (formerly Better Uptime): the page's JSON:API `index.json`. */
export function parseBetterStack(json: unknown): PageStatus | null {
  const body = record(json);
  const attributes = record(record(body?.data)?.attributes);
  const state = text(attributes?.aggregate_state);
  if (!body || !state || !(state in BETTERSTACK_LEVEL)) return null;

  const level = BETTERSTACK_LEVEL[state]!;
  const incidents = list(body.included)
    .map(record)
    .filter(isRecord)
    .filter((item) => item.type === 'status_report')
    .map((item) => record(item.attributes))
    .filter(isRecord)
    .filter((report) => Boolean(text(report.title)) && text(report.aggregate_state) !== 'resolved')
    .slice(0, MAX_INCIDENTS)
    .map((report) => ({
      name: text(report.title)!,
      status: text(report.aggregate_state) ?? '',
      url: null,
    }));

  return {
    provider: 'betterstack',
    level,
    message: incidents[0]?.name ?? STATUS_MESSAGES[level],
    incidents,
    updatedAt: text(attributes?.updated_at) ?? null,
  };
}

function severity(level: StatusLevel): number {
  return ['operational', 'maintenance', 'degraded', 'partial_outage', 'major_outage'].indexOf(
    level,
  );
}

/* ------------------------------------------------------------ candidates */

/**
 * The JSON URLs to try for a status page, most likely first. A URL that is
 * already a `.json` file is used as it is; otherwise the provider is guessed
 * from the host and the other two are tried after it.
 */
export function statusCandidates(url: string): string[] {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Status pages are read over https only.');
  if (/\.json$/i.test(parsed.pathname)) return [parsed.href];

  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  const statuspage = `${base}/api/v2/summary.json`;
  const instatus = `${base}/summary.json`;
  const betterstack = `${base}/index.json`;
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith('.instatus.com')) return [instatus, statuspage, betterstack];
  if (host.endsWith('.betteruptime.com') || host.endsWith('.betterstack.com')) {
    return [betterstack, statuspage, instatus];
  }
  return [statuspage, instatus, betterstack];
}

/* ----------------------------------------------------------- SSRF guard */

/**
 * Loopback, private, link-local, carrier-grade NAT, documentation, multicast
 * and reserved ranges, for IPv4 and IPv6 (including IPv4 mapped into IPv6).
 * Anything that does not parse as an address counts as private: refusing is
 * the safe way to be wrong.
 */
export function isPrivateAddress(address: string): boolean {
  const ip =
    address
      .trim()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? '';
  const version = isIP(ip);
  if (version === 4) return privateV4(ip);
  if (version === 6) return privateV6(ip);
  return true;
}

function privateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function privateV6(ip: string): boolean {
  const groups = expandV6(ip);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // :: and ::1
  if (groups.slice(0, 7).every((g) => g === 0) && (g7 === 0 || g7 === 1)) return true;
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d)
  const embedded = `${g6! >> 8}.${g6! & 255}.${g7! >> 8}.${g7! & 255}`;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return privateV4(embedded);
  }
  if (g0 === 0x64 && g1 === 0xff9b) return privateV4(embedded);
  if ((g0! & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0! & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0! & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

/** An IPv6 address as eight 16-bit numbers, or null. */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  // A dotted IPv4 tail becomes two hex groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const parts = tail[1]!.split('.').map(Number);
    text = `${text.slice(0, tail.index)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${(
      (parts[2]! << 8) | parts[3]!
    ).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const numbers = all.map((group) => Number.parseInt(group, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? numbers
    : null;
}

/** Names that only ever mean something on the local network. */
export function localName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    /\.(localhost|local|internal|intranet|lan|home\.arpa)$/.test(host) ||
    !host.includes('.')
  );
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type LookupFunction = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void;

/**
 * A DNS lookup that fails for a private address. Handed to the HTTP client as
 * its `lookup`, so the address checked is the address it connects to.
 */
export function guardedLookup(
  lookup: LookupFunction = dnsLookup as LookupFunction,
): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family);
      const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
      const refused = addresses.find((a) => isPrivateAddress(a));
      if (refused || addresses.length === 0) {
        const denied = new Error(
          `${hostname} resolves to a private address; status pages must be public.`,
        ) as NodeJS.ErrnoException;
        denied.code = 'EPRIVATE';
        return callback(denied, address, family);
      }
      callback(null, address, family);
    });
  };
}

export interface FetchPublicJsonOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Swap the resolver, for tests. It is still guarded. */
  lookup?: LookupFunction;
}

/**
 * GET a public https URL and parse it as JSON, under every guard above.
 * Rejects with a plain Error; the route turns any failure into "unknown".
 */
export function fetchPublicJson(
  url: string,
  options: FetchPublicJsonOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBytes = options.maxBytes ?? 256 * 1024;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.reject(new Error('Not a URL.'));
  }
  if (parsed.protocol !== 'https:') return Promise.reject(new Error('https only.'));
  if (parsed.port && parsed.port !== '443') return Promise.reject(new Error('Port 443 only.'));
  if (parsed.username || parsed.password) return Promise.reject(new Error('No credentials.'));
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? isPrivateAddress(host) : localName(host)) {
    return Promise.reject(new Error(`${host} is not a public address.`));
  }

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      parsed,
      {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'HelpWell status reader' },
        lookup: guardedLookup(options.lookup) as never,
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Status page answered ${status}.`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error('Status page is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Status page did not answer with JSON.'));
          }
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('Status page timed out.')));
    request.on('error', reject);
    request.end();
  });
}

/* ------------------------------------------------------------------ read */

interface Cached {
  at: number;
  value: PageStatus | null;
}

/** One minute, per URL. */
export const STATUS_CACHE_MS = 60_000;
/**
 * How many status pages are remembered. A process hosting many installs sees
 * one per install; past this the least recently read is forgotten, rather
 * than every install's answer at once.
 */
const MAX_CACHED = 1_000;

interface StatusCache {
  answers: Map<string, Cached>;
  /** Which candidate answered last time, so a known page costs one request. */
  resolved: Map<string, string>;
}

/**
 * Answers read with the default fetcher are public pages anyone could read,
 * so every install in the process shares them. A host's own `fetchStatusPage`
 * may see what the public cannot (a private page, a proxy with credentials),
 * so what it read stays with that fetcher and no other install sees it.
 */
const shared: StatusCache = { answers: new Map(), resolved: new Map() };
const byFetcher = new WeakMap<(url: string) => Promise<unknown>, StatusCache>();

function cacheFor(fetchJson: ((url: string) => Promise<unknown>) | undefined): StatusCache {
  if (!fetchJson) return shared;
  let own = byFetcher.get(fetchJson);
  if (!own) {
    own = { answers: new Map(), resolved: new Map() };
    byFetcher.set(fetchJson, own);
  }
  return own;
}

/**
 * The status behind a status page URL, cached for a minute. Null when it
 * could not be read or was not a shape this understands; that is cached too,
 * so a broken URL is not fetched on every widget load.
 */
export async function readStatusPage(
  url: string,
  options: { fetchJson?: (url: string) => Promise<unknown>; now?: () => number } = {},
): Promise<PageStatus | null> {
  const now = options.now?.() ?? Date.now();
  const { answers: cache, resolved } = cacheFor(options.fetchJson);
  const hit = cache.get(url);
  if (hit && now - hit.at < STATUS_CACHE_MS) return hit.value;

  const fetchJson = options.fetchJson ?? ((target: string) => fetchPublicJson(target));
  let value: PageStatus | null = null;
  try {
    const known = resolved.get(url);
    const candidates = known
      ? [known, ...statusCandidates(url).filter((c) => c !== known)]
      : statusCandidates(url);
    for (const candidate of candidates) {
      try {
        value = parseStatusPage(await fetchJson(candidate));
      } catch {
        value = null;
      }
      if (value) {
        resolved.set(url, candidate);
        break;
      }
    }
  } catch {
    value = null;
  }

  // Bounded, oldest first: a Map iterates in insertion order, and a fresh
  // answer is re-inserted at the end.
  cache.delete(url);
  cache.set(url, { at: now, value });
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
    resolved.delete(oldest);
  }
  if (resolved.size > MAX_CACHED) resolved.clear();
  return value;
}

/** Forget cached answers, for tests and for a Settings change. */
export function clearStatusCache(): void {
  shared.answers.clear();
  shared.resolved.clear();
}

/* --------------------------------------------------------------- helpers */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A short, trimmed string, or undefined. Provider text ends up in the widget. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, 280);
  return trimmed || undefined;
}

function httpsOrNull(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}
