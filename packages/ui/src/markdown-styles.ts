/**
 * How the Markdown blocks look: callouts, steps, tabs, accordions and video.
 *
 * The renderer draws them with the same class names wherever they appear, so
 * the styles are one string too. The help centre inlines it under its article
 * body and the dashboard under its preview, which is how the editor's preview
 * matches the published page.
 *
 * The widget renders the same markup without these rules and still reads
 * correctly: a callout there is a blockquote, tabs are disclosures, a video is
 * a link. That is why the markup was chosen to degrade.
 *
 * Colours are the token custom properties, so dark mode needs nothing extra.
 * Callouts are tinted boxes rather than a bar down one side.
 */

/** The block styles, every selector prefixed with `scope` (e.g. `.hc-body`). */
export function markdownBlockStyles(scope: string): string {
  const s = scope.trim();
  return `
${s} .hc-callout {
  margin: 0 0 16px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--hw-info-bg);
  color: var(--hw-ink2);
}
${s} .hc-callout > :last-child { margin-bottom: 0; }
${s} .hc-callout__title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 4px;
  font-weight: 700;
  color: var(--hw-info);
}
${s} .hc-callout__title:last-child { margin: 0; }
${s} .hc-callout__title svg { flex: none; }
${s} .hc-callout--tip { background: var(--hw-good-bg); }
${s} .hc-callout--tip .hc-callout__title { color: var(--hw-good); }
${s} .hc-callout--important { background: var(--hw-accent-soft); }
${s} .hc-callout--important .hc-callout__title { color: var(--hw-deep-violet); }
${s} .hc-callout--warning { background: var(--hw-warn-bg); }
${s} .hc-callout--warning .hc-callout__title { color: var(--hw-warn); }
${s} .hc-callout--caution { background: var(--hw-bad-bg); }
${s} .hc-callout--caution .hc-callout__title { color: var(--hw-bad); }

${s} ol.hc-steps, ${s} div.hc-steps > ol {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  counter-reset: hc-step;
}
${s} ol.hc-steps > li, ${s} div.hc-steps > ol > li {
  position: relative;
  margin: 0 0 18px;
  padding-inline-start: 42px;
  counter-increment: hc-step;
}
${s} ol.hc-steps > li::before, ${s} div.hc-steps > ol > li::before {
  content: counter(hc-step);
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}
${s} .hc-step__title { margin: 2px 0 6px; font-size: 17px; }
${s} .hc-step__body > :last-child { margin-bottom: 0; }

${s} .hc-tabs {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 16px;
  padding: 6px;
  border: 1px solid var(--hw-hairline);
  border-radius: 14px;
  background: var(--hw-surface);
}
${s} .hc-tab { display: contents; }
${s} .hc-tab__radio {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
${s} .hc-tab__label {
  order: 0;
  padding: 6px 12px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--hw-muted);
}
${s} .hc-tab__label:hover { color: var(--hw-ink); }
${s} .hc-tab__radio:checked + .hc-tab__label {
  background: var(--hw-accent-soft);
  color: var(--hw-deep-violet);
}
${s} .hc-tab__radio:focus-visible + .hc-tab__label {
  outline: 2px solid var(--hw-accent);
  outline-offset: 1px;
}
${s} .hc-tab__panel {
  order: 1;
  flex: 1 0 100%;
  display: none;
  padding: 12px 10px 0;
}
${s} .hc-tab__radio:checked ~ .hc-tab__panel { display: block; }
${s} .hc-tab__panel > :last-child { margin-bottom: 8px; }

${s} .hc-accordion {
  margin: 0 0 10px;
  border: 1px solid var(--hw-hairline);
  border-radius: 12px;
  background: var(--hw-surface);
}
${s} .hc-accordion > summary {
  cursor: pointer;
  padding: 11px 14px;
  font-weight: 650;
  color: var(--hw-ink);
}
${s} .hc-accordion[open] > summary { border-bottom: 1px solid var(--hw-hairline); }
${s} .hc-accordion__body { padding: 12px 14px 0; }
${s} .hc-accordion__body > :last-child { margin-bottom: 12px; }

${s} .hc-video { margin: 0 0 18px; }
${s} .hc-video__frame {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid var(--hw-hairline);
  background: var(--hw-inner);
}
${s} .hc-video__frame iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
${s} .hc-video video { display: block; width: 100%; border-radius: 14px; background: #000; }
${s} .hc-video figcaption {
  margin-top: 8px;
  font-size: 13.5px;
  color: var(--hw-muted);
  text-align: center;
}
${s} .hc-video-link a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
${s} .hc-video-link__via { color: var(--hw-muted); font-weight: 500; }
`;
}
