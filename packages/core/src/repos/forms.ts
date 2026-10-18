/**
 * Forms in the database: create, save as a new version, list, archive, and
 * export or import one as JSON.
 *
 * Every save writes the whole definition as a new row in `form_versions` and
 * moves the form's `version` on; nothing is edited in place, so a submission
 * always knows the version it came through, and any earlier version can be
 * looked at or brought back. Saving a definition identical to the current
 * one writes nothing. Whether a form is live, and its name, are not
 * versioned: switching one on is not a change to what it is.
 *
 * The export is the definition plus its id and name, so a form can be kept
 * in a repo and imported again (`POST /admin/forms/import`), the way
 * engagements live in helpwell.config.json.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import { checkForm, type FormProblem } from '../forms/check.js';
import {
  FORM_ID,
  type Form,
  type FormDefinition,
  type FormType,
  formDefinitionSchema,
  parseFormDefinition,
} from '../forms/schema.js';
import { formTemplate } from '../forms/templates.js';

type FormRow = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  version: number | string;
  definition: unknown;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
};

const COLUMNS = sql`id, name, type, enabled, version, definition, created_at, updated_at, archived_at`;

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * A stored definition, read. One that no longer parses (written by a newer
 * version, or edited by hand) comes back as the defaults rather than taking
 * the forms list down with it.
 */
function readDefinition(value: unknown): FormDefinition {
  const parsed = formDefinitionSchema.safeParse(json(value) ?? {});
  return parsed.success ? parsed.data : parseFormDefinition({});
}

function toForm(row: FormRow): Form {
  const definition = readDefinition(row.definition);
  return {
    id: row.id,
    name: row.name,
    type: definition.type,
    enabled: Boolean(row.enabled),
    version: Number(row.version),
    definition,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  };
}

export async function getForm(db: Db, id: string): Promise<Form | null> {
  const row = rowsOf<FormRow>(
    await db.execute(sql`SELECT ${COLUMNS} FROM helpwell.forms WHERE id = ${id}`),
  )[0];
  return row ? toForm(row) : null;
}

export async function listForms(
  db: Db,
  options: { includeArchived?: boolean; type?: FormType } = {},
): Promise<Form[]> {
  const rows = rowsOf<FormRow>(
    await db.execute(sql`
      SELECT ${COLUMNS} FROM helpwell.forms
      WHERE ${options.includeArchived ? sql`TRUE` : sql`archived_at IS NULL`}
        ${options.type ? sql`AND type = ${options.type}` : sql``}
      ORDER BY archived_at IS NOT NULL, updated_at DESC, id
    `),
  );
  return rows.map(toForm);
}

/** Every form id in use, archived ones included, for picking a new unique one. */
export async function formIds(db: Db): Promise<string[]> {
  return rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM helpwell.forms`)).map(
    (r) => r.id,
  );
}

/** `base`, or `base-2`, `base-3`... whichever is free. */
export async function uniqueFormId(db: Db, base: string): Promise<string> {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'form';
  const taken = new Set(await formIds(db));
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}-${n}`)) n++;
  return `${clean}-${n}`;
}

export class FormInvalidError extends HelpWellError {
  constructor(readonly problems: FormProblem[]) {
    super('bad_request', `The form is not complete: ${problems[0]?.message ?? ''}`, {
      publicMessage: problems[0]?.message ?? 'The form is not complete.',
      details: { problems },
    });
  }
}

export interface SaveFormOptions {
  /** A line for the version history. */
  note?: string | null;
  /** Engage tours a "start a tour" button may name, for the checks. */
  tours?: readonly string[];
  /** Skip the completeness checks: a draft kept as it is. */
  skipChecks?: boolean;
  now?: Date;
}

export interface NewFormInput {
  /** Made from the name (or the template) when left out. */
  id?: string;
  name?: string;
  /** A template key (templates.ts). The definition, if given too, is merged over it. */
  template?: string;
  definition?: unknown;
  enabled?: boolean;
}

/**
 * Create a form at version 1. Throws `FormInvalidError` (a 400 with every
 * problem in `details.problems`) when it is not complete, unless
 * `skipChecks`; and a 409 when the id is taken.
 */
export async function createForm(
  db: Db,
  input: NewFormInput,
  options: SaveFormOptions = {},
): Promise<Form> {
  const template = input.template ? formTemplate(input.template) : null;
  if (input.template && !template) {
    throw new HelpWellError('bad_request', `No form template ${input.template}`);
  }
  const raw = mergeRaw(template?.definition ?? {}, input.definition ?? {});
  const parsed = formDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FormInvalidError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  const definition = parsed.data;
  const name = (input.name ?? template?.name ?? 'New form').trim().slice(0, 120) || 'New form';
  const id = input.id?.trim() || (await uniqueFormId(db, template?.id ?? name));
  if (!FORM_ID.test(id)) {
    throw new FormInvalidError([
      { path: 'id', message: 'Use lower-case letters, numbers and dashes.' },
    ]);
  }
  if (!options.skipChecks) {
    const problems = checkForm(definition, { id, tours: options.tours });
    if (problems.length > 0) throw new FormInvalidError(problems);
  }
  const now = options.now ?? new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO helpwell.forms (id, name, type, enabled, version, definition, created_at, updated_at)
        VALUES (${id}, ${name}, ${definition.type}, ${input.enabled === true}, 1,
                ${JSON.stringify(definition)}::jsonb, ${now.toISOString()}::timestamptz,
                ${now.toISOString()}::timestamptz)
      `);
      await tx.execute(sql`
        INSERT INTO helpwell.form_versions (form_id, version, definition, note, created_at)
        VALUES (${id}, 1, ${JSON.stringify(definition)}::jsonb, ${options.note ?? 'Created'},
                ${now.toISOString()}::timestamptz)
      `);
    });
  } catch (error) {
    if (await getForm(db, id)) {
      throw new HelpWellError('conflict', `A form with the id ${id} already exists`, {
        publicMessage: 'Another form already uses this id.',
      });
    }
    throw error;
  }
  return (await getForm(db, id))!;
}

export interface SaveFormResult {
  form: Form;
  /** False when the definition was the same as the current one, and nothing was written. */
  changed: boolean;
}

/**
 * Save a new definition as the next version. `expectedVersion`, when given,
 * refuses (409) a save made from an older copy than the one stored, so two
 * people editing at once do not silently undo each other.
 */
export async function saveForm(
  db: Db,
  id: string,
  input: { definition: unknown; name?: string; expectedVersion?: number },
  options: SaveFormOptions = {},
): Promise<SaveFormResult> {
  const current = await getForm(db, id);
  if (!current) throw new HelpWellError('not_found', `No form ${id}`);
  const parsed = formDefinitionSchema.safeParse(input.definition ?? {});
  if (!parsed.success) {
    throw new FormInvalidError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  const definition = parsed.data;
  if (!options.skipChecks) {
    const problems = checkForm(definition, { id, tours: options.tours });
    if (problems.length > 0) throw new FormInvalidError(problems);
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
    throw new HelpWellError('conflict', `Form ${id} is at version ${current.version}`, {
      publicMessage:
        'Someone saved this form while you were editing it. Reload to see their changes.',
      details: { version: current.version },
    });
  }
  const name = input.name?.trim().slice(0, 120);
  const now = options.now ?? new Date();
  const same = JSON.stringify(definition) === JSON.stringify(current.definition);
  if (same) {
    if (name && name !== current.name) {
      await db.execute(sql`
        UPDATE helpwell.forms SET name = ${name}, updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${id}
      `);
      return { form: (await getForm(db, id))!, changed: false };
    }
    return { form: current, changed: false };
  }

  await db.transaction(async (tx) => {
    // Under a row lock, so two saves at once make two versions, not one twice.
    const locked = rowsOf<{ version: number | string }>(
      await tx.execute(sql`SELECT version FROM helpwell.forms WHERE id = ${id} FOR UPDATE`),
    )[0];
    const next = Number(locked?.version ?? current.version) + 1;
    await tx.execute(sql`
      INSERT INTO helpwell.form_versions (form_id, version, definition, note, created_at)
      VALUES (${id}, ${next}, ${JSON.stringify(definition)}::jsonb, ${options.note ?? null},
              ${now.toISOString()}::timestamptz)
    `);
    await tx.execute(sql`
      UPDATE helpwell.forms SET
        definition = ${JSON.stringify(definition)}::jsonb,
        type = ${definition.type},
        version = ${next},
        name = ${name || current.name},
        updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${id}
    `);
  });
  return { form: (await getForm(db, id))!, changed: true };
}

/** Switch a form on or off, rename it, or archive and restore it. Not versioned. */
export async function updateFormMeta(
  db: Db,
  id: string,
  patch: { enabled?: boolean; name?: string; archived?: boolean },
  now: Date = new Date(),
): Promise<Form | null> {
  const current = await getForm(db, id);
  if (!current) return null;
  const name = patch.name?.trim().slice(0, 120) || current.name;
  const archivedAt =
    patch.archived === undefined
      ? current.archivedAt
      : patch.archived
        ? (current.archivedAt ?? now)
        : null;
  // An archived form is never live.
  const enabled = archivedAt ? false : (patch.enabled ?? current.enabled);
  await db.execute(sql`
    UPDATE helpwell.forms SET
      enabled = ${enabled}, name = ${name},
      archived_at = ${archivedAt ? archivedAt.toISOString() : null}::timestamptz,
      updated_at = ${now.toISOString()}::timestamptz
    WHERE id = ${id}
  `);
  return getForm(db, id);
}

/**
 * Delete a form for good, with its versions, views and giveaway state. Only
 * when nothing was ever submitted: a form with submissions is archived
 * instead, because those are people's data with their own retention.
 */
export async function deleteForm(db: Db, id: string): Promise<'deleted' | 'archived' | null> {
  const form = await getForm(db, id);
  if (!form) return null;
  const submitted = rowsOf<{ n: number | string }>(
    await db.execute(
      sql`SELECT count(*) AS n FROM helpwell.form_submissions WHERE form_id = ${id}`,
    ),
  )[0];
  if (Number(submitted?.n ?? 0) > 0) {
    await updateFormMeta(db, id, { archived: true });
    return 'archived';
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM helpwell.form_views WHERE form_id = ${id}`);
    await tx.execute(sql`DELETE FROM helpwell.form_viewers WHERE form_id = ${id}`);
    await tx.execute(sql`DELETE FROM helpwell.forms WHERE id = ${id}`);
  });
  return 'deleted';
}

/** A copy, switched off, under a new id. */
export async function duplicateForm(db: Db, id: string): Promise<Form | null> {
  const form = await getForm(db, id);
  if (!form) return null;
  return createForm(
    db,
    {
      id: await uniqueFormId(db, `${id}-copy`),
      name: `Copy of ${form.name || form.id}`,
      definition: form.definition,
      enabled: false,
    },
    { skipChecks: true, note: `Copied from ${id} v${form.version}` },
  );
}

/* --------------------------------------------------------------- versions */

export interface FormVersionSummary {
  version: number;
  note: string | null;
  createdAt: Date;
}

export async function listFormVersions(db: Db, id: string): Promise<FormVersionSummary[]> {
  const rows = rowsOf<{ version: number | string; note: string | null; created_at: string | Date }>(
    await db.execute(sql`
      SELECT version, note, created_at FROM helpwell.form_versions
      WHERE form_id = ${id} ORDER BY version DESC
    `),
  );
  return rows.map((row) => ({
    version: Number(row.version),
    note: row.note,
    createdAt: new Date(row.created_at),
  }));
}

export async function getFormVersion(
  db: Db,
  id: string,
  version: number,
): Promise<(FormVersionSummary & { definition: FormDefinition }) | null> {
  const row = rowsOf<{
    version: number | string;
    note: string | null;
    created_at: string | Date;
    definition: unknown;
  }>(
    await db.execute(sql`
      SELECT version, note, created_at, definition FROM helpwell.form_versions
      WHERE form_id = ${id} AND version = ${version}
    `),
  )[0];
  if (!row) return null;
  return {
    version: Number(row.version),
    note: row.note,
    createdAt: new Date(row.created_at),
    definition: readDefinition(row.definition),
  };
}

/** Bring an earlier version back, as a new version: history only ever grows. */
export async function restoreFormVersion(
  db: Db,
  id: string,
  version: number,
): Promise<SaveFormResult | null> {
  const old = await getFormVersion(db, id, version);
  if (!old) return null;
  return saveForm(
    db,
    id,
    { definition: old.definition },
    { skipChecks: true, note: `Restored version ${version}` },
  );
}

/* ---------------------------------------------------------- export, import */

export interface FormExport {
  helpwell: 'form';
  formatVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  definition: FormDefinition;
}

export async function exportForm(db: Db, id: string): Promise<FormExport | null> {
  const form = await getForm(db, id);
  if (!form) return null;
  return {
    helpwell: 'form',
    formatVersion: 1,
    id: form.id,
    name: form.name,
    enabled: form.enabled,
    definition: form.definition,
  };
}

/**
 * Import an exported form. A new id creates it; an existing one is saved as
 * its next version only with `overwrite`, and a 409 otherwise, so importing
 * the wrong file cannot quietly replace a live form.
 */
export async function importForm(
  db: Db,
  input: unknown,
  options: SaveFormOptions & { overwrite?: boolean } = {},
): Promise<{ form: Form; created: boolean }> {
  const data = json(input) as Partial<FormExport> | null;
  if (!data || typeof data !== 'object' || data.helpwell !== 'form') {
    throw new HelpWellError('bad_request', 'Not a HelpWell form export (no "helpwell": "form")');
  }
  const id = typeof data.id === 'string' ? data.id.trim() : '';
  if (!FORM_ID.test(id)) {
    throw new HelpWellError(
      'bad_request',
      'The export needs an id of lower-case letters, numbers and dashes',
    );
  }
  const existing = await getForm(db, id);
  if (existing) {
    if (!options.overwrite) {
      throw new HelpWellError('conflict', `A form with the id ${id} already exists`, {
        publicMessage: `A form called ${id} already exists. Import with overwrite to save this as its next version.`,
      });
    }
    const saved = await saveForm(
      db,
      id,
      { definition: data.definition, name: typeof data.name === 'string' ? data.name : undefined },
      { ...options, note: options.note ?? 'Imported' },
    );
    return { form: saved.form, created: false };
  }
  const form = await createForm(
    db,
    {
      id,
      name: typeof data.name === 'string' ? data.name : id,
      definition: data.definition,
      enabled: data.enabled === true,
    },
    { ...options, note: options.note ?? 'Imported' },
  );
  return { form, created: true };
}

/* ---------------------------------------------------------------- helpers */

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A template with a caller's definition over it: objects merge, anything else replaces. */
function mergeRaw(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch === undefined ? base : patch;
  const out: Loose = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isRecord(value) && isRecord(out[key]) ? mergeRaw(out[key], value) : value;
  }
  return out;
}
