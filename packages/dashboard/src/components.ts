/**
 * Pieces more than one dashboard screen needs.
 *
 * Kept here rather than repeated so a change to how, say, a status pill reads
 * lands everywhere at once. Nothing here uses `raw()` on a value a caller
 * passed in: a host app building its own screen can hand these helpers user
 * data and get escaped markup back.
 */

import { avatarColorFor, avatarPalette } from '@helpwell/tokens';
import { html, icon, join, type RawHtml, raw, safeHref } from '@helpwell/ui';

export function card(
  title: string | null,
  hint: string | null,
  ...body: (RawHtml | null)[]
): RawHtml {
  return html`<section class="db-card">
  ${title ? html`<h2 class="db-card__title">${title}</h2>` : null}
  ${hint ? html`<p class="db-card__hint">${hint}</p>` : null}
  ${join(body)}
</section>`;
}

/**
 * A card one level down, for a long settings tab grouped under headings: the
 * same card, with an H3 where `card` has an H2.
 */
export function subCard(
  title: string | null,
  hint: string | null,
  ...body: (RawHtml | null)[]
): RawHtml {
  return html`<section class="db-card">
  ${title ? html`<h3 class="db-card__title">${title}</h3>` : null}
  ${hint ? html`<p class="db-card__hint">${hint}</p>` : null}
  ${join(body)}
</section>`;
}

/**
 * A run of cards under one heading and a line saying what they are for, so a
 * long settings tab reads as a few parts in an order, not one pile of cards.
 */
export function settingsGroup(
  id: string,
  title: string,
  hint: string | null,
  ...cards: (RawHtml | null)[]
): RawHtml {
  return html`<section class="wg-group" id="${id}" aria-labelledby="${id}-title">
  <h2 class="wg-group__title" id="${id}-title">${title}</h2>
  ${hint ? html`<p class="wg-group__hint">${hint}</p>` : null}
  ${join(cards)}
</section>`;
}

/**
 * A card that starts folded: a title and a short line always show, the rest
 * opens on click. For settings most people never need.
 */
export function foldedCard(
  id: string,
  title: string,
  summary: string,
  ...body: (RawHtml | null)[]
): RawHtml {
  return html`<details class="db-card wg-fold" id="${id}">
  <summary><span class="db-card__title">${title}</span><span class="db-muted">${summary}</span></summary>
  <div class="wg-fold__body">${join(body)}</div>
</details>`;
}

/**
 * The tinted strip under a card. Exactly one element, never a stack — a second
 * one reads as a second card rather than a footnote on the first.
 */
export function underCard(tint: 'lavender' | 'peach' | 'butter' | 'mint', text: string): RawHtml {
  return html`<div class="db-under db-under--${tint}">${text}</div>`;
}

export function stat(label: string, value: string): RawHtml {
  return html`<div class="db-stat">
  <p class="db-stat__label">${label}</p>
  <p class="db-stat__value db-nums">${value}</p>
</div>`;
}

export type PillTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';

export function pill(tone: PillTone, text: string | RawHtml): RawHtml {
  return html`<span class="db-pill db-pill--${tone}">${text}</span>`;
}

/** Conversation status, with the one rule: unresolved is the one to look at. */
export function statusPill(status: string): RawHtml {
  return status === 'resolved' ? pill('good', 'Resolved') : pill('warn', 'Unresolved');
}

export function notice(
  tone: 'good' | 'warn' | 'bad' | 'info',
  text: string | RawHtml,
  action?: RawHtml | null,
): RawHtml {
  const glyph = tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return html`<div class="db-notice db-notice--${tone}" role="${tone === 'bad' ? 'alert' : 'status'}">
  ${raw(icon(glyph, 17))}
  <div style="flex:1">${text}</div>
  ${action}
</div>`;
}

export function empty(
  glyph: string,
  title: string,
  detail?: string,
  action?: RawHtml | null,
): RawHtml {
  return html`<div class="db-empty">
  ${raw(icon(glyph, 34))}
  <h2>${title}</h2>
  ${detail ? html`<p>${detail}</p>` : null}
  ${action}
</div>`;
}

/**
 * A person's initials on a colour derived from their id, so the same contact
 * is always the same colour without storing one.
 */
export function avatar(name: string | null, email: string | null, id: string): RawHtml {
  const label = (name ?? email ?? '?').trim();
  const initials =
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase() || '?';
  // The palette gives an ink colour; the chip is that colour at low opacity,
  // so it reads as a tint rather than a solid block next to the row text.
  const colour = avatarPalette[avatarColorFor(id)];
  return html`<span class="db-avatar" style="background:color-mix(in srgb, ${colour} 16%, transparent);color:${colour}" aria-hidden="true">${initials}</span>`;
}

export function person(
  contact: { id: string | null; name: string | null; email: string | null },
  sub?: string,
): RawHtml {
  const display = contact.name ?? contact.email ?? 'Anonymous visitor';
  // An anonymous visitor has no contact row yet; the display name seeds the
  // colour instead, so the chip is still stable for that session.
  return html`<span class="db-person">
  ${avatar(contact.name, contact.email, contact.id ?? display)}
  <span>
    <span class="db-person__name">${display}</span>
    ${sub ? html`<span class="db-person__sub" style="display:block">${sub}</span>` : null}
  </span>
</span>`;
}

export function button(
  label: string,
  options: {
    href?: string;
    glyph?: string;
    tone?: 'primary' | 'danger' | 'plain';
    type?: 'submit' | 'button';
    name?: string;
    value?: string;
  } = {},
): RawHtml {
  const cls = `db-btn${options.tone === 'primary' ? ' db-btn--primary' : options.tone === 'danger' ? ' db-btn--danger' : ''}`;
  const inner = html`${options.glyph ? raw(icon(options.glyph, 15)) : null}<span>${label}</span>`;

  if (options.href) {
    return html`<a class="${cls}" href="${raw(safeHref(options.href))}">${inner}</a>`;
  }
  return html`<button class="${cls}" type="${options.type ?? 'submit'}"${
    options.name ? html` name="${options.name}"` : null
  }${options.value ? html` value="${options.value}"` : null}>${inner}</button>`;
}

/** A segmented control built from links, so each option has a real URL. */
export function segment(options: { label: string; href: string; current: boolean }[]): RawHtml {
  return html`<div class="db-segment">${join(
    options.map(
      (option) =>
        html`<a href="${raw(safeHref(option.href))}"${
          option.current ? raw(' aria-current="page"') : null
        }>${option.label}</a>`,
    ),
  )}</div>`;
}

export function searchBox(action: string, value: string, placeholder: string): RawHtml {
  return html`<form class="db-search" method="get" action="${raw(safeHref(action))}" role="search">
  ${raw(icon('search', 15))}
  <input name="q" value="${value}" placeholder="${placeholder}" aria-label="${placeholder}">
</form>`;
}

export function field(
  label: string,
  input: RawHtml,
  hint?: string | null,
  error?: string | null,
): RawHtml {
  return html`<label class="db-field"${error ? raw(' data-invalid="true"') : null}>
  <span class="db-field__label">${label}</span>
  ${input}
  ${hint ? html`<span class="db-field__hint">${hint}</span>` : null}
  ${error ? html`<span class="db-error" role="alert">${error}</span>` : null}
</label>`;
}

/**
 * How the island turns a control's value into what it saves: `list` splits on
 * commas and newlines into an array, `json` parses the value as JSON (a select
 * whose options are arrays, or an editor that serialises its own state).
 */
export type PatchType = 'list' | 'json';

export function textInput(
  name: string,
  value: string,
  options: {
    type?: string;
    placeholder?: string;
    patch?: string;
    patchType?: PatchType;
    /**
     * Also save a moment after typing stops, not only on leaving the box, so
     * whatever shows the result beside it can follow along.
     */
    live?: boolean;
    /** Extra attributes for number inputs. */
    min?: number;
    max?: number;
    step?: number | 'any';
    maxLength?: number;
  } = {},
): RawHtml {
  const extra = [
    options.min === undefined ? null : html` min="${String(options.min)}"`,
    options.max === undefined ? null : html` max="${String(options.max)}"`,
    options.step === undefined ? null : html` step="${String(options.step)}"`,
    options.maxLength === undefined ? null : html` maxlength="${String(options.maxLength)}"`,
    options.live && options.patch ? raw(' data-live') : null,
  ];
  return html`<input class="db-input" type="${options.type ?? 'text'}" name="${name}" value="${value}" placeholder="${options.placeholder ?? ''}"${join(extra)}${patchAttributes(
    options,
  )}>`;
}

export function textArea(
  name: string,
  value: string,
  options: {
    rows?: number;
    code?: boolean;
    patch?: string;
    patchType?: PatchType;
    placeholder?: string;
  } = {},
): RawHtml {
  return html`<textarea class="db-textarea${options.code ? ' db-textarea--code' : ''}" name="${name}" rows="${options.rows ?? 4}" placeholder="${options.placeholder ?? ''}"${patchAttributes(
    options,
  )}>${value}</textarea>`;
}

export function select(
  name: string,
  value: string,
  choices: { value: string; label: string }[],
  options: { patch?: string; patchType?: PatchType } = {},
): RawHtml {
  return html`<select class="db-select" name="${name}"${patchAttributes(options)}>${join(
    choices.map(
      (choice) =>
        html`<option value="${choice.value}"${
          choice.value === value ? raw(' selected') : null
        }>${choice.label}</option>`,
    ),
  )}</select>`;
}

/**
 * A select whose options are JSON values, e.g. which devices the widget shows
 * on. The current value is matched by its JSON, so `["desktop","mobile"]`
 * selects the option written the same way.
 */
export function jsonSelect(
  name: string,
  value: unknown,
  choices: { value: unknown; label: string }[],
  patch: string,
): RawHtml {
  const current = JSON.stringify(value);
  return select(
    name,
    current,
    choices.map((choice) => ({ value: JSON.stringify(choice.value), label: choice.label })),
    { patch, patchType: 'json' },
  );
}

function patchAttributes(options: { patch?: string; patchType?: PatchType }): RawHtml | null {
  if (!options.patch) return null;
  return html` data-patch="${options.patch}"${
    options.patchType ? html` data-patch-type="${options.patchType}"` : null
  }`;
}

/**
 * A setting that is not edited here, named with the reason. The
 * `data-config-only` path is what the settings coverage test looks for.
 */
export function configOnlyRow(
  path: string,
  reason: string,
  where = 'Set in helpwell.config / environment',
): RawHtml {
  return html`<div class="db-configonly" data-config-only="${path}">
  <code>${path}</code>
  <span class="db-configonly__where">${where}</span>
  <span class="db-configonly__why">${reason}</span>
</div>`;
}

/**
 * Whether a secret is set, and the environment variable it is read from.
 * Never the value: a secret is not something the dashboard shows or edits.
 */
export function secretRow(label: string, env: string, set: boolean, hint?: string): RawHtml {
  // `data-secret-env` lets a page refine the answer from the API, which also
  // knows about a secret the host passed in code rather than the environment.
  return html`<div class="db-secret" data-secret-env="${env}">
  <span class="db-secret__label">${label}</span>
  <code>${env}</code>
  <span data-secret-state>${set ? pill('good', 'Set: yes') : pill('neutral', 'Set: no')}</span>
  ${hint ? html`<span class="db-secret__hint">${hint}</span>` : null}
</div>`;
}

/**
 * A 0-1 score as a bar and a number, read-only. Used for the agent's
 * confidence, which is internal and never a setting.
 */
export function meter(label: string, value: number): RawHtml {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const tone = clamped >= 0.75 ? 'good' : clamped >= 0.5 ? 'warn' : 'bad';
  return html`<span class="db-meter db-meter--${tone}" role="img" aria-label="${label}: ${clamped.toFixed(2)} out of 1">
  <span class="db-meter__track" aria-hidden="true"><span class="db-meter__fill" style="width:${Math.round(clamped * 100)}%"></span></span>
  <span class="db-meter__value db-nums">${clamped.toFixed(2)}</span>
</span>`;
}

/** A labelled toggle that saves itself. */
export function toggle(title: string, hint: string, checked: boolean, patch: string): RawHtml {
  return html`<label class="db-switch">
  <input type="checkbox"${checked ? raw(' checked') : null} data-patch="${patch}">
  <span class="db-switch__text">
    <span class="db-switch__title">${title}</span>
    <span class="db-switch__hint" style="display:block">${hint}</span>
  </span>
</label>`;
}

/* ---------------------------------------------------------------- charts */

/**
 * A bar chart drawn with divs. No library, no canvas, no layout shift.
 *
 * The bars are decoration for a screen reader; the same numbers follow as a
 * visually hidden table, which is what gets read out.
 */
export function barChart(points: { label: string; value: number }[], caption = 'By day'): RawHtml {
  if (points.length === 0) return html`<p class="db-muted">Nothing in this range yet.</p>`;
  const max = Math.max(...points.map((p) => p.value), 1);

  return html`<div>
  <div class="db-chart" aria-hidden="true">
    ${join(
      points.map((point) => {
        const height = Math.max(Math.round((point.value / max) * 100), 2);
        return html`<div class="db-chart__bar" style="height:${height}%" title="${point.label}: ${point.value}"><i style="height:100%"></i></div>`;
      }),
    )}
  </div>
  <div class="db-chart__axis" aria-hidden="true">
    <span>${points[0]?.label ?? ''}</span>
    <span>${points[points.length - 1]?.label ?? ''}</span>
  </div>
  <table class="db-visually-hidden">
    <caption>${caption}</caption>
    <thead><tr><th scope="col">Period</th><th scope="col">Count</th></tr></thead>
    <tbody>${join(
      points.map((point) => html`<tr><td>${point.label}</td><td>${point.value}</td></tr>`),
    )}</tbody>
  </table>
</div>`;
}

/** A horizontal ranking: topics, searches, articles. */
export function rankedBars(rows: { label: string; value: number; suffix?: string }[]): RawHtml {
  if (rows.length === 0) return html`<p class="db-muted">Nothing here yet.</p>`;
  const max = Math.max(...rows.map((row) => row.value), 1);

  return html`<div class="db-bars">${join(
    rows.map(
      (row) => html`<div class="db-bars__row">
      <span class="db-truncate" title="${row.label}">${row.label}</span>
      <span class="db-bars__track"><span class="db-bars__fill" style="width:${Math.round(
        (row.value / max) * 100,
      )}%"></span></span>
      <span class="db-bars__value">${row.suffix ?? String(row.value)}</span>
    </div>`,
    ),
  )}</div>`;
}

/* ------------------------------------------------------------ formatting */

/** Locale and zone from settings. Both are text boxes, so both are optional and checked. */
export interface DateOptions {
  locale?: string;
  timeZone?: string;
}

const DATE_FORMAT = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const DATE_TIME_FORMAT = { ...DATE_FORMAT, hour: '2-digit', minute: '2-digit' } as const;

export function formatDate(value: Date | string | null, options: DateOptions = {}): string {
  const date = parseDate(value);
  if (!date) return '—';
  return localise(date, DATE_FORMAT, options);
}

export function formatDateTime(value: Date | string | null, options: DateOptions = {}): string {
  const date = parseDate(value);
  if (!date) return '—';
  return localise(date, DATE_TIME_FORMAT, options);
}

export function relativeTime(value: Date | string | null, options: DateOptions = {}): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value, options);
}

function parseDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An unknown locale or zone throws a RangeError; the date still has to render. */
function localise(date: Date, format: Intl.DateTimeFormatOptions, options: DateOptions): string {
  try {
    return date.toLocaleString(options.locale?.trim() || 'en-GB', {
      ...format,
      timeZone: options.timeZone?.trim() || undefined,
    });
  } catch {
    return date.toLocaleString('en-GB', format);
  }
}

export function percent(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function money(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export function duration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
