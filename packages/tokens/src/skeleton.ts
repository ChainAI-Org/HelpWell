/**
 * The transitions.dev skeleton loader and reveal.
 *
 * Usage:
 *   <div class="t-skel" data-state="loading">
 *     <div class="t-skel-skeleton is-pulsing">…</div>
 *     <div class="t-skel-content">…</div>
 *   </div>
 *
 * State:
 *   - Mount with `.is-pulsing` on the skeleton so it pulses --pulse-count times.
 *   - When data arrives, add `.is-revealed` to .t-skel: the skeleton fades out
 *     and blurs, the content fades in and un-blurs, over --reveal-dur.
 *   - To replay the loading state without animating the reverse: add
 *     `.is-resetting` to .t-skel, remove `.is-revealed`, force a reflow, then
 *     drop `.is-resetting`.
 *
 * Bring your own avatar / text / wrapping. The skeleton stays in the same flex
 * slot as the content so the swap is layout-free.
 *
 * This string is the single source: the package's `skeleton.css` is written
 * from it at build time, and the widget takes it with `:host` in place of
 * `:root`, because `:root` does not exist inside a Shadow DOM.
 */

const SKELETON = `:root {
  --pulse-dur: 1000ms;
  --pulse-count: 1;
  --pulse-min: 0.5;
  --reveal-dur: 400ms;
  --reveal-blur: 2px;
  --reveal-ease: ease-in-out;
}

.t-skel { position: relative; }
.t-skel-skeleton,
.t-skel-content { position: absolute; inset: 0; }

.t-skel-skeleton {
  z-index: 1;
  opacity: 1;
  filter: blur(0);
  transition:
    opacity var(--reveal-dur) var(--reveal-ease),
    filter var(--reveal-dur) var(--reveal-ease);
}
.t-skel-content {
  z-index: 2;
  opacity: 0;
  filter: blur(var(--reveal-blur));
  transition:
    opacity var(--reveal-dur) var(--reveal-ease),
    filter var(--reveal-dur) var(--reveal-ease);
}
.t-skel.is-revealed .t-skel-skeleton {
  opacity: 0;
  filter: blur(var(--reveal-blur));
}
.t-skel.is-revealed .t-skel-content {
  opacity: 1;
  filter: blur(0);
}
.t-skel.is-resetting .t-skel-skeleton,
.t-skel.is-resetting .t-skel-content {
  transition: none !important;
}

.t-skel-skeleton.is-pulsing > * {
  animation: t-skel-pulse var(--pulse-dur) ease-in-out var(--pulse-count);
}
@keyframes t-skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: var(--pulse-min); }
}

@media (prefers-reduced-motion: reduce) {
  .t-skel-skeleton,
  .t-skel-content { transition: none !important; }
  .t-skel-skeleton.is-pulsing > * { animation: none !important; }
}
`;

/**
 * The skeleton stylesheet, with its custom properties declared on `selector`.
 * Pass `:host` for a shadow root.
 */
export function skeletonCss(selector = ':root'): string {
  return SKELETON.replace(/^:root \{/, `${selector} {`);
}
