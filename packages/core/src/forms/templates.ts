/**
 * Starting points for a new form, one per kind of email capture.
 *
 * Each is an ordinary definition input with the parts that make it that kind
 * already filled in: the fields, the copy, where it shows and what happens
 * after. They live in core rather than the dashboard so the admin API, the
 * CLI and an AI assistant can start from the same ones:
 * `POST /admin/forms { "template": "giveaway" }`.
 *
 * Copy is sample copy. Everything in it is meant to be rewritten.
 */

import type { FormType } from './schema.js';

export interface FormTemplate {
  key: FormType;
  title: string;
  description: string;
  /** A suggested name and id; the id is made unique when it is used. */
  name: string;
  id: string;
  definition: Record<string, unknown>;
}

const email = (label = 'Email') => ({
  id: 'email',
  kind: 'email',
  label,
  placeholder: 'you@example.com',
  required: true,
});
const firstName = { id: 'first_name', kind: 'first_name', label: 'First name', width: 'half' };
const consent = (text: string, required = false) => ({
  id: 'consent',
  kind: 'consent',
  label: text,
  required,
  save: false,
});
const text = (markdown: string) => ({ type: 'text', markdown });
const privacy = text('We never share your address. Unsubscribe any time.');

export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    key: 'newsletter',
    title: 'Newsletter signup',
    description: 'One email field and a button, inline or as a quiet slide-in.',
    name: 'Newsletter',
    id: 'newsletter',
    definition: {
      type: 'newsletter',
      fields: [email()],
      content: {
        blocks: [
          text('## Get the monthly update\n\nWhat shipped, what is next, and one good tip.'),
        ],
        footer: [privacy],
      },
      layout: { fieldLayout: 'inline', width: 560 },
      style: { buttonLabel: 'Subscribe', buttonWidth: 'auto' },
      placements: { inline: true, display: 'slidein' },
      trigger: { type: 'scroll', percent: 60 },
      frequency: { everyDays: 30 },
      success: {
        action: 'message',
        blocks: [text('## You are subscribed\n\nSee you next month.')],
      },
      tags: ['newsletter'],
    },
  },
  {
    key: 'lead_magnet',
    title: 'Lead magnet download',
    description: 'A guide or checklist, sent as a signed download link that expires.',
    name: 'Guide download',
    id: 'guide',
    definition: {
      type: 'lead_magnet',
      fields: [{ ...firstName, width: 'full' }, email('Work email')],
      content: {
        blocks: [
          text(
            '## The setup checklist\n\nTwelve steps teams use to get live in a week. Free, as a PDF.',
          ),
        ],
        footer: [privacy],
      },
      layout: { width: 560 },
      style: { buttonLabel: 'Send me the checklist' },
      placements: {
        inline: true,
        display: 'popup',
        twoStep: { enabled: true, label: 'Get the checklist' },
      },
      trigger: { type: 'time_on_page', seconds: 30 },
      success: {
        action: 'download',
        blocks: [text('## It is yours\n\nThe link works for a day.')],
        download: { label: 'Download the checklist', expiresHours: 24 },
      },
      tags: ['lead-magnet'],
    },
  },
  {
    key: 'coupon',
    title: 'Discount code reveal',
    description: 'The code appears the moment they subscribe, with a copy button.',
    name: 'Welcome discount',
    id: 'welcome-discount',
    definition: {
      type: 'coupon',
      fields: [email()],
      content: {
        blocks: [text('## 15% off your first month\n\nLeave your email and the code is yours.')],
      },
      layout: { align: 'center', width: 440 },
      style: { buttonLabel: 'Reveal my code' },
      placements: { inline: false, display: 'popup' },
      trigger: { type: 'delay', seconds: 8 },
      success: {
        action: 'coupon',
        blocks: [text('## Here it is\n\nUse it at checkout.')],
        coupon: { code: 'WELCOME15', label: 'Your code' },
      },
    },
  },
  {
    key: 'giveaway',
    title: 'Giveaway',
    description: 'Entries, referral links for bonus entries, and a fair draw.',
    name: 'Giveaway',
    id: 'giveaway',
    definition: {
      type: 'giveaway',
      fields: [firstName, email()],
      content: {
        blocks: [
          text(
            '## Win a year on the Pro plan\n\nEnter with your email. Share your link for bonus entries.',
          ),
        ],
        footer: [text('No purchase necessary. [Official rules](/giveaway-rules).')],
      },
      layout: { align: 'center', columns: 2, width: 520 },
      style: { buttonLabel: 'Enter the giveaway' },
      placements: { inline: true, display: 'none' },
      success: {
        action: 'message',
        blocks: [
          text("## You're in\n\nShare your link: every friend who enters earns you more entries."),
        ],
      },
      giveaway: {
        prize: 'A year of the Pro plan',
        rulesUrl: '/giveaway-rules',
        maxEntries: 20,
        referralEntries: 3,
        actions: [
          {
            id: 'follow-x',
            kind: 'follow',
            label: 'Follow us on X',
            url: 'https://x.com/',
            entries: 1,
          },
        ],
      },
      tags: ['giveaway'],
    },
  },
  {
    key: 'waitlist',
    title: 'Waitlist',
    description: 'For something not out yet: an email and one question.',
    name: 'Waitlist',
    id: 'waitlist',
    definition: {
      type: 'waitlist',
      fields: [
        email(),
        {
          id: 'use_case',
          kind: 'dropdown',
          label: 'What would you use it for?',
          options: ['Work', 'A side project', 'Just curious'],
        },
      ],
      content: {
        blocks: [text('## Be first in line\n\nWe are letting people in a few at a time.')],
      },
      style: { buttonLabel: 'Join the waitlist' },
      placements: { inline: true, display: 'none' },
      success: {
        action: 'message',
        blocks: [text("## You're on the list\n\nWe will be in touch.")],
      },
      tags: ['waitlist'],
    },
  },
  {
    key: 'webinar',
    title: 'Webinar signup',
    description: 'Name, email and company, with the session as a hidden field.',
    name: 'Webinar signup',
    id: 'webinar',
    definition: {
      type: 'webinar',
      fields: [
        firstName,
        { id: 'last_name', kind: 'last_name', label: 'Last name', width: 'half' },
        email('Work email'),
        { id: 'company', kind: 'company', label: 'Company' },
        { id: 'session', kind: 'hidden', value: 'live-demo', save: true },
        { id: 'source', kind: 'hidden', capture: 'utm_source' },
      ],
      content: {
        blocks: [
          text('## Live demo, Thursday at 5pm UK\n\nThirty minutes, with questions at the end.'),
        ],
      },
      layout: { columns: 2 },
      style: { buttonLabel: 'Save my seat' },
      placements: { inline: true, display: 'none' },
      success: {
        action: 'message',
        blocks: [text('## Your seat is saved\n\nAdd it to your calendar now so it does not slip.')],
      },
      tags: ['webinar'],
    },
  },
  {
    key: 'feedback',
    title: 'Feedback plus email',
    description: 'A question worth answering, and an address to follow up on.',
    name: 'Feedback',
    id: 'feedback',
    definition: {
      type: 'feedback',
      fields: [
        {
          id: 'rating',
          kind: 'radio',
          label: 'How is it going so far?',
          options: ['Great', 'Fine', 'Not great'],
          required: true,
        },
        { id: 'feedback', kind: 'textarea', label: 'What would make it better?' },
        email('Email, so we can reply'),
        consent('You can email me about my feedback.'),
      ],
      content: { blocks: [text('## Two minutes of feedback?')] },
      style: { buttonLabel: 'Send feedback' },
      placements: { inline: true, display: 'slidein' },
      trigger: { type: 'time_on_page', seconds: 60 },
      success: { action: 'message', blocks: [text('## Thank you\n\nWe read every one.')] },
    },
  },
  {
    key: 'exit_offer',
    title: 'Exit-intent offer',
    description: 'A last offer as they go to leave, on desktop.',
    name: 'Exit offer',
    id: 'exit-offer',
    definition: {
      type: 'exit_offer',
      fields: [email()],
      content: {
        blocks: [text('## Before you go\n\nTake the pricing guide with you. One email, no spam.')],
      },
      layout: { align: 'center', width: 520 },
      style: { buttonLabel: 'Send it to me', overlay: 60 },
      placements: { inline: false, display: 'popup' },
      trigger: { type: 'exit' },
      targeting: { devices: ['desktop'] },
      frequency: { everyDays: 14 },
      success: {
        action: 'message',
        blocks: [text('## On its way\n\nCheck your inbox in a minute.')],
      },
    },
  },
];

/** A template's definition input, or null for an unknown key. `custom` is blank. */
export function formTemplate(key: string): FormTemplate | null {
  if (key === 'custom') {
    return {
      key: 'custom',
      title: 'Blank form',
      description: 'An email field and nothing else.',
      name: 'New form',
      id: 'form',
      definition: { type: 'custom' },
    };
  }
  const found = FORM_TEMPLATES.find((t) => t.key === key);
  return found ? { ...found, definition: structuredClone(found.definition) } : null;
}
