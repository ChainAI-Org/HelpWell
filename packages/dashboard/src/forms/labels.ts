/**
 * The words the forms pages use for each kind of form, placement and
 * success action, in one place so the list, the builder and the results
 * all say the same thing.
 */

import type { FormPlacement, FormType, SuccessAction } from '@helpwell/core/repos';

export const TYPE_LABELS: Record<FormType, string> = {
  newsletter: 'Newsletter',
  lead_magnet: 'Lead magnet',
  coupon: 'Discount code',
  giveaway: 'Giveaway',
  waitlist: 'Waitlist',
  webinar: 'Webinar',
  feedback: 'Feedback',
  exit_offer: 'Exit offer',
  custom: 'Custom',
};

export const TYPE_ICONS: Record<FormType, string> = {
  newsletter: 'inbox',
  lead_magnet: 'download',
  coupon: 'sparkle',
  giveaway: 'rocket',
  waitlist: 'clock',
  webinar: 'play',
  feedback: 'message',
  exit_offer: 'external',
  custom: 'wrench',
};

export const PLACEMENT_LABELS: Record<FormPlacement, string> = {
  home: 'Widget Home tab',
  inline: 'Embedded on a page',
  popup: 'Pop-up',
  slidein: 'Slide-in',
  bar: 'Floating bar',
  welcome: 'Welcome mat',
  button: 'Two-step button',
};

export const SUCCESS_LABELS: Record<SuccessAction, string> = {
  message: 'Show a message',
  redirect: 'Go to a page',
  coupon: 'Reveal a code',
  download: 'Give a download',
  chat: 'Open the chat',
  form: 'Show another form',
};

export const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  name: 'Name',
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  company: 'Company',
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  radio: 'Radio buttons',
  checkbox: 'Checkbox',
  hidden: 'Hidden',
  consent: 'Consent box',
};

export const REASON_LABELS: Record<string, string> = {
  honeypot: 'Hidden field filled in',
  too_fast: 'Too fast',
  rate_limited: 'Rate limited',
  blocked_ip: 'Blocked IP',
  blocked_domain: 'Blocked domain',
  disposable: 'Throwaway address',
  no_mx: 'Domain takes no mail',
  no_token: 'No render token',
};
