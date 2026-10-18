/**
 * The editor kit: the pieces the dashboard's editors are built from, drawn
 * as the design canvas draws them (canvas/build/engage_shell.py).
 *
 * The Engage editor is built on it, and the form builder uses the same
 * pieces, so every editor has the same top bar, cards, controls, composer,
 * media blocks, lists, "who sees it, and when" column and preview.
 *
 * Every function returns escaped `RawHtml` and takes plain values plus the
 * form field `name`s to use: the kit draws controls, the page owns its form,
 * its parser and its routes. On a page:
 *
 *   ${editorKitStyles()}                  once, before the editor
 *   <form class="ek-editor" …>            the page's own form, with this class
 *     ${editorShell({ basePath, main, side, preview })}
 *   </form>
 *   ${editorKitScript(context)}           once, after it (a served file, not inline)
 *
 * and `editorTopbar(…)` as the page header's `lead`, with the page's buttons
 * (`kitButton({ look: 'primary', form: '<form id>' … })`) as its `actions`.
 *
 * Hooks the script reads, for pages that go beyond the kit's own markup:
 *   data-ek-upload-url on the form     where media uploads post (`{ url }` back)
 *   form.ek-editor                     tracks unsaved changes for the top bar
 *   [data-ek-ignore]                   changes inside it are not "unsaved"
 *   events: `ek:select` (a list panel was chosen), `ek:device` (preview size)
 */

export { type CardOptions, card, glyph, type Tone, type TypeChoice, typeTiles } from './card.js';
export {
  type ComposerOptions,
  type ComposerTools,
  composer,
  composerHtml,
  isSimpleMarkdown,
  plainLength,
} from './composer.js';
export {
  type ButtonOptions,
  type ChipLook,
  type Choice,
  chip,
  choiceChips,
  type FieldOptions,
  field,
  filterRow,
  type InputOptions,
  kitButton,
  menu,
  pill,
  pillInput,
  popover,
  type SegmentedOptions,
  segmented,
  segmentedButtons,
  selectInput,
  settingRow,
  sketch,
  type TileChoice,
  type ToggleOptions,
  textArea,
  textInput,
  tilePicker,
  toggle,
} from './controls.js';
export { isKitIcon, type KitIconName, kitIcon } from './icons.js';
export { type ListOptions, list, listRow, listThumb, panels, type RowOptions } from './lists.js';
export {
  describeMedia,
  type MediaBlockOptions,
  type MediaKind,
  mediaBlock,
  safeMediaSrc,
} from './media.js';
export { type PreviewPanelOptions, performanceCard, previewPanel, type Stat } from './preview.js';
export { editorKitScript } from './script.js';
export { editorShell, editorTopbar, type TopbarOptions } from './shell.js';
export { editorKitStyles } from './styles.js';
export { type SummaryRowOptions, summaryColumn, summaryRow } from './summary.js';
