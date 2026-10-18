/**
 * Settings the dashboard deliberately does not edit, and why.
 *
 * The rule is that every setting in the schema is either a control on some
 * dashboard screen or listed here, and each entry here is shown on the screen
 * it belongs to as "Set in helpwell.config / environment" with its reason.
 * `test/settings-coverage.test.ts` walks the schema and fails on anything that
 * is neither, so a new setting cannot quietly go missing from the UI.
 *
 * An entry is here for an honest reason: the value is fixed or written by
 * HelpWell (a control would offer a choice that does not exist), or it holds
 * a secret, which the dashboard never shows or edits. A setting nothing reads
 * does not belong here; it gets wired up or removed, because a control for it
 * would be a promise the product does not keep.
 */

import type { RawHtml } from '@helpwell/ui';
import { html, join } from '@helpwell/ui';
import { card, configOnlyRow } from './components.js';
import { type ContentMode, managedContent } from './content-mode.js';

/** Where an entry is listed: a settings tab, or another screen. */
export type ConfigOnlyScreen =
  | 'general'
  | 'agent'
  | 'widget'
  | 'knowledge'
  | 'changelog'
  | 'data'
  | 'connections'
  | 'webhooks'
  | 'engage';

export interface ConfigOnlyEntry {
  screen: ConfigOnlyScreen;
  reason: string;
  /** The reason as said to an install with no config file to edit, when it differs. */
  managedReason?: string;
  /**
   * Edited on its screen when the install's content is managed for it: with
   * no config file to set it in, the dashboard is where it is set, so it is
   * not listed as config-only there.
   */
  managedEditable?: boolean;
}

export const CONFIG_ONLY: Readonly<Record<string, ConfigOnlyEntry>> = {
  version: {
    screen: 'data',
    reason: 'The config file format. HelpWell writes it; there is nothing to choose.',
  },
  'changelog.roadmap.statuses': {
    screen: 'changelog',
    reason:
      'Fixed: the roadmap always has four lanes, Under review, Planned, In progress and Shipped.',
  },
  webhooks: {
    screen: 'webhooks',
    reason:
      'Each webhook carries its signing secret, and the dashboard never edits a secret. Add them to helpwell.config.json and run helpwell sync.',
    managedReason: 'Added, paused and removed on this page, which makes each one’s signing secret.',
    managedEditable: true,
  },
};

/**
 * The card listing a screen's config-only settings, or nothing when it has
 * none. An install whose content is managed for it has no config file of its
 * own, so it is told where these are set instead (content-mode.ts).
 */
export function configOnlyCard(
  screen: ConfigOnlyScreen,
  context: { contentMode?: ContentMode } = {},
): RawHtml | null {
  const managed = managedContent(context);
  const entries = Object.entries(CONFIG_ONLY).filter(
    ([, entry]) => entry.screen === screen && !(managed && entry.managedEditable),
  );
  if (entries.length === 0) return null;
  const where = managed ? 'Set where this install is configured' : undefined;
  return card(
    where ?? 'Set in helpwell.config / environment',
    managed
      ? 'These are set where this install is configured, not edited here.'
      : 'These are read from helpwell/helpwell.config.json (pushed with helpwell sync) or the environment, not edited here.',
    html`<div class="db-configonly__list">${join(
      entries.map(([path, entry]) =>
        configOnlyRow(path, managed ? (entry.managedReason ?? entry.reason) : entry.reason, where),
      ),
    )}</div>`,
  );
}
