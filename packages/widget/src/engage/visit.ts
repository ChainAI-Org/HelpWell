/**
 * What the server is told about this page view, and what this browser keeps.
 *
 * Targeting by referrer and UTM only makes sense for how the visit began, so
 * both are taken from the landing page and kept for the rest of the tab's
 * session; a click to the next page must not turn a newsletter visitor into
 * a direct one. The session id ties the global cap and a survey's answers
 * together; tour progress lets a tour resume across page loads.
 *
 * Storage can be refused (a sandboxed frame, strict privacy settings), so
 * every access is guarded and falls back to memory for this page.
 */

import type { TourProgress } from './shared.js';

const SESSION = 'hw:engage:session';
const REFERRER = 'hw:engage:referrer';
const UTM = 'hw:engage:utm';
const TOUR = 'hw:engage:tour:';
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

/** A tour not touched for a week is not resumed. */
const RESUME_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const memory = new Map<string, string>();

function read(store: 'session' | 'local', key: string): string | null {
  try {
    return (store === 'session' ? sessionStorage : localStorage).getItem(key);
  } catch {
    return memory.get(`${store}:${key}`) ?? null;
  }
}

function write(store: 'session' | 'local', key: string, value: string | null): void {
  try {
    const target = store === 'session' ? sessionStorage : localStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    if (value === null) memory.delete(`${store}:${key}`);
    else memory.set(`${store}:${key}`, value);
  }
}

/** One id per tab session, made up here and never tied to anything else. */
export function sessionId(): string {
  const existing = read('session', SESSION);
  if (existing) return existing;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  write('session', SESSION, id);
  return id;
}

/** The query string `GET /engage` takes: path, referrer, UTM, device and language. */
export function visitParams(): URLSearchParams {
  const params = new URLSearchParams({ path: location.pathname });

  let referrer = read('session', REFERRER);
  if (referrer === null) {
    referrer = externalReferrer();
    write('session', REFERRER, referrer);
  }
  if (referrer) params.set('referrer', referrer);

  const landing = new URLSearchParams(location.search);
  let utm: Record<string, string> = {};
  if (UTM_KEYS.some((key) => landing.has(`utm_${key}`))) {
    for (const key of UTM_KEYS) {
      const value = landing.get(`utm_${key}`);
      if (value) utm[key] = value.slice(0, 200);
    }
    write('session', UTM, JSON.stringify(utm));
  } else {
    try {
      utm = JSON.parse(read('session', UTM) ?? '{}') as Record<string, string>;
    } catch {
      utm = {};
    }
  }
  for (const key of UTM_KEYS) if (typeof utm[key] === 'string') params.set(`utm_${key}`, utm[key]);

  params.set('device', isMobile() ? 'mobile' : 'desktop');
  const language = typeof navigator === 'object' ? navigator.language : '';
  if (language) params.set('lang', language);
  return params;
}

function externalReferrer(): string {
  const value = document.referrer;
  if (!value) return '';
  try {
    return new URL(value).origin === location.origin ? '' : value.slice(0, 2000);
  } catch {
    return '';
  }
}

/** The same breakpoint the widget's display rules use. */
function isMobile(): boolean {
  try {
    return matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------- tour progress */

export const tourProgress: TourProgress & { inProgress(): string[] } = {
  get(id) {
    try {
      const saved = JSON.parse(read('local', `${TOUR}${id}`) ?? 'null') as {
        step?: unknown;
        at?: unknown;
      } | null;
      if (!saved || typeof saved.step !== 'number' || typeof saved.at !== 'number') return null;
      return Date.now() - saved.at < RESUME_FOR_MS ? saved.step : null;
    } catch {
      return null;
    }
  },
  set(id, step) {
    write('local', `${TOUR}${id}`, JSON.stringify({ step, at: Date.now() }));
  },
  clear(id) {
    write('local', `${TOUR}${id}`, null);
  },
  inProgress() {
    const ids: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(TOUR)) ids.push(key.slice(TOUR.length));
      }
    } catch {
      for (const key of memory.keys()) {
        if (key.startsWith(`local:${TOUR}`)) ids.push(key.slice(`local:${TOUR}`.length));
      }
    }
    return ids.filter((id) => tourProgress.get(id) !== null).slice(0, 10);
  },
};
