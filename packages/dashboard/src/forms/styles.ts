/**
 * Styles for the forms pages. The builder is drawn with the editor kit
 * (editor-kit/styles.ts: cards, controls, columns, preview) and the engage
 * editor's blocks and conditions (engage/styles.ts); this adds only what a
 * form has and they do not: the kind tiles as radios, rows of inline
 * choices, colour pickers, bonus actions, variants, the preview's placement
 * switch, and the list and gallery pages. A chosen tile is a lavender fill
 * with a violet ring, as everywhere else; nothing here draws a coloured edge.
 */

import { type RawHtml, raw } from '@helpwell/ui';

const TRIGGER_TYPES = [
  'load',
  'delay',
  'scroll',
  'exit',
  'time_on_page',
  'inactivity',
  'click',
  'event',
  'manual',
];

export function formsStyles(): RawHtml {
  // Which of a trigger's settings show follows the checked chip, before any
  // script runs. Keyed on this page's own class, so it does not lean on how
  // the engage page names its rules.
  const triggerRules = TRIGGER_TYPES.map(
    (t) =>
      `.fb-editor .ek-sum__panel:has(input[data-trigger-type][value='${t}']:checked) div[data-for-trigger~='${t}'] { display: block; }\n` +
      `.fb-editor .ek-sum__panel:has(input[data-trigger-type][value='${t}']:checked) span[data-for-trigger~='${t}'] { display: inline-flex; }`,
  ).join('\n');
  return raw(`<style>
/* ------------------------------------------------------------- builder */
.fb-types { --ek-count: 5; }
@media (max-width: 520px) { .fb-types { --ek-count: 3; } }
.fb-type { position: relative; cursor: pointer; }
.fb-type input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.fb-type:hover { border-color: var(--hw-accent-line); color: var(--hw-ink); }
.fb-type:has(input:checked) { border-color: var(--hw-accent); background: var(--ek-on); box-shadow: 0 0 0 3px var(--ek-ring); color: var(--hw-ink); }
.fb-type:has(input:focus-visible) { outline: 2px solid var(--hw-accent); outline-offset: 2px; }
.fb-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
.fb-row > .ek-field--inline { flex: 0 1 auto; justify-content: flex-start; }
.fb-subhead { display: flex; flex-direction: column; gap: 2px; }
.fb-unit { font-size: 12px; color: var(--hw-muted); white-space: nowrap; }
.fb-colours { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 12px; }
@media (max-width: 640px) { .fb-colours { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.fb-colour { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fb-colour input[type='color'] { flex: none; width: 36px; height: 36px; padding: 2px; border: 1px solid var(--ek-edge); border-radius: 10px; background: var(--hw-surface); cursor: pointer; }
.fb-colour .ek-input { min-width: 0; flex: 1; }
.fb-file { display: flex; flex-direction: column; gap: 6px; }
.fb-file .ek-upload__status { font-size: 11.5px; color: var(--hw-muted); }
.fb-action { display: flex; flex-direction: column; gap: 4px; }
.fb-action .ek-filter__word:empty { display: none; }
.fb-action .ek-input--num { width: 60px; }
.fb-variant { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--ek-track); scroll-margin-top: 90px; }
.fb-variant__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fb-id { display: inline-flex; align-items: center; height: 36px; padding: 0 11px; border-radius: 10px; background: var(--hw-inner); border: 1px solid var(--hw-hairline); font-size: 12px; }
.fb-warn { color: var(--hw-warn, #9A6206); }
.fb-trigger { min-width: 0; }
.fb-trigger .ek-filter .ek-input--num { width: 64px; }
.fb-trigger .db-code { margin-top: 8px; }
.fb-trigger .ek-field__hint { margin-top: 6px; }
.fb-editor div[data-for-trigger], .fb-editor span[data-for-trigger] { display: none; }
${triggerRules}
.fb-editor [data-for-frequency] { display: none; }
.fb-editor .ek-sum__panel:has([data-frequency-mode] option[value='every']:checked) [data-for-frequency] { display: flex; }
.fb-editor pre.db-code { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.fb-code { position: relative; }
.fb-code pre.db-code { padding-right: 84px; }
.fb-code .ek-mini { position: absolute; top: 8px; right: 8px; }
.fb-prompts { display: flex; flex-direction: column; gap: 6px; }
.fb-prompt { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--hw-hairline); border-radius: 12px; }
.fb-prompt__label { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--hw-ink); }
.fb-prompt .db-prompt { margin: 0; }
.fb-preview-controls { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--hw-hairline); border-radius: 14px; background: var(--hw-surface); }
.fb-missing { display: flex; flex-direction: column; gap: 8px; }
.fb-missing[hidden] { display: none; }
.fb-missing .db-notice { margin: 0; }
[id^='en-fields.'], [id^='en-giveaway.actions.'], [id^='en-variants.'] { scroll-margin-top: 90px; }

/* ------------------------------------------------------ list and gallery */
.fb-note { margin: 8px 2px 14px; }
.fb-fold > summary { cursor: pointer; list-style: none; }
.fb-fold > summary::-webkit-details-marker { display: none; }
.fb-fold[open] > summary { margin-bottom: 10px; }
.fb-fold form { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.fb-fold .db-field { width: 100%; }
.fb-template-form { display: contents; }
.fb-template { display: grid; gap: 6px; text-align: start; font: inherit; color: inherit; cursor: pointer; width: 100%; }
.fb-template__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--hw-accent-soft); color: var(--hw-accent-hover); }
.fb-template:hover { border-color: var(--hw-accent-line); }
.fb-perf__links { margin: 10px 0 0; font-size: 12.5px; }

/* ------------------------------------------------ results and giveaway */
.fb-results { grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
@media (max-width: 520px) { .fb-results { grid-template-columns: minmax(0, 1fr); } }
.fb-draw { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
.fb-draw .db-field { flex: 0 1 220px; margin: 0; }
.fb-draw .db-btn { margin-bottom: 1px; }
</style>`);
}
