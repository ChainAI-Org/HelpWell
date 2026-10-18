/**
 * The transitions.dev skeleton loader, verbatim apart from one addition: a few
 * shape classes drawn with the HelpWell tokens.
 *
 * Used only where something genuinely waits. A view whose data is already in
 * the response renders immediately and never flashes a skeleton.
 */

export const SKELETON_CSS = `
:root {
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

/* HelpWell's skeleton shapes. */
.sk-bar { height: 11px; border-radius: 999px; background: var(--hw-hairline); margin-bottom: 9px; }
.sk-bar--title { height: 17px; width: 62%; margin-bottom: 14px; }
.sk-bar--short { width: 45%; }
.sk-bar--mid { width: 78%; }
.sk-row { height: 46px; border-radius: 12px; background: var(--hw-hairline); margin-bottom: 8px; }
.sk-card { height: 92px; border-radius: 16px; background: var(--hw-hairline); margin-bottom: 12px; }
`;
