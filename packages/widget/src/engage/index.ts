/**
 * Engage: modals, banners, hotspots, tours and surveys on the host page.
 *
 * These render into their own shadow root rather than the widget's, because a
 * tour has to point at elements on the host page and a banner sits across the
 * top of it. The widget panel stays where it is.
 *
 * The flow for one page view:
 *
 *   1. Ask the server what this visit qualifies for (`GET /engage`, with the
 *      path, referrer, UTM, device and language). Who and where are decided
 *      there; the answer is already in priority order.
 *   2. Arm each one's triggers (triggers.ts): page load, a delay, scroll
 *      depth, exit intent, time on page, inactivity, a click, an event from
 *      `helpwell('track', name)`, or only `helpwell.engage.show(id)`. With
 *      several, whichever fires first shows it, and the rest are disarmed.
 *   3. When a trigger fires, claim it (`POST /engage/:id/show`). The server
 *      applies the frequency rule and the global cap, and records it as seen;
 *      only then is it drawn. Modals, surveys and tours take turns.
 *
 * A tour in progress is resumed first, from where this browser left it.
 *
 * Engagements chosen elsewhere come in through `offer`: a support extension's
 * pop-ups, banners and tours (proactive.ts), named `proactive:<id>`. They are
 * armed, claimed, drawn and recorded exactly as Settings ones are, through the
 * same routes, so the two take turns on screen under one global cap, and a
 * tour one started resumes after a reload like any other.
 *
 * `{{field}}` placeholders are filled in as each one is drawn, with the
 * values the server sent alongside it (personalize.ts).
 */

import { browserId } from '../proactive.js';
import { safeAccent } from '../sanitize.js';
import type { Widget } from '../widget.js';
import { safeLink } from './blocks.js';
import { normalizeEngagement } from './normalize.js';
import { type Fields, fieldsFrom, personalizeEngagement } from './personalize.js';
import { type EngageHost, leave, type Surface, safeQuery } from './shared.js';
import { ENGAGE_CSS } from './styles.js';
import { isExclusive, renderEngagement } from './surfaces.js';
import { armTrigger, EventHub } from './triggers.js';
import type { Engagement } from './types.js';
import { sessionId, tourProgress, visitParams } from './visit.js';

export type { EngageHost } from './shared.js';
export type { Engagement } from './types.js';

/** How an engagement a support extension sent is named, apart from Settings ones. */
export const OFFERED_PREFIX = 'proactive:';

export interface Engagements {
  /** The page moved on: drop what pointed at it and ask again for the new path. */
  refresh(): void;
  destroy(): void;
  /** `helpwell.engage.show(id)`: show one now, whatever its trigger. */
  show(id: string): void;
  /** `helpwell.engage.hide()`: take everything off the screen, recording nothing. */
  hide(): void;
  /** `helpwell('track', name)`: fire the triggers waiting for that event. */
  event(name: string): void;
  /**
   * An engagement chosen elsewhere (a support extension's, `proactive:<id>`):
   * armed, claimed and drawn like a Settings one, taking turns with them.
   * `fields` are the values for its placeholders. Dropped with the page.
   */
  offer(definition: unknown, fields?: Fields): void;
}

interface Presenting {
  engagement: Engagement;
  manual: boolean;
  /** A tour resumed from this browser's progress: already claimed, start here. */
  startAt?: number;
}

export function mountEngagements(widget: Widget): Engagements {
  const element = document.createElement('helpwell-engage');
  const root = element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ENGAGE_CSS;
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(style, layer);
  document.body.appendChild(element);

  const config = widget.store.state.config;
  element.style.setProperty('--hw-engage-accent', safeAccent(config?.widget.appearance.accent));
  // A theme forced in Appearance applies here too; otherwise the reader's own.
  const theme = config?.widget.appearance.theme;
  if (theme === 'light' || theme === 'dark') element.dataset.hwTheme = theme;

  const events = new EventHub();
  let cleanups: (() => void)[] = [];
  let disarms: (() => void)[] = [];
  let items: Engagement[] = [];
  /** Offered from elsewhere on this page view, by id. */
  const offered = new Map<string, Engagement>();
  /** Values for placeholders, as the server sent them for this visitor. */
  let fields: Record<string, string> = {};
  const surfaces = new Map<string, Surface>();
  /** Shown (or being shown) on this page view, so a trigger cannot show it twice. */
  const presented = new Set<string>();
  let waiting: Presenting[] = [];
  let busy: string | null = null;
  let generation = 0;
  let stopped = false;
  let warned = false;

  const request = <T>(path: string, json?: unknown) =>
    widget.api.request<T>(path, json === undefined ? {} : { method: 'POST', json });
  /** An extension's engagement tells it who clicked: the same browser id its list was asked with. */
  const whose = (id: string) => (id.startsWith(OFFERED_PREFIX) ? { anon: browserId() } : {});

  const host: EngageHost = {
    root,
    layer,
    preview: false,
    record(id, state, extra) {
      void request(`/engage/${encodeURIComponent(id)}/impression`, {
        state,
        ...extra,
        url: location.pathname,
        session: sessionId(),
        ...whose(id),
      }).catch(() => {
        // An engagement that cannot log is still better than no engagement.
      });
    },
    dismiss(id, el, extra) {
      host.record(id, 'dismissed', extra);
      leave(el);
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
    findTarget: safeQuery,
    act(action, value, newTab) {
      if (action === 'chat') {
        widget.open({ name: 'chat', conversationId: widget.store.state.conversationId });
      } else if (action === 'article' && value) {
        widget.open({ name: 'article', slug: value, from: { name: 'help' } });
      } else if (action === 'tour' && value) {
        controller.show(value);
      } else if (action === 'url') {
        const href = safeLink(value);
        if (!href) return;
        if (newTab) window.open(href, '_blank', 'noopener');
        else location.assign(href);
      }
    },
    async answer(surveyId, answer) {
      await request(`/surveys/${encodeURIComponent(surveyId)}/response`, answer);
    },
    session: sessionId,
    progress: tourProgress,
  };

  // Everything on screen and everything pending goes; the layer stays.
  const clear = () => {
    generation++;
    for (const disarm of disarms) disarm();
    disarms = [];
    const pending = cleanups;
    cleanups = [];
    for (const fn of pending) fn();
    layer.textContent = '';
    surfaces.clear();
    presented.clear();
    offered.clear();
    waiting = [];
    busy = null;
  };

  const present = async (entry: Presenting) => {
    const { manual, startAt } = entry;
    const engagement = personalizeEngagement(entry.engagement, fields);
    const id = engagement.id;
    presented.add(id);
    if (isExclusive(engagement.kind)) busy = id;
    const mine = generation;
    let ended = false;

    const done = () => {
      ended = true;
      if (mine !== generation) return;
      surfaces.delete(id);
      if (busy === id) {
        busy = null;
        const next = waiting.shift();
        if (next) void present(next);
      }
    };
    const claim = async (step?: number) => {
      try {
        const result = await request<{ shown?: boolean } | undefined>(
          `/engage/${encodeURIComponent(id)}/show`,
          {
            session: sessionId(),
            url: location.pathname,
            manual,
            ...(step ? { step } : {}),
            ...whose(id),
          },
        );
        // An older server answers 204: that is a yes.
        return mine === generation && !stopped && result?.shown !== false;
      } catch {
        return false;
      }
    };

    try {
      const surface = await renderEngagement(host, engagement, { claim, done, startAt });
      if (surface && mine === generation && !ended) surfaces.set(id, surface);
    } catch (error) {
      // Drawing runs on somebody else's page: say so once, never throw at it.
      if (!warned) {
        warned = true;
        console.warn('helpwell: an engagement could not be shown.', error);
      }
      done();
    }
  };

  const enqueue = (entry: Presenting) => {
    const id = entry.engagement.id;
    if (presented.has(id)) return;
    if (isExclusive(entry.engagement.kind) && busy) {
      if (waiting.some((w) => w.engagement.id === id)) return;
      waiting.push(entry);
      waiting.sort((a, b) => b.engagement.priority - a.engagement.priority);
      return;
    }
    void present(entry);
  };

  /** Arm every trigger; the first to fire shows it, and takes the others down. */
  const arm = (engagement: Engagement) => {
    let fired = false;
    const off: (() => void)[] = [];
    const fire = () => {
      if (fired) return;
      fired = true;
      for (const disarm of off) disarm();
      enqueue({ engagement, manual: false });
    };
    for (const trigger of engagement.triggers) off.push(armTrigger(trigger, fire, { events }));
    disarms.push(() => {
      for (const disarm of off) disarm();
    });
  };

  const load = () => {
    const mine = generation;
    const params = visitParams();
    const resume = tourProgress.inProgress();
    if (resume.length > 0) params.set('resume', resume.join(','));

    void request<{ items?: unknown[]; fields?: unknown }>(`/engage?${params}`)
      .then((result) => {
        // A slow answer for a page the visitor has already left is dropped.
        if (stopped || mine !== generation) return;
        fields = { ...fields, ...fieldsFrom(result?.fields) };
        items = (result?.items ?? [])
          .map(normalizeEngagement)
          .filter((e): e is Engagement => e !== null);

        for (const id of resume) {
          if (!items.some((e) => e.id === id && e.kind === 'tour')) tourProgress.clear(id);
        }
        for (const engagement of items) {
          const step = engagement.kind === 'tour' ? tourProgress.get(engagement.id) : null;
          if (step !== null && resume.includes(engagement.id)) {
            enqueue({ engagement, manual: false, startAt: step });
            continue;
          }
          arm(engagement);
        }
      })
      .catch(() => {
        // Engage is additive. If it cannot load, the widget still works.
      });
  };

  const controller: Engagements = {
    refresh() {
      if (stopped) return;
      clear();
      load();
    },
    destroy() {
      stopped = true;
      clear();
      element.remove();
    },
    show(id) {
      if (stopped || !id || surfaces.has(id)) return;
      // Asked for by name, it may be shown again after it closed.
      if (!waiting.some((w) => w.engagement.id === id)) presented.delete(id);
      const known = items.find((e) => e.id === id) ?? offered.get(id);
      if (known) {
        enqueue({ engagement: known, manual: true });
        return;
      }
      const mine = generation;
      void request<{ item?: unknown; fields?: unknown }>(`/engage/${encodeURIComponent(id)}`)
        .then((result) => {
          const engagement = normalizeEngagement(result?.item);
          if (engagement && mine === generation && !stopped) {
            fields = { ...fields, ...fieldsFrom(result?.fields) };
            enqueue({ engagement, manual: true });
          }
        })
        .catch(() => {
          // Not for this visitor, not enabled, or not there: nothing to show.
        });
    },
    hide() {
      waiting = [];
      for (const surface of [...surfaces.values()]) surface.close();
      surfaces.clear();
    },
    event(name) {
      if (!stopped && name) events.emit(name);
    },
    offer(definition, extra) {
      if (stopped) return;
      const engagement = normalizeEngagement(definition);
      // Only the extension's own, and each once a page view.
      if (!engagement?.id.startsWith(OFFERED_PREFIX)) return;
      if (offered.has(engagement.id) || presented.has(engagement.id)) return;
      if (items.some((e) => e.id === engagement.id)) return;
      offered.set(engagement.id, engagement);
      if (extra) fields = { ...fields, ...fieldsFrom(extra) };
      arm(engagement);
    },
  };

  load();
  return controller;
}
