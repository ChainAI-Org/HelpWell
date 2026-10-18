/**
 * Contacts.
 *
 * A contact record holds only two things: what the host app told us (an
 * identify call, its own server through the admin API, or an import), and what
 * the person did in the help centre. HelpWell never enriches, scores or infers
 * (CT-02) — if the product wants to show a plan or a signup date it passes
 * those as attributes and we display them back.
 *
 * Attributes merge. Every writer sends only the keys it knows about, a key
 * set to null is removed, and a key nobody mentions is left alone; a sign-in
 * that forgets to send `plan` must not erase it.
 */

import { type SQL, sql } from 'drizzle-orm';
import { textArray } from '../conditions/compile.js';
import { countMatchingContacts, matchingContactIds } from '../conditions/scan.js';
import type { ConditionGroup } from '../conditions/types.js';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import {
  articleRatings,
  type ConsentState,
  type ContactSource,
  changelogReads,
  contacts,
  contactTags,
  conversations,
  events,
  searches,
  surveyResponses,
} from '../db/schema.js';
import { HelpWellError } from '../errors.js';
import { type FieldSource, recordFields } from '../fields/index.js';
import { eraseFormData } from '../forms/erase.js';
import { idPrefix, newId } from '../ids.js';
import { type EventCount, eventCounts } from './events.js';

export const CONTACT_SOURCES: readonly ContactSource[] = [
  'widget',
  'identify',
  'import',
  'form',
  'api',
];
export const CONSENT_STATES: readonly ConsentState[] = ['unknown', 'granted', 'denied'];

export interface ContactListItem {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  identified: boolean;
  country: string | null;
  city: string | null;
  lastSeenAt: Date;
  firstSeenAt: Date;
  conversationCount: number;
  tags: string[];
  /** How the contact first reached HelpWell (CT-09). */
  source: ContactSource;
  consent: ConsentState;
}

export interface ListContactsOptions {
  search?: string;
  identified?: boolean;
  tag?: string;
  /** Only contacts these conditions match: a segment's rules, or an unsaved filter. */
  conditions?: ConditionGroup;
  limit?: number;
  cursor?: string;
  /** "Now" for relative dates in `conditions`. */
  now?: Date;
}

export interface ContactPage {
  items: ContactListItem[];
  nextCursor: string | null;
}

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  identified: boolean;
  country: string | null;
  city: string | null;
  last_seen_at: string | Date;
  first_seen_at: string | Date;
  conversation_count: number | string;
  tags: string[] | null;
  source: string;
  consent: string;
};

/**
 * Whether the host app has vouched for this contact. The public API asks
 * before showing anything reserved for signed-in customers. Only an identify
 * call sets the flag; an email the visitor typed does not count.
 */
export async function isIdentified(db: Db, contactId: string | null): Promise<boolean> {
  if (!contactId) return false;
  const rows = await db
    .select({ identified: contacts.identified })
    .from(contacts)
    .where(sql`id = ${contactId} AND deleted_at IS NULL`)
    .limit(1);
  return rows[0]?.identified === true;
}

/** The filters every contact list shares, over `helpwell.contacts c`. */
function listFilters(options: ListContactsOptions): SQL {
  const filters = [sql`TRUE`];
  if (options.identified !== undefined) filters.push(sql`c.identified = ${options.identified}`);
  if (options.tag) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM helpwell.contact_tags t WHERE t.contact_id = c.id AND t.tag = ${options.tag.trim().toLowerCase()})`,
    );
  }
  if (options.search) {
    const like = `%${options.search.toLowerCase()}%`;
    filters.push(
      sql`(lower(coalesce(c.name, '')) LIKE ${like} OR lower(coalesce(c.email, '')) LIKE ${like}
           OR c.external_id = ${options.search.trim()})`,
    );
  }
  return sql.join(filters, sql` AND `);
}

const LIST_COLUMNS = sql`
  c.id, c.name, c.email, c.avatar_url, c.identified, c.country, c.city,
  c.last_seen_at, c.first_seen_at, c.source, c.consent,
  (SELECT count(*) FROM helpwell.conversations v
    WHERE v.contact_id = c.id AND v.deleted_at IS NULL) AS conversation_count,
  COALESCE(
    (SELECT array_agg(t.tag ORDER BY t.tag) FROM helpwell.contact_tags t
      WHERE t.contact_id = c.id),
    ARRAY[]::text[]
  ) AS tags`;

export async function listContacts(
  db: Db,
  options: ListContactsOptions = {},
): Promise<ContactPage> {
  const limit = Math.min(options.limit ?? 25, 100);
  const where = listFilters(options);

  // A segment is resolved to ids first, by SQL when the rules compile and a
  // page at a time in memory when they do not; the list itself is the same.
  if (options.conditions) {
    const page = await matchingContactIds(db, options.conditions, {
      after: options.cursor,
      limit,
      where,
      now: options.now,
    });
    if (page.ids.length === 0) return { items: [], nextCursor: null };
    const result = await db.execute<ContactRow>(sql`
      SELECT ${LIST_COLUMNS} FROM helpwell.contacts c
      WHERE c.id = ANY(${textArray(page.ids)})
      ORDER BY c.id DESC
    `);
    return { items: rowsOf<ContactRow>(result).map(toListItem), nextCursor: page.nextCursor };
  }

  const result = await db.execute<ContactRow>(sql`
    SELECT ${LIST_COLUMNS}
    FROM helpwell.contacts c
    WHERE c.deleted_at IS NULL AND ${where}
      ${options.cursor ? sql`AND c.id < ${options.cursor}` : sql``}
    ORDER BY c.id DESC
    LIMIT ${limit + 1}
  `);

  const rows = rowsOf<ContactRow>(result);
  const page = rows.slice(0, limit);

  return {
    items: page.map(toListItem),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** How many contacts a list would hold, with the same filters as `listContacts`. */
export async function countContacts(
  db: Db,
  options: Omit<ListContactsOptions, 'cursor' | 'limit'> = {},
): Promise<number> {
  const where = listFilters(options);
  if (options.conditions) {
    return countMatchingContacts(db, options.conditions, { where, now: options.now });
  }
  const result = await db.execute<{ n: number | string }>(
    sql`SELECT count(*) AS n FROM helpwell.contacts c WHERE c.deleted_at IS NULL AND ${where}`,
  );
  return Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);
}

function toListItem(row: ContactRow): ContactListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    identified: Boolean(row.identified),
    country: row.country,
    city: row.city,
    lastSeenAt: new Date(row.last_seen_at),
    firstSeenAt: new Date(row.first_seen_at),
    conversationCount: Number(row.conversation_count ?? 0),
    tags: row.tags ?? [],
    source: row.source as ContactSource,
    consent: row.consent as ConsentState,
  };
}

/** One row of the "Help centre activity" column on the contact screen (CT-05). */
export interface ActivityItem {
  kind: 'search' | 'article_rating' | 'changelog_read' | 'survey' | 'event';
  label: string;
  detail: string | null;
  at: Date;
}

export interface ContactDetail extends ContactListItem {
  externalId: string | null;
  attributes: Record<string, unknown>;
  /** Where the consent state came from (identify, api, import, form), and when. */
  consentSource: string | null;
  consentAt: Date | null;
  /** The host app's own signup date, when it sent one. */
  signedUpAt: Date | null;
  locale: string | null;
  timezone: string | null;
  conversations: Array<{
    id: string;
    topic: string | null;
    status: string;
    lastMessageAt: Date;
    messageCount: number;
    snippet: string;
  }>;
  activity: ActivityItem[];
  /** Every event name this contact has, with counts. */
  eventCounts: EventCount[];
}

/**
 * The internal id behind either an internal id or the host app's own user id,
 * so the admin API accepts `con_…` and `usr_8412` alike. Null when neither
 * matches a live contact.
 */
export async function resolveContactId(db: Db, idOrExternalId: string): Promise<string | null> {
  const key = idOrExternalId.trim();
  if (!key) return null;
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM helpwell.contacts
    WHERE (id = ${key} OR external_id = ${key}) AND deleted_at IS NULL
    ORDER BY (id = ${key}) DESC
    LIMIT 1
  `);
  return rowsOf<{ id: string }>(result)[0]?.id ?? null;
}

export async function getContact(db: Db, id: string): Promise<ContactDetail | null> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(sql`id = ${id} AND deleted_at IS NULL`)
    .limit(1);
  if (!row) return null;

  const tagRows = await db
    .select({ tag: contactTags.tag })
    .from(contactTags)
    .where(sql`contact_id = ${id}`)
    .orderBy(sql`tag ASC`);

  const countResult = await db.execute<{ n: number | string }>(
    sql`SELECT count(*) AS n FROM helpwell.conversations
        WHERE contact_id = ${id} AND deleted_at IS NULL`,
  );

  const convoResult = await db.execute<{
    id: string;
    topic: string | null;
    status: string;
    last_message_at: string | Date;
    message_count: number;
    snippet: string | null;
  }>(sql`
    SELECT c.id, c.topic, c.status, c.last_message_at, c.message_count,
      (SELECT m.body FROM helpwell.messages m
        WHERE m.conversation_id = c.id AND m.role = 'customer'
        ORDER BY m.created_at DESC LIMIT 1) AS snippet
    FROM helpwell.conversations c
    WHERE c.contact_id = ${id} AND c.deleted_at IS NULL
    ORDER BY c.last_message_at DESC
    LIMIT 20
  `);

  return {
    ...toListItem({
      id: row.id,
      name: row.name,
      email: row.email,
      avatar_url: row.avatarUrl,
      identified: row.identified,
      country: row.country,
      city: row.city,
      last_seen_at: row.lastSeenAt,
      first_seen_at: row.firstSeenAt,
      conversation_count: 0,
      tags: tagRows.map((t) => t.tag),
      source: row.source,
      consent: row.consent,
    }),
    conversationCount: Number(rowsOf<{ n: number | string }>(countResult)[0]?.n ?? 0),
    externalId: row.externalId,
    attributes: row.attributes,
    consentSource: row.consentSource,
    consentAt: row.consentAt,
    signedUpAt: row.signedUpAt,
    locale: row.locale,
    timezone: row.timezone,
    conversations: rowsOf<{
      id: string;
      topic: string | null;
      status: string;
      last_message_at: string | Date;
      message_count: number;
      snippet: string | null;
    }>(convoResult).map((c) => ({
      id: c.id,
      topic: c.topic,
      status: c.status,
      lastMessageAt: new Date(c.last_message_at),
      messageCount: c.message_count,
      snippet: c.snippet ?? '',
    })),
    activity: await getContactActivity(db, id),
    eventCounts: await eventCounts(db, { contactId: id, limit: 50 }),
  };
}

export async function getContactActivity(db: Db, id: string, limit = 30): Promise<ActivityItem[]> {
  const result = await db.execute<{
    kind: ActivityItem['kind'];
    label: string;
    detail: string | null;
    at: string | Date;
  }>(sql`
    SELECT 'search'::text AS kind, s.query AS label,
           (s.results_count || ' results') AS detail, s.created_at AS at
      FROM helpwell.searches s WHERE s.contact_id = ${id}
    UNION ALL
    SELECT 'article_rating'::text, r.slug, r.value, r.created_at
      FROM helpwell.article_ratings r WHERE r.contact_id = ${id}
    UNION ALL
    SELECT 'changelog_read'::text, e.title, NULL, cr.read_at
      FROM helpwell.changelog_reads cr
      JOIN helpwell.changelog_entries e ON e.id = cr.entry_id
      WHERE cr.contact_id = ${id}
    UNION ALL
    SELECT 'survey'::text, sr.survey_id, coalesce(sr.score::text, sr.choice), sr.created_at
      FROM helpwell.survey_responses sr WHERE sr.contact_id = ${id}
    UNION ALL
    SELECT 'event'::text, ev.name, ev.url, ev.created_at
      FROM helpwell.events ev WHERE ev.contact_id = ${id}
    ORDER BY at DESC
    LIMIT ${limit}
  `);

  return rowsOf<{
    kind: ActivityItem['kind'];
    label: string;
    detail: string | null;
    at: string | Date;
  }>(result).map((r) => ({
    kind: r.kind,
    label: r.label,
    detail: r.detail,
    at: new Date(r.at),
  }));
}

/** Tags are lower-case labels of up to 60 characters. */
export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase().slice(0, 60);
}

export async function addContactTag(db: Db, id: string, tag: string): Promise<void> {
  const value = normaliseTag(tag);
  if (!value) return;
  await db.insert(contactTags).values({ contactId: id, tag: value }).onConflictDoNothing();
}

export async function removeContactTag(db: Db, id: string, tag: string): Promise<void> {
  await db.delete(contactTags).where(sql`contact_id = ${id} AND tag = ${normaliseTag(tag)}`);
}

/* ------------------------------------------------------------- attributes */

/** More keys than this in one write is a bug in the caller, not a contact. */
export const MAX_ATTRIBUTE_KEYS = 200;
const MAX_ATTRIBUTE_BYTES = 8_000;

/**
 * Check a set of attributes before it is merged: keys of 1 to 120 characters,
 * at most 200 of them, and no single value over 8 KB of JSON. `strict` throws
 * a 400 naming the first problem (the admin API); otherwise offending keys are
 * dropped quietly (an identify token, which the host signed and a person
 * cannot correct from the widget).
 */
export function cleanAttributes(
  input: unknown,
  options: { strict?: boolean } = {},
): Record<string, unknown> {
  const fail = (message: string): Record<string, unknown> => {
    if (options.strict) throw new HelpWellError('bad_request', message);
    return {};
  };
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return fail('attributes must be an object of key: value pairs');
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ATTRIBUTE_KEYS) {
      if (options.strict) fail(`At most ${MAX_ATTRIBUTE_KEYS} attributes in one update`);
      break;
    }
    if (!key.trim() || key.length > 120) {
      if (options.strict) fail(`Attribute names need 1 to 120 characters: "${key.slice(0, 40)}"`);
      continue;
    }
    const size = value === undefined ? 0 : JSON.stringify(value).length;
    if (size > MAX_ATTRIBUTE_BYTES) {
      if (options.strict) fail(`The value of "${key}" is over 8 KB`);
      continue;
    }
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The SQL that merges `patch` into an attributes column: keys with a value are
 * set, keys set to null are removed, everything else is untouched. One
 * statement, so two concurrent writers cannot lose each other's keys.
 */
export function mergedAttributes(column: SQL, patch: Record<string, unknown>): SQL {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) unset.push(key);
    else set[key] = value;
  }
  const merged = sql`(coalesce(${column}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb)`;
  return unset.length > 0 ? sql`(${merged} - ${textArray(unset)})` : merged;
}

/** Only the keys that carry a value, for a fresh row. */
function withoutNulls(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
}

/* ------------------------------------------------------------ server-side */

export interface ContactPatch {
  /** Merged: set keys, `null` removes a key, absent keys are untouched. */
  attributes?: Record<string, unknown>;
  tags?: { add?: string[]; remove?: string[] };
  consent?: ConsentState;
}

export interface UpdateContactResult {
  contactId: string;
  created: boolean;
}

/**
 * Update a contact from the host app's own server (`PATCH /admin/contacts/:id`,
 * `helpwell.contacts.update`), a form or an import.
 *
 * `idOrExternalId` is either HelpWell's id or the host's user id. With
 * `upsert`, a user id HelpWell has never seen becomes a new contact,
 * identified (the caller holds the admin token, which is the host vouching)
 * and labelled with `source`. Returns null when there is no such contact and
 * `upsert` is off, or the id looks like one of HelpWell's own.
 */
export async function updateContact(
  db: Db,
  idOrExternalId: string,
  patch: ContactPatch,
  options: { source: 'api' | 'form' | 'import'; upsert?: boolean; now?: Date },
): Promise<UpdateContactResult | null> {
  const now = options.now ?? new Date();
  const attributes = cleanAttributes(patch.attributes, { strict: true });
  let contactId = await resolveContactId(db, idOrExternalId);
  let created = false;

  if (!contactId) {
    const key = idOrExternalId.trim();
    if (!options.upsert || !key || key.startsWith(`${idPrefix.contact}_`)) return null;
    contactId = newId(idPrefix.contact, now.getTime());
    await db.insert(contacts).values({
      id: contactId,
      externalId: key.slice(0, 200),
      identified: true,
      source: options.source,
      attributes: withoutNulls(attributes),
      firstSeenAt: now,
      lastSeenAt: now,
    });
    created = true;
  } else if (Object.keys(attributes).length > 0) {
    await db
      .update(contacts)
      .set({ attributes: mergedAttributes(sql`attributes`, attributes), updatedAt: now })
      .where(sql`id = ${contactId}`);
  }

  if (Object.keys(attributes).length > 0) {
    await recordFields(db, attributes, fieldSourceFor(options.source), now);
  }
  for (const tag of patch.tags?.add ?? []) await addContactTag(db, contactId, tag);
  for (const tag of patch.tags?.remove ?? []) await removeContactTag(db, contactId, tag);
  if (patch.consent !== undefined) {
    await setConsent(db, contactId, patch.consent, options.source, now);
  }
  return { contactId, created };
}

/**
 * Record a consent state and where it came from. Saying the same thing again
 * keeps the original time and source, so "granted on 3 March via identify"
 * stays true however often the app repeats it.
 */
export async function setConsent(
  db: Db,
  contactId: string,
  state: ConsentState,
  source: string,
  now: Date = new Date(),
): Promise<void> {
  if (!CONSENT_STATES.includes(state)) {
    throw new HelpWellError('bad_request', `consent must be one of: ${CONSENT_STATES.join(', ')}`);
  }
  await db.execute(sql`
    UPDATE helpwell.contacts SET
      consent_source = CASE WHEN consent = ${state} AND consent_source IS NOT NULL
        THEN consent_source ELSE ${state === 'unknown' ? null : source} END,
      consent_at = CASE WHEN consent = ${state} AND consent_at IS NOT NULL
        THEN consent_at ELSE ${state === 'unknown' ? null : now.toISOString()}::timestamptz END,
      consent = ${state},
      updated_at = ${now.toISOString()}::timestamptz
    WHERE id = ${contactId}
  `);
}

export interface NewContactInput {
  source: ContactSource;
  externalId?: string | null;
  email?: string | null;
  name?: string | null;
  attributes?: Record<string, unknown>;
  tags?: string[];
  /** Only an identify call or the admin API may say this. Defaults to false. */
  identified?: boolean;
  signedUpAt?: Date | null;
}

/**
 * Create a contact outright: a form submission from someone the widget has
 * never seen, say. Matching an existing person is the caller's job; this
 * always inserts.
 */
export async function createContact(db: Db, input: NewContactInput): Promise<string> {
  const id = newId(idPrefix.contact);
  const attributes = withoutNulls(cleanAttributes(input.attributes));
  await db.insert(contacts).values({
    id,
    source: input.source,
    externalId: input.externalId ?? null,
    email: input.email?.trim().toLowerCase().slice(0, 254) || null,
    name: input.name?.trim().slice(0, 200) || null,
    identified: input.identified ?? false,
    attributes,
    signedUpAt: input.signedUpAt ?? null,
  });
  for (const tag of input.tags ?? []) await addContactTag(db, id, tag);
  if (Object.keys(attributes).length > 0) {
    await recordFields(db, attributes, fieldSourceFor(input.source));
  }
  return id;
}

/* ----------------------------------------------------------------- import */

/** One person from another tool's export (MG-04). */
export interface ImportContactRow {
  /** The host app's own user id, the same one identify() will later sign. */
  id?: string | null;
  email?: string | null;
  name?: string | null;
  /** ISO date, or a Date. */
  signedUpAt?: string | Date | null;
  tags?: string[];
  attributes?: Record<string, unknown>;
}

export interface ImportContactsResult {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bring people in from another tool.
 *
 * Every created contact is labelled `import` with consent `unknown` and is not
 * marked identified: an export is not a signed identify call, and nothing may
 * treat someone as having agreed to anything until they engage or re-confirm
 * (MG-04). A row matches an existing contact by user id, then by email among
 * people the host app vouched for or an earlier import created, so running
 * the same import twice updates rather than duplicates. Matched contacts keep
 * their source; attributes merge, tags are added, and a name, email or signup
 * date is only filled in where there was none.
 */
export async function importContacts(
  db: Db,
  rows: ImportContactRow[],
): Promise<ImportContactsResult> {
  const result: ImportContactsResult = { created: 0, updated: 0, skipped: [] };

  for (const [index, row] of rows.entries()) {
    const externalId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
    const email =
      typeof row.email === 'string' && row.email.trim() ? row.email.trim().toLowerCase() : null;
    if (!externalId && !email) {
      result.skipped.push({ row: index + 1, reason: 'needs an id or an email' });
      continue;
    }
    if (email && !EMAIL.test(email)) {
      result.skipped.push({ row: index + 1, reason: `"${email}" is not an email address` });
      continue;
    }
    let attributes: Record<string, unknown>;
    try {
      attributes = cleanAttributes(row.attributes, { strict: true });
    } catch (error) {
      result.skipped.push({ row: index + 1, reason: (error as Error).message });
      continue;
    }
    const signedUpAt = row.signedUpAt ? new Date(row.signedUpAt) : null;
    const signedUp = signedUpAt && !Number.isNaN(signedUpAt.getTime()) ? signedUpAt : null;

    const match = rowsOf<{ id: string }>(
      await db.execute(sql`
        SELECT id FROM helpwell.contacts
        WHERE deleted_at IS NULL AND (
          ${externalId ? sql`external_id = ${externalId}` : sql`FALSE`}
          OR ${email ? sql`(lower(email) = ${email} AND (identified OR source = 'import'))` : sql`FALSE`}
        )
        ORDER BY ${externalId ? sql`(external_id = ${externalId}) DESC,` : sql``} id
        LIMIT 1
      `),
    )[0];

    if (match) {
      await db.execute(sql`
        UPDATE helpwell.contacts SET
          attributes = ${mergedAttributes(sql`attributes`, attributes)},
          name = coalesce(name, ${row.name?.trim().slice(0, 200) || null}),
          external_id = coalesce(external_id, ${externalId}),
          signed_up_at = coalesce(signed_up_at, ${signedUp?.toISOString() ?? null}::timestamptz),
          updated_at = now()
        WHERE id = ${match.id}
      `);
      // An email is only filled in when no vouched-for contact already has it.
      if (email) {
        await db.execute(sql`
          UPDATE helpwell.contacts SET email = ${email}
          WHERE id = ${match.id} AND email IS NULL AND NOT EXISTS (
            SELECT 1 FROM helpwell.contacts o
            WHERE lower(o.email) = ${email} AND o.identified AND o.deleted_at IS NULL)
        `);
      }
      for (const tag of row.tags ?? []) await addContactTag(db, match.id, tag);
      if (Object.keys(attributes).length > 0) await recordFields(db, attributes, 'import');
      result.updated++;
    } else {
      await createContact(db, {
        source: 'import',
        externalId,
        email,
        name: row.name,
        attributes,
        tags: row.tags,
        signedUpAt: signedUp,
      });
      result.created++;
    }
  }
  return result;
}

/** Identify and widget attributes come from the app; the rest name themselves. */
function fieldSourceFor(source: ContactSource): FieldSource {
  return source === 'identify' || source === 'widget' ? 'app' : source;
}

/* ------------------------------------------------------------ data rights */

/**
 * What the export says about the fields in it that are not self-explanatory,
 * keyed `<table>.<column>`. It rides in the export itself, so the file makes
 * sense to whoever it is handed to.
 */
export const CONTACT_EXPORT_NOTES = {
  'formSubmissions.ip_address_hash':
    "A keyed one-way hash of the IP address the form was sent from, kept to spot repeated abuse; it cannot be reversed without this install's secret. The address itself is never stored.",
} as const;

/** One table per key, so a person (or their lawyer) can see exactly what is held. */
export interface ContactExport {
  /** What the less obvious fields mean (`CONTACT_EXPORT_NOTES`). */
  notes: Record<string, string>;
  contact: Record<string, unknown>;
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  searches: Record<string, unknown>[];
  articleRatings: Record<string, unknown>[];
  changelogReads: Record<string, unknown>[];
  surveyResponses: Record<string, unknown>[];
  events: Record<string, unknown>[];
  roadmapIdeas: Record<string, unknown>[];
  roadmapVotes: Record<string, unknown>[];
  engageImpressions: Record<string, unknown>[];
  /** Every form submission, matched like erasure: on the contact or the address. */
  formSubmissions: Record<string, unknown>[];
  /** One row per giveaway entered; `won` is true while they are a selected winner. */
  giveawayEntries: Record<string, unknown>[];
}

/**
 * Everything HelpWell holds about one person, as JSON (CT-08).
 *
 * Every table with a contact id on it, in full and uncapped. This is the
 * data-portability export, so "most of it" is not a version of it. The source
 * and consent labels ride on the contact (CT-09). Form submissions and
 * giveaway entries are matched the way `eraseFormData` matches them, on the
 * contact or on the address typed into the form, so the export shows exactly
 * what erasing the person would remove. A submission's hashed IP is
 * included, as `ip_address_hash` and labelled in `notes` as a keyed one-way
 * hash, because it is still held about them. The rest of the anti-abuse
 * internals (the scored verdict, the token nonce) are left out; its status
 * and reasons say what was decided.
 */
export async function exportContact(db: Db, id: string): Promise<ContactExport | null> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(sql`id = ${id} AND deleted_at IS NULL`)
    .limit(1);
  if (!row) return null;

  const all = async (query: ReturnType<typeof sql>) =>
    rowsOf<Record<string, unknown>>(await db.execute(query));

  const [
    tags,
    conversationRows,
    messageRows,
    searchRows,
    ratingRows,
    readRows,
    surveyRows,
    eventRows,
    ideaRows,
    voteRows,
    impressionRows,
    submissionRows,
    entryRows,
  ] = await Promise.all([
    all(sql`SELECT tag, created_at FROM helpwell.contact_tags WHERE contact_id = ${id}`),
    all(sql`SELECT id, status, topic, page_url, rating, rating_comment,
                   started_at, last_message_at, message_count
            FROM helpwell.conversations WHERE contact_id = ${id} ORDER BY started_at ASC`),
    all(sql`SELECT m.id, m.conversation_id, m.role, m.body, m.citations, m.feedback,
                   m.feedback_comment, m.model, m.created_at
            FROM helpwell.messages m
            JOIN helpwell.conversations c ON c.id = m.conversation_id
            WHERE c.contact_id = ${id} ORDER BY m.created_at ASC, m.id ASC`),
    all(sql`SELECT query, results_count, source, created_at
            FROM helpwell.searches WHERE contact_id = ${id} ORDER BY created_at ASC`),
    all(sql`SELECT slug, value, comment, created_at
            FROM helpwell.article_ratings WHERE contact_id = ${id} ORDER BY created_at ASC`),
    all(sql`SELECT entry_id, read_at FROM helpwell.changelog_reads WHERE contact_id = ${id}`),
    all(sql`SELECT survey_id, kind, score, choice, comment, created_at
            FROM helpwell.survey_responses WHERE contact_id = ${id} ORDER BY created_at ASC`),
    all(sql`SELECT name, props, url, created_at
            FROM helpwell.events WHERE contact_id = ${id} ORDER BY created_at ASC`),
    all(sql`SELECT id, title, body, status, created_at
            FROM helpwell.roadmap_items WHERE created_by = ${id} ORDER BY created_at ASC`),
    all(sql`SELECT item_id, created_at FROM helpwell.roadmap_votes WHERE contact_id = ${id}`),
    all(sql`SELECT engagement_id, state, step, url, created_at
            FROM helpwell.engage_impressions WHERE contact_id = ${id} ORDER BY created_at ASC`),
    all(sql`SELECT s.id, s.form_id, f.name AS form_name, s.form_version, s.variant, s.placement,
                   s.status, s.trusted, s.reasons, s.email, s.name, s.fields, s.consent,
                   s.consent_text, s.page_url, s.page_path, s.referrer, s.utm,
                   s.ip_hash AS ip_address_hash, s.created_at
            FROM helpwell.form_submissions s
            LEFT JOIN helpwell.forms f ON f.id = s.form_id
            WHERE ${formPerson(sql`s`, id, row.email)}
            ORDER BY s.created_at ASC, s.id ASC`),
    all(sql`SELECT e.id, e.form_id, f.name AS form_name, e.submission_id, e.email,
                   e.referral_code, e.referred_by, e.entries, e.bonus_referrals, e.bonus_actions,
                   e.actions, e.trusted, e.disqualified,
                   EXISTS (SELECT 1 FROM helpwell.giveaway_winners w
                           WHERE w.entry_id = e.id AND w.status = 'selected') AS won,
                   e.created_at, e.updated_at
            FROM helpwell.giveaway_entries e
            LEFT JOIN helpwell.forms f ON f.id = e.form_id
            WHERE ${formPerson(sql`e`, id, row.email)}
            ORDER BY e.created_at ASC, e.id ASC`),
  ]);

  return {
    notes: { ...CONTACT_EXPORT_NOTES },
    contact: {
      id: row.id,
      externalId: row.externalId,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatarUrl,
      attributes: row.attributes,
      identified: row.identified,
      source: row.source,
      consent: row.consent,
      consentSource: row.consentSource,
      consentAt: row.consentAt,
      signedUpAt: row.signedUpAt,
      locale: row.locale,
      timezone: row.timezone,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      tags,
    },
    conversations: conversationRows,
    messages: messageRows,
    searches: searchRows,
    articleRatings: ratingRows,
    changelogReads: readRows,
    surveyResponses: surveyRows,
    events: eventRows,
    roadmapIdeas: ideaRows,
    roadmapVotes: voteRows,
    engageImpressions: impressionRows,
    formSubmissions: submissionRows,
    giveawayEntries: entryRows,
  };
}

/** Form rows that belong to a person: on their contact, or typed with their address. */
function formPerson(alias: SQL, contactId: string, email: string | null): SQL {
  return email
    ? sql`(${alias}.contact_id = ${contactId} OR lower(${alias}.email) = ${email.toLowerCase()})`
    : sql`${alias}.contact_id = ${contactId}`;
}

/** The columns of the contacts CSV, in order. */
export const CONTACT_CSV_COLUMNS = [
  'id',
  'external_id',
  'name',
  'email',
  'identified',
  'source',
  'consent',
  'consent_source',
  'consent_at',
  'signed_up_at',
  'first_seen_at',
  'last_seen_at',
  'tags',
  'attributes',
  'forms_submitted',
  'last_form_submitted_at',
  'giveaways_entered',
  'giveaway_entries',
] as const;

/**
 * A list of contacts as CSV, with the source and consent labels on every row
 * (CT-09). Filtered like `listContacts`, read a page at a time. A cell that a
 * spreadsheet would run as a formula is prefixed with a quote.
 *
 * The form columns summarise what the person gave you through forms:
 * `forms_submitted` and `last_form_submitted_at` count accepted submissions
 * only (a rejected one is spam, a duplicate is the same person again), and
 * `giveaways_entered` is how many giveaways they are in, with
 * `giveaway_entries` their total entries, bonuses included, across the ones
 * they were not disqualified from. The rows themselves are in the per-person
 * export.
 */
export async function contactsCsv(
  db: Db,
  options: Omit<ListContactsOptions, 'cursor' | 'limit'> = {},
): Promise<string> {
  const lines = [CONTACT_CSV_COLUMNS.join(',')];
  let cursor: string | undefined;
  for (;;) {
    const page = await listContacts(db, { ...options, cursor, limit: 100 });
    if (page.items.length > 0) {
      const ids = textArray(page.items.map((c) => c.id));
      const detail = rowsOf<{
        id: string;
        external_id: string | null;
        attributes: Record<string, unknown>;
        consent_source: string | null;
        consent_at: string | Date | null;
        signed_up_at: string | Date | null;
        forms_submitted: number | string | null;
        last_form_submitted_at: string | Date | null;
        giveaways_entered: number | string | null;
        giveaway_entries: number | string | null;
      }>(
        await db.execute(sql`
          SELECT c.id, c.external_id, c.attributes, c.consent_source, c.consent_at, c.signed_up_at,
                 s.forms_submitted, s.last_form_submitted_at,
                 g.giveaways_entered, g.giveaway_entries
          FROM helpwell.contacts c
          LEFT JOIN (
            SELECT contact_id, count(*) AS forms_submitted,
                   max(created_at) AS last_form_submitted_at
            FROM helpwell.form_submissions
            WHERE status = 'accepted' AND contact_id = ANY(${ids})
            GROUP BY contact_id
          ) s ON s.contact_id = c.id
          LEFT JOIN (
            SELECT contact_id, count(*) AS giveaways_entered,
                   coalesce(sum(entries) FILTER (WHERE NOT disqualified), 0) AS giveaway_entries
            FROM helpwell.giveaway_entries
            WHERE contact_id = ANY(${ids})
            GROUP BY contact_id
          ) g ON g.contact_id = c.id
          WHERE c.id = ANY(${ids})
        `),
      );
      const byId = new Map(detail.map((row) => [row.id, row]));
      for (const contact of page.items) {
        const extra = byId.get(contact.id);
        const iso = (value: string | Date | null | undefined) =>
          value ? new Date(value).toISOString() : '';
        lines.push(
          [
            contact.id,
            extra?.external_id ?? '',
            contact.name ?? '',
            contact.email ?? '',
            String(contact.identified),
            contact.source,
            contact.consent,
            extra?.consent_source ?? '',
            iso(extra?.consent_at),
            iso(extra?.signed_up_at),
            contact.firstSeenAt.toISOString(),
            contact.lastSeenAt.toISOString(),
            contact.tags.join(';'),
            JSON.stringify(extra?.attributes ?? {}),
            String(Number(extra?.forms_submitted ?? 0)),
            iso(extra?.last_form_submitted_at),
            String(Number(extra?.giveaways_entered ?? 0)),
            String(Number(extra?.giveaway_entries ?? 0)),
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Erase a person (CT-10).
 *
 * Everything keyed on the contact goes; the contact row itself is kept as a
 * tombstone with every personal field cleared, so the id in an old log line
 * resolves to "erased" rather than to nothing, and a stale cookie for it is
 * refused rather than resurrected (the request context checks `deleted_at`).
 * Rows that reference the contact loosely — an idea they submitted, which is
 * public content — keep the content and lose the attribution.
 */
export async function deleteContact(db: Db, id: string): Promise<boolean> {
  // First, while the contact still has its email: form submissions are
  // matched on the address as well as the contact.
  await eraseFormData(db, id);
  const rows = await db
    .update(contacts)
    .set({
      email: null,
      name: null,
      avatarUrl: null,
      externalId: null,
      attributes: {},
      locale: null,
      timezone: null,
      country: null,
      city: null,
      identified: false,
      signedUpAt: null,
      consentSource: null,
      consentAt: null,
      deletedAt: new Date(),
    })
    .where(sql`id = ${id} AND deleted_at IS NULL`)
    .returning({ id: contacts.id });

  if (rows.length === 0) return false;

  await db.delete(conversations).where(sql`contact_id = ${id}`);
  await db.delete(searches).where(sql`contact_id = ${id}`);
  await db.delete(articleRatings).where(sql`contact_id = ${id}`);
  await db.delete(changelogReads).where(sql`contact_id = ${id}`);
  await db.delete(surveyResponses).where(sql`contact_id = ${id}`);
  await db.delete(events).where(sql`contact_id = ${id}`);
  await db.delete(contactTags).where(sql`contact_id = ${id}`);
  await db.execute(sql`DELETE FROM helpwell.roadmap_votes WHERE contact_id = ${id}`);
  await db.execute(sql`DELETE FROM helpwell.engage_impressions WHERE contact_id = ${id}`);
  await db.execute(sql`DELETE FROM helpwell.proactive_deliveries WHERE contact_id = ${id}`);
  await db.execute(
    sql`UPDATE helpwell.roadmap_items SET created_by = NULL WHERE created_by = ${id}`,
  );
  return true;
}
