/**
 * Styles for proactive message bubbles (proactive.ts).
 *
 * They sit in the widget's own shadow root, stacked above the launcher on the
 * same side as it, and use the widget's tokens so they follow Appearance and
 * the reader's light or dark theme. Kept apart from styles.ts because they
 * only matter when a support extension offers messages.
 */

import { duration, easing } from '@helpwell/tokens';

export const PROACTIVE_CSS = `
.pro-stack {
  position: absolute;
  bottom: 84px;
  inset-inline-end: 0;
  width: min(364px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
:host([data-position$='-left']) .pro-stack { inset-inline-end: auto; inset-inline-start: 0; }
:host([data-position^='top-']) .pro-stack { bottom: auto; top: 84px; }
.pro-stack[hidden] { display: none; }

.pro-bubble {
  position: relative;
  padding: 16px;
  border-radius: 20px;
  background: var(--hw-surface);
  color: var(--hw-ink);
  border: 1px solid var(--hw-hairline);
  box-shadow: var(--hw-shadow-float);
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-wrap: anywhere;
  animation: hw-pro-in ${duration.message}ms ${easing.spring} both;
}
.pro-bubble--replyable { cursor: pointer; }
.pro-bubble--replyable:hover { border-color: var(--hw-accent-line); }

.pro-bubble__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-inline-end: 38px;
}
.pro-bubble__who { display:flex;flex-direction:column;min-width:0;line-height:1.3; }
.pro-bubble__name { font-weight: 700; font-size: 13.5px; }
.pro-bubble__sub { font-size:11.5px;color:var(--hw-muted); }

.pro-avatar {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.pro-avatar img { width: 32px; height: 32px; object-fit: cover; border-radius: 999px; }
.pro-avatar--mark svg { width: 32px; height: 32px; }
.pro-avatar--initials {
  border-radius: 999px;
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  font-size: 11px;
  font-weight: 700;
}

.pro-bubble__body { color: var(--hw-ink); line-height: 1.55; }
.pro-bubble__body > :first-child { margin-top: 0; }
.pro-bubble__body > :last-child { margin-bottom: 0; }
.pro-bubble__body p { margin: 0 0 6px; }
.pro-bubble__body img { display: block; max-width: 100%; max-height: 160px; border-radius: 8px; }
.pro-bubble__body a { color: var(--hw-accent); }

.pro-bubble__close {
  position: absolute;
  top: 16px;
  inset-inline-end: 16px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--hw-inner);
  color: var(--hw-muted);
}
.pro-bubble__close:hover { background: var(--hw-inner); color: var(--hw-ink); }
.pro-bubble__close svg { width: 14px; height: 14px; }

.pro-bubble__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pro-button {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  background: var(--hw-inner);
  color: var(--hw-ink);
}
.pro-button:hover { background: var(--hw-control); }
.pro-button--reply { background: var(--hw-accent); color: #fff; }
.pro-button--reply:hover { background: var(--hw-accent-hover); }
/* A quick reply: the visitor's own words, drawn the way their messages are. */
.pro-button--quick { background: var(--hw-surface); color: var(--hw-accent-hover); box-shadow: inset 0 0 0 1.5px var(--hw-accent-line); }
.pro-button--quick:hover { background: var(--hw-accent-soft); }
.pro-reply { display:flex;align-items:center;gap:8px;height:42px;padding:0 6px 0 14px;border:1px solid var(--hw-hairline);border-radius:14px;background:var(--hw-inner); }
.pro-reply input { flex:1;min-width:0;height:100%;border:0;background:transparent;color:var(--hw-ink);font:inherit;font-size:13px;padding:0;outline:none; }
.pro-reply input::placeholder { color:var(--hw-muted); }
.pro-reply:focus-within { outline:2px solid var(--hw-accent);outline-offset:2px; }
.pro-reply__send { display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:10px;background:var(--hw-accent);color:#fff; }
.pro-reply__send svg { width:16px;height:16px; }

@keyframes hw-pro-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .pro-bubble { animation: none; }
}
@media (max-width: 480px) {
  .pro-stack { bottom: 68px; }
}
`;
