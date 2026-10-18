/**
 * Forms as the widget receives them from `POST /forms/:id/render`.
 *
 * The same shape as core's `publicForm` (forms/schema.ts): what the page
 * needs to draw a form and post it back, never the targeting rules, the
 * anti-abuse settings, the coupon code or the download address. Restated
 * here because the widget is browser code and must not pull the engine in;
 * normalize.ts fills anything missing, so the renderer can trust these.
 */

import type { Block, Trigger } from '../engage/types.js';

export type FormPlacement = 'home' | 'inline' | 'popup' | 'slidein' | 'bar' | 'welcome' | 'button';
export type TriggeredPlacement = 'popup' | 'slidein' | 'bar' | 'welcome';

export type FieldKind =
  | 'email'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'company'
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'radio'
  | 'checkbox'
  | 'hidden'
  | 'consent';

export type Capture =
  | ''
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign'
  | 'utm_term'
  | 'utm_content'
  | 'referrer'
  | 'page'
  | 'param';

export interface FormField {
  id: string;
  kind: FieldKind;
  label: string;
  placeholder: string;
  help: string;
  required: boolean;
  options: string[];
  value: string;
  capture: Capture;
  param: string;
  width: 'full' | 'half';
}

export interface FormLayout {
  image: { url: string; alt: string };
  imagePosition: 'top' | 'left' | 'right' | 'background' | 'none';
  columns: number;
  fieldLayout: 'stacked' | 'inline';
  width: number;
  align: 'left' | 'center';
  closeButton: boolean;
}

export interface FormStyle {
  background: string;
  text: string;
  accent: string;
  buttonText: string;
  fieldBackground: string;
  fieldBorder: string;
  font: string;
  radius: number;
  spacing: 'compact' | 'comfortable' | 'spacious';
  buttonStyle: 'filled' | 'outline' | 'pill';
  buttonLabel: string;
  buttonWidth: 'auto' | 'full';
  shadow: boolean;
  overlay: number;
}

export interface FormMobile {
  imagePosition: 'same' | 'top' | 'none';
  fieldLayout: 'same' | 'stacked';
  columns: 'same' | 'one';
  compact: boolean;
  popupAsSheet: boolean;
}

export interface BonusAction {
  id: string;
  kind: 'visit' | 'follow';
  label: string;
  url: string;
  entries: number;
}

export type ShareTarget = 'x' | 'facebook' | 'linkedin' | 'whatsapp' | 'email' | 'copy';

export interface PublicGiveaway {
  prize: string;
  startsAt: string | null;
  endsAt: string | null;
  rulesUrl: string;
  eligibility: string;
  maxEntries: number;
  referralEntries: number;
  share: ShareTarget[];
  shareText: string;
  actions: BonusAction[];
}

export type SuccessAction = 'message' | 'redirect' | 'coupon' | 'download' | 'chat' | 'form';

export interface WidgetForm {
  id: string;
  version: number;
  type: string;
  fields: FormField[];
  content: { blocks: Block[]; footer: Block[] };
  layout: FormLayout;
  style: FormStyle;
  mobile: FormMobile;
  placements: {
    inline: boolean;
    display: 'none' | TriggeredPlacement;
    slidein: { position: 'bottom-right' | 'bottom-left' };
    bar: { position: 'top' | 'bottom' };
    twoStep: { enabled: boolean; label: string };
  };
  trigger: Trigger;
  priority: number;
  success: { action: SuccessAction; redirectUrl: string; blocks: Block[] };
  giveaway: PublicGiveaway | null;
}

/** A giveaway entrant's own view of their entry. */
export interface EntryState {
  entryId: string;
  entryKey: string;
  entries: number;
  maxEntries: number;
  referralCode: string;
  referrals: number;
  referralEntries: number;
  actions: (BonusAction & { done: boolean })[];
}

/** What `POST /forms/:id/submit` answers. */
export interface SubmitResult {
  ok: true;
  submissionId: string;
  status: 'accepted' | 'duplicate' | 'received';
  success: {
    action: SuccessAction;
    blocks: Block[];
    redirectUrl?: string;
    coupon?: { code: string; label: string };
    download?: { path: string; label: string; expiresAt: string };
    formId?: string;
  };
  giveaway?: EntryState;
}

/** What the page sends with a submission. */
export interface SubmitBody {
  token: string;
  answers: Record<string, unknown>;
  honeypot: string;
  turnstileToken?: string;
  page: { url: string; path: string; referrer: string; utm: Record<string, string> };
  ref?: string;
}

/** `helpwell.forms.on('submit', cb)` gets this. */
export interface FormSubmitEvent {
  formId: string;
  submissionId: string;
  placement: FormPlacement;
  variant: string;
  status: 'accepted' | 'duplicate' | 'received';
  email: string;
  fields: Record<string, unknown>;
}
