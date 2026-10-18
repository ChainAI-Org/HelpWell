/**
 * What a form is, as JSON: its fields, how it looks, where it shows, who
 * sees it and when, what happens after someone submits, and, for a giveaway,
 * the prize and the rules.
 *
 * Forms keep their definitions in the database (repos/forms.ts), versioned,
 * because a form has submissions, analytics and giveaway state that settings
 * cannot hold. The shape is still plain JSON so a form can be exported and
 * kept in a repo, and every part a form shares with engagements is the same
 * schema engagements use: content blocks (engage/schema.ts) and the
 * targeting, trigger, schedule and frequency rules (engage/rules.ts). One
 * engine decides who sees an engagement and who sees a form.
 *
 * This file checks shape, the way engage/schema.ts does: every field has a
 * default, so `{}` is a working newsletter form. Whether a definition is
 * complete (a coupon action has a code, a giveaway has rules) is check.ts.
 */

import { z } from 'zod';
import {
  frequencySchema,
  scheduleSchema,
  targetingSchema,
  triggerSchema,
} from '../engage/rules.js';
import { blocksSchema } from '../engage/schema.js';

/* --------------------------------------------------------------- the kinds */

/** What a form is for. Each has a template (templates.ts); `custom` is a blank one. */
export const FORM_TYPES = [
  'newsletter',
  'lead_magnet',
  'coupon',
  'giveaway',
  'waitlist',
  'webinar',
  'feedback',
  'exit_offer',
  'custom',
] as const;
export type FormType = (typeof FORM_TYPES)[number];

/**
 * Where a form can appear. `home` is the widget's Home tab (a `form` block in
 * `widget.home.blocks`), `inline` an embed (`<div data-helpwell-form="id">`),
 * `button` the popup a two-step link or button opens. The other four are the
 * ones a trigger shows.
 */
export const FORM_PLACEMENTS = [
  'home',
  'inline',
  'popup',
  'slidein',
  'bar',
  'welcome',
  'button',
] as const;
export type FormPlacement = (typeof FORM_PLACEMENTS)[number];

/** The placements a trigger shows. Only these count towards frequency and the global cap. */
export const TRIGGERED_PLACEMENTS = ['popup', 'slidein', 'bar', 'welcome'] as const;
export type TriggeredPlacement = (typeof TRIGGERED_PLACEMENTS)[number];

export function isTriggered(placement: string): placement is TriggeredPlacement {
  return (TRIGGERED_PLACEMENTS as readonly string[]).includes(placement);
}

/** The fonts the widget offers in Settings. `inherit` uses the page's own. */
export const FORM_FONTS = [
  'inherit',
  'Plus Jakarta Sans',
  'Inter',
  'Geist',
  'DM Sans',
  'Manrope',
] as const;

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex colour such as #7A3BEB');
/** A hex colour, or empty for "the widget's accent". */
const hexOrAuto = z.union([hex, z.literal('')]);
const url = z.string().trim().max(2000);

/* ------------------------------------------------------------------ fields */

export const FIELD_KINDS = [
  'email',
  'name',
  'first_name',
  'last_name',
  'phone',
  'company',
  'text',
  'textarea',
  'number',
  'date',
  'dropdown',
  'radio',
  'checkbox',
  'hidden',
  'consent',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/**
 * What a hidden field fills itself with from the visit. `param` reads the
 * query-string parameter named in the field's `param`.
 */
export const CAPTURES = [
  '',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'page',
  'param',
] as const;
export type Capture = (typeof CAPTURES)[number];

export const fieldSchema = z.object({
  /** The answer's key in the submission. Letters, digits and underscores. */
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, 'Start with a letter; then letters, digits or _'),
  kind: z.enum(FIELD_KINDS).default('text'),
  /** For a consent box, the words beside it (Markdown links work). */
  label: z.string().trim().max(500).default(''),
  placeholder: z.string().trim().max(200).default(''),
  /** A line under the box. */
  help: z.string().trim().max(300).default(''),
  required: z.boolean().default(false),
  /** Dropdown, radio and checkbox choices. A checkbox with none is a single yes/no box. */
  options: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  /** Hidden fields: a fixed value. */
  value: z.string().trim().max(500).default(''),
  /** Hidden fields: fill from the visit instead. */
  capture: z.enum(CAPTURES).default(''),
  /** Hidden fields with `capture: param`: which query parameter. */
  param: z
    .string()
    .trim()
    .regex(/^[\w.-]{0,60}$/, 'A query parameter name, e.g. plan')
    .default(''),
  /**
   * Save the answer on the contact, as a custom field (the field registry
   * types it). Email and name always go to the contact's own email and name.
   */
  save: z.boolean().default(true),
  /** The contact field it is saved as. Empty: the field's id. */
  attribute: z
    .string()
    .trim()
    .regex(/^[\w.-]{0,120}$/, 'Letters, digits, dots, dashes or _')
    .default(''),
  /** In a two-column layout, `half` sits beside the next half-width field. */
  width: z.enum(['full', 'half']).default('full'),
});

/* ---------------------------------------------------------- look and feel */

export const layoutSchema = z.object({
  /** One picture for the form, placed by `imagePosition`. */
  image: z
    .object({ url: url.default(''), alt: z.string().trim().max(300).default('') })
    .default({}),
  imagePosition: z.enum(['top', 'left', 'right', 'background', 'none']).default('none'),
  /** Two columns lets half-width fields pair up. */
  columns: z.number().int().min(1).max(2).default(1),
  /** `inline` puts the fields and the button on one row, the classic newsletter bar. */
  fieldLayout: z.enum(['stacked', 'inline']).default('stacked'),
  /** The widest the form grows, in pixels. */
  width: z.number().int().min(240).max(1200).default(480),
  align: z.enum(['left', 'center']).default('left'),
  /** A close button on popups, slide-ins, bars and welcome mats. */
  closeButton: z.boolean().default(true),
});

export const styleSchema = z.object({
  background: hex.default('#FFFFFF'),
  text: hex.default('#1B1530'),
  /** The button and focus colour. Empty: the widget's accent. */
  accent: hexOrAuto.default(''),
  buttonText: hex.default('#FFFFFF'),
  fieldBackground: hex.default('#FFFFFF'),
  fieldBorder: hex.default('#DAD6E5'),
  font: z.enum(FORM_FONTS).default('inherit'),
  radius: z.number().int().min(0).max(32).default(14),
  spacing: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  buttonStyle: z.enum(['filled', 'outline', 'pill']).default('filled'),
  buttonLabel: z.string().trim().max(60).default('Subscribe'),
  buttonWidth: z.enum(['auto', 'full']).default('full'),
  shadow: z.boolean().default(true),
  /** How dark the page goes behind a popup or welcome mat, in percent. */
  overlay: z.number().int().min(0).max(90).default(50),
});

/** What changes on a phone. `same` keeps the desktop choice. */
export const mobileSchema = z.object({
  imagePosition: z.enum(['same', 'top', 'none']).default('top'),
  fieldLayout: z.enum(['same', 'stacked']).default('stacked'),
  columns: z.enum(['same', 'one']).default('one'),
  /** Smaller headings and padding, for a small screen. */
  compact: z.boolean().default(true),
  /** A popup rises from the bottom of the screen as a sheet. */
  popupAsSheet: z.boolean().default(true),
});

export const contentSchema = z.object({
  /** Above the fields: the headline, subheading, body, picture or video. */
  blocks: blocksSchema.default([]),
  /** Under the button: fine print, a privacy line. */
  footer: blocksSchema.default([]),
});

/* ------------------------------------------------------------- placements */

export const placementsSchema = z.object({
  /** Drawn wherever the page has `<div data-helpwell-form="id">`. */
  inline: z.boolean().default(true),
  /** Also shown by its trigger, as one of these. */
  display: z.enum(['none', ...TRIGGERED_PLACEMENTS]).default('none'),
  slidein: z
    .object({ position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right') })
    .default({}),
  bar: z.object({ position: z.enum(['top', 'bottom']).default('bottom') }).default({}),
  /**
   * Two-step: an embed draws a button instead of the form, and any element
   * with `data-helpwell-form-open="id"` opens it, as a popup.
   */
  twoStep: z
    .object({
      enabled: z.boolean().default(false),
      label: z.string().trim().max(60).default('Get it free'),
    })
    .default({}),
});

/* ------------------------------------------------------------------ after */

export const SUCCESS_ACTIONS = [
  'message',
  'redirect',
  'coupon',
  'download',
  'chat',
  'form',
] as const;
export type SuccessAction = (typeof SUCCESS_ACTIONS)[number];

/**
 * What the visitor gets once they submit. The message blocks show with every
 * action except a redirect. The coupon code and the download address stay
 * on the server until an accepted submission asks for them.
 */
export const successSchema = z.object({
  action: z.enum(SUCCESS_ACTIONS).default('message'),
  blocks: blocksSchema.default([{ type: 'text', markdown: '## Thanks\n\nYou are on the list.' }]),
  redirectUrl: url.default(''),
  coupon: z
    .object({
      code: z.string().trim().max(60).default(''),
      label: z.string().trim().max(120).default('Your code'),
    })
    .default({}),
  download: z
    .object({
      url: url.default(''),
      label: z.string().trim().max(60).default('Download'),
      /** How long the signed link works for. */
      expiresHours: z.number().int().min(1).max(168).default(24),
    })
    .default({}),
  /** `form`: this form is replaced by another one. */
  formId: z.string().trim().max(80).default(''),
});

/* --------------------------------------------------------------- variants */

/**
 * An A/B variant: the parts it changes, over the base form. Each visitor is
 * given one variant and keeps it; the traffic split is the weights.
 */
export const variantSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,20}$/, 'Lower-case letters, digits and dashes'),
  name: z.string().trim().max(60).default(''),
  weight: z.number().int().min(0).max(100).default(50),
  content: contentSchema.partial().default({}),
  style: styleSchema.partial().default({}),
  layout: layoutSchema.partial().default({}),
});

/* --------------------------------------------------------------- giveaway */

export const SHARE_TARGETS = ['x', 'facebook', 'linkedin', 'whatsapp', 'email', 'copy'] as const;
export type ShareTarget = (typeof SHARE_TARGETS)[number];

const instant = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a date and time')
    .nullable(),
);

/**
 * A bonus entry the entrant claims themselves: visiting a page, following an
 * account. HelpWell cannot check either, so they are labelled as
 * self-reported wherever they show.
 */
export const bonusActionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,30}$/, 'Lower-case letters, digits and dashes'),
  kind: z.enum(['visit', 'follow']).default('visit'),
  label: z.string().trim().max(120).default(''),
  url: url.default(''),
  entries: z.number().int().min(1).max(20).default(1),
});

export const giveawaySchema = z.object({
  prize: z.string().trim().max(500).default(''),
  startsAt: instant.default(null),
  endsAt: instant.default(null),
  /** The official rules. Required before a giveaway can be saved. */
  rulesUrl: url.default(''),
  eligibility: z.string().trim().max(1000).default(''),
  /** The most entries one person can hold, bonuses included. */
  maxEntries: z.number().int().min(1).max(1000).default(20),
  /** Bonus entries for each trusted person who enters through your link. */
  referralEntries: z.number().int().min(0).max(100).default(3),
  share: z.array(z.enum(SHARE_TARGETS)).default([...SHARE_TARGETS]),
  shareText: z.string().trim().max(280).default('I just entered this giveaway. You can too:'),
  actions: z.array(bonusActionSchema).max(10).default([]),
});

/* ------------------------------------------------------------- anti-abuse */

export const abuseSchema = z.object({
  /** A submission sooner than this after the form was drawn is a script's. */
  minFillSeconds: z.number().min(0).max(60).default(2),
  /** Look the email's domain up for a mail server (MX record). */
  checkMx: z.boolean().default(true),
  perIpPerHour: z.number().int().min(1).max(1000).default(20),
  perEmailPerDay: z.number().int().min(1).max(100).default(5),
});

/* ------------------------------------------------------------------ whole */

export const formDefinitionSchema = z.object({
  type: z.enum(FORM_TYPES).default('custom'),
  fields: z
    .array(fieldSchema)
    .max(30)
    .default([
      {
        id: 'email',
        kind: 'email',
        label: 'Email',
        placeholder: 'you@example.com',
        required: true,
      },
    ]),
  content: contentSchema.default({}),
  layout: layoutSchema.default({}),
  style: styleSchema.default({}),
  mobile: mobileSchema.default({}),
  placements: placementsSchema.default({}),
  /** Who and where: the triggered placement only checks pages, referrer, UTM, device and language. */
  targeting: targetingSchema.default({}),
  trigger: triggerSchema.default({ type: 'delay', seconds: 5 }),
  schedule: scheduleSchema.default({}),
  frequency: frequencySchema.default('once'),
  priority: z.number().int().min(0).max(100).default(0),
  /**
   * Someone who already submitted is not asked again: triggered placements
   * stay away, and an embed shows the thank-you (or their entries) instead.
   */
  suppressSubscribed: z.boolean().default(true),
  success: successSchema.default({}),
  variants: z.array(variantSchema).max(4).default([]),
  giveaway: giveawaySchema.default({}),
  abuse: abuseSchema.default({}),
  /** Tags added to the contact on an accepted submission. */
  tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});

export type FormField = z.infer<typeof fieldSchema>;
export type FormLayout = z.infer<typeof layoutSchema>;
export type FormStyle = z.infer<typeof styleSchema>;
export type FormMobile = z.infer<typeof mobileSchema>;
export type FormContent = z.infer<typeof contentSchema>;
export type FormPlacements = z.infer<typeof placementsSchema>;
export type FormSuccess = z.infer<typeof successSchema>;
export type FormVariant = z.infer<typeof variantSchema>;
export type GiveawaySettings = z.infer<typeof giveawaySchema>;
export type BonusAction = z.infer<typeof bonusActionSchema>;
export type FormAbuse = z.infer<typeof abuseSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

/** Parse a definition, filling every default. Throws zod's error on a bad one. */
export function parseFormDefinition(input: unknown): FormDefinition {
  return formDefinitionSchema.parse(input ?? {});
}

/** A form as the repo keeps it: the row, with its current definition. */
export interface Form {
  /** Stable, and in the embed code: `data-helpwell-form="newsletter"`. */
  id: string;
  /** For the dashboard. Visitors never see it. */
  name: string;
  type: FormType;
  enabled: boolean;
  version: number;
  definition: FormDefinition;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

/** Ids appear in embed code, URLs and storage keys. */
export const FORM_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

/* ------------------------------------------------------ variants, applied */

/** The variant ids a form serves: its own, or the one implicit `a`. */
export function variantIds(definition: FormDefinition): string[] {
  return definition.variants.length > 0 ? definition.variants.map((v) => v.id) : ['a'];
}

/** The definition as one variant shows it: that variant's parts over the base. */
export function withVariant(definition: FormDefinition, variantId: string): FormDefinition {
  const variant = definition.variants.find((v) => v.id === variantId);
  if (!variant) return definition;
  return {
    ...definition,
    content: { ...definition.content, ...defined(variant.content) },
    style: { ...definition.style, ...defined(variant.style) },
    layout: { ...definition.layout, ...defined(variant.layout) },
  };
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/* --------------------------------------------------------- what is public */

/**
 * The form as the page is sent it: what it needs to draw and to submit.
 * Targeting, schedule, frequency and anti-abuse settings stay on the server,
 * and so do the coupon code and the download address, which only an accepted
 * submission is given.
 */
export function publicForm(form: Pick<Form, 'id' | 'version'>, definition: FormDefinition) {
  const { success, giveaway } = definition;
  return {
    id: form.id,
    version: form.version,
    type: definition.type,
    fields: definition.fields.map((field) => ({
      id: field.id,
      kind: field.kind,
      label: field.label,
      placeholder: field.placeholder,
      help: field.help,
      required: field.required,
      options: field.options,
      // A hidden field's fixed value is part of what the page posts back.
      value: field.kind === 'hidden' ? field.value : '',
      capture: field.capture,
      param: field.param,
      width: field.width,
    })),
    content: definition.content,
    layout: definition.layout,
    style: definition.style,
    mobile: definition.mobile,
    placements: definition.placements,
    trigger: definition.trigger,
    priority: definition.priority,
    success: {
      action: success.action,
      // The thank-you and a redirect's address are no secret; the coupon
      // code and the download address are, and are not here.
      blocks: success.blocks,
      redirectUrl: success.action === 'redirect' ? success.redirectUrl : '',
    },
    giveaway:
      definition.type === 'giveaway'
        ? {
            prize: giveaway.prize,
            startsAt: giveaway.startsAt,
            endsAt: giveaway.endsAt,
            rulesUrl: giveaway.rulesUrl,
            eligibility: giveaway.eligibility,
            maxEntries: giveaway.maxEntries,
            referralEntries: giveaway.referralEntries,
            share: giveaway.share,
            shareText: giveaway.shareText,
            actions: giveaway.actions,
          }
        : null,
  };
}

export type PublicForm = ReturnType<typeof publicForm>;
