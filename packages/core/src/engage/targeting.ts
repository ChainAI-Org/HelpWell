/**
 * The targeting engine: does this visit qualify for this thing?
 *
 * Engagements use it today and forms are next, so nothing here knows what an
 * engagement is. Anything with `targeting`, `schedule` and `enabled` (the
 * `Targetable` shape) can be put through it:
 *
 *   const visit = visitFromQuery(url.searchParams, { contactId, identified });
 *   const eligible = await selectTargeted(db, items, visit);
 *
 * Three checks, cheapest first:
 *
 *   inSchedule(schedule, now)            pure
 *   matchesPlace(targeting, visit)       pure: pages, referrer, UTM, device, language
 *   matchesAudience(db, targeting, visit) identified or not, conditions, segment;
 *                                        reads the contact only when it has to
 *
 * Frequency is separate (`allowedByFrequency`), because what counts as having
 * seen something depends on the consumer's own history table. The "when" of
 * targeting, the trigger, runs in the browser; see rules.ts.
 */

import { contactMatches } from '../conditions/snapshot.js';
import type { ConditionGroup, EvaluateOptions } from '../conditions/types.js';
import type { Db } from '../db/client.js';
import { segmentRules } from '../segments/repo.js';
import type { Device, Frequency, Schedule, Targeting, UtmKey } from './rules.js';
import { UTM_KEYS } from './rules.js';

/** Everything the rules are checked against, for one page view. */
export interface VisitContext {
  /** The page path, e.g. `/app/settings`. */
  path: string;
  /** The URL the visit came from, or empty when there was none. */
  referrer: string;
  /** UTM values from the landing URL, lower-cased. */
  utm: Partial<Record<UtmKey, string>>;
  /** Null when the browser did not say: device rules then pass. */
  device: Device | null;
  /** A BCP 47 tag such as `en-GB`, or empty when unknown. */
  language: string;
  contactId: string | null;
  identified: boolean;
  now: Date;
}

/** What the engine needs from a record to target it. */
export interface Targetable {
  id: string;
  enabled: boolean;
  targeting: Targeting;
  schedule: Schedule;
}

/**
 * The visit as a public request describes it. The widget sends
 * `path`, `referrer`, `utm_source`..`utm_content`, `device` and `lang`;
 * anything missing is simply unknown, and unknown never fails a rule it
 * cannot answer (except a referrer or UTM rule, which needs the value).
 */
export function visitFromQuery(
  query: URLSearchParams,
  who: { contactId: string | null; identified: boolean },
  now: Date = new Date(),
): VisitContext {
  const utm: Partial<Record<UtmKey, string>> = {};
  for (const key of UTM_KEYS) {
    const value = query.get(`utm_${key}`)?.trim().slice(0, 200);
    if (value) utm[key] = value.toLowerCase();
  }
  const device = query.get('device');
  return {
    path: normalisePath(query.get('path')),
    referrer: query.get('referrer')?.trim().slice(0, 2000) ?? '',
    utm,
    device: device === 'desktop' || device === 'mobile' ? device : null,
    language: (query.get('lang') ?? '').trim().slice(0, 35),
    contactId: who.contactId,
    identified: who.identified,
    now,
  };
}

function normalisePath(value: string | null): string {
  const path = (value ?? '/').trim().slice(0, 2000);
  return path.startsWith('/') ? path : `/${path}`;
}

/* ------------------------------------------------------------- the paths */

/**
 * Path matching with one wildcard rule: `*` matches within a segment, `**`
 * matches across segments. The pattern is never treated as a regex, so a
 * config typo cannot hang the page or quietly match far more than it looks
 * like it should (WG-09).
 *
 * Metacharacters are escaped first, then runs of `*` are translated in a
 * single pass. One pass matters: escaping to a sentinel and swapping it back
 * corrupts any pattern that happens to contain the sentinel.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const source = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, (run) => (run.length > 1 ? '.*' : '[^/]*'));
  return new RegExp(`^${source}/?$`).test(path);
}

/** Include and exclude path rules. Exclude always wins; no includes means everywhere. */
export function matchesPaths(
  rules: { include?: string[]; exclude?: string[] } | undefined,
  path: string,
): boolean {
  if (!rules) return true;
  if (rules.exclude?.some((p) => pathMatches(p, path))) return false;
  if (!rules.include || rules.include.length === 0) return true;
  return rules.include.some((p) => pathMatches(p, path));
}

/* ------------------------------------------------------------ the checks */

export function inSchedule(schedule: Schedule, now: Date): boolean {
  const at = now.getTime();
  if (schedule.start && at < Date.parse(schedule.start)) return false;
  if (schedule.end && at >= Date.parse(schedule.end)) return false;
  return true;
}

/** Pages, referrer, UTM, device and language. No database. */
export function matchesPlace(targeting: Targeting, visit: VisitContext): boolean {
  if (!matchesPaths(targeting.pages, visit.path)) return false;

  const referrer = visit.referrer.toLowerCase();
  const { include, exclude } = targeting.referrer;
  if (exclude.some((part) => referrer.includes(part.toLowerCase()))) return false;
  if (include.length > 0 && !include.some((part) => referrer.includes(part.toLowerCase()))) {
    return false;
  }

  for (const key of UTM_KEYS) {
    const wanted = targeting.utm[key];
    if (wanted.length === 0) continue;
    const value = visit.utm[key];
    if (!value || !wanted.some((option) => option.toLowerCase() === value)) return false;
  }

  if (visit.device && !targeting.devices.includes(visit.device)) return false;

  if (targeting.languages.length > 0 && visit.language) {
    const language = visit.language.toLowerCase();
    const matches = targeting.languages.some((prefix) => {
      const p = prefix.toLowerCase();
      return language === p || language.startsWith(`${p}-`);
    });
    if (!matches) return false;
  }
  return true;
}

/**
 * Identified or anonymous, the contact conditions, and the segment. A
 * visitor with no contact yet is evaluated as anonymous, so rules such as
 * "identified is false" still match a first-time visitor.
 *
 * `cache` lets one request check many records without loading the same
 * segment twice.
 */
export async function matchesAudience(
  db: Db,
  targeting: Targeting,
  visit: VisitContext,
  cache: AudienceCache = new AudienceCache(),
): Promise<boolean> {
  if (targeting.audience === 'identified' && !visit.identified) return false;
  if (targeting.audience === 'anonymous' && visit.identified) return false;

  const options: EvaluateOptions = { now: visit.now };
  if (targeting.conditions) {
    const ok = await cache.matches(db, visit.contactId, targeting.conditions, options);
    if (!ok) return false;
  }
  if (targeting.segmentId) {
    const rules = await cache.segment(db, targeting.segmentId);
    // A segment that has been deleted matches nobody, rather than everybody.
    if (!rules) return false;
    if (!(await cache.matches(db, visit.contactId, rules, options))) return false;
  }
  return true;
}

/** Remembers segment rules and condition results for the life of one request. */
export class AudienceCache {
  #segments = new Map<string, Promise<ConditionGroup | null>>();
  #results = new Map<string, Promise<boolean>>();

  segment(db: Db, id: string): Promise<ConditionGroup | null> {
    let rules = this.#segments.get(id);
    if (!rules) {
      rules = segmentRules(db, id);
      this.#segments.set(id, rules);
    }
    return rules;
  }

  matches(
    db: Db,
    contactId: string | null,
    rules: ConditionGroup,
    options: EvaluateOptions,
  ): Promise<boolean> {
    const key = `${contactId ?? ''}\u0000${JSON.stringify(rules)}`;
    let result = this.#results.get(key);
    if (!result) {
      result = contactMatches(db, contactId, rules, options);
      this.#results.set(key, result);
    }
    return result;
  }
}

/**
 * Which of these records this visit qualifies for: enabled, in schedule, in
 * the right place, and for the right person. Order is kept.
 *
 * `ignorePlace` skips the pages, referrer, UTM, device and language rules,
 * for a record the page asked for by id.
 */
export async function selectTargeted<T extends Targetable>(
  db: Db,
  items: readonly T[],
  visit: VisitContext,
  options: { ignorePlace?: boolean; cache?: AudienceCache } = {},
): Promise<T[]> {
  const cache = options.cache ?? new AudienceCache();
  const out: T[] = [];
  for (const item of items) {
    if (!item.enabled || !inSchedule(item.schedule, visit.now)) continue;
    if (!options.ignorePlace && !matchesPlace(item.targeting, visit)) continue;
    if (!(await matchesAudience(db, item.targeting, visit, cache))) continue;
    out.push(item);
  }
  return out;
}

/* -------------------------------------------------------------- frequency */

/** What one person has done with one record, from whichever table records it. */
export interface Seen {
  /** `seen`, `clicked`, `dismissed`, `completed`... */
  states: Set<string>;
  /** When they last saw it, in ms since the epoch. */
  last: number;
}

/**
 * Whether the frequency rule lets it show again. Dismissing or completing
 * always ends it: nobody is asked twice for what they already answered or
 * turned down.
 */
export function allowedByFrequency(
  frequency: Frequency,
  seen: Seen | undefined,
  now: Date,
): boolean {
  if (!seen) return true;
  if (seen.states.has('dismissed') || seen.states.has('completed')) return false;
  if (frequency === 'always') return true;
  if (frequency === 'once') return !seen.states.has('seen');
  return now.getTime() - seen.last >= frequency.everyDays * 24 * 60 * 60 * 1000;
}
