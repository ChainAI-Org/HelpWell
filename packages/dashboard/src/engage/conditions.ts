/**
 * The "who" builder: contact conditions as rows of field, operator and value.
 *
 * It writes the same rule JSON as the contacts page's filter and the
 * segments it saves (core's conditions module), and core's `parseConditions`
 * checks what it produces, so nothing here decides what a rule means. Rows
 * are named for the form parser (`targeting.rules.0.field`...), and an event
 * row is a field of `event:<name>`, as on the contacts page.
 *
 * A rule set the rows cannot show (groups inside groups, from a config file
 * or the API) is edited as JSON instead, rather than flattened and lost.
 */

import {
  type Condition,
  type ConditionGroup,
  type ContactField,
  childrenOf,
  DATE_OPERATORS,
  EVENT_OPERATORS,
  type EventOperator,
  type FieldOperator,
  isEventCondition,
  isGroup,
  LIST_OPERATORS,
  NUMBER_OPERATORS,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
  TEXT_OPERATORS,
} from '@helpwell/core/repos';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import { kitIcon } from '../editor-kit/index.js';

/** How many rows the builder shows. Empty rows are ignored. */
export const CONDITION_ROWS = 5;

export interface ConditionRow {
  field: string;
  op: string;
  value: string;
  window: string;
}

const NO_VALUE = new Set([
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
  'happened',
  'not_happened',
]);
const NUMBER_LIKE = new Set<string>([
  ...NUMBER_OPERATORS,
  'within_last_days',
  'within_next_days',
  'more_than_days_ago',
]);

/**
 * The rows back into a rule set, or null when every row is empty. Values are
 * shaped for their operator (a list splits on commas, "between" takes two
 * numbers); whether they are right is for core's parser to say.
 */
export function rowsToConditions(rows: unknown, match: unknown): ConditionGroup | null {
  const leaves: Condition[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const {
      field = '',
      op = '',
      value = '',
      window = '',
    } = row as Partial<Record<keyof ConditionRow, unknown>>;
    const f = String(field).trim();
    const o = String(op).trim();
    if (!f || !o) continue;
    const v = String(value ?? '').trim();

    if (f.startsWith('event:')) {
      const leaf: Record<string, unknown> = { event: f.slice('event:'.length), op: o };
      if (o === 'at_least') leaf.count = Number.parseInt(v, 10) || 1;
      const days = Number.parseInt(String(window), 10);
      if (Number.isInteger(days) && days > 0) leaf.withinDays = days;
      leaves.push(leaf as unknown as Condition);
      continue;
    }

    const leaf: Record<string, unknown> = { field: f, op: o };
    if (!NO_VALUE.has(o)) {
      if ((LIST_OPERATORS as readonly string[]).includes(o)) {
        leaf.value = v
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (o === 'between') {
        leaf.value = v
          .split(/\s*(?:,|\band\b|–)\s*/)
          .filter(Boolean)
          .map(Number);
      } else if (NUMBER_LIKE.has(o) && /^-?\d+(\.\d+)?$/.test(v)) {
        leaf.value = Number(v);
      } else {
        leaf.value = v;
      }
    }
    leaves.push(leaf as unknown as Condition);
  }
  if (leaves.length === 0) return null;
  return match === 'any' ? { any: leaves } : { all: leaves };
}

/** A rule set as rows, or null when it nests deeper than rows can show. */
export function conditionsToRows(
  group: ConditionGroup | null,
): { rows: ConditionRow[]; match: 'all' | 'any' } | null {
  if (!group) return { rows: [], match: 'all' };
  const children = childrenOf(group);
  if (children.length > CONDITION_ROWS || children.some(isGroup)) return null;
  const rows = children.map((child): ConditionRow => {
    if (isEventCondition(child)) {
      return {
        field: `event:${child.event}`,
        op: child.op,
        value: child.op === 'at_least' ? String(child.count ?? 1) : '',
        window: child.withinDays ? String(child.withinDays) : '',
      };
    }
    const leaf = child as { field: string; op: string; value?: unknown };
    const value = Array.isArray(leaf.value)
      ? leaf.value.join(leaf.op === 'between' ? ' and ' : ', ')
      : leaf.value === undefined
        ? ''
        : String(leaf.value);
    return { field: leaf.field, op: leaf.op, value, window: '' };
  });
  return { rows, match: 'any' in group ? 'any' : 'all' };
}

/**
 * The builder: a match selector and the rows, or the JSON box when the rules
 * are too deep for rows. `error` is core's message about the rules, if any.
 */
export function conditionBuilder(
  group: ConditionGroup | null,
  fields: readonly ContactField[],
  events: readonly string[],
  error: string | null,
  typedJson?: string,
): RawHtml {
  const flat = typedJson === undefined ? conditionsToRows(group) : null;
  if (!flat) {
    const json = typedJson ?? JSON.stringify(group, null, 2);
    return html`<label class="ek-field"${error ? raw(' data-invalid="true"') : null}>
  <span class="ek-field__label">Contact conditions, as JSON</span>
  <textarea class="ek-input ek-input--mono" name="targeting.conditionsJson:json" rows="8">${json}</textarea>
  <span class="ek-field__hint">These rules nest groups inside groups, so they are shown as the JSON the contacts filter and segments use.</span>
  ${error ? html`<span class="ek-field__error" role="alert">${error}</span>` : null}
</label>`;
  }

  const rows = [...flat.rows];
  while (rows.length < CONDITION_ROWS) rows.push({ field: '', op: '', value: '', window: '' });

  const fieldOptions = (selected: string) =>
    html`<option value="">Pick a field</option>
      <optgroup label="Fields">${join(
        fields.map(
          (f) =>
            html`<option value="${f.key}"${f.key === selected ? raw(' selected') : null}>${f.label} (${f.type})</option>`,
        ),
      )}</optgroup>
      ${
        events.length > 0 || selected.startsWith('event:')
          ? html`<optgroup label="Events">${join(
              [
                ...new Set([
                  ...events,
                  ...(selected.startsWith('event:') ? [selected.slice(6)] : []),
                ]),
              ].map(
                (name) =>
                  html`<option value="event:${name}"${`event:${name}` === selected ? raw(' selected') : null}>Did ${name}</option>`,
              ),
            )}</optgroup>`
          : null
      }`;

  const groups: [string, readonly string[]][] = [
    ['Text', TEXT_OPERATORS],
    [
      'Number or money',
      NUMBER_OPERATORS.filter((op) => !['is_empty', 'is_not_empty'].includes(op)),
    ],
    ['Date', DATE_OPERATORS.filter((op) => !['is_empty', 'is_not_empty'].includes(op))],
    ['Yes or no', OPERATORS_BY_TYPE.boolean],
    ['List', LIST_OPERATORS.filter((op) => !['is_empty', 'is_not_empty'].includes(op))],
    ['Event', EVENT_OPERATORS],
  ];
  const opOptions = (selected: string) =>
    html`<option value="">Condition</option>${join(
      groups.map(
        ([label, ops]) =>
          html`<optgroup label="${label}">${join(
            ops.map(
              (op) =>
                html`<option value="${op}"${op === selected ? raw(' selected') : null}>${OPERATOR_LABELS[op as FieldOperator | EventOperator]}</option>`,
            ),
          )}</optgroup>`,
      ),
    )}`;

  // Rows past the ones in use start folded; "+ Condition" unfolds the next (the
  // editor's script), and without script they all show.
  const used = Math.max(flat.rows.length, 1);
  return html`<div class="ek-field eg-conditions" role="group" aria-label="Contact conditions"${error ? raw(' data-invalid="true"') : null}>
  <span class="ek-field__head"><span class="ek-field__label">Contact conditions</span><span class="ek-field__aside">match <select class="ek-pill ek-pill--op eg-match" name="targeting.match" aria-label="Match">
      <option value="all"${flat.match === 'all' ? raw(' selected') : null}>all of these</option>
      <option value="any"${flat.match === 'any' ? raw(' selected') : null}>any of these</option>
    </select></span></span>
  ${join(
    rows.map(
      (
        row,
        i,
      ) => html`<div class="ek-filter eg-condition"${i >= used ? raw(' data-en-spare') : null}>
    <span class="ek-filter__word">${i === 0 ? 'where' : flat.match === 'any' ? 'or' : 'and'}</span>
    <select class="ek-pill ek-pill--grow" name="targeting.rules.${i}.field" aria-label="Field ${i + 1}">${fieldOptions(row.field)}</select>
    <select class="ek-pill ek-pill--op" name="targeting.rules.${i}.op" aria-label="Condition ${i + 1}">${opOptions(row.op)}</select>
    <input class="ek-pill ek-pill--val eg-condition__value" name="targeting.rules.${i}.value" value="${row.value}" placeholder="Value" aria-label="Value ${i + 1}">
    <input class="ek-pill ek-pill--num" name="targeting.rules.${i}.window" value="${row.window}" placeholder="Days" inputmode="numeric" aria-label="Events in the last N days, row ${i + 1}" title="Events only: in the last N days">
  </div>`,
    ),
  )}
  <button type="button" class="ek-addlink eg-condition-add" data-en-more-conditions hidden>${raw(kitIcon('plus', 13, 2))}Condition</button>
  <span class="ek-field__hint">Lists take commas (beta, agency). "Is between" takes two numbers (5 and 10). Dates are ISO, like 2026-01-31. Days apply to events. Empty rows are ignored; no rows means everyone.</span>
  ${error ? html`<span class="ek-field__error" role="alert">${error}</span>` : null}
</div>`;
}
