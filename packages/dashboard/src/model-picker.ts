/**
 * The model picker: which OpenRouter model answers, writes docs, stands in
 * as the fallback, and makes embeddings.
 *
 * Model ids change faster than any list HelpWell could ship, so the picker
 * reads OpenRouter's live catalogue through the API (`GET /admin/models`,
 * which uses the install's own key and caches for ten minutes). It is a
 * searchable combobox: a button showing the current model opens a dropdown
 * with its own search box at the top, and the list below, newest first,
 * with each model's age, price and context length. A model id that is not
 * listed can still be typed and used.
 *
 * It is built on a plain text input carrying the `data-patch` path, which is
 * what saves. Without JavaScript, without a key, or when OpenRouter cannot be
 * reached, that text input is what the page shows, with a line saying why.
 */

import { html, icon, MONO_STACK, type RawHtml, raw } from '@helpwell/ui';
import { clientScript } from './client/index.js';
import type { DashboardContext } from './layout.js';

export type ModelKind = 'chat' | 'embeddings';

export interface ModelFieldOptions {
  /** The settings path the choice saves to, e.g. `agent.models.chat`. */
  patch: string;
  /** Which list to offer: chat models, or embedding models. */
  kind: ModelKind;
  /** Whether the install has an OpenRouter key. Without one there is no list to read. */
  keySet: boolean;
  hint?: string;
  placeholder?: string;
}

/** A labelled model field: the picker when a key is set, the text box otherwise. */
export function modelField(
  context: Pick<DashboardContext, 'apiPath'>,
  label: string,
  name: string,
  value: string,
  options: ModelFieldOptions,
): RawHtml {
  const id = `db-model-${name}`;
  const url = `${context.apiPath}/admin/models?kind=${options.kind}`;
  return html`<div class="db-field db-model" ${
    options.keySet ? html`data-model-picker="${url}" data-model-kind="${options.kind}"` : null
  }>
  <label class="db-field__label" for="${id}">${label}</label>
  <input class="db-input db-model__input" id="${id}" type="text" name="${name}" value="${value}" placeholder="${options.placeholder ?? 'vendor/model'}" spellcheck="false" autocomplete="off" data-patch="${options.patch}">
  ${
    options.keySet
      ? html`<div class="db-model__box"><button type="button" class="db-model__trigger" hidden aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label ${id}-value">
      <span class="db-model__current" id="${id}-value"><span class="db-model__name"></span><code class="db-model__id">${value}</code></span>
      ${raw(icon('chevron', 15))}
    </button>
    <div class="db-model__pop" hidden>
      <div class="db-model__search">
        ${raw(icon('search', 15))}
        <input type="search" placeholder="Search ${options.kind === 'embeddings' ? 'embedding models' : 'models'}" aria-label="Search models" role="combobox" aria-expanded="true" aria-controls="${id}-list" aria-autocomplete="list" autocomplete="off" spellcheck="false">
      </div>
      <ul class="db-model__list" id="${id}-list" role="listbox" aria-label="${label}"></ul>
      <p class="db-model__foot" role="status"></p>
    </div></div><span hidden id="${id}-label">${label}</span>`
      : null
  }
  <span class="db-field__hint" data-model-hint>${
    options.keySet
      ? (options.hint ?? '')
      : `${options.hint ? `${options.hint} ` : ''}Set OPENROUTER_API_KEY to pick from OpenRouter's live list; until then, type a model id.`
  }</span>
</div>`;
}

/**
 * The picker's styles and behaviour, once per page that has one. Kept out of
 * the shell's island because only two screens use it. The behaviour is
 * client/model-picker.ts, served as a file (client/index.ts).
 */
export function modelPickerAssets(context: Pick<DashboardContext, 'basePath'>): RawHtml {
  return raw(`<style>${MODEL_PICKER_CSS}</style>
${clientScript(context, 'model-picker').value}`);
}

const MODEL_PICKER_CSS = `
.db-model__box { position: relative; }
.db-model__trigger {
  display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 40px; padding: 6px 12px; border-radius: 10px; border: 1px solid transparent;
  background: var(--hw-control); color: var(--hw-ink); text-align: start; cursor: pointer;
}
.db-model__trigger:hover { border-color: var(--hw-hairline); }
.db-model__trigger[aria-expanded='true'], .db-model__trigger:focus-visible {
  border-color: var(--hw-accent-line); background: var(--hw-surface); outline: none;
}
.db-model__trigger svg { flex: none; color: var(--hw-muted); transform: rotate(90deg); }
.db-model__current { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow: hidden; line-height: 1.3; }
.db-model__name { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-model__name:empty { display: none; }
.db-model__id { font-size: 11.5px; color: var(--hw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: none; padding: 0; }
.db-model__name:empty + .db-model__id { color: var(--hw-ink); font-size: 13px; }
.db-model__pop {
  position: absolute; z-index: 40; top: calc(100% + 6px); inset-inline-start: 0;
  width: max(100%, min(460px, calc(100vw - 48px)));
  background: var(--hw-surface); border-radius: 18px; padding: 6px;
  box-shadow: var(--hw-shadow-float); border: 1px solid var(--hw-card-edge);
  animation: db-model-in 160ms cubic-bezier(.2,.8,.2,1) both;
}
@keyframes db-model-in { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
.db-model__search {
  display: flex; align-items: center; gap: 8px; margin: 2px 2px 6px; padding: 0 12px;
  height: 38px; border-radius: 999px; background: var(--hw-control); color: var(--hw-muted);
}
.db-model__search input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font: inherit; color: var(--hw-ink); }
.db-model__search input::-webkit-search-cancel-button { display: none; }
.db-model__list { list-style: none; margin: 0; padding: 0; max-height: 340px; overflow-y: auto; }
.db-model__option {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px;
  padding: 8px 12px; border-radius: 12px; cursor: pointer;
}
.db-model__option[data-active='true'] { background: var(--hw-surface); box-shadow: var(--hw-shadow-raised); }
.db-model__option[aria-selected='true'] { background: var(--hw-accent-soft); }
.db-model__option[aria-selected='true'] .db-model__oname { color: var(--hw-accent-hover); font-weight: 700; }
.db-model__oname { font-weight: 620; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-model__oid { grid-column: 1; font-family: ${MONO_STACK}; font-size: 11.5px; color: var(--hw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-model__ometa { grid-column: 2; grid-row: 1 / span 2; align-self: center; text-align: end; font-size: 11.5px; color: var(--hw-muted); line-height: 1.4; white-space: nowrap; }
.db-model__tag { display: inline-block; margin-inline-start: 6px; padding: 0 6px; border-radius: 999px; background: var(--hw-control); font-size: 10.5px; font-weight: 650; color: var(--hw-ink2); vertical-align: 1px; }
.db-model__foot { margin: 6px 10px 4px; font-size: 11.5px; color: var(--hw-muted); }
.db-model__foot:empty { display: none; }
@media (prefers-reduced-motion: reduce) { .db-model__pop { animation: none; } }
`;
