/**
 * Make whatever arrived into a form the renderer can trust.
 *
 * The server validates forms before it serves them, so this is a guard, not
 * a validator: it fills defaults and drops what has the wrong type, so an
 * older server, or the dashboard's preview mid-edit, still draws something
 * sensible. Blocks and triggers go through engage's own guard, because they
 * are the same shapes. It never throws; what it cannot make sense of is null.
 */

import { normalizeEngagement } from '../engage/normalize.js';
import type { Block, Trigger } from '../engage/types.js';
import type {
  BonusAction,
  Capture,
  FieldKind,
  FormField,
  PublicGiveaway,
  ShareTarget,
  WidgetForm,
} from './types.js';

type Loose = Record<string, unknown>;

const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const KINDS: readonly FieldKind[] = [
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
];
const CAPTURES: readonly Capture[] = [
  '',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'page',
  'param',
];
const SHARES: readonly ShareTarget[] = ['x', 'facebook', 'linkedin', 'whatsapp', 'email', 'copy'];
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const hex = (value: unknown, fallback: string) => {
  const text = str(value).trim();
  return HEX.test(text) ? text : fallback;
};

/** Blocks, through engage's own guard. */
export function normalizeBlocks(value: unknown): Block[] {
  const parsed = normalizeEngagement({
    id: 'blocks',
    kind: 'banner',
    banner: { blocks: Array.isArray(value) ? value : [] },
  });
  return parsed?.kind === 'banner' ? parsed.banner.blocks : [];
}

function trigger(value: unknown): Trigger {
  const parsed = normalizeEngagement({ id: 'trigger', kind: 'banner', trigger: value });
  // Engagements take a list of triggers; a form takes one.
  return parsed?.triggers[0] ?? { type: 'load' };
}

function field(raw: Loose): FormField | null {
  const id = str(raw.id);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(id)) return null;
  return {
    id,
    kind: oneOf(raw.kind, KINDS, 'text'),
    label: str(raw.label),
    placeholder: str(raw.placeholder),
    help: str(raw.help),
    required: bool(raw.required, false),
    options: list(raw.options).filter((o): o is string => typeof o === 'string' && o.length > 0),
    value: str(raw.value),
    capture: oneOf(raw.capture, CAPTURES, ''),
    param: str(raw.param),
    width: oneOf(raw.width, ['full', 'half'] as const, 'full'),
  };
}

function action(raw: Loose): BonusAction | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    kind: oneOf(raw.kind, ['visit', 'follow'] as const, 'visit'),
    label: str(raw.label),
    url: str(raw.url),
    entries: clamp(num(raw.entries, 1), 1, 20),
  };
}

function giveaway(raw: unknown): PublicGiveaway | null {
  if (!isRecord(raw)) return null;
  return {
    prize: str(raw.prize),
    startsAt: typeof raw.startsAt === 'string' ? raw.startsAt : null,
    endsAt: typeof raw.endsAt === 'string' ? raw.endsAt : null,
    rulesUrl: str(raw.rulesUrl),
    eligibility: str(raw.eligibility),
    maxEntries: clamp(num(raw.maxEntries, 20), 1, 1000),
    referralEntries: clamp(num(raw.referralEntries, 3), 0, 100),
    share: list(raw.share).filter((s): s is ShareTarget => SHARES.includes(s as ShareTarget)),
    shareText: str(raw.shareText),
    actions: list(raw.actions)
      .filter(isRecord)
      .map(action)
      .filter((a) => a !== null),
  };
}

export function normalizeForm(input: unknown): WidgetForm | null {
  if (!isRecord(input) || typeof input.id !== 'string' || !input.id) return null;
  const content = isRecord(input.content) ? input.content : {};
  const layout = isRecord(input.layout) ? input.layout : {};
  const image = isRecord(layout.image) ? layout.image : {};
  const style = isRecord(input.style) ? input.style : {};
  const mobile = isRecord(input.mobile) ? input.mobile : {};
  const placements = isRecord(input.placements) ? input.placements : {};
  const slidein = isRecord(placements.slidein) ? placements.slidein : {};
  const bar = isRecord(placements.bar) ? placements.bar : {};
  const twoStep = isRecord(placements.twoStep) ? placements.twoStep : {};
  const success = isRecord(input.success) ? input.success : {};

  const fields = list(input.fields)
    .filter(isRecord)
    .map(field)
    .filter((f) => f !== null);
  if (!fields.some((f) => f.kind === 'email')) {
    fields.unshift({
      id: 'email',
      kind: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      help: '',
      required: true,
      options: [],
      value: '',
      capture: '',
      param: '',
      width: 'full',
    });
  }

  return {
    id: input.id,
    version: num(input.version, 1),
    type: str(input.type, 'custom'),
    fields: fields.slice(0, 30),
    content: { blocks: normalizeBlocks(content.blocks), footer: normalizeBlocks(content.footer) },
    layout: {
      image: { url: str(image.url), alt: str(image.alt) },
      imagePosition: oneOf(
        layout.imagePosition,
        ['top', 'left', 'right', 'background', 'none'] as const,
        'none',
      ),
      columns: num(layout.columns, 1) === 2 ? 2 : 1,
      fieldLayout: oneOf(layout.fieldLayout, ['stacked', 'inline'] as const, 'stacked'),
      width: clamp(num(layout.width, 480), 240, 1200),
      align: oneOf(layout.align, ['left', 'center'] as const, 'left'),
      closeButton: bool(layout.closeButton, true),
    },
    style: {
      background: hex(style.background, '#FFFFFF'),
      text: hex(style.text, '#1B1530'),
      accent: hex(style.accent, ''),
      buttonText: hex(style.buttonText, '#FFFFFF'),
      fieldBackground: hex(style.fieldBackground, '#FFFFFF'),
      fieldBorder: hex(style.fieldBorder, '#DAD6E5'),
      font: str(style.font, 'inherit').replace(/[<>"';{}]/g, '') || 'inherit',
      radius: clamp(num(style.radius, 14), 0, 32),
      spacing: oneOf(style.spacing, ['compact', 'comfortable', 'spacious'] as const, 'comfortable'),
      buttonStyle: oneOf(style.buttonStyle, ['filled', 'outline', 'pill'] as const, 'filled'),
      buttonLabel: str(style.buttonLabel, 'Subscribe') || 'Subscribe',
      buttonWidth: oneOf(style.buttonWidth, ['auto', 'full'] as const, 'full'),
      shadow: bool(style.shadow, true),
      overlay: clamp(num(style.overlay, 50), 0, 90),
    },
    mobile: {
      imagePosition: oneOf(mobile.imagePosition, ['same', 'top', 'none'] as const, 'top'),
      fieldLayout: oneOf(mobile.fieldLayout, ['same', 'stacked'] as const, 'stacked'),
      columns: oneOf(mobile.columns, ['same', 'one'] as const, 'one'),
      compact: bool(mobile.compact, true),
      popupAsSheet: bool(mobile.popupAsSheet, true),
    },
    placements: {
      inline: bool(placements.inline, true),
      display: oneOf(
        placements.display,
        ['none', 'popup', 'slidein', 'bar', 'welcome'] as const,
        'none',
      ),
      slidein: {
        position: oneOf(slidein.position, ['bottom-right', 'bottom-left'] as const, 'bottom-right'),
      },
      bar: { position: oneOf(bar.position, ['top', 'bottom'] as const, 'bottom') },
      twoStep: { enabled: bool(twoStep.enabled, false), label: str(twoStep.label, 'Get it free') },
    },
    trigger: trigger(input.trigger),
    priority: num(input.priority, 0),
    success: {
      action: oneOf(
        success.action,
        ['message', 'redirect', 'coupon', 'download', 'chat', 'form'] as const,
        'message',
      ),
      redirectUrl: str(success.redirectUrl),
      blocks: normalizeBlocks(success.blocks),
    },
    giveaway: giveaway(input.giveaway),
  };
}
