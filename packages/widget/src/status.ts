/**
 * The product's status in the widget (WG-11): a row on Home, and a small dot
 * on the launcher while something is wrong.
 *
 * The server reads the status page (and caches it), so the widget makes one
 * small request, and only when a status is configured at all: a manual one in
 * Settings, or a status page URL. A page it cannot read shows nothing rather
 * than a guess; the Home tab then falls back to a plain link to the page.
 */

import type { Api, StatusLevel, WidgetStatus } from './api.js';
import type { Store } from './state.js';

export const STATUS_TEXT: Record<StatusLevel, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems are running slowly',
  partial_outage: 'Some systems are down',
  major_outage: 'We are having a major outage',
  maintenance: 'Scheduled maintenance in progress',
};

/** Fetch the status into the store, if there is one to fetch. Never throws. */
export async function loadStatus(api: Api, store: Store): Promise<void> {
  const widget = store.state.config?.widget;
  if (!widget) return;
  if (widget.status?.mode !== 'manual' && !widget.statusUrl?.trim()) return;
  try {
    const status = await api.status();
    if (status && typeof status === 'object' && 'level' in status) store.set({ status });
  } catch {
    // No status is better than a wrong one.
  }
}

/** The level worth a dot on the launcher: anything but "fine" and "unknown". */
export function incidentLevel(status: WidgetStatus | null): StatusLevel | null {
  const level = status?.level;
  return level && level !== 'operational' ? level : null;
}
