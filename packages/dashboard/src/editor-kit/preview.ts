/**
 * The live preview column: a browser frame around the page's preview
 * iframe, the line that says when it shows, and how it has been doing.
 *
 * The frame has four states, set on it as `data-state` by the page's script:
 * `loading` (a pulsing sketch of a page until the renderer says it is
 * ready), `ready`, `empty` (there is nothing to draw yet) and `broken` (the
 * renderer never loaded). The iframe itself is the page's business: the kit
 * only frames it.
 */

import { html, join, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { glyph } from './card.js';
import { segmentedButtons } from './controls.js';
import { type KitIconName, kitIcon } from './icons.js';

export interface PreviewPanelOptions {
  title?: string;
  /** Who the preview is drawn for ("Anonymous visitor · desktop"). */
  subtitle?: string | null;
  /** Show the Desktop / Mobile switch. */
  devices?: boolean;
  /** The address shown in the frame's bar. */
  url: string;
  /** The iframe. */
  frame: { src: string; title: string };
  /** The line under the frame: an icon and when it shows. `summaryKey` lets a script rewrite it. */
  caption?: { icon: KitIconName; text: string; summaryKey?: string } | null;
  /** A Replay button on the caption line. */
  replay?: boolean;
  /** What the empty state says. */
  emptyText?: string;
  /** Anything after the caption: a status line, a performance card, a notice. */
  below?: RawHtml | null;
  label?: string;
}

export function previewPanel(options: PreviewPanelOptions): RawHtml {
  return html`<aside class="ek-preview" aria-label="${options.label ?? 'Live preview'}">
  <div class="ek-preview__head">
    <div><h2 class="ek-preview__title">${options.title ?? 'Live preview'}</h2>${
      options.subtitle ? html`<span class="ek-preview__sub">${options.subtitle}</span>` : null
    }</div>
    ${
      options.devices === false
        ? null
        : segmentedButtons({
            label: 'Preview size',
            current: 'desktop',
            data: 'data-ek-device',
            size: 'md',
            choices: [
              { value: 'desktop', label: 'Desktop', icon: 'monitor' },
              { value: 'mobile', label: 'Mobile', icon: 'phone' },
            ],
          })
    }
  </div>
  <div class="ek-frame" data-device="desktop" data-state="loading">
    <div class="ek-frame__bar" aria-hidden="true"><span class="ek-frame__dots"><span></span><span></span><span></span></span><span class="ek-frame__url">${raw(
      kitIcon('globe', 11),
    )}<span>${options.url}</span></span></div>
    <div class="ek-frame__body">
      <iframe src="${raw(safeHref(options.frame.src))}" title="${options.frame.title}" loading="eager"></iframe>
      <div class="ek-frame__state ek-frame__state--loading" aria-hidden="true"><span class="ek-skel"><span class="ek-skel__side"></span><span class="ek-skel__main"><span style="width:40%"></span><span style="width:70%"></span><span style="width:55%;height:60px"></span><span style="width:85%"></span><span style="width:62%"></span></span></span></div>
      <div class="ek-frame__state ek-frame__state--empty" role="status">${glyph('eye', 'lavender', 18)}<strong>Nothing to show yet</strong><span>${
        options.emptyText ?? 'Add some text or media and it appears here, as visitors will see it.'
      }</span></div>
      <div class="ek-frame__state ek-frame__state--broken" role="alert">${glyph('alert', 'butter', 18)}<strong>The preview could not load</strong><span>The renderer did not start. The steps under the frame fix it.</span></div>
    </div>
  </div>
  ${
    options.caption
      ? html`<div class="ek-caption">${raw(kitIcon(options.caption.icon, 14))}<span class="ek-caption__text"${
          options.caption.summaryKey ? html` data-summary="${options.caption.summaryKey}"` : null
        }>${options.caption.text}</span>${
          options.replay
            ? html`<button type="button" class="ek-replay" data-ek-replay>${raw(kitIcon('play', 12, 2))}Replay</button>`
            : null
        }</div>`
      : null
  }
  ${options.below ?? null}
</aside>`;
}

export interface Stat {
  value: string;
  label: string;
  /** 0 to 100: how full its bar is. */
  percent: number;
  /** The bar's colour. */
  tone: 'lavender' | 'accent' | 'good' | 'muted';
}

const BAR: Record<Stat['tone'], string> = {
  lavender: '#CFC3F4',
  accent: 'var(--hw-accent)',
  good: '#177A52',
  muted: 'var(--ek-faint)',
};

/** "Performance · last 30 days": three numbers with bars, and a line under them. */
export function performanceCard(options: {
  label: string;
  link?: { href: string; label: string } | null;
  stats: readonly Stat[];
  foot?: {
    icon: KitIconName;
    text: string | RawHtml;
    link?: { href: string; label: string } | null;
  } | null;
}): RawHtml {
  return html`<section class="ek-perf" aria-label="${options.label}">
  <div class="ek-perf__head"><span class="ek-perf__label">${options.label}</span>${
    options.link
      ? html`<a class="ek-perf__link" href="${raw(safeHref(options.link.href))}">${options.link.label}</a>`
      : null
  }</div>
  <div class="ek-perf__stats">${join(
    options.stats.map(
      (s) =>
        html`<div class="ek-stat"><span class="ek-stat__value">${s.value}</span><span class="ek-stat__label">${s.label}</span><span class="ek-bar" aria-hidden="true"><span style="width:${Math.max(
          0,
          Math.min(100, Math.round(s.percent)),
        )}%;background:${BAR[s.tone]}"></span></span></div>`,
    ),
  )}</div>
  ${
    options.foot
      ? html`<div class="ek-perf__foot">${raw(kitIcon(options.foot.icon, 14))}<span>${options.foot.text}</span>${
          options.foot.link
            ? html`<a href="${raw(safeHref(options.foot.link.href))}">${options.foot.link.label}</a>`
            : null
        }</div>`
      : null
  }
</section>`;
}
