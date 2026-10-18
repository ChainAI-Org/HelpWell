/**
 * The small drawings in the engage editor's tiles and slide thumbnails,
 * after the design canvas's: where a banner sits, what its styles look like,
 * how a pop-up lays out its media, what a hotspot's beacon is, and a
 * miniature of each slide.
 *
 * Colours come from the kit's sketch variables, so they follow dark mode;
 * the brand, subtle and warning swatches use the same colours the widget
 * draws those banners in.
 */

import type { Block } from '@helpwell/core/repos';
import { html, type RawHtml, raw } from '@helpwell/ui';
import { sketch } from '../editor-kit/index.js';

const LINE = 'height:3px;border-radius:2px;background:var(--ek-sketch-ink)';
const CARD =
  'background:var(--ek-sketch-card);border-radius:3px;box-shadow:0 1px 3px rgba(23,20,37,.12)';
const MEDIA = 'background:var(--ek-sketch-media);border-radius:2px';

/* ---------------------------------------------------------------- modal */

export function modalLayout(kind: 'top' | 'side' | 'background'): RawHtml {
  const inner =
    kind === 'top'
      ? `<span style="position:absolute;inset:5px;${CARD};padding:3px;display:flex;flex-direction:column;gap:3px"><span style="height:16px;${MEDIA}"></span><span style="${LINE};width:70%"></span><span style="${LINE};width:45%"></span></span>`
      : kind === 'side'
        ? `<span style="position:absolute;inset:5px;${CARD};padding:3px;display:flex;gap:4px"><span style="width:44%;${MEDIA}"></span><span style="flex:1;display:flex;flex-direction:column;gap:3px;justify-content:center"><span style="${LINE};width:90%"></span><span style="${LINE};width:60%"></span><span style="${LINE};width:75%"></span></span></span>`
        : `<span style="position:absolute;inset:5px;border-radius:3px;box-shadow:0 1px 3px rgba(23,20,37,.12);padding:4px;display:flex;flex-direction:column;justify-content:flex-end;gap:3px;background:linear-gradient(160deg,#9E7BF0,#5B2FC0)"><span style="${LINE};width:60%;background:#FFFFFF"></span><span style="${LINE};width:40%;background:rgba(255,255,255,.6)"></span></span>`;
  return sketch(raw(inner));
}

/** A slide in miniature: its media (if any), two lines of text, and its button. */
export function slidePicture(blocks: readonly Block[]): RawHtml {
  const media = blocks.find((b) => b.type === 'image' || b.type === 'gif' || b.type === 'video');
  const hasButton = blocks.some((b) => b.type === 'buttons' && b.buttons.length > 0);
  const top =
    media?.type === 'video'
      ? '<span style="height:18px;border-radius:4px;background:linear-gradient(135deg,#231B3A,#6A2FD6);display:flex;align-items:center;justify-content:center"><span style="width:8px;height:8px;border-radius:999px;background:#FFFFFF"></span></span>'
      : media?.type === 'gif'
        ? '<span style="height:18px;border-radius:4px;background:#EEE9FB;display:flex;align-items:flex-end;justify-content:center"><span style="width:70%;height:13px;background:#FFFFFF;border-radius:3px 3px 0 0"></span></span>'
        : media
          ? '<span style="height:18px;border-radius:4px;background:linear-gradient(135deg,#E6E1F8,#D9CCFB)"></span>'
          : '';
  return html`<span class="ek-thumb__card">${raw(top)}<span style="${raw(`${LINE};width:80%;background:var(--hw-ink)`)}"></span><span style="${raw(
    `${LINE};width:60%`,
  )}"></span>${
    hasButton
      ? raw(
          '<span style="margin-top:auto;height:6px;width:40%;border-radius:2px;background:var(--hw-accent)"></span>',
        )
      : null
  }</span>`;
}

/* --------------------------------------------------------------- banner */

/** Where a banner sits: top or bottom, pushing the page or floating over it. */
export function bannerPosition(where: 'top' | 'bottom', floating: boolean): RawHtml {
  const lines = (tops: number[], widths: number[]) =>
    tops
      .map(
        (t, i) =>
          `<span style="position:absolute;left:8px;top:${t}px;width:${widths[i]}%;height:4px;border-radius:2px;background:var(--ek-sketch-ink)"></span>`,
      )
      .join('');
  let inner: string;
  if (floating) {
    inner =
      lines([8, 16, 24, 32], [60, 80, 70, 50]) +
      `<span style="position:absolute;left:6px;right:6px;${where === 'top' ? 'top:4px' : 'bottom:4px'};height:9px;border-radius:3px;background:var(--hw-accent);box-shadow:0 2px 5px rgba(23,20,37,.3)"></span>`;
  } else if (where === 'top') {
    inner = `${lines([16, 24, 32], [60, 80, 70])}<span style="position:absolute;left:0;right:0;top:0;height:9px;background:var(--hw-accent)"></span>`;
  } else {
    inner = `${lines([4, 12, 20, 28], [60, 80, 70, 50])}<span style="position:absolute;left:0;right:0;bottom:0;height:9px;background:var(--hw-accent)"></span>`;
  }
  return sketch(raw(inner), { style: 'height:36px' });
}

/** A banner's style as a swatch: its ground, a line of text and its button. */
export function bannerTone(
  tone: 'accent' | 'neutral' | 'warning' | 'custom',
  custom?: { background: string; color: string },
): RawHtml {
  const looks = {
    accent: {
      bg: 'var(--hw-accent)',
      line: 'rgba(255,255,255,.75)',
      button: '#FFFFFF',
      border: '',
    },
    neutral: {
      bg: '#F8F7FC',
      line: '#CFC8E3',
      button: '#171425',
      border: 'border:1px solid #E4E0EE;',
    },
    warning: { bg: '#FBEFC7', line: '#E3C77A', button: '#9A6206', border: '' },
    custom: {
      bg: custom?.background || '#102030',
      line: custom?.color || '#FFFFFF',
      button: custom?.color || '#FFFFFF',
      border: 'border:1px solid rgba(23,20,37,.08);',
    },
  } as const;
  const look = looks[tone];
  // Custom colours are hex checked by the schema before they get here; anything else falls back.
  const safe = (value: string, fallback: string) =>
    /^#[0-9a-fA-F]{3,8}$|^var\(|^rgba?\(/.test(value) ? value : fallback;
  return html`<span aria-hidden="true" style="${raw(
    `display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 8px;border-radius:7px;${look.border}background:${safe(look.bg, '#102030')}`,
  )}"><span style="${raw(`width:10px;height:10px;border-radius:3px;opacity:.9;background:${safe(look.button, '#FFFFFF')}`)}"></span><span style="${raw(
    `flex:1;height:4px;border-radius:2px;opacity:${tone === 'custom' ? '.7' : '1'};background:${safe(look.line, '#FFFFFF')}`,
  )}"></span><span style="${raw(`width:24px;height:12px;border-radius:4px;background:${safe(look.button, '#FFFFFF')}`)}"></span></span>`;
}

/* -------------------------------------------------------------- hotspot */

/** A beacon on a small ghost button: pulsing ring, still dot, or question mark. */
export function beacon(kind: 'pulse' | 'dot' | 'question'): RawHtml {
  const mark =
    kind === 'pulse'
      ? '<span style="position:absolute;left:50%;top:9px;width:18px;height:18px;margin-left:13px;border-radius:999px;border:2px solid var(--hw-accent);opacity:.45"></span><span style="position:absolute;left:50%;top:14px;width:8px;height:8px;margin-left:18px;border-radius:999px;background:var(--hw-accent)"></span>'
      : kind === 'dot'
        ? '<span style="position:absolute;left:50%;top:14px;width:8px;height:8px;margin-left:18px;border-radius:999px;background:var(--hw-accent)"></span>'
        : '<span style="position:absolute;left:50%;top:10px;width:16px;height:16px;margin-left:14px;border-radius:999px;background:var(--hw-accent);color:#FFFFFF;font:700 10px/16px system-ui,sans-serif;text-align:center">?</span>';
  return sketch(
    raw(
      `<span style="position:absolute;left:50%;top:13px;width:40px;height:12px;margin-left:-26px;border-radius:4px;background:var(--hw-ink);opacity:.85"></span>${mark}`,
    ),
  );
}

/* ------------------------------------------------------- page placements */

/** Where something sits on a page: a corner card, a centred dialog, a bottom bar, or nothing. */
export function placement(kind: 'corner' | 'center' | 'bar' | 'none'): RawHtml {
  const page = [8, 16, 24]
    .map(
      (t, i) =>
        `<span style="position:absolute;left:8px;top:${t}px;width:${[60, 80, 50][i]}%;height:4px;border-radius:2px;background:var(--ek-sketch-ink)"></span>`,
    )
    .join('');
  const box =
    kind === 'corner'
      ? `<span style="position:absolute;right:6px;bottom:5px;width:36%;height:20px;${CARD};border:1px solid var(--hw-accent-line)"></span>`
      : kind === 'center'
        ? `<span style="position:absolute;inset:0;background:rgba(23,20,37,.18)"></span><span style="position:absolute;left:30%;right:30%;top:7px;bottom:7px;${CARD}"></span>`
        : kind === 'bar'
          ? `<span style="position:absolute;left:0;right:0;bottom:0;height:12px;background:var(--ek-sketch-card);border-top:1px solid var(--hw-accent-line)"></span>`
          : '';
  return sketch(raw(page + box));
}

/** A tour step: an element picked out, with its tooltip under it. */
export function tourStep(): RawHtml {
  return sketch(
    raw(
      `<span style="position:absolute;left:8px;top:9px;width:40%;height:4px;border-radius:2px;background:var(--ek-sketch-ink)"></span>` +
        `<span style="position:absolute;left:8px;top:17px;width:28%;height:4px;border-radius:2px;background:var(--ek-sketch-ink)"></span>` +
        `<span style="position:absolute;right:10px;top:6px;width:26px;height:10px;border-radius:3px;background:var(--hw-ink);box-shadow:0 0 0 2px var(--ek-sketch-card),0 0 0 4px var(--hw-accent)"></span>` +
        `<span style="position:absolute;right:6px;top:22px;width:52%;height:26px;${CARD};padding:4px;display:flex;flex-direction:column;gap:3px"><span style="${LINE};width:70%;background:var(--hw-ink)"></span><span style="${LINE};width:90%"></span></span>`,
    ),
    { tall: true },
  );
}
