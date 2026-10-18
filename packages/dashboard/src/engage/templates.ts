/**
 * Where a new engagement starts: a gallery of templates, one or more per
 * kind, each a complete definition that saves as it is and reads well in the
 * preview. Selectors in the tour and hotspot templates are placeholders; the
 * editor points out that they need to match the app.
 */

import type { EngagementKind } from '@helpwell/core/repos';

export interface Template {
  key: string;
  kind: EngagementKind;
  title: string;
  description: string;
  /** A definition without an id; the editor gives it one. */
  definition: Record<string, unknown>;
}

const text = (markdown: string) => ({ type: 'text', markdown });
const button = (label: string, action: string, value = '', style = 'primary') => ({
  type: 'buttons',
  buttons: [{ label, action, value, style }],
});

export const TEMPLATES: readonly Template[] = [
  {
    key: 'announcement',
    kind: 'modal',
    title: 'Announcement',
    description: 'One card in the middle of the screen, with a call to action.',
    definition: {
      name: 'Announcement',
      modal: {
        size: 'small',
        slides: [
          {
            blocks: [
              text('## Something new\n\nOne or two sentences on what changed and why it helps.'),
              button('Take a look', 'url', '/'),
            ],
          },
        ],
      },
    },
  },
  {
    key: 'feature-launch',
    kind: 'modal',
    title: 'Feature launch',
    description: 'A short carousel: what it is, how it works, where to start.',
    definition: {
      name: 'Feature launch',
      modal: {
        size: 'medium',
        mediaPosition: 'top',
        slides: [
          {
            blocks: [
              text('## Meet reports\n\nSee how your team is doing without leaving the app.'),
            ],
          },
          {
            blocks: [
              text('### Build one in a minute\n\nPick a metric, pick a range, and share the link.'),
            ],
          },
          {
            blocks: [
              text('### Ready when you are\n\nYour first report is one click away.'),
              button('Create a report', 'url', '/reports/new'),
            ],
          },
        ],
      },
    },
  },
  {
    key: 'nps',
    kind: 'survey',
    title: 'NPS survey',
    description: 'The 0 to 10 question, a follow-up for detractors, and a thank-you.',
    definition: {
      name: 'NPS survey',
      frequency: { everyDays: 90 },
      triggers: [{ type: 'time_on_page', seconds: 30 }],
      survey: {
        questions: [
          {
            id: 'score',
            kind: 'nps',
            prompt: 'How likely are you to recommend us to a friend or colleague?',
            followUp: {
              enabled: true,
              prompt: 'What is the one thing we should fix?',
              when: 'detractors',
            },
            branches: [{ min: 0, max: 6, goto: 'improve' }],
            next: 'end',
          },
          {
            id: 'improve',
            kind: 'multi',
            prompt: 'Which of these would help most?',
            choices: ['Speed', 'Price', 'Documentation', 'Something else'],
            required: false,
          },
        ],
        thankYou: [text('Thank you. Every answer is read.')],
      },
    },
  },
  {
    key: 'onboarding-tour',
    kind: 'tour',
    title: 'Onboarding tour',
    description:
      'A welcome, then three stops around the app. Point the steps at your own elements.',
    definition: {
      name: 'Onboarding tour',
      targeting: { audience: 'identified' },
      tour: {
        steps: [
          {
            target: '',
            blocks: [text('### Welcome aboard\n\nA quick look around: it takes 30 seconds.')],
          },
          {
            target: '#main-nav',
            placement: 'right',
            blocks: [text('**Everything lives here.** Your projects, reports and settings.')],
          },
          {
            target: '#new-project',
            placement: 'bottom',
            advance: 'click',
            blocks: [text('**Start a project.** Click here to make your first one.')],
          },
          {
            target: '#help',
            placement: 'left',
            blocks: [text('**Stuck?** Ask us anything, any time.')],
          },
        ],
      },
    },
  },
  {
    key: 'maintenance-banner',
    kind: 'banner',
    title: 'Maintenance banner',
    description: 'A warning strip across the top, on a schedule.',
    definition: {
      name: 'Maintenance banner',
      frequency: 'always',
      banner: {
        tone: 'warning',
        blocks: [
          text(
            '**Scheduled maintenance** on Sunday from 02:00 to 03:00 UTC. The app will be read-only.',
          ),
          button('Status page', 'url', 'https://status.example.com', 'secondary'),
        ],
      },
    },
  },
  {
    key: 'new-feature-hotspot',
    kind: 'hotspot',
    title: 'New feature hotspot',
    description: 'A pulsing dot on the new button, with a line about it.',
    definition: {
      name: 'New feature hotspot',
      hotspot: {
        target: '#new-feature',
        placement: 'auto',
        blocks: [text('**New:** export straight to a spreadsheet.'), button('Got it', 'dismiss')],
      },
    },
  },
];

const BLANK: Record<EngagementKind, Record<string, unknown>> = {
  modal: { modal: { slides: [{ blocks: [text('')] }] } },
  banner: { banner: { blocks: [text('')] } },
  hotspot: { hotspot: { target: '', blocks: [text('')] } },
  tour: { tour: { steps: [{ target: '', blocks: [text('')] }] } },
  survey: { survey: { questions: [{ id: 'q1', kind: 'nps', prompt: '' }] } },
};

export const KIND_LABELS: Record<EngagementKind, string> = {
  modal: 'Modal',
  banner: 'Banner',
  hotspot: 'Hotspot',
  tour: 'Tour',
  survey: 'Survey',
};

export const KIND_HINTS: Record<EngagementKind, string> = {
  modal: 'A card over the page. One slide, or several as a carousel.',
  banner: 'A strip across the top or bottom of the page.',
  hotspot: 'A pulsing dot on one element, with a tooltip.',
  tour: 'Steps that point at parts of your app, across pages.',
  survey: 'NPS, CSAT, stars, choices or free text, with branching.',
};

/** A template (or a blank of a kind, `blank-<kind>`) as a definition, with an id. */
export function startingPoint(key: string): Record<string, unknown> | null {
  const template = TEMPLATES.find((t) => t.key === key);
  if (template) {
    return structuredClone({
      ...template.definition,
      kind: template.kind,
      id: newId(template.key),
    });
  }
  const kind = key.replace(/^blank-/, '') as EngagementKind;
  if (key.startsWith('blank-') && kind in BLANK) {
    return structuredClone({ ...BLANK[kind], kind, id: newId(kind) });
  }
  return null;
}

/** `nps-k3f9`: readable, and unlikely to collide with one that exists. */
function newId(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
