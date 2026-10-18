/**
 * Styles for the engage pages. The editor is drawn with the editor kit, and
 * its stylesheet comes first (the design's cards, controls and columns);
 * this adds what is particular to engagements (blocks, buttons, branches,
 * which trigger settings show) and the list, gallery and results pages.
 * Colours are the dashboard's tokens, so dark mode needs nothing here.
 *
 * Which of a trigger's settings show, and whether a button needs a link, is
 * decided here from the checked radio with `:has()`, so the form reads right
 * before any script runs.
 */

import { type RawHtml, raw } from '@helpwell/ui';
import { editorKitStyles } from '../editor-kit/index.js';

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

export function engageStyles(): RawHtml {
  // Each trigger shows its own settings: the first picks its type from chips,
  // each further one from a drop-down.
  const chosen = (t: string) =>
    `.eg-trig:is(:has(input[data-trigger-type][value='${t}']:checked), :has(select[data-trigger-type] option[value='${t}']:checked))`;
  const triggerRules = TRIGGER_TYPES.map(
    (t) =>
      `${chosen(t)} div[data-for-trigger~='${t}'] { display: block; }\n` +
      `${chosen(t)} span[data-for-trigger~='${t}'] { display: inline-flex; }`,
  ).join('\n');
  return raw(`${editorKitStyles().value}<style>
/* ------------------------------------------------------------- editor */
.eg-blocks { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.eg-blocks__empty { margin: 0; }
.eg-blocks__add { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding-top: 2px; }
.eg-blocks__addlabel { display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; font-size: 11.5px; font-weight: 600; color: var(--hw-muted); }
.eg-blocks__add .ek-choice { height: 24px; padding: 0 8px; font-size: 11px; }
.eg-block { scroll-margin-top: 90px; }
.eg-block .ek-field__aside { gap: 0; }
.eg-block__hint { margin-right: 4px; }
.eg-block .ek-mini--bare { height: 22px; padding: 0 4px; color: var(--hw-muted); }
.eg-block .ek-mini--bare[data-tone='danger']:hover, .ek-card__meta .ek-mini--bare[data-tone='danger']:hover { color: var(--hw-bad); background: var(--hw-bad-bg); }
.ek-card__meta .ek-mini--bare { color: var(--hw-muted); }
.eg-divider { display: block; height: 1px; margin: 6px 0; background: var(--hw-hairline); }
.eg-buttons { display: flex; flex-direction: column; gap: 10px; }
.eg-button { display: flex; flex-direction: column; gap: 8px; }
.eg-button + .eg-button { padding-top: 10px; border-top: 1px dashed var(--hw-hairline); }
.eg-button__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.eg-button__row > .ek-input { width: 120px; flex: none; }
.eg-button__value { flex: 1; min-width: 180px; gap: 4px; }
.eg-button__row > .ek-seg { flex: 0 1 auto; overflow-x: auto; scrollbar-width: none; }
.eg-button__row > .ek-pop { margin-left: auto; }
.eg-button__where, .eg-button__newtab { display: none; }
.eg-button:has(input[data-en-action][value='url']:checked) :is(.eg-button__where, .eg-button__newtab),
.eg-button:has(input[data-en-action][value='article']:checked) .eg-button__where,
.eg-button:has(input[data-en-action][value='tour']:checked) .eg-button__where { display: flex; }
.eg-button__value { flex-direction: column; }
.eg-look-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
.eg-look-row > .ek-field--inline { flex: 0 1 auto; justify-content: flex-start; }
.eg-look-row--wrap { align-items: flex-start; justify-content: flex-start; }
.eg-look-row--wrap > .ek-field { flex: 0 1 auto; }
.eg-unit { font-size: 12px; color: var(--hw-muted); white-space: nowrap; }
.eg-colour { display: flex; align-items: center; gap: 8px; }
.eg-colour input[type='color'] { width: 36px; height: 36px; padding: 2px; border: 1px solid var(--ek-edge); border-radius: 10px; background: var(--hw-surface); cursor: pointer; flex: none; }
.eg-followup { display: none; flex-direction: column; gap: 10px; padding-left: 42px; }
.ek-card:has(input[name$='.followUp.enabled:bool'][type='checkbox']:checked) .eg-followup { display: flex; }
.eg-branch { display: flex; flex-direction: column; gap: 4px; }
.eg-arrow { display: flex; color: var(--hw-muted); }
.eg-branch-add { padding-left: 42px; }
.eg-branch .ek-filter { flex-wrap: nowrap; }
.eg-branch .ek-filter .ek-choices { flex: 1; flex-wrap: wrap; }
.eg-branch select.ek-pill { flex: 1 1 120px; min-width: 0; text-overflow: ellipsis; }
.eg-conditions { container-type: inline-size; }
.eg-condition { flex-wrap: nowrap; }
.eg-condition .ek-pill--grow { min-width: 0; flex: 1 1 90px; }
.eg-condition .ek-pill--op { flex: 0 1 108px; min-width: 0; }
.eg-condition__value { flex: 1 1 70px; min-width: 0; width: 70px; }
.eg-condition .ek-pill--num { width: 52px; flex: none; }
/* In a narrow column the value and its days go on a second line, under the field. */
@container (max-width: 480px) {
  .eg-condition { flex-wrap: wrap; row-gap: 6px; }
  .eg-condition .ek-pill--grow, .eg-condition .ek-pill--op { flex: 1 1 100px; }
  .eg-condition__value { flex: 1 0 55%; width: auto; margin-left: 42px; }
}
html.ek-js .eg-condition[data-en-spare] { display: none; }
html.ek-js .eg-condition-add[hidden] { display: inline-flex; }
.eg-conditions .ek-field__aside { gap: 6px; }
.eg-match { height: 26px; font-size: 11.5px; }
div[data-for-trigger], span[data-for-trigger] { display: none; }
${triggerRules}
.eg-trigger { min-width: 0; }
.eg-trigger .db-code { margin-top: 8px; }
.eg-trigger .ek-field__hint { margin-top: 6px; }
.eg-trig { display: flex; flex-direction: column; gap: 10px; min-width: 0; scroll-margin-top: 90px; }
.eg-trig[data-more] { padding-top: 12px; border-top: 1px dashed var(--hw-hairline); }
.eg-trig__head .ek-filter { flex-wrap: nowrap; }
.eg-trig__head select.ek-pill { flex: 1 1 140px; min-width: 0; }
.eg-trig-add { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.eg-trig-add .ek-field__hint { margin: 0; }
[data-for-frequency] { display: none; }
.ek-sum__panel:has([data-frequency-mode] option[value='every']:checked) [data-for-frequency] { display: flex; }
.eg-date { width: 168px; flex: none; padding: 0 8px 0 10px; font-size: 12px; }
.eg-id { display: inline-flex; align-items: center; height: 36px; padding: 0 11px; border-radius: 10px; background: var(--hw-inner); border: 1px solid var(--hw-hairline); font-size: 12px; }
.eg-missing { display: flex; flex-direction: column; gap: 8px; }
.eg-missing[hidden] { display: none; }
.eg-missing .db-notice { margin: 0; }

/* ------------------------------------------------ list, gallery, results */
.en-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 14px; align-items: start; }
.en-number { max-width: 140px; }
.en-list__name { font-weight: 650; }
.en-list__id { display: block; font-size: 12px; }
.en-inline-form { margin: 0; }
.en-switch { padding: 0; }
.en-settings { margin-bottom: 14px; }
.en-settings > summary { cursor: pointer; display: flex; gap: 10px; align-items: baseline; list-style: none; }
.en-settings > summary::-webkit-details-marker { display: none; }
.en-settings > summary .db-card__title { margin: 0; }
.en-limit { margin-bottom: 8px; }
.en-gallery { margin-bottom: 24px; }
.en-gallery__head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.en-gallery__title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0; }
.en-gallery__hint { margin: 0; font-size: 12.5px; color: var(--hw-muted); }
.en-gallery__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.en-template { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px; border: 1px solid var(--hw-hairline); border-radius: 16px; background: var(--hw-surface); text-decoration: none; color: inherit; box-shadow: var(--ek-shadow); transition: border-color 160ms ease, box-shadow 160ms ease; }
.en-template:hover { border-color: var(--hw-accent-line); box-shadow: 0 0 0 3px var(--ek-ring); }
.en-template__pic { flex: none; width: 96px; }
.en-template__pic .ek-sketch { height: 56px; }
.en-template__pic--blank { display: grid; place-items: center; height: 56px; border-radius: 7px; border: 1.5px dashed var(--hw-accent-line); color: var(--hw-accent-hover); }
.en-template__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.en-template__title { font-size: 13.5px; font-weight: 600; color: var(--hw-ink); }
.en-template__desc { font-size: 12.5px; line-height: 1.45; color: var(--hw-muted); }
.en-template--blank { background: var(--hw-inner); box-shadow: none; }
.en-big { font-size: 30px; font-weight: 700; margin: 0; letter-spacing: -.02em; }
.en-comments { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.en-comments li { padding: 10px 12px; border-radius: 12px; background: var(--hw-inner); font-size: 13.5px; }
</style>`);
}
