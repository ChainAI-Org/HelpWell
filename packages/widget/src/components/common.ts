/** Pieces that more than one view needs. */

import { h, svg } from '../dom.js';
import { icons } from '../icons.js';

export function iconEl(name: keyof typeof icons, className?: string): SVGElement {
  return svg(icons[name], className);
}

/**
 * An inline notice. Always animates in (DS-09): an error that appears
 * instantly reads as though it was always there and gets missed.
 */
export function notice(
  kind: 'bad' | 'warn' | 'info',
  text: string,
  retry?: () => void,
): HTMLElement {
  return h(
    'div',
    { class: `notice notice--${kind}`, role: kind === 'bad' ? 'alert' : 'status' },
    iconEl(kind === 'info' ? 'check' : 'alert'),
    h('span', { text }),
    retry &&
      h('button', {
        class: 'notice__retry',
        type: 'button',
        text: 'Try again',
        on: { click: retry },
      }),
  );
}

export function empty(icon: keyof typeof icons, title: string, detail?: string): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    iconEl(icon),
    h('p', { class: 'empty__title', text: title }),
    detail && h('p', { text: detail, style: { fontSize: '13px', margin: '0' } }),
  );
}

export function page(...children: (Node | string | false | null | undefined)[]): HTMLElement {
  return h('div', { class: 'page' }, ...children);
}

export function section(title: string | null, ...children: Node[]): HTMLElement {
  return h(
    'div',
    { class: 'section' },
    title && h('h3', { class: 'section__title', text: title }),
    ...children,
  );
}

export function row(options: {
  title: string;
  sub?: string;
  onClick: () => void;
  trailing?: Node;
}): HTMLElement {
  return h(
    'button',
    { class: 'row', type: 'button', on: { click: options.onClick } },
    h(
      'div',
      { class: 'row__main' },
      h('p', { class: 'row__title', text: options.title }),
      options.sub && h('p', { class: 'row__sub', text: options.sub }),
    ),
    options.trailing ?? h('span', { class: 'row__chevron' }, iconEl('chevron')),
  );
}

/** Skeleton shapes, used only where the view is genuinely waiting. */
export function skeletonLines(count = 4): HTMLElement {
  const bars: HTMLElement[] = [h('div', { class: 'sk-bar sk-bar--title' })];
  for (let i = 0; i < count; i++) {
    const modifier = i % 3 === 2 ? ' sk-bar--short' : i % 3 === 1 ? ' sk-bar--mid' : '';
    bars.push(h('div', { class: `sk-bar${modifier}` }));
  }
  return h('div', {}, ...bars);
}

export function skeletonCards(count = 3): HTMLElement {
  const cards: HTMLElement[] = [];
  for (let i = 0; i < count; i++) cards.push(h('div', { class: 'sk-card' }));
  return h('div', {}, ...cards);
}

/** "3 days ago", "just now". Short, because the rows are narrow. */
export function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * `admin-and-billing` -> `Admin and billing`.
 *
 * The same fallback the server applies to a collection with no _meta.json, so
 * a header the widget titles itself matches the one the API would have sent.
 */
export function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function formatDate(value: string | Date | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "September 2026", in the reader's own locale: a month heading. Empty with no date. */
export function monthLabel(value: string | Date | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}
