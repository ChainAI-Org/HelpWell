/**
 * One entry point for drawing any engagement, whatever its kind. The live
 * widget and the dashboard's preview both call this, which is what makes the
 * preview the real thing rather than a picture of it.
 */

import { showBanner } from './banner.js';
import { showHotspot } from './hotspot.js';
import { showModal } from './modal.js';
import type { EngageHost, ShowOptions, Surface } from './shared.js';
import { showSurvey } from './survey.js';
import { runTour } from './tour.js';
import type { Engagement, EngagementKind } from './types.js';

export function renderEngagement(
  host: EngageHost,
  engagement: Engagement,
  options: ShowOptions,
): Promise<Surface | null> {
  switch (engagement.kind) {
    case 'modal':
      return showModal(host, engagement, options);
    case 'banner':
      return showBanner(host, engagement, options);
    case 'hotspot':
      return showHotspot(host, engagement, options);
    case 'tour':
      return runTour(host, engagement, options);
    case 'survey':
      return showSurvey(host, engagement, options);
  }
}

/**
 * The kinds that take over the visitor's attention. Only one is on screen at
 * a time; the rest wait their turn, highest priority first. Banners and
 * hotspots sit alongside whatever else is showing.
 */
export function isExclusive(kind: EngagementKind): boolean {
  return kind === 'modal' || kind === 'survey' || kind === 'tour';
}
