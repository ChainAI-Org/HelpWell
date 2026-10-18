/**
 * Contacts.
 *
 * Two things only: what the product told us (identify, its own server, an
 * import), and what the person did in the help centre. HelpWell never
 * enriches, scores or guesses, and there is deliberately no revenue column —
 * that is not something a support tool should be inventing (CT-02).
 *
 * Segments (CT-07) sit in a column beside the list: a saved segment is a
 * filter with a name, and the builder above the list is how one is made.
 * The builder is a plain GET form, so a filter is a URL that can be shared,
 * and "Save as segment" posts the same fields. No JavaScript is involved.
 */

import { contactImportPromptSpec } from '@helpwell/core';
import type { Db } from '@helpwell/core/db';
import {
  addContactTag,
  type ConditionGroup,
  type ContactDetail,
  type ContactField,
  type ContactListItem,
  type ContactPage,
  countContacts,
  createSegment,
  DATE_OPERATORS,
  deleteContact,
  deleteSegment,
  EVENT_OPERATORS,
  type EventCondition,
  eventCounts,
  FIELD_TYPES,
  type FieldCondition,
  type FieldOperator,
  getContact,
  getSegment,
  isEventCondition,
  isGroup,
  LIST_OPERATORS,
  listContacts,
  listFields,
  listSegments,
  NUMBER_OPERATORS,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
  removeContactTag,
  resolveContactId,
  type SegmentSummary,
  TEXT_OPERATORS,
  updateField,
  validateRules,
} from '@helpwell/core/repos';
import { html, icon, join, type RawHtml, raw } from '@helpwell/ui';
import {
  button,
  card,
  empty,
  formatDate,
  formatDateTime,
  notice,
  person,
  pill,
  relativeTime,
  searchBox,
  segment,
  statusPill,
} from '../components.js';
import { managedContent } from '../content-mode.js';
import type { DashboardContext, PageHeader } from '../layout.js';
import { setupPromptPanel } from '../setup-prompt.js';

export interface ContactsQuery {
  q?: string;
  identified?: string;
  cursor?: string;
  segment?: string;
}

/** What a contacts screen renders: the server wraps it in the shell. */
export interface ContactsView {
  header: PageHeader;
  body: RawHtml;
  status?: number;
}

/** How many condition rows the builder offers. Enough for a filter; a bigger one is JSON. */
const BUILDER_ROWS = 4;

const SOURCE_LABELS: Record<string, string> = {
  widget: 'Widget',
  identify: 'Identify',
  import: 'Import',
  form: 'Form',
  api: 'API',
};

const CONSENT_LABELS: Record<string, string> = {
  unknown: 'Not given',
  granted: 'Given',
  denied: 'Declined',
};

/* ---------------------------------------------------------------- routing */

/** GET under /contacts: the list, `fields`, or one person. */
export async function contactsView(
  db: Db,
  context: DashboardContext,
  rest: string[],
  url: URL,
): Promise<ContactsView> {
  if (rest[0] === 'fields') return fieldsView(db, context, url);
  if (rest[0]) return contactView(db, context, rest[0]);
  return listView(db, context, url);
}

/**
 * POST under /contacts. Every write redirects (303) so a refresh never
 * re-submits; a builder the rules parser refuses re-renders with the reason.
 */
export async function contactsPost(
  db: Db,
  context: DashboardContext,
  rest: string[],
  form: FormData,
): Promise<Response> {
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : '';
  };
  const base = `${context.basePath}/contacts`;

  if (rest[0] === 'segments') {
    if (rest[1] && value('action') === 'delete') {
      await deleteSegment(db, rest[1]);
      return redirect(base);
    }
    const built = buildConditions(new URLSearchParams(formEntries(form)));
    try {
      if (!built.rules) throw new Error(built.error ?? 'Add at least one condition first.');
      const rules = await validateRules(db, built.rules);
      const saved = await createSegment(db, {
        name: value('name'),
        description: value('description') || null,
        rules,
      });
      return redirect(`${base}?segment=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      const params = new URLSearchParams(formEntries(form));
      params.set('error', error instanceof Error ? error.message : String(error));
      params.delete('name');
      params.delete('description');
      return redirect(`${base}?${params.toString()}`);
    }
  }

  if (rest[0] === 'fields') {
    const key = value('key');
    try {
      await updateField(db, key, {
        label: value('label') || undefined,
        type: (FIELD_TYPES as readonly string[]).includes(value('type'))
          ? (value('type') as (typeof FIELD_TYPES)[number])
          : undefined,
        hidden: form.get('hidden') !== null,
      });
      return redirect(`${base}/fields?saved=${encodeURIComponent(key)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return redirect(`${base}/fields?error=${encodeURIComponent(message)}`);
    }
  }

  if (rest[0]) {
    const id = (await resolveContactId(db, rest[0])) ?? rest[0];
    const back = `${base}/${encodeURIComponent(id)}`;
    if (value('action') === 'delete') {
      await deleteContact(db, id);
      return redirect(base);
    }
    if (value('removeTag')) {
      await removeContactTag(db, id, value('removeTag'));
      return redirect(back);
    }
    const tag = value('tag').trim();
    if (tag) await addContactTag(db, id, tag);
    return redirect(back);
  }

  return redirect(base);
}

function formEntries(form: FormData): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of form.entries()) if (typeof value === 'string') out.push([key, value]);
  return out;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/* ------------------------------------------------------------------- list */

async function listView(db: Db, context: DashboardContext, url: URL): Promise<ContactsView> {
  const params = url.searchParams;
  const query: ContactsQuery = {
    q: params.get('q') ?? undefined,
    identified: params.get('identified') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    segment: params.get('segment') ?? undefined,
  };
  const identified =
    query.identified === 'true' ? true : query.identified === 'false' ? false : undefined;

  const [fields, segments, everyone, signedIn, events] = await Promise.all([
    listFields(db, { includeHidden: false }),
    listSegments(db),
    countContacts(db),
    countContacts(db, { identified: true }),
    eventCounts(db, { limit: 50 }),
  ]);
  const found = query.segment ? await getSegment(db, query.segment) : null;
  const saved: SegmentSummary | null = found
    ? (segments.find((s) => s.id === found.id) ?? { ...found, count: 0 })
    : null;
  const built = buildConditions(params);

  let conditions: ConditionGroup | undefined;
  let problem: string | null =
    params.get('error') ??
    built.error ??
    (query.segment && !found ? 'That segment no longer exists. Showing everyone.' : null);
  if (saved) conditions = saved.rules;
  else if (built.rules) {
    try {
      conditions = await validateRules(db, built.rules);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  const page = await listContacts(db, {
    search: query.q,
    identified,
    conditions,
    cursor: query.cursor,
    limit: 25,
  });

  const title = saved ? saved.name : 'Contacts';
  return {
    header: {
      title,
      subtitle: saved
        ? (saved.description ?? describeRules(saved.rules, fields))
        : 'What your app told us, and what they did in the help center.',
      actions: button('Export CSV', {
        href: `${context.apiPath}/admin/contacts.csv?${exportParams(params).toString()}`,
        glyph: 'download',
      }),
    },
    body: html`
<div class="db-split" style="align-items:start">
  ${segmentsColumn(context, segments, { everyone, signedIn }, query)}
  <div style="min-width:0">
    ${problem ? notice('bad', problem) : null}
    ${saved ? savedSegmentBar(context, saved) : null}
    ${contactsPage(context, page, query, {
      builder: saved
        ? null
        : builderForm(
            context,
            params,
            fields,
            events.map((e) => e.name),
            Boolean(built.rules) && !problem,
          ),
    })}
    ${
      // The import command runs beside a repo and the install's database.
      managedContent(context) ? null : importCard()
    }
  </div>
</div>`,
  };
}

/** Everything that filters the list, carried into the CSV link. */
function exportParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of ['q', 'identified', 'segment']) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  const built = buildConditions(params);
  if (!params.get('segment') && built.rules) out.set('conditions', JSON.stringify(built.rules));
  return out;
}

function segmentsColumn(
  context: DashboardContext,
  segments: SegmentSummary[],
  counts: { everyone: number; signedIn: number },
  query: ContactsQuery,
): RawHtml {
  const base = `${context.basePath}/contacts`;
  const row = (label: string, count: number, href: string, current: boolean) =>
    html`<a href="${href}"${current ? raw(' aria-current="page"') : null}
      style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;font-size:13px;${
        current
          ? 'background:var(--hw-accent-soft);color:var(--hw-deep-violet);font-weight:700'
          : 'color:var(--hw-ink)'
      }">
      <span class="db-truncate">${label}</span><span class="db-nums" style="color:${
        current ? 'var(--hw-deep-violet)' : 'var(--hw-muted)'
      }">${count.toLocaleString('en-GB')}</span></a>`;

  const plain = !query.segment;
  return card(
    'Segments',
    null,
    html`<nav aria-label="Segments" style="display:grid;gap:2px">
      ${row('All contacts', counts.everyone, base, plain && !query.identified)}
      ${row('Signed in', counts.signedIn, `${base}?identified=true`, plain && query.identified === 'true')}
      ${row('Anonymous', counts.everyone - counts.signedIn, `${base}?identified=false`, plain && query.identified === 'false')}
      ${
        segments.length > 0
          ? html`<div style="border-top:1px solid var(--hw-hairline);margin:6px 0"></div>${join(
              segments.map((s) =>
                row(
                  s.name,
                  s.count,
                  `${base}?segment=${encodeURIComponent(s.id)}`,
                  query.segment === s.id,
                ),
              ),
            )}`
          : null
      }
    </nav>
    <p class="db-card__hint" style="margin-top:12px">
      Filter the list with the conditions above it, then save the filter as a segment.
      Engage and surveys can target any segment.
    </p>
    <p style="margin-top:8px"><a href="${base}/fields">Fields and their types</a></p>`,
  );
}

function savedSegmentBar(context: DashboardContext, saved: SegmentSummary): RawHtml {
  return html`<div class="db-toolbar" style="justify-content:space-between">
  <span>${pill('accent', `${saved.count.toLocaleString('en-GB')} ${saved.count === 1 ? 'person' : 'people'}`)}</span>
  <form method="post" action="${context.basePath}/contacts/segments/${encodeURIComponent(saved.id)}"
        data-confirm="Delete the segment “${saved.name}”? The contacts in it are not touched.">
    <input type="hidden" name="action" value="delete">
    ${button('Delete segment', { tone: 'danger', glyph: 'trash' })}
  </form>
</div>`;
}

export function contactsPage(
  context: DashboardContext,
  page: ContactPage,
  query: ContactsQuery,
  extras: { builder?: RawHtml | null } = {},
): RawHtml {
  const base = `${context.basePath}/contacts`;
  const withParams = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, ...patch })) {
      if (value) params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `${base}?${encoded}` : base;
  };

  const toolbar = html`<div class="db-toolbar">
  ${searchBox(base, query.q ?? '', 'Search name, email or user id')}
  ${segment([
    {
      label: 'Everyone',
      href: withParams({ identified: undefined, cursor: undefined }),
      current: !query.identified,
    },
    {
      label: 'Signed in',
      href: withParams({ identified: 'true', cursor: undefined }),
      current: query.identified === 'true',
    },
    {
      label: 'Anonymous',
      href: withParams({ identified: 'false', cursor: undefined }),
      current: query.identified === 'false',
    },
  ])}
</div>
${extras.builder ?? null}`;

  if (page.items.length === 0) {
    return html`
${toolbar}
${empty(
  'contacts',
  query.q || query.segment ? 'Nobody matches that' : 'No contacts yet',
  query.q || query.segment
    ? 'Try a different search, or loosen the conditions.'
    : 'Call identify() from your app and people appear here with their real details.',
)}`;
  }

  return html`
${toolbar}
<div class="db-tablewrap">
  <table class="db-table">
    <thead>
      <tr>
        <th>Person</th>
        <th>Email</th>
        <th>Source</th>
        <th>Consent</th>
        <th>Conversations</th>
        <th>Last seen</th>
      </tr>
    </thead>
    <tbody>
      ${join(page.items.map((contact) => contactRow(context, contact)))}
    </tbody>
  </table>
</div>
${
  page.nextCursor
    ? html`<div style="margin-top:14px;text-align:center">${button('More contacts', {
        href: withParams({ cursor: page.nextCursor }),
      })}</div>`
    : null
}`;
}

function contactRow(context: DashboardContext, contact: ContactListItem): RawHtml {
  const base = `${context.basePath}/contacts`;
  return html`
      <tr>
        <td><a href="${base}/${encodeURIComponent(contact.id)}">${person(contact)}</a></td>
        <td class="db-muted">${contact.email ?? '—'}</td>
        <td>${sourcePill(contact.source)}</td>
        <td>${consentPill(contact.consent)}</td>
        <td class="db-nums">${contact.conversationCount}</td>
        <td class="db-muted">${relativeTime(contact.lastSeenAt, context)}</td>
      </tr>`;
}

function sourcePill(source: string): RawHtml {
  return pill('neutral', SOURCE_LABELS[source] ?? source);
}

function consentPill(consent: string): RawHtml {
  const label = CONSENT_LABELS[consent] ?? consent;
  return consent === 'granted'
    ? pill('good', label)
    : consent === 'denied'
      ? pill('warn', label)
      : pill('neutral', label);
}

function importCard(): RawHtml {
  return html`<div style="margin-top:18px">${card(
    'Import contacts',
    'Bring people over from another tool with the CLI. Imported contacts are labelled Import, with consent not given.',
    html`<pre class="db-code">npx helpwell import contacts contacts.csv --dry-run</pre>`,
    setupPromptPanel('contact-import', contactImportPromptSpec()),
  )}</div>`;
}

/* ---------------------------------------------------------------- builder */

interface BuiltConditions {
  rules: ConditionGroup | null;
  error: string | null;
}

/**
 * Turn the builder's fields (`match`, `f1`/`o1`/`v1`/`w1`, …) into a rule
 * set. `event:<name>` in a field slot is an event condition, and `w` is its
 * window in days. Empty rows are skipped; nothing filled in is no filter.
 */
export function buildConditions(params: URLSearchParams): BuiltConditions {
  const conditions: (FieldCondition | EventCondition)[] = [];
  for (let i = 1; i <= BUILDER_ROWS; i++) {
    const field = params.get(`f${i}`)?.trim();
    const op = params.get(`o${i}`)?.trim();
    if (!field || !op) continue;
    const raw = params.get(`v${i}`)?.trim() ?? '';

    if (field.startsWith('event:')) {
      const event: EventCondition = {
        event: field.slice('event:'.length),
        op: op as EventCondition['op'],
      };
      if (op === 'at_least') event.count = Math.max(1, Number.parseInt(raw, 10) || 1);
      const window = Number.parseInt(params.get(`w${i}`) ?? '', 10);
      if (Number.isInteger(window) && window > 0) event.withinDays = window;
      conditions.push(event);
      continue;
    }

    const leaf = { field, op } as FieldCondition;
    const value = builderValue(op as FieldOperator, raw);
    if (value instanceof Error) return { rules: null, error: `${field}: ${value.message}` };
    if (value !== undefined) leaf.value = value;
    conditions.push(leaf);
  }
  if (conditions.length === 0) return { rules: null, error: null };
  return {
    rules: params.get('match') === 'any' ? { any: conditions } : { all: conditions },
    error: null,
  };
}

function builderValue(op: FieldOperator, raw: string): FieldCondition['value'] | Error | undefined {
  if (['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(op)) return undefined;
  if (!raw) return new Error(`"${OPERATOR_LABELS[op]}" needs a value`);
  if (op === 'between') {
    const parts = raw
      .split(/\s*(?:,|\band\b|-|–)\s*/)
      .filter(Boolean)
      .map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      return new Error('"is between" needs two numbers, like 5 and 10');
    }
    return [parts[0]!, parts[1]!];
  }
  if ((LIST_OPERATORS as readonly string[]).includes(op)) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (
    (NUMBER_OPERATORS as readonly string[]).includes(op) ||
    ['within_last_days', 'within_next_days', 'more_than_days_ago'].includes(op)
  ) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : new Error(`"${OPERATOR_LABELS[op]}" needs a number`);
  }
  return raw;
}

function builderForm(
  context: DashboardContext,
  params: URLSearchParams,
  fields: ContactField[],
  eventNames: string[],
  applied: boolean,
): RawHtml {
  const base = `${context.basePath}/contacts`;
  const fieldOptions = (selected: string) =>
    html`<option value="">Pick a field</option>
      <optgroup label="Fields">${join(
        fields.map(
          (f) =>
            html`<option value="${f.key}"${f.key === selected ? raw(' selected') : null}>${f.label} (${f.type})</option>`,
        ),
      )}</optgroup>
      ${
        eventNames.length > 0
          ? html`<optgroup label="Events">${join(
              eventNames.map(
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
    join(
      groups.map(
        ([label, ops]) =>
          html`<optgroup label="${label}">${join(
            ops.map(
              (op) =>
                html`<option value="${op}"${op === selected ? raw(' selected') : null}>${OPERATOR_LABELS[op as FieldOperator]}</option>`,
            ),
          )}</optgroup>`,
      ),
    );

  const rows = Array.from({ length: BUILDER_ROWS }, (_, n) => n + 1).map(
    (
      i,
    ) => html`<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.2fr) minmax(0,1fr) 110px;gap:8px">
      <select class="db-select" name="f${i}" aria-label="Field ${i}">${fieldOptions(params.get(`f${i}`) ?? '')}</select>
      <select class="db-select" name="o${i}" aria-label="Condition ${i}">${opOptions(params.get(`o${i}`) ?? '')}</select>
      <input class="db-input" name="v${i}" value="${params.get(`v${i}`) ?? ''}" placeholder="Value" aria-label="Value ${i}">
      <input class="db-input" name="w${i}" value="${params.get(`w${i}`) ?? ''}" placeholder="Last N days" aria-label="Events in the last N days, row ${i}" inputmode="numeric">
    </div>`,
  );

  const hidden = (names: string[]) =>
    join(
      names.flatMap((name) => {
        const value = params.get(name);
        return value ? [html`<input type="hidden" name="${name}" value="${value}">`] : [];
      }),
    );
  const builderKeys = [
    'match',
    ...Array.from({ length: BUILDER_ROWS }, (_, n) => [
      `f${n + 1}`,
      `o${n + 1}`,
      `v${n + 1}`,
      `w${n + 1}`,
    ]).flat(),
  ];

  return html`<details class="db-card" style="margin-bottom:14px"${applied ? raw(' open') : null}>
  <summary style="cursor:pointer;font-weight:600">${applied ? 'Filtered by conditions' : 'Filter by conditions'}</summary>
  <form method="get" action="${base}" style="display:grid;gap:8px;margin-top:12px">
    ${hidden(['q', 'identified'])}
    <label class="db-field__label">Match
      <select class="db-select" name="match" style="width:auto;display:inline-block;margin-left:6px">
        <option value="all"${params.get('match') !== 'any' ? raw(' selected') : null}>all of these</option>
        <option value="any"${params.get('match') === 'any' ? raw(' selected') : null}>any of these</option>
      </select>
    </label>
    ${join(rows)}
    <p class="db-field__hint">Lists take commas (beta, agency). "Is between" takes two numbers (5 and 10). Dates are ISO, like 2026-01-31. The last column only applies to events.</p>
    <div class="db-toolbar" style="margin:0">
      ${button('Apply', { tone: 'primary', glyph: 'search' })}
      ${applied ? button('Clear', { href: base }) : null}
    </div>
  </form>
  ${
    applied
      ? html`<form method="post" action="${base}/segments" class="db-toolbar" style="margin:12px 0 0">
      ${hidden(builderKeys)}
      <input class="db-input" name="name" placeholder="Segment name" aria-label="Segment name" required maxlength="80" style="max-width:260px">
      ${button('Save as segment', { glyph: 'plus' })}
    </form>`
      : null
  }
</details>`;
}

/** A segment's rules in words, for its subtitle: "plan is pro, and seats ≥ 3". */
export function describeRules(rules: ConditionGroup, fields: ContactField[]): string {
  const labels = new Map(fields.map((f) => [f.key, f.label]));
  const say = (node: ConditionGroup | FieldCondition | EventCondition): string => {
    if (isGroup(node)) {
      const children = 'all' in node ? node.all : node.any;
      if (children.length === 0) return 'everyone';
      const joined = children.map(say).join('all' in node ? ', and ' : ', or ');
      return children.length > 1 ? `(${joined})` : joined;
    }
    if (isEventCondition(node)) {
      const count = node.op === 'at_least' ? ` ${node.count ?? 1} times` : '';
      const window = node.withinDays ? ` in the last ${node.withinDays} days` : '';
      const verb = node.op === 'not_happened' ? 'did not' : 'did';
      return `${verb} ${node.event}${node.op === 'at_least' ? ' at least' : ''}${count}${window}`;
    }
    const label = labels.get(node.field) ?? node.field;
    const value = Array.isArray(node.value)
      ? node.op === 'between'
        ? node.value.join(' and ')
        : node.value.join(', ')
      : String(node.value ?? '');
    const operator = OPERATOR_LABELS[node.op];
    if (operator.includes(' N ')) return `${label} ${operator.replace(' N ', ` ${value} `)}`;
    return value ? `${label} ${operator} ${value}` : `${label} ${operator}`;
  };
  const text = say(rules).replace(/^\((.*)\)$/, '$1');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ----------------------------------------------------------------- fields */

async function fieldsView(db: Db, context: DashboardContext, url: URL): Promise<ContactsView> {
  const fields = await listFields(db);
  const saved = url.searchParams.get('saved');
  const error = url.searchParams.get('error');
  const base = `${context.basePath}/contacts`;

  return {
    header: {
      title: 'Contact fields',
      subtitle: 'Every attribute your app sends, and how HelpWell reads it.',
      actions: button('All contacts', { href: base, glyph: 'back' }),
    },
    body: html`
${saved ? notice('good', `Saved ${saved}.`) : null}
${error ? notice('bad', error) : null}
${card(
  null,
  'A type is worked out the first time a field arrives and never changes on its own. Changing it here locks it, so a later value of a different shape cannot change what a segment means. Hidden fields stay stored and filterable, but leave the contact page.',
  html`<div class="db-tablewrap" style="border:0">
  <table class="db-table">
    <thead><tr><th>Field</th><th>Label</th><th>Type</th><th>Hidden</th><th>Last seen</th><th></th></tr></thead>
    <tbody>${join(fields.map((field) => fieldRow(context, field)))}</tbody>
  </table>
</div>`,
)}`,
  };
}

function fieldRow(context: DashboardContext, field: ContactField): RawHtml {
  const form = `field-${field.key.replace(/[^a-z0-9_-]/gi, '-')}`;
  const locked = field.builtin || field.locked;
  return html`<tr>
    <td><code>${field.key}</code>${field.builtin ? html` ${pill('neutral', 'Built in')}` : null}</td>
    <td><input class="db-input" form="${form}" name="label" value="${field.label}" aria-label="Label for ${field.key}" maxlength="80"></td>
    <td>${
      field.builtin
        ? html`<span class="db-muted">${field.type}</span>`
        : html`<select class="db-select" form="${form}" name="type" aria-label="Type for ${field.key}"${locked ? raw(' title="Locked: already chosen by a person"') : null}>${join(
            FIELD_TYPES.map(
              (type) =>
                html`<option value="${type}"${type === field.type ? raw(' selected') : null}>${type}</option>`,
            ),
          )}</select>${locked ? html` ${pill('neutral', 'Locked')}` : null}`
    }</td>
    <td><input type="checkbox" form="${form}" name="hidden"${field.hidden ? raw(' checked') : null} aria-label="Hide ${field.key}"></td>
    <td class="db-muted">${field.builtin ? '—' : relativeTime(field.lastSeenAt, context)}</td>
    <td><form id="${form}" method="post" action="${context.basePath}/contacts/fields">
      <input type="hidden" name="key" value="${field.key}">
      ${button('Save')}
    </form></td>
  </tr>`;
}

/* ---------------------------------------------------------------- contact */

async function contactView(
  db: Db,
  context: DashboardContext,
  idOrExternal: string,
): Promise<ContactsView> {
  const id = (await resolveContactId(db, idOrExternal)) ?? idOrExternal;
  const [contact, fields] = await Promise.all([getContact(db, id), listFields(db)]);
  if (!contact) {
    return {
      header: { title: 'Contact' },
      body: empty(
        'alert',
        'That is not here',
        'It may have been deleted.',
        button('All contacts', { href: `${context.basePath}/contacts`, glyph: 'back' }),
      ),
      status: 404,
    };
  }
  return {
    header: {
      title: contact.name ?? contact.email ?? 'Anonymous visitor',
      actions: button('All contacts', { href: `${context.basePath}/contacts`, glyph: 'back' }),
    },
    body: contactPage(context, contact, fields),
  };
}

/**
 * The contact screen: three columns.
 *
 * What the app told us on the left, conversations in the middle, help centre
 * activity and tracked events on the right (CT-05). No usage charts, no login
 * history, no revenue — those belong to the product, not to its help desk.
 */
export function contactPage(
  context: DashboardContext,
  contact: ContactDetail,
  fields: ContactField[] = [],
): RawHtml {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const attributes = Object.entries(contact.attributes).filter(([key]) => {
    const field = byKey.get(key) ?? byKey.get(`attributes.${key}`);
    return !field?.hidden;
  });
  const path = `${context.basePath}/contacts/${encodeURIComponent(contact.id)}`;

  return html`
<div class="db-grid db-grid--3" style="align-items:start">
  <div>
    ${card(
      'Details',
      'Passed by your app, its server or an import.',
      html`<dl class="db-kv">
        <dt>Name</dt><dd>${contact.name ?? '—'}</dd>
        <dt>Email</dt><dd>${contact.email ?? '—'}</dd>
        <dt>Your user id</dt><dd>${contact.externalId ?? '—'}</dd>
        <dt>Signed up</dt><dd>${formatDate(contact.signedUpAt ?? contact.firstSeenAt, context)}</dd>
        <dt>Last seen</dt><dd>${relativeTime(contact.lastSeenAt, context)}</dd>
        <dt>Location</dt><dd>${[contact.city, contact.country].filter(Boolean).join(', ') || '—'}</dd>
        <dt>Locale</dt><dd>${contact.locale ?? '—'}</dd>
        <dt>Timezone</dt><dd>${contact.timezone ?? '—'}</dd>
        <dt>Source</dt><dd>${sourcePill(contact.source)}</dd>
        <dt>Consent</dt><dd>${consentPill(contact.consent)}${
          contact.consentSource
            ? html`<span class="db-muted" style="font-weight:500"> via ${contact.consentSource}${
                contact.consentAt ? `, ${formatDateTime(contact.consentAt, context)}` : ''
              }</span>`
            : null
        }</dd>
        ${join(
          attributes.map(([key, value]) => {
            const field = byKey.get(key) ?? byKey.get(`attributes.${key}`);
            return html`<dt>${field?.label ?? key}</dt><dd>${formatAttribute(value, field, context)}</dd>`;
          }),
        )}
      </dl>

      <div class="db-tagrow" style="margin-top:14px">
        ${contact.identified ? pill('good', 'Signed in') : pill('neutral', 'Anonymous')}
        ${join(
          contact.tags.map(
            (tag) => html`<form method="post" action="${path}" style="display:inline">
              <input type="hidden" name="removeTag" value="${tag}">
              <button type="submit" class="db-pill db-pill--accent" style="border:0;cursor:pointer" title="Remove the tag ${tag}">${tag} ×</button>
            </form>`,
          ),
        )}
      </div>
      <form method="post" action="${path}" class="db-toolbar" style="margin:10px 0 0">
        <input class="db-input" name="tag" placeholder="Add a tag" aria-label="Add a tag" maxlength="60" style="max-width:180px">
        ${button('Add', { glyph: 'plus' })}
      </form>`,
    )}

    ${card(
      'Data',
      'Everything HelpWell holds about this person.',
      html`<div class="db-toolbar" style="margin:0">
        ${button('Export as JSON', {
          href: `${context.apiPath}/admin/contacts/${encodeURIComponent(contact.id)}/export`,
          glyph: 'download',
        })}
      </div>
      <form method="post" action="${path}" data-confirm="Erase this contact and every conversation they had? This cannot be undone."
            style="margin-top:8px">
        <input type="hidden" name="action" value="delete">
        ${button('Erase this person', { tone: 'danger', glyph: 'trash' })}
      </form>`,
    )}
  </div>

  ${card(
    'Conversations',
    null,
    contact.conversations.length === 0
      ? html`<p class="db-muted">None yet.</p>`
      : join(
          contact.conversations.map(
            (conversation) => html`
      <a href="${context.basePath}/conversations/${encodeURIComponent(conversation.id)}"
         style="display:block;padding:11px 0;border-top:1px solid var(--hw-hairline)">
        <div class="db-truncate" style="font-weight:600">${conversation.snippet || conversation.topic || 'Conversation'}</div>
        <div class="db-muted" style="font-size:12.5px;margin-top:3px;display:flex;gap:8px;align-items:center">
          ${statusPill(conversation.status)}
          <span>${relativeTime(conversation.lastMessageAt, context)}</span>
          <span>${String(conversation.messageCount)} messages</span>
        </div>
      </a>`,
          ),
        ),
  )}

  <div>
    ${card(
      'Help center activity',
      null,
      contact.activity.length === 0
        ? html`<p class="db-muted">Nothing recorded.</p>`
        : join(
            contact.activity.map(
              (item) => html`
      <div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--hw-hairline)">
        <span style="color:var(--hw-muted);flex:none;margin-top:2px">${raw(icon(activityIcon(item.kind), 15))}</span>
        <div style="min-width:0;flex:1">
          <div class="db-truncate" style="font-weight:600;font-size:13px">${item.label}</div>
          <div class="db-muted" style="font-size:12px">${activityLabel(item.kind)}${item.detail ? ` · ${item.detail}` : ''} · ${relativeTime(item.at, context)}</div>
        </div>
      </div>`,
            ),
          ),
    )}
    ${
      contact.eventCounts.length > 0
        ? card(
            'Tracked events',
            'From track() in your app or its server.',
            html`<dl class="db-kv">${join(
              contact.eventCounts.map(
                (event) =>
                  html`<dt>${event.name}</dt><dd>${String(event.count)} <span class="db-muted" style="font-weight:500">· last ${relativeTime(event.lastAt, context)}</span></dd>`,
              ),
            )}</dl>`,
          )
        : null
    }
  </div>
</div>`;
}

function activityIcon(kind: string): string {
  switch (kind) {
    case 'search':
      return 'search';
    case 'article_rating':
      return 'thumbUp';
    case 'changelog_read':
      return 'changelog';
    case 'survey':
      return 'engage';
    default:
      return 'sparkle';
  }
}

function activityLabel(kind: string): string {
  switch (kind) {
    case 'search':
      return 'Searched';
    case 'article_rating':
      return 'Rated an article';
    case 'changelog_read':
      return 'Read an update';
    case 'survey':
      return 'Answered a survey';
    default:
      return 'Event';
  }
}

/** An attribute shown the way its field type reads it. */
function formatAttribute(
  value: unknown,
  field: ContactField | undefined,
  context: DashboardContext,
): RawHtml | string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field?.type) {
    case 'date': {
      const date =
        typeof value === 'number'
          ? new Date(Math.abs(value) < 100_000_000_000 ? value * 1000 : value)
          : new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : formatDate(date, context);
    }
    case 'boolean':
      return ['true', 'yes', '1'].includes(String(value).toLowerCase()) ? 'Yes' : 'No';
    case 'list':
      return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    case 'url':
      return /^https?:\/\//i.test(String(value))
        ? html`<a href="${String(value)}" rel="noopener noreferrer" target="_blank">${String(value)}</a>`
        : String(value);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
