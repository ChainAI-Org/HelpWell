/**
 * The "Who sees it, and when" column in words, for a form.
 *
 * A form is targeted with the same rules as an engagement, so the sentences
 * are engage's own (engage/summaries.ts); only the goal, and what the
 * trigger means for a form that never pops up, are a form's.
 */

import type { Engagement, FormDefinition } from '@helpwell/core/repos';
import { summaries as engageSummaries } from '../engage/summaries.js';
import { PLACEMENT_LABELS } from './labels.js';

export interface FormSummaries {
  audience: string;
  trigger: string;
  frequency: string;
  goal: string;
  moment: string;
}

export function formSummaries(
  definition: FormDefinition,
  options: { segmentName?: string | null; locale?: string; timeZone?: string } = {},
): FormSummaries {
  // The rules engage words are the same shapes on a form, so an engagement
  // stand-in with them is all engage's summaries need.
  const said = engageSummaries(
    {
      id: 'form',
      kind: 'modal',
      targeting: definition.targeting,
      // An engagement takes a list of triggers; a form has one.
      triggers: [definition.trigger],
      schedule: definition.schedule,
      frequency: definition.frequency,
      priority: definition.priority,
    } as unknown as Engagement,
    options,
  );
  const display = definition.placements.display;
  const pops = display !== 'none';
  const embedded = [
    definition.placements.inline ? 'embedded' : '',
    definition.placements.twoStep.enabled ? 'behind a button' : '',
  ].filter(Boolean);
  const trigger = pops
    ? `${PLACEMENT_LABELS[display]}, ${said.trigger}`
    : `It does not pop up${embedded.length ? `; it shows ${embedded.join(' and ')}` : ''}`;
  return {
    audience: said.audience,
    trigger: capitalise(trigger),
    frequency: pops ? said.frequency : 'Wherever it is embedded, every visit, for its audience.',
    goal:
      definition.type === 'giveaway'
        ? 'A trusted entry. Referrals and bonus actions add entries, not sign-ups.'
        : 'A trusted submission.',
    moment: pops
      ? said.moment
      : embedded.length
        ? `Shown ${embedded.join(' and ')}`
        : 'Not shown anywhere yet',
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
