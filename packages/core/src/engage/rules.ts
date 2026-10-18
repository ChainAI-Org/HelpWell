/**
 * Targeting rules: who sees something, where, when it appears, and how often.
 *
 * These are not specific to engagements. A modal, a survey and (next) a form
 * all answer the same four questions, so the shapes live here once and each
 * consumer puts them on its own record:
 *
 *   {
 *     "targeting": {
 *       "audience": "identified",
 *       "conditions": { "all": [{ "field": "plan", "op": "is", "value": "pro" }] },
 *       "segmentId": "",
 *       "pages": { "include": ["/app/**"], "exclude": ["/app/billing"] },
 *       "referrer": { "include": ["google."], "exclude": [] },
 *       "utm": { "source": ["newsletter"], "medium": [], "campaign": [] },
 *       "devices": ["desktop"],
 *       "languages": ["en"]
 *     },
 *     "triggers": [{ "type": "scroll", "percent": 60 }, { "type": "exit" }],
 *     "schedule": { "start": "2026-10-01T09:00:00.000Z", "end": null },
 *     "frequency": { "everyDays": 30 }
 *   }
 *
 * "Who" and "where" are checked on the server (targeting.ts), because the
 * conditions read the contact record. "When" is a trigger the browser arms
 * (the widget's engage/triggers.ts), because only the page knows how far it
 * has been scrolled. Every field has a default, so `{}` means everyone,
 * everywhere, on page load, once. Engagements take a list of triggers and
 * show on whichever fires first; forms take one.
 */

import { z } from 'zod';
import { parseConditions } from '../conditions/parse.js';
import { type ConditionGroup, childrenOf } from '../conditions/types.js';
import { isHelpWellError } from '../errors.js';

export const AUDIENCES = ['all', 'identified', 'anonymous'] as const;
export const DEVICES = ['desktop', 'mobile'] as const;
export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type Audience = (typeof AUDIENCES)[number];
export type Device = (typeof DEVICES)[number];
export type UtmKey = (typeof UTM_KEYS)[number];

/**
 * A list of short strings. A config file writes an array; a text box posts
 * "a, b" or one per line, and both mean the same list.
 */
function stringList(max = 50, length = 2000) {
  return z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(/[,\n]/)
            .map((part) => part.trim())
            .filter(Boolean)
        : value,
    z.array(z.string().trim().min(1).max(length)).max(max),
  );
}

/**
 * Contact conditions in the rule language segments use (conditions/). Null,
 * or an empty group, is everyone. Checked by `parseConditions`, so a rule
 * that would not evaluate is refused here with the message it would give.
 */
export const conditionsSchema = z.unknown().transform((value, ctx): ConditionGroup | null => {
  if (value === null || value === undefined || value === '') return null;
  try {
    const group = parseConditions(value);
    return childrenOf(group).length === 0 ? null : group;
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: isHelpWellError(error) ? error.publicMessage : String(error),
    });
    return z.NEVER;
  }
});

/** Glob-ish page paths: `*` within a segment, `**` across them. Exclude wins. */
export const pageRules = z.object({
  include: stringList().default(['**']),
  exclude: stringList().default([]),
});

export const targetingSchema = z.object({
  /** Signed-in people only, anonymous visitors only, or both. */
  audience: z.enum(AUDIENCES).default('all'),
  conditions: conditionsSchema.default(null),
  /** A saved segment the contact must be in. Empty: no segment rule. */
  segmentId: z.string().trim().max(80).default(''),
  pages: pageRules.default({}),
  /**
   * Where the visit came from. Each entry is matched as a substring of the
   * referring URL, so `google.` covers every Google domain. An empty include
   * list means any referrer, including none.
   */
  referrer: z
    .object({ include: stringList().default([]), exclude: stringList().default([]) })
    .default({}),
  /** UTM values from the landing URL. Each list is any-of; an empty list is ignored. */
  utm: z
    .object({
      source: stringList(20, 200).default([]),
      medium: stringList(20, 200).default([]),
      campaign: stringList(20, 200).default([]),
      term: stringList(20, 200).default([]),
      content: stringList(20, 200).default([]),
    })
    .default({}),
  devices: z.array(z.enum(DEVICES)).default(['desktop', 'mobile']),
  /** Browser language prefixes, e.g. `en` or `pt-BR`. Empty: any language. */
  languages: stringList(40, 20).default([]),
});

/* ---------------------------------------------------------------- trigger */

export const TRIGGER_TYPES = [
  'load',
  'delay',
  'scroll',
  'exit',
  'time_on_page',
  'inactivity',
  'click',
  'event',
  'manual',
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** An hour is the longest anything waits: past that, the visitor has gone. */
const seconds = (fallback: number) => z.number().int().min(0).max(3600).default(fallback);

/**
 * When, on a page that qualifies, the thing appears.
 *
 *   load          as soon as the page is ready
 *   delay         N seconds after the page loads
 *   scroll        once the visitor has scrolled `percent` of the page
 *   exit          when the pointer leaves towards the browser chrome (desktop only)
 *   time_on_page  after N seconds with the tab actually visible
 *   inactivity    after N seconds without a click, key, scroll or touch
 *   click         when something matching `selector` is clicked
 *   event         when the page calls `helpwell('track', name)`
 *   manual        only when the page calls `helpwell.engage.show(id)`
 */
export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load') }),
  z.object({ type: z.literal('delay'), seconds: seconds(5) }),
  z.object({
    type: z.literal('scroll'),
    percent: z.number().int().min(1).max(100).default(50),
  }),
  z.object({ type: z.literal('exit') }),
  z.object({ type: z.literal('time_on_page'), seconds: seconds(30) }),
  z.object({ type: z.literal('inactivity'), seconds: seconds(30) }),
  z.object({ type: z.literal('click'), selector: z.string().trim().max(500).default('') }),
  z.object({ type: z.literal('event'), name: z.string().trim().max(120).default('') }),
  z.object({ type: z.literal('manual') }),
]);

/* --------------------------------------------------------------- schedule */

/** An ISO date and time, or null; an empty box is null. Also a banner's countdown (schema.ts). */
export const instantSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a date and time')
    .nullable(),
);

/** Showing from `start` until `end`, both optional ISO timestamps. */
export const scheduleSchema = z.object({
  start: instantSchema.default(null),
  end: instantSchema.default(null),
});

/* -------------------------------------------------------------- frequency */

/**
 * Show at most once per person, every time the rules match, or again after
 * N days. Dismissing or completing always ends it, whatever this says.
 */
export const frequencySchema = z.union([
  z.literal('once'),
  z.literal('always'),
  z.object({ everyDays: z.number().int().min(1).max(365) }),
]);

export type Targeting = z.infer<typeof targetingSchema>;
export type Trigger = z.infer<typeof triggerSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Frequency = z.infer<typeof frequencySchema>;
