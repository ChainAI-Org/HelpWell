/**
 * Banners: a strip across the top or bottom of the page.
 *
 * `inline` pushes the page out of the way, with a spacer the height of the
 * banner put into the host document itself, so nothing the page draws is
 * hidden behind it. `floating` sits over the page, inset from the edges. The
 * tone is the accent colour, a quiet neutral, a warning amber, or colours of
 * the owner's choosing (hex only: they end up in a style attribute).
 *
 * A sticky banner (the default) stays in view while the page scrolls. One
 * that is not scrolls away with the top of the page, or, at the bottom, waits
 * for the reader to reach the end of it. A countdown ticks to a date after
 * the text, and when it reaches zero the banner goes, or stays showing zero.
 */

import { h, svg } from '../dom.js';
import { icons } from '../icons.js';
import { safeAccent } from '../sanitize.js';
import { renderBlocks } from './blocks.js';
import { type EngageHost, leave, type ShowOptions, type Surface } from './shared.js';
import type { BannerEngagement, EngageButton } from './types.js';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export async function showBanner(
  host: EngageHost,
  engagement: BannerEngagement,
  options: ShowOptions,
): Promise<Surface | null> {
  const { position, style, tone, blocks, sticky, countdown } = engagement.banner;
  const until = countdown.until ? Date.parse(countdown.until) : Number.NaN;
  const hasCountdown = Number.isFinite(until);
  // A sale that has already ended is not announced, and not counted as shown.
  const over = hasCountdown && until <= Date.now() && countdown.onEnd === 'hide';
  if (blocks.length === 0 || over || !(await options.claim())) {
    options.done();
    return null;
  }

  const bar = h('div', {
    class: `banner banner--${position} banner--${style} banner--${tone}`,
    role: 'region',
    'aria-label': 'Announcement',
  });
  if (tone === 'custom') {
    const background = engagement.banner.background.trim();
    const color = engagement.banner.color.trim();
    bar.style.setProperty('--banner-bg', HEX.test(background) ? background : safeAccent(null));
    bar.style.setProperty('--banner-ink', HEX.test(color) ? color : '#FFFFFF');
  }

  let spacer: HTMLElement | null = null;
  let finished = false;
  const stops: (() => void)[] = [];
  const measure = () => {
    if (spacer) spacer.style.height = `${Math.ceil(bar.getBoundingClientRect().height)}px`;
  };
  const finish = () => {
    if (finished) return false;
    finished = true;
    window.removeEventListener('resize', measure);
    for (const stop of stops.splice(0)) stop();
    spacer?.remove();
    spacer = null;
    options.done();
    return true;
  };

  const onButton = (button: EngageButton) => {
    if (button.action === 'dismiss') {
      if (finish()) host.dismiss(engagement.id, bar);
      return;
    }
    if (button.action === 'next') return;
    if (!finish()) return;
    host.record(engagement.id, 'clicked');
    host.act(button.action, button.value, button.newTab);
    leave(bar);
  };

  const content = renderBlocks(blocks, {
    onButton,
    compact: true,
    onLink: () => host.record(engagement.id, 'clicked'),
  });
  if (hasCountdown) {
    const timer = countdownTimer(until, {
      keep: countdown.onEnd === 'keep',
      ended: () => {
        // Its moment has passed: it goes, as a closed banner would, but
        // nothing is recorded; the visitor did not close it.
        if (finish()) leave(bar);
      },
    });
    stops.push(timer.stop);
    // After the words, before the call to action.
    content.insertBefore(timer.el, content.querySelector('.eg-buttons'));
  }
  bar.appendChild(content);

  if (engagement.dismissible) {
    const close = h('button', { class: 'banner__close', type: 'button', 'aria-label': 'Dismiss' });
    close.appendChild(svg(icons.close));
    close.addEventListener('click', () => {
      if (finish()) host.dismiss(engagement.id, bar);
    });
    bar.appendChild(close);
  }

  host.layer.appendChild(bar);

  // Inline: the page makes room. Not in the dashboard's preview, whose page
  // is a picture, and whose layout must not jump as the draft changes.
  if (style === 'inline' && !host.preview) {
    spacer = h('div', { 'data-helpwell-banner-spacer': '', 'aria-hidden': 'true' });
    spacer.style.cssText = 'display:block;width:100%;height:0;pointer-events:none;';
    if (position === 'top') document.body.prepend(spacer);
    else document.body.append(spacer);
    requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
  }
  if (!sticky && !host.preview) stops.push(scrollWithPage(bar, position));
  host.onCleanup(() => finish());

  return {
    close() {
      if (finish()) leave(bar);
    },
  };
}

/**
 * Move a banner with the page rather than keep it in view: a top one slides
 * up as the page scrolls down, a bottom one slides in as the reader reaches
 * the end. Returns what stops it.
 */
function scrollWithPage(bar: HTMLElement, position: 'top' | 'bottom'): () => void {
  bar.classList.add('banner--scrolls');
  let frame = 0;
  const place = () => {
    frame = 0;
    const room = bar.getBoundingClientRect().height + 24;
    let shift: number;
    if (position === 'top') {
      shift = -Math.min(Math.max(window.scrollY, 0), room);
    } else {
      const doc = document.documentElement;
      const height = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
      const toEnd = height - (window.scrollY + window.innerHeight);
      shift = Math.min(Math.max(toEnd, 0), room);
    }
    bar.style.setProperty('--banner-shift', `${Math.round(shift)}px`);
  };
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(place);
  };
  window.addEventListener('scroll', soon, { passive: true });
  window.addEventListener('resize', soon);
  place();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', soon);
    window.removeEventListener('resize', soon);
  };
}

/**
 * "2d 04h 12m 09s" to a moment, ticking each second. At zero it calls
 * `ended`, unless it is to stay showing zero.
 */
export function countdownTimer(
  until: number,
  options: { keep: boolean; ended: () => void; now?: () => number },
): { el: HTMLElement; stop: () => void } {
  const now = options.now ?? Date.now;
  const el = h('span', { class: 'banner__countdown', role: 'timer' });
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const draw = () => {
    const left = Math.max(0, until - now());
    const { days, hours, minutes, seconds } = split(left);
    const parts: [number, string, string][] = [
      ...(days > 0 ? [[days, 'd', days === 1 ? 'day' : 'days'] as [number, string, string]] : []),
      [hours, 'h', hours === 1 ? 'hour' : 'hours'],
      [minutes, 'm', minutes === 1 ? 'minute' : 'minutes'],
      [seconds, 's', seconds === 1 ? 'second' : 'seconds'],
    ];
    el.replaceChildren(
      ...parts.map(([value, unit], i) =>
        h(
          'span',
          { class: 'banner__unit' },
          h('b', { text: i === 0 && days > 0 ? String(value) : String(value).padStart(2, '0') }),
          unit,
        ),
      ),
    );
    // Read out in words, and only to the minute: a ticking second is noise.
    el.setAttribute(
      'aria-label',
      left > 0
        ? `Ends in ${
            parts
              .filter(([value, unit]) => unit !== 's' && value > 0)
              .map(([value, , word]) => `${value} ${word}`)
              .join(' ') || 'less than a minute'
          }`
        : 'Ended',
    );
    if (left <= 0) {
      stop();
      if (!options.keep) options.ended();
    }
  };
  draw();
  if (until > now()) timer = setInterval(draw, 1000);
  return { el, stop };
}

function split(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}
