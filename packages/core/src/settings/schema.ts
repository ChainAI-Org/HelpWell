/**
 * Settings.
 *
 * `helpwell/helpwell.config.json` in the customer's repo is the source of
 * truth; `helpwell sync` pushes it to the database and the dashboard edits the
 * database copy (DX-06). This file is the shape both sides agree on, with
 * defaults that make a fresh install work before anybody opens Settings.
 *
 * Two rules hold this together:
 *   1. every field has a default, so a half-written file still boots;
 *   2. nothing here sends email — open source has no transport (see the PRD
 *      principle). `supportEmail` is only ever shown, as a mailto link.
 */

import { z } from 'zod';
import { engagementSchema as engagement, engageSettings } from '../engage/schema.js';

const urlPattern = z.string().min(1);

/**
 * A list the dashboard sends as one string. Its text inputs post "a, b, c"
 * (or one item per line) for an array field; the split happens here so the
 * same schema validates a config file and a form.
 */
function listOf<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(/[,\n]/)
            .map((part) => part.trim())
            .filter(Boolean)
        : value,
    z.array(item),
  );
}

/** A CSS hex colour. It is interpolated into stylesheets, so nothing else will do. */
const hexColour = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex colour such as #7A3BEB');

/**
 * A font family name. It lands inside a <style> block on the help centre and
 * in the widget, so the characters that could break out of one are dropped.
 */
const fontName = z.string().transform((value) => value.replace(/[<>"']/g, '').trim());

export const themeSetting = z.enum(['light', 'dark', 'system']);

/* ------------------------------------------------------------------ product */

export const productSettings = z.object({
  name: z.string().default('Your product'),
  appUrl: z.string().default(''),
  /**
   * Where visitors can write when the agent cannot help: a `mailto:` link
   * under an unresolved answer and on the widget's Home, and "Contact
   * support" in the help centre. Never sent from, and not shown when a
   * support extension handles human replies (settings/support-email.ts).
   */
  supportEmail: z.string().default(''),
  timezone: z.string().default('UTC'),
  locale: z.string().default('en'),
});

/* -------------------------------------------------------------- help center */

export const helpCenterTheme = z.object({
  /** ground colour, or 'dark' to use the charcoal set */
  background: z.string().default('#F3F1F9'),
  accent: hexColour.default('#7A3BEB'),
  hero: z.enum(['glow', 'flat', 'brand']).default('glow'),
  /** collection cards carry the tinted under card with count + last updated */
  underCards: z.boolean().default(true),
  tints: z.array(z.string()).default(['lavender', 'peach', 'butter', 'mint']),
  headlineFont: fontName.default('Bricolage Grotesque'),
  bodyFont: fontName.default('Plus Jakarta Sans'),
  defaultTheme: themeSetting.default('system'),
  logoUrl: z.string().nullable().default(null),
  /** Shown instead of `logoUrl` in the dark scheme, when set (a light logo on a dark ground). */
  logoDarkUrl: z.string().nullable().default(null),
  faviconUrl: z.string().nullable().default(null),
});

export const helpCenterSettings = z.object({
  /** help.yourapp.com, or empty to serve from the subpath */
  domain: z.string().default(''),
  subpath: z.string().default('/help'),
  theme: helpCenterTheme.default({}),
  search: z.boolean().default(true),
  askAgent: z.boolean().default(true),
  ratings: z.boolean().default(true),
  readingTime: z.boolean().default(true),
  /** "Powered by HelpWell" in the footer. Yours to switch off. */
  poweredBy: z.boolean().default(true),
  sitemap: z.boolean().default(true),
  llmsTxt: z.boolean().default(true),
});

/* -------------------------------------------------------------------- agent */

export const agentTools = z.object({
  searchDocs: z.boolean().default(true),
  readChangelog: z.boolean().default(true),
  /** read-only, from the identify call; never asks for what the app already knows */
  lookUpUser: z.boolean().default(true),
  /** only fires when the visitor is unidentified */
  collectEmail: z.boolean().default(true),
  markUnresolved: z.boolean().default(true),
  suggestArticle: z.boolean().default(true),
});

/**
 * OpenRouter model ids. The defaults are current models OpenRouter serves
 * (checked September 2026): a strong writer for answers and docs, a fast and
 * cheap one from another provider as the fallback, so one provider's outage
 * does not take both down. The dashboard's model picker lists the live
 * catalogue, so these only matter until somebody picks.
 */
export const agentModels = z.object({
  chat: z.string().default('anthropic/claude-sonnet-5'),
  docs: z.string().default('anthropic/claude-sonnet-5'),
  /** Empty switches the semantic search pass off. */
  embeddings: z.string().default('openai/text-embedding-3-small'),
  fallback: z.string().default('google/gemini-3.5-flash'),
});

/** AG-20. Defaults ship on: a runaway loop should cost lunch, not a month. */
export const spendCaps = z.object({
  dailyCapUsd: z.number().nonnegative().default(15),
  warnAtPct: z.number().min(1).max(100).default(80),
  messagesPerConversation: z.number().int().positive().default(40),
  messagesPerVisitorPerHour: z.number().int().positive().default(20),
  maxMessageLength: z.number().int().positive().default(2000),
});

/** AG-21. The honeypot and origin checks are always on and not listed here. */
export const abuseSettings = z.object({
  signedInOnly: z.boolean().default(false),
  botCheck: z.enum(['off', 'turnstile']).default('off'),
  turnstileSiteKey: z.string().default(''),
  throttleRepeats: z.boolean().default(true),
  blockedDomains: listOf(z.string()).default([]),
  /** Exact addresses, dotted prefixes or IPv4 CIDR ranges; IPv6 exact only. */
  blockedIps: listOf(z.string()).default([]),
  blockDisposableEmail: z.boolean().default(true),
});

export const agentSettings = z.object({
  name: z.string().default('Fern'),
  avatarUrl: z.string().nullable().default(null),
  tone: z.string().default('Warm, brief, no exclamation marks'),
  introduceAsAi: z.boolean().default(true),
  models: agentModels.default({}),
  tools: agentTools.default({}),
  spend: spendCaps.default({}),
  abuse: abuseSettings.default({}),
});

/* ------------------------------------------------------------------- widget */

export const displayRules = z.object({
  /** glob or regex patterns; exclude always wins over include */
  include: listOf(urlPattern).default(['**']),
  exclude: listOf(urlPattern).default([]),
  /** all | identified | anonymous */
  audience: z.enum(['all', 'identified', 'anonymous']).default('all'),
  devices: z.array(z.enum(['desktop', 'mobile'])).default(['desktop', 'mobile']),
});

export const widgetAppearance = z.object({
  theme: themeSetting.default('system'),
  accent: hexColour.default('#7A3BEB'),
  bubbleStyle: z.enum(['rounded', 'soft', 'square']).default('rounded'),
  pattern: z
    .enum(['none', 'dots', 'grid', 'waves', 'diagonal', 'noise', 'confetti', 'image'])
    .default('dots'),
  patternImageUrl: z.string().nullable().default(null),
  font: fontName.default('Plus Jakarta Sans'),
  radius: z.number().int().min(0).max(32).default(24),
  launcherIconUrl: z.string().nullable().default(null),
});

export const preChatSettings = z.object({
  /** identified visitors are never asked, whatever this says */
  when: z.enum(['never', 'unknown_only']).default('unknown_only'),
  /** ask before the chat starts, or after the first message */
  timing: z.enum(['before', 'after']).default('before'),
  fields: z.array(z.enum(['email', 'name'])).default(['email', 'name']),
  requireEmail: z.boolean().default(true),
  consentLine: z.string().default('We use it for this conversation and nothing else.'),
});

export const widgetTabs = z.object({
  home: z.boolean().default(true),
  messages: z.boolean().default(true),
  help: z.boolean().default(true),
  updates: z.boolean().default(true),
  roadmap: z.boolean().default(true),
});

/** A link on the Home tab. `icon` is one of the widget's icon names, e.g. `article`. */
export const homeLink = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
  icon: z.string().default(''),
});

/**
 * One block on the widget's Home tab, drawn in the order listed. `form` is
 * rendered by whatever registered a renderer for it; a type the widget does
 * not know is skipped there, and dropped here, so a config written for a
 * newer version still loads.
 */
export const homeBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('search') }),
  /** "Your conversation": only drawn while one is open. */
  z.object({ type: z.literal('conversation') }),
  z.object({ type: z.literal('newConversation') }),
  z.object({
    type: z.literal('articles'),
    title: z.string().default('Popular articles'),
    /** A collection id, or empty to use `slugs`. */
    collection: z.string().default(''),
    slugs: listOf(z.string()).default([]),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  z.object({
    type: z.literal('updates'),
    title: z.string().default("What's new"),
    count: z.number().int().min(1).max(10).default(3),
  }),
  z.object({ type: z.literal('status') }),
  z.object({
    type: z.literal('links'),
    title: z.string().default(''),
    items: z.array(homeLink).max(12).default([]),
  }),
  z.object({
    type: z.literal('card'),
    title: z.string().default(''),
    /** Markdown. */
    body: z.string().default(''),
    /** An https URL. */
    image: z.string().default(''),
    cta: z.object({ label: z.string().default(''), url: z.string().default('') }).default({}),
  }),
  z.object({ type: z.literal('form'), formId: z.string().default('') }),
]);

const HOME_BLOCK_TYPES = new Set([
  'search',
  'conversation',
  'newConversation',
  'articles',
  'updates',
  'status',
  'links',
  'card',
  'form',
]);

/** What the Home tab showed before blocks existed, in the same order. */
export const DEFAULT_HOME_BLOCKS = [
  { type: 'search' },
  { type: 'conversation' },
  { type: 'newConversation' },
  { type: 'updates', title: "What's new", count: 3 },
  { type: 'status' },
] as const;

export const widgetHome = z.object({
  blocks: z
    .preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter(
              (block) =>
                block &&
                typeof block === 'object' &&
                HOME_BLOCK_TYPES.has(String((block as { type?: unknown }).type)),
            )
          : value,
      z.array(homeBlock).max(20),
    )
    .default(DEFAULT_HOME_BLOCKS.map((block) => ({ ...block }))),
});

/**
 * Media in messages and articles. YouTube, Vimeo, Loom and Wistia links show
 * as cards that open the player; with `inlineVideo` they play in the panel
 * instead, loading nothing from the provider until the visitor clicks. The
 * host page's CSP then has to allow the players in `frame-src`.
 */
export const widgetMedia = z.object({
  inlineVideo: z.boolean().default(false),
});

export const statusLevel = z.enum([
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
]);

/**
 * WG-11. `auto` reads `statusUrl` (Atlassian Statuspage, Instatus or Better
 * Stack); `manual` shows `level` and `message` as set here, whatever the
 * status page says.
 */
export const widgetStatus = z.object({
  mode: z.enum(['auto', 'manual']).default('auto'),
  level: statusLevel.default('operational'),
  message: z.string().max(280).default(''),
});

/**
 * The words at the top of the Home screen. Both are optional: empty means
 * unset, and the widget says what it always has: "Hi there" (or "Hi Ada" for a
 * visitor the host app identified by first name) over "How can we help with
 * {product}?". When set, `{{ product.name }}` is the product's name and
 * `{{ contact.first_name }}` is the visitor's first name, or "there" when the
 * host app has not said (`{{ contact.first_name | default: "friend" }}` picks
 * another word). The original `{product}` and `{first_name}` still work.
 */
export const widgetGreeting = z.object({
  title: z.string().trim().max(80).default(''),
  subtitle: z.string().trim().max(160).default(''),
});

export const widgetSettings = z.object({
  /** `draggable` starts bottom right, and each visitor can move it anywhere; it stays where they put it. */
  position: z.enum(['bottom-right', 'bottom-left', 'draggable']).default('bottom-right'),
  offset: z.object({ x: z.number().default(24), y: z.number().default(24) }).default({}),
  zIndex: z.number().int().default(2_147_483_000),
  /** The Home screen's own greeting; unset keeps the built-in words. */
  greeting: widgetGreeting.default({}),
  tabs: widgetTabs.default({}),
  appearance: widgetAppearance.default({}),
  displayRules: displayRules.default({}),
  preChat: preChatSettings.default({}),
  /** WG-11: pulled from a status page, or set by hand from the dashboard */
  statusUrl: z.string().default(''),
  home: widgetHome.default({}),
  media: widgetMedia.default({}),
  status: widgetStatus.default({}),
});

/* ---------------------------------------------------------------- changelog */

export const roadmapSettings = z.object({
  enabled: z.boolean().default(true),
  whoCanSubmit: z.enum(['identified', 'anyone']).default('identified'),
  statuses: z.array(z.string()).default(['under_review', 'planned', 'in_progress', 'shipped']),
});

export const changelogSettings = z.object({
  /**
   * Where `helpwell changelog` drafts from: github_releases (the notes on a
   * release), tags (commits since the previous tag), commits (commits since
   * the last published entry) or manual (nothing). Unset, it is detected on
   * each run: github_releases when `repo` is set or the origin remote is on
   * github.com, otherwise tags, and tags too while that repository has no
   * release. `helpwell init` writes what it found. An empty string or null,
   * which is how the dashboard clears it, means unset.
   */
  source: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.enum(['github_releases', 'tags', 'commits', 'manual']).optional(),
  ),
  repo: z.string().default(''),
  groupBy: z.enum(['version', 'date']).default('version'),
  categories: listOf(z.string()).default(['New', 'Improved', 'Fixed']),
  publicPage: z.boolean().default(true),
  widgetTab: z.boolean().default(true),
  /** CL-07 default surface for in-app notification */
  notification: z.enum(['badge', 'drawer', 'modal', 'popup', 'embed', 'none']).default('badge'),
  pageSize: z.number().int().min(1).max(50).default(10),
  roadmap: roadmapSettings.default({}),
});

/* ------------------------------------------------------------------ engage */

export { frequencySchema as engageFrequency } from '../engage/rules.js';
// Modals, banners, hotspots, tours and surveys, with their targeting rules,
// are big enough to be their own module; see engage/schema.ts and
// engage/rules.ts. First-version definitions are upgraded on read there.
export { engagement, engageSettings };

/* --------------------------------------------------------------------- data */

/**
 * There is no telemetry setting because there is no telemetry: open source
 * never phones home. A `telemetry` key in an older config file is dropped on
 * read, like any other unknown key.
 */
export const dataSettings = z.object({
  /** 0 keeps conversations forever; contacts are never auto-deleted */
  retentionMonths: z.number().int().min(0).default(12),
});

export const webhookSettings = z.object({
  url: z.string(),
  events: z.array(z.string()).default([]),
  secret: z.string().default(''),
  active: z.boolean().default(true),
});

/* ------------------------------------------------------------------- whole */

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  product: productSettings.default({}),
  helpCenter: helpCenterSettings.default({}),
  agent: agentSettings.default({}),
  widget: widgetSettings.default({}),
  changelog: changelogSettings.default({}),
  engage: engageSettings.default({}),
  data: dataSettings.default({}),
  webhooks: z.array(webhookSettings).default([]),
});

export type Settings = z.infer<typeof settingsSchema>;
export type AgentSettings = z.infer<typeof agentSettings>;
export type WidgetSettings = z.infer<typeof widgetSettings>;
export type HelpCenterSettings = z.infer<typeof helpCenterSettings>;
export type ChangelogSettings = z.infer<typeof changelogSettings>;
export type EngageSettings = z.infer<typeof engageSettings>;
export type Engagement = z.infer<typeof engagement>;
export type SpendCaps = z.infer<typeof spendCaps>;
export type DisplayRules = z.infer<typeof displayRules>;
export type PreChatSettings = z.infer<typeof preChatSettings>;
export type HomeBlock = z.infer<typeof homeBlock>;
export type StatusLevel = z.infer<typeof statusLevel>;
export type WidgetStatusSettings = z.infer<typeof widgetStatus>;

/** Defaults for a fresh install, with nothing configured. */
export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/**
 * Parse a settings file. Unknown keys are dropped and missing ones filled, so
 * an older or hand-edited file keeps working after an upgrade.
 */
export function parseSettings(input: unknown): Settings {
  return settingsSchema.parse(input ?? {});
}

/** Deep merge a partial update onto existing settings, then re-validate. */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  return settingsSchema.parse(deepMerge(current as Record<string, unknown>, patch));
}

function deepMerge(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const existing = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMerge(existing as Record<string, unknown>, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
