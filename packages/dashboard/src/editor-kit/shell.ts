/**
 * The editor page: the canvas's top bar, and its three columns (the thing
 * being made, the settings that decide who sees it, the live preview).
 *
 * `editorShell` returns the inside of the page's own `<form>`, so the form
 * keeps its action, its fields and its parser; the page wraps it:
 *
 *   html`<form class="ek-editor" method="post" …>${editorShell({ basePath, main, side, preview })}</form>`
 *
 * The `.ek-editor` class on that form is what turns the dashboard rail into
 * the icon rail and the header into the white top bar, on this page only.
 * `editorTopbar` goes in the page header (`PageHeader.lead`), and the page's
 * header `actions` hold its buttons (`kitButton({ look: 'primary', form })`).
 */

import { html, join, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { clientScript } from '../client/index.js';
import { kitIcon } from './icons.js';

export function editorShell(options: {
  /** Where the dashboard is mounted, for the script that marks the page first. */
  basePath: string;
  /** The wide column: the type tiles, then the cards that make the thing. */
  main: RawHtml;
  /** The 340px column: "who sees it, and when". */
  side: RawHtml;
  /** The preview column, from `previewPanel`. */
  preview: RawHtml;
}): RawHtml {
  // Before the editor is drawn, so script-only states apply from the first paint.
  return html`${clientScript(options, 'editor-mark')}<div class="ek-layout">
  <div class="ek-work">
    <div class="ek-col ek-col--main">${options.main}</div>
    <div class="ek-col ek-col--side">${options.side}</div>
  </div>
  ${options.preview}
</div>`;
}

export interface TopbarOptions {
  /** The back arrow's target and name. */
  back: { href: string; label: string };
  /** The trail before the title: "Engage › Messages". */
  crumbs: readonly { label: string; href?: string }[];
  /** The thing's name: the page's h1. */
  title: string;
  /** A status chip after the title: Live, Paused, New. */
  state?: { label: string; tone: 'good' | 'info' | 'neutral' | 'warn' } | null;
  /**
   * The saved-state line ("Saved just now"). `dirty` is what it says once
   * something changes, which the kit's script swaps in.
   */
  note?: { text: string; tone?: 'good' | 'warn' | 'bad'; dirty?: string } | null;
}

/** The canvas's top bar: ← Crumb › Crumb › **Name** [Live] ● Saved. For `PageHeader.lead`. */
export function editorTopbar(options: TopbarOptions): RawHtml {
  const chevron = raw(kitIcon('chev-r', 12, 2));
  return html`<div class="ek-topbar">
  <a class="ek-back" href="${raw(safeHref(options.back.href))}" aria-label="${options.back.label}" title="${options.back.label}">${raw(
    kitIcon('arrow-l', 18),
  )}</a>
  <div class="ek-crumb">${join(
    options.crumbs.map(
      (c) =>
        html`${c.href ? html`<a href="${raw(safeHref(c.href))}">${c.label}</a>` : html`<span>${c.label}</span>`}${chevron}`,
    ),
  )}<h1 class="ek-crumb__title">${options.title}</h1></div>
  ${options.state ? html`<span class="ek-state ek-state--${options.state.tone}">${options.state.label}</span>` : null}
  ${
    options.note
      ? html`<span class="ek-note" data-ek-status${options.note.tone ? html` data-tone="${options.note.tone}"` : null}${
          options.note.dirty ? html` data-dirty-text="${options.note.dirty}"` : null
        } role="status">${options.note.text}</span>`
      : null
  }
</div>`;
}
