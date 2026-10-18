/**
 * Status for the widget (WG-11), and what the dashboard needs to show about
 * the widget's outside dependencies.
 *
 * `GET /status` answers the same thing to every visitor, so it is cached for
 * a minute here and may be cached by a CDN for as long. Precedence, first
 * that applies: a manual status set in Settings, an incident the host app
 * passes in its config, then the status page at `widget.statusUrl`.
 */

import type { StatusLevel } from '../../settings/schema.js';
import type { RequestContext } from '../context.js';
import { requireAdmin } from '../context.js';
import { botCheckStatus, TURNSTILE_CSP, TURNSTILE_SECRET_ENV } from '../human-check.js';
import { json, type Router } from '../router.js';
import {
  type PageStatus,
  readStatusPage,
  STATUS_MESSAGES,
  type StatusIncident,
} from '../status-page.js';

export interface WidgetStatus {
  /** Null when nothing is configured, or the status page could not be read. */
  level: StatusLevel | null;
  message: string;
  /** Where "Status" links to: the status page itself. */
  url: string | null;
  incidents: StatusIncident[];
  source: 'manual' | 'host' | PageStatus['provider'] | null;
  updatedAt: string | null;
}

export function widgetStatusRoutes(router: Router<RequestContext>): Router<RequestContext> {
  router.get('/status', async ({ context }) => {
    return json(await currentStatus(context), {
      headers: { 'cache-control': 'public, max-age=60' },
    });
  });

  /**
   * For the dashboard: whether the bot check can actually run, and whether
   * the status page answers. Never includes the Turnstile secret, only
   * whether one is set and where from.
   */
  router.get('/admin/widget/checks', async ({ context }) => {
    requireAdmin(context);
    const bot = botCheckStatus(context);
    const status = await currentStatus(context);
    return json({
      botCheck: { ...bot, secretEnv: TURNSTILE_SECRET_ENV, csp: TURNSTILE_CSP },
      status: {
        ...status,
        mode: context.settings.widget.status.mode,
        /** As typed in Settings; `url` is null when that is not an https URL. */
        statusUrl: context.settings.widget.statusUrl || null,
        readable: status.source !== null,
      },
    });
  });

  return router;
}

export async function currentStatus(context: RequestContext): Promise<WidgetStatus> {
  const widget = context.settings.widget;
  const url = httpsUrl(widget.statusUrl);

  if (widget.status.mode === 'manual') {
    const level = widget.status.level;
    return {
      level,
      message: widget.status.message.trim() || STATUS_MESSAGES[level],
      url,
      incidents: [],
      source: 'manual',
      updatedAt: null,
    };
  }

  const incident = context.config.incident;
  if (incident?.title) {
    return {
      level: 'degraded',
      message: incident.title.slice(0, 280),
      url,
      incidents: [{ name: incident.title.slice(0, 280), status: 'investigating', url }],
      source: 'host',
      updatedAt: null,
    };
  }

  const page = url
    ? await readStatusPage(url, { fetchJson: context.config.fetchStatusPage })
    : null;
  if (!page) {
    return { level: null, message: '', url, incidents: [], source: null, updatedAt: null };
  }
  return {
    level: page.level,
    message: page.message,
    url,
    incidents: page.incidents,
    source: page.provider,
    updatedAt: page.updatedAt,
  };
}

function httpsUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}
