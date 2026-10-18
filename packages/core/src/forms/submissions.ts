/**
 * Submissions for the dashboard and the API: a filterable, paged list, one
 * submission in full, and CSV exports of submissions, giveaway entrants and
 * winners.
 *
 * CSV cells that start like a formula (`=`, `+`, `-`, `@`) are quoted with a
 * leading apostrophe, the way the contacts export does, because these values
 * were typed by strangers and the file will be opened in a spreadsheet.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import type { FormVerdict, RejectReason } from './abuse.js';
import { listEntries, listWinners } from './giveaway.js';
import type { Form } from './schema.js';

export interface FormSubmission {
  id: string;
  formId: string;
  formVersion: number;
  variant: string;
  placement: string;
  status: 'accepted' | 'rejected' | 'duplicate';
  trusted: boolean;
  reasons: RejectReason[];
  verdict: FormVerdict | Record<string, never>;
  contactId: string | null;
  email: string | null;
  name: string | null;
  fields: Record<string, unknown>;
  consent: 'granted' | 'denied' | 'none';
  consentText: string | null;
  pageUrl: string | null;
  pagePath: string | null;
  referrer: string | null;
  utm: Record<string, string>;
  createdAt: Date;
}

export interface SubmissionPage {
  items: FormSubmission[];
  nextCursor: string | null;
}

export interface SubmissionFilters {
  /** `trusted` and `untrusted` are accepted ones either way; the rest are statuses. */
  status?: 'accepted' | 'rejected' | 'duplicate' | 'trusted' | 'untrusted';
  /** Part of an email or a name. */
  q?: string;
  variant?: string;
  placement?: string;
  from?: Date;
  to?: Date;
}

type Row = {
  id: string;
  form_id: string;
  form_version: number | string;
  variant: string;
  placement: string;
  status: FormSubmission['status'];
  trusted: boolean;
  reasons: unknown;
  verdict: unknown;
  contact_id: string | null;
  email: string | null;
  name: string | null;
  fields: unknown;
  consent: FormSubmission['consent'];
  consent_text: string | null;
  page_url: string | null;
  page_path: string | null;
  referrer: string | null;
  utm: unknown;
  created_at: string | Date;
};

const parsed = <T>(value: unknown, fallback: T): T => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
};

function toSubmission(row: Row): FormSubmission {
  return {
    id: row.id,
    formId: row.form_id,
    formVersion: Number(row.form_version),
    variant: row.variant,
    placement: row.placement,
    status: row.status,
    trusted: Boolean(row.trusted),
    reasons: parsed<RejectReason[]>(row.reasons, []),
    verdict: parsed(row.verdict, {}),
    contactId: row.contact_id,
    email: row.email,
    name: row.name,
    fields: parsed(row.fields, {}),
    consent: row.consent,
    consentText: row.consent_text,
    pageUrl: row.page_url,
    pagePath: row.page_path,
    referrer: row.referrer,
    utm: parsed(row.utm, {}),
    createdAt: new Date(row.created_at),
  };
}

function filters(formId: string, f: SubmissionFilters) {
  const parts = [sql`form_id = ${formId}`];
  switch (f.status) {
    case 'trusted':
      parts.push(sql`status = 'accepted' AND trusted`);
      break;
    case 'untrusted':
      parts.push(sql`status = 'accepted' AND NOT trusted`);
      break;
    case 'accepted':
    case 'rejected':
    case 'duplicate':
      parts.push(sql`status = ${f.status}`);
      break;
    default:
      break;
  }
  const q = f.q?.trim().toLowerCase().slice(0, 200);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(
      sql`(lower(coalesce(email, '')) LIKE ${like} OR lower(coalesce(name, '')) LIKE ${like})`,
    );
  }
  if (f.variant) parts.push(sql`variant = ${f.variant}`);
  if (f.placement) parts.push(sql`placement = ${f.placement}`);
  if (f.from) parts.push(sql`created_at >= ${f.from.toISOString()}::timestamptz`);
  if (f.to) parts.push(sql`created_at <= ${f.to.toISOString()}::timestamptz`);
  return sql.join(parts, sql` AND `);
}

const COLUMNS = sql`id, form_id, form_version, variant, placement, status, trusted, reasons, verdict,
  contact_id, email, name, fields, consent, consent_text, page_url, page_path, referrer, utm, created_at`;

/** Newest first. The cursor is the last id of the previous page (ids sort by time). */
export async function listSubmissions(
  db: Db,
  formId: string,
  options: SubmissionFilters & { cursor?: string; limit?: number } = {},
): Promise<SubmissionPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT ${COLUMNS} FROM helpwell.form_submissions
      WHERE ${filters(formId, options)} ${options.cursor ? sql`AND id < ${options.cursor}` : sql``}
      ORDER BY id DESC
      LIMIT ${limit + 1}
    `),
  );
  const items = rows.slice(0, limit).map(toSubmission);
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

export async function getSubmission(db: Db, id: string): Promise<FormSubmission | null> {
  const [row] = rowsOf<Row>(
    await db.execute(sql`SELECT ${COLUMNS} FROM helpwell.form_submissions WHERE id = ${id}`),
  );
  return row ? toSubmission(row) : null;
}

/* ------------------------------------------------------------------- CSV */

export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : Array.isArray(value)
        ? value.join('; ')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const line = (cells: unknown[]) => cells.map(csvCell).join(',');

/** Every submission matching the filters, oldest first, one column per field. */
export async function submissionsCsv(
  db: Db,
  form: Form,
  options: SubmissionFilters = {},
): Promise<string> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT ${COLUMNS} FROM helpwell.form_submissions
      WHERE ${filters(form.id, options)}
      ORDER BY id LIMIT 100000
    `),
  ).map(toSubmission);
  const fieldIds = form.definition.fields.map((f) => f.id);
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) if (!fieldIds.includes(key)) fieldIds.push(key);
  }
  const header = [
    'submitted_at',
    'id',
    'status',
    'trusted',
    'reasons',
    'email',
    'name',
    ...fieldIds.map((id) => `field:${id}`),
    'consent',
    'consent_text',
    'variant',
    'placement',
    'page',
    'referrer',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'contact_id',
    'form_version',
  ];
  const lines = [line(header)];
  for (const row of rows) {
    lines.push(
      line([
        row.createdAt.toISOString(),
        row.id,
        row.status,
        row.trusted ? 'yes' : 'no',
        row.reasons,
        row.email,
        row.name,
        ...fieldIds.map((id) => row.fields[id]),
        row.consent,
        row.consentText,
        row.variant,
        row.placement,
        row.pageUrl ?? row.pagePath,
        row.referrer,
        row.utm.source,
        row.utm.medium,
        row.utm.campaign,
        row.contactId,
        row.formVersion,
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function entrantsCsv(db: Db, formId: string): Promise<string> {
  const entries = await listEntries(db, formId);
  const lines = [
    line([
      'entered_at',
      'entry_id',
      'email',
      'entries',
      'referrals',
      'bonus_actions',
      'referral_code',
      'referred_by',
      'trusted',
      'disqualified',
      'contact_id',
    ]),
  ];
  for (const e of entries) {
    lines.push(
      line([
        e.createdAt.toISOString(),
        e.id,
        e.email,
        e.entries,
        e.referrals,
        e.actions,
        e.referralCode,
        e.referredBy,
        e.trusted ? 'yes' : 'no',
        e.disqualified ? 'yes' : 'no',
        e.contactId,
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function winnersCsv(db: Db, formId: string): Promise<string> {
  const winners = await listWinners(db, formId);
  const lines = [
    line([
      'drawn_at',
      'winner_id',
      'draw_id',
      'position',
      'email',
      'entries',
      'status',
      'reason',
      'replaces',
      'replaced_by',
      'seed',
      'snapshot_hash',
      'snapshot_size',
      'total_weight',
      'entry_id',
    ]),
  ];
  for (const w of winners) {
    lines.push(
      line([
        w.createdAt.toISOString(),
        w.id,
        w.drawId,
        w.position,
        w.email,
        w.entries,
        w.status,
        w.reason,
        w.replaces,
        w.replacedBy,
        w.seed,
        w.snapshotHash,
        w.snapshotSize,
        w.totalWeight,
        w.entryId,
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}
