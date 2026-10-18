/**
 * What an engagement is: a modal, banner, hotspot, tour or survey, as JSON.
 *
 * Definitions live in settings, so they are reviewed like code: the repo file
 * a coding agent edits, the dashboard editor and the admin API all produce
 * this shape, and `helpwell sync` refuses one that does not parse.
 *
 * Every message box is a list of blocks (text, image, GIF, video, buttons,
 * divider), so any of the five can carry media. Each kind keeps its own
 * options under its own key (`modal`, `banner`, `hotspot`, `tour`, `survey`)
 * next to the targeting rules they all share (rules.ts).
 *
 * The first version stored `title`, `body` and `cta` on every kind, plus
 * `paths`, `audience` and `delayMs`, and later versions one `trigger` where
 * there is now a list of them. Those are upgraded here, on read, so a config
 * written for them keeps working untouched and is saved in this shape the
 * next time anything writes settings.
 *
 * This schema checks shape: types, enums, lengths. Whether a definition is
 * complete (a button has a link, a branch goes somewhere real) is check.ts,
 * which the editor runs before saving. Keeping the two apart means a stored
 * definition can never make the settings document unreadable.
 *
 * Chat messages are deliberately not engagements: they need a sender, which
 * the open source build does not have. A support extension can send them
 * (api/proactive.ts), in the same block format, with `chatBlockSchema`.
 */

import { z } from 'zod';
import {
  frequencySchema,
  instantSchema,
  scheduleSchema,
  type Targeting,
  targetingSchema,
  triggerSchema,
} from './rules.js';

export const ENGAGEMENT_KINDS = ['modal', 'banner', 'hotspot', 'tour', 'survey'] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

/** Longest Markdown one text block holds. */
export const MAX_TEXT = 10_000;

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex colour such as #7A3BEB');
const url = z.string().trim().max(2000);

/* ----------------------------------------------------------------- blocks */

/**
 * What a button does.
 *
 *   url      go to `value` (a link or a path on your site)
 *   dismiss  close it, recorded as dismissed
 *   next     the next slide of a modal, or the next step of a tour
 *   tour     start the tour whose id is `value`
 *   chat     open the support chat
 *   article  open the article whose slug is `value` in the widget
 */
export const BUTTON_ACTIONS = ['url', 'dismiss', 'next', 'tour', 'chat', 'article'] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export const buttonSchema = z.object({
  label: z.string().trim().max(60).default(''),
  action: z.enum(BUTTON_ACTIONS).default('url'),
  value: z.string().trim().max(2000).default(''),
  style: z.enum(['primary', 'secondary']).default('primary'),
  /** Links only: open in a new tab rather than this one. */
  newTab: z.boolean().default(false),
});

export const textBlock = z.object({
  type: z.literal('text'),
  /** Markdown, rendered by the same safe renderer as articles. */
  markdown: z.string().max(MAX_TEXT).default(''),
});

export const imageBlock = z.object({
  type: z.literal('image'),
  /** An https:// URL, or an uploaded file's path. */
  url: url.default(''),
  alt: z.string().trim().max(300).default(''),
  /** Where clicking the image goes. Empty: nowhere. */
  link: url.default(''),
});

/** A GIF is an image that moves; kept apart so reduced-motion can hold it still. */
export const gifBlock = z.object({
  type: z.literal('gif'),
  url: url.default(''),
  alt: z.string().trim().max(300).default(''),
});

/**
 * YouTube, Vimeo, Loom, Wistia, or an mp4/webm file. Always click to load:
 * nothing from a video host is fetched until the visitor asks for it.
 */
export const videoBlock = z.object({
  type: z.literal('video'),
  url: url.default(''),
  title: z.string().trim().max(200).default(''),
});

/** One or two calls to action, side by side. */
export const buttonsBlock = z.object({
  type: z.literal('buttons'),
  buttons: z.array(buttonSchema).max(2).default([]),
});

export const dividerBlock = z.object({ type: z.literal('divider') });

export const blockSchema = z.discriminatedUnion('type', [
  textBlock,
  imageBlock,
  gifBlock,
  videoBlock,
  buttonsBlock,
  dividerBlock,
]);

export const BLOCK_TYPES = ['text', 'image', 'gif', 'video', 'buttons', 'divider'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const blocksSchema = z.array(blockSchema).max(20);

/**
 * What a button in a proactive chat message can do. Slides and steps mean
 * nothing in a chat bubble, so `next` is not here; `reply` is only here:
 *
 *   reply    send `value` (or, when it is empty, the label) as the visitor's
 *            reply, which starts the conversation: a quick reply
 */
export const CHAT_BUTTON_ACTIONS = ['url', 'dismiss', 'chat', 'article', 'tour', 'reply'] as const;
export type ChatButtonAction = (typeof CHAT_BUTTON_ACTIONS)[number];

export const chatButtonSchema = buttonSchema.extend({
  action: z.enum(CHAT_BUTTON_ACTIONS).default('url'),
});

/** A chat message's blocks: the engagement blocks, with chat's own button actions. */
export const chatBlockSchema = z.discriminatedUnion('type', [
  textBlock,
  imageBlock,
  gifBlock,
  videoBlock,
  z.object({
    type: z.literal('buttons'),
    buttons: z.array(chatButtonSchema).max(3).default([]),
  }),
  dividerBlock,
]);

export type ChatBlock = z.infer<typeof chatBlockSchema>;

/* -------------------------------------------------------------- the kinds */

const PLACEMENTS = ['auto', 'top', 'right', 'bottom', 'left'] as const;
/** A tour step's placement: `tour` follows the tour's own, or it picks its own. */
const STEP_PLACEMENTS = ['tour', ...PLACEMENTS] as const;

/** The most triggers one engagement takes. */
export const MAX_TRIGGERS = 5;

/**
 * When it appears, on a page that qualifies: whichever of these happens
 * first. Older definitions had one `trigger`, which is read as a list of one.
 */
export const triggersSchema = z
  .array(triggerSchema)
  .min(1)
  .max(MAX_TRIGGERS)
  .default([{ type: 'load' }]);

/** What every kind shares. */
const base = {
  /** Stable, and part of every impression and survey answer recorded for it. */
  id: z.string().trim().min(1).max(80),
  /** For the dashboard list. Visitors never see it. */
  name: z.string().trim().max(120).default(''),
  enabled: z.boolean().default(true),
  targeting: targetingSchema.default({}),
  triggers: triggersSchema,
  schedule: scheduleSchema.default({}),
  frequency: frequencySchema.default('once'),
  /** Higher goes first when several qualify at once, and wins under the global cap. */
  priority: z.number().int().min(0).max(100).default(0),
  /** Whether the visitor may close it without doing what it asks. */
  dismissible: z.boolean().default(true),
};

export const slideSchema = z.object({ blocks: blocksSchema.default([]) });

export const modalEngagement = z.object({
  ...base,
  kind: z.literal('modal'),
  modal: z
    .object({
      size: z.enum(['small', 'medium', 'large', 'full']).default('medium'),
      /** Where a slide's first image, GIF or video goes: above the text, beside it, or behind it. */
      mediaPosition: z.enum(['top', 'side', 'background']).default('top'),
      /** How a carousel shows where the visitor is: dots, a bar, or "2 of 4". */
      progress: z.enum(['dots', 'bar', 'count']).default('dots'),
      /** One slide is a plain modal; more is a carousel with dots, next and back. */
      slides: z
        .array(slideSchema)
        .min(1)
        .max(10)
        .default([{ blocks: [] }]),
    })
    .default({}),
});

export const bannerEngagement = z.object({
  ...base,
  kind: z.literal('banner'),
  banner: z
    .object({
      position: z.enum(['top', 'bottom']).default('top'),
      /** `inline` pushes the page down (or up); `floating` sits over it. */
      style: z.enum(['inline', 'floating']).default('inline'),
      tone: z.enum(['accent', 'neutral', 'warning', 'custom']).default('accent'),
      /** `custom` tone only. */
      background: hex.default('#7A3BEB'),
      color: hex.default('#FFFFFF'),
      /**
       * Stays in view while the page scrolls. Off, a top banner scrolls away
       * with the top of the page, and a bottom one waits at the end of it.
       */
      sticky: z.boolean().default(true),
      /**
       * A countdown to `until` after the text ("2d 04h 12m"). Null: none.
       * When it reaches zero the banner goes (`hide`), or stays at zero.
       */
      countdown: z
        .object({
          until: instantSchema.default(null),
          onEnd: z.enum(['hide', 'keep']).default('hide'),
        })
        .default({}),
      blocks: blocksSchema.default([]),
    })
    .default({}),
});

export const hotspotEngagement = z.object({
  ...base,
  kind: z.literal('hotspot'),
  hotspot: z
    .object({
      /** A CSS selector for the element the beacon pulses on. */
      target: z.string().trim().max(500).default(''),
      placement: z.enum(PLACEMENTS).default('auto'),
      /** A pulsing ring, a still dot, or a question-mark badge. */
      beacon: z.enum(['pulse', 'dot', 'question']).default('pulse'),
      blocks: blocksSchema.default([]),
    })
    .default({}),
});

export const tourStepSchema = z.object({
  /** A CSS selector. Empty: a centred card with nothing highlighted. */
  target: z.string().trim().max(500).default(''),
  /** Where this step's tooltip sits. `tour`: wherever the tour's `placement` puts it. */
  placement: z.enum(STEP_PLACEMENTS).default('tour'),
  /**
   * The page this step belongs to, as a path pattern. Empty: any page. A
   * resumed tour waits on other pages instead of skipping the step.
   */
  page: z.string().trim().max(2000).default(''),
  /**
   * What moves the tour on: its Next button, a click on the target (the
   * step shows no Next), or arriving at a page matching `url`, which is what
   * carries a tour across pages.
   */
  advance: z.enum(['next', 'click', 'url']).default('next'),
  url: z.string().trim().max(2000).default(''),
  blocks: blocksSchema.default([]),
});

export const tourEngagement = z.object({
  ...base,
  kind: z.literal('tour'),
  tour: z
    .object({
      steps: z.array(tourStepSchema).max(30).default([]),
      /** Where the tooltips sit, unless a step picks its own. */
      placement: z.enum(PLACEMENTS).default('auto'),
      /** Dim the page around the highlighted element. */
      spotlight: z.boolean().default(true),
      /** "2 of 5" on every step. */
      showProgress: z.boolean().default(true),
      /** A "Skip tour" link on every step. */
      allowSkip: z.boolean().default(true),
      /** When a step's element is not on the page: wait this long, then skip it or stop. */
      missingTarget: z
        .object({
          waitSeconds: z.number().int().min(0).max(60).default(5),
          action: z.enum(['skip', 'stop']).default('skip'),
        })
        .default({}),
    })
    .default({}),
});

export const QUESTION_KINDS = ['nps', 'csat', 'stars', 'single', 'multi', 'text'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** The score range each scale question takes. */
export const SCALES: Readonly<Partial<Record<QuestionKind, [number, number]>>> = {
  nps: [0, 10],
  csat: [1, 5],
  stars: [1, 5],
};

/** A score low enough that the detractor follow-up applies. */
export function isDetractor(kind: QuestionKind, score: number): boolean {
  if (kind === 'nps') return score <= 6;
  if (kind === 'csat' || kind === 'stars') return score <= 2;
  return false;
}

/**
 * A branch: when the answer matches, go to question `goto` (or `end`).
 * Choice questions match on `choices` (any of them); scale questions on
 * `min`..`max`, inclusive. The first branch that matches wins; with none,
 * the survey goes to `next`, else the following question.
 */
export const branchSchema = z.object({
  choices: z.array(z.string().max(200)).max(20).default([]),
  min: z.number().int().nullable().default(null),
  max: z.number().int().nullable().default(null),
  goto: z.string().trim().max(40).default('end'),
});

export const questionSchema = z.object({
  /** Stable: answers are stored against it. Letters, digits, `-` and `_`. */
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use up to 40 letters, digits, dashes or underscores'),
  kind: z.enum(QUESTION_KINDS).default('nps'),
  prompt: z.string().trim().max(500).default(''),
  /** Single and multiple choice only. */
  choices: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  /** Unanswered, the visitor cannot move on; otherwise they may skip it. */
  required: z.boolean().default(true),
  /** Free text only. */
  placeholder: z.string().trim().max(200).default(''),
  /** Scales only: the words under each end. Empty uses the defaults. */
  lowLabel: z.string().trim().max(60).default(''),
  highLabel: z.string().trim().max(60).default(''),
  /** A comment box after the score: for detractors only, or for everyone. */
  followUp: z
    .object({
      enabled: z.boolean().default(false),
      prompt: z.string().trim().max(300).default('What made you choose that?'),
      when: z.enum(['detractors', 'always']).default('detractors'),
    })
    .default({}),
  branches: z.array(branchSchema).max(20).default([]),
  /** Where to go when no branch matches: a question id, `end`, or empty for the next one. */
  next: z.string().trim().max(40).default(''),
});

export const surveyEngagement = z.object({
  ...base,
  kind: z.literal('survey'),
  survey: z
    .object({
      /** `corner`: a card in the corner; `center`: a dialog over the page; `bar`: a strip along the bottom. */
      placement: z.enum(['corner', 'center', 'bar']).default('corner'),
      /** `brand`: white, with your accent colour; `light`: white and grey only; `dark`. */
      theme: z.enum(['brand', 'light', 'dark']).default('brand'),
      intro: blocksSchema.default([]),
      questions: z.array(questionSchema).max(20).default([]),
      thankYou: blocksSchema.default([{ type: 'text', markdown: 'Thank you.' }]),
    })
    .default({}),
});

/**
 * One engagement, in any version of the format: an older definition is
 * upgraded before it is checked (see `upgradeEngagement`).
 */
export const engagementSchema = z.preprocess(
  upgradeEngagement,
  z.discriminatedUnion('kind', [
    modalEngagement,
    bannerEngagement,
    hotspotEngagement,
    tourEngagement,
    surveyEngagement,
  ]),
);

/**
 * The global cap, counted across every modal, banner, tour and survey a
 * person is shown (hotspots are part of the page, and do not count). Zero
 * switches that limit off. Enforced on the server when something is about to
 * be shown, against the impressions table.
 */
export const engageLimits = z.object({
  perSession: z.number().int().min(0).max(100).default(0),
  perDay: z.number().int().min(0).max(100).default(0),
  minMinutesBetween: z.number().int().min(0).max(10_080).default(0),
});

export const engageSettings = z.object({
  enabled: z.boolean().default(true),
  limits: engageLimits.default({}),
  engagements: z.array(engagementSchema).default([]),
});

export type Button = z.infer<typeof buttonSchema>;
export type ChatButton = z.infer<typeof chatButtonSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type TourStep = z.infer<typeof tourStepSchema>;
export type SurveyQuestion = z.infer<typeof questionSchema>;
export type SurveyBranch = z.infer<typeof branchSchema>;
export type ModalEngagement = z.infer<typeof modalEngagement>;
export type BannerEngagement = z.infer<typeof bannerEngagement>;
export type HotspotEngagement = z.infer<typeof hotspotEngagement>;
export type TourEngagement = z.infer<typeof tourEngagement>;
export type SurveyEngagement = z.infer<typeof surveyEngagement>;
export type Engagement = z.infer<typeof engagementSchema>;
export type EngageLimits = z.infer<typeof engageLimits>;
export type EngageSettings = z.infer<typeof engageSettings>;

/** Parse one definition, throwing zod's error on a bad one. */
export function parseEngagement(input: unknown): Engagement {
  return engagementSchema.parse(input);
}

/** The kinds that interrupt, and so count towards the global cap. */
export function countsTowardsLimits(kind: EngagementKind): boolean {
  return kind !== 'hotspot';
}

/** A banner whose countdown has run out, and which goes when it does: nothing left to show. */
export function countdownOver(engagement: Engagement, now: Date): boolean {
  if (engagement.kind !== 'banner') return false;
  const { until, onEnd } = engagement.banner.countdown;
  return onEnd === 'hide' && until !== null && Date.parse(until) <= now.getTime();
}

/* --------------------------------------------------------- the upgrade */

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Turn a first-version definition into this one. Idempotent, total, and a
 * no-op on anything already in the new shape: it never throws, and whatever
 * it produces parses, because a stored definition that failed here would
 * take every other setting down with it.
 */
export function upgradeEngagement(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const raw: Loose = { ...input };

  if (raw.targeting === undefined && (raw.paths !== undefined || raw.audience !== undefined)) {
    const targeting: Partial<Record<keyof Targeting, unknown>> = {};
    if (isRecord(raw.paths)) targeting.pages = raw.paths;
    if (typeof raw.audience === 'string') targeting.audience = raw.audience;
    raw.targeting = targeting;
  }
  if (raw.trigger === undefined && typeof raw.delayMs === 'number') {
    const seconds = Math.min(3600, Math.max(0, Math.round(raw.delayMs / 1000)));
    raw.trigger = seconds > 0 ? { type: 'delay', seconds } : { type: 'load' };
  }
  // One trigger became a list of them; a list, when there is one, wins.
  if (Array.isArray(raw.triggers) && raw.triggers.length === 0) delete raw.triggers;
  if (raw.triggers === undefined && raw.trigger !== undefined) raw.triggers = [raw.trigger];
  delete raw.trigger;
  if (raw.name === undefined && typeof raw.title === 'string') raw.name = text(raw.title, 120);

  switch (raw.kind) {
    case 'modal':
      if (!isRecord(raw.modal)) {
        raw.modal = { slides: [{ blocks: legacyBlocks(raw, 'heading') }] };
      }
      break;
    case 'banner':
      if (!isRecord(raw.banner)) raw.banner = { blocks: legacyBlocks(raw, 'inline') };
      break;
    case 'hotspot':
      if (!isRecord(raw.hotspot)) {
        raw.hotspot = { target: text(raw.target, 500), blocks: legacyBlocks(raw, 'bold') };
      }
      break;
    case 'tour':
      if (!isRecord(raw.tour)) {
        const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, 30) : [];
        raw.tour = { steps: steps.map(legacyStep) };
      }
      break;
    case 'survey':
      if (!isRecord(raw.survey) || !Array.isArray(raw.survey.questions)) {
        // The first version's keys (type, question...) are dropped by the
        // schema once the question is built from them; anything newer stays.
        const survey = isRecord(raw.survey) ? raw.survey : {};
        raw.survey = { ...survey, ...legacySurvey(survey) };
      }
      break;
  }
  return raw;
}

/** `title`, `body` and `cta` as blocks, styled for where they will sit. */
function legacyBlocks(raw: Loose, style: 'heading' | 'inline' | 'bold'): Loose[] {
  const title = text(raw.title, 500);
  const body = text(raw.body);
  const blocks: Loose[] = [];
  const markdown =
    style === 'heading'
      ? [title ? `## ${title}` : '', body].filter(Boolean).join('\n\n')
      : style === 'inline'
        ? [title ? `**${title}**` : '', body].filter(Boolean).join(' ')
        : [title ? `**${title}**` : '', body].filter(Boolean).join('\n\n');
  if (markdown) blocks.push({ type: 'text', markdown: markdown.slice(0, MAX_TEXT) });

  const cta = isRecord(raw.cta) ? raw.cta : null;
  const label = text(cta?.label, 60);
  if (label) blocks.push({ type: 'buttons', buttons: [{ label, ...legacyAction(cta?.url) }] });
  return blocks;
}

/** The first version's `helpwell:` link scheme, as a button action. */
function legacyAction(value: unknown): Loose {
  const link = text(value, 2000);
  if (link.startsWith('helpwell:open')) return { action: 'chat', value: '' };
  if (link.startsWith('helpwell:article/')) {
    return { action: 'article', value: link.slice('helpwell:article/'.length) };
  }
  // The first version opened every link in a new tab, and treated anything
  // that was not http(s) or a path as no link at all.
  const safe = /^https?:\/\//i.test(link) || (link.startsWith('/') && !link.startsWith('//'));
  return { action: 'url', value: safe ? link : '', newTab: true };
}

function legacyStep(step: unknown): Loose {
  const raw = isRecord(step) ? step : {};
  const placement = (STEP_PLACEMENTS as readonly string[]).includes(String(raw.placement))
    ? raw.placement
    : 'tour';
  if (Array.isArray(raw.blocks)) return { ...raw, placement };
  return { target: text(raw.target, 500), placement, blocks: legacyBlocks(raw, 'bold') };
}

function legacySurvey(survey: Loose): Loose {
  const kind = ['nps', 'csat', 'single'].includes(String(survey.type)) ? survey.type : 'nps';
  const followUp = text(survey.followUp, 300);
  const choices = Array.isArray(survey.choices)
    ? survey.choices
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim().slice(0, 200))
        .slice(0, 20)
    : [];
  return {
    questions: [
      {
        id: 'q1',
        kind,
        prompt: text(survey.question, 500) || 'How likely are you to recommend us?',
        choices,
        followUp: followUp
          ? { enabled: true, prompt: followUp, when: 'always' }
          : { enabled: false },
      },
    ],
  };
}
